import React from 'react';
import { catalogFieldCopy, displayFieldName } from './catalogPresentation';
import { SourceFieldCard } from './SourceFieldCard';

// The CoinGecko response is an open object. These labels describe keys actually
// present in the saved upstream response, rather than expanding the v2 contract.
const COINGECKO_FIELDS = {
  id: ['对象标识', 'CoinGecko 中用于识别币种的名称。'],
  symbol: ['币种代码', '币种的简写代码；关联其他来源前需核对。'],
  name: ['币种名称', '币种的完整名称。'],
  image: ['图标链接', '币种图标的地址，用于展示和人工核对。'],
  current_price: ['当前价格', '这次市场快照中的价格。'],
  market_cap: ['市值', '当前价格与流通供应量对应的市值。'],
  market_cap_rank: ['市值排名', '按市值排列的名次。'],
  fully_diluted_valuation: ['完全稀释估值', '按最大或总供应量估算的市值。'],
  total_volume: ['成交额', '当前统计窗口内的成交额。'],
  high_24h: ['24 小时最高价', '过去 24 小时的最高价格。'],
  low_24h: ['24 小时最低价', '过去 24 小时的最低价格。'],
  price_change_24h: ['24 小时价格变化', '价格相对 24 小时前的变化量。'],
  price_change_percentage_24h: ['24 小时涨跌幅', '价格相对 24 小时前的百分比变化。'],
  market_cap_change_24h: ['24 小时市值变化', '市值相对 24 小时前的变化量。'],
  market_cap_change_percentage_24h: ['24 小时市值涨跌幅', '市值相对 24 小时前的百分比变化。'],
  circulating_supply: ['流通供应量', '当前处于流通中的币种数量。'],
  total_supply: ['总供应量', '目前存在的币种总量。'],
  max_supply: ['最大供应量', '协议允许的供应量上限；可能为空。'],
  ath: ['历史最高价', 'CoinGecko 记录的历史最高价格。'],
  ath_change_percentage: ['距历史最高价涨跌幅', '当前价格相对历史最高价的百分比变化。'],
  ath_date: ['历史最高价日期', '达到历史最高价的时间。'],
  atl: ['历史最低价', 'CoinGecko 记录的历史最低价格。'],
  atl_change_percentage: ['距历史最低价涨跌幅', '当前价格相对历史最低价的百分比变化。'],
  atl_date: ['历史最低价日期', '达到历史最低价的时间。'],
  roi: ['投资回报信息', '上游提供的投资回报对象；本次样本为空。'],
  last_updated: ['上游更新时间', 'CoinGecko 更新这条市场数据的时间。'],
};
const COINGECKO_DROPPED = new Set(['roi', 'image', 'ath', 'atl']);
const DEX_HORIZON = {m5: '5 分钟', h1: '1 小时', h6: '6 小时', h24: '24 小时'};
const DEX_NAMES = {
  chainId: '所属链', dexId: '交易平台', url: '交易对页面', pairAddress: '交易对地址',
  labels: '交易对标签', 'baseToken.address': '基础代币地址', 'baseToken.name': '基础代币名称',
  'baseToken.symbol': '基础代币代码', 'quoteToken.address': '报价代币地址',
  'quoteToken.name': '报价代币名称', 'quoteToken.symbol': '报价代币代码',
  priceNative: '原生计价价格', priceUsd: '美元价格', 'liquidity.usd': '美元流动性',
  'liquidity.base': '基础代币流动性', 'liquidity.quote': '报价代币流动性',
  fdv: '完全稀释估值', marketCap: '市值', pairCreatedAt: '交易对创建时间',
};
const flattenPair = (value, prefix = '') => {
  if (value && typeof value === 'object' && !Array.isArray(value))
    return Object.entries(value).flatMap(([key, child]) => flattenPair(child, prefix ? `${prefix}.${key}` : key));
  return [{path: prefix, value}];
};
const dexName = path => {
  if (DEX_NAMES[path]) return DEX_NAMES[path];
  const [family, horizon, part] = path.split('.');
  const span = DEX_HORIZON[horizon];
  if (!span) return path;
  if (family === 'txns') return `${span}${part === 'buys' ? '买入' : '卖出'}笔数`;
  if (family === 'volume') return `${span}成交额`;
  if (family === 'priceChange') return `${span}价格变化`;
  return path;
};
const dexUseCase = path => {
  if (/^(chainId|dexId|pairAddress|baseToken|quoteToken)/.test(path)) return '先确认交易对和链，避免把同名代币或不同市场合并。';
  if (path.startsWith('txns.')) return '与同窗口成交额一起看，辨别活跃交易是否由少数大额交易造成。';
  if (path.startsWith('volume.')) return '与同窗口价格变化和流动性一起比较，观察交易活跃度。';
  if (path.startsWith('priceChange.')) return '对照同窗口交易笔数与成交额，判断价格变化是否有交易支持。';
  if (path.startsWith('liquidity.')) return '比较可交易深度，避免小额成交造成的价格假信号。';
  if (path === 'pairCreatedAt') return '与当前时间比较，区分新建交易对和已有市场。';
  return '先按链和交易对地址确认对象，再与同一时点的其他市场字段比较。';
};

