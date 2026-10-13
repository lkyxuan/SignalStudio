import React, { useEffect, useState } from 'react';
import { commitURL, repository, uiBuild, versionLabel } from './buildVersion';
import { refreshWorkspace } from './refreshWorkspace';

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
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const zh = language === 'zh-CN';
  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    const result = await refreshWorkspace();
    if (result !== 'refreshed') setError(result);
    setRefreshing(false);
  };
  const updated = version.reachable && commitURL(uiBuild.revision) && uiBuild.revision !== version.revision;
  return updated ? <div className="live-update-banner" role="status">
    <span>{zh ? '工作台有新版本。请先保存编辑，再刷新工作台。' : 'A workspace update is available. Save edits, then refresh the workspace.'}</span>
    <button disabled={refreshing} onClick={refresh}>{refreshing ? (zh ? '正在刷新…' : 'Refreshing…') : (zh ? '刷新工作台' : 'Refresh workspace')}</button>
    {error && <span role="alert">{error === 'blocked'
      ? (zh ? '有未保存编辑、进行中的操作，或无法确认编辑状态。请先完成保存再刷新。' : 'Unsaved edits, pending operations, or an unconfirmed editor state. Finish saving before refreshing.')
      : (zh ? '暂时无法确认工作台连接，请稍后重试。' : 'Workspace connection could not be confirmed. Try again later.')}</span>}
  </div> : null;
}

