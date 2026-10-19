import json
F = lambda n, t, l: {"name": n, "type": t, "label_zh": l}
TR = "trial/"  # evidence paths relative to /workspace/asset-page-research/
cards = []
def card(key, did, name, kind, trigger, desc, algo, fields, outputs, rules, tools, failures, evidence, data_access=None, profile="ordinary_process"):
    c = {"key": key, "draft_id": did, "name": name, "kind": kind, "profile": profile, "trigger_zh": trigger,
         "description_zh": desc, "algorithm_zh": algo, "fields": fields, "output_fields": outputs,
         "decision_rules_zh": rules, "sources_tools": tools, "failure_modes_zh": failures, "trial_evidence": evidence}
    if data_access: c["data_access"] = data_access
    cards.append(c)

card("scheduler", "DRAFT-3045-S0", "调度 · 每小时小批量取待办", "process", "schedule：每小时一次（cron 占位）；不由打开卡片、读取身份或回写触发。",
 "每小时从 FU 拉取 #3029 输出的待办清单，取 N 个交给 #3045；剩余滚到下一小时，平滑负载。",
 "调用 FU 待办接口（契约 C7，未实现）取 action∈{generate, refresh} 的条目；排序：先 generate（新上榜），再 refresh 按 age_minutes 降序，同级按 asset_id 稳定排序；取前 N（起步 N=2，占位）。每个 asset_id 加租约防并发；失败保留旧 page_ref、记录 error、按退避重排。N 与整页周期均为占位，由试运行每 token 耗时/调用量决定。",
 [F("asset_id","string","同一实体 UUID"), F("action","string","generate / refresh（来自 #3029）"), F("reason","string","来自 #3029"), F("age_minutes","number | null","网页年龄"), F("page_ref","TEXT | null","旧网页位置"),
  F("batch_size_n","integer","每小时处理数，占位起步 2"), F("lease_until","UTC timestamp","租约到期，占位"), F("attempt","integer","第几次尝试")],
 ["asset_id","action","reason","age_minutes","page_ref"],
 ["generate 永远排在 refresh 前", "refresh 按页面最老优先", "同一 asset_id 同时只允许一个任务", "失败不清空旧记录；超过重试上限（占位）转人工待核对", "跳过 / 待核对分支（#3029 终止分支）不进入队列"],
 [{"id":"fu.pending","label_zh":"FU 待办接口 GET /internal/asset-pages/pending?limit=N（C7）","binding":None}],
 ["FU 待办接口不可用 → 本小时空跑并记录", "免费源限流（CoinGecko 免费层、Solana RPC 方法级 5 次限额）→ 降低 N 或错峰", "单 token 超时 → 释放租约下一小时重试"],
 {"summary_zh":"试运行单 token generate ≈ 4 分钟墙钟、9 次免费 HTTP + 3 次搜索/抓取/X 工具；网络耗时仅 3–11 s，瓶颈在模型与限流，N=2/小时远低于单 worker 能力。","files":[TR+"README.md", TR+"timing.txt", TR+"requests.log"]})

