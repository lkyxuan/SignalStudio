"""Append-only, version-pinned Agent reports. Roles are claims, not authentication."""
import json
import re
from card_model import ROOT

STANDARD = json.loads((ROOT / 'catalog/card-review.v1.json').read_text())
STATUSES = {item['id'] for item in STANDARD['statuses']}


def history(model, node_id):
    model.service.get_node(node_id)
    return [{**json.loads(row['report']), 'id': row['id']} for row in model.db.execute(
        'SELECT * FROM graph_definition_reports WHERE node_id=? ORDER BY created_at, rowid', (node_id,))]


def validate(model, data, revision):
    if data.get('schema_version') != STANDARD['version']:
        raise ValueError('Unsupported review schema_version')
    for key in ('node_id', 'definition_revision', 'code_repository', 'code_revision', 'reported_by', 'summary', 'evidence_ref'):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError('Review requires nonempty ' + key)
    if data['definition_revision'] != revision:
        raise ValueError('Review refers to an outdated card definition')
    if not re.fullmatch(r'[0-9a-f]{40}|[0-9a-f]{64}', data['code_revision']):
        raise ValueError('Review code_revision must be a full lowercase Git commit SHA')
    role, status = data.get('reporter_role'), data.get('status')
    if role not in ('implementer', 'reviewer') or not isinstance(status, str) or status not in STATUSES:
        raise ValueError('Invalid review role or status')
    if role == 'implementer' and status == 'passed':
        raise ValueError('Implementation self-report cannot establish passed')
    if role == 'reviewer' and status == 'pending_review':
        raise ValueError('Only implementers submit pending_review')
    for key in ('differences', 'unverified_items'):
        if not isinstance(data.get(key), list) or any(not isinstance(x, str) or not x.strip() for x in data[key]):
            raise ValueError('Review requires ' + key + ' as a text array')
    checks = data.get('checks')
    if not isinstance(checks, list) or not checks:
        raise ValueError('Review requires explicit checks')
    for check in checks:
        if not isinstance(check, dict) or check.get('result') not in ('pass', 'fail', 'unverified') or any(
                not isinstance(check.get(k), str) or not check[k].strip() for k in ('requirement', 'evidence_ref')):
            raise ValueError('Invalid review check')
    if status == 'passed' and (data['differences'] or data['unverified_items'] or any(c['result'] != 'pass' for c in checks)):
        raise ValueError('Passed requires all checks passing and no differences or unverified items')
    if status == 'mismatch' and not data['differences']:
        raise ValueError('Mismatch requires concrete differences')
    old = {r['id']: r for r in history(model, data['node_id'])}
    target = ('definition_revision', 'code_repository', 'code_revision')
    previous_implementation = next((r for r in reversed(list(old.values())) if r.get('schema_version') == STANDARD['version'] and r.get('definition_revision') == revision and r.get('reporter_role') == 'implementer'), None)
    if role == 'implementer' and ('base_implementation_report_id' not in data or data.get('base_implementation_report_id') != (previous_implementation or {}).get('id')):
        raise ValueError('Implementation report must acknowledge the current base_implementation_report_id')
    if role == 'reviewer':
        if not isinstance(data.get('implementation_report_id'), str):
            raise ValueError('Reviewer requires implementation_report_id')
        implementation = old.get(data['implementation_report_id'])
        if not implementation or implementation.get('schema_version') != STANDARD['version'] or implementation.get('reporter_role') != 'implementer' or any(
                implementation.get(k) != data[k] for k in target):
            raise ValueError('Reviewer must reference an implementation report for the same card and versions')
        if status == 'passed' and implementation.get('reported_by') == data['reported_by']:
            raise ValueError('Passed requires a different declared reviewer from the implementer')
    supersedes = data.get('supersedes_report_ids', [])
    if not isinstance(supersedes, list) or any(not isinstance(x, str) for x in supersedes) or len(set(supersedes)) != len(supersedes):
        raise ValueError('Invalid supersedes_report_ids')
    for identifier in supersedes:
        previous = old.get(identifier)
        if not previous or previous.get('schema_version') != STANDARD['version'] or any(
                previous.get(k) != data.get(k) for k in (*target, 'reported_by', 'reporter_role')):
            raise ValueError('Can only supersede own report for the same card, role and versions')
    return {**data, 'observations': {'implementation': status},
            'claims_are': 'version_pinned_agent_report_identity_not_authenticated'}


