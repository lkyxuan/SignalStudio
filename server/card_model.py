"""Versioned graph definitions. This module never schedules or executes a graph.

Legacy rows remain authoritative for fields, lineage, prose and layout. New tables
describe their semantics without copying those identities into a second schema.
"""
import copy
import hashlib
import json
import math
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MODEL = json.loads((ROOT / 'catalog/card-model.v1.json').read_text())
COMPATIBILITY = json.loads((ROOT / 'catalog/card-runtime-compatibility.v1.json').read_text())
VERSION = MODEL['version']
KINDS = {item['id']: item for item in MODEL['kinds']}
RESOURCE = {'table', 'state'}
NAMESPACE = uuid.UUID('39d79ec8-5035-4e93-8c63-dd9ebce19c67')


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def package_digest(payload):
    semantic = copy.deepcopy(payload)
    semantic.pop('package_revision', None)
    graph = semantic.get('graph', {})
    graph.pop('presentation_revision', None)
    for node in graph.get('nodes', []):
        for key in ('position_x','position_y','updated_at'):
            node.pop(key, None)
    return digest(semantic)


def stable(*parts):
    return str(uuid.uuid5(NAMESPACE, ':'.join(map(str, parts))))


def positive(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value > 0


def legacy_reference(node):
    return next((int(ref) for ref,name in MODEL['migration']['expected_names'].items() if name == node['name']), None)


def infer_kind(node):
    override = MODEL['legacy_kind_overrides'].get(str(legacy_reference(node)))
    if override:
        return override
    if node['is_system_state'] or node['type'] in ('Ranking Table', 'Asset Registry', 'Rule Registry'):
        return 'table'
    if node['type'] == 'Source':
        return 'source'
    if node['type'] == 'Redpanda Topic':
        return 'channel'
    if node['type'] == 'Redis Window':
        return 'state'
    if node['type'] in ('Review Decision', 'Rule Evaluation', 'Asset Resolution'):
        return 'decision'
    return 'process'


def definition_refs(node):
    paths = MODEL['migration']['module_refs'].get(str(legacy_reference(node)), [])
    if infer_kind(node) == 'source':
        paths = ['source-contracts.v1.json']
    if infer_kind(node) == 'table':
        paths = ['business-tables.v1.json'] + paths
    result = []
    for path in dict.fromkeys(paths):
        file = ROOT / 'catalog' / path
        if not file.is_file():
            raise ValueError('Missing card definition: ' + path)
        result.append({'path': 'catalog/' + path, 'revision': hashlib.sha256(file.read_bytes()).hexdigest(),
                       'selector': {'reference_number': node['reference_number'], 'name': node['name']}})
    return result


def default_config(node, kind, migrated=False):
    ref = legacy_reference(node) if migrated else None
    refs = definition_refs(node) if migrated else []
    branches = []
    if kind == 'decision' and migrated and refs:
        names = {4001: ['matched', 'unmatched', 'conflict'], 4003: ['approve', 'hold', 'reject'],
                 3029: ['first', 'due', 'skip', 'wait', 'blocked']}.get(ref, [])
        branches = [{'id': key, 'condition': 'definition_refs', 'terminal': key in ('hold','reject','skip','wait','blocked')}
                    for key in names]
    return {'subtype': 'reference' if ref in (2037, 2038) else 'operation' if kind == 'source' else node['type'],
            'technology': 'redpanda' if kind == 'channel' else 'redis' if kind == 'state' else '',
            'environment': 'unspecified', 'definition_refs': refs,
            'action': {'id': ('source.' + node['name']) if kind == 'source' and migrated else ('module.' + str(ref)) if refs and kind in ('process','decision') else '',
                       'version': 1, 'implementation': 'unknown'},
            'profile': 'existing_module' if migrated else 'read_only_io' if kind == 'source' else
                       'manual_review' if kind == 'decision' else 'ordinary_process' if kind == 'process' else 'unresolved',
            'trigger': {'kind': 'unspecified', 'configuration_ref': refs[0] if refs else None},
            'join': {'mode': 'one_of' if ref == 3009 else 'merge'},
            'branches': branches, 'loop': None, 'idempotency': None,
            'resource': {} if not migrated else {'legacy_settings_ref':'node.notes'},
            'evidence': {'deployment': 'unknown', 'health': 'unknown', 'coverage': 'unknown', 'research_validity': 'unknown'},
            'draft': True, 'read_only': False}


class CardModel:
    def __init__(self, service):
        self.service, self.db = service, service.db

    def migrate(self):
        """Atomic additive migration; installers call it only after their own work.

        INSERT OR IGNORE is intentional: restarts and catalog installers may add
        missing definitions, but must never replace instance settings or bindings.
        """
        if self.db.in_transaction:
            raise ValueError('Card migration requires a transaction boundary')
        before = self.legacy_checksum()
        self.db.execute('BEGIN IMMEDIATE')
        try:
            statements = [
                '''CREATE TABLE IF NOT EXISTS node_contracts (
                   node_id TEXT PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
                   model_version TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL,
                   config TEXT NOT NULL)''',
                '''CREATE TABLE IF NOT EXISTS data_schemas (
                   id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                   version INTEGER NOT NULL, field_ids TEXT NOT NULL)''',
                '''CREATE TABLE IF NOT EXISTS node_ports (
                   id TEXT PRIMARY KEY, node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
                   key TEXT NOT NULL, direction TEXT NOT NULL CHECK(direction IN ('input','output')),
                   schema_id TEXT REFERENCES data_schemas(id) ON DELETE SET NULL,
                   UNIQUE(node_id,key,direction))''',
                '''CREATE TABLE IF NOT EXISTS edge_bindings (
                   id TEXT PRIMARY KEY, edge_id TEXT NOT NULL REFERENCES edges(id) ON DELETE CASCADE,
                   source_port_id TEXT NOT NULL REFERENCES node_ports(id) ON DELETE CASCADE,
                   target_port_id TEXT NOT NULL REFERENCES node_ports(id) ON DELETE CASCADE,
                   kind TEXT NOT NULL, branch TEXT NOT NULL DEFAULT '', config TEXT NOT NULL,
                   UNIQUE(edge_id,source_port_id,target_port_id,kind,branch))''',
                '''CREATE TABLE IF NOT EXISTS graph_definition_reports (
                   id TEXT PRIMARY KEY, package_revision TEXT NOT NULL, node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
                   report TEXT NOT NULL, created_at TEXT NOT NULL)''',
            ]
            for statement in statements:
                self.db.execute(statement)
            for node in self.service.graph()['nodes']:
                self.ensure_node(node, migrated=True)
            for edge in self.service.graph()['edges']:
                self.ensure_edge(edge, migrated=True)
            assert before == self.legacy_checksum(), 'Migration changed legacy rows'
            if self.db.execute('PRAGMA foreign_key_check').fetchall():
                raise ValueError('Migration foreign-key check failed')
            self.db.execute('INSERT OR IGNORE INTO schema_meta VALUES (?,?)', (VERSION, encoded({'legacy_checksum': before})))
            self.db.commit()
        except Exception:
            self.db.rollback()
            raise
        return {'model_version': VERSION, 'legacy_checksum': before,
                'nodes': self.db.execute('SELECT COUNT(*) FROM node_contracts').fetchone()[0],
                'bindings': self.db.execute('SELECT COUNT(*) FROM edge_bindings').fetchone()[0]}

    def legacy_checksum(self):
        return digest({name: [dict(row) for row in self.db.execute('SELECT * FROM ' + name + ' ORDER BY id')]
                       for name in ('nodes','edges','node_fields','edge_field_usages','data_requirements','signal_implementation_reports')})

    def enabled(self):
        return bool(self.db.execute("SELECT 1 FROM sqlite_master WHERE name='node_contracts'").fetchone())

    def ensure_node(self, node, kind=None, migrated=False):
        kind = kind or infer_kind(node)
        config = default_config(node, kind, migrated)
        self.db.execute('INSERT OR IGNORE INTO node_contracts VALUES (?,?,?,?,?)',
                        (node['id'], VERSION, kind, 1, encoded(config)))
        schema_id = stable(node['id'], 'fields')
        self.db.execute('INSERT OR IGNORE INTO data_schemas VALUES (?,?,?,?)',
                        (schema_id, node['id'], 1, '[]'))
        for direction, key in [('input','in'), ('output','out'), ('output','error')]:
            self.db.execute('INSERT OR IGNORE INTO node_ports VALUES (?,?,?,?,?)',
                            (stable(node['id'],direction,key),node['id'],key,direction,schema_id))
        actual = self.contract(node['id'])
        for branch in actual['config'].get('branches', []):
            self.db.execute('INSERT OR IGNORE INTO node_ports VALUES (?,?,?,?,?)',
                            (stable(node['id'],'branch',branch['id']),node['id'],'branch.'+branch['id'],'output',schema_id))

    def contract(self, node_id):
        row = self.db.execute('SELECT * FROM node_contracts WHERE node_id=?', (node_id,)).fetchone()
        if not row:
            raise ValueError('Card contract not found')
        result = dict(row)
        result['config'] = json.loads(result['config'])
        return result

    def relation(self, edge, migrated):
        source, target = (self.contract(edge[key])['kind'] for key in ('upstream_id','downstream_id'))
        if source in RESOURCE:
            return 'reference' if target in RESOURCE else 'read'
        if target in RESOURCE:
            return 'write'
        if target == 'channel':
            return 'publish'
        if source == 'channel':
            return 'consume'
        if source == 'decision':
            return 'control'
        return 'data'

    def ensure_edge(self, edge, migrated=False):
        if self.db.execute('SELECT 1 FROM edge_bindings WHERE edge_id=?', (edge['id'],)).fetchone():
            return
        kind = self.relation(edge, migrated)
        source_name = self.service.get_node(edge['upstream_id'])['name']
        target_name = self.service.get_node(edge['downstream_id'])['name']
        rule = next((r for r in MODEL['migration']['edge_rules'] if r['source']==source_name and r['target']==target_name), {}) if migrated else {}
        kind = rule.get('kind', kind)
        if not migrated and kind == 'control':
            kind = 'reference'  # A draft line cannot invent a decision route.
        branches = rule.get('branches', [])
        if not branches:
            branches = ['']
        for branch in branches:
            source_key = stable(edge['upstream_id'],'branch',branch) if branch else stable(edge['upstream_id'],'output','out')
            trigger = rule.get('trigger', 'event' if kind == 'consume' else 'none')
            config = {'trigger': trigger, 'completion': 'success', 'temporal_boundary': None,
                      'unresolved': ['meaning_missing'] if kind == 'reference' and not migrated else ['loader_missing'] if kind == 'reference' else []}
            self.add_binding(edge, {'kind': kind,'branch':branch,'source_port_id':source_key,
                                    'target_port_id':stable(edge['downstream_id'],'input','in'),'config':config}, validate=not migrated)
        if rule.get('handles_error'):
            self.add_binding(edge, {'kind':'error','source_port_id':stable(edge['upstream_id'],'output','error'),
                             'target_port_id':stable(edge['downstream_id'],'input','in'),
                             'config':{'trigger':'event','completion':'error','temporal_boundary':None,'unresolved':[]}}, validate=False)

    def add_binding(self, edge, data, validate=True):
        kind, branch = data.get('kind'), data.get('branch', '')
        config = data.get('config', {})
        if kind not in MODEL['relations'] or not isinstance(branch, str):
            raise ValueError('Invalid connection meaning')
        if not isinstance(config, dict) or config.get('trigger', 'none') not in ('none','event','change'):
            raise ValueError('Invalid connection trigger')
        if config.get('completion','success') not in ('success','error','completed'):
            raise ValueError('Invalid completion condition')
        ports = []
        for name, node, direction in [('source_port_id',edge['upstream_id'],'output'), ('target_port_id',edge['downstream_id'],'input')]:
            port = self.db.execute('SELECT * FROM node_ports WHERE id=?', (data.get(name),)).fetchone()
            if not port or port['node_id'] != node or port['direction'] != direction:
                raise ValueError('Port does not belong to this connection endpoint')
            ports.append(port)
        source, target = (self.contract(edge[key])['kind'] for key in ('upstream_id','downstream_id'))
        if validate:
            if self.contract(edge['upstream_id'])['config'].get('read_only') or self.contract(edge['downstream_id'])['config'].get('read_only'):
                raise ValueError('Unknown imported definitions are read-only')
            allowed = {'read':source in RESOURCE and target in ('process','decision','source'),
                       'write':target in RESOURCE and source in ('source','process'),
                       'publish':target == 'channel' and source in ('source','process','decision'),
                       'consume':source == 'channel' and target in ('process','decision'),
                       'control':source in ('process','decision') and target in ('process','decision'),
                       'data':source not in RESOURCE and target not in RESOURCE and source != 'channel' and target != 'channel',
                       'error':source in ('source','process','decision') and target in ('process','decision'), 'reference':True}
            if not allowed[kind]:
                raise ValueError('This connection meaning is invalid for these card types')
            if branch and (source != 'decision' or branch not in {item['id'] for item in self.contract(edge['upstream_id'])['config']['branches']}):
                raise ValueError('Unknown decision branch')
            if source == 'decision' and kind == 'control' and not branch:
                raise ValueError('Choose an explicit decision branch')
            if kind in ('read','reference') and config.get('trigger','none') == 'event':
                raise ValueError('A resource read is not an execution event')
            boundary = config.get('temporal_boundary')
            if boundary and (not isinstance(boundary,dict) or not all(boundary.get(key) for key in ('next_trigger','dedupe_key')) or not positive(boundary.get('deadline_seconds'))):
                raise ValueError('Temporal feedback needs a next trigger, dedupe key and deadline')
        identifier = stable(edge['id'], data['source_port_id'],data['target_port_id'],kind,branch)
        self.db.execute('INSERT INTO edge_bindings VALUES (?,?,?,?,?,?,?)',
                        (identifier,edge['id'],data['source_port_id'],data['target_port_id'],kind,branch,encoded(config)))
        if validate and self.cycles():
            self.db.execute('DELETE FROM edge_bindings WHERE id=?', (identifier,))
            raise ValueError('Immediate execution cycle; use a bounded action or explicit next-run boundary')
        return identifier

    def update_contract(self, node_id, data):
        old = self.contract(node_id)
        if old['config'].get('read_only'):
            raise ValueError('Unknown imported definitions are read-only')
        if data.get('model_version', VERSION) != VERSION or data.get('kind', old['kind']) != old['kind']:
            raise ValueError('Changing a card kind requires an explicit conversion')
        if data.get('revision') != old['revision']:
            raise ValueError('Card definition changed; reload before saving')
        config = copy.deepcopy(old['config'])
        config.update(data.get('config', {}))
        self.validate_config(config, old['kind'])
        if config['definition_refs'] != old['config']['definition_refs']:
            raise ValueError('Pinned module definitions cannot be replaced by instance edits')
        if config.get('evidence') != old['config'].get('evidence'):
            raise ValueError('Runtime evidence belongs in a report, not instance settings')
        branch_ids = {item['id'] for item in config['branches']}
        used = {row[0] for row in self.db.execute('SELECT b.branch FROM edge_bindings b JOIN edges e ON e.id=b.edge_id WHERE e.upstream_id=? AND b.branch!=""', (node_id,))}
        if not used <= branch_ids:
            raise ValueError('A connected decision branch cannot be removed')
        self.db.execute('UPDATE node_contracts SET revision=revision+1, config=? WHERE node_id=?', (encoded(config),node_id))
        self.ensure_node(self.service.get_node(node_id))
        return self.contract(node_id)

    def validate_config(self, config, kind):
        if not isinstance(config,dict) or not isinstance(config.get('subtype'),str) or not isinstance(config.get('technology'),str) or not isinstance(config.get('environment'),str):
            raise ValueError('Invalid card configuration')
        if config.get('profile') not in MODEL['profiles'] or not isinstance(config.get('trigger'),dict) or config['trigger'].get('kind') not in MODEL['triggers']:
            raise ValueError('Invalid execution defaults or trigger')
        trigger = config['trigger']
        if trigger['kind'] == 'schedule' and (not isinstance(trigger.get('interval_seconds'),(int,float)) or isinstance(trigger.get('interval_seconds'),bool) or trigger['interval_seconds'] <= 0):
            raise ValueError('Scheduled trigger needs a positive interval')
        join = config.get('join', {})
        if not isinstance(join,dict) or join.get('mode') not in MODEL['joins']:
            raise ValueError('Invalid input coordination')
        if join['mode'] == 'all' and (not isinstance(join.get('correlation_key'),str) or not join['correlation_key'].strip() or not positive(join.get('deadline_seconds'))):
            raise ValueError('Wait-all needs a correlation key and a deadline')
        branches = config.get('branches', [])
        if not isinstance(branches,list) or any(not isinstance(b,dict) or not isinstance(b.get('id'),str) or not b['id'] or not isinstance(b.get('condition'),str) for b in branches):
            raise ValueError('Decision branches need stable IDs and conditions')
        if len({b['id'] for b in branches}) != len(branches) or (kind != 'decision' and branches):
            raise ValueError('Invalid or duplicate decision branches')
        loop = config.get('loop')
        if loop and (kind != 'process' or not isinstance(loop,dict) or not isinstance(loop.get('max_iterations'),int) or isinstance(loop['max_iterations'],bool) or loop['max_iterations'] < 1 or not loop.get('exit_condition') or not positive(loop.get('deadline_seconds'))):
            raise ValueError('A loop needs a bounded process, exit condition and deadline')
        action = config.get('action')
        if not isinstance(action,dict) or not isinstance(action.get('id'),str) or not isinstance(action.get('version'),int) or action['version'] < 1 or action.get('implementation') not in ('unknown','planned','implemented','verified'):
            raise ValueError('Invalid action identity or implementation state')
        # Runtime claims are accepted only through evidence reports, never an editor.
        if action['implementation'] not in ('unknown','planned'):
            raise ValueError('Implementation evidence belongs in a runtime report')
        if not isinstance(config.get('definition_refs'),list) or not isinstance(config.get('draft'),bool) or config.get('read_only') is not False:
            raise ValueError('Invalid definition state')
        resource=config.get('resource',{})
        if not isinstance(resource,dict):
            raise ValueError('Resource settings must be an object')
        for key in ('topic','key_pattern','time_index','retention','dedupe_key','rebuild_from'):
            if key in resource and not isinstance(resource[key],str):
                raise ValueError('Resource setting must be text: '+key)
        if 'headers' in resource and (not isinstance(resource['headers'],list) or any(not isinstance(item,dict) or not isinstance(item.get('name'),str) for item in resource['headers'])):
            raise ValueError('Message headers must be a list of named definitions')
        if 'consumers' in resource and not isinstance(resource['consumers'],dict):
            raise ValueError('Message consumers must be an object')
        encoded(config)

    def action_registry(self):
        source_catalog = json.loads((ROOT/'catalog/source-contracts.v1.json').read_text())
        return [{'id':'module.'+ref,'version':1,'definition_paths':['catalog/'+path for path in paths],
                 'implementation':'unknown'} for ref,paths in MODEL['migration']['module_refs'].items()] + [
                {'id':'source.'+entry['id'],'version':1,'definition_paths':['catalog/source-contracts.v1.json'],
                 'implementation':'unknown'} for key in ('operations','resources') for entry in source_catalog[key]]

    def bindings(self):
        return [{**dict(row), 'config':json.loads(row['config'])} for row in self.db.execute('SELECT * FROM edge_bindings ORDER BY id')]

    def cycles(self):
        # Only execution events are ordered. Resource reads/writes never wait for
        # the resource to finish. Channels are not automatically a cycle boundary.
        adjacency = {}
        for row in self.db.execute('SELECT b.*,e.upstream_id,e.downstream_id FROM edge_bindings b JOIN edges e ON e.id=b.edge_id'):
            config = json.loads(row['config'])
            if (config.get('trigger','none') == 'none' and row['kind'] != 'publish') or config.get('temporal_boundary') or row['kind'] in ('read','write','reference'):
                continue
            adjacency.setdefault(row['upstream_id'],set()).add(row['downstream_id'])
        visiting, visited, result = set(), set(), []
        def visit(node):
            if node in visiting:
                result.append(node)
                return
            if node in visited:
                return
            visiting.add(node)
            for target in adjacency.get(node,()):
                visit(target)
            visiting.remove(node)
            visited.add(node)
        for node in adjacency:
            visit(node)
        return result

    def decorate(self, graph):
        if not self.enabled():
            return graph
        contracts = {row['node_id']: {**dict(row),'config':json.loads(row['config'])} for row in self.db.execute('SELECT * FROM node_contracts')}
        for node in graph['nodes']:
            contract = contracts.get(node['id'])
            node['kind'] = contract['kind'] if contract else infer_kind(node)
            node['card_contract'] = contract
        graph.update(model_version=VERSION, card_kinds=MODEL['kinds'], bindings=self.bindings(),
                     ports=[dict(row) for row in self.db.execute('SELECT * FROM node_ports ORDER BY id')],
                     data_schemas=[{**dict(row),'field_ids':[field['id'] for field in graph['fields'] if field['node_id']==row['node_id']]}
                                   for row in self.db.execute('SELECT * FROM data_schemas ORDER BY id')])
        return graph

    def readiness(self, node_ids=None):
        graph = self.decorate(self.service.graph())
        selected = set(node_ids) if node_ids is not None else {node['id'] for node in graph['nodes']}
        issues = []
        actions = {action['id'] for action in self.action_registry()}
        def issue(node, code, message):
            issues.append({'node_id':node,'code':code,'message_zh':message})
        for node in graph['nodes']:
            if node['id'] not in selected:
                continue
            contract = node['card_contract']
            if not contract or contract['model_version'] != VERSION or node['kind'] not in KINDS:
                issue(node['id'],'unknown_model','无法识别的定义保留为只读草稿。')
                continue
            config = contract['config']
            if node['kind'] in ('source','process','decision'):
                if not config['action']['id']:
                    issue(node['id'],'action_missing','处理动作尚未绑定。')
                elif config['action']['id'] not in actions:
                    issue(node['id'],'action_unknown','处理动作尚未登记，运行支持未知。')
                if config['trigger']['kind'] == 'unspecified' and not any(b['config'].get('trigger') in ('event','change') and e['downstream_id'] == node['id'] for b in graph['bindings'] for e in graph['edges'] if b['edge_id'] == e['id']):
                    issue(node['id'],'trigger_unspecified','执行触发尚未确认，不能从连线自动推断。')
            if node['kind'] == 'decision' and not config['branches']:
                issue(node['id'],'branches_missing','判断分支尚未定义。')
            if node['kind'] == 'decision':
                for branch in config['branches']:
                    if not branch.get('condition'):
                        issue(node['id'],'branch_condition_missing','判断分支的条件尚未定义。')
                    if not branch.get('terminal') and not any(b['branch']==branch['id'] and e['upstream_id']==node['id'] for b in graph['bindings'] for e in graph['edges'] if b['edge_id']==e['id']):
                        issue(node['id'],'branch_route_missing','判断分支尚未连接处理目标。')
            for ref in config['definition_refs']:
                file = ROOT / ref['path']
                if not file.is_file() or hashlib.sha256(file.read_bytes()).hexdigest() != ref['revision']:
                    issue(node['id'],'definition_changed','所属模块定义已变化，实例尚未审阅升级。')
            for difference in MODEL['migration']['known_differences']:
                if node['reference_number'] in difference['references']:
                    issue(node['id'],difference['code'],difference['message_zh'])
            if node['kind'] in RESOURCE | {'channel'} and not config.get('definition_refs') and not self.service.get_fields(node['id']):
                issue(node['id'],'schema_missing','数据结构尚未定义。')
        for binding in graph['bindings']:
            edge = next(e for e in graph['edges'] if e['id'] == binding['edge_id'])
            if (edge['upstream_id'] in selected or edge['downstream_id'] in selected) and binding['kind'] == 'reference':
                issue(edge['downstream_id'],'loader_missing' if 'loader_missing' in binding['config'].get('unresolved',[]) else 'meaning_missing',
                      '表到缓存仅有设计引用，缺少已确认的装载动作。' if 'loader_missing' in binding['config'].get('unresolved',[]) else '连接含义尚未确认。')
        for node in self.cycles():
            if node in selected:
                issue(node,'execution_cycle','存在没有明确下一轮边界的执行循环。')
        runtime_differences = [{**finding,'node_ids':[node['id'] for node in graph['nodes'] if node['id'] in selected and legacy_reference(node) in finding['references']]}
                               for finding in COMPATIBILITY['findings']]
        return {'structure':'incomplete' if issues else 'ready','issues':issues,
                'runtime_compatibility':{'adapter':'unverified','code_revision':COMPATIBILITY['code_revision'],
                                         'differences':[item for item in runtime_differences if item['node_ids']]},
                'implementation':'unknown','deployment':'unknown','health':'unknown','coverage':'unknown','research_validity':'unknown'}

    def package(self):
        from live_state import snapshot
        graph = snapshot(self.service)
        graph.pop('revision', None)
        definitions = {}
        for node in graph['nodes']:
            for ref in node['card_contract']['config']['definition_refs']:
                file = ROOT / ref['path']
                definitions[ref['path']] = {'revision':hashlib.sha256(file.read_bytes()).hexdigest(), 'body':json.loads(file.read_text())}
        payload = {'package_version':MODEL['package_version'],'model_version':VERSION,
                   'graph':graph,'definitions':definitions,'execution_profiles':MODEL['profiles'],
                   'action_registry':self.action_registry(),'compatibility_audit':COMPATIBILITY,
                   'readiness':self.readiness(),'runtime_owner':'few_understand'}
        payload['package_revision'] = package_digest(payload)
        return payload

    def report(self, data):
        """Evidence is an attributed observation, not a user-editable readiness flag."""
        from graph_service import now, uid
        package = self.package()
        if data.get('package_revision') != package['package_revision']:
            raise ValueError('Runtime report refers to an outdated definition package')
        node_id = data.get('node_id')
        if node_id:
            self.service.get_node(node_id)
        if not data.get('code_revision') or not data.get('evidence_ref'):
            raise ValueError('Runtime reports require code revision and evidence reference')
        allowed = {'implementation':{'unknown','planned','implemented','verified'},
                   'deployment':{'unknown','not_deployed','deployed'},'health':{'unknown','healthy','degraded','failed'},
                   'coverage':{'unknown','partial','complete'},'research_validity':{'unknown','unvalidated','validated','rejected'}}
        observations = data.get('observations')
        if not isinstance(observations,dict) or not observations or any(key not in allowed or value not in allowed[key] for key,value in observations.items()):
            raise ValueError('Invalid independent evidence dimensions')
        report = {**data,'reported_at':now(),'claims_are':'reported_observation_not_independent_verification'}
        identifier = uid()
        self.db.execute('INSERT INTO graph_definition_reports VALUES (?,?,?,?,?)',
                        (identifier,package['package_revision'],node_id,encoded(report),report['reported_at']))
        return {'id':identifier,**report}

    def import_package(self, data):
        """Merge identical IDs, reject conflicting IDs; quarantine unknown meanings.

        This does not replace the current graph and never activates an action. It
        runs inside the API's guarded transaction, so invalid imports are atomic.
        """
        from graph_service import uid, TYPES
        if not isinstance(data,dict):
            raise ValueError('Definition package must be an object')
        graph = data.get('graph', {})
        unknown = data.get('package_version') != MODEL['package_version'] or data.get('model_version') != VERSION
        if not unknown:
            if not isinstance(graph,dict) or not all(isinstance(graph.get(key),list) for key in ('nodes','edges','fields','field_usages','requirements','ports','bindings','data_schemas')):
                raise ValueError('Incomplete definition package')
            unknown = any(node.get('kind') not in KINDS or not node.get('card_contract') or node['card_contract'].get('model_version') != VERSION for node in graph['nodes'])
            unknown = unknown or any(node.get('type') not in TYPES for node in graph['nodes'])
            unknown = unknown or any(binding.get('kind') not in MODEL['relations'] for binding in graph['bindings'])
            known_actions = {'module.'+ref for ref in MODEL['migration']['module_refs']}
            source_catalog = json.loads((ROOT/'catalog/source-contracts.v1.json').read_text())
            known_actions.update('source.'+entry['id'] for key in ('operations','resources') for entry in source_catalog[key])
            unknown = unknown or any(node['card_contract']['config'].get('action',{}).get('id') not in known_actions | {''} for node in graph['nodes'])
        if unknown:
            title = str(data.get('title','未知模型导入'))[:120] + ' · ' + uid()[:8]
            node = self.service.create_node({'name':title,'kind':'process','definition':'无法识别的定义，原始内容已保留为只读草稿。'},commit=False)
            config = self.contract(node['id'])['config']
            config.update(read_only=True, original_package=data)
            self.db.execute('UPDATE node_contracts SET kind=?,model_version=?,config=? WHERE node_id=?',
                            ('unknown', str(data.get('model_version','unknown')),encoded(config),node['id']))
            return {'quarantined':True,'node_id':node['id']}
        if data.get('package_revision') != package_digest(data):
            raise ValueError('Definition package checksum mismatch')
        for collection in ('nodes','edges','fields','field_usages','requirements','ports','bindings','data_schemas'):
            identities = [row.get('id') for row in graph[collection]]
            if any(not isinstance(identifier,str) or not identifier.strip() for identifier in identities) or len(identities) != len(set(identities)):
                raise ValueError('Duplicate or missing import identity')
        for node in graph['nodes']:
            contract=node['card_contract']
            if contract.get('node_id') != node['id'] or contract.get('kind') != node['kind'] or not positive(contract.get('revision')) or not isinstance(contract['revision'],int):
                raise ValueError('Invalid imported card identity or revision')
            number=node.get('reference_number')
            if number is not None and (not isinstance(number,int) or not positive(number)):
                raise ValueError('Invalid imported reference number')
            if node.get('workflow_lane') not in ('shared','signal','knowledge') or any(node.get(key) not in (0,1) for key in ('is_system_state','is_catalog_source')):
                raise ValueError('Invalid imported card metadata')
        for schema in graph['data_schemas']:
            if not isinstance(schema.get('version'),int) or not positive(schema['version']) or not isinstance(schema.get('field_ids'),list):
                raise ValueError('Invalid imported schema version or fields')
        for port in graph['ports']:
            if not isinstance(port.get('key'),str) or not port['key'].strip() or port.get('direction') not in ('input','output'):
                raise ValueError('Invalid imported port')
        tables = [('nodes','nodes'),('edges','edges'),('fields','node_fields'),('field_usages','edge_field_usages'),('requirements','data_requirements')]
        inserted = {}
        for collection,table in tables:
            columns = [row[1] for row in self.db.execute('PRAGMA table_info('+table+')')]
            seen = set()
            inserted[collection] = 0
            for row in graph[collection]:
                if not isinstance(row,dict) or not row.get('id') or row['id'] in seen:
                    raise ValueError('Duplicate or missing import identity')
                seen.add(row['id'])
                values = {key:row[key] for key in columns if key in row}
                existing = self.db.execute('SELECT * FROM '+table+' WHERE id=?',(row['id'],)).fetchone()
                if existing:
                    comparable = {key:value for key,value in values.items() if key not in ('position_x','position_y','updated_at')}
                    if any(existing[key] != value for key,value in comparable.items()):
                        raise ValueError('Import conflicts with an existing identity: '+row['id'])
                    continue
                keys = list(values)
                self.db.execute('INSERT INTO '+table+' ('+','.join(keys)+') VALUES ('+','.join('?' for _ in keys)+')',tuple(values[key] for key in keys))
                inserted[collection] += 1
        for node in graph['nodes']:
            contract = node['card_contract']
            config = contract['config']
            self.validate_config(config,node['kind'])
            old = self.db.execute('SELECT * FROM node_contracts WHERE node_id=?',(node['id'],)).fetchone()
            if old and (old['kind'] != node['kind'] or old['config'] != encoded(config)):
                raise ValueError('Import conflicts with an existing card definition')
            self.db.execute('INSERT OR IGNORE INTO node_contracts VALUES (?,?,?,?,?)',
                            (node['id'],VERSION,node['kind'],contract['revision'],encoded(config)))
        for schema in graph['data_schemas']:
            if any(not self.db.execute('SELECT 1 FROM node_fields WHERE id=? AND node_id=?',(field,schema['node_id'])).fetchone() for field in schema['field_ids']):
                raise ValueError('Imported schema fields belong to another card')
            existing = self.db.execute('SELECT * FROM data_schemas WHERE id=?',(schema['id'],)).fetchone()
            if existing and (existing['node_id'] != schema['node_id'] or existing['version'] != schema['version']):
                raise ValueError('Import conflicts with an existing schema')
            self.db.execute('INSERT OR IGNORE INTO data_schemas VALUES (?,?,?,?)',(schema['id'],schema['node_id'],schema['version'],'[]'))
        for port in graph['ports']:
            if port['schema_id'] and not self.db.execute('SELECT 1 FROM data_schemas WHERE id=? AND node_id=?',(port['schema_id'],port['node_id'])).fetchone():
                raise ValueError('Imported port schema belongs to another card')
            existing = self.db.execute('SELECT * FROM node_ports WHERE id=?',(port['id'],)).fetchone()
            if existing and any(existing[key] != port[key] for key in existing.keys()):
                raise ValueError('Import conflicts with an existing port')
            self.db.execute('INSERT OR IGNORE INTO node_ports VALUES (?,?,?,?,?)',tuple(port[key] for key in ('id','node_id','key','direction','schema_id')))
        for binding in graph['bindings']:
            existing = self.db.execute('SELECT * FROM edge_bindings WHERE id=?',(binding['id'],)).fetchone()
            if existing:
                if any(existing[key] != (encoded(binding[key]) if key=='config' else binding[key]) for key in existing.keys()):
                    raise ValueError('Import conflicts with an existing binding')
                continue
            self.add_binding(self.service.get_edge(binding['edge_id']),binding)
        for usage in graph['field_usages']:
            edge = self.service.get_edge(usage['edge_id'])
            if self.service.get_field(usage['source_field_id'])['node_id'] != edge['upstream_id'] or (usage['target_field_id'] and self.service.get_field(usage['target_field_id'])['node_id'] != edge['downstream_id']):
                raise ValueError('Imported lineage crosses connection endpoints')
        if self.db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Import contains dangling references')
        # Reserve imported numbers so later creations cannot collide.
        for group in range(1,7):
            maximum = self.db.execute('SELECT MAX(reference_number) FROM nodes WHERE reference_number>=? AND reference_number<?',(group*1000,(group+1)*1000)).fetchone()[0]
            if maximum:
                self.db.execute('UPDATE schema_meta SET value=CAST(MAX(CAST(value AS INTEGER),?) AS TEXT) WHERE key=?',(maximum+1,'next_node_number_'+str(group)))
        for table,key in [('edges','next_edge_number'),('edge_field_usages','next_usage_number')]:
            maximum = self.db.execute('SELECT COALESCE(MAX(reference_number),0) FROM '+table).fetchone()[0]
            self.db.execute('UPDATE schema_meta SET value=CAST(MAX(CAST(value AS INTEGER),?) AS TEXT) WHERE key=?',(maximum+1,key))
        return {'quarantined':False,'inserted':inserted}
