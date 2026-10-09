"""Exercise the desktop's real HTTP entrypoint with an isolated database."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.request import build_opener, ProxyHandler, Request

ROOT = Path(__file__).resolve().parent.parent


class DesktopServerTest(unittest.TestCase):
    def test_identity_and_saved_data_survive_server_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "desktop.db"
            with socket.socket() as sock:
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
            opener = build_opener(ProxyHandler({}))

            def request(path, payload=None):
                data = json.dumps(payload).encode() if payload is not None else None
                req = Request(f"http://127.0.0.1:{port}{path}", data=data,
                              headers={"Content-Type": "application/json"})
                with opener.open(req, timeout=1) as response:
                    return json.load(response)

            def start():
                process = subprocess.Popen(
                    [sys.executable, str(ROOT / "server/app.py")], cwd=ROOT,
                    env={**os.environ, "PORT": str(port), "SIGNALSTUDIO_DB": str(database)},
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self.addCleanup(stop, process)
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    try:
                        return process, request("/api/desktop-health")
                    except OSError:
                        if process.poll() is not None:
                            self.fail("Desktop server exited during startup")
                        time.sleep(0.05)
                self.fail("Desktop server startup timed out")

            def stop(process):
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=5)

            process, health = start()
            self.assertEqual(health["app"], "SignalStudio")
            self.assertEqual(health["project_root"], str(ROOT))
            self.assertEqual(health["database_path"], str(database.resolve()))
            self.assertEqual(health["client_ready"], (ROOT / "dist/index.html").is_file())
            node = request("/api/nodes", {"name": "Desktop persistence check", "type": "Metric"})
            stop(process)
            process, _ = start()
            self.assertEqual(request(f'/api/nodes/{node["id"]}')["name"], "Desktop persistence check")
            stop(process)


if __name__ == "__main__":
    unittest.main()
