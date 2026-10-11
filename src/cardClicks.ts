// Defer details so the first click of a double-click cannot open the inspector.
export function createCardClickDispatcher(delay = 350) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { clearTimeout(pending); pending = undefined; };
  return {
    cancel,
    single(action: () => void, clickCount = 1) {
      cancel();
      if (clickCount > 1) return;
      pending = setTimeout(() => { pending = undefined; action(); }, delay);
    },
    double(action: () => void) { cancel(); action(); },
  };
}
