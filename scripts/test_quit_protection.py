"""Run the production quit query in real WebKit with isolated page state."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent


class QuitProtectionTests(unittest.TestCase):
    def test_webkit_states_and_unresponsive_page(self):
        with tempfile.TemporaryDirectory(prefix='ss125-quit-') as temporary:
            binary = str(Path(temporary) / 'quit-check')
            subprocess.run(['xcrun', 'swiftc', str(ROOT / 'desktop/QuitProtection.swift'),
                            str(ROOT / 'desktop/QuitProtectionTests.swift'), '-framework', 'Cocoa',
                            '-framework', 'WebKit', '-o', binary], check=True)
            subprocess.run([binary], check=True, timeout=25)
