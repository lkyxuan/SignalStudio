"""SS-82: acknowledge only the two known, approved SS-80 path replacements.

Do not turn this into a generic digest refresher: unknown changes must remain visible.
"""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded

ROOT = Path(__file__).resolve().parent.parent
MARKER = 'repair_discovery_digests_v1'
# Freeze both ends so a future catalog edit cannot be silently accepted on restart.
REPAIRS = {
    'catalog/market-current.v1.json': (
        '0cf57ccd0bad81da5140a9c9cb853485ecd8ed2fe8377a310a89fd8ad35542c3',
        'dbd2ddec8cfd49958e2b3ceb94748a2d1ec37ced970c24d88757616309b9d8dc'),
    'catalog/polars-indicator-current.v1.json': (
        'dfd8c4cefc170c695d09491f85ce7049d66813f23a3ed3c3fe7e66c348b9d858',
        'd8f0bbd32021ed4e56885b69ad33a44b58f17561a06d2fac3b19bcd7c3475682'),
}


def repaired_config(value, paths):
    if isinstance(value, list):
        return [repaired_config(item, paths) for item in value]
    if isinstance(value, dict):
        result = {key: repaired_config(item, paths) for key, item in value.items()}
        pair = REPAIRS.get(value.get('path'))
        if pair and value.get('revision') == pair[0]:
            result['revision'] = pair[1]
            paths.add(value['path'])
        return result
    return value


def ensure_repair_discovery_digests(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='retire_market_discovery_v1'").fetchone():
        return
    model = CardModel(service)
    # Include hidden cards; the scoped UI graph is not the migration inventory.
    db.execute('BEGIN IMMEDIATE')
    try:
        updates, paths = [], set()
        for row in db.execute('SELECT node_id,kind,config FROM node_contracts').fetchall():
            before = json.loads(row['config'])
            after = repaired_config(before, paths)
            if after != before:
                if before.get('read_only'):
                    raise ValueError('Digest repair: protected contract ' + row['node_id'])
                model.validate_config(after, row['kind'])
                updates.append((encoded(after), row['node_id']))
        for path in paths:
            if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != REPAIRS[path][1]:
                raise ValueError('Digest repair: approved target changed: ' + path)
        db.executemany('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', updates)
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