def aggregate(current):
    modern = [r for r in current if r.get('schema_version') == STANDARD['version']]
    if not modern:
        latest = current[-1] if current else None
        state = (latest or {}).get('observations', {}).get('implementation')
        return {'status': {'implemented':'pending_review', 'verified':'pending_review',
            'not_implemented':'incomplete', 'not_started':'incomplete', 'in_progress':'incomplete',
            'partial':'incomplete', 'mismatch':'mismatch', 'disputed':'discussion'}.get(state, 'unknown'),
            'report': latest, 'conflict': False, 'reason': 'legacy_report' if latest else 'no_current_report'}
    # Only an implementation declaration changes the active code target. A late
    # reviewer for an older commit cannot restore a passed badge on that commit.
    implementation = next(r for r in reversed(modern) if r['reporter_role'] == 'implementer')
    target = (implementation['code_repository'], implementation['code_revision'])
    matched = [r for r in modern if (r['code_repository'], r['code_revision']) == target]
    superseded = {identifier for r in matched for identifier in r.get('supersedes_report_ids', [])}
    active = [r for r in matched if r['id'] not in superseded]
    reviews = [r for r in active if r['reporter_role'] == 'reviewer']
    # A single contradictory reviewer blocks success; no last-writer wins.
    states = {r['status'] for r in reviews}
    conflict = len(states) > 1
    if conflict:
        status, reason = 'discussion', 'conflicting_reviews'
        report = next((r for r in reversed(reviews) if r['status'] != 'passed'), reviews[-1])
    elif reviews:
        status, reason, report = reviews[-1]['status'], 'review_report', reviews[-1]
    else:
        status, reason, report = implementation['status'], 'implementation_report', implementation
    # Implementation reports of known trouble cannot be hidden by an older pass.
    concerns = [r for r in active if r['reporter_role'] == 'implementer' and r['status'] in ('mismatch','discussion','incomplete','unknown')]
    if concerns and status == 'passed':
        status, reason, report, conflict = 'discussion', 'implementation_review_conflict', concerns[-1], True
    return {'status': status, 'report': report, 'conflict': conflict, 'reason': reason,
            'active_code_repository': target[0], 'active_code_revision': target[1],
            'active_implementation_report_id': implementation['id'],
            'active_report_ids': [r['id'] for r in active]}


def material(model, node_id):
    from card_progress import definition_revisions, CardProgress
    package = model.package()
    graph = package['graph']
    node = next((n for n in graph['nodes'] if n['id'] == node_id), None)
    if node is None:
        model.service.get_node(node_id)
    edges = [e for e in graph['edges'] if node_id in (e['upstream_id'], e['downstream_id'])]
    edge_ids = {e['id'] for e in edges}
    neighbors = {node_id} | {e[k] for e in edges for k in ('upstream_id','downstream_id')}
    refs = node['card_contract']['config'].get('definition_refs', [])
    return {'schema_version': STANDARD['version'], 'node_id': node_id,
        'definition_revision': definition_revisions(graph)[node_id],
        'package_revision': package['package_revision'], 'model_version': package['model_version'],
        'node': node, 'requirements': [r for r in graph['requirements'] if r['node_id'] == node_id],
        'validation_plan': node.get('validation_plan', ''),
        'acceptance_note': 'No inferred acceptance criteria: use explicit requirements/validation plan and linked contracts; report gaps.',
        'neighbors': [n for n in graph['nodes'] if n['id'] in neighbors and n['id'] != node_id],
        'fields': [f for f in graph['fields'] if f['node_id'] in neighbors], 'edges': edges,
        'bindings': [b for b in graph['bindings'] if b['edge_id'] in edge_ids],
        'field_usages': [u for u in graph['field_usages'] if u['edge_id'] in edge_ids],
        'definitions': {ref['path']: package['definitions'][ref['path']] for ref in refs},
        'documentation': [{'path': str(path.relative_to(ROOT)), 'body': path.read_text()}
            for path in (ROOT/'docs/CARD_REVIEW_API.md', ROOT/'docs/CARD_MODEL.md', ROOT/'docs/PRODUCT_WORKFLOW.md') if path.is_file()],
        'progress': CardProgress(model).snapshot(graph)[node_id],
        'reports_url': '/api/nodes/' + node_id + '/reports',
        'identity_policy': STANDARD['identity_policy'], 'code_version_policy': STANDARD['code_version_policy']}
