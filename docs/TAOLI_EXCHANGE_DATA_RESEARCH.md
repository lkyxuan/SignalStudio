# 以 Taoli Tools 为线索，直接采集交易所数据

核对日期：2026-09-28。本文是数据源研究与采集设计，不代表这些交易所的数据已进入 Few Understand，也不代表任何套利机会已验证。

## 目标与边界

Taoli Tools 是一个跨 CEX、Perp DEX 和现货 DEX 的对冲交易工具。它的[支持列表](https://docs.taoli.tools/)列出 11 个 CEX、13 个 Perp DEX 和 9 个现货 DEX 接入。这里把它当作**交易场所发现清单和产品功能参照**；采集时应向各交易所的官方 API、WebSocket 或链上协议取原始数据，保存来源和时间，而不是把 Taoli 首页的展示值当作权威原始记录。

“所有数据”在第一阶段解释为**套利研究所需的公开市场数据**，覆盖 Taoli 支持的交易场所和相关现货、永续合约市场。交易所的所有 API 还包括账户、下单、转账、风控等私有功能；这些不属于公开采集。账户余额、仓位、个人手续费、实际资金费收支和成交记录需要用户授权的账户或钱包，另行设计。

## 需要直接采集的原始事实

| 数据组 | 原始字段或对象 | 研究用途 | 采集方式与关键限制 |
| --- | --- | --- | --- |
| 市场目录与规则 | 场所、市场类型、交易对、base/quote、合约乘数、状态、最小下单量、价格/数量步长、上线/下线时间、资金费间隔 | 确认两边是否真是可比较、可交易的同一资产 | 定时 REST + 变更流；保留交易所原始符号和资产标识 |
| 即时报价 | 买一/卖一价格及数量、成交价、标记价、指数价、报价时间 | 计算两种方向的表面价差，并识别过期报价 | WebSocket 优先；每边要保留交易所事件时间和本地接收时间 |
| 订单簿与成交 | 多档 bid/ask 价格和数量、逐笔成交 | 按目标金额估算深度、冲击成本和真实可成交价 | 先取快照，再按官方规则衔接增量；监测断序与重同步 |
| 资金费 | 当前或预估费率、下次结算时间、历史实际结算费率、上下限、间隔 | 比较不同场所的费率和结算窗口 | 区分预测值与已结算值；不能把不同间隔的百分比直接相减 |
| 市场规模 | 未平仓量及其计价单位、24h 成交量与成交额、历史变化 | 过滤低流动性市场，观察容量 | OI 的合约张数、币数、美元价值要明确换算口径 |
| 现货杠杆成本 | 借贷利率、可借额度、借币状态 | 估算现货杠杆腿的持有成本 | 公开信息与账户专属额度分开记录 |
| DEX 报价与成本 | 链、池、代币合约、路由、按指定金额报价、池流动性、协议费、预估 gas、最小输出 | 估算链上那一腿实际拿到的数量与成本 | 报价依赖输入金额、方向、链上状态和区块高度；不能只存一个“价格” |
| 运行状态 | 交易对是否暂停、只减仓、充提状态、网络状态、API 延迟/错误 | 排除无法完成两边交易的情形 | 各场所可用性不同；缺值不等于正常 |

官方接口已能证明这种拆分可行。[Binance USDⓈ-M 市场数据](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)分别列出交易规则、盘口、资金费和未平仓量等操作。[Bybit V5 ticker](https://bybit-exchange.github.io/docs/v5/market/tickers)返回买一卖一、24h 成交额、未平仓量、资金费率和下次结算时间；[Bybit instruments](https://bybit-exchange.github.io/docs/v5/market/instrument)给出交易规则和结算间隔；[Bybit 历史资金费](https://bybit-exchange.github.io/docs/v5/market/history-fund-rate)是另一项查询。[Kraken Futures ticker](https://docs.kraken.com/api-reference/market-data/get-tickers)也提供买卖盘、未平仓量及资金费，[盘口](https://docs.kraken.com/api-reference/market-data/get-orderbook)和[历史资金费](https://docs.kraken.com/api-reference/historical-funding-rates/historical-funding-rates)是独立操作。[OKX API](https://my.okx.com/docs-v5/en/)分别提供市场、盘口、资金费、未平仓量等操作；[Hyperliquid Info API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)提供永续市场元数据及历史资金费查询。这些是**官方接口能力**，不是本系统已采集的记录。

## 现有仓库与缺口

Few Understand 的 `spider/binance-futures/spider.py` 已设计读取 Binance USDⓈ-M 的 `exchangeInfo`、K 线、当前及历史未平仓量、`premiumIndex`、多空账户/仓位比和主动买卖比。现有 `taoli-spider` 通过页面行的 `span` 位置抓取 8 个显示字符串，另加 `collected_at`。前者目前未覆盖跨所套利最关键的买卖盘、深度和已结算资金费历史；后者没有直接连接交易所，而且继承 Taoli 首页默认的未平仓额与日成交额各不低于 100 万美元筛选。

2026-09-28 对 Binance `premiumIndex?symbol=BTCUSDT`、Bybit `tickers?category=linear&symbol=BTCUSDT` 和 Kraken Futures `/derivatives/api/v3/tickers` 的公开接口做过一次只读请求，均返回了结构化数据；这仅证明当时可访问，**不证明爬虫或 Redpanda 中已有对应记录**。同次环境中 OKX 官网 API 连接失败，原因尚未验证，不应推断 OKX 不提供该数据。当前 [SignalStudio 来源契约](../catalog/source-contracts.v1.json)也只把 Taoli 首页列为“未取得稳定字段契约”的页面来源。

### 2026-09-28 仓库状态核对

| 场所 | 代码状态 | 仍缺的套利研究输入 |
| --- | --- | --- |
| Binance | 仅 `spider/binance-futures`：默认发现交易中的 USDT 本位永续合约，配置采集 8 类指标，每 30 分钟一轮；运行时 registry 状态为 `developing` | 现货、币本位合约、盘口/深度、历史实际结算资金费，以及其他市场数据；也缺已验证的实发记录证据 |
| Bybit | 未发现专用 spider；`derivatives.metrics` topic 注册表仅把它列为规划中的来源 | 市场目录、tickers、资金费历史、盘口等均待实现与验证 |
| Kraken | 未发现专用 spider | Futures 与 Spot 的市场目录、tickers、资金费历史、盘口等均待实现与验证 |
| OKX | 未发现专用 spider | SWAP 与 SPOT 的市场目录、tickers、资金费历史、盘口等均待实现与验证；本地网络连接问题待定位 |

Binance 的 8 类 transform 样本在 Python 3.11 下均能解析。当前机器默认 `python3` 是 3.9；用它运行局部测试会在 `zip(..., strict=False)` 处失败，而该 spider 的 Dockerfile 使用 Python 3.11。完整 pytest 在当前本机缺少 `aiohttp`，因此尚不能把本地测试失败或通过解读为部署状态。

## 落地顺序与验证

1. **统一市场身份。** 建立 `venue + market_type + native_symbol` 级别的标识，保留 base/quote、链和合约地址。跨所同名 ticker 不自动视作同一资产。
2. **先补完整公开快照。** 从已有 Binance Futures 开始补交易规则、买一卖一、深度、历史资金费；随后接 Bybit、Kraken、OKX、Hyperliquid。每个官方操作单独记录请求、原始响应样本、采集器实现和实发消息状态。
3. **再接实时流。** 对候选交易对订阅 WebSocket 报价和深度；按交易所规定处理快照、序列号、断线和过期数据。避免对所有交易对高频轮询深度而触及限流。
4. **扩展 Taoli 的其余场所。** 按官方文档逐家核对相同数据组是否公开、是否需 API key、限流、历史范围和单位。支持列表只证明 Taoli 接入过该场所，不能替代官方接口契约。
5. **验证输出。** 至少保存一条真实上游响应、一条采集器转换结果和一条 Redpanda 实发记录，逐项核对身份、单位、时间、空值和来源。没有实发记录之前，状态保持“已设计”或“代码已实现”。

面向产品的第一个候选结果可以是“同一资产在两个场所的可比较永续合约及其资金费差异”，同时显示两边买卖盘、目标金额深度、结算时间、手续费与数据新鲜度。它只是**待检验的套利候选**；只有加入实际成交成本、资金调度和交易限制后，才能评估可执行性。
