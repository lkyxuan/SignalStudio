import test from 'node:test';
import assert from 'node:assert/strict';
import { createNodeSearch } from './graphSearch';
import { serverGraph } from './testFixtures';

test('empty search avoids field access; nonempty search includes field and requirement text and caches descriptions', () => {
  const graph = serverGraph(), node = graph.nodes[0]!;
  const fields = [{...graph.fields[0]!,node_id:node.id,name:'FieldNeedle',definition:'Field Definition'}];
  const requirements = [{...graph.requirements[0]!,node_id:node.id,name:'RequirementNeedle',purpose:'Requirement Purpose'}];
  let reads=0,descriptions=0;
  const search=createNodeSearch({get fields(){reads++;return fields;},get requirements(){reads++;return requirements;}}, n=>{descriptions++;return n.name;});
  assert.equal(search(node,''),true);assert.equal(reads,0);assert.equal(descriptions,0);
  for(const query of ['fieldneedle','field definition','requirementneedle','requirement purpose']) assert.equal(search(node,query),true);
  assert.equal(search(node,'missing'),false);assert.equal(reads,2);assert.equal(descriptions,1);
  assert.equal(search({...node,name:'Changed Name'},'changed name'),true);
});
