# Asset webpage board and Few/Grokbot boundary

Current design: [SS-135](https://app.notion.com/p/3ff038a63d5a812888defb55266c9f3d), approved 2026-10-20.
`catalog/asset-webpage-board.v2.json` is the current board definition. Read the board or its
`GET /api/graph/package` export, including definition references, before implementing in Few.
Studio is a design workspace, not the business-data service or job runner.

## Responsibilities and handoff

Few Understand owns candidate selection, page-refresh decisions, and the task dispatch,
retry/concurrency and result-tracking mechanisms that implement the upstream boundary.
Grokbot owns three-round research/writing through nine internal steps, plus one non-executing
production-rules reference card shown in the webpage writer module.
The module is navigation; the rules card and its reference edges never start work. It does not start a scheduler.

The business handoff contains only:

| Field | Meaning |
| --- | --- |
| asset_id | Stable UUID for the same asset; verify the mapping to Few's actual identity system |
| action | generate for first creation, refresh for a due update |
| page_ref | Existing webpage reference; null is allowed for a confirmed first creation |

`reason` and `age_minutes` remain upstream diagnostic information on #3029; users do not
supply a separate reason, and these are not Grokbot's required inputs. Research priorities,
sources, evidence, page artifacts and self-checks are internal to Grokbot. Their card fields
explain the internal flow; they are not a list of new fields Few must provide.

Task IDs, claim credentials, attempts, concurrency baselines and execution policies belong to
Few's task/adapter implementation. Reuse its existing mechanisms; this board does not impose
`run_id`, `expected_page_ref`, `expected_updated_at`, `started_at` or `policy` as mandatory
business inputs. Any actual cross-system protocol must be documented and verified at integration.
`workflow_version` is an optional output naming the specification actually used; unknown stays null.

## Upstream requirements

#3027 selects qualified confirmed coins from warming, hottest and new-UUID boards under their
existing complete-batch and ordering rules: up to 20 per board, deduplicated by asset UUID,
not a full-registry scan. Existing candidate/refresh design calls for successful complete-board
submission, startup checks and 60-second checks. These are demand checks, separate from worker
dispatch cadence and the whole-page update interval. Continuous Few operation is not verified.

#3029 reads #1039 by candidate UUID. Only a complete successful missing-row lookup means first
creation. Existing pages become due only with a valid successful updated_at and a configured
whole-page interval. That interval remains null; do not choose daily, three-day or the retired
30-minute per-information policy. Failed/partial reads, duplicate records, unknown/malformed/future
times need review. Only first/due go to Grokbot; skip/review do not execute.

Few's upstream implementation must avoid duplicate active work, recover interrupted work, keep
retry/concurrency state separate from successful page records, and prevent late/old results from
overwriting newer success. The exact storage, APIs, credentials, retry policy and dispatch strategy
remain unbound. Every-hour, batch size two, and generate-always-first are not approved defaults.

## Three rounds and preserved checks

The nine existing identities, reference numbers and saved positions remain. No old card is
merged or deleted. One rules reference is added; only its reference edges are new.

1. #3045 Identity verification: confirmed same-asset mapping is required before continuing;
   unresolved identity stops without placeholders or changes to global identity records.
2. #3061 Inventory actual Few materials: reuse qualified, traceable observations; distinguish
   missing, failed, incomplete, stale and unknown reads from usable evidence.
3. #3062 **Round one: listen to the market**. Search roughly the last 1–4 weeks of X posts/news,
   news sites, forums, exchange notices and official project channels. Produce 3–5 specific
   questions traders actually ask, each with original discussion links and publication times.
   Unrelated names, shilling and promotional posts are leads only. Space requests and back off
   on 429 (honoring Retry-After when available); record coverage gaps. Insufficient sourced
   questions need review, never invented padding.
4. #3063 **Round two: question-led data**. First decide the data, definitions, period, free
   keyless source and second verification source needed to answer each question.
5. #3064 Fetch, retain evidence and maintain one independent research record per token across
   all rounds: questions, discussion links, selected data/sources, cross-checks, unknowns/reasons,
   omissions/reasons, including content unsupported by the ten blocks. Retain sanitized request
   outcomes, raw evidence and runtime logs. Writing finalizes the record; self-check verifies it.
   It is outside strict page JSON and #1039; actual persistence is unconnected.
6. #4005 Close round two: cross-check each intended number with a second source using the same
   asset, time, units, chain and metric. Explain discrepancies and why the adopted source is
   more reliable. Unverifiable or single-source numbers are omitted; retain the question with
   “Currently unverifiable” and its reason. Non-blocking unknowns may be disclosed; critical
   fact or identity conflicts stop. Never fill gaps with estimates.
7. #3065 **Round three: question-led writing**. Suggested structure: trader questions, 3–4
   current stats, one suitable block per question (question title, answer/data/source/limits),
   relevant upcoming dates if known, risks and sources. Order is guidance, not a fixed template.
   Remove unrelated ranks, FDV and long history; record the reasons. Use strict v1 JSON.
8. #4006 Self-check: use zod from the actual target `web/domain/token-page-script.ts`, plus
   evidence, identity, bilingual content and research-record checks. Missing validator means
   unconnected; structural validity does not prove facts. Record actual validator version and
   outcome. Earlier or stale checks never authorize saving changed content.
9. #3066 Save and write back: validation and saving must be in the **same command**, with a
   validation failure aborting before any save call. Only HTTP 200/201 confirms publication;
   409 no retry; 422 fix all issues before resubmission; 404/401/503 stop; 413 shorten; 502 resend
   later. Revalidate before a changed/resubmitted artifact is sent. Respect Few's existing retry,
   concurrency and stale-result controls; do not add an automatic retry loop.

The new **Page production rules and question examples** card is a reference, not a tenth job.
Its `page_rules` and `question_examples` in the current catalog contain the complete bilingual
limits and nine question→data→block examples. Reference connections have `trigger=none`.

New pages all use the three rounds. **Whether to rework existing pages remains a separate user
decision**; no automatic rebuild batch or new page interval is authorized. Existing selection,
deduplication and dispatch requirements remain as above.

### Strict page contract and evidence access

Top-level fields only: `version=1`, `symbol`, `assetKey` (the supplied `asset_id`), bilingual
`title` and `headline`, `generatedAt` (actual current time, seconds and timezone), `isSample=false`,
`sources`, `blocks`. No extra fields; finite numbers; total size ≤256KB. No internal IDs in
rendered text. Keep the internal research record/evidence containers outside this page object.

Only `text`, `stats`, `line_chart`, `bar_chart`, `table`, `timeline`, `comparison`, `quotes`,
`callout`, `links` are allowed. Usually 6–12 blocks, at most 40. Limits: text 1–8 paragraphs;
stats 1–8 items and value ≤160 characters; line_chart 2–120 points/1–4 series; bar_chart 1–24 bars;
table 1–6 columns/1–30 rows; timeline 1–12 events; comparison 2–4 columns/1–8 items each;
quotes 1–8; callout ≤8 items; links 1–10. Unsupported content is omitted with a recorded reason.
At most 12 actually used http(s) sources. Every displayed fact links to evidence. All display
text is bilingual. No fabrication, exaggeration, shilling or buy/sell advice.

Use only free sources that require neither keys nor paid access: official project docs,
explorers, official chain RPC, keyless CoinGecko, `data-api.binance.vision`, DEX Screener,
DefiLlama and public exchange notices. Access challenges, rate limits and unpublished metrics
remain explicit gaps. Qualified traceable Few observations can be reused without duplicate
requests but do not bypass evidence/freshness checks. Internal reads are not proof of collection.
Load connection parameters and secrets only from server environment files; never print or store
them in logs, cards, page objects or research records.

Each fact retains its own time and precision. Retrieval and generation times do not make old
facts current. Conflict revalidation and format repair retain their existing single internal
attempt limits and non-triggering reference paths. Failed repairs terminate with the old page
intact. Runtime enforcement and research-record persistence remain unbound.

## Current webpage record and saving

#1039 still holds one current successful row per asset: asset_id, page_ref, updated_at.
It does not store task state, evidence, page bodies or a page-version ledger. Only a confirmed
save of the same asset after identity and self-check approval maps saved_page_ref to page_ref
and saved_at to updated_at. Queuing, fetching, failures, uncertain saves and retries must not
change the old successful location/time. An existing page alone does not prove this task succeeded.
Actual idempotent saving, concurrency validation and atomic/recoverable storage remain unimplemented.

## Implementation and evidence boundaries

The Studio migration, fields, relationships and shared details implement the board presentation.
No Few readers, jobs, Grokbot tools, production evidence storage, page renderer/parser, saver or
writeback adapter are connected or verified by that migration. The old draft page-script v2 and
C1/C3/C6/C7 paths are not established production interfaces.

The nine steps retain original trial summaries as unverified historical author reports.
These old nine-step/v2 reports do not establish acceptance of the current three-round/v1 design.
The user reports BLUR/TORCH were published with the new approach; that report has not been
independently verified here and does not establish a connected Studio runtime. The original
SOL/BONK logs, screenshots, artifacts and reported 252 tests are not available in this delivery; they are
not runtime evidence. UI examples are fictional, not business records.

`asset-webpage-board.v1.json` (SS-124) and `asset-grokbot-flow.v1.json` are historical
installation inputs, like the retired
`asset-webpage-flow.v1.json`, `content-refresh.v1.json` and `search-preparation.v1.json`.
The PR #2 drafts remain research history, not a competing current execution contract.
SS-124 originally added eight cards and reused #3045. SS-135 runs after that migration,
transactionally updates the same nine identities, adds the rules reference and question/record
field mappings, and preserves existing edge/field IDs, positions and historical reports.
Unexpected user edits/connections or requirements stop migration for review;
version-pinned historical reports remain unchanged and become stale for changed definitions;
failures roll back. Other card identities and positions remain intact. Startup does not reset layout.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_asset_webpage_rounds server.test_asset_webpage_board server.test_asset_grokbot_flow server.test_asset_webpage_flow server.test_asset_pages server.test_asset_page_refresh_link server.test_card_model
npx tsx --test src/assetWebpageDesign.test.ts src/featureTree.test.ts src/cardDetailModel.test.ts
npm run build
node scripts/check_card_details.mjs /absolute/path/to/graph.json
```

These checks establish design migration, field/edge consistency, module visibility and read-only
rendering. They do not establish real Few execution, source coverage, webpage success or research validity.
