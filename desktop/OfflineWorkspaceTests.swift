import Cocoa
import WebKit

@main struct OfflineWorkspaceTests {
    static func main() throws {
        let args = CommandLine.arguments
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let offline = OfflineWorkspace(endpoint: URL(string: args[1])!, root: args[2], shell: URL(fileURLWithPath: args[3]))
        let configuration = WKWebViewConfiguration()
        try offline.configure(configuration)
        // This test window does not become key; exercise a visible-client poll explicitly.
        configuration.userContentController.addUserScript(WKUserScript(source: "Object.defineProperty(document, 'visibilityState', {get: () => 'visible'});", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1200, height: 800), configuration: configuration)
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view
        // Keep WebKit active without stealing focus from the user's current App.
        window.orderFrontRegardless()
        offline.open(in: view, failure: { message in fputs(message, stderr); exit(1) })
        let deadline = Date().addingTimeInterval(30)
        var passed = false
        var finishing = false
        let timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in
            let expression = """
            JSON.stringify({text:document.body.innerText, nodes:document.querySelectorAll('.react-flow__node').length,
             storage:window.signalstudioStorage ? 1 : 0})
            """
            view.evaluateJavaScript(expression) { value, error in
                let text = value as? String ?? ""
                let expected = args[4] == "online" ? "已连接主机" : (args[4] == "empty" ? "尚无可用快照" : "正在显示本地只读快照")
                let parsed = text.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                if text.contains(expected) && (args[4] == "empty" ? (parsed?["nodes"] as? Int ?? -1) == 0 : (parsed?["nodes"] as? Int ?? 0) > 0) && !finishing {
                    print("native shell \(args[4]): nodes=\(parsed?["nodes"] ?? 0), snapshots=\(parsed?["storage"] ?? 0)"); passed = true; finishing = true;
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(0) }
                } else if Date() > deadline {
                    fputs("Shell did not become ready: \(text) \(String(describing: error))\n", stderr)
                    exit(1)
                }
            }
        }
        app.run()
        timer.invalidate()
        withExtendedLifetime((offline, view, window)) {}
        if !passed { exit(1) }
    }
}
