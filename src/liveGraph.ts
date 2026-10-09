import type { Graph } from './contracts';

// Pure state machine shared by polling and editing. A revision represents a
// consistent SQLite snapshot, rather than timestamps that can collide.
export class LiveGraphState {
  graph: Graph | null = null;
  pending: Graph | null = null;
  dirty = false;
  dragging = false;
  expected = '';
  receive(next: Graph): boolean {
    if (next.revision === this.expected && this.graph) return false;
    if (this.dragging) { this.pending = next; return false; }
    if (this.dirty) { this.pending = next; return false; }
    this.graph = next; this.expected = String(next.revision); this.pending = null;
    return true;
  }
  get conflict() { return this.dirty && !!this.pending && this.pending.revision !== this.expected; }
  accept() { if (this.pending) this.expected = String(this.pending.revision); }
  clear() { this.dirty = false; }
}
