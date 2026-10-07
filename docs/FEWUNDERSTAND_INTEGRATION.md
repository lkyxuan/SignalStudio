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

用户接受“设计 + 实际回填”双区展示，要求先实现 #1006。`GET /api/table-backfills/1006` 读取本机固定快照；`POST /api/table-backfills/1006` 校验并替换该快照。真实来源取样仍待完成，模块不连接 fewunderstand 数据库，也不执行离线评分程序。快照文件被 `.gitignore` 排除；本地文件不随公开仓库发布。

导入格式（面板提供空模板下载）：

- `version=1`；`evidence_kind=database_snapshot` 或 `offline_replay`。回放结果另需 `derivation_ref` 记录输入/规则依据。
- `source` 包含 `system`、`environment`、`location`、带时区的 `captured_at`。位置应填写可审查的表/API/样本标识，勿填写含密码的连接串。
- `field_mapping` 完整指定 #1006 五个字段对应的源记录键；`asset_name` 可映射为 `null`，其他字段不得缺失。不支持隐式改指标名、生成 ID、补事件时间或将已有分数反推成事件。
- `source_rows` 保存 1–200 条源记录，文件/请求上限为 1 MB。
- 可选 `expected_rows` 包含 `asset_id`、`score_key=total_heat`、`score_value`、带时区的 `calculated_at`。同资产同指标但时间不同不计算分差。匹配判定用完整精度，浮点误差容差为相对/绝对 `1e-12`；实际和预期显示差额供审查。

数据库 `asset_score.current_score` 没有 `asset_name` 时，可在取样阶段显式关联 `asset_core.assets` 获取名称，或在导入映射中将名称设为 `null`。内部排名 API 有回退计算行为；取样时需核对 `materialized` 及每行 `calculated_at`，不能把回退计算或排名中补零的行当作数据库已存的 #1006 行。
