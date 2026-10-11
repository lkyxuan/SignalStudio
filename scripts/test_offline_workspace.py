"""Actual WKWebView startup and persistent-cache checks with an isolated backend."""
import os
import hashlib
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


class OfflineWorkspaceTest(unittest.TestCase):
    def test_native_ui_reopens_with_read_only_snapshot_after_server_stops(self):
        with tempfile.TemporaryDirectory(prefix='ss57-native-') as temporary:
            root = Path(temporary).resolve()
            for name in ('server', 'catalog'):
                shutil.copytree(ROOT / name, root / name, ignore=shutil.ignore_patterns('__pycache__'))
            (root / 'src').mkdir()
            shutil.copyfile(ROOT / 'src/layoutPolicy.json', root / 'src/layoutPolicy.json')
            (root / 'data').mkdir()
            (root / 'dist').symlink_to(ROOT / 'dist')
            binary = root / 'native-check'
            subprocess.run(['xcrun', 'swiftc', str(ROOT / 'desktop/OfflineWorkspace.swift'),
                str(ROOT / 'desktop/OfflineWorkspaceTests.swift'), '-o', str(binary),
                '-framework', 'Cocoa', '-framework', 'WebKit'], check=True)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            endpoint = f'http://127.0.0.1:{port}'
            with (root / 'server.log').open('w') as log:
                process = subprocess.Popen(['python3', str(root / 'server/app.py')],
                    env={**os.environ, 'SIGNALSTUDIO_DB': str(root / 'data/logic.db'), 'PORT': str(port), 'SIGNALSTUDIO_MODE': 'development'}, stdout=log, stderr=log)
                try:
                    for _ in range(150):
                        try:
                            urllib.request.urlopen(endpoint + '/api/desktop-health', timeout=1).close()
                            break
                        except OSError: time.sleep(.1)
                    subprocess.run([str(binary), endpoint, str(root), str(ROOT / 'dist'), 'online'], check=True, timeout=40)
                    process.terminate(); process.wait(timeout=10)
                    # Health responds, but the remote interface stalls: safely choose bundled UI.
                    app = root / 'server/app.py'
                    app.write_text(app.read_text().replace('    def serve_file(self):', '    def serve_file(self):\n        import time; time.sleep(20)'))
                    process = subprocess.Popen(['python3', str(app)], env={**os.environ, 'SIGNALSTUDIO_DB': str(root / 'data/logic.db'),
                        'PORT': str(port), 'SIGNALSTUDIO_MODE': 'development'}, stdout=log, stderr=log)
                    for _ in range(150):
                        try:
                            urllib.request.urlopen(endpoint + '/api/desktop-health', timeout=1).close(); break
                        except OSError: time.sleep(.1)
                    subprocess.run([str(binary), endpoint, str(root), str(ROOT / 'dist'), 'offline'], check=True, timeout=40)
                    process.kill(); process.wait(timeout=10)
                    subprocess.run([str(binary), endpoint, str(root), str(ROOT / 'dist'), 'offline'], check=True, timeout=40)
                    subprocess.run([str(binary), endpoint, str(root) + '/other', str(ROOT / 'dist'), 'empty'], check=True, timeout=40)
                finally:
                    if process.poll() is None:
                        process.terminate(); process.wait(timeout=10)
                    for project in (str(root), str(root) + '/other'):
                        host = hashlib.sha256((endpoint + '\n' + project).encode()).hexdigest()
                        (Path.home() / 'Library/Application Support/SignalStudio/workspace-snapshots' / (host + '.json')).unlink(missing_ok=True)


if __name__ == '__main__':
    unittest.main()
