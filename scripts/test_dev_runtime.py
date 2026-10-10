"""Real-process integration checks; all edits use a temporary project and DB."""
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
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def get(url, method='GET', body=None, revision=None):
    headers = {'Content-Type': 'application/json', 'X-Card-Model': 'card-model.v1'}
    if revision:
        headers['If-Match'] = revision
    request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None,
                                     method=method, headers=headers)
    with urllib.request.urlopen(request, timeout=2) as response:
        return json.load(response)


def wait(check, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            result = check()
            if result:
                return result
        except (OSError, ValueError):
            pass
        time.sleep(.15)
    raise AssertionError('Condition did not become ready')


def fixture(root):
    for directory in ('server', 'catalog', 'scripts', 'src', 'public'):
        shutil.copytree(ROOT / directory, root / directory, ignore=shutil.ignore_patterns('__pycache__'))
    for name in ('package.json', 'index.html'):
        shutil.copyfile(ROOT / name, root / name)
    (root / 'node_modules').symlink_to(ROOT / 'node_modules', target_is_directory=True)
    (root / 'data').mkdir()
    with sqlite3.connect(ROOT / 'data/logic.db') as source, sqlite3.connect(root / 'data/logic.db') as target:
        source.backup(target)


class DevRuntimeTest(unittest.TestCase):
    def test_runtime_restart_recovery_conflict_and_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='signalstudio-dev-test-') as temporary:
            root = Path(temporary)
            fixture(root)
            ports = []
            for _ in range(3):
                with socket.socket() as listener:
                    listener.bind(('127.0.0.1', 0)); ports.append(listener.getsockname()[1])
            client, backend, control = ports
            health = f'http://127.0.0.1:{control}/health'
            api = f'http://127.0.0.1:{client}/api'
            environment = dict(os.environ, SIGNALSTUDIO_BACKFILL_PATH=str(root / 'data/backfill.json'))
            command = [sys.executable, str(ROOT / 'scripts/dev_runtime.py'), '--root', str(root),
                '--node', shutil.which('node'), '--client-port', str(client), '--backend-port', str(backend),
                '--control-port', str(control)]
            with (root / 'test.log').open('w') as log:
                process = subprocess.Popen(command, stdout=log, stderr=log, env=environment)
                try:
                    first = wait(lambda: (h := get(health))['client_ready'] and h)
                    forwarded = get(f'http://127.0.0.1:{client}/__signalstudio_health')
                    self.assertEqual(forwarded['project_root'], str(root.resolve()))
                    self.assertTrue(forwarded['client_ready'])
                    request = urllib.request.Request(api + '/graph', headers={'Origin': 'https://untrusted.example'})
                    with self.assertRaises(urllib.error.HTTPError) as cross_origin:
                        urllib.request.urlopen(request, timeout=2)
                    self.assertEqual(cross_origin.exception.code, 403)
                    initial = get(api + '/graph')
                    # Startup is idempotent across backend restarts for an existing workspace.
                    target = root / 'server/app.py'
                    original = target.read_text()
                    target.write_text(original + '\n# isolated restart check\n')
                    second = wait(lambda: (h := get(health))['client_ready'] and h['backend_pid'] != first['backend_pid'] and h)
                    self.assertEqual(initial['revision'], get(api + '/graph')['revision'])
                    # Independent process revision check protects all graph mutations.
                    node = next(n for n in initial['nodes'] if n['type'] == 'Metric' and not n['is_system_state'])
                    with sqlite3.connect(root / 'data/logic.db') as db:
                        db.execute('UPDATE nodes SET definition=? WHERE id=?', ('isolated external', node['id']))
                    with self.assertRaises(urllib.error.HTTPError) as error:
                        get(api + '/nodes/' + node['id'], 'PATCH', {'definition': 'stale'}, initial['revision'])
                    self.assertEqual(error.exception.code, 409)
                    current = get(api + '/graph')
                    get(api + '/nodes/' + node['id'], 'PATCH', {'notes': 'safe local delta'}, current['revision'])
                    self.assertEqual(next(n for n in get(api + '/graph')['nodes'] if n['id'] == node['id'])['definition'], 'isolated external')
                    # A syntax failure remains visible and a later save recovers without relaunch.
                    target.write_text(original + '\ninvalid python ???\n')
                    wait(lambda: get(health)['status'] == 'error')
                    target.write_text(original)
                    third = wait(lambda: (h := get(health))['client_ready'] and h['backend_pid'] != second['backend_pid'] and h)
                    # Backend-loaded contract saves also trigger restart.
                    contract = root / 'catalog/source-contracts.v1.json'
                    contract.write_text(contract.read_text() + '\n')
                    wait(lambda: (h := get(health))['client_ready'] and h['backend_pid'] != third['backend_pid'])
                    # Port collisions fail without taking over the existing healthy session.
                    collision = subprocess.run(command, stdout=log, stderr=log, env=environment, timeout=5)
                    self.assertNotEqual(collision.returncode, 0)
                    self.assertTrue(get(health)['client_ready'])
                finally:
                    process.terminate(); process.wait(timeout=15)
                for port in ports:
                    with socket.socket() as probe:
                        self.assertNotEqual(probe.connect_ex(('127.0.0.1', port)), 0)
                # Immediate relaunch must work while old TCP connections are in TIME_WAIT.
                with (root / 'relaunch.log').open('w') as relaunch_log:
                    reopened = subprocess.Popen(command, stdout=relaunch_log, stderr=relaunch_log, env=environment)
                    try:
                        wait(lambda: get(health)['client_ready'])
                    finally:
                        reopened.terminate(); reopened.wait(timeout=15)


if __name__ == '__main__':
    unittest.main()
