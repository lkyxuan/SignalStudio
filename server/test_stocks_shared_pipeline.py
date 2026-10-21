import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from card_model import CardModel
from graph_service import GraphService
from stocks_shared_pipeline import ensure_stocks_shared_pipeline, MARKER, PATH


class StocksSharedPipelineTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        CardModel(self.service).migrate()
        self.spec = json.loads((Path(__file__).resolve().parent.parent / PATH).read_text())
        self.nodes = [self.service.create_node({'name': step['name'],
                      'kind': 'source' if i == 0 else 'channel' if i in (1, 4) else 'process',
                      'position_x': i * 500, 'position_y': 100})
                      for i, step in enumerate(self.spec['steps'])]
        for a, b in zip(self.nodes[1:], self.nodes[2:]):
            self.service.create_edge({'upstream_id': a['id'], 'downstream_id': b['id']})

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_only_adds_design_reference_and_local_displays_without_changing_shared_contracts(self):
        before = copy.deepcopy(self.service.graph())
        ensure_stocks_shared_pipeline(self.service)
        after = self.service.graph()
        self.assertEqual(len(before['nodes']), len(after['nodes']))
        self.assertEqual(len(before['edges']) + 1, len(after['edges']))
        for old in before['nodes']:
            new = next(n for n in after['nodes'] if n['id'] == old['id'])
            for key, value in old.items():
                if key not in ('display_positions', 'card_contract'):
                    self.assertEqual(value, new[key])
            for key, value in old['display_positions'].items():
                self.assertEqual(value, new['display_positions'][key])
            if old['id'] != self.nodes[0]['id']:
                self.assertEqual(old['card_contract'], new['card_contract'])
        for old in before['edges']:
            self.assertEqual(old, next(e for e in after['edges'] if e['id'] == old['id']))
        for old in before['bindings']:
            self.assertEqual(old, next(b for b in after['bindings'] if b['id'] == old['id']))
        added = [b for b in after['bindings'] if b['id'] not in {b['id'] for b in before['bindings']}]
        self.assertEqual(len(added), 1)
        self.assertEqual(added[0]['kind'], 'reference')
        self.assertEqual(added[0]['config']['trigger'], 'none')
        self.assertEqual(sum(len(n['display_positions']) for n in after['nodes']) -
                         sum(len(n['display_positions']) for n in before['nodes']), 5)
        self.assertIn(PATH, CardModel(self.service).package()['definitions'])
        ensure_stocks_shared_pipeline(self.service)
        self.assertEqual(after, self.service.graph())

    def test_transaction_failure_and_missing_shared_link_preserve_everything(self):
        before = CardModel(self.service).package()
        with patch.object(CardModel, 'add_binding', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):
                ensure_stocks_shared_pipeline(self.service)
        self.assertEqual(before, CardModel(self.service).package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        self.service.db.execute('DELETE FROM edges')
        self.service.db.commit()
        before = CardModel(self.service).package()
        with self.assertRaisesRegex(ValueError, 'existing shared link'):
            ensure_stocks_shared_pipeline(self.service)
        self.assertEqual(before, CardModel(self.service).package())
