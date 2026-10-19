import { bezierControls, type RouteLink } from './edgeRouting';
export type Rect = { x: number; y: number; width: number; height: number };
export type CanvasView = { transform: [number, number, number]; width: number; height: number };
export const CARD_DETAIL_ZOOM = 0.45;
export type CanvasRenderMode = 'hidden' | 'overview' | 'detail';
// Keep geometry in ReactFlow, but mount expensive card/edge content only where
// useful. A full-map fit must not mount every detailed card at once.
export function canvasRenderMode(rect: Rect, view: CanvasView): CanvasRenderMode {
  if (!inCanvasView(rect, view)) return 'hidden';
  return view.width > 0 && view.height > 0 && view.transform[2] >= CARD_DETAIL_ZOOM ? 'detail' : 'overview';
}
// Screen-space overscan prevents flicker at the viewport boundary. Unknown geometry
// stays visible so initial measurement and fitView retain the complete graph.
export function inCanvasView(rect: Rect, view: CanvasView, padding = 180): boolean {
  const [x, y, zoom] = view.transform;
  if (!view.width || !view.height || !Number.isFinite(zoom) || zoom <= 0 ||
      ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return true;
  return (rect.x + rect.width) * zoom + x >= -padding && rect.x * zoom + x <= view.width + padding &&
    (rect.y + rect.height) * zoom + y >= -padding && rect.y * zoom + y <= view.height + padding;
}
// A cubic is contained in the convex hull of all four control points. This
// conservative bound retains long bows even when both endpoints are offscreen.
export function arcBounds(link: RouteLink, label = ''): Rect {
  const points = bezierControls(link);
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minY = Math.min(...points.map(p => p[1])), maxY = Math.max(...points.map(p => p[1]));
  const labelPadding = Math.max(24, label.length * 8 + 12);
  return { x: minX - labelPadding, y: minY - 24, width: maxX - minX + labelPadding * 2, height: maxY - minY + 48 };
}
// Latest update wins; interactive viewport notifications are capped, with an
// explicit final flush when motion ends. No timer survives component cleanup.
export function frameThrottle(work: () => void, delay = 120) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    request() { if (timer === undefined) timer = setTimeout(() => { timer = undefined; work(); }, delay); },
    flush() { clearTimeout(timer); timer = undefined; work(); },
    cancel() { clearTimeout(timer); timer = undefined; },
  };
}
