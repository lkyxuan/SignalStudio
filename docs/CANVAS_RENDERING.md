# Canvas rendering (SS-97)

Approved 2026-10-14: [SS-97](https://app.notion.com/p/3f8038a63d5a81d9a3a5d9d49f86fedf).

The complete graph remains authoritative for search, fitView, relationships, persistence and the
minimap. Viewport rendering never edits node positions or hides entities from those operations.

Cards and group labels outside the viewport plus 180 screen pixels use CSS visibility rather than
unmounting. Their measured dimensions and handles remain available to ReactFlow, preserving edge
endpoints and initial measurement. Selected/dragging cards and unmeasured geometry remain visible.
This reduces painting, not DOM size or every ReactFlow subscription. It intentionally avoids stock
endpoint-only edge culling, which can omit a visible custom bow with both endpoints offscreen.

Custom edge content outside a conservative cubic control-point bounding box is omitted. The bound
includes label padding. Edges crossing the viewport remain eligible even with offscreen endpoints;
uncertain geometry stays visible. Bounds may retain extra edges rather than risk missing a curve.

Memoized card/edge components and the graph presentation batch reuse references across unrelated
parent updates. During viewport movement, edge hover changes are suppressed and existing transient
hover is cleared; normal hover resumes afterward. Card clicks, editing and position saving retain
their existing handlers and protections.

The minimap keeps the complete graph and supports click-to-center, dragging and wheel zoom.
Viewport/node notifications coalesce into at most one scheduled update per 120ms; releasing a pointer
flushes the final viewport, and cleanup cancels pending updates. Minimap drawing uses the actual
node dimensions and positions; screen-to-map coordinates follow the SVG viewBox aspect ratio.
Its viewport may lag by up to 120ms during motion. No new persistent setting or network poll is added.

Verification: `npm run test:contracts`, `npm run test:layout`, `npm run build`; manually check the same
graph and scale for search, fitView, zoom, minimap navigation, long bows, click details, draft protection
and saved node positions. Use isolated data for save tests. Compare identical movement paths before
and after, separating Chromium diagnostics from the native WKWebView. Call-stack sampling locates
activity but does not establish FPS, GPU time, memory leaks or universal smoothness.

Native interaction/frame measurements depend on access to the actual App. Preserve this limitation
in delivery records if the desktop control tool cannot bind its window; browser success is not native
runtime proof. Existing bundled fallback pages acquire frontend changes only through a later App
build/update; this frontend delivery updates the online workspace without publishing a Release.

## Card synchronization and startup (SS-117)

Approved 2026-10-19: [SS-117](https://app.notion.com/p/3fd038a63d5a81c98c70e6633eb84209).
The top bar's **Sync cards / 同步卡片** performs the existing serialized, coalesced graph read.
It does not navigate, reload the UI, clear drafts, or change the viewport/selection. Its busy state
covers a queued or active read; failures use the connection/retry banner. External revisions still
wait behind a draft/drag and use the existing explicit conflict controls. Successful writes still
read back the authoritative graph; identity checks, If-Match, timeout behavior and full-snapshot
fallback remain unchanged. Normal connected workspaces do not gain periodic graph polling.
New UI code or card components still require the separate save-before-**Refresh workspace** action.

An empty locator skips search-text construction. Nonempty search lazily indexes field/requirement
text and caches each node's text for the current inputs/language/source labels. A changed node uses
its new object, and changed fields/requirements replace the index. Edge bindings are indexed by the
immutable binding array. The source-directory read waits until the graph provides its contract
revision, avoiding the duplicate empty-graph initialization request.

Full graphs, deltas and detail merges pass the complete graph schema before equal entities and
metadata reuse prior immutable references. Entity identity follows IDs even if order changes.
Invalid references remain errors, and deferred details still follow their hashes. Canvas data
reconciliation retains unchanged card/edge objects, measured sizes and selection; changed data,
geometry, ports, labels and deletions continue to invalidate their affected objects. This reduces
unrelated component work, not every graph derivation or DOM node. It does not change stored layout,
long-curve visibility, minimap behavior or the database/API write contract.

Regression checks include `src/graphSearch.test.ts`, `src/referenceReuse.test.ts` and
`src/graphTransport.test.ts` through `npm run test:contracts`. Compare cached startup and single-card
sync with the same graph and viewport; browser diagnostics alone do not establish native FPS or
cross-device network speed.
