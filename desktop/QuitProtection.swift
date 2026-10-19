import Foundation

// A missing/broken page API is unknown, never proof of unsaved edits.
enum WorkspaceQuitState: String { case safe, draft, busy, unknown }

final class QuitProtection {
    static let query = """
    (() => {
      const state = typeof window.signalstudioQuitState === 'function'
        ? window.signalstudioQuitState()
        : typeof window.signalstudioCanQuit === 'function'
          ? (window.signalstudioCanQuit() ? 'safe' : 'draft') : 'unknown';
      return JSON.stringify({state, hint: typeof window.signalstudioQuitHint === 'function' ? window.signalstudioQuitHint() : ''});
    })()
    """
    // Complete exactly once even if WebKit never replies, or replies after timeout.
    static func check(timeout: TimeInterval = 4,
                      evaluate: (@escaping (Any?, Error?) -> Void) -> Void,
                      completion: @escaping (WorkspaceQuitState, String) -> Void) {
        var finished = false
        let finish: (WorkspaceQuitState, String) -> Void = { state, hint in
            guard !finished else { return }
            finished = true
            completion(state, hint)
        }
        let deadline = DispatchWorkItem { finish(.unknown, "") }
        DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: deadline)
        evaluate { value, error in
            guard !finished else { return }
            deadline.cancel()
            guard error == nil, let json = value as? String, let data = json.data(using: .utf8),
                  let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let raw = result["state"] as? String, let state = WorkspaceQuitState(rawValue: raw) else {
                finish(.unknown, ""); return
            }
            finish(state, result["hint"] as? String ?? "")
        }
    }
}
