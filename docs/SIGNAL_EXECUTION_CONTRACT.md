# 一条信号交给 Few Understand 的执行包

## 当前可审阅的信号

`coingecko_market_turnover_candidate`（图中“市场交易活跃候选”）是第一条示范信号。它每小时规划读取 CoinGecko 市场列表，用来源提供的 24 小时成交额除以市值；比值至少 0.2、成交额至少 100 万 USD、市值至少 1000 万 USD 时，输出一条待调查候选。阈值是**设计假设**，尚无爬虫运行样本、回测或有效性验证。输出身份是 CoinGecko coin ID，不自动合并为内部资产。

机器配置保存在 [`catalog/signal-contracts.v1.json`](../catalog/signal-contracts.v1.json)。设计图节点、输入需求、来源字段映射、输出字段和 Redpanda 连接由 `scripts/seed_example_signal.py` 写入项目 SQLite。脚本可重复运行；已有同一 `signal_key` 时不会覆盖图上修改。版本化配置是执行语义的权威来源；图中文字若与配置不同，执行包会显示未就绪。以后每次修改执行语义都应增加信号版本，并同步更新图与验证资料。

## 读取

- `GET /api/signals`：列出产品拥有的信号及其图节点 ID。
- `GET /api/signals/coingecko_market_turnover_candidate/package`：返回一条信号的完整执行包；也可用图节点 UUID。
- 不方便访问本地 API 时，读取本次导出的 [`handoff/coingecko_market_turnover_candidate.v2.json`](../handoff/coingecko_market_turnover_candidate.v2.json)。项目图变更后可运行 `python3 scripts/export_signal_package.py coingecko_market_turnover_candidate handoff/coingecko_market_turnover_candidate.v2.json` 刷新快照；脚本拒绝导出未就绪的配置。旧的 v1 文件保留作历史对照，不包含本次 L001 消息契约。
- 返回内容包括版本化定义、CoinGecko 上游操作契约及其修订号、该信号的上游设计子图、输入/输出字段映射、实施就绪检查和运行证据状态。
- `revision` 是执行定义与来源契约修订号的规范 JSON SHA-256；设计图快照、画布位置及运行回报不进入该哈希，因此同一配置在不同项目数据库中仍有相同修订号。设计图仅用于核对输入映射及可读说明。Few Understand 应保存 `signal_key`、`signal_version`、包 `revision`、`source_contract_revision`，按这些值定位所实现的配置。包修订变化时重新比对。
- `implementation_readiness.status=ready` 只表示本产品的规划配置、字段映射和图连接完整，**不表示**上游 API 凭据可用、消息主题已创建、爬虫已运行或信号有效。`transport.*.deployment_status=planned` 明确标出消息主题尚未部署。
- `definition.implementation_guidance` 标出目标平台、各阶段涉及的产品和推荐技术栈。本信号推荐 Few Understand 使用 Python + Polars 计算，并把现有 `consumer/polars_engine` 标为待评估组件。技术与组件是实施建议；`collection`、`inputs`、`processing`、`output` 和证据要求是目标行为。Few Understand 可以选用已有 scorer、Polars Engine 或新组件；对采集频率、消息通道等目标配置的改动也应回报差异，供本产品审核。

## L001：爬虫消息到信号计算

点击设计图的 `L001`，连接面板展示爬虫规划写入 Redpanda 主题 `source.coingecko.coins_markets.v1` 的**全部已声明消息字段路径**、元信息和消息键，不在连线详情中解释信号计算。`GET /api/edges/4b587316-ebcc-4754-af3a-0b4e0e628e40/contract` 返回同一消息契约；完整执行包的 `connection_contracts` 也包含它。信号版本 2 指定每个 CoinGecko 币种一条 JSON 消息，消息键取 `data.id`：

```json
{
  "data": {"id": "<来源币种 ID>", "last_updated": "<来源时间>", "total_volume": "<来源数值>", "market_cap": "<来源数值>", "...": "<保留该来源记录的其他字段>"},
  "meta": {"operation_id": "coingecko.coins_markets", "source_run_id": "<运行 ID>", "source_observation_id": "<观察 ID>", "collected_at": "<采集 UTC 时间>"}
}
```

这是**目标消息结构示意**，占位符不是观测值。`data` 规划保留每条上游记录的全部字段，新增而未声明的上游字段也透传。来源契约目前列出 34 个字段路径；这是已声明字段的下界，不是爬虫实际发出字段的证据。

点击下游的“市场交易活跃候选”节点，才查看它如何消费 L001：`R001–R004` 分别表示 `data.id → coin_id`、`data.last_updated → last_updated`、`data.total_volume → total_volume_usd_24h`、`data.market_cap → market_cap_usd`。节点计算新字段 `turnover_ratio_24h = total_volume_usd_24h / market_cap_usd`，满足触发规则后计划把 9 个输出字段送往 `signals.coingecko_market_turnover_candidate.v1`。`GET /api/nodes/bea1d62d-395f-4bf8-bfe2-0fec37d874aa/contract` 返回此节点契约；执行包将它放在顶层 `processor_contract`，与 `connection_contracts` 分开。

