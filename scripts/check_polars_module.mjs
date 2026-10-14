// Render approved module definitions without invoking any runtime action.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const graph = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const before = JSON.stringify(graph);
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { CardDetails } = await vite.ssrLoadModule('/src/CardDetails.jsx');
  const render = (node, language = 'zh-CN') => renderToStaticMarkup(createElement(CardDetails, {
    node, graph, language, openNode: () => {}, mutate: () => { throw new Error('Unexpected write'); }, busy: false,
  }));
  const parent = graph.nodes.find(n => n.card_contract?.config.resource?.module_children);
  assert.ok(parent);
  assert.match(render(parent), /输入/);
  assert.match(render(parent), /输出/);
  const resource = parent.card_contract.config.resource;
  for (const c of resource.module_children) {
    const node = graph.nodes.find(n => n.id === c.node_id);
    const html = render(node);
    assert.ok(html.includes(c.output_field));
    assert.match(html, /所属模块/);
    assert.ok(html.includes(`#${parent.reference_number}`));
    assert.match(html, /Polars计算方式/);
    assert.ok(render(node, 'en').includes('Owning module'));
  }
  const assembly = graph.nodes.find(n => n.card_contract?.config.resource?.design_key === 'assemble');
  if (assembly) {
    assert.match(render(assembly), /输入/);
    assert.match(render(assembly), /输出/);
    const out = graph.edges.find(e => e.upstream_id === assembly.id && graph.nodes.find(n => n.id === e.downstream_id)?.reference_number === 5007);
    assert.ok(out);
    for (const c of resource.module_children) {
      assert.ok(graph.edges.some(e => e.upstream_id === parent.id && e.downstream_id === c.node_id));
      assert.ok(graph.edges.some(e => e.upstream_id === c.node_id && e.downstream_id === assembly.id));
    }
  }
  const channel = graph.nodes.find(n => n.card_contract?.config.resource?.publisher_module_id === parent.id);
  const html = render(channel);
  for (const name of Object.keys(resource.field_producers)) assert.ok(graph.fields.some(f => f.node_id === channel.id && f.name === name));
  assert.match(html, /消息/);
  const consumers = graph.nodes.filter(n => n.card_contract?.config.resource?.indicator_dependency);
  const shelved = new Set((graph.workspace_scope?.shelved_cards || []).map(n => n.name));
  const spec = JSON.parse(readFileSync('catalog/polars-indicator-current.v1.json', 'utf8'));
  assert.equal(consumers.length, spec.consumers.filter(c => !shelved.has(c.name) && !(c.key==='hottest_calc' && graph.nodes.some(n=>n.card_contract?.config.resource?.hottest_key==='rank')) && !(c.key==='warming_calc' && graph.nodes.some(n=>n.card_contract?.config.resource?.warming_key==='rank'))).length);
  for (const node of consumers) {
    const html = render(node);
    assert.match(html, /从5007实际读取哪些字段/);
    for (const name of node.card_contract.config.resource.indicator_dependency.metric_fields) assert.ok(html.includes(name));
  }
  assert.equal(JSON.stringify(graph), before);
  console.log(JSON.stringify({ module: parent.reference_number, children: resource.module_children.length, consumers: consumers.length, graph_unchanged: true }));
} finally { await vite.close(); }
