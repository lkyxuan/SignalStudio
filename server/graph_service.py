"""Local graph domain service. All writes, including proposals, go through here."""

import json
import math
import os
import re
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

TYPES = ("Source", "Raw Field", "Evidence Check", "Asset Resolution", "Relationship Lookup",
         "Relationship Discovery", "Review Decision", "Derived Field", "Metric",
         "Score", "Ranking", "Rule Evaluation", "Flow Result", "Signal Event", "Product Module",
         "Redpanda Topic", "Redis Window",
         "assets", "asset_identifiers", "asset_relationships", "asset_monitoring_rules",
         "asset_score_events", "asset_scores_current", "supabase_asset_scores",
         "Asset Registry", "Rule Registry")
SYSTEM_TABLES = (
    ("assets", "Internal asset objects and stable IDs, including pending identities; planned backend table.", 340, -220),
    ("asset_identifiers", "Source-scoped external IDs mapped to existing internal asset IDs in three columns; planned backend table.", 340, 160),
    ("asset_relationships", "Reviewed relationships between internal assets; planned table, not connected to live records.", 1020, 160),
    ("asset_monitoring_rules", "Versioned monitoring rules for assets; planned table, not connected to live records.", 1020, -220),
    ("asset_score_events", "Unified score postings by asset and dimension, linked to program-owned decision records; planned table, not calculated results.", 1700, -220),
    ("asset_scores_current", "Latest score metric values by asset; separate score keys identify distinct calculations; rank is derived when querying; planned table, not calculated results.", 1700, 160),
    ("supabase_asset_scores", "Frontend Supabase projection for all scored assets; changed rows only, no stored rank; planned, not deployed.", 2380, 160),
)
LEGACY_STATE_TYPES = ("Asset Registry", "Rule Registry")
STATE_TYPES = tuple(item[0] for item in SYSTEM_TABLES) + LEGACY_STATE_TYPES
DECISION_TYPES = {"Evidence Check", "Review Decision", "Rule Evaluation"}
CHOOSABLE_REFERENCE_GROUP_TYPES = {"Asset Resolution", "Relationship Lookup"}
GROUPED_NODE_REFERENCE_MARKER = "grouped_node_references_v1"
WORKFLOW_LANES = ("shared", "signal", "knowledge")
DEFAULT_LANES = {
    "Source": "shared", "Raw Field": "shared", "Evidence Check": "shared",
    "Asset Resolution": "shared", "Relationship Lookup": "signal",
    "Relationship Discovery": "knowledge",
    "Review Decision": "knowledge", **{name: "shared" for name in STATE_TYPES},
    "Flow Result": "knowledge",
}
TEXT_FIELDS = ("name", "type", "definition", "formula", "rationale", "caveats", "notes")
SIGNAL_DESIGN_FIELDS = ("decision_question", "observation_window", "trigger_rule",
                        "validation_plan", "validation_evidence")
NODE_FIELDS = TEXT_FIELDS + SIGNAL_DESIGN_FIELDS + ("workflow_lane", "position_x", "position_y")
TRANSPORT_KINDS = ("unspecified", "direct", "redpanda")


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid.uuid4())


class GraphError(ValueError):
    pass


