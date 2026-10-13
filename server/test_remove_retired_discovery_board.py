import unittest

from card_model import encoded
from new_uuid_board import ensure_new_uuid_board
from remove_retired_discovery_board import ensure_remove_retired_discovery_board, MARKER
import test_new_uuid_board


class RemoveRetiredBoardTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_new_uuid_board.NewUuidBoardTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_new_uuid_board(self.s)
        self.old = self.s.find_name('leaderboard_emerging')

    def tearDown(self):
        self.fixture.tearDown()

    def test_only_placeholder_and_owned_metadata_removed(self):
        before = self.fixture.snapshot()
        ensure_remove_retired_discovery_board(self.s)
        after = self.fixture.snapshot()
        owned = {'nodes': 'id', 'node_contracts': 'node_id', 'node_ports': 'node_id', 'data_schemas': 'node_id'}
        for table, rows in before.items():
            if table in ('schema_meta', 'change_events'):
                continue
            if table in owned:
                columns = [r[1] for r in self.s.db.execute('PRAGMA table_info(' + table + ')')]
                index = columns.index(owned[table])
                rows = [r for r in rows if r[index] != self.old['id']]
            self.assertEqual(rows, after[table], table)
        self.assertIsNone(self.s.find_name('leaderboard_emerging'))
        self.assertIsNotNone(self.s.find_name('生成新发现榜'))
        self.assertIsNotNone(self.s.find_name('leaderboard_new_uuid'))
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertNotIn(self.old['id'], {n['id'] for n in self.fixture.model.package()['graph']['nodes']})
        ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(after, self.fixture.snapshot())

    def test_new_edge_blocks_without_mutation(self):
        self.s.create_edge({'upstream_id': self.old['id'],
                            'downstream_id': self.s.find_name('候选代币筛选')['id']})
        before = self.fixture.snapshot()
        with self.assertRaisesRegex(ValueError, 'new dependency'):
            ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())

    def test_modified_or_protected_contract_blocks(self):
        cfg = self.fixture.model.contract(self.old['id'])['config']
        cfg['read_only'] = True
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), self.old['id']))
        self.s.db.commit()
        before = self.fixture.snapshot()
        with self.assertRaisesRegex(ValueError, 'edited or protected'):
            ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())

    def test_field_and_contract_reference_block(self):
        self.s.db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (self.old['id'],))
        self.s.db.commit()
        self.s.create_field(self.old['id'], {'name': 'new_user_field'})
        before = self.fixture.snapshot()
        with self.assertRaisesRegex(ValueError, 'new fields'):
            ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())

    def test_reference_without_edge_blocks(self):
        new = self.s.find_name('leaderboard_new_uuid')
        cfg = self.fixture.model.contract(new['id'])['config']
        cfg['resource']['user_dependency'] = self.old['id']
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), new['id']))
        self.s.db.commit()
        before = self.fixture.snapshot()
        with self.assertRaisesRegex(ValueError, 'contract dependency'):
            ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())

    def test_historical_reports_preserved_with_original_json(self):
        report = encoded({'node_id': self.old['id'], 'observations': {'implementation': 'mismatch'}})
        self.s.db.execute('INSERT INTO graph_definition_reports VALUES (?,?,?,?,?)',
                          ('historical-report', 'historical-package', self.old['id'], report, '2026-10-10'))
        self.s.db.commit()
        ensure_remove_retired_discovery_board(self.s)
        row = self.s.db.execute('SELECT * FROM graph_definition_reports WHERE id=?', ('historical-report',)).fetchone()
        self.assertIsNone(row['node_id'])
        self.assertEqual(row['report'], report)

    def test_interruption_after_delete_rolls_back_cascades_and_audit(self):
        before = self.fixture.snapshot()
        self.s.db.execute("CREATE TRIGGER interrupt_removal BEFORE INSERT ON schema_meta "
                          "WHEN NEW.key='" + MARKER + "' BEGIN SELECT RAISE(ABORT,'interrupted'); END")
        self.s.db.commit()
        with self.assertRaisesRegex(Exception, 'interrupted'):
            ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())

    def test_absent_placeholder_and_prerequisite(self):
        self.s.db.execute('DELETE FROM schema_meta WHERE key=?', ('new_uuid_board_v1',))
        self.s.db.commit()
        before = self.fixture.snapshot()
        ensure_remove_retired_discovery_board(self.s)
        self.assertEqual(before, self.fixture.snapshot())
        self.s.db.execute('INSERT INTO schema_meta VALUES (?,?)', ('new_uuid_board_v1', '1'))
        self.s.db.execute('DELETE FROM nodes WHERE id=?', (self.old['id'],))
        self.s.db.commit()
        ensure_remove_retired_discovery_board(self.s)
        self.assertTrue(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())


if __name__ == '__main__':
    unittest.main()
