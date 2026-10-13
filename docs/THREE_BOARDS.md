# CoinGecko 指标、统一建档与四项量价评分

2026-10-13 SS-95已批准的[首版交易最热榜](HOTTEST_BOARD.md)优先覆盖本文件的最热榜旧活动分排序：#3018恢复，按四项对数稳健Z快照排序；#3048/#3049加入7日基线/RVOL，#6007保存候选。#3041/#5007显式升级v2且旧消费者按版本兼容。旧评分、升温和提醒规则保留；本次不证明Few真实后台或业务页已运行。

## 当前三榜输入（SS-84）

2026-10-13批准：升温#1008、最热#1009和新发现UUID榜共同提供内容维护候选。
新榜读取各渠道统一建档的首次创建时间，取最新20个；不以项目上线年龄或热度判断，
不恢复旧#1010、发现+20或7天规则。新榜不限对象类型，代币内容链只接收已确认coin。
精确要求与未核验接点见[NEW_UUID_BOARD.md](NEW_UUID_BOARD.md)及
`catalog/new-uuid-board.v1.json`，批准依据为[SS-84](https://app.notion.com/p/3f8038a63d5a811b8c93dc4d0026804d)。
首页位置3已绑定新榜定义；其余信号分组仍待定义，真实业务页面/API和Few运行未接通。
下文SS-81的第三榜待定义是先前交付范围，以本节当前定义为准。

## 六框首页定义（SS-81）

[2026-10-13批准范围](https://app.notion.com/p/3f7038a63d5a81e59299fbe2553ee9ae)：`catalog/homepage-layout.v1.json`为当前六位置唯一契约。1升温、2最热、3第三榜待定义；4—6为信号区域，分组与时间排序待定义。榜单引用1008/1009结果，信号引用5005通道定义，不把通道宣称为可查询的持久表。3032继续从5007统一分档评分，3011—3015独立判断并输出5005；信号命中不自动额外加分。

本批实现Studio应用界面卡与双语六框结构预览，只有不触发执行的引用关系，无真实记录、读取API或业务页面。3017/3018/3019继续收起，不恢复旧发现榜；保留既有资产得分与纠错审核页面。一次性事务安装检查冲突和重入，保留旧节点ID/位置及用户编辑；导出包含结构化定义。业务首页、信号持久化、分组、第三榜规则与回测仍待实现/验证。验收运行`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_homepage_interface server.test_application_interfaces server.test_card_model`及前端契约、布局、构建和双语详情检查。

2026-10-12 用户批准 [SS-72](https://app.notion.com/p/3f7038a63d5a814da925c11ab3667bd2) 重整卡片与契约，并要求删除被替代的旧卡片。历史安装结构保留在 `catalog/market-polars.v1.json`，当前有效结构以 `catalog/market-current.v1.json` 为准，评分参数仍为 `catalog/market-scoring.v1.json` 的 market_v1。旧 foundation/channel/scaffolds 文件只供历史数据库有序迁移，不是第二套现行设计，不随当前三榜实例导出。

## 当前职责

CoinGecko #2010 → 唯一行情通道 #5004 `market.snapshot` → Polars 计算量价指标 → 既有 `indicator.data` 通道中的 `market_indicators_v1` → #3032 筛选和确定加分 → #3006 提交事件 → #5001 评分事件 → #3007 维护 #6001 Redis 评分窗口 → #3033 汇总 #1021 当前分和 #1022 评分历史 → 保留的升温/最热设计及 #1008/#1009 结果（生成卡当前已收起）。

Polars 负责统一输入身份/时间/质量检查，计算成交额/市值、绝对24h价格变化、相对24小时前放量倍数，并保留来源有符号24h涨跌幅和相对ATH百分比；#3032 只读取指标选择最高满足档位，不读取行情历史重算指标。沿用 `indicator.data`，必须可区分本版消息与现有10分钟指标；现有 `vol_chg_p_10min` 是滚动24h成交额快照在10分钟间隔的变化，不是短窗新增交易量，也不是本版24小时前放量倍数。

#1013 `coingecko_market_history` 合并行情观测与历史，复用 Few Delta/Parquet 归档能力；新增归档卡表示既有 writer 的职责，运行与契约符合程度未核验。完整 HTTP 响应仍通过 `snapshot_ref` 回查。#1014 记录运行覆盖/失败/初始基线，需采集端明确写入，包括全失败运行；不能从成功币种列表推断完整覆盖。#3024/#1016 已在 SS-80 删除；统一资产建档写 #1001/#1002，创建成功交 #3009 判断起始分。

被替代的 #3022、#3023、#1015、#6002—#6005、#3020、#1011 从当前图实际删除，历史留在 Git/Notion。保留的升温/最热设计直接共享指标与当前/历史评分，不要求每榜复制一份 Redis 输入。资产身份、既有提醒/候选、旧演示评分链和下游候选筛选不属于本次删除范围；旧起始+100与社交/搜索热榜贡献不混入 market_v1。

## 旧发现链清理（SS-80）

2026-10-13 用户批准[清理旧首次发现链](https://app.notion.com/p/3f7038a63d5a810a9614cbbe6242fa76)。`server/retire_market_discovery.py`在SS-79之后执行一次性事务迁移：实际删除#3024与#1016及连线；删除旧发现字段和评分依赖；#3019与#1010仅保留编号/位置作为停用占位，清空字段、执行动作和所有关联边，不能恢复旧规则或给候选筛选提供输入。其他存续卡的ID与位置保持。

`catalog/market-current.v1.json`和`catalog/polars-indicator-current.v1.json`是当前详情与导出的有效定义；旧market-polars/module文件只供历史安装，迁移后不进入现行导出。market_v1只保留成交额、成交额/市值、绝对24h涨跌幅、相对24小时前放量四项原阈值和30分钟半衰期；删除首次发现+20、discovery_score/new_score与7天新发现榜资格。历史事件不改写，量价参考汇总忽略已退休的market_v1/discovery。后台已有事件/真实投影如何适配仍未核验。

#3032读取#5007完整指标决定四项加分；不改成读取#3011—#3015提醒结果。提醒阈值和评分档位不同，例如涨幅8%未达上涨提醒10%，但可命中评分5%档。五张模块内指标卡先经#3041汇总发布#5007，评分消费者无需直接耦合内部子卡。

统一建档主链保持SS-79：#5007→#3042筛选无UUID资产→#3043核实并建档，原子写#1001资产与#1002来源ID映射；仅成功created交#3009按来源配置判断起始分。#1003关系/#1004监控规则不随每个新资产强制插行。CoinGecko起始分未配置时待处理，不套用旧+20或Kaito+100。本批不实现Few消费者/业务数据库写入或缓存刷新。

验收：事务失败无部分删除，未知外部依赖/受保护配置不覆盖，重入不覆盖用户后续编辑；隐藏卡也纳入迁移。运行`server.test_retire_market_discovery`与`server.test_market_scoring_reference`及现行建档/指标/范围检查，核验共享图和导出无旧发现字段与动作。

## 删除旧新发现结果占位（SS-86）

2026-10-13用户批准[删除#1010停用占位](https://app.notion.com/p/3f8038a63d5a814ab231d99c3f597b9a)。`server/remove_retired_discovery_board.py`在SS-84安装后以一次性事务删除#1010及其空契约、端口和schema元数据；#3019停用占位保留，其他节点ID、位置、连线与字段不变。新发现榜使用#3044→#1023并交#3027，定义见[新UUID榜](NEW_UUID_BOARD.md)。遇到#1010新增字段、依赖、执行配置或已修改定义时拒绝删除；失败回滚，成功重入不覆盖用户后续工作。历史报告正文与原node_id保留，仅解除指向已删除节点的外键；历史安装文件不改写，不删除Few业务表或数据。

验证：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_remove_retired_discovery_board server.test_new_uuid_board server.test_retire_market_discovery`；共享服务升级前备份，升级后核验图/导出无#1010、#1023与三榜输入保持。

## 定义引用摘要修复（SS-82）

[2026-10-13批准修复](https://app.notion.com/p/3f8038a63d5a81a6ac99cbabe36deed6)：SS-80递归替换定义路径时，须根据原路径选择对应新文件摘要，不能在路径已经改写后再匹配旧路径。`repair_discovery_digests.py`为已执行SS-80的库提供一次性事务修复，递归检查全部保存契约（含收起卡和嵌套引用），仅替换已知旧文件摘要为固定的已批准目标摘要；目标文件变化拒绝修复，未知摘要保持并继续报告。只增量更新受影响契约的引用摘要与契约版本，不变更业务定义、节点、字段、布局或连线；重入不覆盖后续编辑。该修复不代表其他历史定义差异已审阅或Few运行已通过。

验证：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_retire_market_discovery server.test_repair_discovery_digests`覆盖新升级、历史错误引用、嵌套/收起卡、未知变化保留、失败回滚与重入；真实库副本另核对原业务行保持及本次提示消除。

## 当前工作台范围（SS-78）

2026-10-12用户选择暂时只收起CoinGecko下的三个生成榜单卡；依据[SS-78](https://app.notion.com/p/3f7038a63d5a8191a52ed3f283228d3b)。`catalog/workspace-scope.v1.json`以稳定节点ID列出3017、3018、3019。当前图、表格、详情导航和图导出不包含这些卡及关联边、字段和端口；SS-78原操作保留节点、关系、编号和位置；SS-80已另行清空旧新发现榜依赖。升温/最热恢复时移除相应收起条目并重新加载服务，不创建新编号或覆盖其他卡。收起操作只改变工作台范围，不是Few后台停止指令。

SS-80删除旧首次发现记录，SS-86进一步删除#1010停用占位；其他结果表、量价评分及历史、榜后内容维护、行情指标和3011—3016信号保留。这些保留的下游不因为结果表仍存在就获得榜单数据；本节范围优先于下文历史三榜设计，不将其当作正在执行的榜单。

验证：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_workspace_scope`检查只排除三卡、无悬空端点、当前导出一致、保存记录不变和恢复；类型/构建及真实工作台检查确认六条信号保留。

## 无UUID指标与下游建档（SS-79）

2026-10-13用户批准将已记录流程落实到工作台卡片，依据[SS-79](https://app.notion.com/p/3f7038a63d5a81a69ecbe469043b6174)。`catalog/coingecko-identity-handoff.v1.json`是身份处理的现行覆盖定义；以下要求优先于旧catalog中「指标须带已核实asset_id」及3016直接消费原始行情的说明。旧catalog保留供有序迁移，不作为第二套现行身份流程。

- 3035只查询已有身份，不建档或生成UUID。内存未命中后查权威映射：有效映射为`resolved`且asset_id非空；成功确认无映射为`source_only`且asset_id=null；查询失败为`lookup_error`，冲突为`conflict`。失败不能伪装为无映射。
- 确认无映射的对象仍计算并输出可用指标。五项子卡沿用同一observation_id和可空asset_id；3041按observation_id组装、核对来源键与身份快照，不用可空UUID做内连接或跨币聚合。5007保留身份状态、来源稳定ID、来源名称source_name、symbol、snapshot_ref及原追溯字段，消息以观测标识，不用空UUID作为键。未知对象放量历史按相同来源范围+稳定coin ID、USD、覆盖版本匹配，保留原24小时/30分钟基线约束及数值/质量检查；无可比历史则放量倍数为null。
- 5007 →「CoinGecko · 筛选无UUID资产」→「CoinGecko · 核实并建档」。筛选仅接source_only且asset_id=null的有效指标；已识别资产跳过，失败/冲突停止该分支。建档再次查映射，沿用可信来源核实准入，以稳定来源ID幂等创建或复用，并原子写1001 assets与1002 asset_identifiers；成功提交后才交付created结果。资料不足pending、冲突conflict、写入失败error、并发复用reused均不能冒充新建。
- 仅created分别交3016生成一次new_asset_discovered通知、交3009判断一次起始评分。3016不再消费5004；通知携带原指标追溯字段。3009保留现有来源配置和持久判定去重规则，CoinGecko来源分值未确认/未配置时待处理，不能套用Kaito +100；旧market_v1发现+20已退休。建档判定引用仅为评分输入依据，3009另保存评分决定。初次全量导入通知/奖励策略仍待明确，不作为已上线行为。
- 3011—3015与量价评分仍要求resolved且非空asset_id，不因本版允许空UUID就直接对未知对象提醒或加分。新增/纠错映射须刷新所有相关3035进程缓存；具体刷新机制仍由代码侧明确验证，不增加反馈触发回路，不改写或补发旧冻结指标。

本批交付工作台定义、迁移、字段映射和展示；`market_scoring_reference.py`仅以纯函数演示无UUID指标计算、来源基线隔离与未知身份不得提醒/评分，不执行建档、事务或Few消费任务。后台适配、实际消息、建档并发、缓存同步与评分配置均未核验。检查：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_coingecko_identity_handoff server.test_market_scoring_reference`。

## #3035 身份缓存要求

2026-10-12 用户确认将进程内存缓存作为当前首选，并要求记录供代码侧实现；依据见 [SS-72](https://app.notion.com/p/3f7038a63d5a814da925c11ab3667bd2)。这是已确认的开发要求，尚未实现或验证性能。

- #3035 消费者使用进程内映射表（如 Python 字典）关联来源范围、CoinGecko 稳定 coin ID 与内部 `asset_id`，已缓存身份不逐条远程查库。不按 symbol 猜测身份。
- `assets` / `asset_identifiers` 数据库记录为权威来源；启动时加载所需映射，重启后重新加载。缓存不代替持久记录。
- 缓存未命中时回查数据库，可批量查询；数据库仍无映射才进入既有发现流程。缓存未命中、查询失败均不能直接判定新资产，未核实身份不得评分。
- 新增或纠正映射后必须刷新/失效对应缓存。多个消费者进程各有自己的缓存，均须获得更新；具体更新机制、可接受陈旧时间和失效期间处理需代码侧明确并验证，当前未规定。
- 当前不要求 Redis 身份缓存，也不把查表前移到爬虫。缓存确认本身不授权自动建档、旧指标补发或冻结结果改写。无ID指标及下游身份处理的工作台要求已由上文SS-79明确；后台实现和剩余评分配置仍须另行落实。

验收需覆盖加载/重启、命中时无数据库访问、未命中回查、新增与纠错刷新、多个进程更新，以及代表性负载下的吞吐与端到端延迟。当前未给出数值性能目标，不将内存缓存称为已证实的最快方案。

## #3035 指标模块与独立编号子卡（SS-77）

2026-10-12 用户批准[拆分方案](https://app.notion.com/p/3f7038a63d5a81d6a966cc2f4db8b162)。`catalog/polars-indicator-current.v1.json`定义现行模块组成与字段责任；现行`market-current.v1.json`定义共同输入、基线、冻结与四项评分行为；旧定义只供有序迁移。拆卡不改变公式或阈值。

| 子卡键 | 输入 | 输出与口径 |
| --- | --- | --- |
| signed_price | 来源24h涨跌幅 | `price_change_percentage_24h`，保留来源正负方向 |
| ath_price | 来源ATH百分比 | `ath_change_percentage`，保留全历史来源值，不以本地14天历史替代 |
| turnover | 24h成交额、市值 | `volume_to_market_cap = total_volume / market_cap` |
| absolute_price | 来源24h涨跌幅 | `abs_price_pct = abs(price_change_percentage_24h)` |
| relative_volume | 当前24h成交额、共享身份/来源/时间/覆盖、可比历史 | `volume_ratio = total_volume / baseline_volume`，并输出实际基线引用 |

每张子卡有全局独立编号，`resource.parent_module.node_id`关联#3035稳定ID，`reference_number`仅用于展示，不要求连续。父模块`module_children`列全部子卡，`field_producers`将输出字段关联到生产卡；这些配置及其定义文件进入AI可读导出。子卡不是独立进程、调度器、消费者组或Topic。#3035保留统一身份缓存、USD/时间/质量检查、共享数据准备和消息组装职责，同一程序通过汇总卡统一发布到#5007。2026-10-12用户修正展示要求：大图使用普通卡片，流程为#3035共享输入准备→五张指标卡→汇总卡→#5007；`catalog/polars-indicator-flow.v1.json`取代初版回到父卡的组装画法，不改变指标口径。详情沿用普通process输入/输出模板，计算说明放在折叠设置内。

原始字段与共享输入须区分：`requested_at`来自`meta.requested_at`，`source_id`来自`meta.operation_id`，`source_object_id`来自来源`id`，报价和覆盖来自对应`meta.*`；内部`asset_id`由#3035共享身份关联取得，不宣称CoinGecko原始记录已带内部ID。子卡的`input_origins`声明这些来源。原始通道只由#3035消费；#3035到子卡为程序内部共享输入，子卡到汇总卡为内部结果依赖，历史读取沿用原基线选择。公共字段从#3035直接进入汇总卡；汇总卡的`parent_module`仍指向#3035，#5007的`publisher_node_id`指向汇总卡，`publisher_module_id`保留模块归属。所有线使用匹配端点的绑定与字段映射。

当前价格、市值、24h成交额以及身份、时间、质量、追溯字段由模块共享处理保留或生成。每项结果携带共享的`observation_id`和`asset_id`，不独立生成身份；所有子卡结果按同一`observation_id`统一组装为完整`market_indicators_v1`后发布，不把每个子卡结果作为不完整消息发往#5007。每项缺失/非有限值按原口径为空，不影响其他可用分项；成交额须非负、市值分母须正；放量基线规则沿用上文，不用滚动24h成交额推断短窗新增量。

`indicator_dependency.metric_fields`声明各下游的业务指标，`validation_fields`声明原有校验/准入/追溯要求，`required_fields`为二者去重并集并与实际字段使用映射一致。#3017业务指标为放量倍数与绝对涨跌幅；评分增量仍来自#1021/#1022。#3018排序来自评分；#3019已停用，#3024已删除；#3032用四项量价指标分档加分。既有`valid_indicators`的额外数值和基线检查保留，不将下游改成纯阈值判断。

子卡包含业务公式、窗口/历史依赖、缺失处理、假设案例及Polars表达式参考。表达式假定已做共享Float64/null归一与基线选择，不是后台执行代码或性能证据；优化须保持相同业务口径并验证结果和负载。Polars条件分支不能作为短路保护，参考[官方条件表达式说明](https://docs.pola.rs/api/python/stable/reference/expressions/api/polars.when.html)。实际Few适配、运行与性能仍未核验。

工作台验证：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_polars_indicator_flow server.test_polars_indicator_module server.test_market_polars server.test_coingecko_indicator_signals server.test_market_scoring_reference`；对迁移后的完整图执行`node scripts/check_polars_module.mjs <graph.json>`与既有双语详情检查，并运行类型、构建、契约及布局检查。迁移在SS-74后执行，冲突/中断须事务回滚，重入不覆盖后续用户修改。

## 指标、事件与时间

指标输出携带 metric_id、固定 metric_version、asset_id、observation_id、run_id、source_object_id、slot_start、来源/请求/接收时间、USD报价、覆盖/质量、原始响应引用与实际历史基线引用。每条观测按observation_id冻结成功有效响应、身份与指标结果；评分层保留每来源/UTC五分钟槽首个有效指标，不抑制同槽后续观测的指标发布。重试沿用原ID、槽、基线与版本，同ID不同冻结内容拒绝。缺失不补零。原始观测历史至少14天；已冻结事件及恢复所需依据不能随意删除。

相对放量 B：同资产、来源、coin ID、USD和覆盖版本，在原始 requested_at 前24小时目标之前最近有效快照，距目标≤30分钟、24h成交额≥100万美元，且其接收时间不晚于目标。缺基线只令 volume_ratio 为空，不阻断其他有效分项。滚动24h成交额不能相加/相减冒充5分钟或1小时新增成交额。

三榜与评分公共过滤（不作为统一指标产出的门槛）：价格>0、市值≥1000万美元、24h成交额≥100万美元；USD有限数值、身份已唯一核实、覆盖健康；请求≤接收≤当前、来源观测≤接收且距当前≤15分钟。指标计算时间不替代来源时间。缺失、失败、冲突、NaN/无穷不补零。

## market_v1 规则

| 指标 | 阈值 → 原始加分 | 半衰期 |
| --- | --- | --- |
| 24h成交额 | ≥100万/1000万/1亿/10亿美元 → +10/+20/+30/+40 | 30分钟 |
| 成交额/市值 | ≥0.1/0.3/1 → +5/+10/+20 | 30分钟 |
| 绝对24h价格变化 | ≥5%/10%/20% → +5/+10/+20 | 30分钟 |
| 相对24小时前放量倍数 | ≥1.5/2/3/5 → +10/+20/+30/+40 | 30分钟 |

每项只取最高满足档位，每资产/分项/五分钟槽一笔正贡献，正常下一槽可再次贡献。闭合槽不追补。`decision_ref=market_v1/{asset_id}/{rule}/{slot_start_utc}`。重试沿用 event_key、首次 created_at 和冻结衰减参数。上涨/下跌按幅度同样计关注分，保留方向，不推断买卖信号。

Redis 按 event_key 去重，同键不同冻结内容或同 decision_ref 不同 event_key 拒绝。每笔有效分=`score_delta * 2 ** (-elapsed_minutes / frozen_half_life_minutes)`。只汇总精确 market_v1 四项及匹配半衰期；四项和为 activity_score。旧首次发现贡献排除，不改写历史事件。事件到达触发汇总，另每60秒刷新衰减；超过120秒的评分投影不出榜。按固定计算时刻和事件集合版本防止旧汇总覆盖新结果。累计衰减分不是概率，也没有0—100上限。

## 三榜

| 位置 / 结果 | 排序和附加条件 |
| --- | --- |
| 1 升温 / #1008 | 当前活动分减60分钟前已保存活动分，差值>0；Polars volume_ratio≥1.5、abs_price_pct≥5 |
| 2 热 / #1009 | 当前 activity_score 降序 |
| 3 新发现 / #1023 | 按系统首次建档时间取最新20个UUID，详见NEW_UUID_BOARD.md；旧#1010已删除 |

首页位置以`catalog/homepage-layout.v1.json`为准：3为#1023新发现UUID榜，4/5/6留给信号区域；旧5新发现榜已退休。保留的升温/热榜每榜前20、允许跨榜，同分按asset_id升序，完整精度排序、展示两位小数。升温历史取同版/覆盖、不晚于60分钟前目标且距目标≤10分钟的最近已保存分；缺任一基线不出升温榜，不能用当前事件集合倒算历史。新资产建档不代表新发行。行情历史供Polars，评分历史供升温，两类历史不可合并。

## 实施状态和验证

本仓库交付 Studio 卡片、详情、连线、导出包和纯函数参考，读取详情不会执行采集、计算或加分。`server/market_scoring_reference.py` 将 calculate_indicators 与 contributions 分开，评分与榜单入口不接受行情历史。Few 的既有 Polars、归档以及新 FEW-74 代码存在，不等于新契约已实现或已部署。历史时间/元数据、冻结、幂等、覆盖和本版指标消息均需后台适配/核验；真实榜单质量未知。

SS-72 迁移保护其他卡片、保留存续ID与布局，拒绝定义/字段/配置/依赖冲突及退休卡新接的外部工作；事务失败回滚，重入不覆盖后续编辑。当前数据库从历史安装器升级后执行 market_polars；不直接删除 Few 代码、业务表或数据。

验证：`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_market_polars server.test_market_scoring_reference`，并运行项目卡片契约、布局、类型、构建与双语详情检查。测试验证结构及参考数学，不证明 Few 运行或评分有效。

## CoinGecko 提醒统一指标入口（SS-74）

[批准依据](https://app.notion.com/p/3f7038a63d5a8113b00dc8508a860764)：#3035统一计算/整理指标，结果经模块内汇总卡统一发布到 #5007 Redpanda `indicator.data`。#3011—#3015 消费 `market_indicators_v1`，各自判断条件后发布 #5005 `signal.data`；不再直接消费 #5004，不读取历史或重算成交额市值比。五类条件可同时命中，依次是有符号24h涨跌幅≥10%、≤−10%、成交额/市值≥0.2、相对ATH百分比≥−5%、≤−80%。阈值和强度公式保留原口径，强度不是校准概率。

五类提醒使用同一逻辑消费者组 `signalstudio.market_v1.alerts`，每条指标由该消费者统一评估五项条件；五张卡代表五个条件，不是同组五个互抢消息的独立消费者。评分消费者组独立。信号携带 `metric_id`、`metric_version`、`observation_id` 追溯输入；消费者只接受本版指标。

指标产出与提醒不继承三榜的市值/成交额准入、五分钟贡献去重或加分门槛。通用身份、来源、USD报价、时间及质量校验仍适用。某项数值缺失/非有限只令对应指标为null并跳过对应条件，不抑制其他可用指标；缺少历史基线只令放量倍数为null。24h涨跌幅和ATH百分比保留CoinGecko来源口径，不能用本地14天高点代替全历史ATH。#3035负责整理这些来源指标，不重新计算来源全历史值。

现行提醒契约为 `catalog/coingecko-indicator-signals.v1.json`；`catalog/coingecko-implemented-signals.v1.json`保留为旧代码证据和历史升级输入，不是已迁移五卡的现行设计。其他身份候选/发现链保持原状。本仓库只交付工作台定义、迁移、展示和纯函数参考，不启动Redpanda消费者；Few适配、部署、实际消息与历史覆盖均未核验。
