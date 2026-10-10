import React, { useEffect, useRef, useState } from 'react';

export function ServerUpdateNotice({ language }) {
  const initial = useRef(null);
  const [updated, setUpdated] = useState(false);
  useEffect(() => {
    let alive = true;
    let timer;
    const check = async () => {
      try {
        const response = await fetch('/__signalstudio_health', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
        if (response.ok) {
          const health = await response.json();
          if (alive && health.app === 'SignalStudio' && health.client_ready && health.code_revision) {
            initial.current ??= health.code_revision;
            setUpdated(initial.current !== health.code_revision);
          }
        }
      } catch { /* Existing connection status handles outages; preserve the editor. */ }
      if (alive) timer = setTimeout(check, 10000);
    };
    void check();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return updated ? <div className="live-update-banner" role="status">{language === 'zh-CN'
    ? '工作台有新版本。请先保存编辑，再刷新页面。'
    : 'A workspace update is available. Save your edits, then refresh the page.'}</div> : null;
}
