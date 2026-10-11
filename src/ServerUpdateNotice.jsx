import React, { useEffect, useState } from 'react';
import { commitURL, repository, uiBuild, versionLabel } from './buildVersion';

export function useServerVersion() {
  const [version, setVersion] = useState({ revision: null, confirmedAt: null, reachable: false });
  useEffect(() => {
    let alive = true;
    let timer;
    const check = async () => {
      try {
        const response = await fetch('/__signalstudio_health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        const health = response.ok ? await response.json() : null;
        if (!health || health.app !== 'SignalStudio' || !health.client_ready || !commitURL(health.code_revision)) throw Error('Unconfirmed');
        if (alive) setVersion({ revision: health.code_revision, confirmedAt: new Date().toISOString(), reachable: true });
      } catch {
        if (alive) setVersion(value => ({ ...value, reachable: false }));
      }
      if (alive) timer = setTimeout(check, 10000);
    };
    void check();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return version;
}

export function ServerUpdateNotice({ language, version }) {
  const updated = version.reachable && commitURL(uiBuild.revision) && uiBuild.revision !== version.revision;
  return updated ? <div className="live-update-banner" role="status">{language === 'zh-CN'
    ? (window.location.protocol === 'signalstudio:' ? '工作台有新版本。请先保存编辑，再重新打开 App。' : '工作台有新版本。请先保存编辑，再刷新页面。')
    : (window.location.protocol === 'signalstudio:' ? 'A workspace update is available. Save edits, then reopen the App.' : 'A workspace update is available. Save your edits, then refresh the page.')}</div> : null;
}

export function WorkspaceVersion({ language, version }) {
  const zh = language === 'zh-CN';
  const label = versionLabel(uiBuild, language);
  const link = commitURL(uiBuild.revision);
  const nativeRevision = window.signalstudioWorkspace?.appRevision;
  const revisionLink = revision => commitURL(revision) ? <a href={commitURL(revision)} target="_blank" rel="noreferrer">{revision}</a> : (zh ? '未知' : 'Unknown');
  return <div className="workspace-version">
    <div>{zh ? '界面版本 · ' : 'UI version · '}{link ? <a href={link} target="_blank" rel="noreferrer">{label}</a> : label}</div>
    <details><summary>{zh ? '版本详情' : 'Version details'}</summary><div className="version-details">
      <p>{zh ? '当前界面' : 'Current UI'}<br />{revisionLink(uiBuild.revision)}{uiBuild.dirty && <span> · {zh ? '含本地修改' : 'Local changes'}</span>}</p>
      <p>{zh ? '服务器（最近确认）' : 'Server (last confirmed)'}<br />{revisionLink(version.revision)}<br />{version.confirmedAt ? new Date(version.confirmedAt).toLocaleString(language) : (zh ? '尚未确认' : 'Not confirmed')}{!version.reachable && <span> · {zh ? '当前未确认连接' : 'Connection unconfirmed'}</span>}</p>
      {nativeRevision && <p>{zh ? 'App 安装包' : 'App bundle'}<br />{revisionLink(nativeRevision)}</p>}
      <a href={`${repository}/commits/main/`} target="_blank" rel="noreferrer">{zh ? '在 GitHub 核对 main 最新提交 ↗' : 'Compare with GitHub main ↗'}</a>
    </div></details>
  </div>;
}
