import copy
import tempfile
import unittest
from pathlib import Path
from table_backfill_store import TableBackfillStore, validate


def snapshot():
    return {'version': 1, 'evidence_kind': 'database_snapshot',
            'source': {'system': 'fewunderstand', 'environment': 'test-fixture', 'location': 'asset_score.current_score', 'captured_at': '2026-10-08T02:00:00Z'},
            'field_mapping': {'asset_id': 'id', 'asset_name': None, 'score_key': 'metric', 'score_value': 'value', 'calculated_at': 'at'},
            'source_rows': [{'id': 'asset-a', 'metric': 'total_heat', 'value': 50.00001, 'at': '2026-10-08T01:00:00Z'}],
            'expected_rows': [{'asset_id': 'asset-a', 'score_key': 'total_heat', 'score_value': 50, 'calculated_at': '2026-10-08T09:00:00+08:00'}]}


class TableBackfillStoreTest(unittest.TestCase):
    def test_mapping_precision_and_comparison_at_equivalent_times(self):
        result = validate(snapshot())
        self.assertIsNone(result['rows'][0]['asset_name'])
        self.assertEqual(result['rows'][0]['score_value'], 50.00001)
        self.assertEqual(result['comparisons'][0]['status'], 'different')
        self.assertAlmostEqual(result['comparisons'][0]['delta'], 0.00001)
        payload = snapshot()
        payload['expected_rows'][0]['score_value'] = 50.00001
        self.assertEqual(validate(payload)['comparisons'][0]['status'], 'matched')

    def test_different_times_are_not_compared(self):
        payload = snapshot()
        payload['expected_rows'][0]['calculated_at'] = '2026-10-08T02:00:00Z'
        result = validate(payload)['comparisons'][0]
        self.assertEqual(result['status'], 'different_time')
        self.assertIsNone(result['delta'])

    def test_missing_expectations_and_missing_actual_rows(self):
        payload = snapshot()
        payload['expected_rows'][0]['asset_id'] = 'absent'
        result = validate(payload)
        self.assertEqual(result['comparisons'][0]['status'], 'not_compared')
        self.assertEqual(result['unmatched_expected_count'], 1)

    def test_rejects_missing_provenance_invalid_values_and_duplicate_keys(self):
        for mutate in [lambda p: p['source'].pop('environment'),
                       lambda p: p['source'].update(captured_at='2026-10-08T00:00:00'),
                       lambda p: p['source_rows'][0].update(value=float('nan')),
                       lambda p: p['source_rows'][0].update(value=True),
                       lambda p: p['source_rows'][0].update(metric='attention_score'),
                       lambda p: p['source_rows'][0].pop('at'),
                       lambda p: p['source_rows'].append(copy.deepcopy(p['source_rows'][0])),
                       lambda p: p.update(evidence_kind='offline_replay')]:
            payload = snapshot()
            mutate(payload)
            with self.assertRaises(ValueError):
                validate(payload)

    def test_validated_snapshot_persists_and_bad_import_preserves_existing(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            store = TableBackfillStore(path)
            self.assertIsNone(store.read()['snapshot'])
            store.save(snapshot())
            self.assertEqual(TableBackfillStore(path).read()['snapshot'], snapshot())
            invalid = snapshot()
            invalid['source_rows'] = []
            with self.assertRaises(ValueError):
                store.save(invalid)
            self.assertEqual(store.read()['snapshot'], snapshot())


if __name__ == '__main__':
    unittest.main()
