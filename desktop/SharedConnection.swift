import Foundation

struct SharedConnection: Codable, Equatable {
    let baseURL: String
    let projectRoot: String

    static func address(_ input: String) throws -> URL {
        guard let parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["http", "https"].contains(parts.scheme?.lowercased() ?? ""),
              let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil,
              parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/",
              parts.port == nil || (1...65535).contains(parts.port!),
              let url = parts.url else {
            throw ConnectionError.invalidAddress
        }
        return url
    }

    // This verifies the selected workspace, not the network user's identity.
    static func validate(_ data: Data, status: Int, expectedRoot: String?) throws -> SharedConnection {
        guard status == 200,
              let health = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              health["app"] as? String == "SignalStudio",
              health["mode"] as? String == "development",
              let root = health["project_root"] as? String, root.hasPrefix("/"), root != "/",
              health["database_path"] as? String == root + "/data/logic.db",
              expectedRoot == nil || expectedRoot == root else {
            throw ConnectionError.identityMismatch
        }
        guard health["client_ready"] as? Bool == true, health["status"] as? String == "ready" else {
            throw ConnectionError.notReady
        }
        return SharedConnection(baseURL: "", projectRoot: root)
    }

    static func check(_ address: URL, expectedRoot: String?, completion: @escaping (Result<SharedConnection, Error>) -> Void) {
        var request = URLRequest(url: address.appendingPathComponent("__signalstudio_health"),
                                 cachePolicy: .reloadIgnoringLocalCacheData)
        request.timeoutInterval = 8
        // Do not follow an endpoint to a different origin via HTTP redirects.
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
        session.dataTask(with: request) { data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if let error = error { completion(.failure(error)); return }
            do {
                let checked = try validate(data ?? Data(), status: (response as? HTTPURLResponse)?.statusCode ?? 0,
                                           expectedRoot: expectedRoot)
                completion(.success(SharedConnection(baseURL: address.absoluteString, projectRoot: checked.projectRoot)))
            } catch { completion(.failure(error)) }
        }.resume()
    }

    static var file: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/SignalStudio/shared-client.json")
    }

    static func load(from url: URL = file) throws -> SharedConnection {
        let connection = try JSONDecoder().decode(SharedConnection.self, from: Data(contentsOf: url))
        _ = try address(connection.baseURL)
        guard connection.projectRoot.hasPrefix("/"), connection.projectRoot != "/" else { throw ConnectionError.identityMismatch }
        return connection
    }

    func save(to url: URL = file) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(self).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }
}

private final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

enum ConnectionError: LocalizedError {
    case invalidAddress, identityMismatch, notReady
    var errorDescription: String? {
        switch self {
        case .invalidAddress: return "请输入完整的 http:// 或 https:// 工作台地址，仅包含主机和端口。"
        case .identityMismatch: return "服务不是所选 SignalStudio 工作台，或项目、数据库身份发生了变化。请核对地址与主机配置。"
        case .notReady: return "Mac mini 工作台尚未就绪，请稍后重新连接。"
        }
    }
}