class GraphService:
    def __init__(self, path=None):
        db_path = Path(path or Path(__file__).resolve().parent.parent / "data" / "logic.db")
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(db_path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS nodes (
              id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
              reference_number INTEGER,
              type TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '',
              formula TEXT NOT NULL DEFAULT '', rationale TEXT NOT NULL DEFAULT '',
              caveats TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
              position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS edges (
              id TEXT PRIMARY KEY, reference_number INTEGER,
              upstream_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              downstream_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              rationale TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
              UNIQUE(upstream_id, downstream_id), CHECK(upstream_id != downstream_id)
            );
            CREATE TABLE IF NOT EXISTS change_events (
              id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
              entity TEXT NOT NULL, entity_id TEXT NOT NULL,
              before_json TEXT, after_json TEXT, created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS edges_downstream_idx ON edges(downstream_id);
            CREATE INDEX IF NOT EXISTS edges_upstream_idx ON edges(upstream_id);
            CREATE TABLE IF NOT EXISTS node_fields (
              id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              name TEXT NOT NULL, data_type TEXT NOT NULL DEFAULT 'Unknown',
              definition TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
              example_value TEXT NOT NULL DEFAULT '',
              unit TEXT NOT NULL DEFAULT '', min_value REAL, max_value REAL,
              normalization_rule TEXT NOT NULL DEFAULT '',
              ordinal INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(node_id, name COLLATE NOCASE)
            );
            CREATE TABLE IF NOT EXISTS edge_field_usages (
              id TEXT PRIMARY KEY, reference_number INTEGER,
              edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
              source_field_id TEXT NOT NULL REFERENCES node_fields(id) ON DELETE CASCADE,
              target_field_id TEXT REFERENCES node_fields(id) ON DELETE CASCADE,
              usage_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS node_fields_node_idx ON node_fields(node_id);
            CREATE INDEX IF NOT EXISTS edge_field_usages_edge_idx ON edge_field_usages(edge_id);
            CREATE TABLE IF NOT EXISTS data_requirements (
              id TEXT PRIMARY KEY,
              node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              purpose TEXT NOT NULL DEFAULT '',
              expected_example TEXT NOT NULL DEFAULT '',
              source_field_id TEXT REFERENCES node_fields(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
              UNIQUE(node_id, name COLLATE NOCASE)
            );
            CREATE INDEX IF NOT EXISTS data_requirements_node_idx ON data_requirements(node_id);
            CREATE TABLE IF NOT EXISTS signal_implementation_reports (
              id TEXT PRIMARY KEY,
              signal_key TEXT NOT NULL,
              signal_version INTEGER NOT NULL,
              package_revision TEXT NOT NULL,
              source_contract_revision TEXT NOT NULL,
              code_revision TEXT NOT NULL DEFAULT '',
              implementation_status TEXT NOT NULL,
              source_run_id TEXT NOT NULL DEFAULT '',
              source_request_parameters TEXT NOT NULL DEFAULT '{}',
              coverage_state TEXT NOT NULL,
              raw_response_sample_ref TEXT NOT NULL DEFAULT '',
              emitted_record_sample_ref TEXT NOT NULL DEFAULT '',
              upstream_to_emitted_field_mapping TEXT NOT NULL DEFAULT '{}',
              technology_decisions TEXT NOT NULL DEFAULT '{}',
              errors TEXT NOT NULL DEFAULT '[]',
              created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS signal_reports_key_idx
              ON signal_implementation_reports(signal_key, created_at);
            CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        """)
        if "transformation" not in {row[1] for row in self.db.execute("PRAGMA table_info(edges)")}:
            self.db.execute("ALTER TABLE edges ADD COLUMN transformation TEXT NOT NULL DEFAULT ''")
        if "is_catalog_source" not in {row[1] for row in self.db.execute("PRAGMA table_info(nodes)")}:
            self.db.execute("ALTER TABLE nodes ADD COLUMN is_catalog_source INTEGER NOT NULL DEFAULT 0")
        if "is_system_state" not in {row[1] for row in self.db.execute("PRAGMA table_info(nodes)")}:
            self.db.execute("ALTER TABLE nodes ADD COLUMN is_system_state INTEGER NOT NULL DEFAULT 0")
        node_columns = {row[1] for row in self.db.execute("PRAGMA table_info(nodes)")}
        if "reference_number" not in node_columns:
            self.db.execute("ALTER TABLE nodes ADD COLUMN reference_number INTEGER")
        if "workflow_lane" not in node_columns:
            self.db.execute("ALTER TABLE nodes ADD COLUMN workflow_lane TEXT NOT NULL DEFAULT 'signal'")
            self.db.execute("UPDATE nodes SET workflow_lane='shared' WHERE type IN "
                            "('Source', 'Raw Field', 'Asset Resolution')")
            self.db.execute("UPDATE nodes SET workflow_lane='knowledge' "
                            "WHERE type='Relationship Discovery'")
        for column in SIGNAL_DESIGN_FIELDS:
            if column not in node_columns:
                self.db.execute(f"ALTER TABLE nodes ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        if "signal_key" not in node_columns:
            self.db.execute("ALTER TABLE nodes ADD COLUMN signal_key TEXT NOT NULL DEFAULT ''")
        self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS nodes_signal_key_idx "
                        "ON nodes(signal_key) WHERE signal_key != ''")
        if "example_value" not in {row[1] for row in self.db.execute("PRAGMA table_info(node_fields)")}:
            self.db.execute("ALTER TABLE node_fields ADD COLUMN example_value TEXT NOT NULL DEFAULT ''")
        field_columns = {row[1] for row in self.db.execute("PRAGMA table_info(node_fields)")}
        for column, definition in (("unit", "TEXT NOT NULL DEFAULT ''"), ("min_value", "REAL"),
                                   ("max_value", "REAL"), ("normalization_rule", "TEXT NOT NULL DEFAULT ''")):
            if column not in field_columns:
                self.db.execute(f"ALTER TABLE node_fields ADD COLUMN {column} {definition}")
        if "catalog_field_id" not in field_columns:
            self.db.execute("ALTER TABLE node_fields ADD COLUMN catalog_field_id TEXT NOT NULL DEFAULT ''")
        self.db.execute("CREATE UNIQUE INDEX IF NOT EXISTS node_fields_catalog_id_idx "
                        "ON node_fields(catalog_field_id) WHERE catalog_field_id != ''")
        edge_columns = {row[1] for row in self.db.execute("PRAGMA table_info(edges)")}
        if "branch_label" not in edge_columns:
            self.db.execute("ALTER TABLE edges ADD COLUMN branch_label TEXT NOT NULL DEFAULT ''")
        if "reference_number" not in edge_columns:
            self.db.execute("ALTER TABLE edges ADD COLUMN reference_number INTEGER")
        if "reference_number" not in {row[1] for row in self.db.execute("PRAGMA table_info(edge_field_usages)")}:
            self.db.execute("ALTER TABLE edge_field_usages ADD COLUMN reference_number INTEGER")
        for column in ("transport_kind", "transport_topic", "transport_key", "payload_schema", "transport_headers", "consumer_group"):
            if column not in edge_columns:
                default = "unspecified" if column == "transport_kind" else "[]" if column == "transport_headers" else ""
                self.db.execute(f"ALTER TABLE edges ADD COLUMN {column} TEXT NOT NULL DEFAULT '{default}'")
        if "technology_decisions" not in {
                row[1] for row in self.db.execute("PRAGMA table_info(signal_implementation_reports)")}:
            self.db.execute("ALTER TABLE signal_implementation_reports "
                            "ADD COLUMN technology_decisions TEXT NOT NULL DEFAULT '{}'")
        self.db.commit()
        self._remove_demo_content()
        self._ensure_node_numbers()
        self._ensure_reference_numbers("edges", "next_edge_number", "edges_reference_number_idx")
        self._ensure_reference_numbers("edge_field_usages", "next_usage_number",
                                       "edge_field_usages_reference_number_idx")

    def _ensure_reference_numbers(self, table, meta_key, index_name):
        """Backfill legacy connections and mappings in a stable order."""
        with self.db:
            current = self._one("SELECT value FROM schema_meta WHERE key=?", (meta_key,))
            highest = self.db.execute(
                f"SELECT COALESCE(MAX(reference_number), 0) FROM {table}").fetchone()[0]
            next_number = max(int(current["value"]) if current else 1, highest + 1)
            for row in self.db.execute(
                    f"SELECT id FROM {table} WHERE reference_number IS NULL ORDER BY created_at, id").fetchall():
                self.db.execute(f"UPDATE {table} SET reference_number=? WHERE id=?",
                                (next_number, row["id"]))
                next_number += 1
            self.db.execute("""INSERT INTO schema_meta (key, value) VALUES (?, ?)
                               ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                            (meta_key, str(next_number)))
            self.db.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {index_name} ON {table}(reference_number)")

    def _ensure_node_numbers(self):
        """Give existing nodes permanent human-readable numbers without reusing deletions."""
        with self.db:
            if self._one("SELECT value FROM schema_meta WHERE key=?", (GROUPED_NODE_REFERENCE_MARKER,)):
                self.db.execute("""INSERT OR IGNORE INTO schema_meta (key, value)
                                   VALUES ('next_node_number_5', '5001')""")
                self.db.execute("""INSERT OR IGNORE INTO schema_meta (key, value)
                                   VALUES ('next_node_number_6', '6001')""")
                for row in self.db.execute("""SELECT id, type FROM nodes WHERE reference_number IS NULL
                                              ORDER BY created_at, name, id""").fetchall():
                    group = self._node_reference_group(row["type"])
                    key = f"next_node_number_{group}"
                    number = int(self._one("SELECT value FROM schema_meta WHERE key=?", (key,))["value"])
                    self.db.execute("UPDATE nodes SET reference_number=? WHERE id=?", (number, row["id"]))
                    self.db.execute("UPDATE schema_meta SET value=? WHERE key=?", (str(number + 1), key))
                self.db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS nodes_reference_number_idx
                                   ON nodes(reference_number)""")
                return
            current = self._one("SELECT value FROM schema_meta WHERE key='next_node_number'")
            highest = self.db.execute(
                "SELECT COALESCE(MAX(reference_number), 0) FROM nodes").fetchone()[0]
            next_number = max(int(current["value"]) if current else 1, highest + 1)
            for row in self.db.execute("""SELECT id FROM nodes WHERE reference_number IS NULL
                                          ORDER BY created_at, name, id""").fetchall():
                self.db.execute("UPDATE nodes SET reference_number=? WHERE id=?",
                                (next_number, row["id"]))
                next_number += 1
            self.db.execute("""INSERT INTO schema_meta (key, value)
                               VALUES ('next_node_number', ?)
                               ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                            (str(next_number),))
            self.db.execute("""CREATE UNIQUE INDEX IF NOT EXISTS nodes_reference_number_idx
                               ON nodes(reference_number)""")

    def _remove_demo_content(self):
        """Remove the old sample graph without touching catalog or user-created nodes."""
        if self._one("SELECT value FROM schema_meta WHERE key='demo_cleanup_v1'"):
            return
        demo_ids = set()
        for row in self.db.execute("""SELECT after_json FROM change_events
                                      WHERE actor='seed' AND action='create' AND entity='node'"""):
            if row["after_json"]:
                demo_ids.add(json.loads(row["after_json"])["id"])
        with self.db:
            for node_id in demo_ids:
                self.db.execute("DELETE FROM nodes WHERE id=?", (node_id,))
                self.db.execute("DELETE FROM change_events WHERE entity='node' AND entity_id=?", (node_id,))
            self.db.execute("DELETE FROM change_events WHERE actor='seed'")
            self.db.execute("DELETE FROM schema_meta WHERE key='field_demo_v1'")
            self.db.execute("INSERT INTO schema_meta (key, value) VALUES ('demo_cleanup_v1', 'done')")

    def _one(self, query, args=()):
        row = self.db.execute(query, args).fetchone()
        return dict(row) if row else None

    def _event(self, actor, action, entity, entity_id, before=None, after=None):
        self.db.execute(
            "INSERT INTO change_events VALUES (?,?,?,?,?,?,?,?)",
            (uid(), actor, action, entity, entity_id,
             json.dumps(before, ensure_ascii=False) if before is not None else None,
             json.dumps(after, ensure_ascii=False) if after is not None else None, now()),
        )

    def ensure_catalog_sources(self, entities):
        """Keep one source node for every declared record type in the catalog."""
        entities = sorted(entities.values(), key=lambda entity: entity["id"])
        created = 0
        rows_per_column = 6
        column_count = max(1, (len(entities) + rows_per_column - 1) // rows_per_column)
        left = 340 - 290 - column_count * 250
        with self.db:
            for row, entity in enumerate(entities):
                entity_id = entity["id"]
                definition = (f'{entity["spider_id"]} 采集器的 {entity["record_type"]} '
                              "记录类型；这里展示的是字段能力定义，未核查运行记录。")
                source = self.find_name(entity_id)
                if source and source["type"] != "Source":
                    raise GraphError(f"Record type name is used by a non-source node: {entity_id}")
                if not source:
                    source = self.create_node({
                        "name": entity_id, "type": "Source", "definition": definition,
                        "position_x": left + (row // rows_per_column) * 250,
                        "position_y": -220 + (row % rows_per_column) * 160,
                    }, actor="catalog", commit=False)
                    created += 1
                elif source["definition"] != definition and source["is_catalog_source"]:
                    self.db.execute("UPDATE nodes SET definition=? WHERE id=?",
                                    (definition, source["id"]))
                if not source["is_catalog_source"]:
                    self.db.execute("UPDATE nodes SET is_catalog_source=1 WHERE id=?", (source["id"],))
                    self._event("catalog", "protect", "node", source["id"],
                                before=source, after=self.get_node(source["id"]))
        return {"created": created, "total": len(entities)}

    def ensure_source_contract_sources(self, entries):
        """Add planned operation and reference-resource Sources without reusing references."""
        # Keep existing operation positions stable; place new resources after them.
        entries = sorted(entries, key=lambda item: ("uri" in item, item["id"]))
        created = 0
        rows_per_column = 6
        with self.db:
            for index, entry in enumerate(entries):
                entry_id = entry["id"]
                source = self.find_name(entry_id)
                if source and source["type"] != "Source":
                    raise GraphError("Upstream entry name is used by a non-source node")
                if source:
                    continue
                self.create_node({
                    "name": entry_id, "type": "Source",
                    "definition": ("Kaito MCP 参考资源；用于查询前核对标识。尚未核对实际返回内容。"
                                   if "uri" in entry else
                                   "本产品规划的上游操作；字段依据官方文档、API 或 MCP，尚不代表爬虫已产出。"),
                    "position_x": -1900 + (index // rows_per_column) * 250,
                    "position_y": (index % rows_per_column) * 160,
                }, actor="source_contract", commit=False)
                created += 1
        return {"created": created, "total": len(entries)}

    def retire_legacy_record_types(self):
        """Remove unused V2 reference nodes; refuse to discard a connected design."""
        legacy = [dict(row) for row in self.db.execute(
            "SELECT * FROM nodes WHERE is_catalog_source=1")]
        with self.db:
            for node in legacy:
                node_id = node["id"]
                if self._one("SELECT id FROM edges WHERE upstream_id=? OR downstream_id=?",
                             (node_id, node_id)):
                    raise GraphError(f"Legacy record type has a design connection: {node['name']}")
                if self._one("""SELECT r.id FROM data_requirements r
                    JOIN node_fields f ON f.id=r.source_field_id WHERE f.node_id=?""", (node_id,)):
                    raise GraphError(f"Legacy record type has a matched data need: {node['name']}")
                if self._one("""SELECT u.id FROM edge_field_usages u
                    JOIN node_fields f ON f.id=u.source_field_id OR f.id=u.target_field_id
                    WHERE f.node_id=?""", (node_id,)):
                    raise GraphError(f"Legacy record type has a field usage: {node['name']}")
            for node in legacy:
                self.db.execute("DELETE FROM nodes WHERE id=?", (node["id"],))
                self._event("source_contract", "retire_legacy_record_type", "node", node["id"], before=node)
        return {"retired": len(legacy)}

    def compact_retired_node_references(self):
        """Close legacy cleanup gaps once, without changing node identity or future numbering."""
        marker = "legacy_node_reference_compaction_v1"
        rows = [dict(row) for row in self.db.execute(
            "SELECT id, name, reference_number FROM nodes ORDER BY reference_number, id")]
        if self._one("SELECT value FROM schema_meta WHERE key=?", (GROUPED_NODE_REFERENCE_MARKER,)):
            return {"renumbered": 0, "total": len(rows)}
        if self._one("SELECT value FROM schema_meta WHERE key=?", (marker,)):
            return {"renumbered": 0, "total": len(rows)}
        if any(row["reference_number"] is None or row["reference_number"] < 1 for row in rows):
            raise GraphError("Cannot compact invalid node references")
        changes = [
            {"id": row["id"], "name": row["name"], "old": row["reference_number"], "new": index}
            for index, row in enumerate(rows, start=1)
            if row["reference_number"] != index
        ]
        with self.db:
            # Move every number out of the positive range first so the unique index
            # remains valid throughout the migration.
            if changes:
                self.db.execute("UPDATE nodes SET reference_number=-reference_number")
                for index, row in enumerate(rows, start=1):
                    self.db.execute("UPDATE nodes SET reference_number=? WHERE id=?",
                                    (index, row["id"]))
                self._event("system", "compact_legacy_node_references", "graph", "all",
                            before=changes)
            self.db.execute("UPDATE schema_meta SET value=? WHERE key='next_node_number'",
                            (str(len(rows) + 1),))
            self.db.execute("INSERT INTO schema_meta (key, value) VALUES (?, 'done')", (marker,))
        return {"renumbered": len(changes), "total": len(rows)}

    @staticmethod
    def _node_reference_group(node_type):
        if node_type == "Redpanda Topic":
            return 5
        if node_type == "Redis Window":
            return 6
        if node_type in STATE_TYPES:
            return 1
        if node_type == "Source":
            return 2
        if node_type in DECISION_TYPES:
            return 4
        return 3

    def group_node_references_once(self):
        """Move card references into four stable ranges; leave edge and field references intact."""
        rows = [dict(row) for row in self.db.execute(
            "SELECT id, name, type, reference_number FROM nodes ORDER BY reference_number, id")]
        if self._one("SELECT value FROM schema_meta WHERE key=?", (GROUPED_NODE_REFERENCE_MARKER,)):
            return {"renumbered": 0, "total": len(rows)}
        if any(row["reference_number"] is None or row["reference_number"] < 1 for row in rows):
            raise GraphError("Cannot group invalid node references")
        branched_ids = {row["upstream_id"] for row in self.db.execute("""
            SELECT edges.upstream_id FROM edges
            JOIN nodes AS target ON target.id=edges.downstream_id
            WHERE edges.branch_label != '' AND target.is_system_state=0
            GROUP BY edges.upstream_id HAVING COUNT(*) > 1
        """)}
        next_numbers = {group: group * 1000 + 1 for group in range(1, 7)}
        changes = []
        for row in rows:
            group = (4 if row["type"] not in STATE_TYPES and row["type"] != "Source"
                     and row["id"] in branched_ids
                     else self._node_reference_group(row["type"]))
            new_number = next_numbers[group]
            if new_number >= (group + 1) * 1000:
                raise GraphError(f"Reference range {group}xxx is full")
            next_numbers[group] += 1
            changes.append({"id": row["id"], "name": row["name"],
                            "old": row["reference_number"], "new": new_number})
        old_to_new = {f'{change["old"]:03d}': f'{change["new"]:04d}' for change in changes}
        def replace_refs(value):
            return re.sub(r'#(\d{3})(?!\d)',
                          lambda match: '#' + old_to_new.get(match.group(1), match.group(1)),
                          value or '')
        with self.db:
            if rows:
                self.db.execute("UPDATE nodes SET reference_number=-reference_number")
                for change in changes:
                    self.db.execute("UPDATE nodes SET reference_number=? WHERE id=?",
                                    (change["new"], change["id"]))
                text_columns = {
                    "nodes": ("definition", "formula", "rationale", "caveats", "notes",
                              "decision_question", "observation_window", "trigger_rule",
                              "validation_plan", "validation_evidence"),
                    "edges": ("rationale", "transformation", "branch_label"),
                    "node_fields": ("definition", "notes"),
                    "data_requirements": ("purpose",),
                    "edge_field_usages": ("usage_note",),
                }
                for table, columns in text_columns.items():
                    for record in self.db.execute(
                            f"SELECT id, {', '.join(columns)} FROM {table}").fetchall():
                        updates = {column: replace_refs(record[column]) for column in columns
                                   if record[column] and replace_refs(record[column]) != record[column]}
                        if updates:
                            self.db.execute(
                                f"UPDATE {table} SET {', '.join(f'{column}=?' for column in updates)} WHERE id=?",
                                (*updates.values(), record["id"]))
                self._event("system", "group_node_references", "graph", "all", before=changes)
            for group, next_number in next_numbers.items():
                self.db.execute("""INSERT INTO schema_meta (key, value) VALUES (?, ?)
                                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                                (f"next_node_number_{group}", str(next_number)))
            self.db.execute("INSERT INTO schema_meta (key, value) VALUES (?, 'done')",
                            (GROUPED_NODE_REFERENCE_MARKER,))
        return {"renumbered": len(changes), "total": len(rows)}

    def retire_catalog_fields(self, current_field_ids):
        """Remove obsolete catalog fields while retaining the user's graph design."""
        current_field_ids = set(current_field_ids)
        obsolete = [dict(row) for row in self.db.execute(
            "SELECT * FROM node_fields WHERE catalog_field_id != ''")
            if row["catalog_field_id"] not in current_field_ids]
        with self.db:
            for field in obsolete:
                requirements = [dict(row) for row in self.db.execute(
                    "SELECT * FROM data_requirements WHERE source_field_id=?", (field["id"],))]
                for requirement in requirements:
                    self.db.execute("UPDATE data_requirements SET source_field_id=NULL, updated_at=? WHERE id=?",
                                    (now(), requirement["id"]))
                    self._event("catalog", "unmatch_obsolete_field", "data_requirement",
                                requirement["id"], before=requirement,
                                after=self.get_requirement(requirement["id"]))
                usages = [dict(row) for row in self.db.execute(
                    "SELECT * FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?",
                    (field["id"], field["id"]))]
                for usage in usages:
                    self.db.execute("DELETE FROM edge_field_usages WHERE id=?", (usage["id"],))
                    self._event("catalog", "retire_obsolete_field_usage", "field_usage",
                                usage["id"], before=usage)
                self.db.execute("DELETE FROM node_fields WHERE id=?", (field["id"],))
                self._event("catalog", "retire_obsolete_field", "field", field["id"], before=field)
        return {"retired": len(obsolete)}

    def rehome_catalog_fields(self, catalog_fields, spider_ids):
        """Move existing v2 fields and their usages onto record-type sources."""
        moved = 0
        touched_edges = set()
        with self.db:
            existing = [dict(row) for row in self.db.execute(
                "SELECT * FROM node_fields WHERE catalog_field_id != ''")]
            for field in existing:
                definition = catalog_fields.get(field["catalog_field_id"])
                if not definition:
                    continue
                destination = self.find_name(definition["entity_id"])
                if not destination or not destination["is_catalog_source"]:
                    raise GraphError("Record-type catalog source is missing")
                if field["node_id"] == destination["id"]:
                    continue
                if self._one("SELECT id FROM edge_field_usages WHERE target_field_id=?", (field["id"],)):
                    raise GraphError("Catalog source field is used as a downstream output")
                if self._one("SELECT id FROM node_fields WHERE node_id=? AND name=? COLLATE NOCASE",
                             (destination["id"], definition["path"])):
                    raise GraphError("Record-type source already has a field with this name")
                usages = [dict(row) for row in self.db.execute(
                    "SELECT * FROM edge_field_usages WHERE source_field_id=?", (field["id"],))]
                for usage in usages:
                    old_edge = self.get_edge(usage["edge_id"])
                    if old_edge["upstream_id"] != field["node_id"]:
                        raise GraphError("Catalog field usage has an inconsistent source")
                    new_edge = self._one("SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?",
                                         (destination["id"], old_edge["downstream_id"]))
                    if not new_edge:
                        new_edge = self.create_edge({**old_edge, "upstream_id": destination["id"]},
                                                    actor="catalog", commit=False)
                    self.db.execute("UPDATE edge_field_usages SET edge_id=? WHERE id=?",
                                    (new_edge["id"], usage["id"]))
                    self._event("catalog", "rehome_field_usage", "field_usage", usage["id"],
                                before=usage, after={**usage, "edge_id": new_edge["id"]})
                    touched_edges.add(old_edge["id"])
                self.db.execute("UPDATE node_fields SET node_id=?, name=?, updated_at=? WHERE id=?",
                                (destination["id"], definition["path"], now(), field["id"]))
                self._event("catalog", "rehome_field", "field", field["id"],
                            before=field, after=self.get_field(field["id"]))
                moved += 1
            for edge_id in touched_edges:
                if not self._one("SELECT id FROM edge_field_usages WHERE edge_id=?", (edge_id,)):
                    edge = self.get_edge(edge_id)
                    self.db.execute("DELETE FROM edges WHERE id=?", (edge_id,))
                    self._event("catalog", "replace_crawler_edge", "edge", edge_id, before=edge)
            for spider_id in spider_ids:
                old = self.find_name(spider_id)
                if not old or not old["is_catalog_source"]:
                    continue
                has_fields = self._one("SELECT id FROM node_fields WHERE node_id=?", (old["id"],))
                has_edges = self._one("SELECT id FROM edges WHERE upstream_id=? OR downstream_id=?",
                                      (old["id"], old["id"]))
                if has_fields or has_edges:
                    self.db.execute("UPDATE nodes SET is_catalog_source=0, definition=? WHERE id=?",
                                    ("旧爬虫级设计节点；其连接尚未指定 v2 记录类型，需复核。", old["id"]))
                    self._event("catalog", "unprotect_legacy_crawler", "node", old["id"],
                                before=old, after=self.get_node(old["id"]))
                else:
                    self.db.execute("DELETE FROM nodes WHERE id=?", (old["id"],))
                    self._event("catalog", "retire_crawler_source", "node", old["id"], before=old)
        return {"moved": moved}

    def ensure_system_tables(self):
        """Show each planned business table without claiming that records or queries exist."""
        created = 0
        with self.db:
            for name, definition, x, y in SYSTEM_TABLES:
                node = self.find_name(name)
                if node and node["type"] != name:
                    raise GraphError(f"System table name is used by another node: {name}")
                if not node:
                    node = self.create_node({"name": name, "type": name,
                                             "definition": definition,
                                             "position_x": x, "position_y": y},
                                            actor="system", commit=False)
                    created += 1
                if not node["is_system_state"]:
                    self.db.execute("UPDATE nodes SET is_system_state=1, workflow_lane='shared' WHERE id=?",
                                    (node["id"],))
            # Earlier releases used two aggregate reference nodes. Remove only isolated
            # application-created nodes; connected nodes retain user-designed edges.
            for name in LEGACY_STATE_TYPES:
                old = self.find_name(name)
                if old and old["is_system_state"] and not self._one(
                    "SELECT id FROM edges WHERE upstream_id=? OR downstream_id=? LIMIT 1",
                    (old["id"], old["id"])
                ):
                    self.db.execute("DELETE FROM nodes WHERE id=?", (old["id"],))
                    self._event("system", "replace_aggregate_reference", "node", old["id"], before=old)
        return {"created": created, "total": len(SYSTEM_TABLES)}

    def graph(self):
        nodes = [dict(row) for row in self.db.execute("SELECT * FROM nodes ORDER BY created_at, name")]
        edges = [dict(row) for row in self.db.execute("SELECT * FROM edges ORDER BY created_at")]
        fields = [dict(row) for row in self.db.execute("SELECT * FROM node_fields ORDER BY node_id, ordinal, name")]
        usages = [dict(row) for row in self.db.execute("SELECT * FROM edge_field_usages ORDER BY created_at")]
        requirements = [dict(row) for row in self.db.execute(
            "SELECT * FROM data_requirements ORDER BY created_at")]
        return {"nodes": nodes, "edges": edges, "fields": fields,
                "field_usages": usages, "requirements": requirements, "types": list(TYPES)}


    def get_requirements(self, node_id):
        self.get_node(node_id)
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM data_requirements WHERE node_id=? ORDER BY created_at", (node_id,))]

    def get_requirement(self, requirement_id):
        requirement = self._one("SELECT * FROM data_requirements WHERE id=?", (requirement_id,))
        if not requirement:
            raise GraphError("Data requirement not found")
        return requirement

    def create_requirement(self, node_id, data, actor="user"):
        node = self.get_node(node_id)
        if node["type"] == "Source" or node["is_system_state"]:
            raise GraphError("Data requirements belong to signal or downstream nodes")
        name = str(data.get("name", "") or "").strip()
        if not name:
            raise GraphError("Data requirement name is required")
        if self._one("SELECT id FROM data_requirements WHERE node_id=? AND name=? COLLATE NOCASE",
                     (node_id, name)):
            raise GraphError("This data requirement already exists")
        requirement_id, stamp = uid(), now()
        self.db.execute("""INSERT INTO data_requirements
            (id,node_id,name,purpose,expected_example,source_field_id,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?)""", (requirement_id, node_id, name,
            str(data.get("purpose", "") or ""), str(data.get("expected_example", "") or ""),
            None, stamp, stamp))
        result = self.get_requirement(requirement_id)
        self._event(actor, "create", "data_requirement", requirement_id, after=result)
        self.db.commit()
        return result

    def update_requirement(self, requirement_id, data, actor="user"):
        before = self.get_requirement(requirement_id)
        changes = {key: data[key] for key in ("name", "purpose", "expected_example") if key in data}
        if not changes:
            return before
        for key in changes:
            changes[key] = str(changes[key] or "").strip()
        if "name" in changes:
            if not changes["name"]:
                raise GraphError("Data requirement name is required")
            duplicate = self._one("SELECT id FROM data_requirements WHERE node_id=? AND name=? COLLATE NOCASE",
                                  (before["node_id"], changes["name"]))
            if duplicate and duplicate["id"] != requirement_id:
                raise GraphError("This data requirement already exists")
        changes["updated_at"] = now()
        self.db.execute("UPDATE data_requirements SET " + ", ".join(
            key + "=?" for key in changes) + " WHERE id=?", (*changes.values(), requirement_id))
        after = self.get_requirement(requirement_id)
        self._event(actor, "update", "data_requirement", requirement_id, before, after)
        self.db.commit()
        return after

    def delete_requirement(self, requirement_id, actor="user"):
        before = self.get_requirement(requirement_id)
        self.db.execute("DELETE FROM data_requirements WHERE id=?", (requirement_id,))
        self._event(actor, "delete", "data_requirement", requirement_id, before=before)
        self.db.commit()
        return {"deleted": requirement_id}

    def search_nodes(self, query=""):
        term = f"%{query.strip()}%"
        return [dict(row) for row in self.db.execute(
            """SELECT * FROM nodes WHERE name LIKE ? OR definition LIKE ? OR notes LIKE ?
               OR decision_question LIKE ? OR trigger_rule LIKE ?
               OR EXISTS (SELECT 1 FROM node_fields WHERE node_fields.node_id=nodes.id
                          AND (node_fields.name LIKE ? OR node_fields.definition LIKE ?))
               ORDER BY name""", (term, term, term, term, term, term, term))]

    def search_by_description(self, query):
        term = f"%{query.strip()}%"
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM nodes WHERE definition LIKE ? OR rationale LIKE ? OR caveats LIKE ? OR notes LIKE ? OR decision_question LIKE ? OR trigger_rule LIKE ? ORDER BY name",
            (term, term, term, term, term, term))]

    def get_node(self, node_id):
        node = self._one("SELECT * FROM nodes WHERE id=?", (node_id,))
        if not node:
            raise GraphError("Node not found")
        return node

    def find_signal_key(self, signal_key):
        return self._one("SELECT * FROM nodes WHERE signal_key=?", (signal_key,))

    def get_signal_reports(self, signal_key):
        reports = [dict(row) for row in self.db.execute(
            "SELECT * FROM signal_implementation_reports WHERE signal_key=? "
            "ORDER BY created_at DESC, id DESC", (signal_key,))]
        for report in reports:
            for key in ("source_request_parameters", "upstream_to_emitted_field_mapping",
                        "technology_decisions", "errors"):
                report[key] = json.loads(report[key])
        return reports

    def create_signal_report(self, package, data, actor="few_understand"):
        required = ("signal_key", "signal_version", "package_revision",
                    "source_contract_revision", "implementation_status", "coverage_state")
        if not isinstance(data, dict) or any(key not in data for key in required):
            raise GraphError("Signal report is missing required fields")
        for key, value in (("signal_key", package["signal_key"]),
                           ("signal_version", package["signal_version"]),
                           ("package_revision", package["revision"]),
                           ("source_contract_revision", package["source_contract_revision"])):
            if data[key] != value:
                raise GraphError(f"Signal report {key} does not match the current package")
        if data["implementation_status"] not in {
                "not_started", "in_progress", "implemented", "blocked", "failed"}:
            raise GraphError("Invalid signal implementation status")
        if data["coverage_state"] not in {
                "not_run", "complete", "partial_coverage", "failed"}:
            raise GraphError("Invalid signal coverage state")
        if data["coverage_state"] != "not_run" and not data.get("source_run_id"):
            raise GraphError("A run ID is required for run evidence")
        for key in ("source_request_parameters", "upstream_to_emitted_field_mapping",
                    "technology_decisions"):
            if not isinstance(data.get(key, {}), dict):
                raise GraphError(f"Invalid signal report {key}")
        if (data["implementation_status"] == "implemented"
                and not data.get("technology_decisions", {}).get("compute_engine")):
            raise GraphError("Implemented signals must report the selected compute engine")
        if not isinstance(data.get("errors", []), list):
            raise GraphError("Invalid signal report errors")
        report_id, stamp = uid(), now()
        values = {
            "id": report_id,
            "signal_key": data["signal_key"],
            "signal_version": data["signal_version"],
            "package_revision": data["package_revision"],
            "source_contract_revision": data["source_contract_revision"],
            "code_revision": str(data.get("code_revision", "") or ""),
            "implementation_status": data["implementation_status"],
            "source_run_id": str(data.get("source_run_id", "") or ""),
            "source_request_parameters": json.dumps(data.get("source_request_parameters", {}), ensure_ascii=False),
            "coverage_state": data["coverage_state"],
            "raw_response_sample_ref": str(data.get("raw_response_sample_ref", "") or ""),
            "emitted_record_sample_ref": str(data.get("emitted_record_sample_ref", "") or ""),
            "upstream_to_emitted_field_mapping": json.dumps(
                data.get("upstream_to_emitted_field_mapping", {}), ensure_ascii=False),
            "technology_decisions": json.dumps(data.get("technology_decisions", {}), ensure_ascii=False),
            "errors": json.dumps(data.get("errors", []), ensure_ascii=False),
            "created_at": stamp,
        }
        with self.db:
            self.db.execute("INSERT INTO signal_implementation_reports (" + ",".join(values)
                            + ") VALUES (" + ",".join("?" for _ in values) + ")",
                            tuple(values.values()))
            self._event(actor, "create", "signal_implementation_report", report_id,
                        after={**values, "source_request_parameters": data.get("source_request_parameters", {}),
                               "upstream_to_emitted_field_mapping": data.get(
                                   "upstream_to_emitted_field_mapping", {}),
                               "technology_decisions": data.get("technology_decisions", {}),
                               "errors": data.get("errors", [])})
        return next(report for report in self.get_signal_reports(data["signal_key"])
                    if report["id"] == report_id)

    def get_fields(self, node_id):
        self.get_node(node_id)
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM node_fields WHERE node_id=? ORDER BY ordinal, name", (node_id,))]

    def get_field(self, field_id):
        field = self._one("SELECT * FROM node_fields WHERE id=?", (field_id,))
        if not field:
            raise GraphError("Field not found")
        return field

    def _field_bounds(self, data, existing=None):
        bounds = {}
        for key in ("min_value", "max_value"):
            if key not in data:
                continue
            value = data[key]
            if value is None or value == "":
                bounds[key] = None
                continue
            try:
                bounds[key] = float(value)
            except (ValueError, TypeError):
                raise GraphError("Field bounds must be numeric")
            if not math.isfinite(bounds[key]):
                raise GraphError("Field bounds must be finite")
        minimum = bounds.get("min_value", existing.get("min_value") if existing else None)
        maximum = bounds.get("max_value", existing.get("max_value") if existing else None)
        if minimum is not None and maximum is not None and minimum > maximum:
            raise GraphError("Minimum value must not exceed maximum value")
        return bounds

    def create_field(self, node_id, data, actor="user", commit=True):
        node = self.get_node(node_id)
        if node["is_system_state"]:
            raise GraphError("System state references do not contain editable fields")
        if node["is_catalog_source"] and actor != "catalog":
            raise GraphError("Base crawler fields can only come from the catalog")
        name = str(data.get("name", "")).strip()
        if not name:
            raise GraphError("Field name is required")
        if self._one("SELECT id FROM node_fields WHERE node_id=? AND name=? COLLATE NOCASE", (node_id, name)):
            raise GraphError("Field name already exists in this node")
        field_id, stamp = uid(), now()
        ordinal = self.db.execute("SELECT COALESCE(MAX(ordinal), -1)+1 FROM node_fields WHERE node_id=?", (node_id,)).fetchone()[0]
        bounds = self._field_bounds(data)
        self.db.execute("""INSERT INTO node_fields
          (id,node_id,name,data_type,definition,notes,example_value,unit,min_value,max_value,
           normalization_rule,ordinal,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (field_id, node_id, name, str(data.get("data_type", "Unknown") or "Unknown"),
             str(data.get("definition", "") or ""), str(data.get("notes", "") or ""),
             str(data.get("example_value", "") or ""), str(data.get("unit", "") or ""),
             bounds.get("min_value"), bounds.get("max_value"),
             str(data.get("normalization_rule", "") or ""),
             ordinal, stamp, stamp))
        field = self.get_field(field_id)
        self._event(actor, "create", "field", field_id, after=field)
        if commit:
            self.db.commit()
        return field

    def use_catalog_field(self, entity, field, target_node_id=None, grouped=False,
                          requirement_id=None, actor="user"):
        source_name = entity["id"]
        catalog_id = field["id"]
        field_name = field["path"]
        if not isinstance(source_name, str) or not isinstance(catalog_id, str):
            raise GraphError("Invalid catalog field")
        target = self.get_node(target_node_id) if target_node_id else None
        if target and target["type"] == "Source":
            raise GraphError("Select a signal or downstream node, not a source")
        requirement = self.get_requirement(requirement_id) if requirement_id else None
        if requirement and (not target or requirement["node_id"] != target["id"]):
            raise GraphError("Data requirement does not belong to the selected node")
        with self.db:
            source = self.find_name(source_name)
            source_created = False
            if source and source["type"] != "Source":
                raise GraphError("A non-source node already has this record type name")
            if not source:
                existing = [dict(row) for row in self.db.execute(
                    "SELECT position_x, position_y FROM nodes")]
                target_x = target["position_x"] - 280 if target else min(
                    (node["position_x"] for node in existing), default=0) - 280
                target_y = target["position_y"] if target else min(
                    (node["position_y"] for node in existing), default=0)
                y = target_y
                for step in range(100):
                    candidate = target_y + ((step + 1) // 2 * 140 * (1 if step % 2 else -1))
                    if all(abs(node["position_x"] - target_x) >= 230 or
                           abs(node["position_y"] - candidate) >= 115 for node in existing):
                        y = candidate
                        break
                source = self.create_node({"name": source_name, "type": "Source",
                                           "definition": ("本产品规划的上游操作 " if entity.get("contract_source") else "v2 记录类型 ") + source_name + " 的字段定义。",
                                           "position_x": target_x, "position_y": y}, actor, commit=False)
                source_created = True
            imported = self._one("SELECT * FROM node_fields WHERE catalog_field_id=?", (catalog_id,))
            field_created = False
            if imported and imported["node_id"] != source["id"]:
                raise GraphError("Catalog field is linked to another node")
            if not imported:
                existing_name = self._one("SELECT id FROM node_fields WHERE node_id=? AND name=? COLLATE NOCASE",
                                          (source["id"], field_name))
                if existing_name:
                    raise GraphError("This crawler already has a field with the same name")
                imported = self.create_field(source["id"], {
                    "name": field_name, "data_type": field["type"],
                    "definition": field.get("plain_meaning") or field.get("description") or "",
                    "unit": field.get("unit") or field.get("value_unit") or "",
                    "notes": "目录字段 ID: " + catalog_id,
                }, actor, commit=False)
                self.db.execute("UPDATE node_fields SET catalog_field_id=? WHERE id=?",
                                (catalog_id, imported["id"]))
                imported = self.get_field(imported["id"])
                field_created = True
            edge = None
            usage = None
            if target:
                edge = self._one("SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?",
                                 (source["id"], target["id"]))
                if not edge:
                    edge = self.create_edge({"upstream_id": source["id"],
                                             "downstream_id": target["id"]}, actor, commit=False)
                usage = self._one("""SELECT * FROM edge_field_usages
                    WHERE edge_id=? AND source_field_id=?
                    ORDER BY CASE WHEN target_field_id IS NULL THEN 0 ELSE 1 END, id LIMIT 1""",
                    (edge["id"], imported["id"]))
                if not usage:
                    usage = self.create_field_usage(edge["id"], {
                        "source_field_id": imported["id"]}, actor, commit=False)
            if requirement and requirement["source_field_id"] != imported["id"]:
                self.db.execute("UPDATE data_requirements SET source_field_id=?, updated_at=? WHERE id=?",
                                (imported["id"], now(), requirement_id))
                self._event(actor, "fulfill", "data_requirement", requirement_id,
                            requirement, self.get_requirement(requirement_id))
        return {"source_node_id": source["id"], "field_id": imported["id"],
                "edge_id": edge["id"] if edge else None,
                "usage_id": usage["id"] if usage else None,
                "source_created": source_created, "field_created": field_created}

    def update_field(self, field_id, data, actor="user"):
        before = self.get_field(field_id)
        if self.get_node(before["node_id"])["is_catalog_source"]:
            raise GraphError("Base crawler fields cannot be edited")
        if self.get_node(before["node_id"])["is_system_state"]:
            raise GraphError("System state references do not contain editable fields")
        changes = {key: data[key] for key in ("name", "data_type", "definition", "notes", "example_value",
                                                  "unit", "normalization_rule", "ordinal") if key in data}
        changes.update(self._field_bounds(data, before))
        if not changes:
            return before
        if "name" in changes:
            changes["name"] = str(changes["name"]).strip()
            if not changes["name"]:
                raise GraphError("Field name is required")
            existing = self._one("SELECT id FROM node_fields WHERE node_id=? AND name=? COLLATE NOCASE",
                                 (before["node_id"], changes["name"]))
            if existing and existing["id"] != field_id:
                raise GraphError("Field name already exists in this node")
        for key in ("data_type", "definition", "notes", "example_value", "unit", "normalization_rule"):
            if key in changes:
                changes[key] = str(changes[key] or "")
        if "ordinal" in changes:
            try:
                changes["ordinal"] = int(changes["ordinal"])
            except (ValueError, TypeError):
                raise GraphError("Field order must be an integer")
        changes["updated_at"] = now()
        self.db.execute("UPDATE node_fields SET " + ", ".join(f"{key}=?" for key in changes) + " WHERE id=?",
                        (*changes.values(), field_id))
        after = self.get_field(field_id)
        self._event(actor, "update", "field", field_id, before, after)
        self.db.commit()
        return after

    def delete_field(self, field_id, actor="user"):
        before = self.get_field(field_id)
        if self.get_node(before["node_id"])["is_catalog_source"]:
            raise GraphError("Base crawler fields cannot be deleted")
        if self.get_node(before["node_id"])["is_system_state"]:
            raise GraphError("System state references do not contain editable fields")
        used = self._one("SELECT id FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?",
                         (field_id, field_id))
        if used:
            raise GraphError("Remove this field from its connections before deleting it")
        self.db.execute("DELETE FROM node_fields WHERE id=?", (field_id,))
        self._event(actor, "delete", "field", field_id, before=before)
        self.db.commit()
        return {"deleted": field_id}

    def remove_catalog_field(self, catalog_field_id, actor="user"):
        field = self._one("SELECT * FROM node_fields WHERE catalog_field_id=?", (catalog_field_id,))
        if field and self.get_node(field["node_id"])["is_catalog_source"]:
            raise GraphError("Base crawler fields cannot be deleted")
        if not field:
            raise GraphError("Catalog field is not on the graph")
        source = self.get_node(field["node_id"])
        usages = [dict(row) for row in self.db.execute(
            "SELECT * FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?",
            (field["id"], field["id"]))]
        touched_edges = {usage["edge_id"] for usage in usages}
        requirements = [dict(row) for row in self.db.execute(
            "SELECT * FROM data_requirements WHERE source_field_id=?", (field["id"],))]
        with self.db:
            for usage in usages:
                self.db.execute("DELETE FROM edge_field_usages WHERE id=?", (usage["id"],))
                self._event(actor, "delete", "field_usage", usage["id"], before=usage)
            for requirement in requirements:
                self.db.execute("UPDATE data_requirements SET source_field_id=NULL, updated_at=? WHERE id=?",
                                (now(), requirement["id"]))
                self._event(actor, "update", "data_requirement", requirement["id"],
                            requirement, self.get_requirement(requirement["id"]))
            self.db.execute("DELETE FROM node_fields WHERE id=?", (field["id"],))
            self._event(actor, "delete", "field", field["id"], before=field)
            for edge_id in touched_edges:
                if not self._one("SELECT id FROM edge_field_usages WHERE edge_id=?", (edge_id,)):
                    edge = self.get_edge(edge_id)
                    self.db.execute("DELETE FROM edges WHERE id=?", (edge_id,))
                    self._event(actor, "delete", "edge", edge_id, before=edge)
        return {"deleted": field["id"], "source_node_id": source["id"]}

    def find_name(self, name):
        return self._one("SELECT * FROM nodes WHERE name=? COLLATE NOCASE", (name.strip(),))

    def create_node(self, data, actor="user", commit=True):
        name = str(data.get("name", "")).strip()
        node_type = data.get("type", "Metric")
        if not name:
            raise GraphError("Name is required")
        if node_type not in TYPES:
            raise GraphError("Invalid node type")
        if node_type in STATE_TYPES and actor != "system":
            raise GraphError("System state nodes are created by the application")
        workflow_lane = data.get("workflow_lane", DEFAULT_LANES.get(node_type, "signal"))
        if workflow_lane not in WORKFLOW_LANES:
            raise GraphError("Invalid workflow lane")
        if self.find_name(name):
            raise GraphError(f"Node already exists: {name}")
        signal_key = str(data.get("signal_key", "") or "").strip()
        if signal_key and (node_type not in ("Metric", "Score", "Ranking", "Rule Evaluation", "Signal Event")
                           or not re.fullmatch(r"[a-z][a-z0-9_]*", signal_key)
                           or self.find_signal_key(signal_key)):
            raise GraphError("Invalid or duplicate signal key")
        stamp, node_id = now(), uid()
        grouped = self._one("SELECT value FROM schema_meta WHERE key=?",
                            (GROUPED_NODE_REFERENCE_MARKER,))
        group = self._node_reference_group(node_type) if grouped else None
        requested_group = data.get("reference_group")
        if grouped and requested_group is not None:
            if node_type not in CHOOSABLE_REFERENCE_GROUP_TYPES or str(requested_group) not in {"3", "4"}:
                raise GraphError("Invalid reference group for node type")
            group = int(requested_group)
        number_key = f"next_node_number_{group}" if grouped else "next_node_number"
        reference_number = int(self._one(
            "SELECT value FROM schema_meta WHERE key=?", (number_key,))["value"])
        if grouped and reference_number >= (group + 1) * 1000:
            raise GraphError(f"Reference range {group}xxx is full")
        detail_fields = tuple(key for key in TEXT_FIELDS if key not in ("name", "type")) + SIGNAL_DESIGN_FIELDS
        values = {key: str(data.get(key, "") or "") for key in detail_fields}
        if "position_x" not in data and "position_y" not in data:
            last_x = self.db.execute("SELECT MAX(position_x) FROM nodes").fetchone()[0]
            default_x, default_y = (float(last_x) + 270, 220) if last_x is not None else (0, 0)
        else:
            default_x, default_y = 0, 0
        try:
            x, y = float(data.get("position_x", default_x)), float(data.get("position_y", default_y))
        except (ValueError, TypeError):
            raise GraphError("Position must be numeric")
        columns = ("id", "reference_number", "name", "type", "workflow_lane", "signal_key") + detail_fields + ("position_x", "position_y", "created_at", "updated_at")
        self.db.execute(f"INSERT INTO nodes ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                        (node_id, reference_number, name, node_type, workflow_lane, signal_key,
                         *(values[key] for key in detail_fields), x, y, stamp, stamp))
        self.db.execute("UPDATE schema_meta SET value=? WHERE key=?",
                        (str(reference_number + 1), number_key))
        node = self.get_node(node_id)
        self._event(actor, "create", "node", node_id, after=node)
        if commit:
            self.db.commit()
        return node

    def update_node(self, node_id, data, actor="user"):
        before = self.get_node(node_id)
        changes = {key: data[key] for key in NODE_FIELDS if key in data}
        if not changes:
            return before
        if before["signal_key"] and "type" in changes and changes["type"] != before["type"]:
            raise GraphError("Versioned signal nodes cannot change type")
        if before["is_catalog_source"] and any(
                key in changes and changes[key] != before[key]
                for key in ("name", "type", "workflow_lane")):
            raise GraphError("Base crawler nodes cannot be renamed or changed to another type or lane")
        if before["is_system_state"] and any(key not in ("position_x", "position_y") for key in changes):
            raise GraphError("System state nodes can only be moved")
        if "name" in changes:
            changes["name"] = str(changes["name"]).strip()
            if not changes["name"]:
                raise GraphError("Name is required")
            existing = self.find_name(changes["name"])
            if existing and existing["id"] != node_id:
                raise GraphError("Node name already exists")
        if "type" in changes and changes["type"] not in TYPES:
            raise GraphError("Invalid node type")
        if "type" in changes and changes["type"] in STATE_TYPES:
            raise GraphError("System state nodes are created by the application")
        if "type" in changes and "workflow_lane" not in changes and changes["type"] != before["type"]:
            changes["workflow_lane"] = DEFAULT_LANES.get(changes["type"], "signal")
        if "workflow_lane" in changes and changes["workflow_lane"] not in WORKFLOW_LANES:
            raise GraphError("Invalid workflow lane")
        for key in TEXT_FIELDS + SIGNAL_DESIGN_FIELDS:
            if key in changes and key not in ("name", "type"):
                changes[key] = str(changes[key] or "")
        for key in ("position_x", "position_y"):
            if key in changes:
                try:
                    changes[key] = float(changes[key])
                except (ValueError, TypeError):
                    raise GraphError("Position must be numeric")
        changes["updated_at"] = now()
        assignments = ", ".join(f"{key}=?" for key in changes)
        self.db.execute(f"UPDATE nodes SET {assignments} WHERE id=?", (*changes.values(), node_id))
        after = self.get_node(node_id)
        self._event(actor, "update", "node", node_id, before, after)
        self.db.commit()
        return after

    def update_layout(self, data, actor="user"):
        positions = data.get("positions") if isinstance(data, dict) else None
        if not isinstance(positions, list):
            raise GraphError("Positions must be a list")
        current = {node["id"]: node for node in self.graph()["nodes"]}
        if len(positions) != len(current):
            raise GraphError("Layout must include every node exactly once")
        updated = {}
        for item in positions:
            if not isinstance(item, dict) or item.get("id") not in current or item["id"] in updated:
                raise GraphError("Layout contains an unknown or duplicate node")
            try:
                x, y = float(item["position_x"]), float(item["position_y"])
            except (KeyError, ValueError, TypeError):
                raise GraphError("Position must be numeric")
            if not math.isfinite(x) or not math.isfinite(y):
                raise GraphError("Position must be finite")
            updated[item["id"]] = (x, y)
        before = {node_id: [node["position_x"], node["position_y"]] for node_id, node in current.items()}
        stamp = now()
        with self.db:
            self.db.executemany(
                "UPDATE nodes SET position_x=?, position_y=?, updated_at=? WHERE id=?",
                [(x, y, stamp, node_id) for node_id, (x, y) in updated.items()],
            )
            self._event(actor, "layout", "graph", "all", before,
                        {node_id: list(position) for node_id, position in updated.items()})
        return {"updated": len(updated)}

    def delete_node(self, node_id, actor="user"):
        before = self.get_node(node_id)
        if before["is_catalog_source"] or before["is_system_state"]:
            raise GraphError("Base crawler and system state nodes cannot be deleted")
        connected = [dict(row) for row in self.db.execute(
            "SELECT * FROM edges WHERE upstream_id=? OR downstream_id=?", (node_id, node_id))]
        fields = self.get_fields(node_id)
        requirements = self.get_requirements(node_id)
        with self.db:
            for edge in connected:
                for usage in self.get_field_usages(edge["id"]):
                    self._event(actor, "delete", "field_usage", usage["id"], before=usage)
                self._event(actor, "delete", "edge", edge["id"], before=edge)
            for field in fields:
                self._event(actor, "delete", "field", field["id"], before=field)
            for requirement in requirements:
                self._event(actor, "delete", "data_requirement", requirement["id"], before=requirement)
            self.db.execute("DELETE FROM nodes WHERE id=?", (node_id,))
            self._event(actor, "delete", "node", node_id, before=before)
        return {"deleted": node_id}

    def _reachable(self, start, target):
        pending, seen = [start], set()
        while pending:
            current = pending.pop()
            if current == target:
                return True
            if current in seen:
                continue
            seen.add(current)
            pending.extend(row[0] for row in self.db.execute(
                "SELECT edges.downstream_id FROM edges JOIN nodes ON nodes.id=edges.downstream_id "
                "WHERE edges.upstream_id=? AND nodes.is_system_state=0", (current,)))
        return False

    def create_edge(self, data, actor="user", commit=True):
        upstream = data.get("upstream_id")
        downstream = data.get("downstream_id")
        source_node = self.get_node(upstream)
        target_node = self.get_node(downstream)
        if upstream == downstream:
            raise GraphError("A node cannot depend on itself")
        if self._one("SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?", (upstream, downstream)):
            raise GraphError("Connection already exists")
        if not target_node["is_system_state"] and self._reachable(downstream, upstream):
            raise GraphError("Connection would create a dependency cycle")
        transport = self._transport_data(data)
        if source_node["is_system_state"] or target_node["is_system_state"]:
            if transport["transport_kind"] == "redpanda":
                raise GraphError("Table access cannot use a Redpanda transport edge")
            transport["transport_kind"] = "direct"
        edge_id = uid()
        reference_number = int(self._one(
            "SELECT value FROM schema_meta WHERE key='next_edge_number'")["value"])
        self.db.execute("""INSERT INTO edges
          (id,reference_number,upstream_id,downstream_id,rationale,created_at,transformation,
           transport_kind,transport_topic,transport_key,payload_schema,transport_headers,consumer_group,branch_label)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (edge_id, reference_number, upstream, downstream,
            str(data.get("rationale", "") or ""), now(),
            str(data.get("transformation", "") or ""), *(transport[key] for key in
            ("transport_kind", "transport_topic", "transport_key", "payload_schema", "transport_headers", "consumer_group")),
            str(data.get("branch_label", "") or "").strip()))
        self.db.execute("UPDATE schema_meta SET value=? WHERE key='next_edge_number'",
                        (str(reference_number + 1),))
        edge = self._one("SELECT * FROM edges WHERE id=?", (edge_id,))
        self._event(actor, "create", "edge", edge_id, after=edge)
        if commit:
            self.db.commit()
        return edge

    def get_edge(self, edge_id):
        edge = self._one("SELECT * FROM edges WHERE id=?", (edge_id,))
        if not edge:
            raise GraphError("Connection not found")
        return edge

    def update_edge(self, edge_id, data, actor="user"):
        before = self.get_edge(edge_id)
        changes = {key: str(data[key] or "").strip() if key == "branch_label" else str(data[key] or "")
                   for key in ("rationale", "transformation", "branch_label") if key in data}
        if any(key in data for key in ("transport_kind", "transport_topic", "transport_key", "payload_schema", "transport_headers", "consumer_group")):
            changes.update(self._transport_data({**before, **data}))
        if self.get_node(before["upstream_id"])["is_system_state"] or self.get_node(before["downstream_id"])["is_system_state"]:
            if changes.get("transport_kind") == "redpanda":
                raise GraphError("Table access cannot use a Redpanda transport edge")
            if "transport_kind" in changes:
                changes["transport_kind"] = "direct"
        if not changes:
            return before
        self.db.execute("UPDATE edges SET " + ", ".join(f"{key}=?" for key in changes) + " WHERE id=?",
                        (*changes.values(), edge_id))
        after = self.get_edge(edge_id)
        self._event(actor, "update", "edge", edge_id, before, after)
        self.db.commit()
        return after

    def _transport_data(self, data):
        kind = str(data.get("transport_kind", "unspecified") or "unspecified")
        if kind not in TRANSPORT_KINDS:
            raise GraphError("Invalid transport kind")
        if kind != "redpanda":
            return {"transport_kind": kind, "transport_topic": "", "transport_key": "",
                    "payload_schema": "", "transport_headers": "[]", "consumer_group": ""}
        topic = str(data.get("transport_topic", "") or "").strip()
        if not topic:
            raise GraphError("Redpanda topic is required")
        raw_headers = data.get("transport_headers", "[]")
        try:
            headers = json.loads(raw_headers) if isinstance(raw_headers, str) else raw_headers
        except (TypeError, ValueError):
            raise GraphError("Invalid Redpanda headers")
        if not isinstance(headers, list) or any(not isinstance(item, dict) or
            not isinstance(item.get("name"), str) or not item["name"].strip() or
            not isinstance(item.get("description", ""), str) or
            not isinstance(item.get("consumed", False), bool) for item in headers):
            raise GraphError("Invalid Redpanda headers")
        names = [item["name"].strip().lower() for item in headers]
        if len(names) != len(set(names)):
            raise GraphError("Duplicate Redpanda header")
        return {"transport_kind": kind, "transport_topic": topic,
                "transport_key": str(data.get("transport_key", "") or "").strip(),
                "payload_schema": str(data.get("payload_schema", "") or "").strip(),
                "consumer_group": str(data.get("consumer_group", "") or "").strip(),
                "transport_headers": json.dumps([{"name": item["name"].strip(),
                    "description": item.get("description", "").strip(),
                    "consumed": item.get("consumed", False)} for item in headers], ensure_ascii=False)}

    def get_field_usages(self, edge_id):
        self.get_edge(edge_id)
        return [dict(row) for row in self.db.execute(
            "SELECT * FROM edge_field_usages WHERE edge_id=? ORDER BY created_at", (edge_id,))]

    def create_field_usage(self, edge_id, data, actor="user", commit=True):
        edge = self.get_edge(edge_id)
        source = self.get_field(data.get("source_field_id"))
        if source["node_id"] != edge["upstream_id"]:
            raise GraphError("Source field must belong to the upstream node")
        target_id = data.get("target_field_id") or None
        if target_id:
            target = self.get_field(target_id)
            if target["node_id"] != edge["downstream_id"]:
                raise GraphError("Target field must belong to the downstream node")
        duplicate = self._one("""SELECT id FROM edge_field_usages
          WHERE edge_id=? AND source_field_id=? AND target_field_id IS ?""",
          (edge_id, source["id"], target_id))
        if duplicate:
            raise GraphError("This field mapping already exists")
        usage_id = uid()
        reference_number = int(self._one(
            "SELECT value FROM schema_meta WHERE key='next_usage_number'")["value"])
        self.db.execute("""INSERT INTO edge_field_usages
            (id,reference_number,edge_id,source_field_id,target_field_id,usage_note,created_at)
            VALUES (?,?,?,?,?,?,?)""",
            (usage_id, reference_number, edge_id, source["id"], target_id,
             str(data.get("usage_note", "") or ""), now()))
        self.db.execute("UPDATE schema_meta SET value=? WHERE key='next_usage_number'",
                        (str(reference_number + 1),))
        usage = self._one("SELECT * FROM edge_field_usages WHERE id=?", (usage_id,))
        self._event(actor, "create", "field_usage", usage_id, after=usage)
        if commit:
            self.db.commit()
        return usage

    def update_field_usage(self, usage_id, data, actor="user"):
        before = self._one("SELECT * FROM edge_field_usages WHERE id=?", (usage_id,))
        if not before:
            raise GraphError("Field usage not found")
        changes = {}
        if "target_field_id" in data:
            target_id = data["target_field_id"] or None
            if target_id:
                target = self.get_field(target_id)
                edge = self.get_edge(before["edge_id"])
                if target["node_id"] != edge["downstream_id"]:
                    raise GraphError("Target field must belong to the downstream node")
            duplicate = self._one("""SELECT id FROM edge_field_usages
                WHERE edge_id=? AND source_field_id=? AND target_field_id IS ? AND id!=?""",
                (before["edge_id"], before["source_field_id"], target_id, usage_id))
            if duplicate:
                raise GraphError("This field mapping already exists")
            changes["target_field_id"] = target_id
        if "usage_note" in data:
            changes["usage_note"] = str(data["usage_note"] or "")
        if not changes:
            return before
        self.db.execute("UPDATE edge_field_usages SET " + ", ".join(
            key + "=?" for key in changes) + " WHERE id=?", (*changes.values(), usage_id))
        after = self._one("SELECT * FROM edge_field_usages WHERE id=?", (usage_id,))
        self._event(actor, "update", "field_usage", usage_id, before, after)
        self.db.commit()
        return after

    def delete_field_usage(self, usage_id, actor="user"):
        usage = self._one("SELECT * FROM edge_field_usages WHERE id=?", (usage_id,))
        if not usage:
            raise GraphError("Field mapping not found")
        self.db.execute("DELETE FROM edge_field_usages WHERE id=?", (usage_id,))
        self._event(actor, "delete", "field_usage", usage_id, before=usage)
        self.db.commit()
        return {"deleted": usage_id}

    def delete_edge(self, edge_id, actor="user"):
        edge = self.get_edge(edge_id)
        with self.db:
            for usage in self.get_field_usages(edge_id):
                self._event(actor, "delete", "field_usage", usage["id"], before=usage)
            self.db.execute("DELETE FROM edges WHERE id=?", (edge_id,))
            self._event(actor, "delete", "edge", edge_id, before=edge)
        return {"deleted": edge_id}

    def neighbors(self, node_id, direction="upstream", hops=1):
        self.get_node(node_id)
        if direction not in ("upstream", "downstream"):
            raise GraphError("Invalid direction")
        hops = max(1, min(int(hops), 20))
        source, target = ("downstream_id", "upstream_id") if direction == "upstream" else ("upstream_id", "downstream_id")
        visited, frontier = {node_id}, {node_id}
        result = []
        for depth in range(1, hops + 1):
            next_frontier = set()
            for current in frontier:
                for row in self.db.execute(f"SELECT {target} FROM edges WHERE {source}=?", (current,)):
                    related = row[0]
                    if related not in visited:
                        visited.add(related)
                        next_frontier.add(related)
                        result.append({**self.get_node(related), "depth": depth})
            frontier = next_frontier
            if not frontier:
                break
        return result

    def get_upstream(self, node_id, hops=1):
        return self.neighbors(node_id, "upstream", hops)

    def get_downstream(self, node_id, hops=1):
        return self.neighbors(node_id, "downstream", hops)

    def get_impact(self, node_id):
        return self.get_downstream(node_id, 20)

    def get_context(self, node_id, hops=2):
        node = self.get_node(node_id)
        upstream = self.get_upstream(node_id, hops)
        downstream = self.get_downstream(node_id, hops)
        product_modules = [item for item in self.get_impact(node_id) if item["type"] == "Product Module"]
        ids = {node_id, *(item["id"] for item in upstream + downstream)}
        edges = [dict(row) for row in self.db.execute("SELECT * FROM edges")
                 if row["upstream_id"] in ids and row["downstream_id"] in ids]
        fields = [dict(row) for row in self.db.execute("SELECT * FROM node_fields") if row["node_id"] in ids]
        edge_ids = {edge["id"] for edge in edges}
        field_usages = [dict(row) for row in self.db.execute("SELECT * FROM edge_field_usages")
                        if row["edge_id"] in edge_ids]
        return {"node": node, "upstream": upstream, "downstream": downstream,
                "product_modules": product_modules, "edges": edges,
                "fields": fields, "field_usages": field_usages}

    def propose(self, prompt):
        """Produce a draft without mutating graph state."""
        prompt = str(prompt or "").strip()
        if not prompt:
            raise GraphError("Describe the change first")
        if os.environ.get("OPENAI_API_KEY"):
            return self._propose_with_model(prompt)
        return self._propose_locally(prompt)

    def _propose_with_model(self, prompt):
        nodes = [{"name": row["name"], "type": row["type"]} for row in self.search_nodes()]
        node_schema = {"type": "object", "properties": {
            key: {"type": "string", **({"enum": list(TYPES)} if key == "type" else {})}
            for key in TEXT_FIELDS}, "required": list(TEXT_FIELDS), "additionalProperties": False}
        schema = {"type": "object", "properties": {
            "node": node_schema,
            "upstream_names": {"type": "array", "items": {"type": "string"}},
            "downstream_names": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
        }, "required": ["node", "upstream_names", "downstream_names", "warnings"],
           "additionalProperties": False}
        payload = {"model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"), "store": False,
            "input": [
                {"role": "system", "content": (
                    "You draft changes for a SignalStudio design graph. Return one NEW node and its dependency edges. "
                    "Use exactly the existing node names supplied for upstream_names and downstream_names. "
                    "An upstream node is a dependency of the new node. A downstream node depends on the new node. "
                    "Never invent existing nodes. Keep definition, rationale, caveats, formula, and notes distinct. "
                    "Return warnings for ambiguity. Do not execute changes. Existing nodes: "
                    + json.dumps(nodes, ensure_ascii=False))},
                {"role": "user", "content": prompt},
            ],
            "text": {"format": {"type": "json_schema", "name": "logic_change_proposal",
                                "strict": True, "schema": schema}}}
        request = Request("https://api.openai.com/v1/responses",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Authorization": f"Bearer {os.environ['OPENAI_API_KEY']}",
                     "Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=30) as response:
                result = json.load(response)
        except HTTPError as exc:
            raise GraphError(f"Model request failed (HTTP {exc.code})")
        except URLError as exc:
            raise GraphError(f"Model request failed: {exc.reason}")
        if result.get("status") != "completed":
            raise GraphError("Model did not complete a proposal")
        texts = [item.get("text", "") for output in result.get("output", [])
                 if output.get("type") == "message" for item in output.get("content", [])
                 if item.get("type") == "output_text"]
        if not texts:
            raise GraphError("Model returned no proposal")
        try:
            draft = json.loads("".join(texts))
        except json.JSONDecodeError:
            raise GraphError("Model returned an invalid proposal")
        draft["node"]["name"] = draft["node"]["name"].strip()
        if not draft["node"]["name"] or self.find_name(draft["node"]["name"]):
            raise GraphError("Proposed node name is empty or already exists")
        for name in draft["upstream_names"] + draft["downstream_names"]:
            if not self.find_name(name):
                raise GraphError(f"Model referenced an unknown node: {name}")
        return {"prompt": prompt, "source": "model", **draft}

    def _propose_locally(self, prompt):
        """Small, inspectable parser used without a configured API key."""
        names = [row["name"] for row in self.search_nodes()]
        marker = re.search(r"(?:创建|新增|添加|create|add)\s*(?:一个|一项|a\s+)?\s*([\w\u4e00-\u9fff][\w\u4e00-\u9fff\s-]*?)\s*(?:指标|评分|榜单|模块|字段|数据源)?(?:，|,|。|\.|，用来|，用于|\s+that\b|\s+which\b|$)", prompt, re.I)
        if not marker:
            raise GraphError("目前支持“创建/新增 [名称]，依赖 [已有节点]”格式")
        name = marker.group(1).strip()
        for suffix in (" 指标", " 评分", " 榜单", " 模块", " 字段", " 数据源"):
            if name.endswith(suffix):
                name = name[:-len(suffix)].strip()
        if not name or self.find_name(name):
            raise GraphError("拟创建的节点名称为空或已存在")
        node_type = "Metric"
        for word, kind in (("榜单", "Ranking"), ("模块", "Product Module"), ("评分", "Score"), ("分数", "Score"), ("字段", "Derived Field"), ("数据源", "Source")):
            if word in prompt[:marker.end()]:
                node_type = kind
                break
        # Match existing names in the prompt, longest first to avoid partial matches.
        occupied = []
        mentioned = []
        for candidate in sorted(names, key=len, reverse=True):
            if candidate.lower() == name.lower():
                continue
            for match in re.finditer(re.escape(candidate), prompt, re.I):
                start, end = match.span()
                if not any(start < old_end and end > old_start for old_start, old_end in occupied):
                    occupied.append((start, end))
                    mentioned.append(candidate)
                    break
        upstream, downstream = [], []
        downstream_clause = re.search(r"(?:被|供|用于|used by|feeds)\s*([^。；;]+)", prompt, re.I)
        downstream_text = downstream_clause.group(1) if downstream_clause else ""
        for existing in mentioned:
            if existing.lower() in downstream_text.lower():
                downstream.append(existing)
            else:
                upstream.append(existing)
        definition_match = re.search(r"(?:用来|用于|以便|to\s+)([^。；;]+)", prompt, re.I)
        definition = definition_match.group(1).strip() if definition_match else ""
        return {"prompt": prompt, "source": "local", "node": {"name": name, "type": node_type,
                "definition": definition}, "upstream_names": upstream,
                "downstream_names": downstream,
                "warnings": [] if upstream or downstream else ["没有识别到现有节点；请检查名称或之后手动连线。"]}

    def apply_proposal(self, proposal):
        node_data = proposal.get("node") or {}
        upstream_names = proposal.get("upstream_names") or []
        downstream_names = proposal.get("downstream_names") or []
        # Resolve every reference before beginning the transaction.
        upstream = [self.find_name(name) for name in upstream_names]
        downstream = [self.find_name(name) for name in downstream_names]
        if any(item is None for item in upstream + downstream):
            raise GraphError("A referenced node no longer exists")
        try:
            with self.db:
                node = self.create_node(node_data, actor="proposal", commit=False)
                for item in upstream:
                    self.create_edge({"upstream_id": item["id"], "downstream_id": node["id"]}, actor="proposal", commit=False)
                for item in downstream:
                    self.create_edge({"upstream_id": node["id"], "downstream_id": item["id"]}, actor="proposal", commit=False)
            return node
        except Exception:
            self.db.rollback()
            raise
