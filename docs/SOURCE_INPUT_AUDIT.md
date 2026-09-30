# 上游操作输入核对

核对日期：2026-09-28。输入定义由 [`catalog/source-inputs.v1.json`](../catalog/source-inputs.v1.json) 维护，构建时并入 [`catalog/source-contracts.v1.json`](../catalog/source-contracts.v1.json)。下表的数量是调用参数，不含认证密钥；输出数量是当前契约已列字段，其中 Kaito 仅为小样本已见下限。字段声明和 API 返回样本均不证明爬虫已产生记录。

Kaito 输入参数已按 2026-09-28 在线 MCP `tools/list` 的 `inputSchema` 核对，原始 schema 保存于 [`catalog/kaito-mcp-input-schemas.json`](../catalog/kaito-mcp-input-schemas.json)。下表的必填/可省略描述接口允许的参数，不表示这些参数已在某次调用中发送。实际发送值和同次返回见 [`catalog/kaito-mcp-call-examples.json`](../catalog/kaito-mcp-call-examples.json)；下表也不是所有业务调用组合的验证结果。

| 来源 | 操作 | 必填输入 | 可选输入 | 已列返回字段 | 输入依据 |
| --- | --- | ---: | ---: | ---: | --- |
| Binance U 本位合约 | `binance.usdm.exchangeInfo` 发现可交易合约 | 0 | 0 | 未核实 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.globalLongShortAccountRatio` 全市场账户多空比 | 2 | 3 | 5 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.klines` K 线行情 | 2 | 3 | 12 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.openInterest` 当前未平仓量 | 1 | 0 | 3 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.openInterestHist` 未平仓量历史 | 2 | 3 | 5 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.premiumIndex` 标记价格与资金费率 | 0 | 1 | 8 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.takerlongshortRatio` 主动买卖量比 | 2 | 3 | 4 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.topLongShortAccountRatio` 头部账户多空比 | 2 | 3 | 5 | 官方文档 |
| Binance U 本位合约 | `binance.usdm.topLongShortPositionRatio` 头部持仓多空比 | 2 | 3 | 5 | 官方文档 |
| CoinGecko 市场数据 | `coingecko.coins_markets` 市场数据列表 | 1 | 13 | 34 | 官方文档 |
| DEX Screener 交易对 | `dexscreener.token_pairs_by_address` 按链和代币地址查询交易对 | 2 | 0 | 32 | 官方文档 |
| Kaito 社交数据 | `kaito.mcp.kaito_entities` 对象资料 | 0 | 2 | 4 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_narratives` 叙事资料 | 0 | 2 | 3 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_feeds` 社交动态 | 0 | 4 | 12 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_search` 内容搜索 | 1 | 1 | 12 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_advanced_search` 高级内容搜索 | 0 | 32 | 12 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_twitter_user_metadata` X 用户资料 | 1 | 0 | 10 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_ict_impressions` 高影响力账号曝光量 | 1 | 2 | 6 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_sentiment_entity` 对象情绪走势 | 1 | 7 | 3 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_engagement` 对象互动量走势 | 0 | 4 | 2 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mentions` 对象提及量走势 | 0 | 4 | 1 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity` 对象关注份额走势 | 1 | 3 | 1 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_by_account` 对象账户关注份额 | 1 | 2 | 5 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_events` 候选事件 | 1 | 8 | 15 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_arena` 对象关注份额排名 | 0 | 7 | 4 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_delta` 对象关注份额变化 | 0 | 3 | 5 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_following_market` 高关注度账号关注市场 | 0 | 10 | 已观察 5 项首条字段 | 在线 MCP inputSchema 与 `duration="24h"` 实际调用 |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_followers` 高关注度粉丝 | 0 | 4 | 6 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_following` 高关注度账号关注对象 | 0 | 3 | 4 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_narrative` 叙事关注份额走势 | 1 | 2 | 3 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_market_sentiment` 市场情绪 | 0 | 2 | 3 | 在线 MCP inputSchema |
| Kaito 社交数据 | `kaito.mcp.kaito_tweet_engagement_info` 推文互动信息 | 1 | 0 | 12 | 在线 MCP inputSchema |
| RSS 新闻 | `rss.item` RSS 新闻条目 | 1 | 0 | 7 | 产品采集设计 |
| Taoli 资金费率页面 | `taoli.funding_page` 页面资金费率表 | 0 | 5 项页面筛选控件 | 8 项页面显示列 | 2026-09-28 实际网页观察；非 API 契约 |
| Telegram Bot 消息 | `telegram.bot.message` Bot 消息 | 0 | 4 | 12 | 官方文档 |
| Telegram Telethon 消息 | `telegram.telethon.message` Telethon 消息 | 0 | 0 | 10 | 产品采集设计 |

## #2025 叙事资料

在线 `kaito_narratives` 的 `inputSchema` 列出 `query` 和 `limit` 两个可选输入，必填为 0。当前已保存的返回样本出现 `description`、`fullname`、`narrative` 三个记录字段；它们是输出样本下限，不是输入参数。

## 尚待补证据

- Kaito 在线 MCP 的 `tools/list` 没有声明 `outputSchema`；返回字段仍需更多参数分支的采样或上游完整 schema。
- Taoli 页面已实测币种搜索、交易所筛选、未平仓额及日成交额下限、间隔筛选这 5 项页面控件；尚无可靠的公开参数化 API 说明，不能把网页控件当作 API 输入契约。
- Telegram Telethon Message 是对象类型，不对应一个确定的调用方法；采集方法选定后再记录参数。
