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

资产交接记录在 `asset_id` 后带 `asset_name`，从 `assets.name` 复制，供展示和调试。评分事件、Redis 和 #1005 保存事件名称快照，重试沿用；#1006 与排名响应沿用最新非空事件名称（created_at 降序，同时间按 event_key 升序），名称缺失不阻塞评分。名称不参与关联、唯一键、去重或评分；旧记录可为空，未匹配资产的名称为 NULL。

## asset_score_events · 资产评分流水

各评分程序先保存自己的详细判定记录，包含使用的输入、规则版本、关键计算值、触发原因和判定时间；确认加分后，再提交一笔统一的评分贡献事件，最终归档到 #1005。#1005 不复制程序的判定过程或原始数据。`decision_ref` 使用“程序命名空间/记录 ID”定位详细记录；对应记录必须能够持久读取，不能只留下一个无法解析的哈希。规则和证据可从详细记录继续追溯。程序写入失败后可以重试；同一判定对同一资产、同一维度只入账一次，`event_key` 应由这三项稳定生成，数据库另以这三项的组合唯一约束防重。若详细记录与 #1005 分处不同存储，需保证成功保存的判定能可靠重试入账。

`created_at` 在评分事件被系统接受时确定，随同一事件进入 Redpanda；Redis 缓存与 Delta/Parquet 归档沿用该时间，不在归档时重新计时。它表示分数何时进入系统；原始推文的发布时间、爬虫获取时间和程序判定时间保留在上游记录中，用于排查延迟，不作为 #1005 的入账时间。时间流逝本身不新增流水；连续衰减由读取或刷新时按原事件时间折算。明确扣分或纠错可另写负分流水，保留原行。当前没有计算过的贡献案例，程序详细判定表也尚未实现。

#1005 是逻辑流水，不要求评分程序同时写 Redis 和 Parquet。#5001 的 Topic 选择见 [`catalog/score-event-topic-proposal.v1.json`](../catalog/score-event-topic-proposal.v1.json)：fewunderstand 现有宽 Topic 中，`signal.data` 的策略信号与已接受评分账本不同，`indicator.data` 是指标结果，上游数据及元数据 Topic 也不适合承担评分流水的保留和重放。因此只提出一个待评审的宽 Topic 候选 `score.events`，不表示已经注册或创建。沿用 fewunderstand 现有的三个 Headers：`source=signalstudio` 表示 #3006 的逻辑业务来源，不表示已有 SignalStudio 发布进程，`type=score_event` 表示已接受的评分事件家族，`category=asset_score_contribution` 表示逐笔资产评分贡献。三元组合查拟建注册表，映射到 v1 Value 结构、处理程序和目标位置；两个独立 Consumer 各自读到消息后识别并校验，Redpanda 不会在服务端按 Header 筛选。`record_type` 的作用已由 `category` 承担；结构版本是注册表中绑定的 schema 引用，不新增 `schema_version` Header。将来如有不兼容结构，先与 fewunderstand 约定新的可识别注册项。Value.data 与 #1005 均保存完整九项字段，其中 `decay_policy_ref` 和正数 `half_life_minutes` 是逐事件冻结的业务事实；不再增加 `payload_schema` 等重复 Header。当前单 Partition Demo 有意不填 Message Key，Value.data 的 `event_key` 用于逐笔去重；将来扩为多 Partition 且确需同一资产顺序时，再由 fewunderstand 设计稳定的资产 Key。注册表和处理链路仍是设计意图，并无运行事实。