当前只有设计连接，没有真实 Redpanda 消息或逐条记录链路。Few Understand 实现后须回报实际发出消息的样本引用、字段映射、topic/键和来源运行 ID；若实际爬虫仍写 `market.snapshot` 或裁剪字段，应把差异明确报回，不能把设计契约标作运行事实。

本地开发 API 只绑定 `127.0.0.1:8787`；跨机器接入前还需要由部署环境提供可访问地址与鉴权。也可把版本文件和包 JSON 交给 Few Understand，在它的工作区按修订号读取。

## Few Understand 实现与回报

Few Understand 按包里的 `collection` 实现请求、分页、节奏、时间、原始响应保存和覆盖状态；按 `inputs` 转换字段；按 `processing` 计算与判断；按 `output` 发候选记录。它应记录自己实际使用的上游参数和 `upstream path → emitted path`，并区分配置声明与真实运行证据。

请求明确使用 CoinGecko Pro URL、`x-cg-pro-api-key` 请求头和运行环境的 `COINGECKO_API_KEY` 密钥引用。包不包含密钥值；若 Few Understand 环境没有该凭据、Redpanda 主题或原始响应存储，应回报 `blocked` 及具体缺项，不得把配置可读当作运行成功。

- `GET /api/signals/{signal_key}/reports`：读取实施回报。
- `POST /api/signals/{signal_key}/reports`：写入一份回报。必需字段是 `signal_key`、`signal_version`、`package_revision`、`source_contract_revision`、`implementation_status` 和 `coverage_state`；任何非 `not_run` 的覆盖状态还须有 `source_run_id`。修订号须与当前包一致。
- `implementation_status` 取 `not_started / in_progress / implemented / blocked / failed`；`coverage_state` 取 `not_run / complete / partial_coverage / failed`。
- 还应回报 `code_revision`、`source_request_parameters`、`raw_response_sample_ref`、`emitted_record_sample_ref`、`upstream_to_emitted_field_mapping`、`technology_decisions` 和 `errors`。`technology_decisions` 写实际计算引擎、运行语言、采用的组件及与建议的差异；标记 `implemented` 时至少提供 `compute_engine`。样本字段是可追溯引用，不能用契约里的示例值冒充运行记录。

示例请求结构（占位值必须换成所读取包的真实值）：

```json
{
  "signal_key": "coingecko_market_turnover_candidate",
  "signal_version": 2,
  "package_revision": "sha256:<从执行包读取>",
  "source_contract_revision": "sha256:<从执行包读取>",
  "implementation_status": "in_progress",
  "coverage_state": "not_run",
  "code_revision": "<Few Understand 代码版本>",
  "source_request_parameters": {},
  "upstream_to_emitted_field_mapping": {},
  "technology_decisions": {},
  "errors": []
}
```

一次回报不能证明信号有效。产品必须取得实际采集样本、覆盖情况、计算核对和历史人工检查结果，才能把设计假设推进为已验证信号。

## 与本机 Few Understand 代码的初次对照

2026-09-28 只读检查了本机 `fewunderstand` 仓库提交 `475322194e4ba0683ef9eade4d87e2c06dfe1e7b`。`consumer/coingecko_market_signal_scorer/scorer.py` 已有 `volume_spike`：当 `total_volume / market_cap >= 0.2` 且市值大于 0 时产生候选。这部分计算可以作为复用候选，**不能据此标记为已符合本执行包**。

| 对照项 | 本产品执行包 | Few Understand 当前代码/配置 |
|---|---|---|
| 采集范围 | 每小时；最多 100 页 × 100 条，直到空页 | 默认每 3 分钟；固定并发抓取 10 页 × 250 条，随后过滤市值不高于 1000 万 USD 的币种 |
| 输入消息 | 规划 `source.coingecko.coins_markets.v1` | 当前配置写入 `market.snapshot` |
| 计算 | 比值至少 0.2，同时要求成交额至少 100 万 USD、市值至少 1000 万 USD | `volume_spike` 只检查比值与正市值；爬虫另做市值过滤 |
| 输出消息 | 规划 `signals.coingecko_market_turnover_candidate.v1`，包含包版本与来源运行/观察 ID | 当前输出到 `signal.data`，使用另一组显示和证据字段 |
| 覆盖及追溯 | 明确分页上限、失败/部分覆盖状态、原始响应引用 | 代码审查未发现与本执行包对应的运行回报；不能从代码推断真实运行覆盖 |

这些差异是供实施者逐项比较的**代码证据**，不改变本产品拥有的目标配置。Few Understand 可选择复用现有爬虫和处理器，但必须回报哪些设置已符合、哪些需要改造，以及一次真实运行的证据。
