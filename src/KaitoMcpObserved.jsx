import React from 'react';
import { SourceFieldCard } from './SourceFieldCard';

const SHAPE_ZH = {
  kaito_entities: '响应的 matches 列表中，每一项是一种可查询对象。',
  kaito_narratives: '响应的 matches 列表中，每一项是一种叙事。',
  kaito_feeds: '响应的 results 列表中，每一项是一条动态；外层另有结果数量元信息。',
  kaito_search: '响应的 results 列表中，每一项是一条搜索结果。',
  kaito_advanced_search: '响应的 results 列表中，每一项是一条搜索结果。',
  kaito_tweet_engagement_info: '响应的 result 对象是一条推文的互动快照。',
  kaito_twitter_user_metadata: '响应的 listData 列表中，每一项是一份账号资料。',
  kaito_sentiment_entity: '响应是列式数组：第一项为字段名，后面按日期排列对应的值。',
  kaito_market_sentiment: '响应是列式数组：情绪、日期和市值三列按位置对齐。',
  kaito_engagement: '响应有两组按日期索引的数值：总互动和高质量账号互动。每个日期是一条数据点，不是新字段。',
  kaito_mentions: '响应直接以日期为键、提及量为值；每个日期是一条数据点。',
  kaito_mindshare_entity: '响应的 mindshare 对象以日期为键、关注份额为值。',
  kaito_mindshare_narrative: '响应包含叙事标识，以及以日期为键的关注份额。',
  kaito_events: '响应是事件列表；每个事件还包含参考资料列表。',
  kaito_smart_following_market: '响应应为账号列表；本次查询返回空列表。',
};

const SEARCH_OPERATION_NOTES = {
  kaito_search: {
    zh: '自然语言搜索（设计资料中的功能；当前爬虫未调用）',
    en: 'Natural-language search (described in the design; not called by the current crawler)',
  },
  kaito_advanced_search: {
    zh: '条件搜索（当前爬虫按项目、时间和来源自动调用）',
    en: 'Filtered search (called automatically for project, time and source)',
  },
};

const EVENT_FIELD_ORDER = ['ticker[]', 'date', 'start_date', 'end_date', 'description',
  'catalyst_list[]', 'smart_engagement', 'earliestRef.url', 'earliestRef.created_at',
  'earliestRef.data_source', 'earliestRef.id', 'reference_list[].url',
  'reference_list[].created_at', 'reference_list[].data_source', 'reference_list[].id'];
const eventPosition = path => { const index = EVENT_FIELD_ORDER.indexOf(path); return index < 0 ? EVENT_FIELD_ORDER.length : index; };
const orderedFields = tool => tool.name === 'kaito_events'
  ? [...tool.fields].sort((left, right) => eventPosition(left.path) - eventPosition(right.path))
  : tool.fields;

function ResponseCase({ tool, language }) {
  const zh = language === 'zh-CN';
  const say = (cn, en) => zh ? cn : en;
  const entries = Object.entries(tool.response_example || {});
  return <section className="source-response-case">
    <strong>{entries.length || tool.response_excerpt ? say('返回值片段', 'Response value excerpt') : say('使用思路', 'Design idea')}</strong>
    {tool.sample_note && <p>{tool.sample_note}</p>}
    {entries.length ? <dl>{entries.map(([path, value]) => <div key={path}>
      <dt>{zh ? tool.fields.find(field => field.path === path)?.label_zh || path : path}</dt>
      <dd><code>{JSON.stringify(value)}</code></dd>
    </div>)}</dl> : tool.response_excerpt ? <pre>{JSON.stringify(tool.response_excerpt, null, 2)}</pre>
      : <p>{say('这次没有保留可展示的完整记录。先把字段用途作为设计假设，拿到完整响应后再核验。', 'No complete displayable record was retained. Treat the field uses as a design hypothesis until a full response can be checked.')}</p>}
  </section>;
}

