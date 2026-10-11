# 量价三榜与 market_v1 记分契约

用户于2026-10-11批准先实现Studio基础表/卡片，保留记分制与Redis，并授权AI决定初版分值、衰减和三榜规则，随后按实际榜单表现校准。[需求与决策 SS-55](https://app.notion.com/p/3f5038a63d5a81c0abf5f64c1b14be0e)，[交付及批准范围 SS-56](https://app.notion.com/p/3f6038a63d5a81bcac15edae7a039870)。初版数值是已接受的开发契约，尚未证明榜单质量。

当前结构以 `catalog/leaderboard-foundation.v1.json` 为准，规则以 `catalog/market-scoring.v1.json` 为准；历史trends/simple/scaffolds仅用于有序升级。源为CoinGecko `coins_markets` USD价格、24h价格变化、24h成交额和市值；新闻、群聊正文及Kaito社交指标已从三榜输入断开，原始来源卡和数据不删除。来源字段声明及上游样本不证明Few正在持续采集。

| 首页位置 | 用户榜名 / 保留结果卡 | score与排序 |
| --- | --- | --- |
| 1 | 升温榜 / #1008 `leaderboard_warming` | 当前活动分减60分钟前已保存活动分，必须>0；降序 |
| 2 | 热榜 / #1009 `leaderboard_hottest` | 当前活动分，降序 |
| 5 | 新榜 / #1010 `leaderboard_emerging` | 当前活动分+发现分，降序 |

3/4/6留空；允许跨榜。每榜最多20个已唯一核实的asset_id；同分按asset_id升序，完整精度排序，展示两位小数。公共过滤：价格>0、市值≥1000万美元、24h成交额≥100万美元；USD有限数值，来源观测时间不晚于接收时间且距当前≤15分钟，请求≤接收≤当前，身份/覆盖健康。缺失、失败、冲突及NaN/无穷不补零。

## 每个时间槽的贡献

每项仅取最高满足档位，四类活动分每5分钟槽最多原始+120；累计衰减分没有0—100上限，也不是概率。

| 分项 | 阈值 → 原始加分 | 半衰期 |
| --- | --- | --- |
| 24h成交额规模 V | ≥100万/1000万/1亿/10亿美元 → +10/+20/+30/+40 | 30分钟 |
| 成交活跃度 V/市值 | ≥0.1/0.3/1 → +5/+10/+20 | 30分钟 |
| 绝对24h价格变化 | ≥5%/10%/20% → +5/+10/+20 | 30分钟 |
| 相对放量 V/B | ≥1.5/2/3/5 → +10/+20/+30/+40 | 30分钟 |
| 真正首次有效发现 | 基线后新资产一次+20 | 1440分钟 |

B为同资产、来源、coin ID、USD与覆盖版本，在本次原始requested_at前24小时目标之前最近的有效快照，距目标≤30分钟、成交额≥100万美元。基线采集接收不得晚于24小时前目标；缺少基线只跳过放量贡献。滚动24h成交额不能求和/差分冒充5分钟或1小时交易量。上涨和下跌按幅度同样记关注分，保留价格方向，不推断买卖信号。

以原始request_started_at（表内requested_at）向下取整UTC五分钟槽。每来源/槽冻结首个成功有效响应和身份映射，每资产/分项/槽最多一笔正贡献；正常后续槽可再次贡献。闭合槽不追补。重试保持原槽、判定引用、event_key、首次created_at和半衰期，不因再次请求或读取详情重复记分。`decision_ref=market_v1/{asset_id}/{rule}/{slot_start_utc}`；发现使用`market_v1/{asset_id}/discovery/once`。Few须持久化冻结快照、身份和幂等状态；参考函数本身不提供持久保证。

## Redis与三榜

复用 `提交评分事件` #3006 → `评分事件 Topic` #5001 → `维护近期评分窗口` #3007 → `Redis 近期评分窗口` #6001。贡献过程接入原发布器，score_key继续为`total_heat`。只将精确`market_v1/volume`、`market_v1/turnover`、`market_v1/price`、`market_v1/volume_growth`、`market_v1/discovery`和匹配半衰期纳入量价投影。旧起始+100、搜索热榜等规则及#3005/#1006演示保留，不混入三榜分数。

每笔有效分=`score_delta * 2 ** (-elapsed_minutes / frozen_half_life_minutes)`。event_key去重，同键不同冻结内容或同decision_ref不同event_key拒绝。四项和为activity_score，发现项为discovery_score，两者和为new_score。未来事件/非法冻结值拒绝。贡献写入后触发汇总，另每60秒刷新衰减（运行目标，Few待实现）；投影超过120秒不出榜，不能靠清零旧事件维持新鲜。当前表和历史表记录版本、覆盖、时刻、分项和事件引用；固定计算时刻及事件集合版本防止较旧汇总覆盖新结果。

升温额外要求V/B≥1.5且|24h价格变化|≥5%，与同版本/覆盖的60分钟前已保存分比较；取不晚于目标、距目标≤10分钟的最近历史，差值>0才排名。缺任一基线不出升温榜，不能拿当前事件集合倒算过去分替代历史。新榜要求完整基线后真正new、首次有效发现距当前0—7天；baseline、coverage_added、pending均不入新榜。重试、新来源、再次上榜不重置first_seen_at；系统新见不等于新发行。共享趋势状态可由同一分数差标warming/cooling/stable，历史不足为unknown。

## 表与实施边界

基础表为`leaderboard_observations`、`leaderboard_coverage`、`leaderboard_attention_history`、`leaderboard_discoveries`；新增`market_scores_current`和`market_score_history`读取Redis量价投影，再供三榜。原始观测历史至少保留14天，不意味着可以14天后随意丢弃仍参与计分的事件。新参数版本须独立规则，不重新解释已冻结事件。下游候选筛选只合并三榜已核实asset_id，保留各榜score/版本；不以旧total_heat兜底。

本仓库交付Studio卡片、字段、连线、可导出`graph-definition.v1`及纯函数参考计算 `server/market_scoring_reference.py`。获取`GET /api/graph/package`，按definition_refs及selector读取规则。`foundation.<key>`仍标implementation=unknown、draft=true、trigger=unspecified；卡片读取不执行采集或加分。Few负责物理业务表、真实采集/覆盖元数据、原子幂等、事件与Redis持久化、调度和实际写入；未在本次实现。无真实结果时详情只显示结构，评分案例明确为假设。

安装器针对已有共享评分链执行一次；全新空工作区若没有这条用户设计链则明确提示未应用、不创建升级标记，不凭空补造链路；只缺一端仍拒绝。保留复用卡号/布局和无关图；发现定义、字段、配置、依赖或连接含义被另改则拒绝覆盖。先完整SQLite备份再升级，失败事务回滚。相关旧实现核对不能自动继承为新版本已实现。

## 验证与校准

`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_leaderboard_foundation server.test_market_scoring_reference`覆盖结构保留、文本断开、Redis投影、重入/冲突/回滚和数学参考边界：最高档、来源缺失、放量基线、双向价格、时间槽、发现基线、衰减/重复事件、旧+100隔离、历史门槛、稳定排序及过期投影。另运行项目契约、布局、构建及全部卡片双语详情渲染。

这些检查不能证明Few已运行或参数有效。后续以真实上榜原因、规模/低基数偏置、重复出现、覆盖和延迟校准，版本化记录理由、前后结果与回退依据；未建立自动调参服务或监控。Few运行、历史覆盖及榜单质量仍是待验证事项。
