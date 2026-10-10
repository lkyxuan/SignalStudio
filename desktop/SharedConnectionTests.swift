import Foundation

@main struct ConnectionTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("settings.json")
        let connection = SharedConnection(baseURL: "http://100.64.0.1:15173", projectRoot: "/shared/workspace")
        try connection.save(to: file)
        let first = try SharedConnection.load(from: file)
        assert(first == connection)
        let attributes = try FileManager.default.attributesOfItem(atPath: file.path)
        assert(attributes[.posixPermissions] as? Int == 0o600)
        // Replacing the App does not replace user settings; updating settings is atomic.
        let changed = SharedConnection(baseURL: "https://example.ts.net:443", projectRoot: "/shared/new")
        try changed.save(to: file)
        let second = try SharedConnection.load(from: file)
        assert(second == changed)
        try Data("invalid".utf8).write(to: file)
        do { _ = try SharedConnection.load(from: file); fatalError("Corrupt settings accepted") } catch {}
        for invalid in ["example.ts.net", "file:///tmp/data", "http://user:secret@host:15173",
                        "http://host:15173/api", "http://host/?secret=value", "http://host/#fragment", "http://host:0"] {
            do { _ = try SharedConnection.address(invalid); fatalError("Invalid address accepted: \(invalid)") } catch {}
        }
        let address = try SharedConnection.address("  http://100.64.0.1:15173/ \n")
        assert(address.host == "100.64.0.1")
        print("Connection settings persistence, replacement, permissions, corruption and address validation passed")
    }
}
