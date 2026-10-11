import Cocoa
import WebKit
import Sparkle

// Sparkle owns verification and installation. This adapter exposes a narrow, trusted UI bridge.
final class ClientUpdater: NSObject, SPUUpdaterDelegate, WKScriptMessageHandlerWithReply {
    private var controller: SPUStandardUpdaterController!
    private var installReady: (() -> Void)?
    private var phase = "unchecked"
    private var detail = ""
    private var available: String?
    private var checkedAt: String?
    var changed: (() -> Void)?
    var allows: ((URL) -> Bool)?

    override init() {
        super.init()
        controller = SPUStandardUpdaterController(startingUpdater: false, updaterDelegate: self, userDriverDelegate: nil)
    }
    func start() { controller.startUpdater() }
    #if UPDATER_TESTING
    func testBackgroundCheck() { controller.updater.checkForUpdatesInBackground() }
    #endif
    func check() {
        if let install = installReady { install(); return }
        guard controller.updater.canCheckForUpdates else { return }
        phase = "checking"; checkedAt = ISO8601DateFormatter().string(from: Date()); detail = ""; changed?()
        controller.checkForUpdates(nil)
    }
    func toggleAutomatic() {
        setAutomatic(!controller.updater.automaticallyChecksForUpdates)
    }
    private func setAutomatic(_ enabled: Bool) {
        controller.updater.automaticallyChecksForUpdates = enabled
        controller.updater.automaticallyDownloadsUpdates = enabled
        changed?()
    }
    var snapshot: [String: Any] {
        ["version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown",
         "revision": Bundle.main.object(forInfoDictionaryKey: "SignalStudioRevision") as? String ?? "",
         "channel": "shared-preview", "phase": phase, "detail": detail,
         "availableVersion": available as Any? ?? NSNull(), "checkedAt": checkedAt as Any? ?? NSNull(),
         "automatic": controller.updater.automaticallyChecksForUpdates,
         "canCheck": controller.updater.canCheckForUpdates || installReady != nil]
    }
    func configure(_ configuration: WKWebViewConfiguration) {
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "clientUpdater")
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url,
              allows?(url) == true, let body = message.body as? [String: Any],
              let action = body["action"] as? String else { replyHandler(nil, "Untrusted updater request"); return }
        switch action {
        case "status": break
        case "check": check()
        case "automatic":
            guard let enabled = body["enabled"] as? Bool else { replyHandler(nil, "Expected boolean"); return }
            setAutomatic(enabled)
        default: replyHandler(nil, "Unsupported updater action"); return
        }
        replyHandler(snapshot, nil)
    }
    func updater(_ updater: SPUUpdater, didFinishLoading appcast: SUAppcast) {
        checkedAt = ISO8601DateFormatter().string(from: Date()); changed?()
    }
    func updater(_ updater: SPUUpdater, didFinishUpdateCycleFor updateCheck: SPUUpdateCheck, error: Error?) {
        DispatchQueue.main.async { self.changed?() }
    }
    func updater(_ updater: SPUUpdater, didFindValidUpdate item: SUAppcastItem) {
        available = item.displayVersionString; phase = "available"; detail = ""; changed?()
    }
    func updaterDidNotFindUpdate(_ updater: SPUUpdater, error: Error) {
        phase = "no-update"; detail = error.localizedDescription
        checkedAt = ISO8601DateFormatter().string(from: Date()); changed?()
    }
    func updater(_ updater: SPUUpdater, willDownloadUpdate item: SUAppcastItem, with request: NSMutableURLRequest) {
        phase = "downloading"; changed?()
    }
    func updater(_ updater: SPUUpdater, willExtractUpdate item: SUAppcastItem) {
        phase = "verifying"; changed?()
    }
    func updater(_ updater: SPUUpdater, willInstallUpdateOnQuit item: SUAppcastItem,
                 immediateInstallationBlock immediateInstallHandler: @escaping () -> Void) -> Bool {
        installReady = immediateInstallHandler; phase = "ready"; changed?()
        // Wait for normal quit or an explicit install request. Never force termination on a timer.
        return true
    }
    func updater(_ updater: SPUUpdater, didAbortWithError error: Error) {
        if (error as NSError).code == SUError.noUpdateError.rawValue { return }
        phase = "error"; detail = error.localizedDescription; installReady = nil; changed?()
    }
}
