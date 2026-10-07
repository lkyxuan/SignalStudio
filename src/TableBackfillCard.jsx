import React, { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { BusinessTableRows } from './BusinessTableRows';

const TEMPLATE = {
  version: 1,
  evidence_kind: 'database_snapshot',
  source: { system: 'fewunderstand', environment: '', location: 'asset_score.current_score', captured_at: '' },
  field_mapping: { asset_id: 'asset_id', asset_name: 'asset_name', score_key: 'score_key', score_value: 'score_value', calculated_at: 'calculated_at' },
  source_rows: [],
  expected_rows: [],
};

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(TEMPLATE, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'table-1006-snapshot-template.json';
  link.click();
  URL.revokeObjectURL(url);
}

export function TableBackfillCard({ table, language }) {
  const zh = language === 'zh-CN';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const requestId = useRef(0);
  useEffect(() => {
    let active = true;
    const id = ++requestId.current;
    request('/table-backfills/1006').then(result => {
      if (active && id === requestId.current) setData(result);
    }).catch(reason => { if (active && id === requestId.current) setError(reason.message); })
      .finally(() => { if (active && id === requestId.current) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function importSnapshot(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    ++requestId.current;
    setSaving(true);
    setLoading(false);
    setError('');
    try {
      if (file.size > 1_000_000) throw new Error(zh ? '快照文件不能超过 1 MB。' : 'Snapshot must be under 1 MB.');
      const payload = JSON.parse(await file.text());
      setData(await request('/table-backfills/1006', { method: 'POST', body: payload }));
    } catch (reason) { setError(reason.message); }
    finally { setSaving(false); }
  }

  const snapshot = data?.snapshot;
  const statuses = {
    matched: zh ? '符合预期' : 'Matches',
    different: zh ? '存在差异' : 'Differs',
    different_time: zh ? '计算时间不同，待对齐' : 'Different calculation times',
    not_compared: zh ? '未提供预期' : 'No expectation supplied',
  };
  return <section className="table-backfill-card" aria-label={zh ? '实际回填' : 'Actual backfill'}>
    <div className="table-backfill-heading">
      <h3>{zh ? '实际回填 · 固定快照' : 'Actual backfill · fixed snapshot'}</h3>
      <div className="table-backfill-actions">
        <button type="button" onClick={downloadTemplate}>{zh ? '下载导入模板' : 'Download template'}</button>
        <button type="button" disabled={saving || loading} onClick={() => fileInput.current?.click()}>{saving ? zh ? '正在保存…' : 'Saving…' : snapshot ? zh ? '替换快照' : 'Replace snapshot' : zh ? '导入快照' : 'Import snapshot'}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={importSnapshot} />
      </div>
    </div>
    {error && <p role="alert" className="table-backfill-error">{zh ? '快照读取或导入失败：' : 'Snapshot read or import failed: '}{error}</p>}
    {loading ? <p role="status">{zh ? '正在读取仓库快照…' : 'Loading repository snapshot…'}</p> : snapshot ? <>
      <BusinessTableRows table={table} rows={data.rows} language={language} />
      <p><strong>{data.rows.length} {zh ? '行实际回填' : 'backfilled rows'}</strong> · {snapshot.evidence_kind === 'database_snapshot' ? zh ? '数据库结果快照' : 'Database result snapshot' : zh ? '基于真实样本的离线回放' : 'Offline replay from real samples'}</p>
      <dl className="table-backfill-provenance">
        <div><dt>{zh ? '数据来源' : 'Source'}</dt><dd>{snapshot.source.system} · {snapshot.source.environment} · {snapshot.source.location}</dd></div>
        <div><dt>{zh ? '采样时间' : 'Captured at'}</dt><dd>{snapshot.source.captured_at}</dd></div>
        {snapshot.derivation_ref && <div><dt>{zh ? '输入与规则依据' : 'Input and rule reference'}</dt><dd>{snapshot.derivation_ref}</dd></div>}
      </dl>
      <details className="table-backfill-detail"><summary>{zh ? '与预期对照' : 'Compare with expectations'}</summary>
        <p>{zh ? '按 asset_id + score_key 匹配预期，仅在计算时间相同时比较完整精度分数。' : 'Match expectations by asset_id + score_key. Compare full-precision scores only at the same calculation time.'}</p>
        <div className="business-table-schema-scroll"><table>
          <thead><tr><th>asset_id</th><th>{zh ? '预期分' : 'Expected score'}</th><th>{zh ? '实际 − 预期' : 'Actual − expected'}</th><th>{zh ? '对照结果' : 'Result'}</th></tr></thead>
          <tbody>{data.comparisons.map(row => <tr key={row.asset_id}><td><code>{row.asset_id}</code></td><td>{row.expected_score ?? '—'}</td><td>{row.delta ?? '—'}</td><td>{statuses[row.status]}</td></tr>)}</tbody>
        </table></div>
        {data.unmatched_expected_count > 0 && <p>{zh ? `${data.unmatched_expected_count} 条预期在快照中没有对应行。` : `${data.unmatched_expected_count} expectations have no corresponding snapshot row.`}</p>}
      </details>
      <details className="table-backfill-detail"><summary>{zh ? '字段映射与原始快照' : 'Field mapping and source snapshot'}</summary>
        <div className="business-table-schema-scroll"><table><thead><tr><th>{zh ? '源字段' : 'Source field'}</th><th>{zh ? '#1006 字段' : '#1006 field'}</th></tr></thead>
          <tbody>{Object.entries(snapshot.field_mapping).map(([target, source]) => <tr key={target}><td><code>{source ?? 'NULL'}</code></td><td><code>{target}</code></td></tr>)}</tbody></table></div>
        <pre>{JSON.stringify(snapshot.source_rows, null, 2)}</pre>
      </details>
    </> : !error && <p className="table-backfill-empty">{zh ? '待回填：尚未导入真实快照。导入后会在这里显示实际表行、来源与预期对照。' : 'Awaiting backfill: no real snapshot has been imported. Imported rows, provenance and comparisons will appear here.'}</p>}
    <details className="table-backfill-detail"><summary>{zh ? '如何准备快照' : 'Prepare a snapshot'}</summary>
      <p>{zh ? '导出少量 fewunderstand 记录，填写采样环境、来源位置和带时区的采样时间。按模板填入 source_rows，并用 field_mapping 对应五个表字段。名称可以映射为 null，其他字段需有真实来源值。' : 'Export a small set of fewunderstand records. Fill in the environment, source location and capture time with a timezone. Put records in source_rows and map the five table fields using field_mapping. The name mapping may be null; other fields require source values.'}</p>
      <p>{zh ? '需要对照时，expected_rows 填 asset_id、score_key、score_value、calculated_at。离线回放使用 evidence_kind=offline_replay，并填写 derivation_ref 以追溯输入和规则；本模块展示导入结果。' : 'For comparisons, expected_rows contains asset_id, score_key, score_value and calculated_at. For an offline replay, use evidence_kind=offline_replay and derivation_ref to trace inputs and rules. This module displays imported results.'}</p>
      <p>{zh ? '快照保存到仓库的 data/table-1006-backfill.json。提交并推送后，另一台电脑拉取仓库、重新打开本面板即可读取；导入会替换当前快照。' : 'Snapshots are saved to data/table-1006-backfill.json in the repository. Commit and push, then pull on another computer and reopen this panel to read them. Import replaces the current snapshot.'}</p>
    </details>
  </section>;
}
