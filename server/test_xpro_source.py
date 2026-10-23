import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from card_model import CardModel
from graph_service import GraphService
from xpro_source import ensure_xpro_source, MARKER, PATH, ROOT


class XproSourceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        CardModel(self.service).migrate()
        self.spec = json.loads((ROOT / PATH).read_text())

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_only_one_source_no_flow_preserves_graph_and_is_idempotent(self):
        self.service.create_node({'name': 'existing', 'kind': 'source', 'position_x': 15, 'position_y': 30})
        before = copy.deepcopy(self.service.graph())
        ensure_xpro_source(self.service)
        graph = self.service.graph()
        self.assertEqual(len(graph['nodes']), len(before['nodes']) + 1)
        self.assertEqual(graph['edges'], before['edges'])
        self.assertEqual(next(n for n in graph['nodes'] if n['name'] == 'existing'), before['nodes'][0])
        node = next(n for n in graph['nodes'] if n['name'] == self.spec['name'])
        config = CardModel(self.service).contract(node['id'])['config']
        self.assertEqual(node['kind'], 'source')
        self.assertEqual(config['action']['id'], '')
        self.assertFalse(config['resource']['runtime_enabled'])
        self.assertIsNone(config['resource']['physical_binding'])
        self.assertEqual({f['name'] for f in self.service.get_fields(node['id'])}, {f['path'] for f in self.spec['fields']})
        before_restart = CardModel(self.service).package()
        ensure_xpro_source(self.service)
        self.assertEqual(CardModel(self.service).package(), before_restart)

    def test_collision_and_interrupted_install_do_not_leave_partial_cards(self):
        before = CardModel(self.service).package()
        with patch.object(self.service, 'create_field', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):
                ensure_xpro_source(self.service)
        self.assertEqual(CardModel(self.service).package(), before)
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        self.service.create_node({'name': self.spec['name'], 'kind': 'process'})
        before = CardModel(self.service).package()
        with self.assertRaisesRegex(ValueError, 'conflict'):
            ensure_xpro_source(self.service)
        self.assertEqual(CardModel(self.service).package(), before)

    def test_fields_match_pinned_upstream_schema_including_types_and_nulls(self):
        schema = json.loads((ROOT / 'catalog/xpro-feed-event.schema.json').read_text())
        expected = {}

        def walk(value, prefix):
            if '$ref' in value:
                value = schema['$defs'][value['$ref'].split('/')[-1]]
            if value.get('type') == 'object':
                for name, child in value['properties'].items():
                    walk(child, prefix + '.' + name)
            else:
                expected[prefix] = value

        walk(schema['$defs']['tweet'], 'data')
        for name, value in schema['properties'].items():
            if name != 'data':
                expected[name] = value
        fields = {f['path']: f for f in self.spec['fields']}
        self.assertEqual(set(fields), set(expected))
        for path, value in expected.items():
            field = fields[path]
            native = value.get('type', 'integer' if type(value.get('const')) is int else 'string' if 'enum' in value else None)
            self.assertEqual(field['nullable'], isinstance(native, list) and 'null' in native)
            self.assertEqual(field['type'], ' | '.join(native) if isinstance(native, list) else 'array<string>' if native == 'array' else native)
        self.assertEqual(fields['data.metrics.views']['type'], 'string | null')


if __name__ == '__main__':
    unittest.main()
