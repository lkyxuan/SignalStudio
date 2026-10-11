"""Pinned Sparkle distribution and public updater configuration. No private keys."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
VERSION = '2.10.0'
SHA256 = 'c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c'
URL = f'https://github.com/sparkle-project/Sparkle/releases/download/{VERSION}/Sparkle-{VERSION}.tar.xz'
ACCOUNT = 'SignalStudio'


def distribution():
    cache = Path.home() / 'Library/Caches/SignalStudio' / f'Sparkle-{VERSION}'
    archive = cache / 'distribution.tar.xz'
    cache.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        with urllib.request.urlopen(URL, timeout=60) as source:
            archive.write_bytes(source.read())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise ValueError('Sparkle distribution checksum mismatch; remove cached archive and retry')
    # Re-extract verified files; never trust previously modified cached binaries.
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            if member.name.startswith('/') or '..' in Path(member.name).parts:
                raise ValueError('Unsafe Sparkle archive path')
        source.extractall(cache)
    return cache


def configuration():
    return json.loads((ROOT / 'desktop/updater.json').read_text())


def sign(path, tools=None):
    tools = tools or distribution()
    result = subprocess.check_output([str(tools / 'bin/sign_update'), '--account', ACCOUNT, '-p', str(path)], text=True).strip()
    return result
