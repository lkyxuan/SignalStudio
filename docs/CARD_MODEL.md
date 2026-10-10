# 统一卡片定义与兼容契约

依据：[完整模型](https://app.notion.com/p/3f4038a63d5a811596e2fb8eba890f35)、[2026-10-10 批准的实施范围](https://app.notion.com/p/3f4038a63d5a8152afd1d5318cb0ac5b)、[运行能力核对](https://app.notion.com/p/3f4038a63d5a81b1908df77704827a21)。本文件是开发契约；讨论与理由保留在 Notion。

## 定义所有权

`catalog/card-model.v1.json` 是前后端共享的类型、关系和默认配置来源。顶层类型固定为 `source/process/decision/table/channel/state`；业务子类、技术、环境独立。旧 `nodes.type` 保留兼容，不决定新类别。历史编号不变，也不作为类别依据。

已确认业务模块继续由原 catalog 定义；`definition_refs` 固定文件摘要和选择器。数据库保存实例配置、动作绑定、布局。启动只能补缺，不能覆盖实例；模块变化显示待审阅升级。动作登记和协议适配仍需开发，新增业务无需新增核心类型。

`node_fields`、`edge_field_usages` 仍是字段及血缘身份的唯一来源。`data_schemas` 的字段列表投影所属卡片的字段，不能另建独立副本。`node_ports` 声明方向和 schema；`edge_bindings` 在一条原连接内保存多个含义，以连接、两端端口、关系和稳定分支 ID 去重。显示分支文字不能替代分支 ID。

首版榜单当前模块为[三榜设计](THREE_BOARDS.md) `catalog/leaderboard-trends.v1.json`，每张卡以 `selector.key` 定位；旧五榜模块仅用于历史安装。三榜与共享基础卡的参数仍待确定，不声明已执行。

## 详情展示

[SS-49 已批准详情标准](https://app.notion.com/p/3f5038a63d5a8120826fd3b2a444e24f)由 `CardDetails` 按共享 kind 分派，六类信息顺序、证据边界及验证命令见 [Card UI standard](PRODUCT_WORKFLOW.md#card-ui-standard)。展示解释不修改模块摘要、端口、字段血缘、关系绑定或执行含义。分支跳转按实际端点的绑定与稳定分支 ID 解析，不能用分支标题猜路径；未知导入继续只读。专用组件保留已有业务案例和数值推导，运行核对报告仍独立归属 Few Understand。

## 执行含义

- 关系为 `data/control/read/write/publish/consume/error/reference`；触发独立。读资源不等待资源“完成”，也不默认触发。变化触发必须显式声明。
- `merge` 每条事件独立处理，`one_of` 接受一个互斥来路，`all` 必须有关联键和等待期限。#3009 为 `one_of`；#3006 为 `merge`。
- #3029/#4001/#4003 是判断；#4002 生成建议，是处理；#3002/#3003 的旧类型虽为 `Asset Resolution`，也属于处理。
- #3029 的 first/due 共享一条视觉连接；skip/wait/blocked 为带原因的结束结果。#3030→#3031 有成功和错误绑定，失败保存不会被上游成功条件阻断。
- 端口须属于连接实际端点，各关系有类别约束。按显式触发检测执行环，通道不自动豁免；读写同一资源不是执行环。循环为处理动作的有限配置，须有次数、退出条件、截止时间；跨轮反馈须有下一次触发、去重键及期限。
- 八条旧表→缓存连接保留为引用，提示缺装载动作，不声称同步已实现。
- 新只读 IO 默认 30 秒、最多 3 次尝试、1/5 秒退避，并遵守 Retry-After 和截止时间；新普通处理默认 300 秒、每键串行、并发 1。已有模块沿用原配置，缺值保持未知。写入重试须有幂等或结果核对保证；本程序不实际执行重试。

Studio 负责定义、存储、校验、迁移、展示及交付；Few Understand 负责实际执行、调度和恢复。定义完整、代码存在、部署、健康、覆盖、研究有效性分别表达，不互相推导。

## 接口和保护

所有写请求带 `X-Card-Model: card-model.v1` 及当前 `/api/graph` 的 `If-Match`。旧客户端或过期图返回 409，保留写锁和冲突保护。布局影响图/展示修订，不影响语义修订和包摘要。

| 接口 | 用途 |
| --- | --- |
| `GET /api/card-model` | 六类、默认配置、动作登记 |
| `GET/PATCH /api/nodes/:id/definition` | 实例契约及就绪；修改须带实例 revision，禁止静默换类或替换固定模块 |
| `GET/PUT /api/edges/:id/bindings` | 一条视觉线的多种绑定；原子替换 |
| `GET /api/graph/readiness` | 结构与独立运行兼容差异 |
| `GET /api/graph/package` | 完整 `graph-definition.v1` 包 |
| `POST /api/graph/import` | 合入且不替换整图；相同 ID 冲突拒绝 |
| `GET/POST /api/graph/reports` | 固定包摘要、代码版本、证据引用的独立观察 |

包包含完整图、模块文件及摘要、动作登记、执行配置、兼容审计。允许导出不完整草稿，导出成功不等于可运行。未知模型、类型、动作或关系导入时保留原包为只读草稿，不猜成可执行节点。导入失败在同一事务回滚；导入上限 10 MB，其余请求 1 MB。

原 `signal-package.v2` 及报告接口保留。可表示的原信号仍按旧格式导出；循环、关联汇合、失败/控制/引用绑定和多义连接等无法忠实表示的含义必须明确拒绝，使用新格式，不能有损降级。

## 卡片实现核对标签

[SS-44批准范围及简化要求](https://app.notion.com/p/3f5038a63d5a81f0bd3cf69b5d53506a)：画布每张卡仅一个标签：已实现、未实现、有分歧、与卡片不一致。没有逐卡回报或定义已变更时显示待核实。Studio负责展示，Few Understand实现侧负责填报；详情仅提供一句原因、报告归属/时间和折叠依据。标签不建立部署、运行或本侧独立验收结论。

继续使用 `POST /api/graph/reports`，请求带当前图 `If-Match`、`X-Card-Model`，以及当前完整包的 `package_revision`。逐卡请求示例（占位符不是运行证据）：

```json
{
  "node_id": "<graph.nodes中对应卡号的id>",
  "package_revision": "<GET /api/graph/package返回的package_revision>",
  "code_revision": "<Few提交>",
  "evidence_ref": "<实现/测试依据链接或引用>",
  "reported_by": "few_understand",
  "summary": "与卡片不同的地方或核对结论，一句话即可",
  "observations": {"implementation": "mismatch"}
}
```

`implementation` 使用 `implemented / not_implemented / disputed / mismatch`。有分歧表示需求/解释尚有分歧；不一致表示已观察实现与卡片定义不同。后两种必须有简短原因，新状态必须指定卡片及报告方。身份仍是调用方声明，当前共享服务未增加独立认证。旧字段/状态继续接受：verified显示已实现但仍是实现侧回报，not_started/in_progress显示未实现（具体进展可写原因），partial显示与卡片不一致；planned/blocked无法可靠映射四种结论，显示待核实。

`GET /api/graph` 的 `card_progress` 按节点ID返回标签依据，沿用现有图刷新和编辑冲突保护。服务为逐卡回报保存 `definition_revision`，绑定该卡行为、配置、当前模块摘要、相邻字段结构及连接映射；改标题/坐标、无关卡片或写回报不使标签失效。业务/相关输入发生变化后旧回报保存在原报告表，当前标签退回待核实。没有逐卡修订的历史回报保留为未对齐，不自动套用到当前定义。全图报告不广播为所有卡片已实现。每次回报是完整观察，不继承前次部署/健康声明。

标签和回报不进入执行包或语义摘要；没有新增业务表、调度或自动同步设施。不修改 `action.implementation` 或结构ready来代替真实回报。

## 展示与迁移

创建和主分类只使用六类，业务子类/技术折叠。继续使用 300×160 共享卡片及业务组件。来源/处理先展示输入输出，仅列本步相关输入并链接来源，自然语言算法置后。表先展示横向原始结构/记录，来源说明在后，字段设置折叠。通道/缓存展示自身结构与设置，不添加处理输入输出面板。未知定义只读。没有回填数据的新通用表显示空记录状态，不放虚构行；已有设计案例保持原证据标记。

`CardModel.migrate()` 在业务安装器结束后事务性增量迁移，保留旧节点、连线、字段、血缘、文字、位置。新增 `node_contracts/data_schemas/node_ports/edge_bindings/graph_definition_reports`，重启只补缺项。迁移按批准的业务身份匹配，不能将历史连线编号套用到新安装图。

维护前使用 SQLite backup API 保留完整快照。演练命令：

```sh
python3 scripts/migrate_card_model.py /absolute/path/to/logic.db --report /tmp/card-migration-report.json
python3 -m unittest discover -s server -p 'test_*.py'
npm run build
npm run test:contracts
npm run test:layout
```

脚本只在临时副本检查旧行摘要、外键、完整性、重复迁移及撤销新增定义表后的摘要，不改源库。共享主机更新须停止服务、备份、快进源码、启动并检查健康和客户端；见 [Mac mini 操作说明](MAC_MINI_HOST.md)。不得用测试库覆盖在线库，不提交在线库。

测试覆盖 Studio 模型及隔离接口/界面，不构成 Few Understand 运行验证。`catalog/card-runtime-compatibility.v1.json` 固定代码核对版本及计算范围、来源评分配置、消息映射和内容能力差异。全树适配器搜索未完整完成，不能断言不存在适配器；未运行或部署其任何设施。具体已验证结果以 Notion 交付记录和提交为准。
