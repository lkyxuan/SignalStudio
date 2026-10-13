declare global {
  interface Window { signalstudioQuitState?: () => 'safe' | 'draft' | 'busy' }
}

// Use the same live editor check as the Mac client's quit protection, including
// a second check after the network request: editing may start while it waits.
export async function refreshWorkspace(browser: Window = window): Promise<'refreshed' | 'blocked' | 'unavailable'> {
  try {
    if (browser.signalstudioQuitState?.() !== 'safe') return 'blocked';
    const response = await browser.fetch('/__signalstudio_health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    const health = response.ok ? await response.json() : null;
    if (health?.app !== 'SignalStudio' || health.client_ready !== true || health.mode !== 'development') return 'unavailable';
    const context = browser.signalstudioWorkspace;
    if (context && (health.project_root !== context.workspace.project_root || health.database_path !== context.workspace.database_path)) return 'unavailable';
    const bundled = browser.location.protocol === 'signalstudio:';
    const target = bundled && context ? new URL(context.endpoint) : null;
    if (bundled && (!target || !['http:', 'https:'].includes(target.protocol))) return 'unavailable';
    if (browser.signalstudioQuitState?.() !== 'safe') return 'blocked';
    if (target) browser.location.assign(target.href);
    else browser.location.reload();
    return 'refreshed';
  } catch { return 'unavailable'; }
}
