# Business table contracts

These are SignalStudio product table contracts. The saved #2030 call returned 100 accounts; two actual account records supply the X IDs below. The #1001/#1002 rows specify what the backend should produce for those inputs when #1002 has no prior mapping. The repeated-input case specifies ID reuse. The table lookup, write, AI decision, and approval have not been executed here.

## assets · 内部资产

一个 `asset_id` 对应一个内部资产对象。#1001 新建对象时由系统生成 UUIDv7，后续名称、类别或身份状态改变时也不改这个 ID；只有 X 账号时可暂用账号名称，并保持身份待确认。#1001 第一稿只保留五个字段；审核记录和更多追踪信息留待审核流程定义。

主键：`asset_id`。按真实输入规定的目标行数：**2**。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `asset_id` | TEXT | 是 | 系统创建的内部资产 ID（UUIDv7） |
| 02 | `name` | TEXT | 否 | 当前展示名称；待确认时可暂用来源名称，来源未提供时留空 |
| 03 | `identity_status` | TEXT | 是 | 身份状态：pending_identity 或 confirmed |
| 04 | `asset_kind` | TEXT | 否 | 对象类别；可用于区分社交账号、项目、加密资产、股票等 |
| 05 | `created_at` | TEXT | 是 | 系统首次建档时间 |

目标表行（X ID 来自真实 #2030 返回，其余字段为产品定义）：

| asset_id | 当前名称 | 对象类别 | 来源 X 用户 ID | 状态 |
| --- | --- | --- | --- | --- |
| `01a0ecfd-dbb2-7643-abf8-e22462fe49f0` | `Stake \| Bonus` | `social_account` | `2921807028` | `pending_identity` |
| `01a0ecfd-dbb2-7d8a-86a3-5330925f3b80` | `KASUN` | `social_account` | `998973985026002944` | `pending_identity` |

## asset_identifiers · 资产外部标识

用来源范围和外部稳定 ID 找到 #1001 的内部资产 ID。每行只保存一条对应关系；#1002 的 `asset_id` 引用 #1001 已创建的 ID，不另生成编号。

主键：`source_namespace + external_identifier`。真实 #2030 输入对应 **2** 行目标结果；连同别名和其他资产，面板展示 **7** 行案例。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `source_namespace` | TEXT | 是 | 来源命名空间 |
| 02 | `external_identifier` | TEXT | 是 | 外部稳定 ID |
| 03 | `asset_id` | TEXT | 是 | 引用 #1001 的 UUIDv7 `asset_id` |

目标表行（尚未写入后台）：

| source_namespace | external_identifier | asset_id |
| --- | --- | --- |
| `x_user_id` | `2921807028` | `01a0ecfd-dbb2-7643-abf8-e22462fe49f0` |
| `x_user_id` | `998973985026002944` | `01a0ecfd-dbb2-7d8a-86a3-5330925f3b80` |
| `coingecko_coin_id` | `bitcoin` | `01a0ea76-0c00-7b58-9a5c-e5ae3a38e394` |
| `alias_name_zh` | `比特币` | `01a0ea76-0c00-7b58-9a5c-e5ae3a38e394` |
| `alias_ticker` | `BTC` | `01a0ea76-0c00-7b58-9a5c-e5ae3a38e394` |
| `coingecko_coin_id` | `ethereum` | `01a0ea76-0c00-762e-acca-7efff04125a7` |
| `coingecko_coin_id` | `solana` | `01a0ea76-0c00-78e6-aace-197b6a78bf7c` |

上面三行都指向 #1001 的同一行 `Bitcoin`。中文名和简称是本产品定义的别名案例，不代表已经通过后台匹配或审核。简称可能重复，不能只凭任意来源出现的 `BTC` 就自动绑定；需要确定其来源范围和归属。

## asset_relationships · 已审核资产关系

保存两项已确认资产之间经过审核的关系。

主键：`relationship_id`。当前真实案例尚无已审核关系行。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `relationship_id` | TEXT | 是 | 关系 ID |
| 02 | `from_asset_id` | TEXT | 是 | 起点资产 ID |
| 03 | `to_asset_id` | TEXT | 是 | 终点资产 ID |
| 04 | `relationship_type` | TEXT | 是 | 关系类型 |
| 05 | `evidence_ref` | TEXT | 是 | 关系证据 |
| 06 | `review_id` | TEXT | 是 | 批准记录 ID |
| 07 | `created_at` | TEXT | 是 | 创建时间 |

