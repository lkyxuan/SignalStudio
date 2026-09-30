import advancedInterpretations from '../catalog/kaito-advanced-search-interpretations.v1.json';
import rssInterpretations from '../catalog/rss-case-interpretations.v1.json';

const number = value => Number(value).toLocaleString('zh-CN');
const value = item => item == null ? '未返回' : String(item);
const percent = item => `${(Number(item) * 100).toFixed(2)}%`;

function rssRows(xml) {
  if (typeof xml !== 'string' || !xml.trim().startsWith('<')) return [];
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  return Array.from(document.querySelectorAll('channel > item')).map(item => {
    const field = name => item.querySelector(name)?.textContent?.trim() || '';
    return { title: field('title'), link: field('link'), pubDate: field('pubDate'),
      description: field('description').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() };
  });
}

function tabularRows(rows) {
  const byName = Object.fromEntries(rows.map(row => [row[0], row.slice(1)]));
  if (!byName.timestamp) return [];
  return byName.timestamp.map((date, index) => Object.fromEntries(
    Object.entries(byName).map(([name, values]) => [name === 'timestamp' ? 'date' : name, values[index]])));
}

export function otherResponseRows(operationId, example) {
  const response = example?.response;
  if (!example?.response_complete && !example?.observation_complete && !example?.response_excerpt) return [];
  if (operationId === 'rss.item') return rssRows(response);
  if (Array.isArray(response)) {
    if (response.length && Array.isArray(response[0]) && typeof response[0][0] === 'string' && response.some(row => row[0] === 'timestamp')) return tabularRows(response);
    if (operationId === 'binance.usdm.klines') return response.map(row => ({ open_time: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5], close_time: row[6], raw: row }));
    return response;
  }
  if (!response || typeof response !== 'object') return [];
  for (const name of ['results', 'matches', 'listData', 'following', 'top_gainer', 'symbols', 'rows']) {
    if (Array.isArray(response[name])) return response[name];
  }
  if (response.result && typeof response.result === 'object') return [response.result];
  if (response.total_engagement && typeof response.total_engagement === 'object')
    return Object.entries(response.total_engagement).map(([date, total_engagement]) => ({ date, total_engagement, smart_engagement: response.smart_engagement?.[date] }));
  if (response.mindshare && typeof response.mindshare === 'object')
    return Object.entries(response.mindshare).map(([date, mindshare]) => ({ date, mindshare }));
  if (Object.keys(response).length && Object.keys(response).every(key => /^\d{4}-\d{2}-\d{2}$/.test(key)))
    return Object.entries(response).map(([date, count]) => ({ date, count }));
  return [response];
}

export function otherRowLabel(row, index) {
  if (row?.earliestRef && row?.description) return `${index + 1} · ${row.date || '日期未标明'} · ${String(row.description).slice(0, 45)}`;
  const name = row?.title || row?.market || row?.symbol || row?.ticker || row?.token || row?.narrative ||
    row?.username || row?.baseToken?.symbol && `${row.baseToken.symbol}/${row.quoteToken?.symbol || '?'}` ||
    row?.date || row?.pubDate || row?.id || row?.open_time || '';
  return `${index + 1} · ${String(name).slice(0, 70)}`;
}