规划链路为“#3006 提交评分事件 → #5001 候选 Topic → #3007 与 #3008 两个独立 Consumer Group”：两组各自读取全部事件，读后按 source/type/category 三元组选择处理并校验 Value 结构，不能互相分摊消息。#3007 按 `event_key` 幂等维护 #6001 Redis，成功后提交自己的 offset，供 #3005 后续每 60 秒定时轮次读取；#3008 按同一 `event_key` 幂等归档完整九个字段到 Delta/Parquet 中的 #1005，持久写入成功后提交自己的 offset。一个组延迟或失败不阻塞另一个，重试沿用 `event_key`、`created_at`、`decay_policy_ref` 和 `half_life_minutes`。#1005 保存原始衰减参数，重放时不依赖当前规则重新赋值；`decision_ref` 继续追溯判定。Topic 必须在归档延迟和约定重放期内保留完整已接受事件，不可压缩掉不同事件；具体保留期和技术实现由 fewunderstand 评审。Redis 丢失时可从仍保留的 Topic 事件或含原始衰减参数的完整归档重建。上述均为设计意图，尚无真实 Topic、消息、Consumer、Redis 投影或归档结果。

#1005 面板在空原表下方展示同一条 #2030 账号的目标归档行。账号 ID 与名称来自真实 Kaito MCP 返回；内部 `asset_id` 是目标案例值，`event_key` 和 `created_at` 要等首次实际提交才可确定。这个预览不是已归档表行。

初始评分规则：#3002 首次成功建档后向 #3009 交付 `action=created`，#3004 已有映射则交付 `action=reused`。#3009 仅对新建资产持久保存评分判定，再经 #3006 提交一次 `score_key=total_heat, score_delta=+100`；已有资产不提交起始事件。`asset_initial_score/v1` 是这笔贡献的规则，并不是另一个评分维度。`decision_ref=asset_initial_score/v1/{asset_id}` 必须指向 #3009 可持久查询的判定记录，`event_key` 由资产、维度和判定引用稳定生成；重试沿用原事件。#5001 目标消息的 Value.data 带不可变 `decay_policy_ref=asset_initial_score/v1` 与 `half_life_minutes=10080`。#3006 首次接受时校验半衰期为有限正数且与规则版本一致，重试沿用原值；#3007 将两个字段原样复制到 #6001 Redis，#3005 用事件自己的分钟数计算，并用规则引用校验指数模型与版本。#3008 将两字段一同归档至 #1005，`decision_ref` 仍可追溯判定。起始贡献半衰期为 7 天，即 10080 分钟；第 0、10080、20160 分钟的单笔 +100 分别为 100、50、25，只是连续曲线检查点。内部按完整精度计算和排名，界面显示两位小数。未来其他来源可以给同一 `total_heat` 加贡献，各笔半衰期可以不同，但旧事件的规则版本不可改写。旧资产缺少起始事件要单独补录，不能在每次 #3004 命中时加 100。#3002 当前新建的 `pending_identity` 社交账号可参与 Demo 排名，100 分不代表已确认它是项目。规则已定义但没有实际评分事件。

主键：`event_key`。另对 `asset_id + score_key + decision_ref` 设组合唯一约束。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `asset_id` | TEXT | 是 | 引用 #1001 的资产 ID |
| 02 | `asset_name` | TEXT | 否 | 随记录传递的资产名称，供展示和调试 |
| 03 | `event_key` | TEXT | 是 | 同一资产、维度、判定的稳定去重键 |
| 04 | `score_key` | TEXT | 是 | Demo 固定为 `total_heat`；以后新增指标须另行定义口径 |
| 05 | `decision_ref` | TEXT | 是 | 程序命名空间与详细判定记录 ID |
| 06 | `score_delta` | REAL | 是 | 本次入账的分数变化量 |
| 07 | `created_at` | TEXT | 是 | 评分事件被系统接受时确定的入账时间，UTC；缓存和归档沿用 |
| 08 | `decay_policy_ref` | TEXT | 是 | 该笔事件冻结的衰减规则版本引用；用于校验和追溯 |
| 09 | `half_life_minutes` | REAL | 是 | 该笔事件冻结的正数半衰期分钟数；起始 +100 为 10080 |

## asset_scores_current · 资产当前评分

一行代表一个资产在一项评分指标上的**当前分数**。本次 Demo 仅使用 `score_key=total_heat`（全量热度）；起始 +100 和未来其他热度贡献进入同一分数，不另设 KOL 热度维度。#1006 保留 `score_key` 字段，以便以后扩展指标。

