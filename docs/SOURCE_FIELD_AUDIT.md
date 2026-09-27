# 数据来源字段依据核对

核对日期：2026-09-27。本产品的上游来源契约是 [`catalog/source-contracts.v1.json`](../catalog/source-contracts.v1.json)。Few Understand V2 快照基于提交 `23a854c2a02e6b52e424844648d4026737361caa`。本次对照了该仓库的爬虫目录、V2 的 8 个 source / 36 个 operation / 32 个 record type、留存的上游响应，以及能公开核对的上游文档。逐来源的界面说明与链接保存在 [`catalog/source-provenance.json`](../catalog/source-provenance.json)。

## 先区分三层字段

1. **上游接口或网页字段**：文档列出的可能响应，与调用参数和版本有关。
2. **爬虫输出字段**：代码可能过滤、重命名、展开或新增字段。V2 主要描述这一层。
3. **留存的返回样本字段**：只能证明一次响应出现过什么；不能替代完整输出契约，也不能证明爬虫已发送消息。

当前 V2 的 `observed` 均为 `not_observed`；不能把 API 样本当作 Redpanda 中已采集记录。

Kaito MCP 另公开 `kaito://tokens` 和 `kaito://narratives` 两个参考资源。它们是读取支持标识的目录，不是 `kaito_entities` / `kaito_narratives` 工具调用，也不是已部署的业务表。应用契约现分别列出两个资源，但尚无 `resources/read` 返回样本，因此不列推测字段。

Binance 爬虫实际调用的九个路径为 `/fapi/v1/exchangeInfo`（发现交易对）、`/fapi/v1/klines`、`/fapi/v1/openInterest`、`/fapi/v1/premiumIndex`、`/futures/data/openInterestHist`、`/futures/data/globalLongShortAccountRatio`、`/futures/data/topLongShortAccountRatio`、`/futures/data/topLongShortPositionRatio`、`/futures/data/takerlongshortRatio`。因此查看某个 Binance 节点时，应对照它自己的接口响应与转换函数，而不是把九个接口并成一套字段。

| 来源 | V2 记录类型 | 本次能核对的字段依据 | 当前展示范围与差异 |
| --- | ---: | --- | --- |
| [Binance USDⓈ-M](https://developers.binance.com/en/docs/catalog) | 8 | 9 个 REST 操作由 [`binance_futures_transform.py`](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/binance-futures/binance_futures_transform.py) 映射；`exchangeInfo` 用于发现交易对，其余 8 个生成记录。 | 145 个 V2 字段项属于 8 种**转换后**记录，不是 145 个原始 REST 字段。V2 标 `exact` 的是爬虫消息结构。仅 `openInterest` 留有一次真实上游响应样本。 |
| [CoinGecko `/coins/markets`](https://docs.coingecko.com/reference/coins-markets) | 1 | [爬虫代码](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/coingecko/spider.py)与一次留存的真实上游响应。 | 界面列本次响应中的 26 个原始键；代码会删 `roi`、`image`、`ath`、`atl`，并加入 `collected_at`。官方文档还有需参数才能出现的可选字段，不能说样本是完整 API schema。 |
| [DEX Screener](https://docs.dexscreener.com/api/reference) | 1 | [爬虫代码](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/dexScreener/main.py)先读网站 WebSocket，再请求 `/latest/dex/tokens/{address}`，只保存 `pairs[0]`。本次留存了[该路径的一条真实 pair 样本](../catalog/dexscreener-upstream-sample.json)。 | V2 的 `root` 是开放对象；界面现逐项展开本次 `pairs[0]` 的全部路径。公开文档列有相近的 pair 对象，但不能用另一个端点的 schema 冒充此 WebSocket/旧式路径的完整返回。该请求返回 30 个 pair，第一条位于 PulseChain，表明仅凭代币地址不能推断所选链。 |
| [Kaito MCP](https://github.com/MetaSearch-IO/kaito-mcp-server) | 18 | [爬虫代码](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/kaito-social-spider/spider.py)和已保存的 MCP 小样本；详见 [Kaito 核对](KAITO_MCP_FIELD_AUDIT.md)。 | MCP `tools/list` 没有 `outputSchema`，界面列出的只能是样本中出现的字段下限。V2 的 1,314 个字段项包含多记录类型重复的条件候选字段，不是 1,314 个 MCP 返回字段。21 个 MCP 工具中有 2 个未对应 V2 记录类型。 |
| [RSS 2.0](https://www.rssboard.org/rss-specification) | 1 | [`parser.py`](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/crypto-rss-collector/src/parser.py)从 feedparser 结果挑选并生成六个键。 | V2 的六个字段是爬虫输出结构；RSS item 允许更多元素与扩展命名空间。 |
| [Taoli 页面](https://taoli.tools/) | 1 | [`spider.py`](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/taoli-spider/spider.py)按页面行内 span 位置抽八个英文键，转换时增加 `collected_at`。 | 未找到公开字段 API 契约。V2 的九项是爬虫处理结构；页面改版可能改变位置或使抓取失败。 |
| [Telegram Bot API Message](https://core.telegram.org/bots/api#message) | 1 | 官方 Message 定义和 [`tg-spider/spider.py`](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/tg-spider/spider.py)。 | V2 的 23 个字段项是爬虫挑选和嵌套后的结构；官方 Message 对象还有许多未采集的可选字段。 |
| [Telethon Message](https://docs.telethon.dev/en/stable/quick-references/objects-reference.html#message) | 1 | Telethon 官方对象文档和 [`tg-spider-telethon/spider.py`](https://github.com/cyberight-cap/fewunderstand/blob/23a854c2a02e6b52e424844648d4026737361caa/spider/tg-spider-telethon/spider.py)。 | V2 的 19 个字段项是爬虫整理后的结构，不是 Telethon Message 所有属性。 |

## 需要进一步补证据的地方

- **Kaito**：要列全各工具响应，需要 MCP 提供方发布 `outputSchema`，或取得覆盖参数分支和多条记录的原始响应。当前 1Password CLI 未登录，暂不能重新取样；已修正采样脚本，下一次会合并所有返回记录中的字段。
- **DEX Screener**：已保存该查询的 `pairs[0]` 原始对象，足以列出本次第一条 pair 的全部字段。仍需要现有 WebSocket 与 `/latest/dex/tokens/{address}` 的官方契约或更多不同地址样本，才能确认所有可能字段；公开文档中的相近 pair schema 不能冒充该路径的完整输出契约。
- **Taoli**：若有官方接口或结构化数据文档，应替换页面位置推断；目前以爬虫代码作为准确依据。
- **CoinGecko**：界面已标出四个被爬虫删除的上游字段及新增的 `collected_at`。要设计这些被删字段的指标，需先改爬虫并验证产出。

本次在 SignalStudio 定义了上游契约与本地读取 API；Few Understand 的爬虫尚未按这份契约改造或核验。其 V2 不再是本产品的上游字段权威来源。
