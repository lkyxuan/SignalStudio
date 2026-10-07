# SignalStudio → Few Understand 来源契约

SignalStudio 维护希望采集的上游来源和字段。Few Understand 读取这份契约来实现爬虫，并单独回报实现、产出和运行证据。版本化契约的 `owner` 为 `SignalStudio`。旧 `raw-materials.v2.json` 只用于比较现有爬虫，不决定本产品要采什么。

一条具体信号如何使用这些来源、怎样计算和输出，见[信号执行包](SIGNAL_EXECUTION_CONTRACT.md)。来源契约与信号执行包有独立修订号，Few Understand 实现时需同时记录。

## 读取方式

- 版本文件：[`catalog/source-contracts.v1.json`](../catalog/source-contracts.v1.json)。可以直接复制到 Few Understand 的工作区或通过版本化仓库地址读取。
- 本地开发 API：`GET /api/source-contracts/v1` 返回全量文件；`GET /api/source-contracts/v1/meta` 返回版本、修订哈希和数量；`GET /api/source-contracts/v1/operations/{id}` 返回单个操作。当前 API 只在本地运行，尚未部署成 Few Understand 可访问的服务地址。
- `revision` 是除该字段外的 JSON 内容按排序键、紧凑分隔符、UTF-8 编码后的 SHA-256。集成时记录已实现的修订值，后续逐项比较变更。

## 字段语义

- `source_id` 与 `operation.id` 是稳定的规划标识；本产品不再在契约中包含 V2 记录类型别名。
- `endpoint` 指官方 API 路径、MCP 工具，或待确认的第一方页面；`documentation_url` 指证据来源。
- `fields[].path` 是上游返回路径，不是 Few Understand 转换后消息的路径。`label_zh` 与用途文字供设计界面使用；不得拿它们替代原始字段名。
- `fields[].evidence=api_sample` 或 `mcp_sample` 只证明保存的上游响应曾出现该字段。`official_documentation` 表示官方定义或我们从文档挑选的计划字段。`example_value` 不代表爬虫已采集。
- `response_coverage` 明确样本是否仅为下限。所有操作的 `raw_response_policy` 当前为 `preserve_complete_response`：采集时保留上游原始响应或可追溯的原始对象，再另行形成标准化记录，避免设计阶段丢字段。

## Few Understand 回报内容

对每个 `operation.id` 和契约 `revision`，回报实际使用的接口或 MCP 工具、参数样本、代码版本、已实现状态、成功与失败的运行证据、脱敏原始返回样本、发出的记录样本与对应消息结构。把这四件事分别记录：上游可用、代码已实现、消息已发出、运行样本已观察。若某字段被删除、重命名或转换，列出 `upstream path → emitted path`，并标明条件字段与缺失值。不要仅凭本契约存在就标记为已采集。

## 当前需要补证据

- Kaito MCP 未声明 `outputSchema`；21 个工具的样本字段只是已见下限。需要跨参数和多条记录补样本，或取得提供方正式输出结构。
- Taoli 缺少可核对的第一方字段 API 或稳定结构化文档；本契约暂不声明字段。需要用户提供官方接口或核实页面的数据来源。
- Binance `exchangeInfo` 目前只定义发现交易对的操作，未盘点大对象字段。
- RSS、Telegram Bot 与 Telethon 列的是按官方文档选定的计划字段，并非这些开放对象的完整字段集。
- Dex Screener 规划的官方 `/token-pairs/v1/{chainId}/{tokenAddress}` 与旧爬虫路径不同。Few Understand 应按新路径改造或明确反馈不能改造的原因。

重新生成契约：`python3 scripts/build_source_contracts.py`。生成脚本只读取本仓库保存的上游响应和规划字段，不读取 Few Understand V2。

## 用真实快照验证设计案例（2026-10-08，讨论方案）

用户澄清：fewunderstand 已用于实际信号工作；这里需要有实际依据、能与 SignalStudio 预设数据和流程对照的案例，不要求实时数据，也不希望直接把另一产品的数据切进本界面。此前 #1006 增加的五行仍是模拟案例。

本次只读代码检查发现 fewunderstand 已包含 `asset_score.current_score` PostgreSQL 迁移、每分钟物化实现和 `/internal/asset-heat/rankings` 内部 API。API 区分物化记录与请求时重算，可能在物化不可用时回退；代码存在并不能证明当前部署和数据情况。尝试 SSH 检查测试网时，主机密钥校验失败，未查询到数据库，因此旧文档中的“尚无运行结果”不能用于断言 fewunderstand 当前没有记录。

