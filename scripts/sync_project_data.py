"""Copy the local project database to or from its Git-tracked snapshot."""

import argparse
import os
import shutil
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
LIVE_DB = ROOT / "data" / "logic.db"
SYNC_DB = ROOT / "data" / "logic.sync.db"


def check_integrity(path):
    with closing(sqlite3.connect(f"file:{path}?mode=ro", uri=True)) as database:
        if database.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError(f"SQLite integrity check failed: {path}")


def export_data(live=LIVE_DB, snapshot=SYNC_DB):
    """Take an online backup, including committed changes still in the WAL."""
    live, snapshot = Path(live), Path(snapshot)
    if not live.is_file():
        raise FileNotFoundError(f"No local database: {live}")
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=snapshot.parent) as directory:
        temporary = Path(directory) / "logic.db"
        with closing(sqlite3.connect(f"file:{live}?mode=ro", uri=True)) as source:
            with closing(sqlite3.connect(temporary)) as destination:
                source.backup(destination)
        with closing(sqlite3.connect(temporary)) as database:
            database.execute("PRAGMA journal_mode=DELETE")
        check_integrity(temporary)
        os.replace(temporary, snapshot)


def restore_data(snapshot=SYNC_DB, live=LIVE_DB):
    """Restore before starting the server; preserve the previous local DB."""
    snapshot, live = Path(snapshot), Path(live)
    if not snapshot.is_file():
        raise FileNotFoundError(f"No synced database: {snapshot}")
    if any(live.with_name(live.name + suffix).exists()
           for suffix in ("-wal", "-shm")):
        raise RuntimeError("Stop the local server before restoring the database")
    check_integrity(snapshot)
    live.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=live.parent) as directory:
        temporary = Path(directory) / "logic.db"
        shutil.copy2(snapshot, temporary)
        if live.exists():
            shutil.copy2(live, live.with_name("logic.before-restore.db"))
        os.replace(temporary, live)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("export", "restore"))
    args = parser.parse_args()
    if args.action == "export":
        export_data()
        print(f"Exported {SYNC_DB}")
    else:
        restore_data()
        print(f"Restored {LIVE_DB}")


if __name__ == "__main__":
    main()
