import Cocoa
import WebKit

final class SharedClient: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSTextField!
    private var retry: NSButton!
    private var connection: SharedConnection?
    private var generation = 0
    private var loaded = false
    private var offlineWorkspace: OfflineWorkspace?
    private let updater = ClientUpdater()
    private var checkingQuit = false
    private var allowQuit = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let path = Bundle.main.url(forResource: "SignalStudio", withExtension: "icns"), let icon = NSImage(contentsOf: path) {
            NSApp.applicationIconImage = icon
        }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "检查更新…", action: #selector(checkUpdates), keyEquivalent: "")
        appMenu.addItem(withTitle: "自动更新设置…", action: #selector(updateSettings), keyEquivalent: "")
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
        window.delegate = self
        updater.changed = { [weak self] in self?.publishUpdater() }
        updater.allows = { [weak self] url in self?.trustedWorkspace(url) == true }
        updater.start()
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
        if let shell = Bundle.main.resourceURL?.appendingPathComponent("workspace-ui"),
           FileManager.default.fileExists(atPath: shell.appendingPathComponent("index.html").path) {
            do {
                let offline = OfflineWorkspace(endpoint: address, root: connection.projectRoot, shell: shell)
                let configuration = WKWebViewConfiguration()
                try offline.configure(configuration)
                updater.configure(configuration)
                webView.removeFromSuperview()
                webView = WKWebView(frame: window.contentView!.bounds, configuration: configuration)
                webView.autoresizingMask = [.width, .height]; webView.navigationDelegate = self
                window.contentView!.addSubview(webView)
                offlineWorkspace = offline
                offline.open(in: webView, failure: { [weak self] message in self?.showFailure(message) })
            } catch { showFailure("无法加载离线界面：\(error.localizedDescription)") }
            return
        }
        SharedConnection.check(address, expectedRoot: connection.projectRoot) { result in
            DispatchQueue.main.async {
                guard current == self.generation else { return }
                switch result {
                case .success: self.webView.load(URLRequest(url: address))
                case .failure(let error): self.showFailure("无法连接共享工作台。\(error.localizedDescription)")
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
        if let offline = offlineWorkspace, offline.allows(target) {
            decisionHandler(.allow); return
        }
        let sameOrigin = offlineWorkspace == nil && target.scheme == origin.scheme && target.host == origin.host && target.port == origin.port
        if sameOrigin { decisionHandler(.allow) }
        else {
            decisionHandler(.cancel)
            if navigationAction.navigationType == .linkActivated && ["http", "https"].contains(target.scheme ?? "") {
                NSWorkspace.shared.open(target)
            }
        }
    }

    private func trustedWorkspace(_ url: URL) -> Bool {
        guard let connection = connection, let endpoint = URL(string: connection.baseURL) else { return false }
        return offlineWorkspace?.allows(url) == true || (url.scheme == endpoint.scheme && url.host == endpoint.host && url.port == endpoint.port)
    }
    private func publishUpdater() {
        guard let url = webView?.url, trustedWorkspace(url),
              let data = try? JSONSerialization.data(withJSONObject: updater.snapshot),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.signalstudioClient = \(json); window.dispatchEvent(new Event('signalstudio-client-update'));")
    }
    @objc private func checkUpdates() { updater.check() }
    @objc private func updateSettings() {
        let enabled = updater.snapshot["automatic"] as? Bool == true
        let alert = NSAlert()
        alert.messageText = "自动更新"
        alert.informativeText = enabled ? "已开启：后台下载并校验，正常退出时安装。不会为更新强制退出正在编辑的工作台。" : "已关闭：可通过“检查更新…”手动获取新版并自动安装。"
        alert.addButton(withTitle: enabled ? "关闭自动更新" : "开启自动更新")
        alert.addButton(withTitle: "保持当前设置")
        alert.beginSheetModal(for: window) { response in
            if response == .alertFirstButtonReturn { self.updater.toggleAutomatic() }
        }
    }
    // Ask the current editor at termination time, rather than trusting an old dirty flag.
    private func approveQuit(_ reply: @escaping (Bool) -> Void) {
        guard loaded else { reply(true); return }
        QuitProtection.check(evaluate: { callback in
            guard let url = self.webView.url, self.trustedWorkspace(url) else { callback(nil, nil); return }
            self.webView.evaluateJavaScript(QuitProtection.query, completionHandler: callback)
        }) { state, hint in
            if state == .safe { reply(true); return }
            let alert = NSAlert()
            switch state {
            case .draft:
                alert.messageText = "工作台有未保存的编辑"
                alert.informativeText = hint.isEmpty ? "返回后请在当前编辑区域点击保存；新节点需点击“创建节点”，提议需确认应用。也可以放弃未保存内容并退出。" : hint
                alert.addButton(withTitle: "返回并定位编辑")
                alert.addButton(withTitle: "放弃草稿并退出")
            case .busy:
                alert.messageText = "工作台正在处理操作"
                alert.informativeText = "正在拖动、保存或等待操作完成。请先结束拖动并等待结果，再重新检查；此时不需要另找保存按钮。"
                alert.addButton(withTitle: "返回工作台")
                alert.addButton(withTitle: "重新检查")
            default:
                alert.messageText = "无法确认工作台保存状态"
                alert.informativeText = "当前页面没有响应或不支持状态检查，这不代表存在未保存编辑。可返回检查或重新检查；仍要退出时，未保存内容可能丢失，已保存到主机的数据不会被删除。"
                alert.addButton(withTitle: "返回工作台")
                alert.addButton(withTitle: "重新检查")
                alert.addButton(withTitle: "仍然退出…")
            }
            alert.beginSheetModal(for: self.window) { response in
                if state == .draft {
                    if response == .alertSecondButtonReturn { self.confirmDiscard(reply); return }
                    if let url = self.webView.url, self.trustedWorkspace(url) {
                        self.webView.evaluateJavaScript("window.dispatchEvent(new Event('signalstudio-reveal-draft'));")
                    }
                } else if response == .alertSecondButtonReturn {
                    // The sheet must close before presenting the next one.
                    DispatchQueue.main.async { self.approveQuit(reply) }; return
                } else if response == .alertThirdButtonReturn {
                    self.confirmUnknownQuit(reply); return
                }
                reply(false)
            }
        }
    }
    private func confirmDiscard(_ reply: @escaping (Bool) -> Void) {
        // Re-read: a write may have started while the user considered the sheet.
        DispatchQueue.main.async {
            QuitProtection.check(evaluate: { callback in
                guard let url = self.webView.url, self.trustedWorkspace(url) else { callback(nil, nil); return }
                self.webView.evaluateJavaScript(QuitProtection.query, completionHandler: callback)
            }) { state, _ in
                if state == .safe || state == .draft { reply(true) }
                else { self.approveQuit(reply) }
            }
        }
    }
    private func confirmUnknownQuit(_ reply: @escaping (Bool) -> Void) {
        DispatchQueue.main.async {
            // If the page recovered, honor its current draft/write protection.
            QuitProtection.check(evaluate: { callback in
                guard let url = self.webView.url, self.trustedWorkspace(url) else { callback(nil, nil); return }
                self.webView.evaluateJavaScript(QuitProtection.query, completionHandler: callback)
            }) { state, _ in
                guard state == .unknown else { self.approveQuit(reply); return }
                let alert = NSAlert()
                alert.messageText = "退出并承担未保存内容丢失的风险？"
                alert.informativeText = "无法验证当前页面。退出可能丢失尚未保存的编辑；已保存在主机上的数据会保留。"
                alert.addButton(withTitle: "返回工作台")
                alert.addButton(withTitle: "退出，可能丢失未保存内容")
                alert.beginSheetModal(for: self.window) { response in reply(response == .alertSecondButtonReturn) }
            }
        }
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil); return false
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if allowQuit { return .terminateNow }
        if checkingQuit { return .terminateCancel }
        checkingQuit = true
        // Evaluate after returning .terminateLater, even for an unloaded window.
        DispatchQueue.main.async {
            self.approveQuit { approved in
                self.checkingQuit = false; self.allowQuit = approved
                sender.reply(toApplicationShouldTerminate: approved)
            }
        }
        return .terminateLater
    }
    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        status.isHidden = true; retry.isHidden = true; webView.isHidden = false
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { loaded = true; publishUpdater() }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        if let offline = offlineWorkspace, webView.url?.scheme != "signalstudio" { offline.load(in: webView); return }
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
