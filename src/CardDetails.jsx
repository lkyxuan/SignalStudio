import React, { useEffect, useState } from 'react';
import { detailKind, cardRelations, decisionBranches, decisionActor, executionSummary, cardExplanation, resourceSettings, isCatalogSource } from './cardDetailModel';
import { CardDetailContext } from './CardDetailContext';
import { ProcessingIOCard, ScoreRollupExplanation } from './ProcessingIOCard';
import { BusinessTableCard } from './BusinessTableCard';
import { ContentRefreshCard, contentRefreshCard } from './ContentRefreshCard';
import { LeaderboardScaffoldCard, leaderboardCard } from './LeaderboardScaffoldCard';
import { trendDesign } from './TrendDesignCard';
import { GenericTableCard } from './CardDefinitionSettings';
import { SourceCaseInspector } from './SourceCaseInspector';
import { OtherSourceCaseInspector } from './OtherSourceCaseInspector';
import { SourceCollectionSettings } from './SourceCollectionSettings';
import { SourceUsageGuide, sourcePurpose } from './SourceUsageGuide';
import { FieldCatalog } from './FieldPanels';
import { nodeRef } from './graphRefs';
import { displayNodeName } from './i18n';
import businessTables from '../catalog/business-tables.v1.json';
import initial from '../catalog/asset-initial-score-sources.v1.json';
import scoreRollup from '../catalog/score-rollup.v1.json';
import './card-details.css';

