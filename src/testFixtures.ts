import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { graphSchema } from './contracts';

// Exercise the real Python producer against a disposable database.
export function serverGraph(unified = false) {
  const output = execFileSync('python3', ['-c', `
import json, tempfile
from pathlib import Path
from graph_service import GraphService
with tempfile.TemporaryDirectory() as directory:
    service = GraphService(Path(directory) / 'test.db')
    service.ensure_system_tables()
    source = service.create_node({'name': 'Test source', 'type': 'Source'})
    target = service.create_node({'name': 'Test metric', 'type': 'Metric'})
    edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id']})
    field = service.create_field(source['id'], {'name': 'volume', 'data_type': 'Decimal'})
    output = service.create_field(target['id'], {'name': 'result', 'data_type': 'Decimal'})
    service.create_field_usage(edge['id'], {'source_field_id': field['id'], 'target_field_id': output['id']})
    service.create_requirement(target['id'], {'name': 'Market volume'})
    ${unified ? "from card_model import CardModel; CardModel(service).migrate()" : ""}
    print(json.dumps(service.graph()))
    service.db.close()
`], {
    cwd: fileURLToPath(new URL('../server/', import.meta.url)),
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, encoding: 'utf8',
  });
  return graphSchema.parse(JSON.parse(output) as unknown);
}
