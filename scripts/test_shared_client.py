"""Exercise the actual distributed Swift binary against isolated HTTP services."""
import http.server
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parent.parent


class SharedClientTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='signalstudio-shared-test-')
        cls.directory = Path(cls.temporary.name)
        supplied = os.environ.get('SIGNALSTUDIO_TEST_APP')
        cls.app = Path(supplied) if supplied else cls.directory / 'SignalStudio.app'
        if not supplied:
            subprocess.run(['python3', str(ROOT / 'scripts/build_macos_app.py'), str(cls.app), '--release'], check=True)
        cls.binary = cls.app / 'Contents/MacOS/SignalStudio'

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def setUp(self):
        self.health = dict(app='SignalStudio', mode='development', project_root='/shared/workspace',
                           database_path='/shared/workspace/data/logic.db', client_ready=True, status='ready')
        self.status = 200
        self.redirect = False
        self.requests = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                owner.requests.append(self.path)
                self.send_response(302 if owner.redirect else owner.status)
                if owner.redirect:
                    self.send_header('Location', '/redirected')
                self.end_headers()
                self.wfile.write(json.dumps(owner.health).encode())

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.address = f'http://127.0.0.1:{self.server.server_port}'

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def check(self, expected='/shared/workspace', address=None):
        # No Node/Python executable, source cwd, or local service is available to this process.
        return subprocess.run([str(self.binary), '--check-connection', address or self.address,
                               '--expected-root', expected], cwd=self.directory,
                              env={'PATH': '/usr/bin:/bin', 'HOME': str(self.directory)},
                              text=True, capture_output=True, timeout=15)

    def test_portable_binary_and_reconnection(self):
        self.assertEqual(self.check().returncode, 0)
        self.health['client_ready'] = False
        self.assertNotEqual(self.check().returncode, 0)
        self.health['client_ready'] = True
        self.assertEqual(json.loads(self.check().stdout)['projectRoot'], '/shared/workspace')
        self.assertTrue(all(path == '/__signalstudio_health' for path in self.requests))

    def test_wrong_service_and_workspace(self):
        for key, value in [('app', 'OtherApp'), ('database_path', '/other.db'), ('mode', 'other'), ('status', 'error')]:
            with self.subTest(key=key):
                original = self.health[key]
                self.health[key] = value
                self.assertNotEqual(self.check().returncode, 0)
                self.health[key] = original
        self.assertNotEqual(self.check(expected='/different/workspace').returncode, 0)

    def test_failed_http_and_redirect(self):
        self.status = 500
        self.assertNotEqual(self.check().returncode, 0)
        self.status = 200
        self.redirect = True
        self.assertNotEqual(self.check().returncode, 0)
        self.assertNotIn('/redirected', self.requests)

    def test_disconnected_then_recovered(self):
        self.assertNotEqual(self.check(address='http://127.0.0.1:1').returncode, 0)
        self.assertEqual(self.check().returncode, 0)

    def test_settings_and_address_validation(self):
        binary = self.directory / 'connection-tests'
        subprocess.run(['xcrun', 'swiftc', str(ROOT / 'desktop/SharedConnection.swift'),
                        str(ROOT / 'desktop/SharedConnectionTests.swift'), '-o', str(binary)], check=True)
        subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    unittest.main()