card("identity", "DRAFT-3045-01", "身份核验", "decision", "event：调度交来一个 asset_id 时最先执行。",
 "确认 asset_id 对应的真实实体与外部稳定标识；不按 ticker 识别。",
 "读 FU asset_identifiers 得到 source_namespace / external_identifier；外部用 CoinGecko id 取 platforms（合约/mint），对原生链资产确认 platforms 为空；对代币用公共 RPC / 浏览器 API 对 mint 读取链上供应等可核对字段，与聚合器比对。多源一致 → confirmed；冲突或缺失 → unconfirmed / ambiguous，走身份未确认页而不制作研究页。",
 [F("asset_id","string","输入实体"), F("source_namespace","string","FU 身份命名空间"), F("external_identifier","string","FU 外部身份"), F("contract_addresses","object","链 → 地址"), F("identity_status","string","confirmed / unconfirmed / ambiguous"), F("identity_evidence_ids","string[]","支撑身份的证据")],
 ["asset_id","identity_status","contract_addresses","identity_evidence_ids"],
 ["ticker 只作显示，不作匹配键", "至少两个独立来源一致（聚合器 + 链上 / 第三方）才算 confirmed", "包装版本地址未核对的只列出不背书", "identity 非 confirmed 时终止研究页分支"],
 [{"id":"fu.asset_identifiers","label_zh":"FU 身份映射（未接入）","binding":None},{"id":"coingecko.coin","label_zh":"CoinGecko /coins/{id} 免费无 key"},{"id":"solana.rpc","label_zh":"Solana 公共 RPC getTokenSupply / getSupply"}],
 ["FU 映射缺失（本次试运行即如此：映射为假设）", "ticker 撞名", "链上 RPC 慢或限流（getSupply 7.9 s，方法级限额 5）", "浏览器网页是前端壳无法抓（Solscan）"],
 {"summary_zh":"BONK：CoinGecko platforms.solana 的 mint 经 RPC getTokenSupply 核对 87,994,323,898,030 ≈ CoinGecko 87,994,323,900,784，Blockworks 也写同一 mint；SOL：platforms 为空，确认为原生资产。两者 FU 映射均未核对（无数据访问）。","files":[TR+"bonk/raw/solana_rpc.supply.json", TR+"bonk/raw/cg.coin.json", TR+"sol/raw/cg.coin.json"]})

card("inventory", "DRAFT-3045-02", "盘点 FU 已有资料", "process", "event：身份 confirmed 后。",
 "按 asset_id 读取 FU 已有实体、榜单/热度、已收集资料与证据缓存；区分“字段定义”与“真的有数据”。",
 "调用 FU bundle 接口（契约 C1）与证据缓存（C6）；为每个 evidence 计算是否仍在有效期（foundational 看 verify_after，time_sensitive 一律视为过期）。输出“可复用清单 + 缺口清单”。",
 [F("asset_id","string",""), F("bundle","object","FU bundle 原文"), F("reusable_evidence_ids","string[]","未过期可复用证据"), F("gaps","string[]","按版块列出缺口")],
 ["asset_id","reusable_evidence_ids","gaps"],
 ["字段存在 ≠ 已采集", "time_sensitive 证据不复用", "foundational 证据在 verify_after 前复用，除非被事件触发重验（见冲突卡）"],
 [{"id":"fu.bundle","label_zh":"GET /internal/assets/{asset_id}/bundle（C1，未实现）","binding":None},{"id":"fu.evidence","label_zh":"asset_evidence 证据缓存（C6，未实现）","binding":None}],
 ["FU 接口未接入（试运行全部 FU 版块记为 omitted/unknown）", "bundle 不完整 → 待核对，不猜"],
 {"summary_zh":"试运行无 FU 数据访问：heat 版块 omitted，所有资料来自外部免费源；这正是该卡缺失时页面的真实样子。","files":[TR+"sol/page-script.v2.json", TR+"bonk/page-script.v2.json"]})

card("relevance", "DRAFT-3045-03", "判定该 token 什么重要", "decision", "event：盘点完成后。",
 "按 token 类型（主流 L1 / 长尾 meme / 数据稀少新币 / 身份存疑）决定版块与顺序，而不是固定模板。",
 "先用 CoinGecko categories / market_cap_rank / platforms 粗分类型；再结合初步新闻扫描，若出现安全事件、下架、协议级升级等“重大事件”，把 events/risks 提到 market 前面。每个版块写下‘为什么展示 / 为什么不展示’进入决策日志。",
 [F("token_type","string","major_l1 / long_tail_meme / sparse_new / unconfirmed"), F("section_plan","object[]","版块、顺序、理由"), F("major_event_flags","string[]","重大事件标记")],
 ["token_type","section_plan","major_event_flags"],
 ["主流 L1：market、链生态、events、tokenomics", "meme：身份/合约、安全事件、流动性深度（DEX 池）优先于行情", "无实质内容的来源（如只有互动回复的官方号）不做引语，写说明", "只有二手来源的版块（团队、收入）不单列，进 unknowns"],
 [{"id":"section-catalog","label_zh":"spec-v0.1/section-catalog.md"}],
 ["分类错误导致版块错位", "新闻扫描不足导致漏掉重大事件"],
 {"summary_zh":"SOL（rank #7, L1）版块顺序：overview → market → 链生态 → tokenomics → events；BONK（rank #156, Meme）发现 2026-07 BonkDAO 治理攻击 + Upbit 下架 → events、risks 放在 market 之前，narrative 只放说明。","files":[TR+"sol/decision-log.md", TR+"bonk/decision-log.md"]})

