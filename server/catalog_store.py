"""Read-only, searchable view of a validated Raw Materials Catalog snapshot."""

import csv
import io
import json
import re
from pathlib import Path

from catalog_guidance import field_guidance
from graph_service import GraphError

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SNAPSHOT = ROOT / "catalog" / "raw-materials.v2.json"
DEFAULT_SCHEMA = ROOT / "catalog" / "raw-materials.v2.schema.json"
DEFAULT_DISPLAY = ROOT / "catalog" / "catalog-display.zh.json"
DEFAULT_EXAMPLE_EVIDENCE = ROOT / "catalog" / "catalog-example-evidence.json"
DEFAULT_RECORD_EXAMPLES = ROOT / "catalog" / "catalog-record-examples.json"
DEFAULT_KAITO_MCP_OBSERVED = ROOT / "catalog" / "kaito-mcp-observed.json"
DEFAULT_SOURCE_PROVENANCE = ROOT / "catalog" / "source-provenance.json"
DEFAULT_DEXSCREENER_SAMPLE = ROOT / "catalog" / "dexscreener-upstream-sample.json"
TRANSLATION_COLUMNS = ("source_label_cn", "display_zh", "role_zh", "purpose_zh", "use_case_zh",
                       "example_value", "example_status",
                       "example_url", "example_retrieved_at", "record_type_en", "record_type_zh",
                       "english_path", "api_id", "label_source", "kind", "source_id",
                       "spider_id", "entity_id", "source_revision")


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise GraphError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def _read_json(path):
    path = Path(path)
    if path.stat().st_size > 20_000_000:
        raise GraphError("Catalog file is too large")
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=_unique_object)


def _validate(value, schema, root, location="$", depth=0):
    if depth > 40:
        raise GraphError("Catalog schema is too deep")
    if "$ref" in schema:
        reference = schema["$ref"]
        if not reference.startswith("#/$defs/") or reference[8:] not in root.get("$defs", {}):
            raise GraphError("Unsupported catalog schema reference")
        return _validate(value, root["$defs"][reference[8:]], root, location, depth + 1)
    if "anyOf" in schema:
        for alternative in schema["anyOf"]:
            try:
                _validate(value, alternative, root, location, depth + 1)
                break
            except GraphError:
                continue
        else:
            raise GraphError(f"Invalid catalog value at {location}")
    kind = schema.get("type")
    kinds = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
             "string": lambda v: isinstance(v, str), "boolean": lambda v: isinstance(v, bool),
             "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
             "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
             "null": lambda v: v is None}
    if kind and (kind not in kinds or not kinds[kind](value)):
        raise GraphError(f"Invalid catalog type at {location}")
    if "const" in schema and value != schema["const"]:
        raise GraphError(f"Invalid catalog constant at {location}")
    if "enum" in schema and value not in schema["enum"]:
        raise GraphError(f"Invalid catalog enum at {location}")
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0) or len(value) > schema.get("maxLength", float("inf")):
            raise GraphError(f"Invalid catalog string length at {location}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise GraphError(f"Invalid catalog string pattern at {location}")
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", float("inf")):
            raise GraphError(f"Invalid catalog array length at {location}")
        if "items" in schema:
            for index, item in enumerate(value):
                _validate(item, schema["items"], root, f"{location}[{index}]", depth + 1)
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        if any(key not in value for key in schema.get("required", [])):
            raise GraphError(f"Missing catalog property at {location}")
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):
            raise GraphError(f"Unexpected catalog property at {location}")
        for key, item in value.items():
            if key in properties:
                _validate(item, properties[key], root, f"{location}.{key}", depth + 1)


def _page(limit, offset):
    try:
        limit, offset = int(limit), int(offset)
    except (ValueError, TypeError):
        raise GraphError("Invalid catalog page")
    if not 1 <= limit <= 100 or offset < 0:
        raise GraphError("Invalid catalog page")
    return limit, offset