export function interpretOtherCall(operation, example, rows) {
  if (example?.response_excerpt) return `这次真实请求返回 ${example.response_count} 条账号线索，这里保存并展示其中 ${rows.length} 条。下游 #4001 和 #3002 用这两条真实输入定义判断与目标表行；尚未验证 Redpanda 消费或后台查写表。`;
  if (!example?.response_complete && !example?.observation_complete) return example?.explanation_zh || operation?.call_status_note_zh ||
    '这张卡片还没有保存同一次请求和完整返回。';
  const id = operation.id;
  const response = example.response;
  const first = rows[0];
  if (id === 'binance.usdm.exchangeInfo') return `这次未传筛选参数，Binance 返回 ${number(response.symbols?.length || 0)} 个合约及交易规则。可以从列表里确认交易对是否存在、状态和精度；这是接口目录，不表示系统已跟踪这些合约。`;
  if (id === 'binance.usdm.klines') return first ? `这次查询 ${example.request.symbol} 的 ${example.request.interval} K 线，实际返回 ${rows.length} 根。所选 K 线开盘 ${value(first.open)}、最高 ${value(first.high)}、最低 ${value(first.low)}、收盘 ${value(first.close)}，成交量 ${value(first.volume)}。` : '这次没有返回 K 线。';
  if (id === 'binance.usdm.openInterest') return `这次查询 ${example.request.symbol} 的当前未平仓量，返回 ${value(response.openInterest)}。它是调用时刻的快照；要判断增减，需与其他时间点比较。`;
  if (id === 'binance.usdm.premiumIndex') return `这次查询 ${example.request.symbol}，返回标记价格 ${value(response.markPrice)}、指数价格 ${value(response.indexPrice)}、上一期资金费率 ${value(response.lastFundingRate)}，还附带下次资金费率时间。`;
  if (id.startsWith('binance.usdm.') && first) {
    if (id.endsWith('openInterestHist')) return `这次查询 ${example.request.symbol} 的 ${example.request.period} 未平仓量历史，实际返回 ${rows.length} 个统计点；所选点的合约量为 ${value(first.sumOpenInterest)}，名义价值为 ${value(first.sumOpenInterestValue)}。`;
    if (id.endsWith('takerlongshortRatio')) return `这次查询 ${example.request.symbol} 的 ${example.request.period} 主动买卖量，实际返回 ${rows.length} 个统计点；所选点主动买入 ${value(first.buyVol)}、主动卖出 ${value(first.sellVol)}，买卖量比 ${value(first.buySellRatio)}。`;
    return `这次查询 ${example.request.symbol} 的 ${example.request.period} 多空分布，实际返回 ${rows.length} 个统计点；所选点做多账户占 ${percent(first.longAccount)}、做空账户占 ${percent(first.shortAccount)}，多空比 ${value(first.longShortRatio)}。不同卡片的口径分别是全市场账户、头部账户或头部持仓。`;
  }
  if (id === 'coingecko.coins_markets') return first ? `这次以 ${example.request.vs_currency} 计价查询 ${example.request.ids || '市场列表'}，返回 ${rows.length} 个币种；所选币种 ${first.name} 的价格为 ${value(first.current_price)}，市值为 ${value(first.market_cap)}，24 小时成交额为 ${value(first.total_volume)}。这是调用时刻的市场快照。` : '这次没有返回币种。';
  if (id === 'dexscreener.token_pairs_by_address') return `这次用链 ${example.request.chainId} 和代币地址查询，返回 ${rows.length} 个交易对。一个代币可对应多个交易所和报价币种；不能把第一行当成唯一市场。`;
  if (id === 'rss.item') return `这次读取 ${example.request.feed_url}，RSS 实际返回 ${rows.length} 篇条目。每条含标题、时间、链接等；是否与研究对象相关，需打开原文核对。`;
  if (id === 'taoli.funding_page') return `这次在 Taoli 网页搜索 ${example.request.coin_search || '全部币种'}，选择 ${example.request.exchange_filter}，实际可见 ${rows.length} 行市场数据。资金费率、未平仓额和成交额会随网页更新；这些是网页观察值，不是底层 API 返回。`;
  if (id === 'kaito.mcp.kaito_entities') return `这次搜索 ${example.request.query}，请求最多 ${example.request.limit} 条，实际返回 ${rows.length} 条匹配；所选结果的 Kaito 代号是 ${value(first?.token)}，可用于后续按对象查询。`;
  if (id === 'kaito.mcp.kaito_narratives') return `这次搜索 ${example.request.query} 叙事，实际返回 ${rows.length} 条匹配；所选叙事代号是 ${value(first?.narrative)}，可用于叙事关注份额查询。`;
  if (id === 'kaito.mcp.kaito_search' || id === 'kaito.mcp.kaito_feeds') return `这次${id.endsWith('feeds') ? '读取动态' : `搜索“${example.request.query}”`}，请求 ${example.request.size} 条，实际返回 ${rows.length} 条内容。下方可逐条查看原文摘要和中文解读；返回结果与查询主题的关系仍需逐条判断。`;
  if (id === 'kaito.mcp.kaito_events') return rows.length
    ? `这次查询 ${example.request.token} 的候选事件，实际返回 ${rows.length} 条。${example.request.start_date || example.request.end_date ? '日期条件按事件的结束日期筛选。' : '这次没有传日期条件。'}返回内容包含预测和可能发生的事项，不能直接当成已确认公告；可逐条查看最早参考资料和其他引用。`
    : `这次用 ${example.request.token}，并把事件结束日期限制在 ${example.request.start_date || '未设下界'} 至 ${example.request.end_date || '未设上界'}，Kaito 正常返回空列表 []。这表示这组条件下没有记录，不是请求失败；可能是日期范围太窄，也可能是该对象当前没有收录事件，单凭空列表无法确定原因。可以先只传 token 查看，再逐项增加日期、类型等筛选。`;
  if (id === 'kaito.mcp.kaito_ict_impressions') return `这次查询作者 ${example.request.author_id} 在 ${value(response.start_date)} 至 ${value(response.end_date)} 的曝光，返回 ${number(response.total_impressions)} 次展示和 ${number(response.tweet_count)} 条帖子；曝光不等于互动。`;
  if (id === 'kaito.mcp.kaito_tweet_engagement_info') { const item = response.result || {}; return `这次按推文 ID 查询互动：浏览 ${number(item.view_count)} 次、点赞 ${number(item.like_count)} 次、回复 ${number(item.reply_count)} 次、转发 ${number(item.retweet_count)} 次，高质量账号互动 ${number(item.smart_engagement_count)} 次。`; }
  if (id === 'kaito.mcp.kaito_smart_followers') return `这次查询 ${example.request.username || example.request.user_id} 在 ${value(response.date)} 的高质量粉丝数量，返回 ${number(response.num_of_smart_followers)}；这是账号粉丝统计，不是帖子互动量。`;
  if (id === 'kaito.mcp.kaito_twitter_user_metadata') return `这次按 X 用户 ID ${example.request.user_id} 查资料，返回 ${rows.length} 条，用于核对内容作者身份和账号规模。`;
  if (id === 'kaito.mcp.kaito_mindshare_entity_arena') return `这次查询 ${example.request.duration} 的对象关注份额排名，返回 ${rows.length} 个对象；首位是 ${value(first?.fullname || first?.ticker)}，份额 ${percent(first?.mindshare)}。这是讨论份额，不是价格涨幅。`;
  if (id === 'kaito.mcp.kaito_mindshare_entity_delta') return `这次查询 ${example.request.duration} 的关注份额变化，返回 ${rows.length} 个对象；首位 ${value(first?.fullname || first?.ticker)} 的变化值是 ${value(first?.change)}。需要回看内容才能解释变化原因。`;
  if (id === 'kaito.mcp.kaito_mindshare_entity_by_account') return `这次查询 ${example.request.token} 在 ${example.request.duration} 内的主要讨论账号，返回 ${rows.length} 条；所选账号 ${value(first?.username)} 的关注份额为 ${value(first?.mindshare)}。`;
  if (id === 'kaito.mcp.kaito_smart_following_market') return `这次查询 ${example.request.duration} 的高关注度账号关注变化，返回 ${rows.length} 条账号线索；它反映账号行为，不直接代表币价变化。`;
  if (id === 'kaito.mcp.kaito_smart_following') return `这次查询 ${example.request.username || example.request.user_id} 关注的账号，返回 ${rows.length} 条；可逐条看账号类别与关注日期。`;
  if (id === 'kaito.mcp.kaito_engagement') {
    const total = rows.reduce((sum, row) => sum + Number(row.total_engagement || 0), 0);
    const smart = rows.reduce((sum, row) => sum + Number(row.smart_engagement || 0), 0);
    return `这次按 ${example.request.token ? `Kaito 对象 ${example.request.token}` : `关键词“${example.request.keyword}”`} 查询互动，请求 ${example.request.start_date} 至 ${example.request.end_date}；实际返回 ${rows.length} 天（${rows[0]?.date || '—'} 至 ${rows.at(-1)?.date || '—'}），合计 ${number(total)} 次总互动、${number(smart)} 次 Smart Engagement。未返回的日期不计入合计。`;
  }
  if (id === 'kaito.mcp.kaito_mentions') return `这次请求 ${example.request.token || example.request.keyword} 的每日提及量，实际返回 ${rows.length} 天（${rows[0]?.date || '—'} 至 ${rows.at(-1)?.date || '—'}）；每天数值单独列出，不能把缺失日期当作零。`;
  if (id === 'kaito.mcp.kaito_mindshare_entity' || id === 'kaito.mcp.kaito_mindshare_narrative') return `这次查询 ${example.request.token || example.request.narrative} 的每日关注份额，实际返回 ${rows.length} 天（${rows[0]?.date || '—'} 至 ${rows.at(-1)?.date || '—'}）；这是相对讨论份额，不是帖子绝对数量。`;
  if (id === 'kaito.mcp.kaito_sentiment_entity' || id === 'kaito.mcp.kaito_market_sentiment') return `这次实际返回 ${rows.length} 个按天排列的情绪数据点（${rows[0]?.date || '—'} 至 ${rows.at(-1)?.date || '—'}）；每日分数需要结合日期看，不能当成整个时期的一个分数。返回日期与请求日期不一致时，应以实际返回为准。`;
  return `这次按左侧参数请求，实际返回 ${rows.length} 条可查看的记录。`;
}