card("discovery", "DRAFT-3045-04", "来源发现", "process", "event：版块计划确定后。",
 "为每个缺口挑选来源：先一手（官网、官方升级页、链上），再结构化 API，再新闻/社交；给出调用预算。",
 "每个版块映射候选来源与预算（试运行：WebSearch/WebFetch/X ≤ 15 次全局预算，实际用 6）；搜索结果只作为线索，重要事实需 WebFetch 一手页或第二来源确认。",
 [F("source_plan","object[]","版块 → 来源 → 预算"), F("budget_calls","integer","工具调用上限")],
 ["source_plan","budget_calls"],
 ["一手 > 结构化 API > 二手报道 > AI 汇总", "AI 汇总页（CMC AI）只作线索并标低信任", "地区受限的端点自动换官方公共镜像（Binance → data-api.binance.vision）"],
 [{"id":"websearch","label_zh":"WebSearch"},{"id":"webfetch","label_zh":"WebFetch"},{"id":"x.read","label_zh":"X 读（search_posts_all）"}],
 ["搜索结果混入 AI 生成/聚合内容", "端点地区封锁（api.binance.com 返回 451）"],
 {"summary_zh":"WebSearch 2 次均给出近 7 天带发布时间的新闻；SOL 用 WebFetch 官方 Alpenglow 页一手确认日期，BONK 用 WebFetch Blockworks 汇编获取分配/治理/攻击时间线。","files":[TR+"requests.log"]})

card("fetch", "DRAFT-3045-05", "抓取与证据留存（基础 vs 时效）", "process", "event：来源计划确定后；refresh 时只对 time_sensitive 和到期/被触发的 foundational 执行。",
 "执行抓取并为每个来源写证据记录：url、retrieved_at、published_at、content_sha256、freshness、HTTP 状态、耗时、限流头。",
 "foundational（描述、链接、合约、供应、分配、团队）写入缓存带 verify_after；time_sensitive（行情、7 日图、TVL、DEX 池、新闻、社交）每次重抓不复用。同一响应同时含两类时（CoinGecko /coins/{id} 带 market_data）拆成两次请求或分别打标签。",
 [F("evidence_id","string","ev:<asset>:<source>:<date>"), F("url","string",""), F("retrieved_at","UTC timestamp","采集时间"), F("published_at","UTC timestamp | null","来源发布时间"), F("content_sha256","string",""), F("freshness","string","foundational / time_sensitive"), F("http_status","integer | null",""), F("verify_after","UTC timestamp | null","foundational 重验期，占位")],
 ["evidence_id","freshness","retrieved_at","published_at"],
 ["只记录真正取到的内容；失败也记录", "工具只返回文本时 hash 针对摘录并注明", "published_at 精度不足（只有日期/月份）时页面置 null，原值留在证据里"],
 [{"id":"coingecko","label_zh":"CoinGecko 免费无 key"},{"id":"defillama","label_zh":"DefiLlama"},{"id":"dexscreener","label_zh":"DEX Screener"},{"id":"binance.vision","label_zh":"Binance 公共镜像"},{"id":"solana.rpc","label_zh":"Solana 公共 RPC"}],
 ["451 地区限制", "前端壳页面无数据（Solscan）", "大 HTML（solana.com 935 KB）只能取 meta", "DEX Screener 最多返回 30 个池"],
 {"summary_zh":"18 次免费 HTTP（16 成功、2 次 451）+ 6 次工具调用，全部写入 raw/evidence.jsonl；SOL 基础 3 条 / 时效 11 条，BONK 基础 5 条 / 时效 8 条。","files":[TR+"sol/raw/evidence.jsonl", TR+"bonk/raw/evidence.jsonl", TR+"fetch.py"]})

