# 资产页 Agent 流程 v0.1：按时效分层的数据获取、缓存与刷新

> 草案 / 提议。定位：**研究页**——资料同时来自 FU 内部和外部网站。核心规则：把数据按时效分成两类，用不同方式获取和刷新：
> - **(a) 时效资料**（新闻、近期事件、社交讨论、行情变动）：**每次刷新都重新抓**，每次结果都可能不同；
> - **(b) 基础资料**（是什么、链/合约、官方链接、代币经济、团队、基础指标）：**抓一次、带 `retrieved_at` 缓存、之后复用**，按长周期重新核实。
>
> 本文是对 `grokbot-prompt-skill-outline.md` 第 3 节流程的细化（以本文为准）。所有周期数值都是**占位值**，等用户确认。原型里的 MOCK 数据已按这个分类标注（见第 7 节）。

## 1. 两类数据的定义与版块映射

| 类别 | 版块（section-catalog） | 典型内容 | 刷新规则 | 跨刷新复用？ |
|---|---|---|---|---|
| **基础资料** `foundational` | `overview`、`identity`、`tokenomics`、`links`（团队信息归入 `overview`） | 项目是什么、所在链、合约地址、CoinGecko id、官网/文档/浏览器/社交链接、总供应/最大供应/分配/解锁计划、团队、上线日期等基础指标 | 首次生成时抓取 → 写入证据缓存 → 之后**直接复用**；到 `verify_after` 时**重新核实**（只校验是否变化，不重写页面除非变了） | **是** |
| **时效资料** `time_sensitive` | `market`、`heat`、`events`、`narrative` | 价格/成交/涨跌、榜单排名与热度、新闻、上所/升级/安全事件、X/社区讨论 | **每次刷新都重新获取**；上一次的结果不作为本次输入（只作审计留存和“变化对比”） | **否** |
| **派生** | `risks` | 风险提示 | 每次刷新**重新推导**，输入 = 本次的时效资料 + 缓存的基础资料 | 不缓存结论 |

规则：
1. 一个来源只属于一个类别。混合型页面（例如官网某页既有介绍又有新闻）按**被引用的事实**拆成两个证据记录。
2. 页面脚本 v2 的每个 `sources[]` 必须带 `freshness`（`foundational` / `time_sensitive`）和 `evidence_id`（原型 schema 已支持，可选字段；v0.1 的自检要求必填）。
3. 页面上：基础资料显示“基础资料 · 缓存复用”，它的 `retrieved_at` 可以早于本次 `generated_at` 很多天；时效资料显示“时效资料 · 每次刷新”，它的 `retrieved_at` 必须在本次运行窗口内。

## 2. 每个类别：内部 vs 外部来源

优先级：**FU 内部优先**；内部缺失才去外部；身份类事实**只信 FU 内部**。

| 子类 | 类别 | FU 内部来源（优先） | 外部来源（补充，需白名单 + 预算） | 外部能否覆盖内部 |
|---|---|---|---|---|
| 身份：链、合约、CoinGecko id、别名 | 基础 | `asset_core.assets` / `asset_identifiers` / `asset_relationships`、`market.coingecko_identity_decisions`（经 bundle `identity`） | —（不允许） | **否**；外部不一致 → 写入 unknowns 并提示身份复核 |
| 是什么 / 简介 | 基础 | FU 已采集的项目资料（如有） | 官网、官方文档、CoinGecko 描述 | 可补充，不覆盖 |
| 官方链接 | 基础 | asset_core 中登记的链接（如有，⚠ 当前未见字段） | 官网、CoinGecko links；核实规则：链接需与身份中的合约/域名互相印证 | 可补充；未核实不渲染 |
| 代币经济（供应、分配、解锁） | 基础 | ⚠ FU 当前无数据源 | 官方文档 / tokenomics 页面、CoinGecko 供应字段 | 可补充（v1 默认关闭，待用户确认） |
| 团队 | 基础 | ⚠ 无 | 官网 team 页、官方公告 | 可补充（v1 默认关闭） |
| 基础指标（上线日期、总/最大供应） | 基础 | coingecko_market_v1 中的静态字段（⚠ 待确认） | CoinGecko | 可补充 |
| 行情（价格、成交、涨跌、7 日走势） | 时效 | coingecko_market_v1 / Delta Lake 历史（⚠ 现按 symbol 查询） | CoinGecko API（需 key） | 内部缺失或过旧时补充，注明 `as_of` |
| 榜单与热度 | 时效 | `app_hottest_board`（#1009）、`app_warming_board`（#1008） | — | 否（这是 FU 自有信号） |
| 新闻 / 近期事件 | 时效 | `content.items`（⚠ 无 asset_id，只有 tokens jsonb） | 官方公告、可信新闻站 | 可补充 |
| 社交讨论 | 时效 | FU 的信号流 / 已采集社交内容（如有） | X（只读）等 | 可补充 |

