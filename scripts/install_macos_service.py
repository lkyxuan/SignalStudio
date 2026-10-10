"""Install the approved private development host as a per-user LaunchAgent."""
import argparse
import ipaddress
import os
from pathlib import Path
import plistlib
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', required=True)
    parser.add_argument('--host', required=True)
    args = parser.parse_args()
    address = ipaddress.IPv4Address(args.host)
    if address not in ipaddress.ip_network('100.64.0.0/10'):
        parser.error('--host must be this machine\'s Tailscale IPv4 address')
    root = Path(__file__).resolve().parent.parent
    if not Path(args.node).is_file() or not (root / 'node_modules/vite/bin/vite.js').is_file():
        raise SystemExit('Install Node.js and npm dependencies before installing the service.')
    if not (root / 'dist/index.html').is_file():
        raise SystemExit('Build the shared client with npm run build before installing the service.')
    if not (root / 'data/logic.db').is_file():
        raise SystemExit('Migrate and verify the existing database before installing the service.')
    label = 'local.signalstudio.server'
    destination = Path.home() / f'Library/LaunchAgents/{label}.plist'
    logs = Path.home() / 'Library/Logs/SignalStudio'
    destination.parent.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    config = {
        'Label': label,
        'ProgramArguments': [sys.executable, str(root / 'scripts/dev_runtime.py'),
                            '--node', str(Path(args.node).resolve()), '--client-host', args.host],
        'WorkingDirectory': str(root), 'RunAtLoad': True, 'KeepAlive': True,
        'ThrottleInterval': 10,
        'EnvironmentVariables': {'PYTHONUNBUFFERED': '1'},
        'StandardOutPath': str(logs / 'host.log'),
        'StandardErrorPath': str(logs / 'host-error.log'),
    }
    destination.write_bytes(plistlib.dumps(config))
    domain = f'gui/{os.getuid()}'
    # Stop only this named SignalStudio service when reinstalling it.
    subprocess.run(['launchctl', 'bootout', f'{domain}/{label}'], capture_output=True)
    subprocess.run(['launchctl', 'bootstrap', domain, str(destination)], check=True)
    print(f'Installed: {destination}')
    print(f'Host: http://{args.host}:15173')


if __name__ == '__main__':
    main()
