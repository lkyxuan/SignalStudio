import Cocoa
import WebKit

@main struct ClientBridgeTests {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let endpoint = URL(string: CommandLine.arguments[1])!
        let bridge = ClientUpdater()
        bridge.allows = { $0.host == endpoint.host && $0.port == endpoint.port && $0.path == "/trusted" }
        let config = WKWebViewConfiguration()
        bridge.configure(config)
        let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 300), configuration: config)
        let window = NSWindow(contentRect: view.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = view; window.orderFrontRegardless()
        view.load(URLRequest(url: endpoint.appendingPathComponent("trusted")))
        var stage = 0
        var running = false
        let timer = Timer.scheduledTimer(withTimeInterval: 0.3, repeats: true) { _ in
            guard !running else { return }
            view.evaluateJavaScript("document.readyState") { ready, _ in
                guard ready as? String == "complete" else { return }
                running = true
                if stage == 0 {
                    let script = """
                    const state = await webkit.messageHandlers.clientUpdater.postMessage({action:'status'});
                    if (!state.phase || typeof state.automatic !== 'boolean') throw Error('Missing status');
                    let denied = false;
                    try { await webkit.messageHandlers.clientUpdater.postMessage({action:'execute',command:'ignored'}); } catch { denied = true; }
                    if (!denied) throw Error('Unknown action accepted');
                    const frame = document.createElement('iframe');
                    frame.src = '/trusted'; document.body.append(frame);
                    await new Promise(resolve => frame.onload = resolve);
                    let frameDenied = false;
                    try { await frame.contentWindow.webkit.messageHandlers.clientUpdater.postMessage({action:'status'}); } catch { frameDenied = true; }
                    if (!frameDenied) throw Error('Child frame accepted');
                    return true;
                    """
                    view.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                        switch result {
                        case .success: stage = 1; running = false; view.load(URLRequest(url: endpoint.appendingPathComponent("untrusted")))
                        case .failure(let error): fputs("\(error)\n", stderr); exit(1)
                        }
                    }
                } else {
                    view.callAsyncJavaScript("try { await webkit.messageHandlers.clientUpdater.postMessage({action:'status'}); return false; } catch { return true; }", arguments: [:], in: nil, in: .page) { result in
                        guard case .success(let value) = result, value as? Bool == true else { fputs("Untrusted origin accepted\n", stderr); exit(1) }
                        print("Trusted main frame, child-frame rejection and unsupported actions passed")
                        exit(0)
                    }
                }
            }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { fputs("Bridge test timed out\n", stderr); exit(1) }
        app.run(); timer.invalidate()
        withExtendedLifetime((bridge, view, window)) {}
    }
}
