"""Install the approved design once; this does not run a collector or score assets."""
import json
from pathlib import Path
from leaderboard_algorithms import _fields

CATALOG = Path(__file__).resolve().parent.parent / "catalog/coingecko-trending-contribution.v1.json"
MARKER = "coingecko_trending_contribution_v1"
ACTOR = "coingecko-trending-design"


def ensure_coingecko_trending(service):
    if service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    dependencies = [catalog["source"], "asset_identifiers", "assets", catalog["downstream"]]
    nodes = {name: service.find_name(name) for name in dependencies}
    if not all(nodes.values()):
        return  # No partial install; retry after dependencies exist.
    with service.db:
        # Materialize only consumed catalog declarations for field-usage links.
        # These are schemas, never observed asset records.
        business = json.loads((CATALOG.parent / "business-tables.v1.json").read_text())["tables"]
        for name, wanted in [("asset_identifiers", ["source_namespace", "external_identifier", "asset_id"]),
                             ("assets", ["asset_id", "name"])]:
            _fields(service, nodes[name], [{**column, "data_type": column["type"]}
                for column in business[name]["columns"] if column["name"] in wanted])
        spec = catalog["node"]
        card = service.find_name(spec["name"])
        if not card:
            card = service.create_node({**spec, "position_x": 1400, "position_y": -1450,
                "caveats": catalog["runtime_status_zh"],
                "notes": "catalog/coingecko-trending-contribution.v1.json · " + catalog["rationale_url"]},
                actor=ACTOR, commit=False)
        for node, fields in [(nodes[catalog["source"]], catalog["source_fields"]), (card, catalog["output_fields"])]:
            existing = {field["name"] for field in service.get_fields(node["id"])}
            for field in fields:
                if field["name"] not in existing:
                    service.create_field(node["id"], field, actor=ACTOR, commit=False)
        for upstream, downstream, note in [
            (nodes[catalog["source"]], card, "默认15币与采集槽/原始快照引用；同轮冻结首次有效成功快照。"),
            (nodes["asset_identifiers"], card, "按coingecko稳定coin ID唯一映射；缺失或冲突待处理，不猜ticker。"),
            (nodes["assets"], card, "验证内部资产存在并复制可选名称快照；不在此建档。"),
            (card, nodes[catalog["downstream"]], "持久判定后交付七项评分决定；事件键/首次入账时间由发布步骤生成。"),
        ]:
            existing = service.db.execute("SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?",
                (upstream["id"], downstream["id"])).fetchone()
            edge = existing or service.create_edge({"upstream_id": upstream["id"], "downstream_id": downstream["id"],
                "rationale": note}, actor=ACTOR, commit=False)
            # Record precisely which source fields are consumed, without manufacturing
            # target fields on the shared publisher or changing its existing design.
            wanted = ([field["name"] for field in catalog["output_fields"]] if upstream["id"] == card["id"]
                else [field["name"] for field in catalog["source_fields"]] if upstream["name"] == catalog["source"]
                else ["source_namespace", "external_identifier", "asset_id"] if upstream["name"] == "asset_identifiers"
                else ["asset_id", "name"])
            used = {usage["source_field_id"] for usage in service.get_field_usages(edge["id"])}
            for field in service.get_fields(upstream["id"]):
                if field["name"] in wanted and field["id"] not in used:
                    service.create_field_usage(edge["id"], {"source_field_id": field["id"], "usage_note": note},
                        actor=ACTOR, commit=False)
        service.db.execute("INSERT INTO schema_meta(key,value) VALUES (?,?)", (MARKER, "1"))
