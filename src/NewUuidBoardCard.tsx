import spec from '../catalog/new-uuid-board.v1.json';
import assets from '../catalog/business-tables.v1.json';
import {BusinessTableRows} from './BusinessTableRows';
import {ProcessingCardFrame} from './ProcessingCardFrame';
import {selectNewUuidDesign} from './newUuidBoardDesign';
import type {Graph, GraphNode, Language} from './contracts';
export const newUuidBoardCard = (name: string) => [spec.table_name, spec.calculator_name].includes(name);
export function NewUuidBoardCard({node,graph,openNode,language}: {node: GraphNode; graph?: Graph; openNode?: (id:string)=>void; language: Language}) {
  const zh = language === 'zh-CN';
  const output = selectNewUuidDesign(spec.case.rows, spec.case.now);
  const table = {columns:spec.columns,primary_key:['asset_id']};
  const caption = <p>{zh ? spec.limitations_zh : 'Studio definitions and fictional inputs only. Runtime registration, creation-origin checks and readers remain unverified.'}</p>;
  const settings = <details><summary>{zh ? '其他设置 · 规则与未接通点' : 'Other settings · rules and unbound facilities'}</summary>
    <p>{zh ? '排序：首次建档时间倒序，同刻UUID升序；前20个，无上线年龄或行情门槛。' : 'First registration time descending, then UUID ascending; latest 20, without launch age or market thresholds.'}</p>
    {spec.requirements_zh.map(rule => <p key={rule}>{rule}</p>)}
    <pre>{JSON.stringify(spec.bindings,null,2)}</pre>
    <a href={spec.rationale_url}>{zh ? '批准方案 SS-84' : 'Approved scope SS-84'}</a>
  </details>;
  if (node.name === spec.table_name) return <div className="business-table-card">
    <BusinessTableRows table={table} rows={spec.observed_rows} language={language}/>
    {caption}<details><summary>{zh ? '虚构结果示例 · 非真实记录' : 'Fictional result example · not observed'}</summary>
      <BusinessTableRows table={table} rows={output.rows} language={language}/>
    </details>{settings}
  </div>;
  if (!graph || !openNode) return null;
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={node.formula}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 统一建档对象' : 'Input · registered objects'}</h3>
        <BusinessTableRows table={assets.tables.assets} rows={spec.case.rows} language={language}/>
        <p>{zh ? '案例另外假设创建来源为正常发现、初始化导入或迁移；这是待绑定的判定信息，不是已经采集的资产字段。' : 'The case additionally assumes discovery/import/migration origins. This check is unbound, not an observed asset column.'}</p>
        <BusinessTableRows table={{primary_key:['asset_id'],columns:[{name:'asset_id'},{name:'creation_origin'},{name:'source_refs_json'}]}} rows={spec.case.rows} language={language}/>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 新资产榜' : 'Output · new assets board'}</h3>
        <BusinessTableRows table={table} rows={output.rows} language={language}/>
        <p>{zh ? '人物也可在新榜；代币内容链仅取coin。旧项目今天首次建档可以入榜；旧UUID新增渠道不刷新时间，导入与待确认对象不入榜。' : 'The board can include a person; token content accepts coin only. An old project newly registered can enter; another source never renews its original creation time. Imports and pending identities are excluded.'}</p>
      </section>
    </div>
    <p>{zh ? spec.case.caption_zh : 'Fictional inputs and assumed bindings; no business writes.'}</p>
    <section className="execution-trigger"><h3>{zh ? '运行触发 · 目标定义' : 'Execution trigger · requirement'}</h3>
      <p>{zh ? '统一建档成功提交后、启动时及每60秒补查；仅设计，真实通知和读取未接通。' : 'After registration commits, at startup and every 60 seconds; notifications and readers are not connected.'}</p>
    </section>{caption}{settings}
  </ProcessingCardFrame>;
}