card("reconcile", "DRAFT-3045-06", "冲突 / 过期 / 未知处理", "decision", "event：抓取完成后。",
 "交叉核对数值、标出冲突、判断基础资料是否被事件打成过期、把没取到的留为 unknown。",
 "数值类至少两源比对（价格、供应）；差异超阈值（占位）标冲突并并列展示，不擅自裁决；若 events 出现协议级变更/安全事件/上下架，对相关 foundational 证据强制重验；未取到或只有二手来源的写入 unknowns 与 coverage.partial/omitted 的 reason。",
 [F("conflicts","object[]","字段、各来源值、处理"), F("stale_flags","object[]","被事件判定过期的基础证据"), F("unknowns","object[]","topic + reason")],
 ["conflicts","stale_flags","unknowns"],
 ["不填补、不估算", "链上值优先于聚合器", "冲突并列展示并标“未裁决”", "事件可以让 foundational 提前过期"],
 [{"id":"solana.rpc","label_zh":"链上核对"},{"id":"llama.price","label_zh":"DefiLlama 价格交叉"},{"id":"binance.vision","label_zh":"CEX 价格交叉"}],
 ["阈值设置不当导致误报冲突", "二手数据当一手"],
 {"summary_zh":"价格三源差 <0.2%；供应链上与 CoinGecko 一致；BONK 最大供应冲突（CoinGecko 87,995,282,867,000 vs Blockworks 所引 88.87T）并列展示；SOL 的 CoinGecko 描述以 PoH 为核心、被 Alpenglow 打成即将过期，页面已标注。","files":[TR+"sol/decision-log.md", TR+"bonk/decision-log.md"]})

card("compose", "DRAFT-3045-07", "组装页面脚本", "process", "event：核对完成后。",
 "把证据组装成 page script v2：每个 block 带 section、source_refs、as_of；coverage 与 unknowns 完整。",
 "所有数值由程序从原始证据读出，不手填；版块顺序按 relevance 卡的 section_plan；写入 generated_at（真实制作时间）、data_as_of（最新采集时间）与 workflow_version。",
 [F("script","object","page script v2"), F("workflow_version","string","规范版本"), F("generated_at","UTC timestamp","页面制作时间"), F("data_as_of","UTC timestamp","数据采集时间")],
 ["script","workflow_version","generated_at","data_as_of"],
 ["每个结论可追溯到 source_id", "页面制作时间、数据采集时间、来源发布时间三者分开", "引语只用有实质内容的帖子"],
 [{"id":"schema","label_zh":"web/domain/token-page-script.ts v2 schema"}],
 ["schema 不合法块被前端跳过（试运行首版用了不存在的 tone=warn，被解析器跳过 1 块，已修正）", "文本超长"],
 {"summary_zh":"两页各 12 块；SOL 13 个来源、BONK 11 个来源；generated_at 首版写成了预估时间，复核时改为真实制作时间 2026-10-18T19:37:07Z。","files":[TR+"build_scripts.py", TR+"sol/page-script.v2.json", TR+"bonk/page-script.v2.json"]})

