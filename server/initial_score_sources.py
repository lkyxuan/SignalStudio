"""Install the approved table/processing design once. No runtime scoring."""
import json
from pathlib import Path

from graph_service import now
from leaderboard_algorithms import _fields

CATALOG = Path(__file__).resolve().parent.parent / "catalog/asset-initial-score-sources.v1.json"
MARKER = "initial_score_sources_v1"
ACTOR = "initial-score-source-design"


def ensure_initial_score_sources(service):
    if service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    # Locate existing numbered steps; don't manufacture asset processors on empty graphs.
    nodes = {ref: service.db.execute("SELECT * FROM nodes WHERE reference_number=?", (ref,)).fetchone()
             for ref in (3002, 3004, 3006, 3009, 4001)}
    if not all(nodes.values()):
        return
    with service.db:
        name = spec["table_name"]
        table = service.find_name(name)
        if table and table["type"] != name:
            raise ValueError("Initial score configuration name conflicts with an existing card")
        if not table:
            columns = json.loads((CATALOG.parent / "business-tables.v1.json").read_text())["tables"][name]["columns"]
            scorer = nodes[3009]
            table = service.create_node({"name": name, "type": name,
                "definition": "按发现来源配置首次建档分；仅保存配置，由 #3009 读取。",
                "workflow_lane": "shared", "caveats": spec["provenance_zh"],
                "notes": str(CATALOG.relative_to(CATALOG.parent.parent)) + " · " + spec["rationale_url"],
                "position_x": scorer["position_x"], "position_y": scorer["position_y"] - 260},
                actor="system", commit=False)
            _fields(service, table, [{**col, "data_type": col["type"]} for col in columns])
            service.db.execute("UPDATE nodes SET is_system_state=1 WHERE id=?", (table["id"],))
        # This approved migration changes only the scoring-owned text, never positions or other settings.
        before = service.get_node(nodes[3009]["id"])
        service.db.execute("UPDATE nodes SET definition=?,formula=?,updated_at=? WHERE id=?",
                           (spec["node"]["definition"], spec["node"]["formula"], now(), before["id"]))
        service._event(ACTOR, "update", "node", before["id"], before, service.get_node(before["id"]))
        source_field = {"name": "source_id", "data_type": "Text",
                        "label_zh": "采集链路携带的发现来源；独立于资产身份命名空间"}
        for ref in (4001, 3002):
            _fields(service, nodes[ref], [source_field])
        for upstream, downstream, wanted, note in [
            (nodes[4001], nodes[3002], ["source_id"], "随未命中结果传递发现来源；不是资产身份命名空间。"),
            (nodes[3002], nodes[3009], ["asset_id", "asset_name", "action", "source_id"], "首次建档结果携带发现来源；仅created可申请初始奖励。"),
            (table, nodes[3009], ["source_id", "initial_score", "rule_version", "half_life_minutes"], "按source_id读取初始贡献配置；无配置待处理，不猜分值。"),
        ]:
            edge = service.db.execute("SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?",
                (upstream["id"], downstream["id"])).fetchone()
            if not edge:
                edge = service.create_edge({"upstream_id": upstream["id"], "downstream_id": downstream["id"],
                    "rationale": note, "transport_kind": "direct"}, actor=ACTOR, commit=False)
            used = {usage["source_field_id"] for usage in service.get_field_usages(edge["id"])}
            for field in service.get_fields(upstream["id"]):
                if field["name"] in wanted and field["id"] not in used:
                    service.create_field_usage(edge["id"], {"source_field_id": field["id"], "usage_note": note},
                        actor=ACTOR, commit=False)
        service.db.execute("INSERT INTO schema_meta(key,value) VALUES (?,?)", (MARKER, "1"))
