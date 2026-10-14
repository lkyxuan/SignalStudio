"""Real HTTP checks use an isolated SQLite DB; never shared production cards."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

ROOT = Path(__file__).resolve().parent.parent


class CardReviewHttpTest(unittest.TestCase):
    def test_new_card_material_review_history_conflicts_and_concurrency(self):
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1',0))
                port=sock.getsockname()[1]
            opener=build_opener(ProxyHandler({}))
            # Exercise the production Handler with a minimal model fixture. The
            # historical business migrations are unrelated to review routes and
            # cannot bootstrap a fresh graph (SS-84 rejects its predecessor).
            harness = r"""
import ast
from pathlib import Path
source=Path('server/app.py')
module=ast.parse(source.read_text())
module.body=[n for n in module.body if isinstance(n,(ast.Import,ast.ImportFrom,ast.ClassDef))]
namespace={'__name__':'review_http_fixture','__file__':str(source.resolve())}
exec(compile(module,str(source),'exec'),namespace)
exec("ROOT=Path.cwd()\nCONTRACT_REVISION='fixture'\nservice=GraphService(os.environ['SIGNALSTUDIO_DB'])\ncard_model=CardModel(service)\ncard_model.migrate()\nservice.db.commit()\ngraph_transport=GraphTransport()\nHTTPServer(('127.0.0.1',int(os.environ['PORT'])),Handler).serve_forever()",namespace)
"""
            process=subprocess.Popen([sys.executable,'-c',harness],cwd=ROOT,
                env={**os.environ,'PYTHONPATH':str(ROOT/'server'),'PORT':str(port),'SIGNALSTUDIO_DB':str(Path(directory)/'isolated.db')},
                stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            def request(path, data=None, revision=None, method=None):
                headers={'Content-Type':'application/json','X-Card-Model':'card-model.v1'}
                if data is not None:
                    headers['If-Match']=revision or request('/api/graph')['revision']
                req=Request(f'http://127.0.0.1:{port}'+path,headers=headers,
                    data=json.dumps(data).encode() if data is not None else None,method=method)
                with opener.open(req,timeout=10) as response:
                    return json.load(response)
            try:
                deadline=time.monotonic()+15
                while True:
                    try:
                        request('/api/desktop-health')
                        break
                    except OSError:
                        if process.poll() is not None or time.monotonic()>deadline:
                            self.fail('Isolated server failed to start')
                        time.sleep(.05)
                self.assertEqual(request('/api/card-reviews/schema')['version'],'card-review.v1')
                node=request('/api/nodes',{'name':'Review HTTP fixture','type':'Metric'})
                nid=node['id']
                graph=request('/api/graph')
                self.assertEqual(graph['card_progress'][nid]['status'],'unknown')
                material=request(f'/api/nodes/{nid}/review')
                self.assertEqual(material['node_id'],nid)
                self.assertIn('definitions',material)
                self.assertTrue(material['documentation'])
                payload={'schema_version':'card-review.v1','node_id':nid,
                    'definition_revision':material['definition_revision'],'package_revision':material['package_revision'],
                    'code_repository':'fixture/repository','code_revision':'a'*40,
                    'reporter_role':'implementer','reported_by':'fixture-builder','status':'pending_review',
                    'summary':'Isolated HTTP fixture only','evidence_ref':'fixture://http-suite',
                    'checks':[{'requirement':'fixture requirement','result':'pass','evidence_ref':'fixture://case'}],
                    'differences':[],'unverified_items':[],'base_implementation_report_id':None}
                implementation=request('/api/graph/reports',payload,graph['revision'])
                with self.assertRaises(HTTPError) as error:
                    request('/api/graph/reports',payload,graph['revision'])
                self.assertEqual(error.exception.code,409)
                self.assertEqual(request('/api/graph')['card_progress'][nid]['status'],'pending_review')
                audit={**payload,'reporter_role':'reviewer','reported_by':'fixture-auditor',
                    'status':'passed','implementation_report_id':implementation['id']}
                request('/api/graph/reports',audit)
                self.assertEqual(request('/api/graph')['card_progress'][nid]['status'],'passed')
                with self.assertRaises(HTTPError) as error:
                    request('/api/graph/reports',{**audit,'unverified_items':['not checked']})
                self.assertEqual(error.exception.code,400)
                request('/api/graph/reports',{**audit,'reported_by':'fixture-other-auditor','status':'mismatch','differences':['different result']})
                p=request('/api/graph')['card_progress'][nid]
                self.assertEqual(p['status'],'discussion')
                self.assertTrue(p['conflict'])
                self.assertEqual(len(request(f'/api/nodes/{nid}/reports')['reports']),3)
                request(f'/api/nodes/{nid}',{'formula':'changed fixture behavior'},method='PATCH')
                p=request('/api/graph')['card_progress'][nid]
                self.assertEqual(p['status'],'unknown')
                self.assertTrue(p['stale'])
                self.assertEqual(len(p['history']),3)
            finally:
                process.terminate()
                process.wait(timeout=10)


if __name__=='__main__':
    unittest.main()
