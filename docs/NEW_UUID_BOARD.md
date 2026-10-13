# New UUID board

Approved 2026-10-13 in [SS-84](https://app.notion.com/p/3f8038a63d5a811b8c93dc4d0026804d).
Portable definition: `catalog/new-uuid-board.v1.json`. This delivery installs Studio
definitions, lineage, illustrative cases and the homepage source reference; it does not
deploy a business collector, board calculator, task runner or content generator.

## Required behavior

All channels converge on the existing unified asset registration. Select confirmed
objects created through normal discovery, order by immutable `assets.created_at`
descending then `asset_id` ascending and take the latest 20. `created_at` means first
successful system registration, not project launch, most recent source observation or
UUID string order. Existing projects first registered today qualify. No project-age,
market-cap, volume, price-change or heat threshold applies. Do not change registry
admission or generate another UUID for the same object from another channel.

Source updates, new aliases and reprocessing must preserve first registration time.
Imports, migrations, re-imports, duplicate cleanup and replacement UUIDs must not
fabricate discoveries. Missing, invalid or future timestamps never become current time.
An unresolved creation-origin binding makes the board unavailable rather than treating
every existing UUID as a live discovery. Initial import policy remains separate.

The declared `assets` schema provides `asset_id`, `name`, `identity_status`, `asset_kind`
and `created_at`. It does not currently establish collected source references or durable
import/discovery provenance. Runtime implementers must bind these checks to existing
records and verify coverage. The illustrative `creation_origin` is an explicit assumption,
not a new production column or observed upstream value.

Publish complete successful batches with `calculated_at` and `algorithm_version`.
Snapshots expire at age >=900 seconds; the object itself has no age cutoff. Empty
qualified batches are allowed. Failed/unavailable batches cannot reuse old output as
current. Target checks occur after registration commits, at startup and every 60 seconds;
notifications and scheduling remain unbound.

The result can include multiple object kinds. Token content maintenance consumes only
confirmed `coin` identities from the three boards, at most 20 per board and 60 unique
asset IDs, retaining their board references. Project/person/account UUIDs never enter a
token generator without an explicit corresponding capability. Board overlap is allowed
and creates no repeated content task or scoring reward. No old discovery +20, seven-day
rule or retired #1010 dependency is restored.

## Studio installation and verification

`server/new_uuid_board.py` runs after the old-discovery retirement, interface installer and
digest repair. It allocates a fresh process and result identity, connects assets → new UUID
selection → result → candidate selection and adds a reference-only homepage edge. It
materializes already-declared asset field metadata without writing business asset rows.
Existing node IDs/positions and unrelated fields/connections remain. Edited managed
definitions, protected contracts, name collisions and unknown revisions fail with a
transaction rollback. A migration marker makes subsequent starts leave later edits intact.
Historical installation inputs under `server/migration_snapshots` are not current runtime
contracts or a second exported design.

`src/newUuidBoardDesign.ts` is a pure synthetic evaluator; output is never persisted.
Processing cards show focused horizontal input/output examples and collapsed settings;
the result table opens with no observed rows and a separate fictional example.

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_new_uuid_board server.test_content_refresh server.test_homepage_interface server.test_retire_market_discovery server.test_repair_discovery_digests
npx tsx --test src/newUuidBoardDesign.test.ts src/contentRefreshDesign.test.ts
npm run test:contracts
npm run test:layout
npm run build
```
