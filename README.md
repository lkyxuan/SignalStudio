# Data Logic IDE

A local-first design workspace for the definitions, formulas, reasons, caveats and dependencies behind a data product.

## Run

Requires Node.js 22+ and Python 3.9+.

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The API runs on port 8787. The SQLite file is created at `data/logic.db`. Startup removes unused V2 record-type nodes and keeps the app-owned upstream operations as the source baseline. A one-time migration closes gaps left by that retirement; later deletions do not reuse reference numbers.

Vite also listens on network interfaces. To open the development site from another device in the same Tailscale network, run `tailscale ip -4` on this machine and visit `http://<that-ip>:5173` on the other device. The API continues to run locally behind Vite's `/api` proxy.

For a single-server build:

```bash
npm run build
npm run preview
```

Then open [http://127.0.0.1:8787](http://127.0.0.1:8787).

## What is in the MVP

- Eighteen visible design node types and directed dependency edges. The library separates data sources, processing steps, business tables, and outputs. `assets`, `asset_identifiers`, `asset_relationships`, and `asset_monitoring_rules` are fixed, connectable table references with a distinct appearance. They name planned access targets; no live business tables or records are connected. Overview shows every source and table in one graph, including unconnected references; Signal path and Asset knowledge path filter that same graph. Processing steps and table access edges are not created automatically.
- Signal-first planning: create a signal node, describe each input data need and its expected example, then match a crawler field when one exists. Unmatched needs remain visible on the graph and can be copied as a request for the crawler team. Matching a field creates the Source, connection, and field usage while retaining the original need.
- A signal design guide in each signal node keeps the decision question, observation window, calculation, trigger rule, output contract, validation plan, and recorded observations together. Its checklist counts documented design elements; it does not claim the signal works until real data has been evaluated.
- Per-operation field catalogs backed by `catalog/source-contracts.v1.json`. The contract defines 8 upstream sources, 36 operations, 2 Kaito MCP reference resources, and currently 265 field entries selected from official references and saved API/MCP responses. Each operation and reference resource has its own Source node. Sample paths are lower bounds or planned selections, never proof of exhaustive output or live crawler emission.
- The **字段用途与案例** view reads the same app-owned contract as the field picker and source-node details. It shows each field's original path, purpose, evidence class, and labeled example value. The legacy V2 record-type directory is no longer loaded by the product.
- The [source field audit](docs/SOURCE_FIELD_AUDIT.md) tracks all eight upstreams against their documentation and pinned crawler code. The [source input audit](docs/SOURCE_INPUT_AUDIT.md) lists required and optional call parameters for every upstream operation, with unknown contracts marked explicitly. The [Few Understand integration contract](docs/FEWUNDERSTAND_INTEGRATION.md) specifies how that crawler project should consume the app-owned contract and report implementation evidence back. Each source node shows its input and output evidence. The saved DEX Screener response expands one `pairs[0]` object into individual cards; it is an upstream sample, not evidence of a crawler message.
- User-created output fields can specify a unit, numeric range, and calculation or normalization rule. Catalog examples come only from labeled API responses, upstream test fixtures, or reviewed v2 illustrations; the app does not invent values at runtime.
- Field-level connection mappings and transformation explanations showing which inputs produce a downstream output.
- An input/output summary on each node: incoming fields are grouped by upstream connection, while output fields belong to the node. Field name, type, and optional example value are visible together. Click an input source to inspect its connection, or an output field to see its direct downstream field mappings.
- Per-connection transport metadata. Mark a connection as direct or Redpanda; Redpanda connections record topic, message key, payload schema reference and named headers. Existing connections remain unspecified until reviewed.
- Graph, table and editable detail panel over the same persisted model.
- One-click node arrangement by dependency. Use **整理节点** in the graph toolbar to space out cards, fit the view, and save their positions.
- Upstream, downstream, impact and bounded context service operations.
- Validated node and edge writes, cycle prevention, and an append-only change log.
- A natural-language draft flow for creating nodes with named dependencies. With `OPENAI_API_KEY` configured, it uses the OpenAI Responses API with a strict JSON schema. Without a key, a limited local parser keeps the MVP usable. Both paths require confirmation before applying changes.

For model-backed drafts, start the app with `OPENAI_API_KEY` in the server environment. `OPENAI_MODEL` optionally selects a model; the default is `gpt-4o-mini`. The API request sends the draft prompt and the current node names and types to OpenAI, with `store: false`. Keys stay on the server. Model access and billing are supplied by your own API account. The integration follows the [official OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs).

The architectural decisions and staged implementation plan are in [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md).

For asynchronous development, use the dedicated Hermes Kanban workflow in [docs/DEVELOPMENT_BOARD.md](docs/DEVELOPMENT_BOARD.md). The versioned Hermes profile identity and Mac setup steps are in [ops/hermes/](ops/hermes/README.md); repository instructions are in [AGENTS.md](AGENTS.md).

The app-owned source contract is the product baseline for desired upstream inputs, not proof of crawled business records. Open supplier objects may contain more keys than the saved samples show. Few Understand should implement this contract and report actual run evidence separately. On startup, unused V2 record-type nodes are retired; the migration refuses to discard a node with a design connection or matched data need. Once those nodes are retired, a one-time migration makes surviving node references consecutive while preserving their internal IDs and graph data. Later deletions do not reuse numbers. When changing the upstream contract, regenerate and review its revision before providing it to Few Understand.

To design a new signal, create a Metric or Score node and define the result in its inspector. Under **需要的数据**, list the inputs needed to produce it. Use **去爬虫里找** to search the bundled crawler fields and match one to the need. Keep any unmatched needs as the working backlog for crawler updates; the expandable brief is a draft to copy and discuss, not an automatic request or data collection job.

The signal inspector now follows four questions: **what should this signal tell us**, **which data does it need**, **how is it calculated and interpreted**, and **how will we test it**. Recording a test plan and observations is a design aid; this application does not compute or backtest the signal yet.

The proposed business data model for the crypto signal platform is in [docs/ASSET_MODEL.md](docs/ASSET_MODEL.md). It is a design proposal; the asset tables and data pipeline are not implemented in this MVP.

The graph can now sketch two paths from the same observations: one toward metrics and signal events, and one toward proposed asset identity or relationship updates. Evidence Check and Review Decision are design steps for coverage and human or policy review. Asset Resolution reads `asset_identifiers` and `assets` to identify or bind an observation or result; it can precede an asset-level aggregation or follow a result computed at a source or market level. Relationship Lookup reads `asset_relationships` and `assets` after a signal or before a product view. An edge from a table node to a step denotes a planned read; an edge into a table node denotes a proposed update. The edge inspector records the access contract. Because graph edges describe acyclic processing dependencies, do not draw a same-run feedback loop into a table. A future implementation will read versioned asset state on each run and write reviewed updates separately.

The intended collaboration between the user and a future in-product signal assistant is recorded in [docs/PRODUCT_WORKFLOW.md](docs/PRODUCT_WORKFLOW.md). Codex project guidance is in [AGENTS.md](AGENTS.md). The current natural-language node proposal does not implement that assistant workflow.

The first versioned, machine-readable signal package is described in [docs/SIGNAL_EXECUTION_CONTRACT.md](docs/SIGNAL_EXECUTION_CONTRACT.md). Run `python3 scripts/seed_example_signal.py` once to add its graph-backed design to the current SQLite project; `GET /api/signals/coingecko_market_turnover_candidate/package` then returns the complete implementation proposal and its readiness checks. It is a design hypothesis with no observed crawler run or validated signal result.
The package also marks Few Understand as the target implementation platform and Python + Polars as the preferred calculation stack. These are implementation suggestions; the required calculation and output remain explicit in the signal definition, and implementation reports record the stack actually chosen.

## Verify

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s server -p 'test_*.py'
npm run test:layout
npm run build
```
