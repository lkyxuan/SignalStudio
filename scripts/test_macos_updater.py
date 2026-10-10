"""Isolated Git repositories, real SQLite/WAL and injected service failures."""
import fcntl
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from scripts.macos_updater import Updater, backup_database, git, run


class Service:
    def __init__(self, root, fail=False):
        self.root, self.fail, self.starts = root, fail, 0

    def stop(self):
        pass

    def start(self):
        self.starts += 1
        if self.fail and self.starts == 1:
            # Even data written after the backup must survive a code rollback.
            with sqlite3.connect(self.root / 'data/logic.db') as db:
                db.execute("INSERT INTO records VALUES ('post-backup')")
            raise RuntimeError('injected startup failure')

    def healthy(self):
        pass


def validate(root, _service):
    (root / 'node_modules').mkdir()
    (root / 'node_modules/version').write_text('candidate')
    (root / 'dist').mkdir()
    (root / 'dist/index.html').write_text('new page')


class UpdaterTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.remote = self.base / 'origin.git'
        self.author = self.base / 'author'
        self.root = self.base / 'host'
        run(['git', 'init', '--bare', '--initial-branch=main', self.remote])
        run(['git', 'clone', self.remote, self.author])
        for root in (self.author,):
            git(root, 'config', 'user.email', 'tests@example.invalid')
            git(root, 'config', 'user.name', 'Isolated tests')
        (self.author / 'src').mkdir()
        (self.author / 'src/app.js').write_text('old')
        (self.author / '.gitignore').write_text('node_modules/\ndist/\ndata/logic.db-wal\ndata/logic.db-shm\n')
        (self.author / 'data').mkdir()
        with sqlite3.connect(self.author / 'data/logic.db') as db:
            db.execute('CREATE TABLE records(value TEXT)')
        git(self.author, 'add', '.')
        git(self.author, 'commit', '-m', 'baseline')
        git(self.author, 'push', 'origin', 'main')
        run(['git', 'clone', self.remote, self.root])
        self.old = git(self.root, 'rev-parse', 'HEAD')
        (self.root / 'dist').mkdir()
        (self.root / 'dist/index.html').write_text('old page')
        # The tracked online DB is dirty and remains dirty throughout delivery.
        with sqlite3.connect(self.root / 'data/logic.db') as db:
            db.execute("INSERT INTO records VALUES ('live')")
        (self.root / 'node_modules').mkdir()
        (self.root / 'node_modules/version').write_text('old')
        self.service = Service(self.root)
        self.updater = Updater(self.root, self.base / 'state', lambda _: self.service, validate)

    def push(self, path='src/app.js', content='new'):
        target = self.author / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
        git(self.author, 'add', path)
        git(self.author, 'commit', '-m', 'candidate')
        git(self.author, 'push', 'origin', 'main')
        return git(self.author, 'rev-parse', 'HEAD')

    def values(self):
        with sqlite3.connect(self.root / 'data/logic.db') as db:
            return [row[0] for row in db.execute('SELECT value FROM records')]

    def test_no_update_and_pause_resume_marker(self):
        self.assertEqual(self.updater.once(), 'current')
        (self.updater.directory / 'paused').touch()
        self.push()
        self.assertEqual(self.updater.once(), 'paused')
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), self.old)
        (self.updater.directory / 'paused').unlink()
        self.assertEqual(self.updater.once(), 'updated')

    def test_success_fast_forward_preserves_online_data_and_backup(self):
        target = self.push()
        self.assertEqual(self.updater.once(), 'updated')
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), target)
        self.assertEqual(self.values(), ['live'])
        self.assertEqual((self.root / 'node_modules/version').read_text(), 'candidate')
        with sqlite3.connect(self.updater.state['backup']) as backup:
            self.assertEqual(backup.execute('SELECT value FROM records').fetchall(), [('live',)])
        self.assertEqual(self.updater.once(), 'current')
        self.assertEqual(self.service.starts, 1)

    def test_source_conflict_and_staged_database_pause(self):
        self.push()
        (self.root / 'src/app.js').write_text('local edit')
        self.assertEqual(self.updater.once(), 'paused')
        self.assertEqual((self.root / 'src/app.js').read_text(), 'local edit')
        git(self.root, 'restore', 'src/app.js')
        git(self.root, 'add', 'data/logic.db')
        self.assertEqual(self.updater.once(), 'paused')
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), self.old)

    def test_database_migration_and_unknown_changes_pause(self):
        for path in ('data/logic.db', 'server/new_migration.py', 'scripts/dev_runtime.py', 'unknown.txt'):
            with self.subTest(path=path):
                self.push(path, 'never apply')
                self.assertEqual(self.updater.once(), 'paused')
                self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), self.old)
                self.assertEqual(self.values(), ['live'])

    def test_candidate_failure_remembers_commit_and_retry(self):
        target = self.push()
        def failure(*_):
            raise RuntimeError('injected build failure')
        self.updater.validator = failure
        self.assertEqual(self.updater.once(), 'failed')
        self.assertEqual(self.updater.state['failed_commit'], target)
        self.assertEqual(self.service.starts, 0)
        self.updater.state['next_check_epoch'] = 0
        self.updater.save('failed')
        self.assertEqual(self.updater.once(), 'paused')
        self.updater.validator = validate
        self.assertEqual(self.updater.once(retry=True), 'updated')

    def test_start_failure_rolls_back_added_files_dependencies_not_data(self):
        self.service.fail = True
        self.push('src/new.js')
        self.assertEqual(self.updater.once(), 'failed')
        self.assertEqual(git(self.root, 'rev-parse', 'HEAD'), self.old)
        self.assertFalse((self.root / 'src/new.js').exists())
        self.assertEqual((self.root / 'node_modules/version').read_text(), 'old')
        self.assertEqual((self.root / 'dist/index.html').read_text(), 'old page')
        self.assertEqual(self.values(), ['live', 'post-backup'])
        self.assertEqual(self.service.starts, 2)

    def test_network_failure_backoff_and_lock(self):
        git(self.root, 'remote', 'set-url', 'origin', str(self.base / 'offline'))
        self.assertEqual(self.updater.once(), 'failed')
        self.assertEqual(self.updater.once(), 'backoff')
        with (self.updater.directory / 'lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            self.assertEqual(self.updater.once(), 'busy')
        self.assertEqual(self.values(), ['live'])

    def test_head_change_during_validation_is_not_overwritten(self):
        self.push()
        def concurrent(root, service):
            validate(root, service)
            git(self.root, 'switch', '--detach', 'HEAD~0')
            (self.root / 'src/app.js').write_text('concurrent work')
        self.updater.validator = concurrent
        self.assertEqual(self.updater.once(), 'paused')
        self.assertEqual((self.root / 'src/app.js').read_text(), 'concurrent work')
        self.assertEqual(self.service.starts, 0)

    def test_interrupted_delivery_requires_recovery(self):
        self.updater.save('applying')
        self.assertEqual(self.updater.once(retry=True), 'recovery_required')

    def test_backup_includes_committed_wal(self):
        db = sqlite3.connect(self.root / 'data/logic.db')
        self.addCleanup(db.close)
        db.execute('PRAGMA journal_mode=WAL')
        db.execute("INSERT INTO records VALUES ('wal')")
        db.commit()
        output = self.base / 'wal-backup.db'
        backup_database(self.root / 'data/logic.db', output)
        with sqlite3.connect(output) as backup:
            self.assertEqual(backup.execute('SELECT value FROM records').fetchall(), [('live',), ('wal',)])


if __name__ == '__main__':
    unittest.main()
