import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSTextField!
    private var retry: NSButton!
    private var projectAccess: URL?
    private var accessGeneration = 0
    private var server: Process?
    private var log: FileHandle?
    private var quitting = false
    private var loaded = false
    private var attempts = 0
    private var root = ""
    private var python = ""
    private var development = false
    private var node = ""
    private var baseURL: URL { URL(string: development ? "http://127.0.0.1:15173" : "http://127.0.0.1:18787")! }
    private var healthURL: URL { development ? URL(string: "http://127.0.0.1:18789/health")! : baseURL.appendingPathComponent("api/desktop-health") }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Set the running Dock icon as well as the bundle's Finder icon.
        if let iconURL = Bundle.main.url(forResource: "SignalStudio", withExtension: "icns"),
           let icon = NSImage(contentsOf: iconURL) {
            NSApp.applicationIconImage = icon
        }
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出 SignalStudio", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = NSMenuItem()
        editItem.title = "编辑"
        menu.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = editMenu
        NSApp.mainMenu = menu

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "SignalStudio"
        window.minSize = NSSize(width: 900, height: 600)
        window.isReleasedWhenClosed = false
        window.center()
        webView = WKWebView(frame: window.contentView!.bounds)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.isHidden = true
        window.contentView!.addSubview(webView)
        status = NSTextField(labelWithString: "正在启动 SignalStudio…")
        status.frame = NSRect(x: 30, y: 40, width: 1100, height: 80)
        status.autoresizingMask = [.width, .maxYMargin]
        status.font = NSFont.systemFont(ofSize: 18)
        status.maximumNumberOfLines = 3
        window.contentView!.addSubview(status)
        retry = NSButton(title: "重新选择项目文件夹", target: self, action: #selector(selectProject))
        retry.frame = NSRect(x: 30, y: 20, width: 210, height: 30)
        retry.autoresizingMask = [.maxYMargin]
        retry.isHidden = true
        window.contentView!.addSubview(retry)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        guard let configURL = Bundle.main.url(forResource: "launch", withExtension: "json"),
              let data = try? Data(contentsOf: configURL),
              let config = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let project = config["project_root"], let executable = config["python"] else {
            fail("启动配置缺失，请在项目中重新运行 npm run desktop:build。")
            return
        }
        root = project
        python = executable
        development = config["mode"] == "development"
        node = config["node"] ?? ""
        window.title = development ? "SignalStudio Dev" : "SignalStudio"
        probe(initial: true)
    }

    private func prepareProjectAccess() {
        if let bookmark = UserDefaults.standard.data(forKey: "projectAccessBookmark") {
            var stale = false
            if let url = try? URL(resolvingBookmarkData: bookmark, options: [.withSecurityScope, .withoutUI],
                                  relativeTo: nil, bookmarkDataIsStale: &stale),
               url.standardizedFileURL.path == URL(fileURLWithPath: root).standardizedFileURL.path,
               !stale {
                _ = url.startAccessingSecurityScopedResource()
                projectAccess = url
                checkProject()
                return
            }
        }
        selectProject()
    }

    @objc private func selectProject() {
        guard !quitting, server?.isRunning != true else { return }
        accessGeneration += 1
        let panel = NSOpenPanel()
        panel.title = "允许 SignalStudio 访问项目"
        panel.message = "请选择 SignalStudio 项目文件夹，以读取现有工作台和数据库。"
        panel.prompt = "使用此项目"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = URL(fileURLWithPath: root)
        panel.beginSheetModal(for: window) { response in
            guard !self.quitting else { return }
            guard response == .OK, let url = panel.url else {
                self.fail("尚未选择项目文件夹。点击下方按钮后可重新选择。")
                return
            }
            guard url.standardizedFileURL.path == URL(fileURLWithPath: self.root).standardizedFileURL.path else {
                self.fail("请选择构建时的 SignalStudio 项目文件夹：\(self.root)")
                return
            }
            self.projectAccess?.stopAccessingSecurityScopedResource()
            _ = url.startAccessingSecurityScopedResource()
            self.projectAccess = url
            if let bookmark = try? url.bookmarkData(options: .withSecurityScope,
                                                    includingResourceValuesForKeys: nil, relativeTo: nil) {
                UserDefaults.standard.set(bookmark, forKey: "projectAccessBookmark")
            }
            self.checkProject()
        }
    }

    private func checkProject() {
        accessGeneration += 1
        let generation = accessGeneration
        let project = root
        status.stringValue = "正在检查项目访问权限…"
        retry.isHidden = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
            guard !self.quitting, self.accessGeneration == generation else { return }
            self.accessGeneration += 1
            self.fail("读取项目文件超时。请重新选择项目文件夹以恢复访问权限。")
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                _ = try Data(contentsOf: URL(fileURLWithPath: project + "/server/app.py"))
                let clientExists = FileManager.default.fileExists(atPath: project + (self.development ? "/node_modules/vite/bin/vite.js" : "/dist/index.html"))
                let databaseExists = FileManager.default.fileExists(atPath: project + "/data/logic.db")
                DispatchQueue.main.async {
                    guard !self.quitting, self.accessGeneration == generation else { return }
                    self.accessGeneration += 1
                    guard clientExists else {
                        self.fail("前端构建文件不存在，请重新运行 npm run desktop:build。")
                        return
                    }
                    guard databaseExists else {
                        self.fail("原工作台数据库不存在。请恢复项目的 data/logic.db 后重试。")
                        return
                    }
                    self.attempts = 0
                    self.startServer()
                }
            } catch {
                DispatchQueue.main.async {
                    guard !self.quitting, self.accessGeneration == generation else { return }
                    self.accessGeneration += 1
                    self.fail("无法读取项目文件。请确认项目位置，并允许 SignalStudio 访问项目所在文件夹，再重新打开 App。")
                }
            }
        }
    }

    // Only reuse a service that identifies this exact project and a built client.
    private func probe(initial: Bool) {
        var request = URLRequest(url: healthURL, cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                guard !self.quitting else { return }
                if let response = response as? HTTPURLResponse {
                    let health = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                    guard response.statusCode == 200,
                          health?["app"] as? String == "SignalStudio",
                          health?["project_root"] as? String == self.root,
                          health?["database_path"] as? String == self.root + "/data/logic.db",
                          (!self.development || health?["mode"] as? String == "development") else {
                        self.fail("启动端口被其他服务占用，或项目/数据库身份不匹配。请检查日志后重试。")
                        return
                    }
                    guard health?["client_ready"] as? Bool == true else {
                        self.attempts += 1
                        if self.attempts >= 120 || health?["status"] as? String == "error" {
                            self.fail("开发服务尚未就绪。请修复项目代码并重开 App；日志位于 ~/Library/Logs/SignalStudio/dev-server.log。")
                        } else {
                            self.status.stringValue = "正在等待前端与后台就绪…"
                            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.probe(initial: false) }
                        }
                        return
                    }
                    try? self.log?.write(contentsOf: Data("Loading UI: \(self.baseURL)\n".utf8))
                    self.status.stringValue = "正在加载工作台界面…"
                    self.webView.load(URLRequest(url: self.baseURL))
                    return
                }
                if initial {
                    self.prepareProjectAccess()
                } else {
                    self.attempts += 1
                    if self.attempts >= 60 || self.server?.isRunning != true {
                        self.fail(self.development ? "开发服务启动失败。请查看 ~/Library/Logs/SignalStudio/dev-server.log。" : "后台服务启动失败。请查看 ~/Library/Logs/SignalStudio/server.log。")
                    } else {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.probe(initial: false) }
                    }
                }
            }
        }.resume()
    }

    private func startServer() {
        status.stringValue = "正在启动后台服务…"
        do {
            let directory = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Logs/SignalStudio")
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let logURL = directory.appendingPathComponent(development ? "dev-server.log" : "server.log")
            if !FileManager.default.fileExists(atPath: logURL.path) {
                FileManager.default.createFile(atPath: logURL.path, contents: nil)
            }
            log = try FileHandle(forWritingTo: logURL)
            log?.seekToEndOfFile()
            let process = Process()
            process.executableURL = URL(fileURLWithPath: python)
            process.arguments = development
                ? [root + "/scripts/dev_runtime.py", "--node", node, "--parent-pid", String(ProcessInfo.processInfo.processIdentifier)]
                : [root + "/server/app.py"]
            process.currentDirectoryURL = URL(fileURLWithPath: root)
            var environment = ProcessInfo.processInfo.environment
            environment["PORT"] = "18787"
            environment["SIGNALSTUDIO_DB"] = root + "/data/logic.db"
            process.environment = environment
            process.standardOutput = log
            process.standardError = log
            process.terminationHandler = { _ in
                DispatchQueue.main.async {
                    if !self.quitting && self.loaded {
                        self.fail("后台服务已停止。请退出 App 后重新打开；日志位于 ~/Library/Logs/SignalStudio/server.log。")
                    }
                }
            }
            try process.run()
            server = process
            probe(initial: false)
        } catch {
            fail("无法启动后台服务：\(error.localizedDescription)")
        }
    }

    private func fail(_ message: String) {
        webView.isHidden = true
        status.isHidden = false
        status.stringValue = message
        retry.isHidden = root.isEmpty || server?.isRunning == true
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        // Remote font requests must not keep an otherwise usable page hidden.
        status.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded = true
        status.isHidden = true
        retry.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("界面加载失败：\(error.localizedDescription)。请退出 App 后重试。")
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        quitting = true
        if let process = server, process.isRunning {
            process.terminate()
            process.waitUntilExit()
        }
        try? log?.close()
        projectAccess?.stopAccessingSecurityScopedResource()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