export function KaitoMcpObserved({ data, language, compact = false }) {
  if (!data) return null;
  const zh = language === 'zh-CN';
  const word = (cn, en) => zh ? cn : en;
  const unmapped = data.tools.filter(tool => !tool.entity_id);
  const sharedSearchResult = compact && data.tools.length === 2
    && data.tools.every(tool => SEARCH_OPERATION_NOTES[tool.name]);
  return <section className={`kaito-observed ${compact ? 'kaito-observed-compact' : ''}`} aria-label={word('Kaito MCP 实测返回字段', 'Observed Kaito MCP response fields')}>
    <div className="kaito-observed-head"><strong>{compact ? word('API 实际返回了什么', 'What the API returned') : word('Kaito MCP 实测返回字段', 'Observed Kaito MCP fields')}</strong><span>{new Date(data.observed_at).toLocaleDateString(zh ? 'zh-CN' : 'en-US')}</span></div>
    {sharedSearchResult && <p className="kaito-tool-shape">{word('这是两种搜索功能，共用 #028 搜索结果记录类型。下面两张卡分别是各自的 API 返回样本，不能拼成一次查询。', 'These are two search operations sharing the #028 search-result record type. The cards show separate API samples, not one combined query.')}</p>}
    {data.tools.map(tool => <details key={tool.name} className="kaito-tool" open={compact || data.tools.length <= 2 ? true : undefined}>
      <summary><code>{tool.name}</code>{tool.sample_status !== 'observed' && <span>{word('本次无记录', 'No rows returned')}</span>}</summary>
      {sharedSearchResult && <p className="kaito-tool-shape">{SEARCH_OPERATION_NOTES[tool.name][zh ? 'zh' : 'en']}</p>}
      {!tool.entity_id && <p className="kaito-tool-gap">{word('V2 暂无对应记录类型，需要上游补入目录。', 'V2 has no corresponding record type yet.')}</p>}
      {tool.sample_status === 'empty_result' ? <><p>{word('已成功调用，但所查时间窗口没有返回记录，因此不能给出实际字段数。', 'The call succeeded but returned no rows in the checked windows, so no field count is available.')}</p>{compact && <section className="source-response-case"><strong>{word('使用思路', 'Design idea')}</strong><p>{word('先确定查询对象与时间范围，等取得实际返回记录后再确认字段和计算方式。', 'Choose an entity and time window, then confirm fields and calculations after obtaining response rows.')}</p></section>}</> : <>
        <p className="kaito-tool-shape">{zh ? SHAPE_ZH[tool.name] || '下列是这次响应中实际出现的数据字段。' : 'Fields observed in this response; date keys are counted as one series field.'}</p>
        <div className="kaito-tool-fields">{orderedFields(tool).map(field => <SourceFieldCard key={field.path}
          name={zh ? field.label_zh : field.path} path={field.path} purpose={field.purpose_zh}
          useCase={field.use_case_zh} exampleValue={field.example_value} observed language={language} />)}</div>
        {compact ? <ResponseCase tool={tool} language={language} /> : tool.response_excerpt ? <div className="kaito-response-example"><strong>{word('API 响应结构摘录', 'API response excerpt')}</strong><p>{word('保留原有层级和实测数值，仅展示首个日期；后续日期省略。', 'Original nesting and observed values, showing only the first date.')}</p><pre>{JSON.stringify(tool.response_excerpt, null, 2)}</pre></div>
          : Object.keys(tool.response_example).length > 0 && <details className="kaito-response-example" open={compact ? true : undefined}><summary>{word('实际值片段（按字段整理）', 'Observed values by field')}</summary><p>{tool.sample_note}</p><pre>{JSON.stringify(tool.response_example, null, 2)}</pre></details>}
      </>}
    </details>)}
    {unmapped.length > 0 && <p className="kaito-tool-gap">{word(`${unmapped.length} 个已返回数据的 MCP 工具还没有 V2 记录类型：${unmapped.map(tool => tool.name).join('、')}。`, `${unmapped.length} responding MCP tools lack V2 record types: ${unmapped.map(tool => tool.name).join(', ')}.`)}</p>}
  </section>;
}