## asset_monitoring_rules · 资产监控规则

按资产保存经审核的规则及其版本。

主键：`rule_id + version`。当前真实案例尚无已审核规则行。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `rule_id` | TEXT | 是 | 规则 ID |
| 02 | `version` | INTEGER | 是 | 版本号 |
| 03 | `asset_id` | TEXT | 是 | 资产 ID |
| 04 | `metric_key` | TEXT | 是 | 指标键 |
| 05 | `rule_json` | TEXT | 是 | 规则内容 JSON |
| 06 | `status` | TEXT | 是 | 规则状态 |
| 07 | `review_id` | TEXT | 是 | 批准记录 ID |
| 08 | `effective_at` | TEXT | 是 | 生效时间 |

## asset_score_events · 资产评分流水

各评分程序先保存自己的详细判定记录，包含使用的输入、规则版本、关键计算值、触发原因和判定时间；确认加分后，再向 #1005 写一笔统一的加分事实。#1005 不复制程序的判定过程或原始数据。`decision_ref` 使用“程序命名空间/记录 ID”定位详细记录；对应记录必须能够持久读取，不能只留下一个无法解析的哈希。规则和证据可从详细记录继续追溯。程序写入失败后可以重试；同一判定对同一资产、同一维度只入账一次，`event_key` 应由这三项稳定生成，数据库另以这三项的组合唯一约束防重。若详细记录与 #1005 分处不同存储，需保证成功保存的判定能可靠重试入账。

`created_at` 在评分事件被系统接受时确定，随同一事件进入 Redpanda；Redis 缓存与 Delta/Parquet 归档沿用该时间，不在归档时重新计时。它表示分数何时进入系统；原始推文的发布时间、爬虫获取时间和程序判定时间保留在上游记录中，用于排查延迟，不作为 #1005 的入账时间。时间流逝本身不新增流水；连续衰减由读取或刷新时按原事件时间折算。明确扣分或纠错可另写负分流水，保留原行。当前没有计算过的贡献案例，程序详细判定表也尚未实现。

#1005 是逻辑流水，不要求评分程序同时写 Redis 和 Parquet。规划链路为“#3006 提交一次评分事件 → #5001 Redpanda Topic → #3007 与 #3008 两个独立消费者”：#3007 按 `event_key` 去重后维护 #6001 Redis 评分事件缓存，#3005 从缓存计算 #1006；#3008 将完整流水归档至 Delta/Parquet 中的 #1005。Redis 更新不等待归档；任一消费者失败后从各自消费位置重试。归档必须能保存完整历史，Redpanda 保留期必须覆盖归档延迟；Redis 丢失时可从仍保留的 Redpanda 事件或已归档历史重建。Redis 是可重建计算副本，必须保留当前热度计算所需的事件或等价逐规则状态，不是 #1005 唯一账本。`created_at` 与 `event_key` 在两条路径上保持一致，不能因重试重新生成。上述均为实现规划，尚无真实消息、消费者或归档结果。

#1005 面板在空原表下方展示同一条 #2030 账号的目标归档行。账号 ID 与名称来自真实 Kaito MCP 返回；内部 `asset_id` 是目标案例值，`event_key` 和 `created_at` 要等首次实际提交才可确定。这个预览不是已归档表行。

初始评分规则：#3002 首次成功建档后向 #3009 交付 `action=created`，#3004 已有映射则交付 `action=reused`。#3009 仅对新建资产持久保存评分判定，再经 #3006 提交一次 `score_key=total_heat, score_delta=+100`；已有资产不提交起始事件。`asset_initial_score/v1` 是这笔贡献的规则，并不是另一个评分维度。`decision_ref=asset_initial_score/v1/{asset_id}` 必须指向 #3009 可持久查询的判定记录，`event_key` 由资产、维度和判定引用稳定生成；重试沿用原事件。#5001 Header 带不可变 `decay_policy_ref=asset_initial_score/v1`，#3007 将其复制到 #6001 Redis，#3005 据此解析模型和半衰期。#1005 保留六个字段，可经 `decision_ref` 恢复规则。起始贡献半衰期为 7 天，即 10080 分钟；第 0、10080、20160 分钟的单笔 +100 分别为 100、50、25，只是连续曲线检查点。内部按完整精度计算和排名，界面显示两位小数。未来其他来源可以给同一 `total_heat` 加贡献，各笔半衰期可以不同，但旧事件的规则版本不可改写。旧资产缺少起始事件要单独补录，不能在每次 #3004 命中时加 100。#3002 当前新建的 `pending_identity` 社交账号可参与 Demo 排名，100 分不代表已确认它是项目。规则已定义但没有实际评分事件。

