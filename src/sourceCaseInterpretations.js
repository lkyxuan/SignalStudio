import interpretations from '../catalog/kaito-advanced-search-interpretations.v1.json';

// Interpretations of this captured #2012 sample. Keep these separate from the
// upstream response: they describe what the saved call shows, not API fields.
const CAPTURED_AT = [
  '2026-09-28T11:51:08.784755+00:00',
  '2026-09-28T11:51:09.852876+00:00',
  '2026-09-28T11:51:10.755497+00:00',
  '2026-09-28T11:51:11.738735+00:00',
];

const CALLS_ZH = [
  '这次用 Ethereum 搜索，请求中的 size 是 1，实际返回了 50 条 X 帖子，发布时间从 8 月 31 日到 9 月 27 日。这里拿到的是与搜索词相关的内容线索；size 在这次调用中没有把返回限制为 1 条。',
  '这次按 BTC 代币筛选 X 帖子，并要求按 Smart Engagement 从高到低排序。实际返回 50 条，数值确实依次下降，首条为 439；虽然请求 size=2，也没有只返回 2 条。Smart Engagement 可帮助优先查看高关注内容，但帖子中的事实仍要回原文核对。',
  '这次用“bitcoin etf”搜索 9 月 1 日至 28 日的新闻，请求 size=2，实际返回 50 条，发布时间落在 9 月 21 日至 26 日。这是本次返回的 50 条结果，不能据此断定其他日期没有新闻；下方可逐条看每篇新闻说了什么。',
  '这次要求搜索 Ethereum 的 X 帖子，并传入看涨情绪、至少 100 个赞等筛选条件。实际返回 50 条；首条仍是 @0xQuit 的撤销授权提醒，并非明显的看涨观点。返回记录没有点赞数或情绪标签，单凭这份响应无法核实筛选条件是否逐条成立。',
];

const INPUTS_ZH = [
  'query=Ethereum：按 Ethereum 这个词搜索内容。size=1：请求 1 条结果；这只是发给接口的值，是否生效要看实际返回。其余参数本次没有传入。',
  'tokens=BTC：把主题限定为 Kaito 识别的 BTC 对象。sources=Twitter：只请求 X 帖子。sort_by=smart_engagement、sort_order=desc：要求按高质量账号互动数从高到低排序。size=2：请求 2 条。',
  'keyword=bitcoin etf：用这组词搜索。sources=News：只请求新闻。min_created_at 和 max_created_at：限定发布时间从 9 月 1 日 00:00 UTC 到 9 月 28 日 00:00 UTC，后者不是 9 月 28 日全天。sort_by=created_at：要求按发布时间排序；本次没有传 sort_order。size=2：请求 2 条。',
  'query=Ethereum：搜索 Ethereum。sources=Twitter、tweet_type=tweet：请求 X 上的普通帖。sentiment_type=bullish：要求筛出整条内容被判为看涨的帖子。min_like_count=100：要求至少 100 个赞。size=2：请求 2 条；返回中没有逐条点赞数或情绪标签，无法只靠返回核实这两个筛选条件。',
];

export function interpretInput(example, index, language) {
  if (language === 'zh-CN' && example?.observed_at === CAPTURED_AT[index]) return INPUTS_ZH[index];
  return language === 'zh-CN'
    ? '上方 JSON 是这次实际发送的参数；下方逐项解释参数含义。未传的参数没有参与这次请求。'
    : 'The JSON above contains the parameters sent in this call. The guide below explains each available input.';
}

export function interpretCall(example, index, language) {
  const rows = example?.response?.results;
  if (!Array.isArray(rows)) return '';
  if (language === 'zh-CN' && example.observed_at === CAPTURED_AT[index]) return CALLS_ZH[index];
  return language === 'zh-CN'
    ? `这次按上方参数请求，实际返回 ${rows.length} 条内容。请逐条查看返回值；本次调用没有预先写好的中文解读。`
    : `This call returned ${rows.length} records for the request shown above. Review the returned values and original sources before using them.`;
}

export function interpretRecord(row, language) {
  if (!row) return '';
  if (language === 'zh-CN' && interpretations.records[row.id]) return interpretations.records[row.id];
  return language === 'zh-CN'
    ? '这条内容尚未生成中文解读。上方是 API 返回的原始摘要，可打开原文链接查看完整内容。'
    : 'No interpretation has been generated for this record. The original API summary is shown above.';
}
