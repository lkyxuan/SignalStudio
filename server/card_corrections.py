"""SS-98: guarded, atomic Studio copy/layout correction and legacy candidate removal."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
MARKER = 'studio_card_corrections_ss98_v1'
ACTOR = 'ss98-card-corrections'

def load(path):
    return json.loads((ROOT / path).read_text())

def ensure_card_corrections(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_hottest_z_v1'").fetchone():
        return
    expected = load('server/migration_snapshots/card-corrections-before-ss98.json')
    home = load('catalog/homepage-layout.v1.json')['interface']
    market = load('catalog/market-current.v1.json')
    rollup = load('catalog/score-rollup.v1.json')['node']
    polars = load('catalog/polars-indicator-current.v1.json')
    hottest = load('catalog/coingecko-hottest.v1.json')
    updates = {
        7003: {'definition':home['purpose_zh'], 'caveats':'两行三列：中间两格信号、两边四榜；第四榜来源与具体格位待绑定，API未核验。'},
        1014: {'definition':next(n['description'] for n in market['nodes'] if n['key']=='coverage'),
               'caveats':'FEW-78报告测试网接入；实现依据见 https://app.notion.com/p/3f8038a63d5a8116a774f712a616d8ca 。运行健康、完整覆盖与生产接入不由此确认。'},
        3005: {k:rollup[k] for k in ('formula','caveats')},
        3040: {'formula':next(n['formula'] for n in polars['cards'] if n['name']==expected['nodes']['3040']['name'])},
        3049: {'formula':next(n['algorithm_zh'] for n in hottest['cards'] if n['key']=='rvol')},
    }
    db.execute('BEGIN IMMEDIATE')
    try:
        model = CardModel(service)
        nodes = {}
        for ref, changes in updates.items():
            row = db.execute('SELECT * FROM nodes WHERE reference_number=?', (ref,)).fetchone()
            if not row:
                raise ValueError('SS-98 missing card #' + str(ref))
            node = dict(row); nodes[ref] = node
            old = expected['nodes'][str(ref)]
            # Copy only the fields approved here; user positions and unrelated settings survive.
            if node['name'] != old['name'] or any(node[k] not in (old[k], v) for k,v in changes.items()):
                raise ValueError('SS-98 edited card #' + str(ref))
        candidate = db.execute('SELECT * FROM nodes WHERE reference_number=3001').fetchone()
        if candidate:
            candidate = dict(candidate); old = expected['nodes']['3001']
            if any(candidate[k] != v for k,v in old.items()):
                raise ValueError('SS-98 edited legacy candidate')
            fields = [{k:f[k] for k in ('name','data_type','definition')} for f in db.execute('SELECT * FROM node_fields WHERE node_id=? ORDER BY name',(candidate['id'],))]
            cfg = model.contract(candidate['id'])['config']
            if fields != expected['candidate_fields'] or any(cfg.get(k)!=v for k,v in expected['candidate_config'].items()):
                raise ValueError('SS-98 edited legacy fields or contract')
            edges = db.execute('SELECT e.*,a.reference_number AS source_ref FROM edges e JOIN nodes a ON a.id=e.upstream_id WHERE e.upstream_id=? OR e.downstream_id=?', (candidate['id'],candidate['id'])).fetchall()
            if len(edges)!=1 or edges[0]['source_ref']!=5004 or edges[0]['downstream_id']!=candidate['id']:
                raise ValueError('SS-98 new legacy candidate dependency')
            for row in db.execute('SELECT node_id,config FROM node_contracts WHERE node_id!=?',(candidate['id'],)):
                cfg = json.loads(row['config'])
                consumers = cfg.get('resource',{}).get('consumers',{})
                source = db.execute('SELECT reference_number FROM nodes WHERE id=?',(row['node_id'],)).fetchone()
                if source[0]==5004 and consumers.get(candidate['name'])=='signalstudio.coingecko_market_turnover_candidate':
                    del consumers[candidate['name']]
                    db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',(encoded(cfg),row['node_id']))
                if candidate['id'] in encoded(cfg) or candidate['name'] in encoded(cfg):
                    raise ValueError('SS-98 hidden legacy candidate dependency')
        revisions = {p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in expected['digests']}
        for row in db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config']); changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj,dict):
                    path = obj.get('path')
                    if path in revisions and 'revision' in obj:
                        # Only known pre-batch pins; unrelated historical revisions remain explicit.
                        if obj['revision'] == expected['digests'][path]:
                            obj['revision'] = revisions[path]; changed = True
                    for value in obj.values():refresh(value)
                elif isinstance(obj,list):
                    for value in obj:refresh(value)
            refresh(cfg)
            if row['node_id']==nodes[7003]['id']:
                old_ui=cfg.get('interface',{})
                if old_ui not in (expected['homepage_interface'],home):
                    raise ValueError('SS-98 edited homepage interface')
                cfg['interface']=home; changed=True
            if changed:
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',(encoded(cfg),row['node_id']))
        for ref,changes in updates.items():
            node=nodes[ref]
            db.execute('UPDATE nodes SET '+','.join(k+'=?' for k in changes)+',updated_at=? WHERE id=?',(*changes.values(),now(),node['id']))
            service._event(ACTOR,'update','node',node['id'],before=node,after=service.get_node(node['id']))
        if candidate:
            service._event(ACTOR,'delete','node',candidate['id'],before=candidate)
            db.execute('DELETE FROM nodes WHERE id=?',(candidate['id'],))
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('SS-98 invalid foreign keys')
        db.execute('INSERT INTO schema_meta VALUES (?,?)',(MARKER,'1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
