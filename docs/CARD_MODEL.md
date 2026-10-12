# 统一卡片定义与兼容契约

依据：[完整模型](https://app.notion.com/p/3f4038a63d5a811596e2fb8eba890f35)、[2026-10-10 批准的实施范围](https://app.notion.com/p/3f4038a63d5a8152afd1d5318cb0ac5b)、[运行能力核对](https://app.notion.com/p/3f4038a63d5a81b1908df77704827a21)。本文件是开发契约；讨论与理由保留在 Notion。

## 定义所有权

`catalog/card-model.v1.json` 是前后端共享的类型、关系和默认配置来源。顶层类型为 `source/process/decision/table/channel/state/interface`；业务子类、技术、环境独立。旧 `nodes.type` 保留兼容，不决定新类别。历史编号不变，也不作为类别依据。

已确认业务模块继续由原 catalog 定义；`definition_refs` 固定文件摘要和选择器。数据库保存实例配置、动作绑定、布局。启动只能补缺，不能覆盖实例；模块变化显示待审阅升级。动作登记和协议适配仍需开发，新增业务无需新增核心类型。

`node_fields`、`edge_field_usages` 仍是字段及血缘身份的唯一来源。`data_schemas` 的字段列表投影所属卡片的字段，不能另建独立副本。`node_ports` 声明方向和 schema；`edge_bindings` 在一条原连接内保存多个含义，以连接、两端端口、关系和稳定分支 ID 去重。显示分支文字不能替代分支 ID。

首版榜单当前模块为[三榜设计](THREE_BOARDS.md) `catalog/leaderboard-trends.v1.json`，每张卡以 `selector.key` 定位；旧五榜模块仅用于历史安装。三榜与共享基础卡的参数仍待确定，不声明已执行。

## 详情展示

[SS-49 已批准详情标准](https://app.notion.com/p/3f5038a63d5a8120826fd3b2a444e24f)由 `CardDetails` 按共享 kind 分派，原六类信息顺序、证据边界及验证命令见 [Card UI standard](PRODUCT_WORKFLOW.md#card-ui-standard)。展示解释不修改模块摘要、端口、字段血缘、关系绑定或执行含义。分支跳转按实际端点的绑定与稳定分支 ID 解析，不能用分支标题猜路径；未知导入继续只读。专用组件保留已有业务案例和数值推导，运行核对报告仍独立归属 Few Understand。

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
| `GET /api/card-model` | 七类、默认配置、动作登记 |
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

## 连线语义与触发追溯

[SS-69 用户批准范围](https://app.notion.com/p/3f7038a63d5a81e88d54ea55ea70f60f)（2026-10-12）：所有视觉线从 `graph.bindings` 显示关系文字；颜色辅助区分触发、读取、写入及其他关系。`data/control/read/write/publish/consume/error/reference` 均显示，一条线的多个绑定保留全部含义。缺少绑定显示「关系待定义」；绑定中的未解决项显示「待完善」。不按表的位置或节点类型猜测缺失的关系。

2026-10-12 用户批准请求/返回与流程联动：完整画布、单步关系和详情保留持久 `reference_number`，如 `L024`；普通主动读取从表/缓存到处理的 `read, trigger=none` 关系，若绑定完整且无未解决项，则派生相反方向的请求箭头 `L024-Q`。原线显示「返回数据」，请求显示「读取请求」。Q 后缀唯一对应原线，不随聚焦、语言、重载或布局变化。请求是只读展示投影，编辑/删除入口指向原逻辑读取关系；不创建执行绑定、数据库关系、请求记录或新的业务调度。混合关系、未知触发、未解决定义以及变化订阅不自动补请求。阶段号①②③与线号分开。 请求与返回共用同一物理走线方向，端点并排排列，曲线保持并行且箭头相反；不能因分别计算方向而让同一读取的两条线交叉。该要求适用于全部完整读取往返投影，未要求消除不同流程之间的所有交叉。

以来源/处理/判断为一步流程归属：read 归读取者、write/publish 归发送者、consume 归消费者，data/control/error 可同时属于相邻的两个动作；引用不推断执行归属。单击线默认突出所属处理的整组箭头、标签和端点，交接线提供相邻流程切换；选择处理或判断突出它的全部直接入口、请求/返回及输出。仅共享同一张表不合并流程。不沿存储穿透到其他写入者/读取者，也不把被动表当成调用者。普通边的两个动作归属默认优先数据发送者；控制事件优先接收判断/处理。

触发源头通过独立说明追溯 `config.trigger=event/change`，消费可追溯通道生产者；变化读取停在数据变化源，不推断哪个写入者引起变化。触发祖先不混入当前步骤的整组高亮，多入口、循环和断点保留说明。这是设计关系而非运行日志；并列输入及备选分支不表示全部同时执行。全图职责核对见 [流程连线核对](FLOW_RELATIONS.md)。
触发入口读取实例的 schedule/manual 配置。原模块仍绑定时，#4003 的人工审核、#4002 的定期检查、结构化 source-collection-plans 的来源定时、score-rollup 模块及 leaderboard-foundation 的 Redis 汇总 60 秒定时定义也作为入口说明；模块事件触发尚未表达为图绑定时仍保留事件来源待定义提示。模块名或绑定被替换后不套用原模块解释。#3003 原身份模块的已定义顺序在聚焦时标为①批准后触发、②读取当前记录、③核对通过后写入；并行读写共用阶段号。其他关系没有顺序定义时只显示真实关系文字，不按全图拓扑编号。

定时卡片的起点标签显示闹钟图标及「定时启动」，源头说明按钮也带闹钟。使用实例 schedule 或仍绑定的已知定时模块定义；不从卡片位置或普通 read 箭头推断定时，不给请求/返回箭头附加起点标记。

未聚焦时不展示连线说明框；删除默认标题和触发/读取/写入/引用图例，选中连线后保留具体流程说明（[SS-76](https://app.notion.com/p/3f7038a63d5a8119a0b9d2881813ecde)）。单击线保留画布空间，说明区列出本组编号及触发源头，并提供适应关联流程、连线详情、单步关系和取消聚焦；双击线可直接打开详情。单步关系展示同一套语义及源头，返回完整画布不保存或修改节点坐标。画布的显式完整关联路线功能仍表示完整数据依赖，和触发追溯分别展示。

验证命令：`npm run build`、`npm run test:layout`、`npm run test:contracts`。布局检查包含关系覆盖、多绑定、阶段保护、共享表分支隔离、消息及多个触发入口、变化触发边界和循环，以及请求/返回方向、稳定编号、整组联动、多入口判断和定时标记；这些检查不证明后端触发已运行。

## 展示与迁移

创建和主分类使用七类，业务子类/技术折叠。继续使用 300×160 共享卡片及业务组件。来源/处理先展示输入输出，仅列本步相关输入并链接来源，自然语言算法置后。表先展示横向原始结构/记录，来源说明在后，字段设置折叠。通道/缓存展示自身结构与设置，不添加处理输入输出面板。未知定义只读。没有回填数据的新通用表显示空记录状态，不放虚构行；已有设计案例保持原证据标记。

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

## 应用界面卡（SS-71）

[批准依据与交付范围](https://app.notion.com/p/3f7038a63d5a81db8607df99250738df)。`interface` 是附加的第七类，兼容类型 `Application Interface`，使用 7xxx 新编号，已有编号不变。沿用 `card-model.v1` 的加法扩展；不识别新 kind 的导入器仍须按现有规则将整个未知包隔离只读，不能猜为处理动作。旧客户端需保存后刷新更新。

界面表示用户看到的内容及操作要求，不是调度任务。其动作 ID 为空、trigger 为 unspecified、无判断分支或循环；不允许配置执行动作或定时/事件触发。资源到界面为 read/none。界面与判断之间可以用 reference/none、`config.role=human_review_surface` 明确关联人工审核界面，不作自动控制或数据直连；接口/建议存储未定义仍明示未知。界面关系只允许 read/reference、trigger=none，不允许写入、发布、消费或自动执行关系。

`catalog/application-interfaces.v1.json` 定义资产得分和资产纠错审核两张界面的内容、操作、限制及验收要求。实例 `config.interface` 保存该定义、未绑定的 endpoint/api_endpoint；定义通过 definition_refs 固定模块摘要并随图包交付。实际页面/API 未绑定时 readiness 报 interface_binding_unverified；实现、部署和运行证据仍只来自独立报告。

`server/application_interfaces.py` 在原模块存在、CardModel 迁移后原子新增两卡和两条关系；只在首次安装写入新卡配置，后续启动不覆盖用户修改或恢复已删除的卡。同名用户卡冲突时停止并明确报错，不擅自接管。原卡、字段、关系、绑定及坐标不改。新卡放在目标附近的空位置；只有用户点击整理才应用当前 ss75-spacious-towers.v1 布局（SS-73 在每条爬虫独立分塔的基础上保留以下界面位置规则）：得分页面在 Supabase 下游，审核页面归入既有维护支线，不增加职责区分框。

详情按用途、关联、内容、读取展示规则、用户动作、待实现限制和验收顺序显示；这是设计交付，不提供真实批准/纠错按钮。得分页面链接 #1007 frontend_read 单一规则，界面字段列表是交付要求而非第二份数据 schema。审核页面承载 #4003，保留原 #4002/#4001→#4003→#3003 分支语义和获批后当前记录核对。不能以本次新增定义声称 fewunderstand 已实现或接收需求。

验证：`PYTHONPATH=server python3 -m unittest test_application_interfaces test_card_model test_graph_service`、`npm run test:contracts`、`npm run test:layout`、`npm run build`。隔离副本验证安装、重启幂等、原内容不变及图包导入导出；浏览器核对中文/英文、详情和连线。真实审核 API、账号权限、AI 检查、执行程序与业务前端部署不属于本次实现。