const EXTRA_CONTENT = {
  'twitter-1733993801868300693': 'Portal 宣称正在连接不同链上的游戏，并把与 Solana、Polygon、Avalanche、Klaytn 的集成作为跨链游戏平台的一部分。这是项目宣传帖，适合作为其合作与产品方向的线索，集成状态需再核对。',
  'twitter-1802067336213533136': '这是一则 W-Coin 内容创作比赛公告，征集视频、表情包、画作和长帖，奖励可选 TON、SOL 或 ETH。它提到了 SOL 作为奖励币种，但并不是关于 Solana 项目本身的分析；说明这次搜索结果相关性需要人工判断。',
  'twitter-2104528688469647700': '作者称有人公开为 Bitget 事件相关资金清洗寻找协助，并把行为与先前 Kelp DAO 事件联系起来。这是作者的调查指称，属于安全事件线索；涉及归属和金额的说法应核对原帖及独立证据。',
  'twitter-2104213040937812262': '这条帖文转述 Apollo 首席经济学家的担忧：如果 AI 代理自动把家庭现金转往收益率更高的账户，银行可能失去低成本存款。这是对潜在金融行为的观点，不是已经发生银行挤兑的证据。',
};

const EVENT_CONTENT = {
  'twitter-1956398198622171138-0': '这条是对 2026 年末比特币价格区间的预测，提出 6 万至 8 万美元的不同可能值；它不是已确定会发生的日程事件。',
  'twitter-1975896595179659665-1': '这条讨论美国可能发放刺激支票的设想，并推测其与预算协调法案有关；是否实施仍不确定。',
  'twitter-1938933624583438535-0': '这条把 2026 年美国中期选举列为可能影响比特币相关政策的时间节点；选举本身有日期，政策影响只是待观察的判断。',
  'twitter-1927708328140148834-1': '这条讨论比特币 DeFi 的未来发展路线，属于愿景或路线图线索，不能从这一条推断具体功能会按时上线。',
  'twitter-1918316497757175871-3': '这条预计 OP_CAT 会在 2026 年末前并入 Bitcoin Core；这是待核实的技术进展预期，不代表合并已经确定。',
  'twitter-2023327524902859233-1': '这条涉及 Metaplanet 的 2026 财年业绩预测及其比特币业务计划；它是公司预测线索，不是比特币协议事件。',
  'twitter-1915626330600636722-1': '这条预测到 2026 年末上市公司持有的比特币总量可能达到 200 万至 300 万枚；这是机构持仓预测，不是已公布的未来事件。',
  'twitter-1976001223623881034-1': '这条称美国 GENIUS Act 可能在 2027 年初生效，讨论的是稳定币监管时间节点；具体法律状态和生效日应核对正式文件。',
  'twitter-2019863748476019037-0': '这条同样讨论 GENIUS Act 的生效及潜在市场影响，与另一条候选记录可能指向同一政策主题，需要去重核对。',
  'twitter-2039307286561038837-0': '这条称 Bitfarms 正转向 AI 基础设施业务，并预计 2027 年开始获得相关收入；属于公司转型线索，需核对公司公告。',
};