建议（尚未由用户接受，也未实现）：建立“固定真实样本 → 显式字段映射 → 按 Studio 规则回放 → 预期对照”的案例包。

- 从 fewunderstand 只读取得少量资产与关联评分事件的固定快照，保存采样时间、环境、来源及实际覆盖范围。敏感原始数据保存在本地或受控存储，不随公开仓库提交。
- 记录源表/字段到 Studio 字段的映射。真实 ID、事件时间及衰减参数沿用来源；缺失字段标为缺失，不用预设值冒充来源值。别的评分指标不能直接改名成 `total_heat`。
- 区分两种回放：原事件自带的规则可重算 fewunderstand 的原结果；若要试验 Studio 的另一套规则，形成单独的设计试验，明确列出新增假设。真实观察、已存评分、离线计算、模拟输入分别标注。
- 固定 UTC 计算时刻，按冻结的规则计算 #1006，保留完整精度。案例包保留输入、规则版本、计算输出及对照差异。当前分表只有合计分时，不能反推出完整事件和不同半衰期的贡献；这类记录只作为结果快照。
- 先选三至五个实际资产，覆盖单笔起始贡献、重复事件去重、多事件叠加（仅在真实来源已有这些事件和规则时）、衰减及缺字段等代表情形。7/14 天检查点可对真实事件做明确标注的离线时间回放。来源没有的情形另外使用模拟案例。

预设的匹配目标是字段语义、流程行为和可解释的计算结果，不是修改真实数据来凑预设数值。若实际数据揭示契约不适用，应展示差异并讨论调整设计。具体取样环境、脱敏方式、运行器和界面形态待确定；此次讨论不授权部署或执行契约变更。

## #1006 实际回填模块（2026-10-08，已接受并实现）

用户接受“设计 + 实际回填”双区展示，要求先实现 #1006。`GET /api/table-backfills/1006` 读取本机固定快照；`POST /api/table-backfills/1006` 校验并替换该快照。真实来源取样仍待完成，模块不连接 fewunderstand 数据库，也不执行离线评分程序。快照文件 `data/table-1006-backfill.json` 纳入 Git 同步；导入只保存文件，由 Agent 或用户提交并推送。

导入格式（面板提供空模板下载）：

- `version=1`；`evidence_kind=database_snapshot` 或 `offline_replay`。回放结果另需 `derivation_ref` 记录输入/规则依据。
- `source` 包含 `system`、`environment`、`location`、带时区的 `captured_at`。位置应填写可审查的表/API/样本标识，勿填写含密码的连接串。
- `field_mapping` 完整指定 #1006 五个字段对应的源记录键；`asset_name` 可映射为 `null`，其他字段不得缺失。不支持隐式改指标名、生成 ID、补事件时间或将已有分数反推成事件。
- `source_rows` 保存 1–200 条源记录，文件/请求上限为 1 MB。
- 可选 `expected_rows` 包含 `asset_id`、`score_key=total_heat`、`score_value`、带时区的 `calculated_at`。同资产同指标但时间不同不计算分差。匹配判定用完整精度，浮点误差容差为相对/绝对 `1e-12`；实际和预期显示差额供审查。

数据库 `asset_score.current_score` 没有 `asset_name` 时，可在取样阶段显式关联 `asset_core.assets` 获取名称，或在导入映射中将名称设为 `null`。内部排名 API 有回退计算行为；取样时需核对 `materialized` 及每行 `calculated_at`，不能把回退计算或排名中补零的行当作数据库已存的 #1006 行。

## 交给 fewunderstand AI 回填（2026-10-08，推荐方式）

用户询问由哪边的 AI 执行，以及是否需要接口、Prompt、MCP 或 Skill。当前推荐：fewunderstand AI 负责源端只读取样、字段映射和可选回放；SignalStudio 负责快照格式、校验、保存与展示。已有 HTTP 接收接口即可完成第一批，无需新增 MCP。Prompt 负责描述任务，JSON 格式和接口负责稳定交接。频繁重复后可封装 Skill；只有需要跨 AI 客户端提供统一工具入口时，再考虑 MCP。此处为建议，未创建 Skill/MCP 或向其他 AI 发送任务。

接口默认绑定 SignalStudio 所在机器的 `127.0.0.1:8787`。同机 AI 可以 POST；远端运行的 AI 的 localhost 指向远端机器，可以在 SignalStudio 仓库副本中生成并校验快照，提交并推送；另一台机器拉取仓库后重新打开面板即可读取。不要为了这次快照工作直接公开本地接口。快照验证只能检查格式与数值约束，来源真实性仍依赖取样证据；对照通过也不等同于整个评分链路已验证。

