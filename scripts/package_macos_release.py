"""Create a clean arm64 shared-client DMG and SHA256 file. Never reads desktop/connection.json or data/."""
import argparse
import hashlib
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        parser.error('Version must be three numeric components')
    dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).splitlines()
    if any(line != ' M data/logic.db' for line in dirty):
        parser.error('Commit source changes before building a release')
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    name = f'SignalStudio-{args.version}-arm64'
    dmg = output / f'{name}.dmg'
    if dmg.exists() or (output / f'{name}.sha256').exists():
        parser.error('Release artifact already exists; choose a fresh output directory')
    with tempfile.TemporaryDirectory(prefix='signalstudio-dmg-') as temporary:
        stage = Path(temporary) / 'stage'
        stage.mkdir()
        subprocess.run([sys.executable, str(ROOT / 'scripts/build_macos_app.py'),
                        str(stage / 'SignalStudio.app'), '--release', '--version', args.version], check=True)
        (stage / 'Applications').symlink_to('/Applications')
        shutil.copyfile(ROOT / 'desktop/INSTALL.zh-CN.txt', stage / '安装说明.txt')
        subprocess.run(['hdiutil', 'create', '-volname', f'SignalStudio {args.version}',
                        '-srcfolder', str(stage), '-format', 'UDZO', str(dmg)], check=True)
    checksum = hashlib.sha256(dmg.read_bytes()).hexdigest()
    (output / f'{name}.sha256').write_text(f'{checksum}  {dmg.name}\n')
    print(dmg)
    print(checksum)


if __name__ == '__main__':
    main()