## 3. 证据缓存（raw evidence cache）

**缓存的是原始证据，不是页面文字。**页面每次都由 Grokbot 根据“缓存的基础证据 + 新抓的时效证据”重新组织；这样基础证据可复用，同时页面措辞仍能根据最新情况调整。

### 3.1 证据记录（提议表 `asset_pages.asset_evidence`，由后端实现）

| 字段 | 说明 |
|---|---|
| `evidence_id` | 主键，例如 `ev:<asset>:<source_id>:<date>` 或 UUID；页面 `sources[].evidence_id` 引用它 |
| `asset_id` | canonical UUID |
| `freshness` | `foundational` / `time_sensitive` |
| `topic` | 子类：`identity` / `description` / `links` / `tokenomics` / `team` / `basic_metrics` / `market` / `heat` / `news` / `social` |
| `origin` | `fu_internal` / `external` |
| `source_kind` | 同 schema v2 `kind` |
| `locator` | URL 或 FU 内部定位（表名 + 主键 / 快照 id） |
| `retrieved_at` | 采集时间 |
| `published_at` | 来源原始发布时间（可空） |
| `content_sha256` | 原文 / 结构化数据的哈希，用于核实时判断是否变化 |
| `payload` | 结构化提取结果 + 必要原文摘录（不存整页 HTML；注意版权与体积，建议 ≤ 32KB） |
| `verify_after` | 仅基础资料：`retrieved_at + 核实周期` |
| `status` | `valid` / `stale`（已过 verify_after）/ `superseded`（被新证据替代）/ `failed`（核实失败，来源不可达） |
| `superseded_by` | 新证据 id |

### 3.2 写入与复用规则

1. **谁写**：Grokbot 不直接写库。它在交付物里附上本次新抓或核实过的证据记录；**保存接口（C3）在保存页面的同一事务里写入证据**。保存失败 → 证据不入库，旧证据保持不变（与 #1039 的“失败不动旧记录”一致）。
2. **基础资料复用**：refresh 时 bundle 返回该资产 `status=valid` 的基础证据；Grokbot 直接使用，**不重新抓**，页面 `sources[].retrieved_at` 保持旧时间。
3. **基础资料核实**（到 `verify_after` 或 #3029 给出相关 reason 时）：重新抓同一 locator → 比较 `content_sha256`：
   - 没变 → 新记录 `retrieved_at=now`，旧记录 `superseded`（或只刷新 `retrieved_at` 与 `verify_after`，二选一由后端定）；
   - 变了 → 新记录替代旧记录，对应版块在本次重做，并在运行报告里记“基础资料变更”；
   - 不可达 → 旧记录标 `failed` 但**继续使用**，页面版块降为 `partial` 并写原因（“官方链接最近一次核实失败”）。
4. **时效资料**：每次刷新新建证据；旧的时效证据只用于审计和“与上次相比”的变化说明（例如“排名从 #9 升到 #6”），**不得当作本次事实引用**。保留期建议 30 天（占位）。
5. **身份变化让缓存失效**：`asset_core` 标识变化（合并、拆分、合约迁移）→ 该资产所有基础证据标 `stale`，下一次运行按首次生成处理。

