import http.server
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from scripts.sparkle import ROOT, distribution


class ClientBridgeTests(unittest.TestCase):
    def test_trusted_main_frame_only(self):
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200); self.send_header('Content-Type', 'text/html'); self.end_headers()
                self.wfile.write(b'<html><body>Isolated updater bridge test</body></html>')
            def log_message(self, *_): pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        try:
            tools = distribution()
            with tempfile.TemporaryDirectory(prefix='ss59-bridge-') as directory:
                binary = Path(directory) / 'bridge-test'
                subprocess.run(['xcrun', 'swiftc', str(ROOT / 'desktop/ClientUpdater.swift'),
                    str(ROOT / 'desktop/ClientBridgeTests.swift'), '-F', str(tools), '-framework', 'Sparkle',
                    '-framework', 'Cocoa', '-framework', 'WebKit', '-Xlinker', '-rpath', '-Xlinker', str(tools),
                    '-o', str(binary)], check=True)
                subprocess.run([str(binary), f'http://127.0.0.1:{server.server_port}'], check=True, timeout=25)
        finally:
            server.shutdown(); server.server_close(); thread.join()


if __name__ == '__main__': unittest.main()
