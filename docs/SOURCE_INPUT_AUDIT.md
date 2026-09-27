# 上游操作输入核对

核对日期：2026-09-27。输入定义由 [`catalog/source-inputs.v1.json`](../catalog/source-inputs.v1.json) 维护，构建时并入 [`catalog/source-contracts.v1.json`](../catalog/source-contracts.v1.json)。下表的数量是调用参数，不含认证密钥；输出数量是当前契约已列字段，其中 Kaito 仅为小样本已见下限。字段声明和 API 返回样本均不证明爬虫已产生记录。

Kaito 参数的历史参考来自 MetaSearch-IO 的 [`kaito-mcp-server` 仓库提交 d48aad2](https://github.com/MetaSearch-IO/kaito-mcp-server/tree/d48aad2)，提交时间为 2026-04-01。该仓库于 2026-04-02 删除了本地工具实现并改为代理结构。旧版工具名与已采样的在线 MCP 也有部分差异，因此下表的 Kaito 数量不代表当前在线服务；当前输入数量仍需通过实时 `tools/list` 核对。

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
| Kaito 社交数据 | `kaito.mcp.kaito_entities` 对象资料 | 0（旧版） | 2（旧版） | 4 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_narratives` 叙事资料 | 0（旧版） | 2（旧版） | 3 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_feeds` 社交动态 | 未知 | 未知 | 12 | 待核对 |
| Kaito 社交数据 | `kaito.mcp.kaito_search` 内容搜索 | 未知 | 未知 | 12 | 待核对 |
| Kaito 社交数据 | `kaito.mcp.kaito_advanced_search` 高级内容搜索 | 0（旧版） | 30（旧版） | 12 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_twitter_user_metadata` X 用户资料 | 1（旧版） | 0（旧版） | 10 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_ict_impressions` 高影响力账号曝光量 | 未知 | 未知 | 6 | 待核对 |
| Kaito 社交数据 | `kaito.mcp.kaito_sentiment_entity` 对象情绪走势 | 1（旧版） | 7（旧版） | 3 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_engagement` 对象互动量走势 | 0（旧版） | 4（旧版） | 2 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mentions` 对象提及量走势 | 0（旧版） | 4（旧版） | 1 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity` 对象关注份额走势 | 1（旧版） | 3（旧版） | 1 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_by_account` 对象账户关注份额 | 1（旧版） | 2（旧版） | 5 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_events` 候选事件 | 1（旧版） | 8（旧版） | 15 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_arena` 对象关注份额排名 | 0（旧版） | 7（旧版） | 4 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_entity_delta` 对象关注份额变化 | 0（旧版） | 3（旧版） | 5 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_following_market` 高关注度账号关注市场 | 0（旧版） | 10（旧版） | 未核实 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_followers` 高关注度粉丝 | 0（旧版） | 4（旧版） | 6 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_smart_following` 高关注度账号关注对象 | 0（旧版） | 3（旧版） | 4 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_mindshare_narrative` 叙事关注份额走势 | 1（旧版） | 2（旧版） | 3 | 旧版代码参考；线上未知 |
| Kaito 社交数据 | `kaito.mcp.kaito_market_sentiment` 市场情绪 | 未知 | 未知 | 3 | 待核对 |
| Kaito 社交数据 | `kaito.mcp.kaito_tweet_engagement_info` 推文互动信息 | 1（旧版） | 0（旧版） | 12 | 旧版代码参考；线上未知 |
| RSS 新闻 | `rss.item` RSS 新闻条目 | 1 | 0 | 7 | 产品采集设计 |
| Taoli 资金费率页面 | `taoli.funding_page` 页面资金费率表 | 未知 | 未知 | 未核实 | 待核对 |
| Telegram Bot 消息 | `telegram.bot.message` Bot 消息 | 0 | 4 | 12 | 官方文档 |
| Telegram Telethon 消息 | `telegram.telethon.message` Telethon 消息 | 0 | 0 | 10 | 产品采集设计 |

## #029 叙事资料

[`kaito_narratives` 旧版代码](https://github.com/MetaSearch-IO/kaito-mcp-server/blob/d48aad2/src/tools/reference-lookup.ts)列出 `query` 和 `limit` 两个可选输入，必填输入为 0；这是 2026-04-01 的历史实现，不是当前在线 MCP 的确认结果。只浏览支持的叙事时，可不传参数；查找某个主题时可传 `query=AI`，并用 `limit` 控制最多返回多少条。旧版代码说明搜索默认最多 20 条、浏览默认最多 50 条，`limit` 允许 1–100；实时 MCP 的 `inputSchema` 尚需复核。

当前列出的 `description`、`fullname`、`narrative` 是已保存 MCP 返回样本中出现的 3 个记录字段，不是该工具完整的输出 schema。不能把输出字段数当作输入参数数。

## 尚待补证据

- `kaito_feeds`、`kaito_search`、`kaito_ict_impressions`、`kaito_market_sentiment`：保存的样本没有 `inputSchema`，公开代理快照没有相同工具；输入数量暂记未知。
- Taoli 页面：没有可靠的公开参数化接口说明，输入数量未知。
- Telegram Telethon Message 是对象类型，不对应一个确定的调用方法；采集方法选定后再记录参数。
- Kaito 其余操作的参数来自公开代理快照，仍需和实时 `tools/list` 逐项比对，尤其注意工具改名后的对应关系。
