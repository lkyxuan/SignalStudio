import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Graph } from './contracts';
import { GraphCache, type Workspace } from './graphCache';
import { LiveGraphSession } from './liveGraphSession';
import { RefreshQueue, type RefreshPhase } from './refreshQueue';
import { retryGraphConnection } from './graphRecovery';

declare global { interface Window { signalstudioWorkspace?: { endpoint: string; workspace: Workspace; codeRevision: string | null; appRevision?: string }; signalstudioStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> } }
export function useLiveGraph(setGraph: Dispatch<SetStateAction<Graph>>) {
  const sessionRef = useRef<LiveGraphSession | null>(null);
  if (!sessionRef.current) {
    let cache: GraphCache | null = null;
    try { cache = new GraphCache(window.signalstudioStorage ?? localStorage, window.signalstudioWorkspace?.endpoint ?? location.origin); } catch { /* Storage unavailable. */ }
    sessionRef.current = new LiveGraphSession(cache, window.signalstudioWorkspace?.workspace);
  }
  const state = sessionRef.current;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pendingWrites = useRef(0);
  const reads = useRef(new RefreshQueue());
  const manual = useRef(false);
  const [retryPhase, setRetryPhase] = useState<RefreshPhase>('idle');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [status, setStatus] = useState(state.status);
  const [conflict, setConflict] = useState(false);
  const [confirmedAt, setConfirmedAt] = useState(state.confirmedAt);
  const [cacheAvailable, setCacheAvailable] = useState(true);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const publish = useCallback(() => {
    setStatus(state.status); setConflict(state.conflict); setConfirmedAt(state.confirmedAt); setCacheAvailable(state.cacheAvailable);
  }, [state]);
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(work);
    queue.current = result.catch(() => {});
    return result;
  }, []);
  const reload = useCallback((requested = false) => {
    if (requested) manual.current = true;
    const progress = () => setRetryPhase(manual.current || !state.writable ? reads.current.phase : 'idle');
    return reads.current.run(enqueue, async () => {
      try {
        if (await state.refresh() && state.graph) setGraph(state.graph);
        setConnectionError(null);
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        setConnectionError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout'
          : state.status === 'identity-error' ? 'identity' : 'failed');
      } finally { publish(); }
    }, progress).finally(() => { manual.current = false; });
  }, [enqueue, publish, setGraph, state]);
  useEffect(() => {
    if (state.graph) setGraph(state.graph);
    const focus = () => { if (document.visibilityState !== 'hidden') void reload(); };
    const offline = () => { state.fail(); publish(); };
    const storageError = () => { state.cacheAvailable = false; publish(); };
    window.addEventListener('signalstudio-storage-error', storageError);
    focus();
    window.addEventListener('focus', focus); window.addEventListener('online', focus); window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', focus);
    return () => { window.removeEventListener('signalstudio-storage-error', storageError); window.removeEventListener('focus', focus); window.removeEventListener('online', focus); window.removeEventListener('offline', offline); document.removeEventListener('visibilitychange', focus); };
  }, [reload, state, setGraph, publish]);
  // Retry only while disconnected. A confirmed, idle workspace makes no graph reads.
  useEffect(() => {
    if (state.writable) return;
    return retryGraphConnection(() => !state.writable, () => document.visibilityState !== 'hidden', reload);
  }, [status, state, reload]);
  const write = useCallback((path: string, method: string, body: unknown, preserveEdits = false) => {
    pendingWrites.current += 1;
    return enqueue(async () => {
    try {
      const result = await state.write(path, method, body, preserveEdits);
      if (state.graph) setGraph(state.graph);
      return result;
    } finally { pendingWrites.current -= 1; publish(); }
    });
  }, [enqueue, publish, setGraph, state]);
  const loadDetails = useCallback((ids: string[]) => enqueue(async () => {
    try { if (await state.loadDetails(ids) && state.graph) setGraph(state.graph); }
    finally { publish(); }
  }), [enqueue, publish, setGraph, state]);
  const receivePending = () => { if (state.pending && state.receive(state.pending) && state.graph) setGraph(state.graph); publish(); };
  const discard = useCallback(() => {
    state.clear(); setConflict(false); setEditorEpoch(value => value + 1);
    if (state.pending) { const next = state.pending; state.pending = null; state.graph = next; state.expected = String(next.revision); setGraph({ ...next }); }
    else void reload();
  }, [reload, state, setGraph]);
  return { reload, loadDetails, reconnect: () => reload(true), retryPhase, connectionError, write, status, conflict, confirmedAt, cacheAvailable, editorEpoch, getGraph: () => state.graph,
    writePending: () => state.dragging || pendingWrites.current !== 0,
    canQuit: () => !state.dirty && !state.dragging && pendingWrites.current === 0,
    markEdited: () => { state.dirty = true; },
    beginDrag: () => { state.dragging = true; },
    endDrag: () => { state.dragging = false; if (!state.dirty) receivePending(); },
    resetEdited: () => { state.clear(); receivePending(); },
    discard, accept: () => { state.accept(); setConflict(false); },
  };
}
