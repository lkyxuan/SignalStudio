import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Graph } from './contracts';
import { request, ApiError } from './api';
import { LiveGraphState } from './liveGraph';

export function useLiveGraph(setGraph: Dispatch<SetStateAction<Graph>>) {
  const state = useRef(new LiveGraphState()).current;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [status, setStatus] = useState('connecting');
  const [conflict, setConflict] = useState(false);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const enqueue = useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const result = queue.current.then(work);
    queue.current = result.catch(() => {});
    return result;
  }, []);
  const receive = useCallback((next: Graph) => {
    if (typeof next.revision !== 'string') { setStatus('outdated'); return; }
    if (state.receive(next)) setGraph(next);
    setConflict(state.conflict);
    setStatus('ready');
  }, [state, setGraph]);
  const reload = useCallback(() => enqueue(async () => {
    try { receive(await request('/graph')); }
    catch { setStatus('reconnecting'); }
  }), [enqueue, receive]);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (document.visibilityState !== 'hidden') await reload();
      if (alive) timer = setTimeout(tick, 2000);
    };
    const focus = () => { if (document.visibilityState !== 'hidden') void reload(); };
    void tick();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => { alive = false; clearTimeout(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [reload]);
  const write = useCallback((path: string, method: string, body: unknown, preserveEdits = false) => enqueue(async () => {
    if (state.conflict) throw new Error('请先处理外部更新冲突，再保存。');
    if (!state.expected) throw new Error('工作台尚未就绪，请稍后重试。');
    try {
      const result = await request(path, { method, body, headers: { 'If-Match': state.expected } });
      const next = await request('/graph');
      // Our own confirmed write becomes the new baseline. Other editor drafts
      // remain protected if the caller has an independent unsaved node draft.
      state.expected = String(next.revision);
      if (!preserveEdits) state.clear();
      state.pending = null;
      state.graph = next;
      setGraph(next); setConflict(false); setStatus('ready');
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        state.dirty = true;
        try { receive(await request('/graph')); } catch { setStatus('reconnecting'); }
      }
      throw error;
    }
  }), [enqueue, receive, setGraph, state]);
  const discard = useCallback(() => {
    state.clear(); setConflict(false); setEditorEpoch(value => value + 1);
    if (state.pending) { const next = state.pending; state.pending = null; state.graph = next; state.expected = String(next.revision); setGraph({ ...next }); }
    else void reload();
  }, [receive, reload, state, setGraph]);
  return { reload, write, status, conflict, editorEpoch, getGraph: () => state.graph,
    markEdited: () => { state.dirty = true; },
    beginDrag: () => { state.dragging = true; },
    endDrag: () => { state.dragging = false; if (!state.dirty && state.pending) receive(state.pending); },
    resetEdited: () => { state.clear(); if (state.pending) receive(state.pending); },
    discard, accept: () => { state.accept(); setConflict(false); },
  };
}
