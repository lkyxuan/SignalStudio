"""Turn a local Kaito MCP probe into a small, credential-free field inventory.

Input is the temporary JSON captured by an authenticated MCP audit. The output
contains field paths, simple scalar examples, and provenance; it deliberately
does not preserve posts, profiles, account IDs, URLs, or the API credential.
"""

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

# One application-owned English/Chinese guide, shared across tool responses.
GUIDES = {
    "token": ("对象代号", "Kaito 用来识别项目或币种的代号。", "先用它确认对象，再查询该对象的走势。"),
    "fullname": ("对象全名", "项目、币种或叙事的完整名称。", "核对同名或相似代号对应的对象。"),
    "symbol": ("交易符号", "币种或股票常用的交易符号。", "把 Kaito 对象与市场行情中的符号对应起来。"),
    "coingecko_id": ("CoinGecko 标识", "与 CoinGecko 对象对应的稳定名称。", "将社交讨论与行情对象匹配。"),
    "narrative": ("叙事代号", "Kaito 识别叙事主题的代码。", "用同一代号追踪一个叙事的关注变化。"),
    "description": ("说明", "对象或事件的文字说明。", "打开原始资料，确认它是否符合想研究的主题。"),
    "id": ("记录标识", "这条上游记录的标识。", "去重或回查同一条原始记录。"),
    "doc_id": ("文档标识", "内容在搜索索引中的标识。", "合并搜索和动态结果时避免重复。"),
    "type": ("内容来源类型", "这条内容属于 X 动态还是新闻等来源。", "比较不同来源对同一主题的讨论。"),
    "summary": ("内容摘要", "上游提供的内容摘要。", "打开原文判断讨论是否真正相关。"),
    "author_username": ("作者账号", "发布内容的账号名称。", "把内容按作者去重或观察特定账号。"),
    "author_name": ("作者显示名", "发布者在平台显示的名称。", "人工核对作者身份。"),
    "author_user_id": ("作者用户 ID", "发布者在 X 上的用户标识。", "关联作者资料和关注关系。"),
    "created_at": ("发布时间", "内容或账号创建的时间。", "按时间窗口比较新增讨论。"),
    "url": ("原文链接", "指向来源内容的链接。", "查看证据原文，确认摘要没有误导。"),
    "tokens": ("关联对象", "上游标出的相关项目或币种列表。", "筛出与目标对象有关的内容。"),
    "engagement": ("互动量", "内容获得的总体互动。", "比较内容的传播程度。"),
    "smart_engagement": ("高质量账号互动", "Kaito 识别的高质量账号产生的互动。", "观察专业账号是否参与讨论。"),
    "author_id": ("作者 ID", "用于查询某位作者的 X 用户标识。", "关联该作者的曝光和资料。"),
    "like_count": ("点赞数", "这条推文收到的点赞。", "衡量单条内容的基础互动。"),
    "quote_count": ("引用数", "这条推文被引用的次数。", "观察讨论是否被二次解读。"),
    "reply_count": ("回复数", "这条推文收到的回复。", "衡量讨论参与度。"),
    "retweet_count": ("转发数", "这条推文被转发的次数。", "观察内容传播范围。"),
    "smart_engagement_count": ("高质量账号互动数", "这条推文来自高质量账号的互动次数。", "与总互动一起判断讨论质量。"),
    "view_count": ("浏览数", "这条推文的浏览量。", "把互动放到曝光规模中比较。"),
    "followers": ("粉丝数", "账号当前的粉丝量。", "比较作者的受众规模。"),
    "following_count": ("关注人数", "账号主动关注的账号数量。", "辅助理解账号行为。"),
    "icon": ("头像链接", "账号资料中的头像地址。", "人工核对账号身份。"),
    "name": ("显示名称", "账号或对象展示给用户的名称。", "与账号 ID 一起确认对象。"),
    "username": ("账号名", "X 账号的用户名。", "与关注关系及发帖记录关联。"),
    "bio": ("账号简介", "账号资料中的自我介绍。", "人工判断账号类别是否合适。"),
    "tag_individual_or_organization": ("个人或机构", "Kaito 对账号的个人/机构分类。", "分开比较个人和机构带来的讨论。"),
    "user_type": ("账号类型", "Kaito 对账号的类型标记。", "筛选适合研究的账号群体。"),
    "is_ict": ("是否为追踪作者", "作者是否属于 Kaito 的 ICT 追踪范围。", "判断曝光统计是否可用。"),
    "current_ict": ("当前是否在追踪", "账号当前是否属于 ICT 追踪范围。", "解释高质量粉丝统计的覆盖范围。"),
    "start_date": ("统计起日", "这次统计窗口的开始日期。", "对齐不同指标的比较区间。"),
    "end_date": ("统计止日", "这次统计窗口的结束日期。", "对齐不同指标的比较区间。"),
    "total_impressions": ("总曝光量", "窗口内作者推文的总浏览量。", "比较同一作者不同时段的触达。"),
    "tweet_count": ("推文数量", "窗口内纳入曝光统计的推文数。", "避免只看总曝光忽略发帖量。"),
    "sentiment_score": ("情绪得分", "按日期返回的市场或对象讨论情绪值。", "观察情绪是否与关注度同步变化。"),
    "timestamp": ("日期", "时间序列中每个观测值对应的日期。", "将情绪与行情、提及量按日期对齐。"),
    "events": ("事件计数", "情绪序列随附的事件数量或标记。", "识别情绪波动附近的事件。"),
    "marketcap": ("市场总市值", "同一天的加密市场总市值。", "观察市场情绪变化时的市场背景。"),
    "smart_engagement[date]": ("每日高质量账号互动", "每天来自高质量账号的互动量。", "比较连续几天专业账号参与是否增加。"),
    "total_engagement[date]": ("每日总互动", "每天的总体互动量。", "与高质量账号互动一起看讨论扩散。"),
    "value[date]": ("每日提及量", "日期映射中的每天提及次数。", "找出对象讨论突然增多的日期。"),
    "mindshare[date]": ("每日关注份额", "每天该对象或叙事在相关讨论中的关注份额。", "比较不同时间窗口的关注份额走势。"),
    "mindshare": ("关注份额", "当前窗口内对象占相关讨论的比例。", "将排名与实际份额一起看。"),
    "rank": ("排名", "对象或账号在当前榜单中的位置。", "找出关注份额靠前的对象。"),
    "change": ("关注份额变化", "与比较窗口相比的关注份额变化值。", "查看关注度上升或下降的对象。"),
    "ticker": ("对象代号", "榜单中的项目或币种代号。", "与其他数据源中的对象对应。"),
    "ticker_id": ("对象内部 ID", "Kaito 用来区分榜单对象的标识。", "避免仅靠同名代号做关联。"),
    "user_id": ("用户 ID", "X 用户的稳定标识。", "把账号排名和账号资料关联。"),
    "date": ("日期", "事件或快照对应的日期。", "按日比较变化或对齐其他指标。"),
    "mode": ("返回模式", "当前响应是计数还是粉丝名单模式。", "正确解读后面的计数或名单。"),
    "num_of_smart_followers": ("高质量粉丝数", "Kaito 识别的高质量账号粉丝数量。", "观察一个账号的专业受众是否增长。"),
    "smart_followers": ("高质量粉丝名单", "指定日期新增的高质量粉丝列表。", "核对是谁带来了受众变化。"),
    "following": ("最近关注账号", "该用户最近关注的高质量账号列表。", "观察账号注意力流向。"),
    "category": ("账号类别", "被关注账号的类别。", "区分个人与机构关注。"),
    "display_name": ("叙事名称", "叙事主题供阅读的名称。", "将内部代号与易读名称对应。"),
    "catalyst_list[]": ("事件催化因素", "事件附带的催化因素标签。", "把同一类事件汇总分析。"),
    "earliestRef.created_at": ("最早证据时间", "最早一条参考资料的发布时间。", "核对事件最初出现的时间。"),
    "earliestRef.data_source": ("最早证据来源", "最早参考资料的来源类别。", "判断事件来自社交媒体还是其他来源。"),
    "earliestRef.id": ("最早证据 ID", "最早参考资料的标识。", "回查相同证据。"),
    "earliestRef.url": ("最早证据链接", "最早参考资料的原文地址。", "打开证据核实事件。"),
    "reference_list[].created_at": ("参考资料时间", "事件参考资料的发布时间。", "梳理证据的先后顺序。"),
    "reference_list[].data_source": ("参考资料来源", "参考资料的平台或来源类别。", "比较不同来源对事件的报道。"),
    "reference_list[].id": ("参考资料 ID", "参考资料的标识。", "去重或回查参考资料。"),
    "reference_list[].url": ("参考资料链接", "参考资料的原文地址。", "查看支撑事件的原始内容。"),
    "smart_engagement": ("高质量账号互动", "相关内容得到的高质量账号互动。", "衡量事件在专业账号中的传播。"),
    "ticker[]": ("关联对象", "事件关联的项目或币种代号。", "按对象汇总事件。"),
}