card("selfcheck", "DRAFT-3045-08", "自检", "decision", "event：组装完成后。",
 "用前端同一个 schema 解析器校验，并做内容自检（来源可达、无 example.com、无占位数字、unknowns 与 coverage 一致）。",
 "跑 parseTokenPageScript：skipped 必须为 0、issues 为空；检查所有 source.url 为 https 且来自本次证据；检查 headline 中数值与 stats 块一致；不通过则回到 compose，不保存。",
 [F("parse_ok","boolean",""), F("skipped","integer","被跳过的块数"), F("issues","string[]",""), F("check_report","object","内容自检结果")],
 ["parse_ok","skipped","issues"],
 ["skipped>0 视为失败", "自检失败不得进入保存", "人工审核标记（trial/unreviewed）不可省略"],
 [{"id":"vitest","label_zh":"web/tests/unit/trial-fixture.test.ts"}],
 ["只做结构校验漏掉事实错误（需要人工抽检）"],
 {"summary_zh":"自检真实抓出 1 个问题：callout tone=warn 不在枚举里导致每页跳过 1 块；修正后 36 个测试文件 / 252 个测试全部通过，渲染出 12/12 块。","files":["fu-local/web/tests/unit/trial-fixture.test.ts", TR+"screenshots/sol-desktop-full.png", TR+"screenshots/bonk-desktop-full.png"]})

card("save", "DRAFT-3045-09", "保存与回写 #1039", "process", "event：自检通过后。",
 "调用 FU 保存接口写入页面与证据；只有确认保存成功才以 saved_page_ref/saved_at 更新 #1039。",
 "PUT /internal/assets/{asset_id}/page（C3）+ 证据写入（C6）；返回确认后输出 status=success、saved_page_ref、saved_at、workflow_version；否则 status=failed/unconnected，保留旧记录。",
 [F("status","string","unconnected / success / failed"), F("saved_page_ref","TEXT | null",""), F("saved_at","UTC timestamp | null",""), F("workflow_version","string | null",""), F("error","string | null","")],
 ["asset_id","status","saved_page_ref","saved_at","workflow_version","error"],
 ["require_same_asset", "saved_page_ref 与 saved_at 非空才写", "拒绝过期完成（reject_stale_completion）"],
 [{"id":"fu.save","label_zh":"PUT /internal/assets/{asset_id}/page（C3，未实现）","binding":None}],
 ["保存接口未实现 → status=unconnected", "保存超时但实际写入 → 以再次读取确认为准"],
 {"summary_zh":"试运行没有真实保存：只写入本地 fixture（fu-local 本地提交，未 push），status 视为 unconnected。","files":[TR+"fixtures-trial.patch"]})

connections = [
 {"source":"刷新判断","target":"调度 · 每小时小批量取待办","fields":["asset_id","action","reason","age_minutes","page_ref"],"note_zh":"#3029 的首次制作/到期更新进入待办；经 FU 待办接口（C7）读取。","branch":"","branches":["first","due"]},
 {"source":"调度 · 每小时小批量取待办","target":"身份核验","fields":["asset_id","action","reason","age_minutes","page_ref"],"note_zh":"每小时取 N 个。","branch":""},
 {"source":"asset_identifiers","target":"身份核验","fields":["asset_id","source_namespace","external_identifier"],"note_zh":"读取外部身份映射。","branch":"","kind":"read"},
 {"source":"身份核验","target":"盘点 FU 已有资料","fields":["asset_id","contract_addresses","identity_evidence_ids"],"note_zh":"仅 confirmed 继续。","branch":"confirmed"},
 {"source":"身份核验","target":"组装页面脚本","fields":["asset_id","identity_status"],"note_zh":"unconfirmed/ambiguous 直接组装身份未确认页，不做研究。","branch":"unconfirmed"},
 {"source":"盘点 FU 已有资料","target":"判定该 token 什么重要","fields":["asset_id","reusable_evidence_ids","gaps"],"note_zh":"","branch":""},
 {"source":"判定该 token 什么重要","target":"来源发现","fields":["token_type","section_plan","major_event_flags"],"note_zh":"","branch":""},
 {"source":"来源发现","target":"抓取与证据留存（基础 vs 时效）","fields":["source_plan","budget_calls"],"note_zh":"","branch":""},
 {"source":"抓取与证据留存（基础 vs 时效）","target":"冲突 / 过期 / 未知处理","fields":["evidence_id","freshness","retrieved_at","published_at"],"note_zh":"","branch":""},
 {"source":"冲突 / 过期 / 未知处理","target":"抓取与证据留存（基础 vs 时效）","fields":["stale_flags"],"note_zh":"事件触发的基础重验回到抓取（最多一轮，占位）。","branch":"revalidate","kind":"control"},
 {"source":"冲突 / 过期 / 未知处理","target":"组装页面脚本","fields":["conflicts","unknowns"],"note_zh":"","branch":""},
 {"source":"组装页面脚本","target":"自检","fields":["script","workflow_version","generated_at","data_as_of"],"note_zh":"","branch":""},
 {"source":"自检","target":"组装页面脚本","fields":["issues"],"note_zh":"不通过退回重组。","branch":"fail","kind":"error"},
 {"source":"自检","target":"保存与回写 #1039","fields":["script","workflow_version"],"note_zh":"","branch":"pass"},
 {"source":"保存与回写 #1039","target":"asset_pages","fields":["asset_id","saved_page_ref","saved_at"],"mapping":{"saved_page_ref":"page_ref","saved_at":"updated_at"},"note_zh":"沿用 #3045 现有写回守卫。","kind":"write",
  "config":{"trigger":"none","completion":"success","role":"confirmed_asset_page_save","write_guard":{"status":"success","require_same_asset":True,"required_nonempty":["saved_page_ref","saved_at"],"reject_stale_completion":True}}}]

