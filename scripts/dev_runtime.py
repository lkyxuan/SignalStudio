"""Own a local Dev session, watch backend inputs, and reap only our children."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer


def read_json(url):
    try:
        with urllib.request.urlopen(url, timeout=0.5) as response:
            return json.load(response)
    except (OSError, ValueError):
        return None


def fingerprint(root):
    paths = sorted((root / 'server').rglob('*.py')) + sorted((root / 'catalog').rglob('*.json'))
    digest = hashlib.sha256()
    for path in paths:
        if path.name.startswith('test_') or '__pycache__' in path.parts:
            continue
        try:
            digest.update(str(path.relative_to(root)).encode())
            digest.update(path.read_bytes())
        except FileNotFoundError:
            pass
    return digest.hexdigest()


def stop(process):
    if process and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument('--db', type=Path)
    parser.add_argument('--client-port', type=int, default=15173)
    parser.add_argument('--client-host', default='127.0.0.1')
    parser.add_argument('--backend-port', type=int, default=18788)
    parser.add_argument('--control-port', type=int, default=18789)
    parser.add_argument('--parent-pid', type=int)
    args = parser.parse_args()
    address = ipaddress.IPv4Address(args.client_host)
    if not (address.is_loopback or address in ipaddress.ip_network('100.64.0.0/10')):
        parser.error('--client-host must be a loopback or Tailscale IPv4 address')
    root = args.root.resolve()
    if not address.is_loopback and not (root / 'dist/index.html').is_file():
        parser.error('Build the shared client with npm run build before starting the host')
    database = (args.db or root / 'data/logic.db').resolve()
    if not database.is_file():
        raise SystemExit('Existing database required; refusing to create another workspace.')
    # Check all endpoints before starting anything. Never terminate port occupants.
    reservations = []
    try:
        for host, port in ((args.client_host, args.client_port), ('127.0.0.1', args.backend_port), ('127.0.0.1', args.control_port)):
            listener = socket.socket()
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            reservations.append(listener)
            listener.bind((host, port))
    finally:
        for listener in reservations:
            listener.close()
    try:
        revision = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], text=True, timeout=3).strip()
    except (OSError, subprocess.SubprocessError):
        revision = None
    token = uuid.uuid4().hex
    state = {'app': 'SignalStudio', 'mode': 'development', 'project_root': str(root),
             'database_path': str(database), 'code_revision': revision, 'client_ready': False, 'status': 'starting'}
    children = {'backend': None, 'client': None}
    shutdown = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: shutdown.set())

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/health':
                self.send_error(404)
                return
            payload = json.dumps(state.copy()).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *_):
            pass

    http = HTTPServer(('127.0.0.1', args.control_port), Handler)
    thread = threading.Thread(target=http.serve_forever, daemon=True)
    thread.start()
    environment = dict(os.environ, PORT=str(args.backend_port), SIGNALSTUDIO_DB=str(database),
                       SIGNALSTUDIO_MODE='development', PYTHONUNBUFFERED='1')
    try:
        children['client'] = subprocess.Popen([args.node, str(root / 'scripts/dev_client.mjs'), str(root),
            str(args.client_port), str(args.backend_port), token, args.client_host, str(args.control_port)], cwd=root, env=environment)
        previous = None
        next_health_check = 0
        candidate = fingerprint(root)
        changed_at = time.monotonic() - 1
        while not shutdown.wait(0.25):
            if args.parent_pid and os.getppid() != args.parent_pid:
                break
            current = fingerprint(root)
            if current != candidate:
                candidate, changed_at = current, time.monotonic()
            if candidate != previous and time.monotonic() - changed_at >= 0.5:
                state.update(client_ready=False, status='restarting' if previous else 'starting')
                stop(children['backend'])
                children['backend'] = subprocess.Popen([sys.executable, str(root / 'server/app.py')],
                    cwd=root, env=environment)
                previous = candidate
                next_health_check = 0
            backend = children['backend']
            if children['client'].poll() is not None:
                state.update(client_ready=False, status='error', error='Vite stopped; reopen Dev App.')
                continue
            if backend is None:
                continue
            if backend.poll() is not None:
                state.update(client_ready=False, status='error', error='Backend stopped; fix source or reopen Dev App.')
                continue
            if time.monotonic() < next_health_check:
                continue
            next_health_check = time.monotonic() + 1
            api = read_json(f'http://127.0.0.1:{args.backend_port}/api/desktop-health')
            client = read_json(f'http://{args.client_host}:{args.client_port}/__signalstudio_dev')
            ready = bool(api and api.get('project_root') == str(root)
                and api.get('database_path') == str(database) and api.get('mode') == 'development'
                and client == {'project_root': str(root), 'token': token})
            state.update(client_ready=ready, backend_pid=backend.pid, status='ready' if ready else 'restarting')
            state.pop('error', None)
    finally:
        state.update(client_ready=False, status='stopping')
        stop(children['client'])
        stop(children['backend'])
        http.shutdown()
        http.server_close()


if __name__ == '__main__':
    main()