### 3.3 周期（占位值，待用户确认）

| 子类 | 核实周期（`verify_after`） | 说明 |
|---|---|---|
| identity | 每次运行都从 FU 读（它是内部真值，开销低） | 不走外部核实 |
| description / team | 90 天 | |
| links | 30 天 | 链接失效风险较高 |
| tokenomics / basic_metrics | 30 天；有解锁计划的资产在解锁日前后强制核实 | |
| market / heat / news / social | 不缓存（每次刷新） | 全页刷新周期本身仍**未定**（不替用户选 1 天或 3 天） |

## 4. 运行流程（替代 outline 第 3 节的 8 步，增加“分层”）

| 步 | generate（首次，无 page_ref） | refresh（已有 page_ref） |
|---|---|---|
| 1 身份闸门 | 读 bundle.identity；非 confirmed → `identity_blocked` | 同左；另检查身份标识自上次后是否变化，变了 → 走 generate 路径 |
| 2 资料盘点 | 基础证据为空；时效资料来自 bundle | 基础证据 = bundle 返回的 `valid` 缓存；时效资料来自 bundle（最新） |
| 3 缺口识别 | 按版块目录列出所有缺口（基础 + 时效） | 只列：①时效版块（总要重做）；② `verify_after` 已过的基础证据；③ #3029 `reason` 点名的版块；④ 上次标 `failed` 的基础证据 |
| 4 获取 | 基础：内部优先，外部补充（预算内），写证据；时效：同左 | **只抓时效资料 + 待核实的基础资料**；其余基础资料不发起任何外部请求 |
| 5 冲突处理 | 身份只信内部；行情以较新的 `as_of` 为准 | 同左；另外：基础资料核实结果与缓存不同 → 以新核实结果为准并记录变更 |
| 6 组织制作 | 全部版块重新写 | 时效版块重写；基础版块用缓存证据重新组织（措辞可调，但事实与来源不变）；`risks` 重新推导 |
| 7 自检 | outline §4 + 新增：每个 source 有 `freshness`/`evidence_id`；时效 source 的 `retrieved_at` 在本次运行窗口内；基础 source 的 `verify_after` 未过（或本次已核实） | 同左 |
| 8 交付 | 脚本 + 运行报告 + 新证据记录 | 脚本 + 运行报告（含“复用了哪些基础证据 / 核实了哪些 / 新抓了哪些时效证据”）+ 新证据记录 |

预期效果：refresh 的外部调用数 ≈ 时效资料数 + 到期核实数，**远少于首次生成**；基础版块不会因每次刷新出现无谓的措辞或事实漂移。

## 5. 对接口契约的影响（补充到 fu-asset-bundle-contract.md）

- **C1 bundle 新增分区 `evidence`**：`{ foundational: [证据记录…（status ∈ valid|stale|failed）], last_time_sensitive: [上次运行的时效证据摘要，只供变化对比] }`。
- **C2/C3**：新增表 `asset_evidence`（见 3.1）；`PUT …/page` 请求体增加 `evidence: [新证据记录…]`，与页面同事务写入。
- **C4 投影**：不需要证据全文；页面脚本里的 `sources[]` 已带 `freshness`/`retrieved_at`/`evidence_id`，前端足够展示。

## 6. 版本对比时怎么用这个分层

- 新旧 workflow 版本对比时，**基础资料用同一批缓存证据**作输入（控制变量），只比较组织与表达质量；时效资料用同一时刻抓的快照，避免因时间不同产生差异。
- 成本指标分开统计：首次生成成本 vs 单次刷新成本。

## 7. 原型与试跑中的体现

- schema（原型补丁）：`sources[].freshness`、`sources[].evidence_id`（`web/domain/token-page-script.ts`）；资料来源列表显示“基础资料 · 缓存复用 / 时效资料 · 每次刷新”标签。
- MOCK fixture：SOL / BONK 的 `fu.asset_core`、`official.site` 标为基础资料，`retrieved_at = 2026-09-20`（表示首次生成时抓取、本次复用）；榜单、行情、资讯、社交标为时效资料，`retrieved_at` 在本次 2026-10-13 运行内。
- 试跑分类表与 generate/refresh 决策日志见 [trial-plan-v0.1.md](trial-plan-v0.1.md)。

