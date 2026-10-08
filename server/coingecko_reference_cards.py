"""Add code-reference cards once, without replacing the user's saved designs."""
import json
from pathlib import Path

CATALOG = Path(__file__).resolve().parent.parent / "catalog/coingecko-implemented-signals.v1.json"
MARKER = "coingecko_implementation_reference_cards_v1"


def ensure_coingecko_reference_cards(service):
    if service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    source = service.find_name("coingecko.coins_markets")
    if not source:
        return
    with service.db:
        nodes = {}
        for index, item in enumerate(catalog["topics"] + catalog["cards"]):
            node = service.find_name(item["name"])
            if not node:
                node = service.create_node({
                    "name": item["name"], "type": item["type"],
                    "definition": item.get("definition", item.get("condition", "")),
                    "formula": item.get("algorithm", ""),
                    "caveats": catalog["evidence_note"],
                    "notes": f"catalog/coingecko-implemented-signals.v1.json · {catalog['source_revision']}",
                    "position_x": 1100 if index == 0 else 2200 if index == 1 else 1650,
                    "position_y": 1800 if index < 2 else 1300 + (index - 2) * 240,
                }, actor="implementation-reference", commit=False)
                for name in item.get("fields", item.get("output", {})):
                    service.create_field(node["id"], {"name": name, "data_type": "Unknown",
                        "definition": "fewunderstand 代码参考字段，非运行观察"},
                        actor="implementation-reference", commit=False)
            nodes[item["name"]] = node
        input_node, output_node = [nodes[item["name"]] for item in catalog["topics"]]
        pairs = [(source, input_node)]
        for item in catalog["cards"]:
            pairs.extend([(input_node, nodes[item["name"]]), (nodes[item["name"]], output_node)])
        for upstream, downstream in pairs:
            if not service.db.execute("SELECT 1 FROM edges WHERE upstream_id=? AND downstream_id=?",
                                      (upstream["id"], downstream["id"])).fetchone():
                service.create_edge({"upstream_id": upstream["id"], "downstream_id": downstream["id"],
                    "rationale": "fewunderstand 代码参考路径；包含前置采集/身份处理，不代表已观察运行。"},
                    actor="implementation-reference", commit=False)
        service.db.execute("INSERT INTO schema_meta(key,value) VALUES (?,?)", (MARKER, "1"))
