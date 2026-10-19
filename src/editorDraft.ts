// The current draft is synchronous, but keystrokes do not publish the workspace.
// Save/conflict/quit handlers can always read it, including before blur or during IME.
export class EditorDraft<T extends Record<string, unknown>> {
  value: T | null = null;
  reset(next: T | null) { this.value = next; }
  edit(key: keyof T, value: unknown) { if (this.value) this.value = { ...this.value, [key]: value }; }
}
