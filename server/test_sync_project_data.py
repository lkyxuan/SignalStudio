import sqlite3
import tempfile
import unittest
from pathlib import Path

from scripts.sync_project_data import export_data, restore_data


class ProjectDataSyncTests(unittest.TestCase):
    def test_export_includes_wal_and_restore_preserves_existing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live = root / "live.db"
            snapshot = root / "sync.db"
            other = root / "other.db"
            with sqlite3.connect(live) as database:
                database.execute("PRAGMA journal_mode=WAL")
                database.execute("CREATE TABLE nodes (id TEXT PRIMARY KEY)")
                database.execute("INSERT INTO nodes VALUES ('signal-1')")
                database.commit()
                export_data(live, snapshot)

            with sqlite3.connect(other) as database:
                database.execute("CREATE TABLE old_data (id INTEGER)")
                database.commit()
            restore_data(snapshot, other)
            with sqlite3.connect(other) as database:
                self.assertEqual(database.execute("SELECT id FROM nodes").fetchone()[0],
                                 "signal-1")
            self.assertTrue((root / "logic.before-restore.db").exists())

    def test_restore_refuses_database_with_wal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshot = root / "sync.db"
            live = root / "live.db"
            with sqlite3.connect(snapshot) as database:
                database.execute("CREATE TABLE nodes (id TEXT)")
            live.touch()
            (root / "live.db-wal").touch()
            with self.assertRaisesRegex(RuntimeError, "Stop the local server"):
                restore_data(snapshot, live)


if __name__ == "__main__":
    unittest.main()
