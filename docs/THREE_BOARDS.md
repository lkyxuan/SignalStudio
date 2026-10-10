# 首版三榜设计交付

用户于2026-10-10批准更新SignalStudio卡片，Few Understand随后负责后端实现。[需求与批准范围](https://app.notion.com/p/3f5038a63d5a81c0abf5f64c1b14be0e)。

当前定义以 `catalog/leaderboard-trends.v1.json` 的 `nodes`、`boards`、`frontend`、`rules` 和 `pending` 为准。`previous_nodes`、`previous_variants`、`previous_edges` 只用于识别升级前设计，不能作为当前算法。旧 `leaderboard-simple.v1.json` 和 `leaderboard-scaffolds.v1.json` 保留为历史安装步骤，不再代表当前三榜需求。

| 首页位置 | 榜单 | 保留的结果卡 | 任务 |
| --- | --- | --- | --- |
| 1 | 升温 | #1008 `leaderboard_warming` | 对象相比自身可比历史正在获得更多有效关注 |
| 2 | 最热 | #1009 `leaderboard_hottest` | 当前有效关注规模，附新增变化与趋势状态 |
| 5 | 新发现 | #1010 `leaderboard_emerging` | 首次有效进入视野的对象，无需高热度 |

3/4/6留空；允许对象跨榜。内部 `leaderboard_emerging` 身份保留以避免无必要破坏引用，对用户显示“新发现”。不按合约、现货、Meme、未发币玩法复制对象池或分榜。

三榜共同输出对象、为什么现在值得看、刚发生的变化、依据与时间。升温补当前/基准/变化；最热补当前关注规模；新发现补首次发现、新在哪里及独立依据。排序值不是前端必显字段，未定义时为null，不能编造数值或沿用旧例子。

#6005/#3020/#1011复用为关注变化输入、状态判定、`asset_attention_states`。降温仅对象标签，历史不足/来源缺失时为unknown，不代表价格方向。分歧的缓存、计算、结果及独占观点处理链移出首版；旧total_heat榜单快照分支移除，#3005/#1006评分演示与已有回填不改。

最热与升温共享 `leaderboard_attention_history` 的有效关注定义；`leaderboard_evidence` 保留原文或量价依据、时间、独立与转载关系；`leaderboard_discoveries` 保留最早有效发现，不能把资产建档时间直接当成立/发行时间。量价可以先于文字信息，具体来源适配仍待核实。

## 实现边界

Studio交付卡片、结构、关系及可导出的 `graph-definition.v1` 包；Few负责采集、计算、调度、缓存与实际写入。获取 `GET /api/graph/package`，按每卡的 `definition_refs.selector.key` 读取当前定义。全部三榜处理动作注册为 `threeboards.<key>`，未声明已实现。

有效关注单位、权重、重要性、窗口、基准、低基数门槛、准入/排序公式、发现期限及实时延迟尚待确定。卡片保持draft，配置触发为unspecified；这些待定不能被旧的一小时差值、24小时建档、前100、固定加分或任意比例替代。产品方向批准不等于算法完整或可运行。Few可先实现对象/证据/发现结构和解释字段，对待定的计算规则须明确提出方案后再确定。

安装器只执行一次；识别到用户另改定义、依赖或名称冲突时拒绝覆盖。保留复用卡号、位置、仍存在的字段身份和无关图；退役卡的旧定义记录在审计事件，交付前另做完整SQLite备份。变更会使相关旧实现核对报告不再匹配新定义，不能继承“已实现”。

## 检查

`PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_leaderboard_trends` 检查保留身份、依赖/定义冲突、中断回滚、重入不覆盖与交付包。另运行项目类型/构建及已有契约检查。检查通过仅证明设计交付一致，不证明Few已实现、调度健康或交易信号有效。