可复制给 fewunderstand AI 的任务：

> 请为 SignalStudio 的 #1006（asset_scores_current）准备一份固定真实案例快照。先读取 SignalStudio 的 docs/FEWUNDERSTAND_INTEGRATION.md 中“#1006 实际回填模块”格式，以及 catalog/business-tables.v1.json 的对应表定义。
>
> 在已获授权的 fewunderstand 环境中，只读取样 3–5 个有代表性的 total_heat 当前分记录，优先检查 asset_score.current_score。保存实际资产 ID、完整精度分数、每行 calculated_at、采样时间、环境和来源位置。名称可显式关联 asset_core.assets 获取，并在来源中记下关联；无法取得时按格式映射为 null。确认这些是实际存储的行；不要把内部排名接口的补零行或回退重算当成已存记录。
>
> 如果没有可用的当前分，但有可追溯的原始事件和冻结规则，可在固定时间离线回放，标记 evidence_kind=offline_replay，并通过 derivation_ref 引用保存的输入、规则和计算依据；若资料不足，报告缺口。不要生成模拟数据来填充实际回填。
>
> 按 version=1 格式输出 JSON。expected_rows 可以先留空；只有独立按明确规则计算出的预期才用于对照，不能复制实际分数作为预期。预期必须对应同一资产、指标和计算时间；不要用 Studio 模拟案例的资产 ID 或分数替换真实值。
>
> 在 SignalStudio 仓库副本中工作，先同步当前分支并保留未提交的改动。若本机接口可用，GET http://127.0.0.1:8787/api/table-backfills/1006 检查已有快照，再 POST 新快照（Content-Type: application/json），最后 GET 核对回填行数、来源和数值。若接口不可达，直接使用 server/table_backfill_store.py 的 TableBackfillStore().save(payload) 校验并写入默认文件 data/table-1006-backfill.json。只提交这一份已校验快照及本次必要的说明，推送到当前分支，并报告提交号。另一台电脑拉取仓库、重新打开 #1006 面板即可显示。不要写入源数据库、部署或变更源表/规则；凭据和含密码的连接串不写入快照。完成后报告取样来源、行数、证据类型及任何缺口。

## 跨电脑同步（2026-10-08，用户明确要求）

此前实现将实际回填文件与临时采样一同忽略，未覆盖跨电脑工作需求。用户明确要求用 GitHub 同步回填数据，现将 `data/table-1006-backfill.json` 加入 `.gitignore` 例外。设计案例 `catalog/business-table-cases.v1.json` 原本已在 GitHub；实际快照在首次生成后提交。此次检查默认位置尚无真实快照，未用模拟记录填充该文件。

默认流程为：fewunderstand Agent 取样 → 在 SignalStudio 仓库写入并校验 JSON → commit/push → 另一台电脑 pull → 重新打开 #1006 面板。接收端每次 GET 都从文件读取，不需要另做一次导入或数据库迁移。现有面板不会轮询 Git 或自动刷新已打开的快照。API 保存不自动提交或推送；Agent 需完成 Git 同步。若设置 `SIGNALSTUDIO_BACKFILL_PATH` 自定义路径，则需自行安排该路径的同步；跨电脑协作推荐使用默认路径。

只对当前 #1006 快照增加 Git 例外，临时文件、备份和其他未指定数据仍按既有忽略规则处理。两台电脑同时修改同一快照时应先处理 Git 差异，不能用强制推送或静默覆盖代替合并判断。

## 共享在线服务方案（2026-10-08，已讨论，暂缓）

用户指出本地数据库和本地预览使其他协作者回填不便，询问是否应发布网站以便推送后及时可见。此前 GitHub 同步方案仍已实现；本轮仅讨论可能的下一步，不授权部署或切换数据权威。

核心区别：网站有在线地址不等于拥有共享数据存储。仅发布静态前端无法运行现有 Python 写入接口；通过 Git 提交快照再触发构建，仍要等待同步/构建。若 fewunderstand Agent 直接向共享后端提交快照，并由各电脑读取同一持久存储，则无需为每次数据更新提交或部署网站。

建议先采用一个小型共享 SignalStudio 服务：托管前端和后端，持久保存设计项目状态（当前 SQLite）和固定案例快照。初期单实例、低并发可继续使用 SQLite 与 JSON，但必须使用持久磁盘并备份，不能只写入会随部署消失的目录。多人/多实例并发增长时，再评估共享数据库。网站登录和 Agent 专用回填凭据必须覆盖对外接口；不能直接公开目前单用户、无认证的全部写接口。Agent 的权限应限定为提交指定表的案例快照。

