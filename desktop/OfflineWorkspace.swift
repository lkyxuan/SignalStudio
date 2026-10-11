import Cocoa
import WebKit
import CryptoKit

// A bundled, versioned UI with a narrow remote API bridge. No local API or SQLite.
// Its origin includes the selected endpoint and workspace, isolating persistent storage.
final class OfflineWorkspace: NSObject, WKURLSchemeHandler, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate {
    private let endpoint: URL
    private let root: String
    private let shell: URL
    private var storage: [String: String] = [:]
    private let storageFile: URL
    private let storageQueue = DispatchQueue(label: "SignalStudio.snapshot-storage")
    let host: String
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    init(endpoint: URL, root: String, shell: URL) {
        self.endpoint = endpoint; self.root = root; self.shell = shell
        self.host = SHA256.hash(data: Data((endpoint.absoluteString + "\n" + root).utf8)).map { String(format: "%02x", $0) }.joined()
        self.storageFile = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/SignalStudio/workspace-snapshots/" + self.host + ".json")
        if let data = try? Data(contentsOf: storageFile), data.count < 10_000_000,
           let saved = try? JSONDecoder().decode([String: String].self, from: data) { storage = saved }
    }
    func configure(_ configuration: WKWebViewConfiguration) throws {
        let revision = (try? String(contentsOf: shell.appendingPathComponent("revision.txt"), encoding: .utf8))?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "unknown"
        let context: [String: Any] = ["endpoint": endpoint.absoluteString,
            "workspace": ["project_root": root, "database_path": root + "/data/logic.db"], "codeRevision": revision, "appRevision": revision]
        let json = String(data: try JSONSerialization.data(withJSONObject: context), encoding: .utf8)!
        configuration.setURLSchemeHandler(self, forURLScheme: "signalstudio")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "workspaceHTTP")
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "workspaceStorage")
        let saved = String(data: try JSONEncoder().encode(storage), encoding: .utf8)!
        let script = """
        window.signalstudioWorkspace = \(json);
        if (location.protocol !== 'signalstudio:') window.signalstudioWorkspace.codeRevision = null;
        (() => {
          const saved = \(saved);
          window.signalstudioStorage = {
            getItem: key => saved[key] ?? null,
            setItem: (key, value) => {
              saved[key] = value;
              window.webkit.messageHandlers.workspaceStorage.postMessage({key, value}).catch(() => window.dispatchEvent(new Event('signalstudio-storage-error')));
            },
            removeItem: key => { delete saved[key]; }
          };
        })();
        (() => {
          const original = window.fetch.bind(window);
          window.fetch = async (input, options = {}) => {
            const raw = typeof input === 'string' ? input : input.url;
            const url = new URL(raw, location.href);
            if (url.protocol !== 'signalstudio:' || url.host !== location.host) return original(input, options);
            const path = url.pathname + url.search;
            if (!path.startsWith('/api/') && !['/__signalstudio_health', '/__signalstudio_updater'].includes(path)) return original(input, options);
            const signal = options.signal;
            if (signal?.aborted) throw signal.reason;
            const response = window.webkit.messageHandlers.workspaceHTTP.postMessage({
              path, method: options.method || 'GET', headers: Object.fromEntries(new Headers(options.headers)), body: options.body || null
            }).then(result => new Response(result.status === 304 ? null : result.body, { status: result.status, headers: result.headers }));
            if (!signal) return response;
            return new Promise((resolve, reject) => {
              const abort = () => reject(signal.reason);
              signal.addEventListener('abort', abort, { once: true });
              response.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
            });
          };
        })();
        """
        configuration.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    func load(in webView: WKWebView) { webView.load(URLRequest(url: URL(string: "signalstudio://\(host)/index.html")!)) }

    // Online launches keep the server-delivered UI and its normal refresh behavior.
    // Only a network/unready failure chooses the bundled read-only-capable shell.
    func open(in webView: WKWebView, failure: @escaping (String) -> Void) {
        var request = URLRequest(url: endpoint.appendingPathComponent("api/desktop-health"), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
        request.setValue(String(data: try! JSONSerialization.data(withJSONObject: ["project_root": root, "database_path": root + "/data/logic.db"]), encoding: .utf8), forHTTPHeaderField: "X-Workspace-Identity")
        session.dataTask(with: request) { data, response, error in
            DispatchQueue.main.async {
                if error != nil || response == nil { self.load(in: webView); return }
                guard let response = response as? HTTPURLResponse else { failure("工作台响应无效"); return }
                // Proxy failures from an unavailable backend are recoverable offline starts.
                if [502, 503, 504].contains(response.statusCode) { self.load(in: webView); return }
                let health = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                guard response.statusCode == 200, health?["app"] as? String == "SignalStudio",
                      health?["project_root"] as? String == self.root,
                      health?["database_path"] as? String == self.root + "/data/logic.db",
                      health?["mode"] as? String == "development" else { failure("工作台身份不匹配，请核对地址后重试。"); return }
                if health?["client_ready"] as? Bool == true {
                    webView.load(URLRequest(url: self.endpoint, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 8))
                    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak webView] in
                        guard let webView = webView, webView.url?.scheme != "signalstudio" else { return }
                        webView.evaluateJavaScript("!!document.querySelector('.app-shell')") { started, _ in
                            // No application UI means there can be no editor draft to discard.
                            if started as? Bool != true { self.load(in: webView) }
                        }
                    }
                }
                else { self.load(in: webView) }
            }
        }.resume()
    }

    func allows(_ url: URL) -> Bool {
        (url.scheme == "signalstudio" && url.host == host) ||
        (url.scheme == endpoint.scheme && url.host == endpoint.host && url.port == endpoint.port)
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url, url.host == host else {
            urlSchemeTask.didFailWithError(NSError(domain: "SignalStudioShell", code: 403)); return
        }
        let file = shell.appendingPathComponent(url.path).standardizedFileURL
        guard file.path.hasPrefix(shell.standardizedFileURL.path + "/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(NSError(domain: "SignalStudioShell", code: 404)); return
        }
        let mime = ["html": "text/html", "js": "text/javascript", "css": "text/css", "svg": "image/svg+xml", "png": "image/png"][file.pathExtension] ?? "application/octet-stream"
        urlSchemeTask.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count, textEncodingName: "utf-8"))
        urlSchemeTask.didReceive(data); urlSchemeTask.didFinish()
    }
    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let frame = message.frameInfo.request.url, allows(frame),
              let value = message.body as? [String: Any] else { replyHandler(nil, "Invalid workspace frame"); return }
        if message.name == "workspaceStorage" {
            guard let key = value["key"] as? String, key.hasPrefix("signalstudio:"), key.count < 4096,
                  let text = value["value"] as? String, text.utf8.count < 5_000_000 else { replyHandler(nil, "Invalid snapshot"); return }
            storage[key] = text
            guard let encoded = try? JSONEncoder().encode(storage), encoded.count < 10_000_000 else { replyHandler(nil, "Snapshot quota exceeded"); return }
            storageQueue.async {
                do {
                    try FileManager.default.createDirectory(at: self.storageFile.deletingLastPathComponent(), withIntermediateDirectories: true,
                        attributes: [.posixPermissions: 0o700])
                    try encoded.write(to: self.storageFile, options: .atomic)
                    try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: self.storageFile.path)
                    replyHandler(true, nil)
                } catch { replyHandler(nil, error.localizedDescription) }
            }
            return
        }
        guard frame.scheme == "signalstudio", let path = value["path"] as? String,
              (path.hasPrefix("/api/") || (path == "/__signalstudio_health" || path == "/__signalstudio_updater")),
              let url = URL(string: path, relativeTo: endpoint)?.absoluteURL,
              url.scheme == endpoint.scheme, url.host == endpoint.host, url.port == endpoint.port,
              let method = value["method"] as? String, ["GET", "POST", "PATCH", "PUT", "DELETE"].contains(method) else {
            replyHandler(nil, "Invalid workspace request"); return
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = method
        if let headers = value["headers"] as? [String: String] {
            for (name, value) in headers where ["content-type", "if-match", "if-none-match", "x-card-model", "x-workspace-identity", "x-graph-transport", "x-graph-base"].contains(name.lowercased()) {
                request.setValue(value, forHTTPHeaderField: name)
            }
        }
        // Pin every API operation, including reads, to the configured workspace.
        let identity = ["project_root": root, "database_path": root + "/data/logic.db"]
        request.setValue(String(data: try! JSONSerialization.data(withJSONObject: identity), encoding: .utf8), forHTTPHeaderField: "X-Workspace-Identity")
        if let body = value["body"] as? String { request.httpBody = Data(body.utf8) }
        session.dataTask(with: request) { data, response, error in
            if let error = error { replyHandler(nil, error.localizedDescription); return }
            guard let response = response as? HTTPURLResponse else { replyHandler(nil, "No HTTP response"); return }
            // URLSession has already decoded gzip; don't pass encoded length/encoding to JS.
            var headers: [String: String] = [:]
            for name in ["Content-Type", "ETag"] { if let value = response.value(forHTTPHeaderField: name) { headers[name] = value } }
            replyHandler(["status": response.statusCode, "headers": headers, "body": String(data: data ?? Data(), encoding: .utf8) ?? ""], nil)
        }.resume()
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
