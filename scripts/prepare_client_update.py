"""Prepare a signed update archive and appcast. Does not publish or overwrite artifacts."""
import argparse
import base64
from datetime import datetime, timezone
from email.utils import format_datetime
import hashlib
from pathlib import Path
import plistlib
import subprocess
import xml.etree.ElementTree as ET
from sparkle import ACCOUNT, configuration, distribution, sign

SPARKLE = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ET.register_namespace('sparkle', SPARKLE)


def prepare(app, output, download_url, notes='SignalStudio shared client update', tools=None):
    tools = tools or distribution()
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    key = subprocess.check_output([str(tools / 'bin/generate_keys'), '--account', ACCOUNT, '-p'], text=True).strip()
    if key != info.get('SUPublicEDKey') or key != configuration()['publicKey']:
        raise ValueError('Signing key does not match the embedded and configured public key')
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(app)], check=True)
    version = info['CFBundleVersion']
    name = f'SignalStudio-{version}-arm64.zip'
    archive = output / name
    feed = output / 'appcast.xml'
    if archive.exists() or feed.exists():
        raise ValueError('Artifact already exists')
    if not download_url.endswith('/' + name) or not download_url.startswith('https://github.com/lkyxuan/SignalStudio/releases/download/'):
        raise ValueError('Expected immutable repository Release download URL')
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(archive)], check=True)
    signature = sign(archive, tools)
    if len(base64.b64decode(signature, validate=True)) != 64:
        raise ValueError('Invalid EdDSA signature')
    subprocess.run([str(tools / 'bin/sign_update'), '--account', ACCOUNT, '--verify', str(archive), signature], check=True)
    rss = ET.Element('rss', version='2.0')
    channel = ET.SubElement(rss, 'channel')
    ET.SubElement(channel, 'title').text = 'SignalStudio shared preview updates'
    item = ET.SubElement(channel, 'item')
    ET.SubElement(item, 'title').text = f'SignalStudio {version} (Preview)'
    ET.SubElement(item, 'pubDate').text = format_datetime(datetime.now(timezone.utc))
    ET.SubElement(item, 'description').text = notes
    ET.SubElement(item, f'{{{SPARKLE}}}version').text = version
    ET.SubElement(item, f'{{{SPARKLE}}}shortVersionString').text = version
    ET.SubElement(item, f'{{{SPARKLE}}}minimumSystemVersion').text = info['LSMinimumSystemVersion']
    ET.SubElement(item, 'enclosure', url=download_url, length=str(archive.stat().st_size),
                  type='application/octet-stream', **{f'{{{SPARKLE}}}edSignature': signature,
                  f'{{{SPARKLE}}}os': 'macos', f'{{{SPARKLE}}}installationType': 'application'})
    ET.ElementTree(rss).write(feed, encoding='utf-8', xml_declaration=True)
    subprocess.run([str(tools / 'bin/sign_update'), '--account', ACCOUNT, str(feed)], check=True)
    subprocess.run([str(tools / 'bin/sign_update'), '--account', ACCOUNT, '--verify', str(feed)], check=True)
    (output / f'SignalStudio-{version}-arm64.zip.sha256').write_text(f'{hashlib.sha256(archive.read_bytes()).hexdigest()}  {name}\n')
    return archive, feed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--download-url', required=True)
    parser.add_argument('--notes', default='Automatic client updates and unified update status. Preview release.')
    args = parser.parse_args()
    print(prepare(args.app.resolve(), args.output.resolve(), args.download_url, args.notes))