fewunderstand Agent → 经认证的快照接收接口 → 共享案例存储 → 各电脑的 SignalStudio 页面。来源数据库仍由 fewunderstand 管理；每次上传的是有采样时间和来源的固定案例，不意味着接入实时行情。接收接口保留现有字段校验，并建议增加快照版本、提交来源、设计契约修订号及重复提交/并发覆盖处理，便于追溯设计与样本是否对应。

现有页面只在面板挂载时 GET。即便后端部署在线，已打开的页面也不会自行更新。第一版可增加手动刷新或在页面可见时每 10–30 秒检查版本，有更新再读取；更严格的即时通知可后续评估 SSE。服务端写入成功、页面收到新版本和源数据采样时刻是三个不同时间。

建议 GitHub 继续管理代码、设计契约和明确冻结的案例版本；共享后端管理正在协作的项目状态及回填快照，避免多台电脑各自提交同一活动数据库。正式切换前需明确权威数据位置、迁移/备份方式以及本地开发与共享环境的区分。当前仍按原本地/Git 工作方式运行。部署位置、访问人员与刷新要求待用户进一步选择。

## 托管服务选型（2026-10-08，备选，暂缓）

用户进一步询问共享数据库放在哪里，以及 GitHub、Vercel、Cloudflare、Supabase 的角色。共享数据库应位于各客户端都能访问的服务端，可以是托管数据库或自管服务器；GitHub 保存仓库和版本，不替代当前应用的运行时数据库。

本轮建议：若希望减少服务器运维、长期支持跨电脑协作，采用 GitHub 管代码 + Vercel 构建/托管网页及经适配的 API + Supabase 托管 PostgreSQL 与登录。SignalStudio 的设计项目状态、图节点/连线、实际回填快照与历史保存在专用的 SignalStudio 数据空间，fewunderstand 仅通过受限回填接口提交选定案例。网页刷新/轮询或订阅机制负责显示更新；数据回填不触发网站重建。若选 Supabase，应先核对现有账号和项目情况，再决定新建独立项目或其他明确隔离的组织方式，不直接混用 fewunderstand 的业务表。

这是与上一节单服务器方案不同的取舍：单服务器 + 持久磁盘最少改动现有 Python/SQLite/JSON，但需要自行维护运行环境、备份等；托管方案减少这部分运维，却需要把 SQLite/文件读写改成远端存储、适配 API 部署方式并加入身份和权限。当前项目不能只导入 Vercel 就完整上线。

Cloudflare 也可承载整套服务：Workers/静态资源托管 + D1。D1 提供 SQLite SQL 语义，但不等于把现有 Python sqlite3 文件连接原封不动上传；必须改用对应的数据库访问接口并适配后端。它是可行备选，并非 Vercel + Supabase 之外还必须增加的第三个平台。本轮没有比较具体价格、开通账号、创建云资源或部署。

核对依据（官方文档，2026-10-08）：
- Vercel Git 自动部署：https://vercel.com/docs/git
- Vercel 的 SQLite 限制：https://vercel.com/kb/guide/is-sqlite-supported-in-vercel
- Supabase PostgreSQL 与相关服务：https://supabase.com/docs/guides/database/overview
- Cloudflare D1 与 Workers/HTTP API：https://developers.cloudflare.com/d1/

## 当前阶段决定（2026-10-08，用户确认继续 Git 同步）

用户指出网站、字段与需求仍在频繁迭代，现阶段引入托管数据库、认证及部署适配会增加流程负担，认为继续从 GitHub 拉取数据可满足当前需求。因此继续本地预览 + GitHub 同步代码、设计契约和固定回填快照；暂缓前述云端数据库及在线部署改造。上述托管方案保留为后续备选，不作为当前实施计划。

日常交接保持简单：fewunderstand Agent 在最新契约下取样，校验并保存 data/table-1006-backfill.json，提交并推送；另一台电脑拉取相应版本，重新打开 #1006 面板读取。涉及代码更新时按开发流程重新构建或重启本地服务；涉及 data/logic.db 同步时沿用 README 的停服同步约定。代码、契约与对应样本可以随同一次提交交接，便于还原某个设计版本下的案例。

将来若协作主要变成持续回填、需要无需拉取即可看到新结果，或多人同时写入导致频繁冲突，再重新评估共享后端。网站不必完全定型才能部署；是否迁移以协作需求和维护成本为依据。当前未创建任何云端资源或更改运行架构。