export function interpretOtherRow(operationId, row) {
  if (!row) return '';
  if (operationId === 'kaito.mcp.kaito_events') {
    const earliest = row.earliestRef?.created_at ? `本次返回中最早的参考资料发表于 ${row.earliestRef.created_at}，` : '本次未给出最早参考资料时间，';
    const content = EVENT_CONTENT[row.earliestRef?.id] || `Kaito 的事件摘要为“${String(row.description || '未提供文字说明').slice(0, 240)}”。`;
    return `${content} Kaito 标注的事件日期为 ${row.date || '未注明'}；${earliest}共附 ${row.reference_list?.length || 0} 条参考资料。earliestRef 只能指出 Kaito 收录资料中的最早一条，不能证明它是全网最早发现者；事件内容也要回查原文确认。`;
  }
  if (row.id && advancedInterpretations.records[row.id]) return advancedInterpretations.records[row.id];
  if (row.id && EXTRA_CONTENT[row.id]) return EXTRA_CONTENT[row.id];
  if (row.type === 'Twitter' || row.type === 'News') return `这条${row.type === 'News' ? '新闻' : '帖子'}的返回摘要是“${String(row.title || row.summary || '').slice(0, 180)}”。摘要可能被截断，具体说法应回原文核对。`;
  if (operationId === 'rss.item') return rssInterpretations.records[row.link] || `《${row.title}》发表于 ${row.pubDate}。订阅源摘要：${String(row.description || '').slice(0, 180)}。可打开原文核对完整内容。`;
  if (operationId === 'taoli.funding_page') return `${row.exchange} 的 ${row.market}：页面显示未平仓额 ${row.open_interest_display}、日成交额 ${row.daily_volume_display}、“1Y 资金费率” ${row.funding_rate_1y_display}、下次费率 ${row.next_funding_display}，结算间隔 ${row.funding_interval_display}。这是观察时刻的显示值。`;
  if (operationId === 'coingecko.coins_markets') return `${row.name}（${String(row.symbol || '').toUpperCase()}）在这次返回中的价格是 ${value(row.current_price)}，市值 ${value(row.market_cap)}，24 小时成交额 ${value(row.total_volume)}；这些是请求时的市场快照。`;
  if (operationId === 'binance.usdm.klines') return `这一根 K 线开盘 ${value(row.open)}、最高 ${value(row.high)}、最低 ${value(row.low)}、收盘 ${value(row.close)}，成交量 ${value(row.volume)}。时间戳对应这一根 K 线的起止时间。`;
  if (operationId === 'binance.usdm.openInterest') return `这条快照给出 ${row.symbol} 的未平仓合约数量 ${value(row.openInterest)}；time 是 Binance 返回的时间戳。`;
  if (operationId === 'binance.usdm.premiumIndex') return `标记价格 ${value(row.markPrice)}、指数价格 ${value(row.indexPrice)}，上一期资金费率 ${value(row.lastFundingRate)}；它们属于同一次报价快照。`;
  if (operationId === 'binance.usdm.openInterestHist') return `这一统计点的未平仓合约量为 ${value(row.sumOpenInterest)}，名义价值为 ${value(row.sumOpenInterestValue)}；timestamp 是统计时间。`;
  if (operationId === 'binance.usdm.takerlongshortRatio') return `这一统计点主动买入量 ${value(row.buyVol)}、主动卖出量 ${value(row.sellVol)}，买卖量比 ${value(row.buySellRatio)}。`;
  if (operationId.startsWith('binance.usdm.') && row.longShortRatio != null) return `这一统计点的多头占比 ${percent(row.longAccount)}、空头占比 ${percent(row.shortAccount)}，多空比 ${value(row.longShortRatio)}；具体是账户还是持仓口径要看卡片名称。`;
  if (operationId === 'dexscreener.token_pairs_by_address') return `${row.baseToken?.symbol || '?'} / ${row.quoteToken?.symbol || '?'} 在 ${row.dexId || '交易所'} 的交易对；价格 ${row.priceUsd || '未返回'} 美元，美元计流动性 ${row.liquidity?.usd ?? '未返回'}。不同交易对要分开比较。`;
  if (operationId === 'binance.usdm.exchangeInfo') return `${row.symbol} 的合约状态是 ${row.status || '未返回'}，基础资产 ${row.baseAsset || '未返回'}、计价资产 ${row.quoteAsset || '未返回'}；filters 中列出了下单限制。`;
  if (row.date && row.total_engagement != null) return `${row.date} 的总互动是 ${number(row.total_engagement)}，Smart Engagement 是 ${number(row.smart_engagement)}；这是一日的统计值。`;
  if (row.date && row.mindshare != null) return `${row.date} 的关注份额是 ${percent(row.mindshare)}，用于与其他日期或对象比较。`;
  if (row.date && row.count != null) return `${row.date} 的提及量是 ${number(row.count)} 次。`;
  if (row.date && row.sentiment_score != null) return `${row.date} 的情绪分数是 ${value(row.sentiment_score)}；应在同一统计口径下比较日期。`;
  if (operationId === 'kaito.mcp.kaito_tweet_engagement_info') return `这条推文浏览 ${number(row.view_count)} 次、点赞 ${number(row.like_count)} 次、回复 ${number(row.reply_count)} 次、转发 ${number(row.retweet_count)} 次。`;
  if (operationId === 'kaito.mcp.kaito_smart_followers') return `这次返回的高质量粉丝数是 ${number(row.num_of_smart_followers)}，统计日期 ${value(row.date)}。`;
  if (operationId === 'kaito.mcp.kaito_ict_impressions') return `作者在 ${value(row.start_date)} 至 ${value(row.end_date)} 的帖子合计获得 ${number(row.total_impressions)} 次曝光，共 ${number(row.tweet_count)} 条帖子。`;
  if (operationId === 'kaito.mcp.kaito_twitter_user_metadata') return `${row.name || row.username}（@${row.username}）的返回资料包括粉丝数 ${number(row.followers)}；可用于核对帖子作者身份。`;
  if (operationId === 'kaito.mcp.kaito_smart_following') return `@${row.username} 是所查询账号关注的对象；类别 ${value(row.category)}，记录日期 ${value(row.date)}。`;
  if (operationId === 'kaito.mcp.kaito_smart_following_market') return `@${row.username} 在本次市场关注变化列表中；其高质量粉丝变化需结合 followers 等返回字段读取。`;
  if (row.token || row.narrative) return `${row.fullname || row.display_name || row.symbol || '该对象'} 对应的 Kaito 代号是 ${row.token || row.narrative}，后续接口可用这个代号。`;
  if (row.rank != null && row.mindshare != null) return `${row.fullname || row.username || row.ticker || '该对象'} 排名 ${row.rank}，关注份额 ${percent(row.mindshare)}。`;
  return '这里展示的是本次实际返回的所选记录；字段可与完整 JSON 对照查看。';
}