主键：`event_key`。另对 `asset_id + score_key + decision_ref` 设组合唯一约束。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `asset_id` | TEXT | 是 | 引用 #1001 的资产 ID |
| 02 | `event_key` | TEXT | 是 | 同一资产、维度、判定的稳定去重键 |
| 03 | `score_key` | TEXT | 是 | 评分维度，如当前热度、热度增速、看多证据、看空证据或可交易性 |
| 04 | `decision_ref` | TEXT | 是 | 程序命名空间与详细判定记录 ID |
| 05 | `score_delta` | REAL | 是 | 本次入账的分数变化量 |
| 06 | `created_at` | TEXT | 是 | 评分事件被系统接受时确定的入账时间，UTC；缓存和归档沿用 |

## asset_scores_current · 资产当前评分

一行代表一个资产在一项评分指标上的**当前分数**。本次 Demo 仅使用 `score_key=total_heat`（全量热度）；起始 +100 和未来其他热度贡献进入同一分数，不另设 KOL 热度维度。#1006 保留 `score_key` 字段，以便以后扩展指标。

规划中的 #3005《计算当前资产评分》对每笔 `total_heat` 事件按其不可变 `decay_policy_ref` 解析半衰期，在固定 UTC `calculated_at` 计算 `score_delta × 2^(-实际经过分钟数/半衰期分钟数)`，再按资产求和。实际经过分钟数为 `max(0, (calculated_at Unix 秒 − created_at Unix 秒)/60)`，可为小数。Demo 当前只有新建资产的一笔 +100 起始贡献，半衰期 10080 分钟；以后同一资产的其他热度事件仍写 `total_heat`，可有不同半衰期。#3005 只在新贡献到来时更新受影响资产，读取或排名时把原事件折算到同一查询时刻。Redis 必须保留仍参与衰减的事件或等价的逐规则状态，不能统一按 24h TTL 删除；若以后混用半衰期，不能仅凭 #1006 的一个合计分和 `calculated_at` 正确继续衰减。时间流逝不向 #1005 写负分。旧异步计算不得覆盖新结果。

#3005 的规则保存在 [`catalog/score-rollup.v1.json`](../catalog/score-rollup.v1.json)。#1006 不存 `rank_position`：Demo 榜单读取 `total_heat`，固定同一 UTC 查询时刻，把所有资产的贡献折算到该时刻，再按未舍入分数降序、`asset_id` 升序生成名次；界面显示两位小数。第一次 Demo 排所有已建档资产，包括待确认的社交账号；若页面要只显示已确认项目，应另加身份和类别筛选。这个排序需要后台读取接口，前端不直接访问 Redis。应监测消费者延迟，并用归档历史校验、恢复 Redis 事件和当前分。除起始 +100 外，其他热度来源的加分规则和半衰期尚未定义；当前没有评分流水、运行中的计算器、排名接口或实际结果。

#1006 面板同样在空原表下方展示 `total_heat` 目标当前分行。起始贡献半衰期已定为 10080 分钟，但实际事件入账时间和首次计算时间尚未确定，`score_value` 暂以 `100 × 2^(-从 created_at 起实际经过分钟数/10080)` 表示，不能填成已计算出的 100 分或其他数值。

主键：`asset_id + score_key`。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `asset_id` | TEXT | 是 | 引用 #1001 的资产 ID |
| 02 | `score_key` | TEXT | 是 | 当前指标的唯一键；本次 Demo 固定为 `total_heat` |
| 03 | `score_value` | REAL | 是 | 该资产在此指标于 `calculated_at` 时刻的分数；连续衰减指标读取时需折算 |
| 04 | `calculated_at` | TEXT | 是 | `score_value` 对应的 UTC 时间 |
