# Data Logic IDE: MVP plan

## Core abstraction

Nodes are independently defined logic units, not columns owned by tables. Each node may describe multiple fields it provides; a `Source` can therefore represent a crawler with many output fields. A directed `depends_on` edge stores that a downstream node needs an upstream node. The edge also records which upstream fields are consumed, which downstream field they help produce, and how the inputs are transformed. `used_by` is the reverse query. Graph, table and detail views read this same model.

## Minimal model

- `nodes`: `id`, `name`, `type`, `definition`, `formula`, `rationale`, `caveats`, `notes`, `position_x`, `position_y`, `created_at`, `updated_at`, plus signal design fields `decision_question`, `observation_window`, `trigger_rule`, `validation_plan`, and `validation_evidence`.
- `data_requirements`: per-node desired inputs, their purpose and expected example, with an optional matched source field. Requirements can precede any available crawler field.
- `node_fields`: stable `id`, `node_id`, `name`, `data_type`, `definition`, `notes`, optional `example_value`, order and timestamps. These are field definitions and illustrations, not business records.
- `edges`: `id`, `upstream_id`, `downstream_id`, `rationale`, `transformation`, `created_at`. Unique pair, no self edge or cycle.
- `edges` also records `transport_kind` (`unspecified`, `direct`, `redpanda`). Redpanda connections can store `transport_topic`, `transport_key`, `payload_schema`, and a JSON list of header names, meanings, and whether the consumer reads each header. Headers describe message metadata, not payload fields. A direct connection clears Redpanda-only metadata.
- `edge_field_usages`: `edge_id`, `source_field_id`, optional `target_field_id`, `usage_note`. Several source fields can point to one produced field. Endpoint ownership is validated.
- A node's input view is assembled from all incoming edges and their field usages, grouped by source. Its output view reads its own `node_fields`. A pass-through Redpanda message references the upstream payload schema and maps only the fields the consumer reads; if publication changes the payload, model that changed schema as a separate producing node.
- `change_events`: append-only audit records with actor, action, entity, before and after JSON, timestamp. This is a small foundation for future history and rollback.

## Architecture

React + XYFlow client -> JSON HTTP API -> Python standard-library service layer -> SQLite. The service layer owns validation, traversal, mutation and audit. Graph and table fetch the same `/api/graph` response. The natural-language proposal route produces a draft only; `/api/proposals/apply` revalidates and applies it transactionally after explicit UI confirmation. An optional Responses API proposer receives the user's prompt plus node names and types and returns a strict structured draft. Without an API key, a limited local parser handles simple create requests.

## Directory structure

```text
src/main.jsx              Graph, table, detail, and proposal review UI
src/style.css              Interface styling
src/FieldPanels.jsx       Node field catalog and connection mapping editor
server/graph_service.py    Domain operations, validation, traversal, legacy cleanup, proposals
server/app.py              Local JSON API and built-client server
server/test_graph_service.py Service tests
data/logic.db              Local SQLite database, created on first run
docs/IMPLEMENTATION_PLAN.md Design and implementation scope
```

The service exposes node, field, edge and field-usage CRUD; `search_nodes`, `get_upstream`, `get_downstream`, `get_impact`, `search_by_description`, and bounded `get_context`. The UI and future AI tools call the service through HTTP instead of touching SQLite directly.

## Upcoming crawler metadata import

When the crawler API is available, an importer can map each crawler to a `Source` node and upsert its field definitions. Source field IDs must remain stable so existing edge mappings survive metadata refreshes. API examples can populate field `example_value` after review. The importer should not ingest crawled business rows into this design tool.

## Scope

MVP: node, field, edge and field-usage CRUD; graph movement/zoom/connect/disconnect; detail editing; table; direct upstream/downstream; transitive impact and product usage; local persistence; catalog crawler sources; natural-language draft for adding a node and dependencies. The local parser is intentionally small and transparent. The optional model path uses the same confirmation and write path.

Deferred: data computation, SQL execution, ETL, crawling, dashboards, accounts, enterprise catalog, full version control, autonomous graph mutations.

## Implementation sequence

1. Define schema, load the declared crawler catalog, and implement a validated graph service.
2. Expose service operations through local HTTP endpoints; keep proposal generation separate from writes.
3. Build graph, table, detail and draft review interfaces against one API.
4. Verify CRUD, edge validation, persistence, traversal and proposal confirmation with service tests and a browser smoke test.
