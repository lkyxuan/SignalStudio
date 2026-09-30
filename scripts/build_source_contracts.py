"""Build SignalStudio's upstream-first source contract without reading Few Understand V2.

Saved API/MCP samples supply observed paths. Official documentation supplies the
reference and any deliberately planned fields. Sample paths are never promoted
to a complete output schema.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
BINANCE_MARKET_DATA_DOC = "https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data"

SOURCES = [
    ("binance-futures", "Binance U 本位合约", "official_api",
     "https://developers.binance.com/en/docs/catalog"),
    ("coingecko", "CoinGecko 市场数据", "official_api",
     "https://docs.coingecko.com/reference/coins-markets"),
    ("dexscreener", "DEX Screener 交易对", "official_api",
     "https://docs.dexscreener.com/api/reference"),
    ("kaito", "Kaito 社交数据", "official_mcp",
     "https://github.com/MetaSearch-IO/kaito-mcp-server"),
    ("rss", "RSS 新闻", "official_format",
     "https://www.rssboard.org/rss-specification"),
    ("taoli", "Taoli 资金费率页面", "first_party_page_no_schema",
     "https://taoli.tools/"),
    ("telegram-bot", "Telegram Bot 消息", "official_api",
     "https://core.telegram.org/bots/api#message"),
    ("telegram-telethon", "Telegram Telethon 消息", "official_library",
     "https://docs.telethon.dev/en/stable/quick-references/objects-reference.html#message"),
]

BINANCE = [
    ("globalLongShortAccountRatio", "/futures/data/globalLongShortAccountRatio",
     "binance-futures.global_long_short_account_ratio"),
    ("klines", "/fapi/v1/klines", "binance-futures.kline"),
    ("openInterest", "/fapi/v1/openInterest", "binance-futures.open_interest"),
    ("openInterestHist", "/futures/data/openInterestHist", "binance-futures.open_interest_hist"),
    ("premiumIndex", "/fapi/v1/premiumIndex", "binance-futures.premium_index"),
    ("takerlongshortRatio", "/futures/data/takerlongshortRatio",
     "binance-futures.taker_long_short_ratio"),
    ("topLongShortAccountRatio", "/futures/data/topLongShortAccountRatio",
     "binance-futures.top_long_short_account_ratio"),
    ("topLongShortPositionRatio", "/futures/data/topLongShortPositionRatio",
     "binance-futures.top_long_short_position_ratio"),
]
BINANCE_NAMES = {
    "globalLongShortAccountRatio": "全市场账户多空比",
    "klines": "K 线行情", "openInterest": "当前未平仓量",
    "openInterestHist": "未平仓量历史", "premiumIndex": "标记价格与资金费率",
    "takerlongshortRatio": "主动买卖量比",
    "topLongShortAccountRatio": "头部账户多空比",
    "topLongShortPositionRatio": "头部持仓多空比",
}
KAITO_NAMES = {
    "kaito_entities": "对象资料", "kaito_narratives": "叙事资料",
    "kaito_feeds": "社交动态", "kaito_search": "内容搜索",
    "kaito_advanced_search": "高级内容搜索",
    "kaito_twitter_user_metadata": "X 用户资料",
    "kaito_ict_impressions": "高影响力账号曝光量",
    "kaito_sentiment_entity": "对象情绪走势",
    "kaito_engagement": "对象互动量走势",
    "kaito_mentions": "对象提及量走势",
    "kaito_mindshare_entity": "对象关注份额走势",
    "kaito_mindshare_entity_by_account": "对象账户关注份额",
    "kaito_events": "候选事件", "kaito_mindshare_entity_arena": "对象关注份额排名",
    "kaito_mindshare_entity_delta": "对象关注份额变化",
    "kaito_smart_following_market": "高关注度账号关注市场",
    "kaito_smart_followers": "高关注度粉丝",
    "kaito_smart_following": "高关注度账号关注对象",
    "kaito_mindshare_narrative": "叙事关注份额走势",
    "kaito_market_sentiment": "市场情绪",
    "kaito_tweet_engagement_info": "推文互动信息",
}

KLINE_LABELS = (
    "开盘时间", "开盘价", "最高价", "最低价", "收盘价", "成交量", "收盘时间",
    "计价资产成交量", "成交笔数", "主动买入基础资产量", "主动买入计价资产量", "忽略位",
)

FIELD_LABELS = {
    "symbol": "交易对", "openInterest": "未平仓量", "time": "响应时间",
    "markPrice": "标记价格", "indexPrice": "指数价格", "estimatedSettlePrice": "预估结算价",
    "lastFundingRate": "最近资金费率", "interestRate": "利率", "nextFundingTime": "下次资金费率时间",
    "sumOpenInterest": "未平仓合约总量", "sumOpenInterestValue": "未平仓合约价值",
    "CMCCirculatingSupply": "流通供应量", "timestamp": "统计时间",
    "longAccount": "多头账户比例", "shortAccount": "空头账户比例",
    "longShortRatio": "多空比", "buySellRatio": "主动买卖比",
    "buyVol": "主动买入量", "sellVol": "主动卖出量",
    "id": "币种 ID", "name": "名称", "current_price": "当前价格",
    "market_cap": "市值", "market_cap_rank": "市值排名", "total_volume": "成交额",
    "last_updated": "上游更新时间", "pairAddress": "交易对地址", "chainId": "链 ID",
    "dexId": "交易平台", "priceUsd": "美元价格", "priceNative": "原生计价价格",
    "fdv": "完全稀释估值", "marketCap": "市值", "pairCreatedAt": "交易对创建时间",
    "image": "图标链接", "fully_diluted_valuation": "完全稀释估值",
    "high_24h": "24 小时最高价", "low_24h": "24 小时最低价",
    "price_change_24h": "24 小时价格变化",
    "price_change_percentage_24h": "24 小时涨跌幅",
    "market_cap_change_24h": "24 小时市值变化",
    "market_cap_change_percentage_24h": "24 小时市值涨跌幅",
    "circulating_supply": "流通供应量", "total_supply": "总供应量",
    "max_supply": "最大供应量", "ath": "历史最高价",
    "ath_change_percentage": "距历史最高价涨跌幅", "ath_date": "历史最高价日期",
    "atl": "历史最低价", "atl_change_percentage": "距历史最低价涨跌幅",
    "atl_date": "历史最低价日期", "roi": "投资回报信息",
    "url": "原文链接", "labels": "交易对标签",
    "baseToken.address": "基础代币地址", "baseToken.name": "基础代币名称",
    "baseToken.symbol": "基础代币代码", "quoteToken.address": "报价代币地址",
    "quoteToken.name": "报价代币名称", "quoteToken.symbol": "报价代币代码",
    "liquidity.usd": "美元流动性", "liquidity.base": "基础代币流动性",
    "liquidity.quote": "报价代币流动性",
    "title": "标题", "link": "条目链接", "pubDate": "发布时间",
    "description": "摘要", "guid": "条目标识", "category": "分类",
    "source": "原始来源", "message_id": "消息标识", "date": "消息时间",
    "chat.id": "聊天 ID", "chat.title": "聊天名称", "chat.username": "聊天用户名",
    "from.id": "发送者 ID", "from.username": "发送者用户名",
    "text": "文本内容", "caption": "媒体说明", "photo": "图片",
    "video": "视频", "document": "文件", "peer_id": "会话对象 ID",
    "from_id": "发送者对象 ID", "message": "消息正文", "media": "媒体对象",
    "fwd_from": "转发来源", "views": "浏览量", "forwards": "转发次数",
    "replies": "回复信息",
}

COINGECKO_OPTIONAL = {
    "sparkline_in_7d.price": "sparkline=true 时的七日价格序列",
    **{f"price_change_percentage_{window}_in_currency":
       f"price_change_percentage 包含 {window} 时的涨跌幅"
       for window in ("1h", "24h", "7d", "14d", "30d", "200d", "1y")},
}

RSS_PLANNED = ("title", "link", "pubDate", "description", "guid", "category", "source")
BOT_PLANNED = ("message_id", "date", "chat.id", "chat.title", "chat.username",
               "from.id", "from.username", "text", "caption", "photo", "video", "document")
TELETHON_PLANNED = ("id", "date", "peer_id", "from_id", "message", "media",
                    "fwd_from", "views", "forwards", "replies")
TAOLI_PAGE_COLUMNS = (
    ("exchange", "交易所"), ("market", "币种交易对"),
    ("open_interest_display", "未平仓额"), ("daily_volume_display", "日成交额"),
    ("funding_rate_1y_display", "页面 1Y 资金费率"),
    ("next_funding_display", "下次资金费率及倒计时"),
    ("funding_rate_limits_display", "费率上限与下限"),
    ("funding_interval_display", "资金费率间隔"),
)


def read(name):
    return json.loads((CATALOG / name).read_text(encoding="utf-8"))


def flatten(value, prefix=""):
    if isinstance(value, dict):
        return [pair for key, child in value.items()
                for pair in flatten(child, f"{prefix}.{key}" if prefix else key)]
    return [(prefix, value)]


def value_type(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, list):
        return "array"
    return "string"


def field(path, value=None, *, evidence="api_sample", note="", label=""):
    leaf = path.rsplit(".", 1)[-1]
    parts = path.split(".")
    if parts[0] in ("txns", "volume", "priceChange") and len(parts) >= 2:
        window = {"m5": "5 分钟", "h1": "1 小时", "h6": "6 小时", "h24": "24 小时"}.get(parts[1], parts[1])
        label = label or (f'{window}{"买入" if parts[-1] == "buys" else "卖出"}笔数'
                          if parts[0] == "txns" else
                          f'{window}{"成交额" if parts[0] == "volume" else "价格变化"}')
    if path.startswith("price_change_percentage_") and not label:
        label = f'{path.removeprefix("price_change_percentage_").removesuffix("_in_currency")} 涨跌幅'
    if path == "sparkline_in_7d.price":
        label = "7 日价格序列"
    return {"path": path, "label_zh": label or FIELD_LABELS.get(path)
            or FIELD_LABELS.get(leaf) or path,
            "type": value_type(value) if evidence != "official_documentation" else "unknown",
            "evidence": evidence, "condition": note,
            "example_value": value if evidence.endswith("sample") else None}


def operation(source, ident, label, endpoint, doc, fields, coverage, *, alias=None,
              sample_url=None, note=""):
    return {"id": ident, "source_id": source, "label_zh": label, "endpoint": endpoint,
            "documentation_url": doc, "response_coverage": coverage,
            "raw_response_policy": "preserve_complete_response",
            "sample_url": sample_url,
            "note_zh": note, "fields": fields}


def build():
    source_rows = [{"id": ident, "label_zh": label, "authority_kind": kind,
                    "authority_url": url, "schema_status":
                    "unavailable" if kind == "first_party_page_no_schema" else "source_reference"}
                   for ident, label, kind, url in SOURCES]
    docs = {row["id"]: row["authority_url"] for row in source_rows}
    operations = []

    binance = read("binance-upstream-samples.json")
    operations.append(operation("binance-futures", "binance.usdm.exchangeInfo",
                                "发现可交易合约", "/fapi/v1/exchangeInfo",
                                BINANCE_MARKET_DATA_DOC, [], "not_inventoried",
                                note="这是交易对发现接口；尚未把大对象响应定义为指标字段。"))
    for name, endpoint, alias in BINANCE:
        sample = binance["samples"][name]
        value = sample["response"]
        pairs = [(f"[{index}]", item) for index, item in enumerate(value)] if isinstance(value, list) else flatten(value)
        fields = [field(path, item, label=KLINE_LABELS[index] if name == "klines" else "")
                  for index, (path, item) in enumerate(pairs)]
        operations.append(operation("binance-futures", f"binance.usdm.{name}", BINANCE_NAMES[name],
                                    endpoint, BINANCE_MARKET_DATA_DOC, fields,
                                    "api_sample_lower_bound", alias=alias,
                                    sample_url=sample["url"],
                                    note="字段来自该官方 API 的一次响应；官方文档和不同参数仍需逐项复核。"))

    coingecko = next(item for item in read("catalog-example-evidence.json")["samples"]
                     if "coingecko.com" in item["url"])
    cg_fields = [field(path, value) for path, value in coingecko["response"].items()]
    for path, condition in COINGECKO_OPTIONAL.items():
        if path not in coingecko["response"]:
            cg_fields.append(field(path, evidence="official_documentation", note=condition))
    operations.append(operation("coingecko", "coingecko.coins_markets", "市场数据列表",
                                "/api/v3/coins/markets", docs["coingecko"], cg_fields,
                                "api_sample_plus_documented_optionals",
                                alias="coingecko.market_snapshot", sample_url=coingecko["url"],
                                note="本次请求未开启 sparkline 或额外涨跌幅窗口；可选字段按官方文档条件标注。"))

    dex = read("dexscreener-documented-api-sample.json")
    operations.append(operation("dexscreener", "dexscreener.token_pairs_by_address",
                                "按链和代币地址查询交易对", "/token-pairs/v1/{chainId}/{tokenAddress}",
                                docs["dexscreener"], [field(path, value) for path, value in flatten(dex["pair"])],
                                "api_sample_lower_bound", alias="dexscreener.market_snapshot",
                                sample_url=dex["url"],
                                note="这是本产品规划使用的公开文档接口；Few Understand 当前使用的旧路径和 WebSocket 应改造或单独证明。"))

    kaito = read("kaito-mcp-observed.json")
    for tool in kaito["tools"]:
        fields = [{"path": item["path"], "label_zh": item["label_zh"],
                   "type": item["type"], "evidence": "mcp_sample",
                   "condition": "", "example_value": item["example_value"],
                   "purpose_zh": item.get("purpose_zh", ""),
                   "use_case_zh": item.get("use_case_zh", "")}
                  for item in tool["fields"]]
        operations.append(operation("kaito", f'kaito.mcp.{tool["name"]}', KAITO_NAMES[tool["name"]],
                                    f'mcp://{tool["name"]}', docs["kaito"], fields,
                                    "mcp_sample_lower_bound" if fields else "no_output_sample",
                                    alias=tool["entity_id"],
                                    note="官方 MCP tools/list 未声明 outputSchema；保留完整原始响应，样本字段不是全集。"))

    resources = [
        {"id": "kaito.resource.tokens", "source_id": "kaito", "label_zh": "支持的代币目录",
         "uri": "kaito://tokens", "documentation_url": docs["kaito"],
         "purpose_zh": "查看 Kaito 支持的代币值、交易符号和项目名称，供后续查询前核对对象身份。",
         "note_zh": "MCP 参考资源；公开说明标注无需认证。尚未取得资源读取样本，不能确定实际返回字段。",
         "response_coverage": "no_output_sample", "fields": []},
        {"id": "kaito.resource.narratives", "source_id": "kaito", "label_zh": "支持的叙事目录",
         "uri": "kaito://narratives", "documentation_url": docs["kaito"],
         "purpose_zh": "查看 Kaito 支持的叙事标识，供查询叙事关注份额前核对主题。",
         "note_zh": "MCP 参考资源；公开说明标注无需认证。尚未取得资源读取样本，不能确定实际返回字段。",
         "response_coverage": "no_output_sample", "fields": []},
    ]

    operations.append(operation("rss", "rss.item", "RSS 新闻条目", "RSS 2.0 item",
                                docs["rss"], [field(path, evidence="official_documentation")
                                              for path in RSS_PLANNED], "documented_planned_selection",
                                alias="crypto-rss-collector.rss_news_item",
                                note="这是计划读取的 RSS item 元素；各 feed 还可能含扩展命名空间。"))
    operations.append(operation("taoli", "taoli.funding_page", "页面资金费率表",
                                "https://taoli.tools/", docs["taoli"],
                                [{"path": path, "label_zh": label, "type": "string",
                                  "evidence": "live_page_observation", "condition": "页面当时渲染的显示值；非 API 字段契约。",
                                  "example_value": None} for path, label in TAOLI_PAGE_COLUMNS],
                                "page_observation_lower_bound", alias="taoli.funding_rate",
                                note="2026-09-28 浏览器页面显示了这些列；尚无官方字段 API 文档，网页列名与位置可能变化。"))
    operations.append(operation("telegram-bot", "telegram.bot.message", "Bot 消息",
                                "Message", docs["telegram-bot"],
                                [field(path, evidence="official_documentation") for path in BOT_PLANNED],
                                "documented_planned_selection", alias="tg-spider.telegram_message",
                                note="这些是本产品计划读取的官方 Message 属性；Bot API 还有其他可选属性。"))
    operations.append(operation("telegram-telethon", "telegram.telethon.message", "Telethon 消息",
                                "Message", docs["telegram-telethon"],
                                [field(path, evidence="official_documentation") for path in TELETHON_PLANNED],
                                "documented_planned_selection",
                                alias="tg-spider-telethon.telegram_message",
                                note="这些是本产品计划读取的 Telethon Message 属性；不是对象完整属性列表。"))

    input_contract = read("source-inputs.v1.json")
    if input_contract.get("version") != "source-inputs.v1":
        raise ValueError("Unsupported source input contract")
    kaito_schemas = read("kaito-mcp-input-schemas.json")
    if input_contract.get("kaito_input_schema_observed_at") != kaito_schemas["observed_at"]:
        raise ValueError("Kaito input contract and live schema snapshot have different dates")
    if {tool["name"] for tool in kaito_schemas["tools"]} != {tool["name"] for tool in kaito["tools"]}:
        raise ValueError("Kaito input schemas must cover every observed tool")
    for tool in kaito_schemas["tools"]:
        item = input_contract["operations"][f'kaito.mcp.{tool["name"]}']
        schema = tool["inputSchema"]
        if item["input_coverage"] != "live_mcp_input_schema" or [
            (field["name"], field["required"]) for field in item["inputs"]
        ] != [(name, name in schema.get("required", [])) for name in schema["properties"]]:
            raise ValueError(f'Kaito input contract differs from live schema: {tool["name"]}')
    if set(input_contract["operations"]) != {item["id"] for item in operations}:
        raise ValueError("Input contract must cover every operation")
    if set(input_contract["resources"]) != {item["id"] for item in resources}:
        raise ValueError("Input contract must cover every resource")
    for item, group in [(item, "operations") for item in operations] + [(item, "resources") for item in resources]:
        item.update(input_contract[group][item["id"]])

    for kaito_example in read("kaito-mcp-call-examples.json")["examples"]:
        example_operation = next(item for item in operations
                                 if item["id"] == f'kaito.mcp.{kaito_example["tool"]}')
        input_names = {field["name"] for field in example_operation["inputs"]}
        if (kaito_example["evidence"] != "live_mcp_call"
                or not set(kaito_example["request"]) <= input_names
                or "response" not in kaito_example
                or not kaito_example.get("observed_at")):
            raise ValueError("Kaito call example must match the operation contract")
        example_operation.setdefault("call_examples", []).append(kaito_example)

    for observed_example in read("public-call-examples.json")["examples"]:
        example_operation = next(item for item in operations
                                 if item["id"] == observed_example["operation_id"])
        input_names = {field["name"] for field in example_operation["inputs"]}
        if (observed_example["evidence"] not in ("live_http_call", "live_page_observation")
                or not set(observed_example["request"]) <= input_names):
            raise ValueError("Public call example must match the operation input contract")
        example_operation.setdefault("call_examples", []).append(observed_example)

    missing_call_reasons = {
        "telegram.bot.message": "还没有该项目 Bot 的访问凭据及可读取的真实更新，因此不能展示 Bot API 的请求与 Message 返回。",
        "telegram.telethon.message": "还没有该项目获授权的 Telethon 会话与频道，因此不能展示真实消息读取。",
    }
    for item in operations:
        if item["id"] in missing_call_reasons:
            item["call_status_note_zh"] = missing_call_reasons[item["id"]]
    for item in resources:
        item["call_status_note_zh"] = "已尝试通过当前 Kaito MCP 端点读取此资源；服务端返回 -32601（不支持该方法），暂时没有可展示的真实资源内容。"

    collection_plans = read("source-collection-plans.v1.json")
    if collection_plans.get("version") != "source-collection-plans.v1" or not isinstance(collection_plans.get("plans"), dict):
        raise ValueError("Invalid source collection plan catalog")
    plans = collection_plans["plans"]
    unknown = set(plans) - {item["id"] for item in operations}
    if unknown:
        raise ValueError(f"Collection plan has unknown operations: {sorted(unknown)}")
    for item in operations:
        plan = plans.get(item["id"])
        if plan is None:
            continue
        if not isinstance(plan, dict) or set(plan) != {"mode", "interval_minutes"}:
            raise ValueError(f"Invalid collection plan for {item['id']}")
        mode, interval = plan["mode"], plan["interval_minutes"]
        if mode not in {"scheduled", "event_driven", "on_demand"} or (
            mode == "scheduled" and (type(interval) is not int or interval <= 0)
        ) or (mode != "scheduled" and interval is not None):
            raise ValueError(f"Invalid collection cadence for {item['id']}")
        item["collection_plan"] = {
            **plan,
            "status": "user_defined_plan",
            "evidence_status": "design_only_no_runtime_verification",
        }

    payload = {"catalog_version": "source-contracts.v1", "owner": "SignalStudio",
               "direction": "SignalStudio defines desired upstream inputs; Few Understand implements and reports evidence.",
               "source_count": len(source_rows), "operation_count": len(operations),
               "resource_count": len(resources), "sources": source_rows,
               "operations": operations, "resources": resources}
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    payload["revision"] = "sha256:" + hashlib.sha256(encoded).hexdigest()
    return payload


if __name__ == "__main__":
    output = CATALOG / "source-contracts.v1.json"
    output.write_text(json.dumps(build(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)
