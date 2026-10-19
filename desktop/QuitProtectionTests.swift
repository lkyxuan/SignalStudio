import Cocoa
import WebKit

@main struct QuitProtectionTests {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 500, height: 300))
        view.loadHTMLString("<html><body>isolated quit checks</body></html>", baseURL: nil)
        let cases: [(String, WorkspaceQuitState)] = [
            ("window.signalstudioQuitState = () => 'safe'", .safe),
            ("window.signalstudioQuitState = () => 'draft'; window.signalstudioQuitHint = () => '保存卡片定义'", .draft),
            ("window.signalstudioQuitState = () => 'busy'", .busy),
            ("window.signalstudioQuitState = () => {throw Error('test')}", .unknown),
            ("window.signalstudioQuitState = () => 'invalid'", .unknown),
            ("delete window.signalstudioQuitState; delete window.signalstudioQuitHint", .unknown),
            ("window.signalstudioCanQuit = () => true", .safe),
            ("window.signalstudioCanQuit = () => false", .draft)
        ]
        var index = 0
        var running = false
        let timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { timer in
            guard !running else { return }
            running = true
            view.evaluateJavaScript(cases[index].0 + "; void 0") { _, error in
                precondition(error == nil)
                QuitProtection.check(evaluate: { callback in
                    view.evaluateJavaScript(QuitProtection.query, completionHandler: callback)
                }) { state, hint in
                    precondition(state == cases[index].1, "Wrong state for \(index): \(state)")
                    if index == 1 { precondition(hint == "保存卡片定义") }
                    index += 1
                    if index < cases.count { running = false; return }
                    timer.invalidate()
                    var completions = 0
                    var late: ((Any?, Error?) -> Void)?
                    QuitProtection.check(timeout: 0.05, evaluate: { late = $0 }) { state, _ in
                        precondition(state == .unknown); completions += 1
                        DispatchQueue.main.async {
                            late?("{\"state\":\"safe\"}", nil)
                            precondition(completions == 1, "Late WebKit callback completed twice")
                            print("8 WebKit quit states, legacy compatibility, hints, timeout and late reply passed")
                            exit(0)
                        }
                    }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fputs("Quit test timed out\n", stderr); exit(1) }
        app.run(); timer.invalidate()
        withExtendedLifetime(view) {}
    }
}
