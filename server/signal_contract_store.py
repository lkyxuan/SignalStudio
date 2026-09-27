"""Versioned, machine-readable signal definitions and graph-backed export packages."""

import hashlib
import json
from pathlib import Path

from graph_service import GraphError

DEFAULT_CONTRACT = Path(__file__).resolve().parent.parent / "catalog" / "signal-contracts.v1.json"


def revision_of(value):
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


class SignalContractStore:
    def __init__(self, source_contracts, path=DEFAULT_CONTRACT):
        self.source_contracts = source_contracts
        self.contract = json.loads(Path(path).read_text(encoding="utf-8"))
        if (self.contract.get("catalog_version") != "signal-contracts.v1"
                or self.contract.get("owner") != "SignalStudio"
                or not isinstance(self.contract.get("signals"), list)):
            raise GraphError("Unsupported signal contract")
        self.revision = revision_of(self.contract)
        self.signals = {}
        for spec in self.contract["signals"]:
            self._validate(spec)
            key = spec["signal_key"]
            if key in self.signals:
                raise GraphError("Duplicate signal key")
            self.signals[key] = spec

    def _validate(self, spec):
        if not isinstance(spec, dict) or not isinstance(spec.get("signal_key"), str):
            raise GraphError("Invalid signal definition")
        key = spec["signal_key"]
        if (not key or not isinstance(spec.get("version"), int)
                or isinstance(spec["version"], bool) or spec["version"] < 1
                or spec.get("design_status") != "hypothesis"):
            raise GraphError(f"Invalid signal version or status: {key}")
        operation_id = spec.get("collection", {}).get("operation_id")
        operation = self.source_contracts.operations.get(operation_id)
        if not operation:
            raise GraphError(f"Unknown signal source operation: {key}")
        collection = spec["collection"]
        request = collection.get("request", {})
        authentication = request.get("authentication", {})
        if (request.get("method") != "GET"
                or not isinstance(request.get("url"), str)
                or not request["url"].startswith("https://")
                or not request["url"].endswith(operation["endpoint"])
                or authentication.get("kind") != "secret_header"
                or not authentication.get("header")
                or not authentication.get("secret_ref")):
            raise GraphError(f"Invalid signal source request: {key}")
        if (collection.get("source_contract_version") != "source-contracts.v1"
                or collection.get("raw_response_policy") != operation["raw_response_policy"]):
            raise GraphError(f"Source contract mismatch: {key}")
        defined_params = {item["name"]: item for item in operation["inputs"]}
        params = collection.get("parameters")
        pagination = collection.get("pagination")
        if (not isinstance(params, dict) or not isinstance(pagination, dict)
                or set(params) - set(defined_params)
                or any(item["required"] and name not in params
                       for name, item in defined_params.items())
                or pagination.get("parameter") not in defined_params):
            raise GraphError(f"Invalid signal source parameters: {key}")
        if (not isinstance(pagination.get("start"), int)
                or not isinstance(pagination.get("step"), int)
                or not isinstance(pagination.get("max_pages"), int)
                or pagination["start"] < 1 or pagination["step"] < 1
                or pagination["max_pages"] < 1):
            raise GraphError(f"Invalid signal pagination: {key}")
        fields = {field["path"]: field for field in operation["fields"]}
        message = spec.get("input_message", {})
        metadata = message.get("metadata_fields")
        if (message.get("role") != "crawler_produces_consumer_reads"
                or message.get("payload_policy") != "preserve_complete_upstream_record"
                or message.get("unknown_upstream_fields_policy") != "pass_through_in_data"
                or message.get("message_status") != "planned_not_observed"
                or message.get("payload_record_path") != "data"
                or message.get("metadata_path") != "meta"
                or not isinstance(metadata, list)
                or len(metadata) != 4
                or {item.get("path") for item in metadata if isinstance(item, dict)} != {
                    "meta.operation_id", "meta.source_run_id",
                    "meta.source_observation_id", "meta.collected_at"}
                or any(not isinstance(item, dict) or item.get("required") is not True
                       for item in metadata)):
            raise GraphError(f"Invalid signal input message: {key}")
        inputs = spec.get("inputs")
        if not isinstance(inputs, list) or not inputs:
            raise GraphError(f"Signal inputs are required: {key}")
        input_names = set()
        for item in inputs:
            if (not isinstance(item, dict) or not isinstance(item.get("name"), str)
                    or not item["name"] or item["name"] in input_names
                    or item.get("upstream_path") not in fields
                    or item.get("message_path") != "data." + item["upstream_path"]
                    or item.get("required") is not True):
                raise GraphError(f"Invalid signal input: {key}")
            input_names.add(item["name"])
        subject = spec.get("subject", {})
        if subject.get("identity_field") not in {item["upstream_path"] for item in inputs}:
            raise GraphError(f"Signal identity field is not an input: {key}")
        if (collection.get("event_time_field") not in fields
                or collection.get("record_identity_field") not in fields):
            raise GraphError(f"Signal time or record identity field is missing: {key}")
        processing = spec.get("processing", {})
        calculation = processing.get("calculation", {})
        if (calculation.get("operator") != "divide"
                or calculation.get("numerator") not in input_names
                or calculation.get("denominator") not in input_names
                or calculation.get("zero_or_negative_denominator") != "no_result"
                or processing.get("missing_input_policy") != "no_result"):
            raise GraphError(f"Invalid signal calculation: {key}")
        trigger = processing.get("trigger", {})
        conditions = trigger.get("conditions")
        if (trigger.get("operator") != "all" or not isinstance(conditions, list)
                or not conditions or any(
                    item.get("field") not in input_names | {calculation.get("output")}
                    or item.get("operator") != "gte"
                    or not isinstance(item.get("value"), (int, float))
                    for item in conditions)):
            raise GraphError(f"Invalid signal trigger: {key}")
        output = spec.get("output", {})
        output_fields = output.get("fields")
        if not isinstance(output_fields, list) or not output_fields:
            raise GraphError(f"Signal output fields are required: {key}")
        output_names = [item.get("name") for item in output_fields]
        if (len(set(output_names)) != len(output_names)
                or not set(output.get("idempotency_key", [])).issubset(output_names)
                or not {"source_observation_id", "source_run_id"}.issubset(output_names)):
            raise GraphError(f"Invalid signal output contract: {key}")
        transport = spec.get("transport", {})
        if any(transport.get(direction, {}).get("kind") != "redpanda"
               or not transport[direction].get("topic")
               or not transport[direction].get("message_key")
               or not transport[direction].get("payload_schema")
               or transport[direction].get("serialization") != "json_utf8"
               for direction in ("input", "output")):
            raise GraphError(f"Invalid signal transport: {key}")
        if transport["input"]["message_key"] != "data." + collection["record_identity_field"]:
            raise GraphError(f"Invalid signal message key: {key}")
        guidance = spec.get("implementation_guidance", {})
        stages = guidance.get("stages")
        if (guidance.get("status") != "preferred_stack_for_design"
                or not isinstance(guidance.get("target_platform"), str)
                or not guidance["target_platform"].strip()
                or not isinstance(guidance.get("decision_rule"), str)
                or not guidance["decision_rule"].strip()
                or not isinstance(stages, list) or not stages
                or any(not isinstance(item, dict) for item in stages)
                or len({item.get("stage") for item in stages}) != len(stages)
                or not any(item.get("stage") == "calculation" for item in stages)
                or any(not all(isinstance(item.get(field), str) and item[field].strip()
                               for field in ("stage", "product", "preferred_runtime",
                                             "component_candidate", "candidate_status"))
                       for item in stages)
                or not isinstance(guidance.get("open_implementation_decisions"), list)):
            raise GraphError(f"Invalid signal implementation guidance: {key}")

    def list_signals(self, graph):
        return [{"signal_key": key, "version": spec["version"],
                 "graph_node_id": (node or {}).get("id"),
                 "name": spec["graph_node_name"],
                 "design_status": spec["design_status"]}
                for key, spec in self.signals.items()
                for node in [graph.find_signal_key(key)]]

    def package(self, graph, signal_id):
        node = graph.find_signal_key(signal_id)
        if not node:
            node = graph.get_node(signal_id)
        key = node["signal_key"]
        spec = self.signals.get(key)
        if not spec:
            raise GraphError("Signal has no versioned execution contract")
        operation = self.source_contracts.operations[spec["collection"]["operation_id"]]
        source_node = graph.find_name(operation["id"])
        full = graph.graph()
        node_ids = {node["id"]}
        frontier = {node["id"]}
        while frontier:
            parents = {edge["upstream_id"] for edge in full["edges"]
                       if edge["downstream_id"] in frontier} - node_ids
            node_ids.update(parents)
            frontier = parents
        nodes = [item for item in full["nodes"] if item["id"] in node_ids]
        edges = [item for item in full["edges"] if item["upstream_id"] in node_ids
                 and item["downstream_id"] in node_ids]
        edge_ids = {item["id"] for item in edges}
        fields = [item for item in full["fields"] if item["node_id"] in node_ids]
        usages = [item for item in full["field_usages"] if item["edge_id"] in edge_ids]
        requirements = [item for item in full["requirements"] if item["node_id"] in node_ids]
        issues = []
        expected_text = {"name": spec["graph_node_name"],
                         "decision_question": spec["question_zh"],
                         "definition": spec["interpretation_zh"],
                         "validation_plan": spec["validation"]["plan_zh"],
                         **spec["graph_display"]}
        for field_name, expected in expected_text.items():
            if node[field_name] != expected:
                issues.append(f"Graph text differs from the published contract: {field_name}")
        if not source_node or source_node["id"] not in node_ids:
            issues.append("Source operation is not connected to the signal")
        source_edge = next((edge for edge in edges if source_node
                            and edge["upstream_id"] == source_node["id"]
                            and edge["downstream_id"] == node["id"]), None)
        expected_transport = spec["transport"]["input"]
        if not source_edge or any(source_edge[actual] != expected_transport[planned]
                                  for actual, planned in (("transport_kind", "kind"),
                                                          ("transport_topic", "topic"),
                                                          ("transport_key", "message_key"),
                                                          ("payload_schema", "payload_schema"))):
            issues.append("Input transport does not match the signal contract")
        consumed_fields = []
        for item in spec["inputs"]:
            catalog_id = f"source-contracts.v1::{operation['id']}::{item['upstream_path']}"
            source_field = next((field for field in fields
                                 if field["catalog_field_id"] == catalog_id), None)
            target_field = next((field for field in fields if field["node_id"] == node["id"]
                                 and field["name"] == item["name"]), None)
            usage = next((usage for usage in usages if source_edge and source_field
                          and target_field and usage["edge_id"] == source_edge["id"]
                          and usage["source_field_id"] == source_field["id"]
                          and usage["target_field_id"] == target_field["id"]), None)
            if not usage:
                issues.append(f"Input is not mapped on the graph: {item['name']}")
            consumed_fields.append({"usage_reference": f"R{usage['reference_number']:03d}" if usage else None,
                                    "upstream_path": item["upstream_path"],
                                    "message_path": item["message_path"],
                                    "consumer_field": item["name"],
                                    "type": item["type"],
                                    "required": item["required"]})
        output_names = {field["name"] for field in fields if field["node_id"] == node["id"]}
        for item in spec["output"]["fields"]:
            if item["name"] not in output_names:
                issues.append(f"Output field is not defined on the graph: {item['name']}")
        for item in requirements:
            if item["source_field_id"] is None:
                issues.append(f"Data requirement is unmatched: {item['name']}")
        def pick(item, names):
            return {name: item[name] for name in names if name in item}

        exported_nodes = [pick(item, ("id", "reference_number", "signal_key", "name", "type",
                                      "definition", "formula", "decision_question", "observation_window",
                                      "trigger_rule", "validation_plan", "validation_evidence",
                                      "rationale", "caveats", "notes", "workflow_lane")) for item in nodes]
        exported_edges = [pick(item, ("id", "reference_number", "upstream_id", "downstream_id",
                                      "rationale", "transformation", "transport_kind", "transport_topic",
                                      "transport_key", "payload_schema", "transport_headers")) for item in edges]
        exported_fields = [pick(item, ("id", "node_id", "name", "data_type", "definition",
                                       "unit", "normalization_rule", "catalog_field_id")) for item in fields]
        exported_usages = [pick(item, ("id", "reference_number", "edge_id", "source_field_id",
                                       "target_field_id", "usage_note")) for item in usages]
        exported_requirements = [pick(item, ("id", "node_id", "name", "purpose",
                                             "source_field_id")) for item in requirements]
        connection_contracts = []
        if source_edge:
            connection_contracts.append({
                "reference": f"L{source_edge['reference_number']:03d}",
                "edge_id": source_edge["id"],
                "producer": {"node_id": source_node["id"], "node_name": source_node["name"],
                             "role": "planned_crawler"},
                "transport": spec["transport"]["input"],
                "payload": spec["input_message"],
                "declared_upstream_field_inventory": [
                    {**pick(field, ("path", "type", "evidence", "condition_zh")),
                     "message_path": "data." + field["path"]}
                    for field in operation["fields"]],
                "downstream_node": {"node_id": node["id"], "node_name": node["name"]},
                "evidence_status": "design_only_no_emitted_message_verified",
            })
        processor_contract = {
            "node_id": node["id"],
            "node_name": node["name"],
            "input_line_reference": f"L{source_edge['reference_number']:03d}" if source_edge else None,
            "input_topic": spec["transport"]["input"]["topic"],
            "consumed_fields": consumed_fields,
            "processing": spec["processing"],
            "output": {"transport": spec["transport"]["output"],
                       "record_type": spec["output"]["record_type"],
                       "fields": spec["output"]["fields"]},
            "evidence_status": "design_only_no_calculation_verified",
        }
        body = {
            "package_version": "signal-package.v2",
            "signal_key": key,
            "signal_version": spec["version"],
            "signal_contract_revision": self.revision,
            "source_contract_revision": self.source_contracts.contract["revision"],
            "definition": spec,
            "source_contract": self.source_contracts.get_operation(operation["id"]),
            "connection_contracts": connection_contracts,
            "processor_contract": processor_contract,
            "design_graph": {"signal_node": next(item for item in exported_nodes
                                                  if item["id"] == node["id"]),
                             "nodes": exported_nodes, "edges": exported_edges,
                             "fields": exported_fields, "field_usages": exported_usages,
                             "requirements": exported_requirements},
            "implementation_readiness": {"status": "ready" if not issues else "incomplete",
                                         "issues": issues},
        }
        reports = graph.get_signal_reports(key)
        latest = reports[0] if reports else None
        executable_revision = revision_of({
            "package_version": body["package_version"],
            "definition": spec,
            "source_contract_revision": body["source_contract_revision"],
        })
        return {**body, "revision": executable_revision,
                "runtime_evidence": {
                    "status": "reported" if latest else "not_provided",
                    "latest_report_id": latest["id"] if latest else None,
                    "signal_validated": False,
                    "emitted_record_sample_reported": bool(
                        latest and latest["source_run_id"] and latest["emitted_record_sample_ref"]),
                    "crawler_records_verified": False,
                }}

    def connection(self, graph, edge_id):
        edge = graph.get_edge(edge_id)
        node = graph.get_node(edge["downstream_id"])
        if not node["signal_key"]:
            raise GraphError("Connection has no versioned signal contract")
        package = self.package(graph, node["id"])
        connection = next((item for item in package["connection_contracts"]
                           if item["edge_id"] == edge_id), None)
        if not connection:
            raise GraphError("Connection is not described by this signal contract")
        return {"package_revision": package["revision"],
                "implementation_readiness": package["implementation_readiness"],
                "connection": connection}

    def processor(self, graph, node_id):
        node = graph.get_node(node_id)
        if not node["signal_key"]:
            raise GraphError("Node has no versioned signal contract")
        package = self.package(graph, node_id)
        return {"package_revision": package["revision"],
                "implementation_readiness": package["implementation_readiness"],
                "processor": package["processor_contract"]}
