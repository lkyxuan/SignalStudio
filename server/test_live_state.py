import sqlite3
import tempfile
import unittest
from pathlib import Path
from graph_service import GraphService
from live_state import guard, snapshot, RevisionConflict


class LiveStateTest(unittest.TestCase):
    def test_other_connection_cannot_be_silently_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'graph.db'
            service = GraphService(path)
            node = service.create_node({'name': 'Conflict fixture', 'type': 'Metric'})
            before = snapshot(service)
            self.assertEqual(before['revision'], snapshot(service)['revision'])
            external = sqlite3.connect(path, timeout=0.01)
            external.execute('UPDATE nodes SET definition=? WHERE id=?', ('external', node['id']))
            external.commit()
            with self.assertRaises(RevisionConflict):
                guard(service, before['revision'])
            self.assertEqual(service.get_node(node['id'])['definition'], 'external')
            guard(service, snapshot(service)['revision'])
            with self.assertRaises(sqlite3.OperationalError):
                external.execute('UPDATE nodes SET definition=? WHERE id=?', ('racing writer', node['id']))
            external.rollback()
            service.update_node(node['id'], {'notes': 'local edit'})
            self.assertEqual(service.get_node(node['id'])['definition'], 'external')
            self.assertEqual(service.get_node(node['id'])['notes'], 'local edit')
            self.assertNotEqual(snapshot(service, 'contract-a')['revision'], snapshot(service, 'contract-b')['revision'])
            external.close(); service.db.close()
