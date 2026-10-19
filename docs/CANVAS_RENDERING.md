# Canvas rendering (SS-97, SS-118)

Approved 2026-10-14: [SS-97](https://app.notion.com/p/3f8038a63d5a81d9a3a5d9d49f86fedf).

The complete saved graph remains authoritative for search, relationships and persistence. In full
canvas mode it also supplies fitView and the minimap. Scoped canvases fit and map only their mounted
entities. Viewport rendering never edits saved positions or relationships.

The complete map is the default (SS-118 correction approved 2026-10-19). A card uses its
fixed 300×160 geometry shell and persistent handles in every mode. Outside the viewport plus
180 screen pixels, its complex content is unmounted, rather than merely CSS-hidden. Visible
cards below zoom 0.45 mount a light reference/title summary without badges, icons or definitions;
at zoom 0.45 and above they mount the standard detailed content. Node IDs, positions, dimensions
and handle geometry do not change with the render mode. Search, keyboard selection, dragging,
fitView, long arcs and minimap still use the complete logical/display graph.

This is content virtualization, not removal of every offscreen ReactFlow wrapper: lightweight
geometry shells, handles and group labels remain mounted for measurement and endpoint stability.
Viewport store selectors return a primitive mode so detailed cards do not rerender on every pan
notification while staying in the same mode. It intentionally avoids stock endpoint-only edge
culling, which can omit a visible custom bow with both endpoints offscreen.

Custom edge content outside a conservative cubic control-point bounding box is omitted. The bound
includes label padding. Edges crossing the viewport remain eligible even with offscreen endpoints;
uncertain geometry stays visible. Bounds may retain extra edges rather than risk missing a curve.
Below zoom 0.45, visible edges keep their paths, hit areas and original click actions but omit
labels and markers. Zooming in restores the original semantic labels, arrows and styles.

Memoized card/edge components and the graph presentation batch reuse references across unrelated
parent updates. During viewport movement, edge hover changes are suppressed and existing transient
hover is cleared; normal hover resumes afterward. Card clicks, editing and position saving retain
their existing handlers and protections.

Each minimap keeps its mounted graph and supports click-to-center, dragging and wheel zoom.
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

## Functional workspace and editing (SS-118)

Approved 2026-10-19: [SS-118](https://app.notion.com/p/3fd038a63d5a812fa3b9f9ae8cc626f9).

The optional functional directory is feature summaries → subfeature summaries → cards.
It was the default in 7205f46; the user clarified that the complete map should remain the default. Summary levels mount no
ReactFlow canvas. A subfeature passes only its member display occurrences and internal edges to
ReactFlow; it does not merely hide the other full cards. Initial memberships are declared in
`src/featureTree.ts` by exact saved names, with six business features and a shared resource library.
Unknown, renamed or newly created cards remain discoverable in the library; IDs are never guessed
from historical reference numbers. This version does not provide a feature-organization editor.

Scoping changes presentation only: saved logical/display identities, original coordinates, edge
meaning, field bindings and backend contracts remain unchanged. Cross-boundary saved relationships
are shown as input/output summaries; open the original connection editor or navigate to the other
subfeature. Full canvas remains available. Double-clicking a card opens its complete route in the
full canvas. Existing field editing remains the mechanism for connecting data; summaries do not
create execution edges or a new universal connector.

Search covers the complete saved graph, including hidden feature cards, fields and requirements.
Card, L-connection and R-usage references can navigate to their endpoints. Type filters emphasize
matching features/cards; workflow lanes still control membership, with search retaining global
reach. Navigation does not replace the active editor or its draft; existing conflict/save protection
continues to govern writes. Scoped drag saving uses original display-position identities.

The canvas receives stable event proxies that read the latest committed handlers. Memoized canvas,
saved-card details and field catalogs do not rebuild on unrelated draft keystrokes. Graph search
indexes rebuild when saved data/language changes, and expensive search results use deferred input;
the textbox itself updates immediately. Edge semantic presentation is cached independently of
drag positions. Saved data, language and relevant selection changes still invalidate their displays.

Verification includes feature coverage, unknown-card fallback, immutable scoping and hidden-field
search tests in `featureTree.test.ts`, plus the existing contract/layout/build checks. Use an isolated
copy of current data for drag/save tests. DOM mount counts and Chromium main-thread diagnostics
show reduced work, not universal smoothness or native WKWebView frame guarantees.

For the corrected map, verify overview/detail/hidden transitions in `canvasViewport.test.ts` and
browser-check that offscreen shells have no `.node-top`/`.node-body`, low zoom has no detailed
edge labels and all modes retain 300×160 card bounds. Check pan-out/pan-back, zoom round-trips,
long bows with offscreen endpoints, search/field relations, minimap navigation, draft typing and
independent drag/save/refresh on isolated current data. Compare equivalent viewport paths on the
same production graph. Native interaction checks and Chromium diagnostics must remain distinct.