规划中的 #3005《计算当前资产评分》对每笔 `total_heat` 事件直接使用其不可变 `half_life_minutes`，并按 `decay_policy_ref` 校验指数模型和规则版本，在固定 UTC `calculated_at` 计算 `score_delta × 2^(-实际经过分钟数/半衰期分钟数)`，再按资产求和。实际经过分钟数为 `max(0, (calculated_at Unix 秒 − created_at Unix 秒)/60)`，可为小数。Demo 当前只有新建资产的一笔 +100 起始贡献，半衰期 10080 分钟；以后同一资产的其他热度事件仍写 `total_heat`，可有不同半衰期。#3005 每 60 秒独立执行，读取 #1001 全部已登记资产与 #6001 事件，在本轮同一 UTC 时刻重算并保存；没有新事件仍重算衰减，无贡献资产写 0 分。默认读取或排名使用最近一轮保存的分数和 calculated_at。Redis 必须保留仍参与衰减的事件或等价的逐规则状态，不能统一按 24h TTL 删除；若以后混用半衰期，不能仅凭 #1006 的一个合计分和 `calculated_at` 正确继续衰减。时间流逝不向 #1005 写负分。旧异步计算不得覆盖新结果。

#3005 的规则保存在 [`catalog/score-rollup.v1.json`](../catalog/score-rollup.v1.json)。#1006 不存 `rank_position`：Demo 榜单读取 `total_heat`，读取最近一轮保存的分数与 calculated_at，按未舍入分数降序、`asset_id` 升序生成名次；界面显示两位小数。第一次 Demo 排所有已建档资产，包括待确认的社交账号；若页面要只显示已确认项目，应另加身份和类别筛选。这个排序需要后台读取接口，前端不直接访问 Redis。应监测消费者延迟，并用归档历史校验、恢复 Redis 事件和当前分。除起始 +100 外，其他热度来源的加分规则和半衰期尚未定义；已有 fewunderstand 实现参考及 #1006 结果快照，线上调度持续健康状态尚未核验。

2026-10-08：用户要求补充 #1006 案例行，因此面板增加 5 行明确标注的模拟计算，复用 #1001 案例资产；统一假设在 2026-10-15 00:00 UTC 计算，每资产仅一笔 +100，经过 0、1、3.5、7、14 天后分别显示 100.00、90.57、70.71、50.00、25.00。完整精度数值及假设入账时间保存在 `catalog/business-table-cases.v1.json`，不代表真实事件或后台运行。原有 #2030 贯通案例继续展示公式，因为其真实入账时间和计算时间仍未生成。这次变更只补充产品案例，不改变评分执行契约。

2026-10-08（用户接受并要求先实现 #1006）：表面板保留设计案例，并新增独立的“实际回填 · 固定快照”模块。通过 JSON 导入小批量数据库结果快照或离线回放结果，保存于纳入 Git 同步的 `data/table-1006-backfill.json`；页面打开时读取保存内容，导入替换当前快照。模块展示五个标准字段、采样来源和时间、显式字段映射与原始记录，并按 `asset_id + score_key` 对照可选预期，仅在计算时间相同时比较完整精度分数。计算时间不同、缺少预期或预期无对应实际行均单独说明。模块校验完整字段、时区、有限数值、唯一键和 `total_heat` 指标；名称来源可明确为空。当前未导入真实快照时显示“待回填”。本模块不执行回放计算；离线回放需携带输入与规则的 `derivation_ref`。其他表后续扩展，暂未实现。

