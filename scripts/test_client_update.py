"""Actual Sparkle updates in private test app bundles; no public feed or user App changes."""
import functools
import http.server
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
import xml.etree.ElementTree as ET
from scripts.sparkle import ACCOUNT, ROOT, configuration, distribution, sign

NS = 'http://www.andymatuschak.org/xml-namespaces/sparkle'
ET.register_namespace('sparkle', NS)


class ClientUpdateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tools = distribution()
        cls.temporary = tempfile.TemporaryDirectory(prefix='ss59-update-')
        cls.root = Path(cls.temporary.name)
        cls.binary = cls.root / 'test-client'
        subprocess.run(['xcrun', 'swiftc', '-D', 'UPDATER_TESTING', str(ROOT / 'desktop/ClientUpdater.swift'),
            str(ROOT / 'desktop/ClientUpdateIntegration.swift'), '-F', str(cls.tools), '-framework', 'Sparkle',
            '-framework', 'Cocoa', '-framework', 'WebKit', '-Xlinker', '-rpath', '-Xlinker', '@executable_path/../Frameworks',
            '-o', str(cls.binary)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def run_update(self, restart=False, corrupt=False):
        directory = self.root / f'case-{restart}-{corrupt}'
        directory.mkdir()
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(directory))
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        app = directory / 'installed/SignalStudioUpdateTest.app'
        latest = directory / 'target/SignalStudioUpdateTest.app'
        identifier = 'local.signalstudio.update-test.' + directory.name + '.' + str(os.getpid())
        subprocess.run(['defaults', 'delete', identifier], capture_output=True)
        for target, version, updated in ((app, '0.1.1', False), (latest, '0.1.2', True)):
            contents = target / 'Contents'
            (contents / 'MacOS').mkdir(parents=True)
            (contents / 'Frameworks').mkdir()
            shutil.copyfile(self.binary, contents / 'MacOS/test-client')
            (contents / 'MacOS/test-client').chmod(0o755)
            shutil.copytree(self.tools / 'Sparkle.framework', contents / 'Frameworks/Sparkle.framework', symlinks=True)
            info = dict(CFBundleName='SignalStudioUpdateTest', CFBundleIdentifier=identifier, CFBundleExecutable='test-client',
                CFBundlePackageType='APPL', CFBundleVersion=version, CFBundleShortVersionString=version,
                SUFeedURL=base + '/appcast.xml', SUPublicEDKey=configuration()['publicKey'],
                SUEnableAutomaticChecks=True, SUAutomaticallyUpdate=True, SURequireSignedFeed=True,
                SUVerifyUpdateBeforeExtraction=True, SUSignedFeedFailureExpirationInterval=0,
                NSAppTransportSecurity={'NSAllowsArbitraryLoads': True},
                TestResultDirectory=str(directory), TestUpdated=updated, TestRestart=restart)
            (contents / 'Info.plist').write_bytes(plistlib.dumps(info))
            subprocess.run(['codesign', '--force', '--sign', '-', str(target)], check=True)
        archive = directory / 'update.zip'
        subprocess.run(['ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(latest), str(archive)], check=True)
        signature = sign(archive, self.tools)
        rss = ET.Element('rss', version='2.0'); channel = ET.SubElement(rss, 'channel'); ET.SubElement(channel, 'title').text = 'Isolated test'
        item = ET.SubElement(channel, 'item'); ET.SubElement(item, 'title').text = 'Test update'
        ET.SubElement(item, f'{{{NS}}}version').text = '0.1.2'
        ET.SubElement(item, 'enclosure', url=base + '/update.zip', length=str(archive.stat().st_size), type='application/octet-stream', **{f'{{{NS}}}edSignature': signature})
        feed = directory / 'appcast.xml'
        ET.ElementTree(rss).write(feed, encoding='utf-8', xml_declaration=True)
        subprocess.run([str(self.tools / 'bin/sign_update'), '--account', ACCOUNT, str(feed)], check=True)
        if corrupt:
            archive.write_bytes(archive.read_bytes() + b'corrupted-after-signing')
        process = subprocess.Popen([str(app / 'Contents/MacOS/test-client')], stdout=subprocess.PIPE, stderr=(directory / 'stderr.log').open('w'))
        try:
            deadline = time.monotonic() + 50
            while time.monotonic() < deadline:
                if corrupt and (directory / 'failure').exists(): break
                installed = plistlib.loads((app / 'Contents/Info.plist').read_bytes())['CFBundleVersion']
                if installed == '0.1.2' and (not restart or (directory / 'relaunched').exists()): break
                time.sleep(0.3)
            info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
            if corrupt:
                self.assertTrue((directory / 'failure').exists(), (directory / 'stderr.log').read_text())
                self.assertEqual(info['CFBundleVersion'], '0.1.1')
            else:
                self.assertEqual(info['CFBundleVersion'], '0.1.2', (directory / 'stderr.log').read_text())
                self.assertTrue((directory / 'cancelled').exists())
                if restart: self.assertTrue((directory / 'relaunched').exists())
        finally:
            if process.poll() is None: process.terminate()
            process.wait(timeout=10)
            server.shutdown(); server.server_close(); thread.join()
            subprocess.run(['defaults', 'delete', identifier], capture_output=True)
        print('Isolated artifacts:', directory)

    def test_install_on_quit(self): self.run_update()
    def test_install_and_restart(self): self.run_update(restart=True)
    def test_reject_tampered_archive(self): self.run_update(corrupt=True)


if __name__ == '__main__': unittest.main()
