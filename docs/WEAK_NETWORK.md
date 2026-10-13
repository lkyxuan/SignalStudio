# Weak-network workspace loading (SS-57)

Approved scope and rationale: [SS-57](https://app.notion.com/p/3f6038a63d5a816b848ed1971e34ae12), 2026-10-11.
The Mac mini remains the only writable database. No public endpoint or offline writing is provided.

## First-batch behavior

The browser saves the last schema-validated remote graph in localStorage. Native clients use an atomic private snapshot file through a storage bridge. Cache format v2 is isolated by
remote endpoint, project_root and database_path; its envelope includes the graph revision and the
last successful remote confirmation time. Invalid, corrupt or unavailable storage falls back to
remote loading; quota failure is visible. Graphs and database files are never committed as cache artifacts.
A cached graph is read-only until health identifies the expected workspace and a graph response
confirms its current revision. A different project/database fails closed and requires checking the
connection, rather than silently accepting a different database. The native client pins its configured
identity; a browser pins the last successfully connected identity on that origin (or the first identity
on a fresh browser). These path identities detect configuration mistakes; they are not authentication
or proof that a database at the same path has never been replaced.

Health and graph requests are serialized with writes. Focus/reconnect reads coalesce while one is
queued or in progress. Per [SS-96](https://app.notion.com/p/3f8038a63d5a8138a4dcc23cc169bffd), a confirmed workspace does not periodically poll graph data. Reads run on initial visible load, window focus, becoming visible, network recovery and manual reconnect; successful writes still read back the graph. Visible disconnected pages retry read-only connection checks after 5 seconds; retries stop once confirmed. A hidden page waits until visible. Other windows do not continuously follow external edits; optimistic revision checks still reject stale writes. Without polling, a silent server outage is detected by the next graph operation or browser offline event, not by idle graph checks. The independent 10-second UI-version check and save-before-manual-refresh behavior remain in place;
API requests time out after 15 seconds. Network failure/offline notification revokes write permission.
Writes retain If-Match and card-model headers and include X-Workspace-Identity, checked by the API
before serving or mutating the database (412 on mismatch). A timed-out mutation may have committed;
it is never automatically replayed. Reconnect and inspect before deciding whether to retry it.
Drafts, dragging and 409 conflicts retain their existing protection. 304 does not dismiss a pending conflict.

GET /api/graph accepts If-None-Match for its weak quoted graph revision and returns 304 with no body
when unchanged and the request supplies a matching workspace identity. Unpinned reads receive a full response. X-Workspace-Identity pins conditional reads as well as writes. This saves network
bytes; the backend still computes a consistent snapshot/revision. It is not entity-level delta sync.
JSON and built HTML/JS/CSS/SVG negotiate gzip (explicit gzip;q=0 overrides wildcard acceptance).
Built hashed assets use long-lived immutable HTTP caching; entry HTML revalidates. The private HTTP
browser origin does not offer service-worker offline startup; an already loaded browser page can show
its snapshot, but a fresh offline browser navigation is not guaranteed.

## Native clients

Remote development and shared-client builds include dist as a versioned `workspace-ui` fallback.
Run `npm run build` before building either client. Normal launches verify the remote identity and
load the server-delivered page, preserving save-before-refresh code updates. Health has a 5-second
timeout; network/unready failures open the bundled shell. If remote page loading fails or no application
interface has rendered after 8 seconds, startup falls back to the bundle. It never replaces a rendered
editor automatically. Wrong HTTP service/project/database/mode fails explicitly.

Both online and fallback pages use the same endpoint/project-isolated native snapshot file in
`~/Library/Application Support/SignalStudio/workspace-snapshots/`. Its directory is private (0700),
files use 0600 and atomic writes; graph schema, identity and format are revalidated by the frontend.
Storage failures are visible. The custom fallback origin is hashed from the endpoint/project; its API
requests use a main-frame-only native bridge pinned to that endpoint and workspace, refusing redirects.
The remote page uses normal same-origin HTTP requests. External navigation cannot acquire the bridge.
No local server or SQLite is started by remote clients.

First startup without a successful graph fetch shows a clear waiting/read-only state; it cannot
invent an offline graph. Subsequent offline startup can display the last confirmed graph. Source
examples/details that still fetch independently may be unavailable offline. Native snapshot files
are local application data, not repository artifacts. Browser-cleared website data removes browser
snapshots; native snapshots are separate local files.

Bundled fallback code is replaced on App rebuild/update; its hashed resources load from that bundle
only, preventing mixed HTTP asset versions. An offline shell detects server-code changes and asks to
save then reopen the App; an online reopen loads the latest server page. Normal online pages retain
save-before-refresh behavior. Updater-enabled shared Apps obtain new bundled resources through the
[SS-59 native updater](CLIENT_UPDATES.md); older Apps need its one-time installation.
Server deployment alone does not replace bundled native resources.

## Reconnect feedback and build identity

The 2026-10-11 approved follow-up exposes queued and running reads immediately during initial
connection/recovery and manual retry. Repeated clicks/focus events join the existing read, including
one queued behind a save. Buttons remain disabled until that read finishes. Failures distinguish timeout,
identity rejection and other connection/service failures; the existing automatic retry continues.
Successful recovery displays the connected state. Successful event-triggered reads do not show a recovery spinner.
Read-only and draft/conflict protection remain enforced independently of this presentation state.

The sidebar shows the actual UI build's Git commit, with a link to that commit and expandable details.
Vite embeds this identity in the compiled JS and dist/build-info.json; it never adopts a health response
as its own version. Non-Git builds show unknown; source modifications show a local-changes marker.
Only runtime data/logic.db (and its WAL/SHM) are excluded from the dirty check. Server identity in details
is the last successfully observed ready health version with a timestamp; failed checks mark it unconfirmed.
This is not a claim that it matches GitHub main. The main commit-list link allows manual comparison;
no GitHub polling or automatic editor reload is added. Differing confirmed server/UI commits prompt
save-before-refresh (or reopen for the native fallback).

Native clients expose their bundle revision separately on both online and fallback pages. Packaging
requires a clean UI build matching HEAD via build-info.json, preventing a new package label on stale UI.
Run the UI build again after committing before producing a client package.

## Verification and remaining work

Run from an isolated checkout with dependencies and dist built:

```bash
npm run build
npm run test:contracts
npm run test:layout
PYTHONPATH=server python3 -m unittest server.test_graph_transport server.test_weak_network server.test_live_state server.test_desktop_server
python3 -m unittest scripts.test_offline_workspace scripts.test_shared_client scripts.test_dev_runtime scripts.test_graceful_shutdown
```

On the Mac mini, setting SIGNALSTUDIO_TEST_SHARED_HOST=100.123.241.60 additionally tests the shared
preview's actual static gzip middleware on isolated ports. The native test uses a disposable database,
opens a diagnostic WKWebView, stops the backend and starts a second WebKit process to verify persistent
read-only snapshot recovery. It simulates page visibility because its diagnostic window does not take
keyboard focus. It does not establish behavior on another physical device or a cellular hotspot.

## Canvas, details and entity deltas

The approved continuation uses `X-Graph-Transport: canvas.v1` on GET /api/graph.
Legacy clients still receive the complete graph. Canvas snapshots retain topology, identifiers,
field definitions/names, search text, counts, types, contracts and progress. Node rationale/caveats/notes/
validation text, field notes/examples/normalization, mapping usage notes and requirement examples
load on demand; `detail_loaded=false` explicitly marks their placeholders. The inspector waits for
selected cards and their immediate neighbors before rendering editing controls. A failed load shows
retry; an uncached detail cannot be invented while offline. Search text and references remain available.

GET /api/graph/details accepts `revision` and repeated `node_id` (1–100 per request), returns the
selected nodes, their fields/requirements and incident mapping details, and rejects a stale revision
with 409. Deferred-content hashes (128-bit SHA256 prefixes) allow previously fetched details to survive unrelated changes;
a changed entity invalidates its cached details. All merge results pass the graph reference schema.
Reads remain serialized with writes; identity mismatch fails closed. A partial graph never becomes
a node PATCH body: the form only submits user-changed fields and excludes transport metadata.

Clients with a validated canvas baseline send `X-Graph-Base`. The server returns delta.v1 with
base_revision, changed/new entities, deleted IDs, changed collection order and changed graph metadata. Unchanged order/metadata reuse the baseline.
The client applies changes to the confirmed remote baseline (independently of editor drafts), validates
the assembled graph, then passes it through existing draft/drag conflict handling. Each server process
retains up to 16 snapshots within a 16MB aggregate budget (one oversized current snapshot is allowed).
A missing/expired baseline, server restart or delta larger than a canvas returns a complete canvas;
malformed deltas trigger one baseline-free read. 304 remains an empty unchanged response. These are
transport optimizations; the backend still computes its full consistent snapshot and revision.

Snapshot cache v2 keeps partial graph data away from old v1 clients; a validated full v1 cache may be
read as a migration source. Existing v1 files/connection settings are preserved. Native fallback HTTP
bridges forward transport/base headers when rebuilt; older bridges can still use full graph responses.

Source directories use their independent `sha256:` revision from /source-contracts/v1/meta. Validated
full directories are persisted separately; the small metadata read determines reuse, and graph/data
changes do not invalidate an unchanged directory. A local checksum detects storage corruption (not
an authentication signature); schema/revision mismatch or unavailable/quota-limited storage falls
back to a fresh fetch. Directory metadata failure is surfaced; this cache does not authorize offline writes.

Actual cellular latency, two physical clients and the existing Tailscale relay bottleneck remain
unmeasured here; compression and deltas do not fix that path. The user removed additional field
coverage as a task-closure prerequisite on 2026-10-11; it is not reported as passed.
