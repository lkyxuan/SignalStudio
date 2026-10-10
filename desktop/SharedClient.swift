import Cocoa
import WebKit

final class SharedClient: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSTextField!
    private var retry: NSButton!
    private var connection: SharedConnection?
    private var generation = 0
    private var loaded = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let path = Bundle.main.url(forResource: "SignalStudio", withExtension: "icns"), let icon = NSImage(contentsOf: path) {
            NSApp.applicationIconImage = icon
        }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "工作台连接…", action: #selector(configure), keyEquivalent: ",")
        appMenu.addItem(withTitle: "退出 SignalStudio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        menu.addItem(editItem)
        let edit = NSMenu(title: "编辑")
        edit.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "SignalStudio · 共享工作台"
        window.minSize = NSSize(width: 900, height: 600)
        window.isReleasedWhenClosed = false
        window.center()
        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.isHidden = true
        window.contentView!.addSubview(webView)
        status = NSTextField(wrappingLabelWithString: "正在连接共享工作台…")
        status.frame = NSRect(x: 30, y: 65, width: 1100, height: 100)
        status.autoresizingMask = [.width, .maxYMargin]
        status.font = NSFont.systemFont(ofSize: 18)
        window.contentView!.addSubview(status)
        retry = NSButton(title: "重新连接", target: self, action: #selector(reconnect))
        retry.frame = NSRect(x: 30, y: 25, width: 160, height: 30)
        retry.autoresizingMask = [.maxYMargin]
        retry.isHidden = true
        window.contentView!.addSubview(retry)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        do {
            connection = try SharedConnection.load()
            reconnect()
        } catch {
            status.stringValue = "连接你的 Mac mini 共享工作台。请先开启 Tailscale。"
            configure()
        }
    }

    @objc private func configure() {
        let alert = NSAlert()
        alert.messageText = "连接共享工作台"
        alert.informativeText = loaded
            ? "请先保存工作台中的编辑。切换连接会重新加载页面。输入 Mac mini 工作台地址；数据保存在主机上。"
            : "先开启 Tailscale，再输入 Mac mini 工作台地址。此 App 不启动本地后台，数据保存在主机上。"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 420, height: 26))
        field.placeholderString = "http://主机地址:端口"
        field.stringValue = connection?.baseURL ?? ""
        alert.accessoryView = field
        alert.addButton(withTitle: "检查连接")
        alert.addButton(withTitle: "取消")
        alert.window.initialFirstResponder = field
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else {
                if self.connection == nil { self.showFailure("尚未配置工作台。通过菜单“工作台连接…”填写地址。") }
                return
            }
            do {
                let address = try SharedConnection.address(field.stringValue)
                // Preserve the current page until the new endpoint is checked and explicitly accepted.
                self.generation += 1
                let current = self.generation
                SharedConnection.check(address, expectedRoot: nil) { result in
                    DispatchQueue.main.async {
                        guard current == self.generation else { return }
                        switch result {
                        case .failure(let error):
                            let errorAlert = NSAlert()
                            errorAlert.messageText = "连接检查失败"
                            errorAlert.informativeText = error.localizedDescription + " 请检查地址、Tailscale 与主机服务。"
                            errorAlert.beginSheetModal(for: self.window)
                        case .success(let candidate): self.confirm(candidate)
                        }
                    }
                }
            } catch {
                let errorAlert = NSAlert()
                errorAlert.messageText = "地址无效"
                errorAlert.informativeText = error.localizedDescription
                errorAlert.beginSheetModal(for: self.window)
            }
        }
    }

    private func confirm(_ candidate: SharedConnection) {
        let alert = NSAlert()
        alert.messageText = "使用这个工作台？"
        alert.informativeText = "地址：\(candidate.baseURL)\n主机项目：\(candidate.projectRoot)\n\n请核对主机。确认后会记住该工作台并加载页面；已有编辑请先保存。"
        alert.addButton(withTitle: "使用此工作台")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { response in
            guard response == .alertFirstButtonReturn else { return }
            do {
                try candidate.save()
                self.connection = candidate
                self.reconnect()
            } catch { self.showFailure("无法保存连接设置：\(error.localizedDescription)") }
        }
    }

    @objc private func reconnect() {
        guard let connection = connection, let address = try? SharedConnection.address(connection.baseURL) else {
            configure(); return
        }
        generation += 1
        let current = generation
        // Retry is offered only after navigation fails. Never auto-reload an open draft.
        webView.isHidden = true
        status.isHidden = false
        retry.isHidden = true
        status.stringValue = "正在连接共享工作台…"
        SharedConnection.check(address, expectedRoot: connection.projectRoot) { result in
            DispatchQueue.main.async {
                guard current == self.generation else { return }
                switch result {
                case .success: self.webView.load(URLRequest(url: address))
                case .failure(let error):
                    self.showFailure("无法连接共享工作台。\(error.localizedDescription) 请检查 Tailscale 与 Mac mini 服务，然后重新连接。可通过菜单修改地址。")
                }
            }
        }
    }

    private func showFailure(_ message: String) {
        status.stringValue = message
        status.isHidden = false
        retry.isHidden = false
        webView.isHidden = true
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let target = navigationAction.request.url, let connection = connection,
              let origin = URL(string: connection.baseURL) else { decisionHandler(.cancel); return }
        let sameOrigin = target.scheme == origin.scheme && target.host == origin.host && target.port == origin.port
        if sameOrigin { decisionHandler(.allow) }
        else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated && ["http", "https"].contains(target.scheme ?? "") {
                NSWorkspace.shared.open(target)
            }
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        status.isHidden = true; retry.isHidden = true; webView.isHidden = false
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded = true }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { showFailure("页面加载失败：\(error.localizedDescription)。请检查网络后重新连接。") }
    }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil); return true
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// A read-only diagnostic also verifies the distributed binary without a development PATH.
@main struct SharedClientMain {
    static func main() {
        let args = CommandLine.arguments
        if let index = args.firstIndex(of: "--check-connection"), args.count > index + 1 {
            do {
                let address = try SharedConnection.address(args[index + 1])
                let expected = args.firstIndex(of: "--expected-root").flatMap { args.count > $0 + 1 ? args[$0 + 1] : nil }
                let finished = DispatchSemaphore(value: 0)
                var outcome: Result<SharedConnection, Error>?
                SharedConnection.check(address, expectedRoot: expected) { outcome = $0; finished.signal() }
                guard finished.wait(timeout: .now() + 12) == .success else { throw ConnectionError.notReady }
                let result = try outcome!.get()
                print(String(data: try JSONEncoder().encode(result), encoding: .utf8)!)
            } catch { fputs("\(error.localizedDescription)\n", stderr); exit(1) }
            return
        }
        let app = NSApplication.shared
        let delegate = SharedClient()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