SAFE_STRINGS = {"token", "symbol", "narrative", "type", "category", "mode", "ticker",
                "date", "start_date", "end_date", "timestamp", "created_at", "fullname",
                "display_name", "tag_individual_or_organization", "user_type", "smart_engagement"}


def flatten(value, prefix=""):
    if isinstance(value, dict):
        if value and all(DATE.fullmatch(str(key)) for key in value):
            return [(prefix + "[date]" if prefix else "value[date]", next(iter(value.values())))]
        return [pair for key, child in value.items()
                for pair in flatten(child, f"{prefix}.{key}" if prefix else key)]
    if isinstance(value, list):
        if not value:
            return [(prefix, [])]
        return flatten(value[0], prefix + "[]")
    return [(prefix, value)]


def fields_for(tool, samples):
    fields = {}
    for sample in samples:
        if sample.get("is_error"):
            continue
        value = sample.get("sample")
        if isinstance(value, list) and value and all(isinstance(row, list) for row in value):
            pairs = [(str(row[0]), row[1] if len(row) > 1 else None) for row in value if row]
        elif isinstance(value, list):
            pairs = [pair for row in value for pair in flatten(row)]
        elif isinstance(value, dict):
            rows = []
            for key in ("matches", "results", "listData", "result", "top_gainer", "top_loser", "following"):
                candidate = value.get(key)
                if isinstance(candidate, dict):
                    rows.append(candidate)
                elif isinstance(candidate, list):
                    rows.extend(candidate)
            pairs = [pair for row in rows for pair in flatten(row)] if rows else flatten(value)
        else:
            pairs = []
        for path, actual in pairs:
            if path and path not in fields:
                fields[path] = actual
    return fields


