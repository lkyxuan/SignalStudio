import type { Graph } from './contracts';
import { ApiError, NOT_MODIFIED, request, requestGraph } from './api';
import { GraphCache, sameWorkspace, workspaceSchema, type Workspace } from './graphCache';
import { detailsReady, detailsSchema, mergeDetails } from './graphTransport';
import { LiveGraphState } from './liveGraph';

export class LiveGraphSession extends LiveGraphState {
  writable = false;
  status = 'connecting';
  confirmedAt: string | null = null;
  cacheAvailable = true;
  remote: Graph | null = null;
  workspace?: Workspace;
  constructor(private cache: GraphCache | null, expected?: Workspace) {
    super();
    const restored = cache?.read(expected);
    this.workspace = expected ?? restored?.workspace;
    if (restored) {
      this.receive(restored.graph); this.remote = restored.graph;
      this.confirmedAt = restored.confirmedAt; this.status = 'cached';
    }
  }
  private checkIdentity(value: unknown) {
    const workspace = workspaceSchema.parse(value);
    if (this.workspace && !sameWorkspace(workspace, this.workspace)) {
      this.status = 'identity-error';
      throw new Error('工作台身份不匹配，已禁止保存。请核对连接地址。');
    }
    this.workspace = workspace;
    return workspace;
  }
  fail() { this.writable = false; if (this.status !== 'identity-error') this.status = 'reconnecting'; }
  private remember(graph: Graph) {
    this.remote = graph;
    this.confirmedAt = new Date().toISOString();
    this.cacheAvailable = !!this.cache?.save(this.workspace!, graph, this.confirmedAt);
    this.status = 'ready'; this.writable = true;
  }
  async refresh() {
    try {
      const health = await request('/desktop-health') as Record<string, unknown>;
      if (health.app !== 'SignalStudio' || health.client_ready !== true) throw new Error('工作台尚未就绪');
      this.checkIdentity(health);
      const next = await requestGraph(this.remote?.revision, this.workspace, this.remote);
      if (next === NOT_MODIFIED) {
        if (!this.remote) throw new Error('没有可校验的图快照');
        this.remember(this.remote);
        return false; // Never clear a draft or pending conflict on 304.
      }
      this.checkIdentity(next.workspace);
      if (!next.revision) throw new Error('工作台版本缺失');
      this.remember(next);
      return this.receive(next);
    } catch (error) { if (error instanceof ApiError && error.status === 412) this.status = 'identity-error'; this.fail(); throw error; }
  }
  async loadDetails(nodeIds: string[]) {
    if (!this.remote || detailsReady(this.graph, nodeIds)) return false;
    if (!this.writable) throw new Error('详情尚未缓存，联网后可加载。');
    try {
      const query = new URLSearchParams({revision:this.remote.revision!});
      for (const id of nodeIds) query.append('node_id', id);
      const value = detailsSchema.parse(await request(`/graph/details?${query}`, {headers:{'X-Workspace-Identity':JSON.stringify(this.workspace)}}));
      this.checkIdentity(value.workspace);
      if (value.revision !== this.remote.revision) throw Error('详情版本已更新，请重试。');
      this.remote = mergeDetails(this.remote, value);
      if (this.pending) this.pending = mergeDetails(this.pending, value);
      if (this.graph) this.graph = mergeDetails(this.graph, value);
      this.cacheAvailable = !!this.cache?.save(this.workspace!, this.remote, this.confirmedAt!);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) this.status = 'identity-error';
      if (!(error instanceof ApiError && error.status === 409)) this.fail();
      throw error;
    }
  }
  async write(path: string, method: string, body: unknown, preserveEdits = false) {
    if (!this.writable || !this.expected) throw new Error('当前为只读状态，等待联网并确认最新工作台版本后才能保存。');
    if (this.conflict) throw new Error('请先处理外部更新冲突，再保存。');
    try {
      const result = await request(path, { method, body, headers: { 'If-Match': this.expected, 'X-Workspace-Identity': JSON.stringify(this.workspace) } });
      let next = await requestGraph(this.remote?.revision, this.workspace, this.remote);
      if (next === NOT_MODIFIED && this.remote) next = this.remote;
      if (next === NOT_MODIFIED || !next.revision) throw new Error('保存后未能确认最新图版本');
      this.checkIdentity(next.workspace);
      this.remember(next);
      this.expected = next.revision;
      if (!preserveEdits) this.clear();
      this.pending = null; this.graph = next;
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) this.status = 'identity-error';
      this.fail();
      if (error instanceof ApiError && error.status === 409) {
        this.dirty = true;
        try { await this.refresh(); } catch { /* Keep draft and read-only state. */ }
      }
      // A timeout may have committed. Never replay this mutation automatically.
      throw error;
    }
  }
}
