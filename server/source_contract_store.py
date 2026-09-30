"""Application-owned upstream contracts for crawler planning and implementation."""

import hashlib
import json
from pathlib import Path

from graph_service import GraphError

DEFAULT_CONTRACT = Path(__file__).resolve().parent.parent / "catalog" / "source-contracts.v1.json"


class SourceContractStore:
    def __init__(self, path=DEFAULT_CONTRACT):
        self.contract = json.loads(Path(path).read_text(encoding="utf-8"))
        contract = self.contract
        if contract.get("catalog_version") != "source-contracts.v1" or contract.get("owner") != "SignalStudio":
            raise GraphError("Unsupported source contract")
        body = {key: value for key, value in contract.items() if key != "revision"}
        encoded = json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        revision = "sha256:" + hashlib.sha256(encoded).hexdigest()
        if contract.get("revision") != revision:
            raise GraphError("Source contract revision does not match its contents")
        sources = contract.get("sources")
        operations = contract.get("operations")
        resources = contract.get("resources")
        if (not isinstance(sources, list) or not isinstance(operations, list)
                or not isinstance(resources, list)):
            raise GraphError("Invalid source contract lists")
        self.sources = {source["id"]: source for source in sources}
        self.operations = {operation["id"]: operation for operation in operations}
        self.resources = {resource["id"]: resource for resource in resources}
        if (len(self.sources) != len(sources) or len(self.operations) != len(operations)
                or len(self.resources) != len(resources)
                or set(self.operations).intersection(self.resources)
                or len(sources) != contract.get("source_count")
                or len(operations) != contract.get("operation_count")
                or len(resources) != contract.get("resource_count")):
            raise GraphError("Duplicate or inconsistent source contract identity")
        for operation in operations:
            if operation["source_id"] not in self.sources:
                raise GraphError("Operation source does not exist")
            if not operation["documentation_url"].startswith("https://"):
                raise GraphError("Operation needs an HTTPS documentation URL")
            paths = [field["path"] for field in operation["fields"]]
            if len(set(paths)) != len(paths):
                raise GraphError("Duplicate operation field path")
            self._validate_inputs(operation)
            self._validate_collection_plan(operation)
        for resource in resources:
            if resource["source_id"] not in self.sources:
                raise GraphError("Resource source does not exist")
            if not resource["documentation_url"].startswith("https://"):
                raise GraphError("Resource needs an HTTPS documentation URL")
            if not resource["uri"].startswith("kaito://"):
                raise GraphError("Invalid Kaito resource URI")
            self._validate_inputs(resource)

    @staticmethod
    def _validate_inputs(item):
        inputs = item.get("inputs")
        coverage = item.get("input_coverage")
        if not isinstance(inputs, list) or coverage not in {
            "official_documentation", "live_mcp_input_schema", "official_mcp_resource",
            "design_input", "live_page_controls", "unverified",
        }:
            raise GraphError("Invalid source input contract")
        names = [field.get("name") for field in inputs if isinstance(field, dict)]
        if (len(names) != len(inputs) or len(names) != len(set(names))
                or any(not isinstance(name, str) or not name for name in names)
                or any(not isinstance(field.get("required"), bool) for field in inputs)):
            raise GraphError("Invalid source input fields")
        if coverage == "unverified" and inputs:
            raise GraphError("Unverified inputs cannot claim exact parameters")

    @staticmethod
    def _validate_collection_plan(operation):
        plan = operation.get("collection_plan")
        if plan is None:
            return
        if not isinstance(plan, dict) or set(plan) != {
            "mode", "interval_minutes", "status", "evidence_status"
        }:
            raise GraphError("Invalid source collection plan")
        mode, interval = plan["mode"], plan["interval_minutes"]
        if (mode not in {"scheduled", "event_driven", "on_demand"}
                or (mode == "scheduled" and (type(interval) is not int or interval <= 0))
                or (mode != "scheduled" and interval is not None)
                or plan["status"] != "user_defined_plan"
                or plan["evidence_status"] != "design_only_no_runtime_verification"):
            raise GraphError("Invalid source collection cadence")

    def full(self):
        return self.contract

    def meta(self):
        return {key: self.contract[key] for key in
                ("catalog_version", "owner", "direction", "revision", "source_count", "operation_count", "resource_count")}

    def get_operation(self, operation_id):
        operation = self.operations.get(operation_id)
        if not operation:
            raise GraphError("Source contract operation not found")
        return {"source": self.sources[operation["source_id"]], "operation": operation,
                "revision": self.contract["revision"]}

    def get_resource(self, resource_id):
        resource = self.resources.get(resource_id)
        if not resource:
            raise GraphError("Source contract resource not found")
        return {"source": self.sources[resource["source_id"]], "resource": resource,
                "revision": self.contract["revision"]}

    def get_field_definition(self, field_id):
        prefix = "source-contracts.v1::"
        if not field_id.startswith(prefix):
            raise GraphError("Invalid upstream contract field")
        operation_id, separator, path = field_id[len(prefix):].partition("::")
        operation = self.operations.get(operation_id)
        if not separator or not operation:
            raise GraphError("Upstream contract field not found")
        selected = next((field for field in operation["fields"] if field["path"] == path), None)
        if not selected:
            raise GraphError("Upstream contract field not found")
        return {"id": operation_id, "contract_source": True}, {
            "id": field_id, "path": path, "type": selected["type"],
            "plain_meaning": selected.get("purpose_zh") or selected["label_zh"],
        }
