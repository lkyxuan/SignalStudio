export type BuildVersion = { revision: string | null; dirty: boolean };
declare const __SIGNALSTUDIO_BUILD__: BuildVersion;
export const uiBuild: BuildVersion = typeof __SIGNALSTUDIO_BUILD__ === 'undefined'
  ? { revision: null, dirty: false } : __SIGNALSTUDIO_BUILD__;
export const repository = 'https://github.com/lkyxuan/SignalStudio';
export function commitURL(revision: string | null | undefined) {
  return revision && /^[0-9a-f]{40}$/.test(revision) ? `${repository}/commit/${revision}` : null;
}
export function versionLabel(build: BuildVersion, language: string) {
  const revision = commitURL(build.revision) ? build.revision!.slice(0, 7) : (language === 'zh-CN' ? '未知' : 'Unknown');
  return revision + (build.dirty ? (language === 'zh-CN' ? ' · 本地修改' : ' · Local changes') : '');
}