doc = {
 "version": "asset-research-cards.draft.v0",
 "status": "DRAFT — not installed, not approved; card ids are placeholders (DRAFT-3045-xx), numbers carry no SignalStudio meaning",
 "approval_date": None,
 "rationale_url": None,
 "delivery_scope": "studio_design_only",
 "format_reference": "SignalStudio@1da17af catalog/asset-grokbot-flow.v1.json (cards/fields/output_fields/connections/branches) + catalog/polars-indicator-module.v1.json (parent + sub-cards) + catalog/card-model.v1.json (kinds/profiles/triggers)",
 "parent": {"name": "Grokbot · 制作或更新资产网页", "key": "grokbot", "number": 3045,
            "description": "#3045 内部研究流程拆成编号子卡；子卡编号不代表独立程序，共享同一 asset_id 与同一次运行。调度卡位于 #3029 与 #3045 之间。",
            "algorithm": "调度 → 身份核验 → 盘点 FU → 判定重点 → 来源发现 → 抓取留证 → 冲突/过期/未知 → 组装 → 自检 → 保存回写。refresh 时盘点卡给出可复用 foundational 证据，抓取卡只重抓 time_sensitive 与到期/被事件触发的 foundational。"},
 "freshness_classes": [{"id":"foundational","label_zh":"基础（缓存复用，长周期重验，事件可触发提前重验）"},{"id":"time_sensitive","label_zh":"时效（每次刷新重抓）"}],
 "placeholders": {"batch_size_n": 2, "page_refresh_interval_seconds": None, "foundational_verify_after_days": None, "conflict_threshold_pct": None, "max_attempts": None},
 "cards": cards,
 "connections": connections,
 "branches": [{"id":"confirmed","label_zh":"身份已确认","terminal":False},{"id":"unconfirmed","label_zh":"身份未确认/有歧义","terminal":False},{"id":"revalidate","label_zh":"基础资料被事件触发重验","terminal":False},{"id":"pass","label_zh":"自检通过","terminal":False},{"id":"fail","label_zh":"自检不通过","terminal":False}],
 "trial_run": {"date_utc": "2026-10-18", "assets": ["SOL","BONK"], "label": "trial, unreviewed, identity mapping assumed", "root": "/workspace/asset-page-research/trial/"},
 "provenance_zh": "草案。卡片定义基于 2026-10-18 UTC 的真实免费源试运行（SOL、BONK），FU 读取/保存/待办接口均未接入；不是已批准的 SignalStudio 卡片，也未修改 SignalStudio 仓库。"
}
json.dump(doc, open("asset-research-cards.draft.v0.json","w"), ensure_ascii=False, indent=1)
print(len(cards), "cards", len(connections), "connections")
