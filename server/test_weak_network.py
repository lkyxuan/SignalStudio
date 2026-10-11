"""Real HTTP checks against an isolated database, never the running workspace."""
import gzip
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


class WeakNetworkTest(unittest.TestCase):
    def test_condition_compression_identity_and_changed_graph(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'test.db'
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            process = subprocess.Popen([sys.executable, str(ROOT / 'server/app.py')], cwd=ROOT,
                env={**os.environ, 'PORT': str(port), 'SIGNALSTUDIO_DB': str(database)},
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                def get(path='/api/graph', headers=None, body=None):
                    request = urllib.request.Request(f'http://127.0.0.1:{port}{path}', headers=headers or {},
                        data=json.dumps(body).encode() if body is not None else None)
                    try:
                        response = urllib.request.urlopen(request, timeout=3)
                    except urllib.error.HTTPError as error:
                        response = error
                    return response.code, response.headers, response.read()
                for _ in range(150):
                    try:
                        if get('/api/desktop-health')[0] == 200: break
                    except OSError: pass
                    time.sleep(.1)
                status, headers, plain = get()
                self.assertEqual(status, 200)
                graph = json.loads(plain)
                etag = headers['ETag']
                self.assertEqual(graph['workspace']['database_path'], str(database.resolve()))
                status, headers, compressed = get(headers={'Accept-Encoding': 'br, gzip;q=0.7'})
                self.assertEqual(headers['Content-Encoding'], 'gzip')
                self.assertEqual(gzip.decompress(compressed), plain)
                self.assertLess(len(compressed), len(plain))
                status, headers, body = get(headers={'If-None-Match': '"older", ' + etag, 'Accept-Encoding': 'gzip', 'X-Workspace-Identity': json.dumps(graph['workspace'])})
                self.assertEqual(status, 304); self.assertEqual(body, b''); self.assertEqual(headers['ETag'], etag)
                for accept in ('gzip;q=0, *;q=1', 'gzip;q=broken', 'gzip;q=2', 'br'):
                    self.assertIsNone(get(headers={'Accept-Encoding': accept})[1]['Content-Encoding'])
                self.assertEqual(get(headers={'Accept-Encoding': '*;q=0.5'})[1]['Content-Encoding'], 'gzip')
                wrong = json.dumps({'project_root': str(ROOT), 'database_path': '/other.db'})
                self.assertEqual(get(headers={'X-Workspace-Identity': wrong, 'If-None-Match': etag})[0], 412)
                mutation = {'If-Match': graph['revision'], 'X-Card-Model': 'card-model.v1', 'Content-Type': 'application/json'}
                self.assertEqual(get('/api/nodes', {**mutation, 'X-Workspace-Identity': wrong}, {'name': 'must not exist', 'type': 'Metric'})[0], 412)
                self.assertEqual(get('/api/nodes', {**mutation, 'X-Workspace-Identity': json.dumps(graph['workspace'])}, {'name': 'isolated change', 'type': 'Metric'})[0], 200)
                status, _, changed = get(headers={'If-None-Match': etag})
                self.assertEqual(status, 200); self.assertNotEqual(json.loads(changed)['revision'], graph['revision'])
                self.assertTrue(any(n['name'] == 'isolated change' for n in json.loads(changed)['nodes']))
                print(f'isolated graph wire bytes: identity={len(plain)}, gzip={len(compressed)}, unchanged=0')
                status, headers, html = get('/', {'Accept-Encoding': 'gzip'})
                self.assertEqual(status, 200); self.assertIn(b'<html', gzip.decompress(html))
                self.assertIn('no-cache', headers['Cache-Control'])
            finally:
                process.terminate(); process.wait(timeout=10)


if __name__ == '__main__':
    unittest.main()
