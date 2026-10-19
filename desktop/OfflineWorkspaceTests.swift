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
            JSON.stringify({text:document.body.innerText, nodes:document.querySelectorAll('.react-flow__node').length, tiles:document.querySelectorAll('.feature-tile').length,
             storage:window.signalstudioStorage ? 1 : 0})
            """
            view.evaluateJavaScript(expression) { value, error in
                let text = value as? String ?? ""
                let expected = args[4] == "online" ? "已连接主机" : (args[4] == "empty" ? "尚无可用快照" : "正在显示本地只读快照")
                let parsed = text.data(using: .utf8).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
                if text.contains(expected) && (args[4] == "empty" ? (parsed?["nodes"] as? Int ?? -1) == 0 : ((parsed?["nodes"] as? Int ?? 0) > 0 || (parsed?["tiles"] as? Int ?? 0) > 0)) && !finishing {
                    print("native shell \(args[4]): nodes=\(parsed?["nodes"] ?? 0), snapshots=\(parsed?["storage"] ?? 0)"); passed = true; finishing = true;
                    if args[4] == "online" {
                        let check = """
                        const version = document.querySelector('.workspace-version');
                        if (!version || !version.innerText.includes('界面版本')) throw Error('Missing UI version');
                        const href = version.querySelector('a').href;
                        if (!/github.com\\/lkyxuan\\/SignalStudio\\/commit\\/[a-f0-9]{40}$/.test(href)) throw Error('Invalid commit link');
                        [...document.querySelectorAll('.view-toolbar .view-switch button')].find(button => button.textContent.trim() === '表格').click();
                        await new Promise(resolve => setTimeout(resolve, 200));
                        document.querySelector('tbody tr').click();
                        await new Promise(resolve => setTimeout(resolve, 1200));
                        if (!document.querySelector('.inspector-title') || document.querySelector('.inspector [role=status]')) throw Error('On-demand details did not hydrate');
                        const inspector = document.querySelector('.inspector');
                        const picker = document.createElement('select');
                        picker.innerHTML = '<option>a</option><option>b</option>';
                        inspector.append(picker); picker.value = 'b';
                        picker.dispatchEvent(new Event('change', {bubbles:true}));
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if (window.signalstudioQuitState() !== 'safe') throw Error('Read-only picker marked dirty');
                        picker.remove();
                        document.querySelector('.inspector-head button').click();
                        const original = window.fetch;
                        window.fetch = async (input, options) => {
                          if (String(input).includes('/api/desktop-health')) {
                            await new Promise(resolve => setTimeout(resolve, 700));
                            throw new DOMException('test timeout', 'TimeoutError');
                          }
                          return original(input, options);
                        };
                        window.dispatchEvent(new Event('offline'));
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const button = document.querySelector('.live-update-banner button');
                        if (!button) throw Error('Missing retry button');
                        button.click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if (!button.disabled || !button.innerText.includes('重新连接中')) throw Error('No running feedback');
                        if (!button.querySelector('.connection-spinner')) throw Error('Missing spinner');
                        button.click();
                        await new Promise(resolve => setTimeout(resolve, 900));
                        if (button.disabled || !document.body.innerText.includes('连接请求超时')) throw Error('No timeout result');
                        if (version.querySelector('a').href !== href) throw Error('UI version changed after a request');
                        window.fetch = original;
                        button.click();
                        await new Promise(resolve => setTimeout(resolve, 1800));
                        if (!document.body.innerText.includes('已连接主机')) throw Error('Recovery not confirmed');
                        if (window.signalstudioCanQuit() !== true) throw Error('Clean editor cannot quit');
                        document.querySelector('.top-actions .button-primary').click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if (window.signalstudioCanQuit() !== false) throw Error('Open draft did not block quit');
                        const input = document.querySelector('.modal input');
                        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
                        setter.call(input, 'SS-59 unsaved draft');
                        input.dispatchEvent(new Event('input', {bubbles: true}));
                        input.dispatchEvent(new Event('change', {bubbles: true}));
                        version.querySelector('button').click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        const panel = document.querySelector('[role=dialog]');
                        if (!panel || !panel.innerText.includes('Mac 客户端')) throw Error('Missing update panel');
                        if (window.signalstudioCanQuit() !== false || input.value !== 'SS-59 unsaved draft') throw Error('Check updates discarded draft');
                        panel.querySelector('.modal-header button').click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if (input.value !== 'SS-59 unsaved draft') throw Error('Closing update panel discarded draft');
                        document.querySelector('.modal-header button').click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if (window.signalstudioQuitState() !== 'safe') throw Error('Cancelled modal left phantom edits');
                        document.querySelector('.top-actions .button-primary').click();
                        await new Promise(resolve => setTimeout(resolve, 100));
                        document.querySelector('.modal-footer .button-primary').click();
                        const until = async predicate => {
                          for(let i=0;i<50;i++) { if(predicate()) return; await new Promise(r=>setTimeout(r,100)); }
                          throw Error('Quit UI test did not settle: '+document.body.innerText.slice(-1800));
                        };
                        await until(() => !document.querySelector('.modal-backdrop') && document.querySelector('.inspector textarea[data-workspace-editor]'));
                        const editor = document.querySelector('.inspector textarea[data-workspace-editor]');
                        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(editor, 'SS125 persisted definition');
                        editor.dispatchEvent(new Event('input',{bubbles:true}));
                        editor.dispatchEvent(new Event('change',{bubbles:true}));
                        await new Promise(resolve => setTimeout(resolve, 100));
                        if(window.signalstudioQuitState() !== 'draft') throw Error('Real edit not protected');
                        const settings = editor.closest('details'); settings.open = false;
                        window.dispatchEvent(new Event('signalstudio-reveal-draft'));
                        if(!settings.open || document.activeElement !== editor) throw Error('Draft was not revealed');
                        document.querySelector('.inspector-footer .button-primary').click();
                        await until(() => window.signalstudioQuitState() === 'safe');
                        const graph = await (await fetch('/api/graph')).json();
                        const saved = graph.nodes.find(node => node.name === 'SS-59 unsaved draft');
                        if(saved?.decision_question !== 'SS125 persisted definition') throw Error('Saved purpose missing from backend');
                        document.querySelector('.inspector-head button').click();
                        await new Promise(resolve => setTimeout(resolve,100));
                        [...document.querySelectorAll('tbody tr')].find(row => row.innerText.includes('SS-59 unsaved draft')).click();
                        await until(() => document.querySelector('.inspector textarea[data-workspace-editor]')?.value === 'SS125 persisted definition');
                        if(window.signalstudioQuitState() !== 'safe') throw Error('Reopened saved editor blocked quit');
                        return 'read-only selection, modal cancel, dirty edit, reveal, save and reopen quit checks passed';
                        """
                        view.callAsyncJavaScript(check, arguments: [:], in: nil, in: .page) { result in
                            switch result {
                            case .success(let value): print(value); DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(0) }
                            case .failure(let error): fputs("UI feedback check failed: \(error)\n", stderr); exit(1)
                            }
                        }
                    } else {
                        if !text.contains("界面版本") { fputs("Missing fallback UI version\n", stderr); exit(1) }
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { exit(0) }
                    }
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
