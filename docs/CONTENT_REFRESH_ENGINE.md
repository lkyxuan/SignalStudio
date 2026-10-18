# Asset webpage preparation and refresh design

Current user decisions and implementation record: [SS-116](https://app.notion.com/p/3fd038a63d5a81a1bbcacd4423528524),
2026-10-19. Current contracts are `catalog/asset-webpage-flow.v1.json` and
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
3. Only first-creation or due-update items proceed to #3045 reading available materials.
   #4004 identifies gaps, #3046 supplements by search, #1024 retains search materials and
   #3047 assembles the same asset's materials with source references and current webpage location.
   The current search-required policy is retained; material readers and search tools are unbound.
4. Preparation currently ends at #3047. A Grokbot webpage creation/update step is planned but
   has not been created or assigned a reference number. There is no live generation or write-back.

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

Materials are separate from webpage update records. Keep original source URLs, known source
publication times, collection times and source attribution. Unknown source time stays unknown;
collection time does not replace it. A successful empty search and a search failure are distinct.
Failures must not silently erase previously successful search materials. Freshness expiry is
not a storage-deletion policy. Incremental webpage generation is a future implementation
choice, not a delivered capability or a consequence of choosing a daily refresh interval.

The examples use hypothetical UUIDs, source URLs and results; observed result tables remain
empty. The pure page-decision evaluator assumes a complete successful read for its examples;
it does not perform actual queries. Storage, source freshness parameters, output validation,
Grokbot integration, writer concurrency and webpage publication remain unverified.

## Upgrade and verification

The startup installers first retain their versioned historical setup, then apply SS-116's
current-page and current-flow upgrades. The final cleanup transaction preserves retained node
IDs, numbers and positions, removes the three retired cards, remaps only current field usages,
and updates active definition references. Unknown outside connections, imported records or
unrelated field usages stop cleanup instead of silently discarding work. Partial changes roll
back. Successful upgrade markers prevent reinstating retired cards on restart.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_asset_pages server.test_asset_page_refresh_link server.test_asset_webpage_flow server.test_card_model
npx tsx --test src/assetWebpageDesign.test.ts src/cardDetailModel.test.ts
npm run build
node scripts/check_card_details.mjs /absolute/path/to/current-graph.json
```

These checks establish card migration, field/edge integrity, design decision boundaries and
bilingual rendering, not a deployed webpage pipeline. The old `test_content_refresh.py` has
two pre-existing graph-versus-node `display_positions` equality failures, reproduced on the
pre-change c5a0076 baseline; they are not evidence of a new page-flow regression.