def _path_value(record, path):
    current = record
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return False, None
        current = current[part]
    return True, current


def _unscoped_conditional_count(fields):
    """Generic Kaito metric candidates are not assigned to a particular tool."""
    return sum(field.get("condition") == "metric present in tool row" for field in fields)


class CatalogStore:
    def __init__(self, snapshot_path=DEFAULT_SNAPSHOT, schema_path=DEFAULT_SCHEMA):
        schema = _read_json(schema_path)
        snapshot = _read_json(snapshot_path)
        _validate(snapshot, schema, schema)
        if snapshot.get("catalog_version") != "raw-materials.v2":
            raise GraphError("Unsupported catalog version")
        self.snapshot = snapshot
        self.sources = {item["id"]: item for item in snapshot["sources"]}
        self.spider_info = {item["id"]: item for item in snapshot["spiders"]}
        self.entities = {item["id"]: item for item in snapshot["entities"]}
        self.fields = {item["id"]: item for item in snapshot["fields"]}
        provenance = _read_json(DEFAULT_SOURCE_PROVENANCE)
        if (provenance["snapshot_revision"] != snapshot["snapshot_git_revision"]
                or set(provenance["sources"]) != set(self.sources)):
            raise GraphError("Source provenance does not match the V2 snapshot")
        self.source_provenance = provenance["sources"]
        self.dexscreener_sample = _read_json(DEFAULT_DEXSCREENER_SAMPLE)
        if not isinstance(self.dexscreener_sample.get("pair"), dict):
            raise GraphError("Invalid DEX Screener pair sample")
        self.kaito_mcp_observed = _read_json(DEFAULT_KAITO_MCP_OBSERVED)
        self.kaito_mcp_tools = self.kaito_mcp_observed["tools"]
        self.kaito_mcp_by_entity = {}
        for tool in self.kaito_mcp_tools:
            if tool["entity_id"]:
                self.kaito_mcp_by_entity.setdefault(tool["entity_id"], []).append(tool)
        self.entity_operations = {entity_id: [] for entity_id in self.entities}
        for operation in snapshot["operations"]:
            if operation["entity_id"] in self.entity_operations:
                self.entity_operations[operation["entity_id"]].append(operation["id"].rsplit(".", 1)[-1])
        display = _read_json(DEFAULT_DISPLAY)
        self.record_labels_cn = display["record_types"]
        self.field_labels_cn = display["field_paths"]
        evidence = _read_json(DEFAULT_EXAMPLE_EVIDENCE)
        self.example_samples = {}
        self.upstream_responses = {}
        if evidence["source_revision"] == snapshot["source_revision"]:
            for sample in evidence["samples"]:
                for field_id, response_key in sample["field_paths"].items():
                    if field_id not in self.fields or response_key not in sample["response"]:
                        raise GraphError("Example evidence does not match the catalog or response")
                    self.example_samples[field_id] = {
                        "example_value": sample["response"][response_key],
                        "example_status": "upstream_api",
                        "example_url": sample["url"],
                        "example_retrieved_at": sample["retrieved_at"],
                    }
                    entity_id = self.fields[field_id]["entity_id"]
                    self.upstream_responses[entity_id] = {
                        "response": sample["response"], "url": sample["url"],
                        "retrieved_at": sample["retrieved_at"]}
        record_examples = _read_json(DEFAULT_RECORD_EXAMPLES)
        self.record_examples = {}
        if record_examples["source_revision"] == snapshot["snapshot_git_revision"]:
            for item in record_examples["examples"]:
                if item["entity_id"] not in self.entities or item["entity_id"] in self.record_examples:
                    raise GraphError("Invalid record example identity")
                self.record_examples[item["entity_id"]] = item
        for name, index in (("sources", self.sources), ("spiders", self.spider_info),
                            ("entities", self.entities), ("fields", self.fields)):
            if len(index) != len(snapshot[name]):
                raise GraphError("Duplicate catalog identity")
        self.spiders = {spider_id: [] for spider_id in self.spider_info}
        self.entity_fields = {entity_id: [] for entity_id in self.entities}
        for entity in snapshot["entities"]:
            if entity["spider_id"] not in self.spiders:
                raise GraphError("Unknown catalog spider")
            self.spiders[entity["spider_id"]].append(entity)
        for field in snapshot["fields"]:
            entity = self.entities.get(field["entity_id"])
            if (not entity or field["id"] != f'{entity["id"]}.{field["path"]}'
                    or field["spider_id"] != entity["spider_id"]):
                raise GraphError("Catalog field identity does not match its entity and path")
            self.entity_fields[entity["id"]].append(field)

    def _field_presentation(self, field):
        entity = self.entities[field["entity_id"]]
        guide = field_guidance(field, self.record_labels_cn.get(entity["id"], entity["record_type"]))
        sample = self.example_samples.get(field["id"])
        if sample is None:
            record = self.record_examples.get(entity["id"])
            found, value = _path_value(record["message"], field["path"]) if record else (False, None)
            if found:
                sample = {"example_value": value, "example_status": record["status"],
                          "example_url": record["source_url"], "example_retrieved_at": ""}
        if sample is None:
            sample = {"example_value": field["safe_example"],
                      "example_status": field["example_status"],
                      "example_url": "", "example_retrieved_at": ""}
        labels = {"upstream_api": ("上游 API 返回", "Upstream API response"),
                  "transformed_test_fixture": ("测试夹具转换结果", "Transformed test fixture"),
                  "synthetic": ("合成示例", "Synthetic example"),
                  "documented_format": ("格式示例", "Format example"),
                  "enum": ("固定取值", "Fixed value")}
        label_zh, label_en = labels.get(sample["example_status"], ("暂无已核实值", "No verified value"))
        return {**guide, **sample,
                "example": json.dumps(sample["example_value"], ensure_ascii=False)
                if sample["example_status"] != "unavailable" else None,
                "label_zh": label_zh, "label_en": label_en,
                "explanation_zh": guide["purpose_zh"],
                "explanation_en": field.get("plain_meaning") or field["path"]}

    def translation_rows(self):
        """One auditable English-to-Chinese display row per v2 identity."""
        rows = []
        for entity in sorted(self.entities.values(), key=lambda item: item["id"]):
            spider = self.spider_info[entity["spider_id"]]
            source = self.sources[spider["source_id"]]
            common = {"source_id": source["id"], "source_label_cn": source["label_cn"],
                      "spider_id": entity["spider_id"], "entity_id": entity["id"],
                      "record_type_en": entity["record_type"],
                      "record_type_zh": self.record_labels_cn.get(entity["id"], "")}
            rows.append({**common, "kind": "record_type", "api_id": entity["id"],
                         "english_path": entity["record_type"],
                         "display_zh": common["record_type_zh"], "label_source": "app",
                         "role_zh": "记录类型", "purpose_zh": "这类记录包含下列可展开的字段定义。",
                         "use_case_zh": "先选择记录类型，再查看字段用途与返回样本。",
                         "example_value": None, "example_status": "unavailable",
                         "example_url": "", "example_retrieved_at": ""})
            for field in sorted(self.entity_fields[entity["id"]], key=lambda item: item["path"]):
                official = field.get("label_cn")
                presentation = self._field_presentation(field)
                example = {key: presentation[key] for key in
                           ("example_value", "example_status", "example_url", "example_retrieved_at")}
                rows.append({**common, "kind": "field", "api_id": field["id"],
                             "english_path": field["path"],
                             "display_zh": official or self.field_labels_cn.get(field["path"], ""),
                             "label_source": "v2" if official else "app",
                             **field_guidance(field, common["record_type_zh"]), **example})
        return rows

    def list_translations(self, query="", source="", kind="", limit=100, offset=0):
        limit, offset = _page(limit, offset)
        if source and source not in self.sources:
            raise GraphError("Unknown catalog source")
        if kind and kind not in ("record_type", "field"):
            raise GraphError("Unknown translation kind")
        term = query.strip().casefold()
        rows = [row for row in self.translation_rows()
                if (not source or row["source_id"] == source)
                and (not kind or row["kind"] == kind)
                and (not term or term in " ".join(str(value) for value in row.values()).casefold())]
        page_items = rows[offset:offset + limit]
        return {"total": len(rows), "limit": limit, "offset": offset,
                "items": page_items,
                "record_examples": {entity_id: self.record_examples[entity_id]
                                    for entity_id in {row["entity_id"] for row in page_items}
                                    if entity_id in self.record_examples},
                "upstream_responses": {entity_id: self.upstream_responses[entity_id]
                                       for entity_id in {row["entity_id"] for row in page_items}
                                       if entity_id in self.upstream_responses},
                "source_revision": self.snapshot["source_revision"]}

    def translation_csv(self):
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=TRANSLATION_COLUMNS, lineterminator="\n")
        writer.writeheader()
        for row in self.translation_rows():
            value = row["example_value"]
            writer.writerow({**row, "example_value": value if isinstance(value, str) else
                             json.dumps(value, ensure_ascii=False) if value is not None else "",
                             "source_revision": self.snapshot["source_revision"]})
        return output.getvalue()

    def _view_field(self, field):
        entity = self.entities[field["entity_id"]]
        return {**field, "label": field["path"],
                "presentation": self._field_presentation(field),
                "entity_name": entity["record_type"],
                "entity_label_cn": self.record_labels_cn.get(entity["id"]),
                "display_label_cn": self.field_labels_cn.get(field["path"])}

    def _field_matches(self, field, term):
        return term in " ".join(str(field.get(key) or "") for key in
                                ("id", "path", "label_cn", "plain_meaning", "strategy_use",
                                 "selectable_reason")).casefold() or term in " ".join((
                                     self.field_labels_cn.get(field["path"], ""),
                                     self._field_presentation(field)["purpose_zh"])).casefold()

    def present_graph(self, graph):
        """Attach v2 display metadata to fields already used on the graph."""
        for node in graph.get("nodes", []):
            if node.get("is_catalog_source"):
                node["catalog_record_label_cn"] = self.record_labels_cn.get(node["name"])
        for field in graph["fields"]:
            field_id = field.get("catalog_field_id")
            if not field_id:
                continue
            current = self.fields.get(field_id)
            if current:
                entity = self.entities[current["entity_id"]]
                field.update(catalog_status="current", catalog_selectable=current["selectable"],
                             catalog_path=current["path"], catalog_label_cn=current["label_cn"],
                             catalog_display_label_cn=self.field_labels_cn.get(current["path"]),
                             catalog_label_en=current["path"],
                             catalog_entity_name=entity["record_type"],
                             catalog_entity_label_cn=self.record_labels_cn.get(entity["id"]),
                             catalog_visibility="show" if current["selectable"] else "internal",
                             presentation=self._field_presentation(current))
        return graph

    def get_field_definition(self, field_id):
        field = self.fields.get(field_id)
        if not field:
            raise GraphError("Catalog field not found")
        if not field["selectable"]:
            raise GraphError("Catalog field is not approved for signal design")
        entity = self.entities[field["entity_id"]]
        return {**entity, "entity_id": entity["id"],
                "declared_entity_id": entity["record_type"]}, self._view_field(field)

    def meta(self):
        return {"contract_version": self.snapshot["catalog_version"],
                "source_revision": self.snapshot["source_revision"],
                "snapshot_git_revision": self.snapshot["snapshot_git_revision"],
                "source_count": len(self.sources),
                "operation_count": len(self.snapshot["operations"]),
                "entity_count": len(self.entities), "field_count": len(self.fields),
                "selectable_field_count": sum(field["selectable"] for field in self.fields.values()),
                "spider_count": len(self.spider_info), "sources": sorted(self.sources),
                "statuses": sorted({spider["contract_status"] for spider in self.spider_info.values()}),
                "mode": "offline_snapshot"}

    def list_spiders(self, query="", limit=30, offset=0, visible_only=False):
        limit, offset = _page(limit, offset)
        term = query.strip().casefold()
        items = []
        for spider_id, spider in sorted(self.spider_info.items()):
            entities = self.spiders[spider_id]
            fields = [field for entity in entities for field in self.entity_fields[entity["id"]]
                      if not visible_only or field["selectable"]]
            source = self.sources[spider["source_id"]]
            haystack = " ".join([spider_id, source["label_cn"],
                                  *(entity["record_type"] for entity in entities),
                                  *(self.record_labels_cn.get(entity["id"], "") for entity in entities)])
            matches = [field for field in fields if self._field_matches(field, term)]
            if term and term not in haystack.casefold() and not matches:
                continue
            items.append({"spider_id": spider_id, "sources": [spider["source_id"]],
                          "source_label_cn": source["label_cn"], "entity_count": len(entities),
                          "field_count": len(fields), "matching_field_count": len(matches),
                          "mcp_tool_count": len(self.kaito_mcp_tools) if spider_id == "kaito-social-spider" else 0,
                          "unscoped_conditional_count": _unscoped_conditional_count(fields)})
        return {"total": len(items), "limit": limit, "offset": offset,
                "items": items[offset:offset + limit],
                "source_revision": self.snapshot["source_revision"]}

    def get_spider(self, spider_id, query="", limit=30, offset=0, visible_only=False,
                   entity_id="", include_unscoped=True):
        limit, offset = _page(limit, offset)
        spider = self.spider_info.get(spider_id)
        if not spider:
            raise GraphError("Catalog spider not found")
        term = query.strip().casefold()
        entities = self.spiders[spider_id]
        if entity_id and entity_id not in {entity["id"] for entity in entities}:
            raise GraphError("Catalog record type not found for crawler")
        declared = [field for entity in entities if not entity_id or entity["id"] == entity_id
                    for field in self.entity_fields[entity["id"]]]
        available = [field for field in declared
                     if (not visible_only or field["selectable"])
                     and (include_unscoped or field.get("condition") != "metric present in tool row")]
        fields = [field for field in available if not term or self._field_matches(field, term)]
        return {"spider_id": spider_id, "sources": [spider["source_id"]],
                "entity_count": len(entities),
                "entities": [{"entity_id": entity["id"], "entity_name": entity["record_type"],
                              "label_cn": self.record_labels_cn.get(entity["id"]),
                              "operation_names": self.entity_operations[entity["id"]],
                              "observed_upstream_field_count": self._observed_upstream_count(entity["id"]),
                              "field_count": sum((not visible_only or field["selectable"])
                                                 and (include_unscoped or field.get("condition") !=
                                                      "metric present in tool row")
                                                 for field in self.entity_fields[entity["id"]]),
                              "unscoped_conditional_count": _unscoped_conditional_count(
                                  self.entity_fields[entity["id"]])}
                             for entity in entities],
                "field_count": len(available), "total": len(fields), "limit": limit, "offset": offset,
                "declared_field_count": len(declared),
                "unscoped_conditional_count": _unscoped_conditional_count(declared),
                "fields": [self._view_field(field) for field in fields[offset:offset + limit]],
                "record_examples": {entity["id"]: self.record_examples[entity["id"]]
                                    for entity in entities if (not entity_id or entity["id"] == entity_id)
                                    and entity["id"] in self.record_examples},
                "upstream_responses": {entity["id"]: self.upstream_responses[entity["id"]]
                                       for entity in entities if (not entity_id or entity["id"] == entity_id)
                                       and entity["id"] in self.upstream_responses},
                "mcp_observed": ({**self.kaito_mcp_observed,
                                   "tools": [tool for tool in self.kaito_mcp_tools
                                             if not entity_id or tool["entity_id"] == entity_id]}
                                  if spider_id == "kaito-social-spider" else None),
                "source_revision": self.snapshot["source_revision"]}

    def _observed_upstream_count(self, entity_id):
        tools = self.kaito_mcp_by_entity.get(entity_id, [])
        if tools and any(tool["sample_status"] == "observed" for tool in tools):
            return len({field["path"] for tool in tools for field in tool["fields"]})
        sample = self.upstream_responses.get(entity_id)
        response = sample.get("response") if sample else None
        return len(response) if isinstance(response, dict) else None

    def list_entities(self, query="", source="", status="", limit=30, offset=0):
        limit, offset = _page(limit, offset)
        if source and source not in self.sources:
            raise GraphError("Unknown catalog source")
        if status and status not in self.meta()["statuses"]:
            raise GraphError("Unknown catalog status")
        term = query.strip().casefold()
        items = []
        for entity in self.snapshot["entities"]:
            spider = self.spider_info[entity["spider_id"]]
            if source and spider["source_id"] != source:
                continue
            if status and spider["contract_status"] != status:
                continue
            fields = self.entity_fields[entity["id"]]
            matches = sum(self._field_matches(field, term) for field in fields) if term else len(fields)
            if term and term not in " ".join((entity["id"], entity["record_type"],
                                               spider["source_id"],
                                               self.record_labels_cn.get(entity["id"], ""))).casefold() and not matches:
                continue
            items.append({"entity_id": entity["id"], "source": spider["source_id"],
                          "spider_id": entity["spider_id"], "record_type": entity["record_type"],
                          "label_cn": self.record_labels_cn.get(entity["id"]),
                          "operation_names": self.entity_operations[entity["id"]],
                          "output_topic": None, "contract_status": spider["contract_status"],
                          "observed_status": entity["states"]["observed"],
                          "observed_upstream_field_count": self._observed_upstream_count(entity["id"]),
                          "field_count": len(fields), "matching_field_count": matches,
                          "unscoped_conditional_count": _unscoped_conditional_count(fields)})
        return {"total": len(items), "limit": limit, "offset": offset,
                "items": items[offset:offset + limit],
                "source_revision": self.snapshot["source_revision"]}

    def get_entity(self, entity_id, query="", limit=50, offset=0):
        limit, offset = _page(limit, offset)
        entity = self.entities.get(entity_id)
        if not entity:
            raise GraphError("Catalog entity not found")
        term = query.strip().casefold()
        fields = [field for field in self.entity_fields[entity_id]
                  if not term or self._field_matches(field, term)]
        source_id = self.spider_info[entity["spider_id"]]["source_id"]
        return {"entity": {**entity, "label_cn": self.record_labels_cn.get(entity_id),
                           "operation_names": self.entity_operations[entity_id],
                           "observed_upstream_field_count": self._observed_upstream_count(entity_id)},
                "source_provenance": self.source_provenance[source_id],
                "field_count": len(self.entity_fields[entity_id]),
                "unscoped_conditional_count": _unscoped_conditional_count(
                    self.entity_fields[entity_id]),
                "total": len(fields), "limit": limit, "offset": offset,
                "fields": [self._view_field(field) for field in fields[offset:offset + limit]],
                "record_example": self.record_examples.get(entity_id),
                "upstream_response": self.upstream_responses.get(entity_id),
                "dexscreener_upstream_sample": (self.dexscreener_sample
                    if entity["spider_id"] == "dexscreener" else None),
                "mcp_observed_tools": self.kaito_mcp_by_entity.get(entity_id, []),
                "mcp_observed_at": self.kaito_mcp_observed["observed_at"] if entity["spider_id"] == "kaito-social-spider" else None,
                "contract_version": self.snapshot["catalog_version"],
                "source_revision": self.snapshot["source_revision"]}