2026-10-08 更新频率核对：fewunderstand 的 `consumer/asset_total_heat/minute_materializer_flow.py` 中 `serve()` 配置 `interval=timedelta(minutes=1)`；`run_minute_cycle` 每轮读取全部已登记资产及 Redis 评分事件，固定同一计算时刻重算并写入 PostgreSQL `asset_score.current_score`，不依赖用户查看页面。没有新增事件时，既有贡献仍随时间衰减；新增事件需先进入 Redis 投影，再被后续计算轮读取，代码中的事件即时触发仍是后续优化。该代码配置说明目标周期为每分钟，但本次未查询线上调度运行记录，不能凭一份快照证明持续按分钟正常运行。

当前已导入的真实快照为 4 行，统一 `calculated_at=2026-10-07T19:46:51.754648Z`，采样时间为 `2026-10-07T19:47:46.177622Z`，即北京时间 2026-10-08 03:46:51 计算、03:47:46 取样。SignalStudio 展示固定文件；只有重新取样、提交/拉取快照并重新打开面板才更新显示，没有自动同步周期。随后用户要求修改：Studio 的 `catalog/score-rollup.v1.json` 与 #3005 卡片现已统一为每 60 秒全量计算，替代旧“事件触发 + 查询时折算”设计；默认榜单读取物化结果。

主键：`asset_id + score_key`。

| # | 字段 | 类型 | 必填 | 含义 |
| --- | --- | --- | --- | --- |
| 01 | `asset_id` | TEXT | 是 | 引用 #1001 的资产 ID |
| 02 | `asset_name` | TEXT | 否 | 随记录传递的资产名称，供展示和调试 |
| 03 | `score_key` | TEXT | 是 | 当前指标的唯一键；本次 Demo 固定为 `total_heat` |
| 04 | `score_value` | REAL | 是 | 该资产在此指标于 `calculated_at` 时刻的分数；连续衰减指标读取时需折算 |
| 05 | `calculated_at` | TEXT | 是 | `score_value` 对应的 UTC 时间 |

### 2026-10-08：评分链路的设计理由与分钟计算的边界

用户重新提出 Redis、两条路径和从 #5001 开始的必要性，并询问一分钟一次的计算是否意味着没有流式部分。以下根据已有契约还原设计理由，属于架构解释和待讨论取舍，不代表用户已批准简化或改变执行契约。

- #5001 是已接受评分事件的共同分发与重放边界，不是业务起点。上游仍需完成观察、资产识别、评分判定（#3009）和提交（#3006）。从 #5001 讲起只是聚焦“评分事件被接受之后怎么办”；其编号中的 5 表示 Topic 类别，001 表示该类创建顺序，不代表执行顺序。
- 两路是同一评分事件的两个用途：#3007 → #6001 Redis 为评分计算维护可快速读取的事件状态；#3008 → #1005 Delta/Parquet 保存可审计、校验和重建的完整历史。独立 Consumer Group 各读全部事件，并独立确认处理进度，使计算路径不必等归档完成；不是把事件分成两半，也不是计算两个不同分数。
- Redis 的理由是避免评分计算反复扫描文件归档，并保留可按资产读取的贡献状态。它是可重建的计算输入投影，不是衰减公式的数学前提。每分钟计算仍可从 Redis 读取，但该频率本身不能证明必须使用 Redis；本次没有吞吐、延迟或成本基准能证明其必要性。
- 本次重新读取 fewunderstand 的 `consumer/asset_total_heat/minute_materializer_flow.py`，确认 `serve()` 配置一分钟周期，并明确将事件到来后的即时额外计算列为后续优化。因而应区分“事件持续进入 Topic、由消费者处理”和“每分钟全量重算当前分数”：前者是事件流式摄取/投影，后者是定时批量计算，不宜称为全链路逐事件实时评分。一分钟是调度目标，不是端到端延迟上限；消费积压、排队和计算耗时均可能增加延迟。本次未验证在线调度或消费者持续运行。
- 可讨论的简化方案是由数据库保存幂等评分事件，每分钟直接读取并更新当前分，历史归档按需另做；也可保留 Topic、仅替换 Redis 投影。是否采用取决于数据量、延迟要求、重放和消费解耦需求，需要另行决定。本次仅记录备选，不修改链路、程序或 catalog。
