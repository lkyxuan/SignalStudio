// Recovery is read-only: never replay a failed mutation or poll a healthy graph.
export function retryGraphConnection(needsRecovery: () => boolean, visible: () => boolean, refresh: () => Promise<unknown>) {
  let alive = true;
  let timer: ReturnType<typeof setTimeout>;
  const tick = async () => {
    if (!alive || !needsRecovery()) return;
    if (visible()) await refresh();
    if (alive && needsRecovery()) timer = setTimeout(tick, 5000);
  };
  timer = setTimeout(tick, 5000);
  return () => { alive = false; clearTimeout(timer); };
}