export function WorkspaceVersion({ language, version }) {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(null);
  const [client, setClient] = useState(window.signalstudioClient ?? null);
  const [error, setError] = useState('');
  const native = window.webkit?.messageHandlers?.clientUpdater;
  const refresh = async () => {
    setError('');
    try {
      const response = await fetch('/__signalstudio_updater', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw Error('Unavailable');
      const value = await response.json();
      if (typeof value.phase !== 'string') throw Error('Invalid');
      setHost(value);
    } catch { setHost({ phase: 'unreachable', stale: true }); }
    if (native) {
      try { setClient(await native.postMessage({ action: 'status' })); }
      catch { setError(language === 'zh-CN' ? '客户端更新状态暂时不可用' : 'Client update status unavailable'); }
    }
  };
  const clientAction = async (action, enabled) => {
    try { setClient(await native.postMessage({ action, enabled })); }
    catch { setError(language === 'zh-CN' ? '客户端更新操作失败，请从Mac菜单重试' : 'Update action failed. Retry from the Mac menu.'); }
  };
  useEffect(() => {
    const changed = () => setClient(window.signalstudioClient ?? null);
    window.addEventListener('signalstudio-client-update', changed);
    return () => window.removeEventListener('signalstudio-client-update', changed);
  }, []);
  useEffect(() => {
    if (!open) return;
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, [open]);
  const zh = language === 'zh-CN';
  const label = versionLabel(uiBuild, language);
  const link = commitURL(uiBuild.revision);
  const nativeRevision = window.signalstudioWorkspace?.appRevision;
  const revisionLink = revision => commitURL(revision) ? <a href={commitURL(revision)} target="_blank" rel="noreferrer">{revision}</a> : (zh ? '未知' : 'Unknown');
  return <div className="workspace-version">
    <div>{zh ? '界面版本 · ' : 'UI version · '}{link ? <a href={link} target="_blank" rel="noreferrer">{label}</a> : label}</div>
    <button className="sidebar-link" onClick={() => setOpen(true)}>{zh ? '检查更新' : 'Check for updates'}</button>
    {open && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label={zh ? '检查更新' : 'Check for updates'}>
      <div className="modal-header"><h2>{zh ? '检查更新' : 'Check for updates'}</h2><button className="button-secondary" onClick={() => setOpen(false)}>{zh ? '关闭' : 'Close'}</button></div>
      <div className="modal-body update-panel">
        <h3>{zh ? '当前界面' : 'Current UI'}</h3><p>{label}</p>
        <p>{!version.reachable ? (zh ? '暂时无法确认主机版本' : 'Host version unconfirmed') : uiBuild.revision !== version.revision ? (zh ? '界面有更新，请先保存编辑，再刷新页面；备用界面请重新打开App。' : 'UI update available. Save edits, then refresh; reopen the App for its bundled UI.') : (zh ? '与最近确认的主机版本一致' : 'Matches the last confirmed host version')}</p>
        <h3>{zh ? '共享服务' : 'Shared service'}</h3>
        <p>{host ? ({current: zh ? '已更新' : 'Current', checking: zh ? '正在检查' : 'Checking', paused: zh ? '已暂停' : 'Paused', failed: zh ? '失败' : 'Failed', updated: zh ? '已更新' : 'Updated', 'not-installed': zh ? '未安装更新器' : 'Updater not installed', unreachable: zh ? '无法连接' : 'Unreachable', validating: zh ? '正在验证候选版本' : 'Validating candidate', stopping: zh ? '正在停止服务' : 'Stopping service', applying: zh ? '正在应用更新' : 'Applying update', starting: zh ? '正在启动服务' : 'Starting service', rolling_back: zh ? '正在回退' : 'Rolling back', rolled_back: zh ? '已回退' : 'Rolled back', recovery_required: zh ? '需要人工恢复' : 'Recovery required', unknown: zh ? '状态未知' : 'Unknown'}[host.phase] ?? host.phase) : (zh ? '正在读取状态…' : 'Reading status…')}{host?.stale && (zh ? ' · 尚未确认最新状态' : ' · Status unconfirmed')}</p>
        {host?.reason && <p>{host.reason}</p>}
        <p>{zh ? '当前提交：' : 'Current commit: '}{host?.current_commit?.slice(0, 7) ?? '—'}<br />{zh ? '候选提交：' : 'Candidate commit: '}{host?.candidate_commit?.slice(0, 7) ?? '—'}<br />{zh ? '最近检查：' : 'Last check: '}{host?.last_check ? new Date(host.last_check).toLocaleString(language) : '—'}</p>
        <h3>{zh ? 'Mac 客户端' : 'Mac client'}</h3>
        {client ? <><p>{client.version} · {client.revision?.slice(0, 7)} · {zh ? '共享预发布通道' : 'Shared preview channel'}</p>
          <p>{({unchecked: zh ? '尚未检查' : 'Not checked', checking: zh ? '正在检查' : 'Checking', available: zh ? '发现新版' : 'Update available', downloading: zh ? '正在下载' : 'Downloading', verifying: zh ? '正在校验' : 'Verifying', ready: zh ? '新版已就绪，正常退出时自动安装' : 'Ready; installs on normal quit', 'no-update': zh ? '没有可安装更新' : 'No installable update', error: zh ? '更新失败' : 'Update failed'}[client.phase] ?? client.phase)}{client.availableVersion && ` · ${client.availableVersion}`}</p>
          {client.detail && <p>{client.detail}</p>}
          <p>{client.checkedAt ? new Date(client.checkedAt).toLocaleString(language) : ''}</p>
          <label><input type="checkbox" checked={client.automatic} onChange={e => clientAction('automatic', e.target.checked)} /> {zh ? '自动检查、下载并在退出时安装' : 'Automatically check, download and install on quit'}</label>
          <p>{zh ? '未保存编辑时不会为更新强制退出。' : 'Updates never force quit unsaved edits.'}</p>
          <button className="button-primary" disabled={!client.canCheck} onClick={() => clientAction('check')}>{client.phase === 'ready' ? (zh ? '安装并重启' : 'Install and restart') : (zh ? '检查客户端更新' : 'Check client updates')}</button>
        </> : <p>{window.signalstudioWorkspace?.appRevision ? (zh ? '此客户端未提供自动更新能力或属于开发版；需要首次安装带更新器的共享版。' : 'This older or development client needs the first updater-enabled shared version.') : (zh ? '浏览器未提供Mac客户端版本；客户端更新在App内完成。' : 'Mac client version unavailable in this browser. Update from the App.')}</p>}
        {error && <p role="alert">{error}</p>}
      </div><div className="modal-footer"><span>{zh ? '状态每5秒自动刷新' : 'Status refreshes automatically every 5 seconds'}</span></div>
    </section></div>}
    <details><summary>{zh ? '版本详情' : 'Version details'}</summary><div className="version-details">
      <p>{zh ? '当前界面' : 'Current UI'}<br />{revisionLink(uiBuild.revision)}{uiBuild.dirty && <span> · {zh ? '含本地修改' : 'Local changes'}</span>}</p>
      <p>{zh ? '服务器（最近确认）' : 'Server (last confirmed)'}<br />{revisionLink(version.revision)}<br />{version.confirmedAt ? new Date(version.confirmedAt).toLocaleString(language) : (zh ? '尚未确认' : 'Not confirmed')}{!version.reachable && <span> · {zh ? '当前未确认连接' : 'Connection unconfirmed'}</span>}</p>
      {nativeRevision && <p>{zh ? 'App 安装包' : 'App bundle'}<br />{revisionLink(nativeRevision)}</p>}
      <a href={`${repository}/commits/main/`} target="_blank" rel="noreferrer">{zh ? '在 GitHub 核对 main 最新提交 ↗' : 'Compare with GitHub main ↗'}</a>
    </div></details>
  </div>;
}
