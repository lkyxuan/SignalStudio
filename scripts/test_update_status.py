from datetime import datetime, timezone, timedelta
import json
from pathlib import Path
import tempfile
import unittest
from scripts.update_status import summary


class UpdateStatusTests(unittest.TestCase):
    def test_status_does_not_expose_diagnostics(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            now = datetime.now(timezone.utc)
            path.write_text(json.dumps(dict(phase='paused', reason='secret /Users/private/project', backup='/private.db',
                current_commit='a' * 40, candidate_commit='b' * 40, last_check=now.isoformat())))
            result = summary(path, now)
            self.assertFalse(result['stale'])
            self.assertEqual(result['current_commit'], 'a' * 40)
            self.assertNotIn('private', json.dumps(result))
            self.assertNotIn('secret', json.dumps(result))
            self.assertNotIn('backup', result)
            self.assertTrue(summary(path, now + timedelta(minutes=4))['stale'])

    def test_missing_corrupt_future_and_invalid_timestamps(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'status.json'
            self.assertEqual(summary(path)['phase'], 'not-installed')
            for value in ('[1]', 'broken', '{"last_check": "bad"}', '{"last_check": "2026-01-01"}'):
                path.write_text(value)
                self.assertEqual(summary(path)['phase'], 'unknown')
                self.assertTrue(summary(path)['stale'])
            now = datetime.now(timezone.utc)
            path.write_text(json.dumps(dict(phase='current', last_check=(now + timedelta(days=1)).isoformat())))
            self.assertTrue(summary(path, now)['stale'])


if __name__ == '__main__':
    unittest.main()