const showValue = value => JSON.stringify(value, null, 2);
const coingeckoUseCase = path => {
  if (['id', 'symbol', 'name', 'image'].includes(path)) return '先核对币种身份，再关联社交讨论或其他市场来源。';
  if (path === 'roi') return '本次样本为空；设计相关指标前先确认是否持续有值。';
  if (path.endsWith('_date') || path === 'last_updated') return '用时间核对价格和市值是否属于同一观察窗口。';
  if (path.includes('supply') || path === 'fully_diluted_valuation') return '与价格和市值一起查看，避免忽略供应量差异。';
  if (path.includes('change')) return '与历史基线比较，判断变化是短期波动还是持续趋势。';
  return '按同一资产和观察时间比较，再决定是否用于筛选或趋势指标。';
};

export function SourceCatalogFields({ data, language, fieldsOverride = null, title = null, showRecordExample = true }) {
  if (!data) return null;
  const zh = language === 'zh-CN';
  const say = (cn, en) => zh ? cn : en;
  const response = data.upstream_response?.response;
  const observed = response && typeof response === 'object' && !Array.isArray(response);
  const coingeckoObserved = observed && data.entity.spider_id === 'coingecko';
  const dexSample = data.dexscreener_upstream_sample;
  const dexObserved = Boolean(dexSample?.pair);
  const fields = dexObserved ? flattenPair(dexSample.pair).map(({path, value}) => ({
    path, name: zh ? dexName(path) : path, purpose: '',
    useCase: zh ? dexUseCase(path) : '', example: value,
    exampleLabel: say('上游 API 返回', 'Upstream API response'), exampleStatus: 'upstream_api',
  })) : observed ? Object.entries(response).map(([path, value]) => ({
    path, name: zh ? COINGECKO_FIELDS[path]?.[0] || path : path,
    purpose: zh ? COINGECKO_FIELDS[path]?.[1] || '' : '',
    useCase: coingeckoObserved && COINGECKO_DROPPED.has(path)
      ? say('上游返回此字段，但当前爬虫发送前会删除；暂不能用它设计已采集数据指标。', 'Returned upstream, then removed by the current crawler before emission.')
      : zh ? coingeckoUseCase(path) : '',
    example: value, exampleLabel: say('上游 API 返回', 'Upstream API response'),
    exampleStatus: 'upstream_api',
  })) : (fieldsOverride || data.fields).map(field => {
    const copy = catalogFieldCopy(field, language);
    return {path: field.path, name: displayFieldName(field, language),
      purpose: copy.purpose, useCase: copy.useCase,
      example: field.presentation?.example_value,
      exampleLabel: zh ? field.presentation?.label_zh : field.presentation?.label_en,
      exampleStatus: field.presentation?.example_status,
      exampleUrl: field.presentation?.example_url};
  });
  const openObject = data.entity.completeness === 'dynamic_open_object';
  const fixture = data.record_example?.status === 'transformed_test_fixture';
  return <section className="kaito-observed source-catalog-fields" aria-label={say('数据源字段', 'Source fields')}>
    <div className="kaito-observed-head"><strong>{title || (observed || dexObserved ? say('API 实际返回了什么', 'What the API returned') : say('这个来源有哪些字段', 'Fields in this source'))}</strong></div>
    <p>{dexObserved
      ? say('以下是爬虫所用接口一次真实响应中 pairs[0] 出现的全部路径，按原有层级展开。它不是所有交易对的完整字段契约，也不证明爬虫已采集。', 'Every path in pairs[0] of one real response from the endpoint used by the crawler, expanded from its nesting. It is not a complete contract for all pairs or proof of crawler emission.')
      : observed
      ? say('以下字段来自留存的真实上游 API 响应。它是一次查询的样本，开放对象可能返回其他键。', 'Fields from one saved upstream API response. This open object may contain other keys in another query.')
      : openObject
        ? say('V2 只声明这是开放对象，尚无完整返回样本；下列字段不能当作全部 API 字段。', 'V2 declares an open object without a complete response sample. The fields below are not an exhaustive API schema.')
        : say('以下是 V2 声明的记录字段；有些值来自测试夹具或格式示例，并非实测运行记录。', 'These are V2 record fields. Some values come from fixtures or format examples, not observed production records.')}</p>
    <div className="kaito-tool-fields">{fields.map(field => <SourceFieldCard key={field.path}
      name={field.name} path={field.path} purpose={field.purpose} useCase={field.useCase}
      exampleValue={field.example} exampleLabel={field.exampleLabel}
      exampleStatus={field.exampleStatus} exampleUrl={field.exampleUrl} observed={observed || dexObserved}
      showNullValue={observed || dexObserved} language={language} />)}</div>
    {coingeckoObserved && <section className="source-response-case"><strong>{say('爬虫另加的字段', 'Crawler-added field')}</strong>
      <div className="kaito-tool-fields"><SourceFieldCard name={say('采集时间', 'collected_at')}
        path="collected_at" useCase={say('爬虫写入消息时添加，用于区分采集时间和上游更新时间。', 'Added by the crawler to distinguish collection time from upstream update time.')}
        exampleStatus="unavailable" language={language} /></div></section>}
    {showRecordExample && observed && <section className="source-response-case"><strong>{say('实际返回案例', 'Observed response example')}</strong><p>{say('一次上游 API 查询；不等于爬虫已采集。', 'One upstream API response; it does not prove crawler collection.')} {data.upstream_response.retrieved_at}</p><pre>{showValue(response)}</pre>{data.upstream_response.url && <a href={data.upstream_response.url} target="_blank" rel="noopener noreferrer">{say('上游查询地址', 'Upstream request URL')}</a>}</section>}
    {showRecordExample && dexObserved && <section className="source-response-case"><strong>{say('实际返回案例', 'Observed response example')}</strong><p>{say(`接口返回 ${dexSample.returned_pair_count} 个交易对；爬虫代码只取第一条。本例是 ${dexSample.pair.chainId} 上的 ${dexSample.pair.baseToken?.symbol}/${dexSample.pair.quoteToken?.symbol}，不能根据代币地址假定它来自某条链。`, `The endpoint returned ${dexSample.returned_pair_count} pairs; crawler code keeps the first. This example is ${dexSample.pair.baseToken?.symbol}/${dexSample.pair.quoteToken?.symbol} on ${dexSample.pair.chainId}.`)} {dexSample.retrieved_at}</p><pre>{showValue(dexSample.pair)}</pre><a href={dexSample.url} target="_blank" rel="noopener noreferrer">{say('上游查询地址', 'Upstream request URL')}</a></section>}
    {showRecordExample && !observed && !dexObserved && fixture && <section className="source-response-case"><strong>{say('测试夹具案例', 'Test fixture example')}</strong><p>{say('这是测试文件中的转换结果，不是真实运行记录。', 'This is a transformed test fixture, not a live record.')}</p><pre>{showValue(data.record_example.message)}</pre>{data.record_example.source_url && <a href={data.record_example.source_url} target="_blank" rel="noopener noreferrer">{say('测试文件来源', 'Fixture source')}</a>}</section>}
    {showRecordExample && !observed && !dexObserved && !fixture && <section className="source-response-case"><strong>{say('使用思路', 'Design idea')}</strong><p>{say('先从字段中确认对象、时间和所需数值；取得实际返回记录后，再核验字段和计算方式。', 'Choose the entity, time and measures from the field definitions; verify them against a real response before calculating a signal.')}</p></section>}
  </section>;
}