const words = (language, zh, en) => language === 'zh-CN' ? zh : en;
const relationLabels = {data:['传递数据','Data'],control:['执行顺序','Sequence'],read:['读取','Read'],write:['写入','Write'],publish:['发布消息','Publish'],consume:['消费消息','Consume'],error:['失败路径','Error'],reference:['设计引用 · 未建立自动同步','Design reference · no automatic sync']};
function CardLink({ node, openNode, language }) {
  return <button type="button" onClick={() => openNode(node.id)}>{nodeRef(node)} {displayNodeName(language, node.name)}</button>;
}
export function CardConnections({ node, graph, openNode, language }) {
  const relations = cardRelations(node, graph);
  const kind = detailKind(node);
  const labels = kind === 'table' || kind === 'state' ? ['更新与写入方','读取与使用方','Writers / updates','Readers / uses']
    : kind === 'channel' ? ['消息发送方','订阅与消费方','Producers','Subscribers / consumers'] : ['输入来源','结果去向','Input sources','Output destinations'];
  return <section className="card-detail-connections" aria-label={words(language,'数据流向','Data flow')}>
    {[true,false].map((incoming,index) => <div key={String(incoming)}><h3>{labels[index + (language === 'zh-CN' ? 0 : 2)]}</h3>
      {relations.filter(item => item.incoming === incoming).map(({ edge, other, bindings }) => <div className="card-detail-relation" key={edge.id}>
        {other && <CardLink node={other} openNode={openNode} language={language} />}
        <small>{bindings.length ? [...new Set(bindings.map(binding => relationLabels[binding.kind]?.[language === 'zh-CN' ? 0 : 1] || binding.kind))].join(' · ') : words(language,'设计连接 · 关系待定义','Design connection · relation undefined')}</small>
      </div>)}
      {!relations.some(item => item.incoming === incoming) && <p>{words(language,'尚未连接','No connection defined')}</p>}
    </div>)}
  </section>;
}
function Branches({ node, graph, openNode, language }) {
  const branches = decisionBranches(node,graph,language);
  const actor = decisionActor(node);
  return <section className="card-detail-branches"><h3>{words(language,'判断分支与去向','Decision branches and destinations')}</h3>
    <p>{words(language,'判断方式：','Mode: ')}{actor === 'human' ? words(language,'人工审核','Human review') : actor === 'automatic' ? words(language,'自动判断','Automatic') : words(language,'待定义','Undefined')} · {words(language,'以下是规则，不是本次运行结果或实际批准。','Rules, not runtime outcomes or actual approvals.')}</p>
    {branches.length ? branches.map(branch => <div className="card-detail-branch" key={branch.id}>
      <strong>{branch.label} <code>{branch.id}</code></strong><p>{branch.condition}</p>
      {branch.targets.map(target => <CardLink key={target.id} node={target} openNode={openNode} language={language} />)}
      {branch.terminal && <span>{words(language,'本分支结束，不启动后续步骤','Terminal branch; no subsequent step')}</span>}
      {!branch.terminal && !branch.targets.length && <span>{words(language,'尚未绑定去向','Destination not bound')}</span>}
    </div>) : <p>{words(language,'尚未定义分支条件与去向。','Branch conditions and destinations are undefined.')}</p>}
  </section>;
}
function ReferenceSource({ node, graph, language }) {
  const [resource,setResource] = useState(null);
  useEffect(() => { let active=true;
    fetch(`/api/source-contracts/v1/resources/${encodeURIComponent(node.name)}`).then(r=>r.ok?r.json():null).then(data=>{if(active)setResource(data?.resource || null);}).catch(()=>{});
    return()=>{active=false;};
  },[node.name]);
  const settings=resourceSettings(node);
  const fields=graph.fields.filter(field=>field.node_id===node.id);
  return <section className="card-detail-resource-source"><h3>{words(language,'参考资源','Reference resource')}</h3>
    <p><code>{resource?.uri || settings.uri || words(language,'资源地址待定义','Resource URI undefined')}</code></p>
    <p>{resource?.purpose_zh || node.definition}</p>
    <h3>{words(language,'资源内容与读取依据','Resource content and read evidence')}</h3>
    <p>{resource?.call_status_note_zh || resource?.note_zh || words(language,'尚无回填的真实资源读取记录。','No observed resource read has been imported.')}</p>
    {fields.length > 0 && <DeclaredFields fields={fields} language={language} />}
    <p>{resource?.input_note_zh || words(language,'读取能力与必要参数沿用资源定义；缺失项待核对。','Read capability and parameters follow the resource definition; gaps remain unverified.')}</p>
  </section>;
}
function DeclaredFields({ fields, language }) {
  return <><p className="card-detail-provenance">{words(language,'字段定义 · 不代表真实数据','Declared fields · not observed data')}</p>
    <dl className="source-case-inspector-fields">{fields.map(field=><div key={field.id}><dt><code>{field.name}</code></dt><dd>{field.definition || field.data_type}</dd></div>)}</dl></>;
}
function SourceDetails(props) {
  const {node,graph,language,mutate,busy,onOpenSource}=props;
  const resource=node.name.startsWith('kaito.resource.') || node.card_contract?.config.subtype === 'resource';
  const catalog=isCatalogSource(node.name);
  const fields=graph.fields.filter(field=>field.node_id===node.id);
  return <>
    {resource ? <ReferenceSource {...props}/> : catalog ? node.name === 'kaito.mcp.kaito_advanced_search'
      ? <SourceCaseInspector language={language} purpose={sourcePurpose(node.name,language)||node.definition} onOpenFull={()=>onOpenSource(node.name,0)}/>
      : <OtherSourceCaseInspector operationId={node.name} language={language} purpose={sourcePurpose(node.name,language)||node.definition} onOpenFull={index=>onOpenSource(node.name,index)}/>
      : <><div className="source-case-inspector"><section className="source-case-inspector-section"><h3>{words(language,'请求参数','Request parameters')}</h3><p>{words(language,'参数与实际调用尚未定义。','Parameters and observed calls are undefined.')}</p></section>
        <section className="source-case-inspector-section"><h3>{words(language,'返回结构','Response structure')}</h3><DeclaredFields fields={fields} language={language}/></section></div><p>{node.definition}</p></>}
    <CardConnections {...props}/>
    <details className="processing-advanced"><summary>{words(language,'其他设置 · 来源与字段','Other settings · source and fields')}</summary>
      {catalog && !resource && <SourceCollectionSettings node={node} language={language}/>}
      <FieldCatalog node={node} fields={fields} mutate={mutate} busy={busy} language={language}/>
      {catalog && <SourceUsageGuide node={node} language={language} hasDownstream={graph.edges.some(edge=>edge.upstream_id===node.id)}/>}
    </details>
  </>;
}
function TableDetails(props) {
  const {node,graph,language,mutate,busy}=props;
  const special=contentRefreshCard(node.name)||leaderboardCard(node.name);
  return <>
    <p className="card-detail-provenance">{node.name === initial.table_name
      ? words(language,'规则配置 · 不是业务运行记录','Rule configuration · not business execution records')
      : businessTables.tables[node.name] && !special
        ? words(language,'主表为设计案例 · 真实快照另列于回填模块（如有）','Main table: design cases · imported snapshots are separate, when available')
        : words(language,'表结构 · 未回填的真实记录不等于线上表为空','Table structure · missing imported records do not establish empty live storage')}</p>
    {special ? contentRefreshCard(node.name) ? <ContentRefreshCard {...props}/> : <LeaderboardScaffoldCard {...props}/>
      : businessTables.tables[node.name] ? <BusinessTableCard {...props}/> : <GenericTableCard {...props}/>}
    <CardConnections {...props}/>
    <details className="processing-advanced"><summary>{words(language,'其他设置 · 存储与表字段','Other settings · storage and fields')}</summary>
      <p>{words(language,'逻辑表定义与物理数据库分别核对；连线不证明已经写入或同步。','Logical table and physical database are checked separately; connections do not establish writes or synchronization.')}</p>
      {Object.keys(resourceSettings(node)).length ? <pre>{JSON.stringify(resourceSettings(node),null,2)}</pre> : <p>{words(language,'物理存储绑定与规则尚未回填。','Physical storage binding and rules have not been imported.')}</p>}
      {!businessTables.tables[node.name] && !special && <FieldCatalog node={node} fields={graph.fields.filter(field=>field.node_id===node.id)} mutate={mutate} busy={busy} language={language}/>}
    </details>
  </>;
}
export function CardDetails(props) {
  const {node,language}=props;
  const kind=detailKind(node);
  if (kind === 'unknown' || node.card_contract?.config.read_only) return <section className="card-details card-detail-unknown" data-card-detail-kind="unknown"><h3>{words(language,'只读定义','Read-only definition')}</h3><p>{node.definition}</p><p>{words(language,'定义尚不能按当前六类安全解释，保留原始内容供核对。','This definition cannot be safely interpreted by the current templates. Original content is retained for review.')}</p><pre>{JSON.stringify(node.card_contract,null,2)}</pre></section>;
  const execution=kind === 'process'||kind === 'decision';
  const explanation=cardExplanation(node,language);
  return <div className={`card-details card-details-${kind}`} data-card-detail-kind={kind}>
    <CardDetailContext.Provider value={true}>
      {kind === 'source' ? <SourceDetails {...props}/> : kind === 'table' ? <TableDetails {...props}/> : <>
        {!trendDesign(node.name) && ['Redis · 最热榜数据区','计算最热榜得分'].includes(node.name) && <p className="card-detail-provenance">{words(language,'备用设计草案 · 当前热榜沿用 #3005 → #1006，本路径未启用。','Alternate draft · current hot board uses #3005 → #1006; this path is inactive.')}</p>}
        <ProcessingIOCard {...props}/>
        {kind === 'state' && leaderboardCard(node.name) && <section className="card-detail-execution"><h3>{words(language,'窗口与保留规则','Window and retention')}</h3><p>{node.definition}</p><p>{words(language,'业务比较窗口见上述定义；存储 TTL、更新时间索引及丢失后的重建绑定尚未核验，不能按业务窗口推断。','See the definition for the business window. TTL, update time index and recovery bindings remain unverified.')}</p></section>}
        {kind === 'decision' && <Branches {...props}/>}
        <CardConnections {...props}/>
        {execution && <>
          <section className="card-detail-execution"><h3>{words(language,'何时运行','When it runs')}</h3><p>{executionSummary(node,language)}</p>
            <p>{words(language,'以上为定义；打开详情只读数据，不启动这一步。','Definition only; opening details reads data without starting this step.')}</p>
            {(node.caveats || node.trigger_rule) && <p>{node.trigger_rule || node.caveats}</p>}
          </section>
          {node.name === scoreRollup.node.name ? <ScoreRollupExplanation language={language}/> : <section className="processing-goal-readonly processing-algorithm"><h3>{words(language,kind === 'decision'?'判断规则':'怎么处理',kind === 'decision'?'Decision rule':'How it works')}</h3>
            <p>{explanation || words(language,'规则尚未定义，暂时无法给出可验证的推导。','No rule is defined; a verifiable derivation is unavailable.')}</p>
          </section>}
        </>}
      </>}
    </CardDetailContext.Provider>
  </div>;
}
