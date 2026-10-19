declare global { interface Window { signalstudioQuitHint?: () => string } }

export function workspaceQuitHint(create: boolean, prompt: boolean, language: string) {
  const zh = language === 'zh-CN';
  if (create) return zh ? '新节点窗口尚未关闭。返回后点击“创建节点”保存，或取消创建；也可放弃草稿并退出。' : 'Return to the new-node window and choose Create node or Cancel, or discard the draft and quit.';
  if (prompt) return zh ? '提议窗口尚未关闭。返回后生成并确认应用提议，或取消；也可放弃草稿并退出。' : 'Return to the proposal window to review and apply the proposal or cancel, or discard the draft and quit.';
  return zh ? '当前卡片或连接有未保存编辑。返回后会定位编辑区域；请点击该区域的“保存更改”“保存卡片定义”“保存说明”“保存字段”或“保存连接”。也可放弃草稿并退出。' : 'Return to the edited card or connection and use its Save button, or discard the draft and quit.';
}

export function revealWorkspaceEdit(doc: Document, last: HTMLElement | null) {
  // A modal is above the inspector and must be handled first.
  const modal = doc.querySelector<HTMLElement>('.modal-backdrop');
  const target = modal?.querySelector<HTMLElement>('input, textarea, select')
    ?? modal?.querySelector<HTMLElement>('button')
    ?? (last?.isConnected ? last : doc.querySelector<HTMLElement>('.inspector [data-workspace-editor]'));
  if (!target) return;
  // Save controls can live inside collapsed technical settings.
  for (let parent: HTMLElement | null = target; parent; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true;
  }
  target.scrollIntoView({ block: 'center' });
  const control = target.matches('input, textarea, select, button') ? target : target.querySelector<HTMLElement>('input, textarea, select, button');
  control?.focus({ preventScroll: true });
}
