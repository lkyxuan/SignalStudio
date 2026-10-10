"""Apply SS-48's approved Studio definitions once; never execute backend scoring."""
import copy
import json
from pathlib import Path

from card_model import CardModel, definition_refs, encoded
from graph_service import now

CATALOG = Path(__file__).resolve().parent.parent / "catalog"
MARKER = "score_rollup_event_scope_alignment_v1"
ACTOR = "score-rollup-contract-alignment"


def ensure_score_rollup_alignment(service):
    if service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone():
        return
    rollup = json.loads((CATALOG / "score-rollup.v1.json").read_text())
    tables = json.loads((CATALOG / "business-tables.v1.json").read_text())["tables"]
    scorer = service.find_name(rollup["node"]["name"])
    current = service.find_name(rollup["output_table"])
    if not scorer or not current:
        return  # Retry after the existing scoring cards have been installed.
    projection = service.find_name("supabase_asset_scores")
    model = CardModel(service)
    with service.db:
        before = service.get_node(scorer["id"])
        notes = json.loads(before["notes"] or "{}")
        # Merge only scoring-owned settings; unrelated instance settings survive.
        notes["contract_ref"] = "catalog/score-rollup.v1.json"
        notes.setdefault("configuration", {}).update(rollup["configuration"])
        notes.setdefault("implementation_reference", {}).update(rollup["implementation_reference"])
        formula = before["formula"].replace("每轮定时计算固定同一个 UTC 时刻", "每次事件或定时计算固定同一个 UTC 时刻")
        service.db.execute("UPDATE nodes SET definition=?,formula=?,notes=?,updated_at=? WHERE id=?",
            (rollup["node"]["definition"], formula, encoded(notes), now(), before["id"]))
        service._event(ACTOR, "update", "node", before["id"], before, service.get_node(before["id"]))

        before = service.get_node(current["id"])
        service.db.execute("UPDATE nodes SET definition=?,updated_at=? WHERE id=?",
            (tables[rollup["output_table"]]["purpose_zh"], now(), before["id"]))
        service._event(ACTOR, "update", "node", before["id"], before, service.get_node(before["id"]))

        for node in (current, projection):
            if not node:
                continue
            label = next(column["label_zh"] for column in tables[node["name"]]["columns"]
                         if column["name"] == "calculated_at")
            for field in service.get_fields(node["id"]):
                if field["name"] != "calculated_at" or field["definition"] == label:
                    continue
                service.db.execute("UPDATE node_fields SET definition=?,updated_at=? WHERE id=?",
                                   (label, now(), field["id"]))
                after = dict(service.db.execute("SELECT * FROM node_fields WHERE id=?", (field["id"],)).fetchone())
                service._event(ACTOR, "update", "node_field", field["id"], field, after)

        if model.enabled():
            for node in (scorer, current, projection):
                if not node:
                    continue
                before = model.contract(node["id"])
                config = copy.deepcopy(before["config"])
                refreshed = {ref["path"]: ref for ref in definition_refs(node)}
                # Refresh only approved module pins, preserving other references/settings.
                paths = {"catalog/score-rollup.v1.json", "catalog/business-tables.v1.json"}
                config["definition_refs"] = [refreshed.get(ref["path"], ref) if ref["path"] in paths else ref
                                             for ref in config["definition_refs"]]
                trigger_ref = config["trigger"].get("configuration_ref")
                if isinstance(trigger_ref, dict) and trigger_ref.get("path") in paths:
                    config["trigger"]["configuration_ref"] = refreshed.get(trigger_ref["path"], trigger_ref)
                model.validate_config(config, before["kind"])
                service.db.execute("UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?",
                                   (encoded(config), node["id"]))
                service._event(ACTOR, "update", "node_contract", node["id"], before, model.contract(node["id"]))
        # Existing graph positions, field IDs, bindings, score snapshots and runtime
        # reports are untouched. Reports on previous definitions become stale normally.
        service.db.execute("INSERT INTO schema_meta(key,value) VALUES (?,?)", (MARKER, "1"))