def safe_example(path, value):
    if isinstance(value, (bool, int, float)) or value == []:
        return value
    if isinstance(value, str) and (path in SAFE_STRINGS or DATE.fullmatch(value)) and len(value) <= 60:
        return value
    return None


def dated_response_excerpt(tool, raw_tools):
    """Keep one real date/value per series, retaining the API's nesting."""
    sample = raw_tools.get(tool, {}).get("sample")
    if not isinstance(sample, dict):
        return None
    if tool == "kaito_engagement":
        keys = ("smart_engagement", "total_engagement")
    elif tool == "kaito_mindshare_entity":
        keys = ("mindshare",)
    else:
        return None
    excerpt = {}
    for key in keys:
        series = sample.get(key)
        if not isinstance(series, dict):
            return None
        pair = next(((day, value) for day, value in series.items()
                     if DATE.fullmatch(day) and isinstance(value, (int, float))), None)
        if pair is None:
            return None
        excerpt[key] = {pair[0]: pair[1]}
    return excerpt


def main():
    raw = json.loads(Path(sys.argv[1]).read_text())
    snapshot = json.loads((CATALOG / "raw-materials.v2.json").read_text())
    operation_entity = {op["id"].rsplit(".", 1)[-1]: op["entity_id"]
                        for op in snapshot["operations"] if op["spider_id"] == "kaito-social-spider"}
    output = {"source": "Kaito MCP live tools/call", "endpoint": raw["endpoint"],
              "observed_at": raw["observed_at"], "v2_source_revision": snapshot["source_revision"],
              "tool_count": raw["tools_list_count"], "output_schema_count": 0,
              "count_meaning": "Observed response row/series fields in small live samples; lower bound, not complete output schema or crawler-emitted fields.",
              "tools": []}
    csv_rows = []
    base_tools = [name for name in raw["tools"] if not name.endswith(("-users", "-losers", "-all_dates"))]
    for tool in base_tools:
        samples = [sample for name, sample in raw["tools"].items() if name == tool or name.startswith(tool + "-")]
        values = fields_for(tool, samples)
        unknown = sorted(set(values) - set(GUIDES))
        if unknown:
            raise ValueError(f"Missing Chinese field guidance for {tool}: {unknown}")
        fields = []
        for path, value in sorted(values.items()):
            label, purpose, use_case = GUIDES[path]
            kind = "array" if isinstance(value, list) else "null" if value is None else type(value).__name__
            example = safe_example(path, value)
            field = {"path": path, "label_zh": label, "purpose_zh": purpose,
                     "use_case_zh": use_case, "type": kind, "example_value": example}
            fields.append(field)
            csv_rows.append({"tool": tool, "record_type_id": operation_entity.get(tool, ""),
                             **field, "observed_at": raw["observed_at"]})
        response_example = {field["path"]: field["example_value"] for field in fields
                            if field["example_value"] is not None}
        output["tools"].append({"name": tool, "entity_id": operation_entity.get(tool),
                                 "sample_status": "observed" if fields else "empty_result",
                                 "observed_field_count": len(fields), "fields": fields,
                                 "response_excerpt": dated_response_excerpt(tool, raw["tools"]),
                                 "response_example": response_example,
                                 "sample_note": "实际 API 响应中的值；文本、账号 ID 和链接已省略。"})
    (CATALOG / "kaito-mcp-observed.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    with (CATALOG / "kaito-mcp-fields.zh.csv").open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=("tool", "record_type_id", "path", "label_zh",
                                                   "purpose_zh", "use_case_zh", "type", "example_value", "observed_at"))
        writer.writeheader()
        writer.writerows(csv_rows)


if __name__ == "__main__":
    main()
