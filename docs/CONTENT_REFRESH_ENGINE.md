# Asset webpage refresh and Grokbot boundary

Current user decisions: [SS-120](https://app.notion.com/p/3fd038a63d5a81468d9aef141cac8f3f),
2026-10-19, following [SS-116](https://app.notion.com/p/3fd038a63d5a81a1bbcacd4423528524). Current contracts are `catalog/asset-grokbot-flow.v1.json` and
`catalog/asset-pages.v1.json`. Delivery is Studio design only, with no crawler, webpage
reader, generator, scheduler or production business storage deployed by these cards.

## Current flow

1. #3027 selects qualified candidate assets from the existing warming, hottest and new-asset
   boards, using the existing per-board selection rules and deduplicating stable asset UUIDs.
2. #3029 reads #1039 `asset_pages` by each candidate UUID. A successful complete missing-row
   lookup means first creation. For an existing page, compare its last successful `updated_at`
   with the configured whole-page interval. The daily versus three-day interval is undecided
   and remains null; an existing page cannot be classified as expired without a configured
   interval. Unknown, malformed or future times and failed/partial reads need review.
3. Only first-creation or due-update items enter #3045 **Grokbot · 制作或更新资产网页**.
   Its existing UUID, number and display positions are preserved. Input contains the asset UUID,
   action, reason, page age and existing webpage reference. The identifiers table is a non-triggering
   identity lookup, not an execution event.
4. Grokbot owns research and subsequent execution of the internal production workflow, including
   gathering token information, finding gaps, organizing content, generating the page and self-checks.
   These are responsibilities, not a fixed sequence. The two required tool paths are **external APIs/search**
   and **SignalStudio reads of existing entity/material/business data**, both explicitly unconnected.
   Declared catalog fields do not establish collected data or API coverage. Providers, permissions,
   budgets, data interfaces, validation criteria and prompt/skill details await research.
5. A design-only write relation maps `asset_id`, `saved_page_ref → page_ref`, `saved_at → updated_at`
   to #1039. It requires a confirmed successful save for the same asset with nonempty saved reference
   and time. Failed/unconnected/unconfirmed results do not write. Runtime validation, stale-completion
   rejection and atomic saving remain unimplemented; the binding guard describes required behavior.

The old #4004 gap decision, #3046 search, #1024 search cache and #3047 material assembly are removed
from the active graph. Their former responsibilities are absorbed into Grokbot, and their particular
schemas, realtime-search policy and ordering are not imposed on its future research. The current
example returns `unconnected` with no saved location/time and cannot update the record table.
`workflow_version` identifies the production specification actually used and is null until defined;
it does not restore a webpage-version ledger. Future workflow revisions should be evaluated on fixed
samples before adoption. This batch neither writes that workflow nor invokes Grokbot.

#1039 holds one current record per asset: `asset_id`, `page_ref`, `updated_at`. The successful
webpage writer should upsert this row after saving the page; failures preserve its previous
successful location/time. No page-version ledger, material timestamps, page bodies or JSON
materials are stored in this table. Runtime stale-result protection must be bound separately.
Reading a webpage or opening a Studio card does not trigger generation.

The user explicitly retired #1019 `asset_information_content`, #3030 per-information content
generation and #3031 per-information validation/saving. These cards and their edges are removed
from the current graph, rather than retained as unused proposals. The active UI does not show
their per-information keys, task state or 30-minute demonstrations. `content-refresh.v1.json`
and `search-preparation.v1.json` remain immutable historical installation inputs; they are not
second current webpage contracts. Source/board definitions unaffected by this cleanup retain
all existing constraints, including incomplete-reader and identity-coverage limitations.

## Materials and limitations

Materials remain separate from webpage update records. Preserve source attribution, evidence and
known source times; unknown coverage and timestamps stay explicit. External APIs and internal
system reads are both needed, but no real reader, search tool, generator, writer or publication
integration has been verified. Internal workflow decomposition and material/cache schemas belong
to subsequent Grokbot research. Incremental generation is not an implemented capability.

The examples contain hypothetical UUIDs and URLs. Observed business records are not supplied.
The pure page-decision evaluator assumes a complete successful read for examples; it does not query
storage. Page interval, output validation, concurrency and actual runtime behavior remain unverified.

## Upgrade and verification

The startup installers first retain their versioned historical setup, then apply SS-116's
current-page and current-flow upgrades. The final cleanup transaction preserves retained node
IDs, numbers and positions, removes the three retired cards, remaps only current field usages,
and updates active definition references. Unknown outside connections, imported records or
unrelated field usages stop cleanup instead of silently discarding work. Partial changes roll
back. Successful upgrade markers prevent reinstating retired cards on restart.

`server/asset_grokbot_flow.py` then applies SS-120: it reuses #3045, removes the four internal cards,
replaces their edges with the Grokbot boundary and guarded record write, and updates active definition
references. Unknown external edges/field references, requirements or imported cache data stop the
transaction for review. Other cards and saved display positions remain intact. A one-time description
upgrade adds both data-access requirements to hosts that loaded the initial boundary before that
clarification. `asset-webpage-flow.v1.json` is now a historical installation input.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_asset_grokbot_flow server.test_asset_pages server.test_asset_page_refresh_link server.test_asset_webpage_flow server.test_card_model
npx tsx --test src/assetWebpageDesign.test.ts src/cardDetailModel.test.ts
npm run build
node scripts/check_card_details.mjs /absolute/path/to/current-graph.json
```

These checks establish card migration, field/edge integrity, design decision boundaries and
bilingual rendering, not a deployed webpage pipeline. The old `test_content_refresh.py` has
two pre-existing graph-versus-node `display_positions` equality failures, reproduced on the
pre-change c5a0076 baseline; they are not evidence of a new page-flow regression.
