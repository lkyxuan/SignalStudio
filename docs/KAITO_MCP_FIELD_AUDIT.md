# Kaito MCP 实际返回字段核对

核对日期：2026-09-27。使用用户授权的本机 1Password CLI，从 `fewunderstand` 保险库读取 Kaito 凭据，向 `https://bff.kaito.ai/api/mcp` 发起 `tools/list` 和小样本 `tools/call`。密钥没有写入本仓库。可审查的字段路径、中文用途和省略文本/账号标识后的实际数值片段保存在 [`catalog/kaito-mcp-observed.json`](../catalog/kaito-mcp-observed.json)，逐字段中英文表保存在 [`catalog/kaito-mcp-fields.zh.csv`](../catalog/kaito-mcp-fields.zh.csv)。

这次远端 `tools/list` 给出 **21 个工具**，全部没有 `outputSchema`。下面的计数是**实测响应中的记录行或时间序列字段下限**，不是完整字段定义。本次保存清单的生成脚本只读取每次采样的首条结果，因此其他结果独有字段可能漏列；现已修正脚本，使今后重新采样时合并所有结果行的字段。日期键合并为一个时间序列字段；搜索结果外层的 `returned` 等响应元信息不计入记录行。为保护账号与内容信息，保存到仓库的案例值只保留安全数值和少量非敏感文本，但字段名仍列出。API 有响应也不能证明 fewunderstand 爬虫已采集或写入 Redpanda。

| MCP 工具 | 本次观察到的字段 | V2 记录类型 |
| --- | ---: | --- |
| `kaito_entities` | 4 | `kaito_entity_reference` |
| `kaito_narratives` | 3 | `kaito_narrative_reference` |
| `kaito_feeds` | 12 | `kaito_feed_item` |
| `kaito_search` | 12 | `kaito_search_result` |
| `kaito_advanced_search` | 12 | `kaito_search_result` |
| `kaito_tweet_engagement_info` | 12 | `kaito_tweet_engagement_snapshot` |
| `kaito_twitter_user_metadata` | 10 | `kaito_twitter_user_metadata` |
| `kaito_sentiment_entity` | 3 | `kaito_entity_sentiment_timeseries` |
| `kaito_engagement` | 2 | `kaito_entity_engagement_timeseries` |
| `kaito_mentions` | 1 | `kaito_entity_mentions_timeseries` |
| `kaito_mindshare_entity` | 1 | `kaito_entity_mindshare_timeseries` |
| `kaito_mindshare_entity_by_account` | 5 | `kaito_entity_account_mindshare` |
| `kaito_events` | 15 | `kaito_event` |
| `kaito_mindshare_entity_arena` | 4 | `kaito_entity_mindshare_ranking` |
| `kaito_mindshare_entity_delta` | 5 | `kaito_entity_mindshare_delta` |
| `kaito_smart_following_market` | 无记录 | `kaito_smart_following_market` |
| `kaito_smart_followers` | 6 | `kaito_smart_followers_snapshot` |
| `kaito_smart_following` | 4 | `kaito_smart_following_snapshot` |
| `kaito_mindshare_narrative` | 3 | `kaito_narrative_mindshare_timeseries` |
| `kaito_market_sentiment` | 3 | **V2 缺失** |
| `kaito_ict_impressions` | 6 | **V2 缺失** |

## V2 与爬虫需要核对

1. V2 的 18 个 Kaito 记录类型把 33 个 `data.metrics.*` 条件候选路径重复列在各类型下。这些是转换后字段，不是 MCP 返回字段；不能把每类的 73 条目录项当作功能字段数。界面现在把 V2 规范化目录与 MCP 实测字段分开呈现。
2. MCP 比 V2 多 `kaito_market_sentiment` 和 `kaito_ict_impressions` 两个有实际响应的工具。上游需要决定是否将它们纳入采集，并在 V2 增加记录类型、字段与状态；本应用不会擅自把它们写进权威 V2。
3. `kaito_smart_following_market` 的实时 `inputSchema` 没有必填参数；无参数时默认 `24h`。无参数、`30d`、`all_dates`，以及 `all_dates` 加 `sort_by=smart_followers`/`sort_order=desc` 的调用均成功但返回空数组。这不证明工具故障，也不是因为漏传必填参数；需要上游给出非空样本或输出 schema 才能计算它的记录字段数。
4. 已同步核对 2026-09-27 远端 `dev`：`spider/kaito-social-spider/spider.py` 仍给 `kaito_mindshare_entity` 传 `entity`/`window`，而实时 MCP 要求 `token`。使用代码中的参数形状做最小调用，MCP 明确返回 `-32602`、`token` 为必填；因此若测试网运行的也是这一版代码，候选对象进入该调用时采集流程会失败。`kaito_feeds` 虽传 `limit` 而不是文档列出的 `size`，实测仍能返回数据，不能把所有参数差异都说成会报错。应逐工具以实时 `inputSchema` 校验采集参数，并加小规模集成测试。这个核对没有检查测试网正在运行的容器版本或 Redpanda 消息。
5. `fewunderstand/spider/kaito-social-spider/kaito_transform.py` 的 `iter_payload_items` 目前只把 `results` 等列表拆成行；实际 `kaito_entities`/`kaito_narratives` 返回 `matches`，`kaito_twitter_user_metadata` 返回 `listData`，`kaito_tweet_engagement_info` 返回 `result`。这些响应会被当成外层包装记录，无法得到预期的逐项记录。
6. `kaito_sentiment_entity` 返回列式数组，当前转换器对列表只保留字典项，因而这个实际响应不会产出规范化记录。`kaito_engagement`、`kaito_mentions`、`kaito_mindshare_entity` 返回按日期索引的对象；转换器没有将每日数值展开为 `data.metrics`。上游应针对每种实际响应形状补转换和测试，然后更新 V2 的 `emitted`/`observed` 证据。

完整输出 schema 仍需 MCP 提供方声明，或按各参数分支继续采样。此处字段数只作为用户设计指标时可见的已证实下限。
