// Compiled only into isolated test bundles, never distributed.
import Cocoa
import Sparkle

final class UpdateTest: NSObject, NSApplicationDelegate {
    let updater = ClientUpdater()
    var cancelled = false
    var window: NSWindow!
    let root = URL(fileURLWithPath: Bundle.main.object(forInfoDictionaryKey: "TestResultDirectory") as! String)
    func log(_ value: String) { try! Data(value.utf8).write(to: root.appendingPathComponent(value.components(separatedBy: ":")[0]), options: .atomic) }
    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 300, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        if Bundle.main.object(forInfoDictionaryKey: "TestUpdated") as? Bool == true {
            log("relaunched"); NSApp.terminate(nil); return
        }
        updater.changed = { [self] in
            let phase = updater.snapshot["phase"] as! String
            log("phase:" + phase)
            if phase == "error" { log("failure:" + String(describing: updater.snapshot)); NSApp.terminate(nil) }
            if phase == "ready" {
                log("ready")
                if Bundle.main.object(forInfoDictionaryKey: "TestRestart") as? Bool == true { updater.check() }
                else { NSApp.terminate(nil) }
            }
        }
        updater.start()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.updater.testBackgroundCheck() }
        DispatchQueue.main.asyncAfter(deadline: .now() + 45) { self.log("timeout"); exit(1) }
    }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if Bundle.main.object(forInfoDictionaryKey: "TestUpdated") as? Bool == true { return .terminateNow }
        if updater.snapshot["phase"] as? String == "error" { return .terminateNow }
        if !cancelled {
            cancelled = true; log("cancelled")
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                if Bundle.main.object(forInfoDictionaryKey: "TestRestart") as? Bool == true { self.updater.check() }
                else { sender.terminate(nil) }
            }
            return .terminateCancel
        }
        log("terminating"); return .terminateNow
    }
}
@main struct UpdateTestMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = UpdateTest()
        app.delegate = delegate
        app.setActivationPolicy(.accessory)
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
