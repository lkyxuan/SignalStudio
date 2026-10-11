export type RefreshPhase = 'idle' | 'queued' | 'connecting';

// One read may be waiting behind a write, or already running. Joining never queues another.
export class RefreshQueue {
  phase: RefreshPhase = 'idle';
  private pending: Promise<void> | null = null;
  run(enqueue: (work: () => Promise<void>) => Promise<void>, work: () => Promise<void>, changed: () => void) {
    if (this.pending) { changed(); return this.pending; }
    this.phase = 'queued'; changed();
    this.pending = enqueue(async () => {
      this.phase = 'connecting'; changed();
      await work();
    }).finally(() => { this.pending = null; this.phase = 'idle'; changed(); });
    return this.pending;
  }
}
