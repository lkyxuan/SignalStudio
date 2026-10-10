"""An in-flight HTTP mutation must commit and respond before SIGTERM exit."""
import concurrent.futures
import json
import os
from pathlib import Path
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


class GracefulShutdownTest(unittest.TestCase):
    def test_sigterm_during_transaction_preserves_write_and_response(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ('server', 'catalog'):
                shutil.copytree(ROOT / name, root / name, ignore=shutil.ignore_patterns('__pycache__'))
            app = root / 'server/app.py'
            original = 'return service.create_node(self.body())'
            # Delay inside the real POST transaction, before dispatch commits.
            replacement = '''result = service.create_node(self.body())
                (ROOT / 'inside-request').touch()
                __import__('time').sleep(.8)
                return result'''
            source = app.read_text()
            self.assertIn(original, source)
            app.write_text(source.replace(original, replacement))
            database = root / 'isolated.db'
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', 0))
                port = probe.getsockname()[1]
            process = subprocess.Popen([sys.executable, str(app)], cwd=root,
                env=dict(os.environ, PORT=str(port), SIGNALSTUDIO_DB=str(database),
                         SIGNALSTUDIO_BACKFILL_PATH=str(root / 'backfill.json')),
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    try:
                        urllib.request.urlopen(f'http://127.0.0.1:{port}/api/desktop-health', timeout=1).close()
                        break
                    except OSError:
                        time.sleep(.05)
                else:
                    self.fail('Startup failed')
                def write():
                    request = urllib.request.Request(f'http://127.0.0.1:{port}/api/nodes',
                        data=json.dumps({'name': 'write survives shutdown', 'type': 'Metric'}).encode(),
                        headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, timeout=5) as response:
                        return json.load(response)
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    response = pool.submit(write)
                    deadline = time.monotonic() + 5
                    while not (root / 'inside-request').exists():
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(.02)
                    process.terminate()
                    node = response.result(timeout=5)
                process.wait(timeout=5)
                self.assertEqual(process.returncode, 0)
                with sqlite3.connect(database) as db:
                    self.assertEqual(db.execute('SELECT name FROM nodes WHERE id=?', (node['id'],)).fetchone()[0],
                                     'write survives shutdown')
                    self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    unittest.main()
