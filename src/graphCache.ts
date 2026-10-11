import { z } from 'zod';
import { graphSchema, type Graph } from './contracts';

export const workspaceSchema = z.object({ project_root: z.string().min(1), database_path: z.string().min(1) });
export type Workspace = z.infer<typeof workspaceSchema>;
export const sameWorkspace = (a: Workspace, b: Workspace) => a.project_root === b.project_root && a.database_path === b.database_path;
export type CachedGraph = { workspace: Workspace; graph: Graph; confirmedAt: string };
const envelope = z.object({ format: z.literal(1), endpoint: z.string(), workspace: workspaceSchema,
  graph: graphSchema, confirmedAt: z.iso.datetime() });
// The endpoint includes the native client's selected remote address, never its shell URL.
export class GraphCache {
  constructor(private storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, private endpoint: string) {}
  private key(workspace: Workspace) { return `signalstudio:graph:v1:${JSON.stringify([this.endpoint, workspace.project_root, workspace.database_path])}`; }
  read(expected?: Workspace): CachedGraph | null {
    try {
      const workspace = expected ?? workspaceSchema.parse(JSON.parse(this.storage.getItem(`signalstudio:workspace:${this.endpoint}`) || 'null'));
      const value = envelope.parse(JSON.parse(this.storage.getItem(this.key(workspace)) || 'null'));
      if (value.endpoint !== this.endpoint || !sameWorkspace(value.workspace, workspace) ||
          !value.graph.revision || !sameWorkspace(workspaceSchema.parse(value.graph.workspace), workspace)) return null;
      return value;
    } catch { return null; }
  }
  save(workspace: Workspace, graph: Graph, confirmedAt: string): boolean {
    try {
      const value = envelope.parse({ format: 1, endpoint: this.endpoint, workspace, graph, confirmedAt });
      if (!value.graph.revision || !sameWorkspace(workspaceSchema.parse(graph.workspace), workspace)) return false;
      this.storage.setItem(this.key(workspace), JSON.stringify(value));
      this.storage.setItem(`signalstudio:workspace:${this.endpoint}`, JSON.stringify(workspace));
      return true;
    } catch { return false; } // Private browsing, corruption, and quota must not stop remote reads.
  }
}
