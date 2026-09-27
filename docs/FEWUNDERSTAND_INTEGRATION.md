# Data Logic IDE → Few Understand 来源契约

Data Logic IDE 维护希望采集的上游来源和字段。Few Understand 读取这份契约来实现爬虫，并单独回报实现、产出和运行证据。旧 `raw-materials.v2.json` 只用于比较现有爬虫，不决定本产品要采什么。

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