## 8. 待用户确认

1. 各子类核实周期（3.3 表全部是占位）。
2. v1 是否开放外部补齐基础资料（tokenomics、team、links）——开放会增加首次生成成本，但刷新成本不变。
3. 时效证据保留期（建议 30 天）以及是否要在页面显示“与上次相比”的变化说明。
4. 证据 `payload` 允许保存多少原文摘录（版权 / 存储）。

## 9. 调度 / 队列（用户提议，v0.1 草案）

**做法**：每小时跑一次（cron 式），不做每日集中爆发。

1. 每次运行先向 FU 拉取待办清单（#3029 的输出：`asset_id, action, reason, age_minutes, page_ref`）。
2. 排序：
   - 第一优先：新上榜资产（`action = generate`，无 page_ref）；
   - 第二优先：`action = refresh`，按页面年龄 `age_minutes` 从老到新；
   - 同优先级内用 asset_id 做稳定排序，保证可复现。
3. 每次只处理 **N 个**（起步 N = 2/小时 ≈ 48/天上限；保守估计 20+/天有效产出，扣除失败/重试）。
4. 没处理完的自动滚到下一小时；同一 asset 不并发（以 asset_id 加租约/锁，租约超时 = 占位）。
5. 失败（来源不可用、自检不过、保存未确认）：保留旧 page_ref 不动，记录失败原因，下一轮重排（退避次数上限 = 占位）。
6. **N 与过期间隔（refresh 周期）都保持占位**，由试跑的每 token 耗时/调用量来定。

**真实试跑给出的测量值（2026-10-18，SOL + BONK，首次 generate）**：

| 指标 | SOL | BONK | 说明 |
|---|---|---|---|
| 免费 HTTP 请求 | 9（1 次 451） | 9（1 次 451，1 次无效 HTML） | CoinGecko/DefiLlama/DEX Screener/Binance 镜像/Solana RPC/官网 |
| 网络耗时合计 | ≈ 11.0 s（RPC getSupply 单次 7.9 s） | ≈ 3.4 s | 网络不是瓶颈 |
| 搜索/抓取/X 工具调用 | 3 | 3 | WebSearch 1 + WebFetch 1 + X 1 |
| 墙钟（含模型阅读、判断、组稿） | 两个 token 合计 ≈ 8.4 分钟，单个 ≈ 4 分钟 | | 主要时间花在模型上 |
| 预计 refresh（复用 foundational） | ~5 HTTP + 2–3 工具 | ~4 HTTP + 2 工具 | 约少 40% 调用 |

→ 推论（假设，待更多样本）：单 token generate ≈ 4–5 分钟、refresh 估计 2–3 分钟；N = 2/小时远在单 worker 能力之内，瓶颈会是**免费源限流**（CoinGecko 免费层约每分钟数十次、Solana 公共 RPC 部分方法每 10 秒 5 次）与**模型成本**，而不是时间。可以先用 N = 2 跑一周，按失败率与成本再调。

**另外需要的事件触发规则（试跑发现）**：当 events 版块出现“协议级变更 / 安全事件 / 上下架”时，即使 foundational 未到重验期，也要对相关 foundational 证据强制重验（SOL：Alpenglow 让 CoinGecko 里的 PoH 描述过时；BONK：治理攻击改变了“治理/金库”的基础事实）。

**这个例行任务需要 FU 提供两个接口**（加入 fu-asset-bundle-contract.md 的待建清单）：
- `GET /internal/asset-pages/pending?limit=N`（契约 C7）：返回 #3029 的待办清单（含 action、reason、age_minutes、page_ref），只读；
- `PUT /internal/assets/{asset_id}/page`（保存接口，即契约 C3）：写入页面 + evidence，只有返回“已确认保存”后才更新 #1039 的 `page_ref / updated_at`；失败保留旧记录。
