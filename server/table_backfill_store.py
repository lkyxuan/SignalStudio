"""Git-synced fixed snapshots for #1006; never connects to or writes a source database."""
import json
import math
import os
from datetime import datetime
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parent.parent / 'data' / 'table-1006-backfill.json'
FIELDS = ('asset_id', 'asset_name', 'score_key', 'score_value', 'calculated_at')


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('A timestamp with UTC offset is required')
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise ValueError('Invalid timestamp') from None
    if parsed.tzinfo is None:
        raise ValueError('Timestamp must include a UTC offset')
    return value


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('score_value must be a finite number')
    return value


def validate(payload):
    if not isinstance(payload, dict) or type(payload.get('version')) is not int or payload.get('version') != 1:
        raise ValueError('Expected snapshot version 1')
    source = payload.get('source')
    if not isinstance(source, dict) or any(not isinstance(source.get(k), str) or not source[k].strip()
                                          for k in ('system', 'environment', 'location')):
        raise ValueError('Source system, environment and location are required')
    timestamp(source.get('captured_at'))
    if payload.get('evidence_kind') not in ('database_snapshot', 'offline_replay'):
        raise ValueError('evidence_kind must be database_snapshot or offline_replay')
    if payload['evidence_kind'] == 'offline_replay' and (not isinstance(payload.get('derivation_ref'), str) or not payload['derivation_ref'].strip()):
        raise ValueError('Offline replay requires a derivation_ref for its inputs and rules')
    mapping = payload.get('field_mapping')
    if not isinstance(mapping, dict) or set(mapping) != set(FIELDS):
        raise ValueError('field_mapping must specify all five #1006 fields')
    for field, origin in mapping.items():
        if not isinstance(origin, str) or not origin.strip():
            if field != 'asset_name' or origin is not None:
                raise ValueError('Mapping must name a source field; asset_name may be null')
    raw_rows = payload.get('source_rows')
    if not isinstance(raw_rows, list) or not 1 <= len(raw_rows) <= 200:
        raise ValueError('Import between 1 and 200 source rows')
    rows, keys = [], set()
    for raw in raw_rows:
        if not isinstance(raw, dict):
            raise ValueError('Each source row must be an object')
        row = {}
        for field, origin in mapping.items():
            if origin is not None and origin not in raw:
                raise ValueError(f'Missing source field: {origin}')
            row[field] = raw[origin] if origin is not None else None
        if not isinstance(row['asset_id'], str) or not row['asset_id'].strip():
            raise ValueError('asset_id is required')
        if row['asset_name'] is not None and not isinstance(row['asset_name'], str):
            raise ValueError('asset_name must be a string or null')
        if row['score_key'] != 'total_heat':
            raise ValueError('Only total_heat can be mapped to this demo table')
        finite(row['score_value'])
        timestamp(row['calculated_at'])
        key = (row['asset_id'], row['score_key'])
        if key in keys:
            raise ValueError('Duplicate asset_id + score_key')
        keys.add(key)
        rows.append(row)
    expectations = payload.get('expected_rows', [])
    if not isinstance(expectations, list) or len(expectations) > 200:
        raise ValueError('expected_rows must be a list of up to 200 rows')
    expected = {}
    for row in expectations:
        if not isinstance(row, dict) or not isinstance(row.get('asset_id'), str) or row.get('score_key') != 'total_heat':
            raise ValueError('Expected rows require asset_id and total_heat score_key')
        finite(row.get('score_value'))
        timestamp(row.get('calculated_at'))
        key = (row['asset_id'], row['score_key'])
        if key in expected:
            raise ValueError('Duplicate expected key')
        expected[key] = row
    comparisons = []
    for row in rows:
        target = expected.get((row['asset_id'], row['score_key']))
        same_time = target is not None and datetime.fromisoformat(target['calculated_at'].replace('Z', '+00:00')) == datetime.fromisoformat(row['calculated_at'].replace('Z', '+00:00'))
        delta = row['score_value'] - target['score_value'] if same_time else None
        comparisons.append({'asset_id': row['asset_id'], 'expected_score': target['score_value'] if target else None,
                            'delta': delta, 'status': 'not_compared' if target is None else 'different_time' if not same_time
                            else 'matched' if math.isclose(row['score_value'], target['score_value'], rel_tol=1e-12, abs_tol=1e-12) else 'different'})
    return {'snapshot': payload, 'rows': rows, 'comparisons': comparisons,
            'unmatched_expected_count': sum(key not in keys for key in expected)}


class TableBackfillStore:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get('SIGNALSTUDIO_BACKFILL_PATH') or DEFAULT_PATH)

    def read(self):
        return validate(json.loads(self.path.read_text())) if self.path.exists() else {'snapshot': None, 'rows': [], 'comparisons': [], 'unmatched_expected_count': 0}

    def save(self, payload):
        result = validate(payload)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix('.tmp')
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
        temporary.replace(self.path)
        return result
