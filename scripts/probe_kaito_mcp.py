"""Run small Kaito MCP probes without saving credentials or response contents.

Requires a signed-in local 1Password CLI and the existing ``Kaito API`` item in
the ``fewunderstand`` vault. Saves live input schemas and response field paths,
not raw posts, account identifiers, URLs, or the API key.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ENDPOINT = "https://bff.kaito.ai/api/mcp"
DEFAULT_OUT = Path(__file__).resolve().parent.parent / "catalog" / "kaito-mcp-live-probe.json"
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def api_key():
    result = subprocess.run(
        ["op", "item", "get", "Kaito API", "--vault", "fewunderstand", "--format=json"],
        capture_output=True, text=True, check=False, timeout=15,
    )
    if result.returncode:
        raise RuntimeError("1Password CLI is not signed in or the Kaito API item is unavailable")
    item = json.loads(result.stdout)
    key = next((field.get("value") for field in item.get("fields", [])
                if field.get("label") == "KAITO_API_KEY"), None)
    if not key:
        raise RuntimeError("Kaito API key field is unavailable")
    return key


class McpClient:
    def __init__(self, key):
        self.key = key
        self.session = None
        self.sequence = 0

    def rpc(self, method, params=None):
        self.sequence += 1
        request = urllib.request.Request(
            ENDPOINT,
            data=json.dumps({"jsonrpc": "2.0", "id": self.sequence,
                             "method": method, "params": params or {}}).encode(),
            headers={
                "Authorization": "Bearer " + self.key,
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                **({"mcp-session-id": self.session} if self.session else {}),
            },
        )
        with urllib.request.urlopen(request, timeout=45) as response:
            self.session = response.headers.get("mcp-session-id") or self.session
            raw = response.read().decode()
        messages = [raw] if raw.lstrip().startswith("{") else re.findall(r"^data:\s*(.+)$", raw, re.M)
        event = next((json.loads(value) for value in messages if value.lstrip().startswith("{")), None)
        if event is None:
            raise RuntimeError("MCP returned no JSON result")
        if "error" in event:
            error = event["error"]
            raise RuntimeError(f'MCP error {error.get("code", "unknown")}')
        return event.get("result", {})


def response_value(result):
    if result.get("structuredContent") is not None:
        return result["structuredContent"]
    values = []
    for item in result.get("content", []):
        if item.get("type") == "text":
            try:
                values.append(json.loads(item["text"]))
            except ValueError:
                values.append(item["text"])
    return values[0] if len(values) == 1 else values


def paths(value, prefix="", depth=0):
    if depth >= 9:
        return {prefix + "[depth-limit]"}
    if isinstance(value, dict):
        result = set()
        for key, child in value.items():
            segment = ("[date]" if DATE.fullmatch(str(key)) else str(key)
                       if re.fullmatch(r"[A-Za-z_][A-Za-z_0-9-]{0,79}", str(key)) else "[key]")
            path = prefix + ("." if prefix and segment != "[date]" else "") + segment
            result.update(paths(child, path, depth + 1))
        return result or {prefix + "[empty-object]"}
    if isinstance(value, list):
        result = set()
        for row in value:
            result.update(paths(row, prefix + "[]", depth + 1))
        return result or {prefix + "[empty-array]"}
    return {prefix or "[scalar]"}


def public_id(value):
    """Extract an identifier in memory only; never include it in saved results."""
    if isinstance(value, dict):
        for key in ("token", "narrative", "tweet_id", "doc_id", "author_user_id", "user_id"):
            if value.get(key):
                yield key, str(value[key])
        for child in value.values():
            yield from public_id(child)
    elif isinstance(value, list):
        for child in value:
            yield from public_id(child)


def planned_arguments(name, values, today):
    start = (today - timedelta(days=7)).isoformat()
    yesterday = (today - timedelta(days=1)).isoformat()
    end = today.isoformat()
    token = values.get("token", "BTC")
    narrative = values.get("narrative", "AI")
    account = values.get("user_id")
    common = {"token": token, "start_date": start, "end_date": end}
    plans = {
        "kaito_entities": {"query": "Bitcoin", "limit": 1},
        "kaito_narratives": {"query": "AI", "limit": 1},
        "kaito_feeds": {"size": 1, "limit": 1},
        "kaito_search": {"query": "Bitcoin", "size": 1, "limit": 1},
        "kaito_advanced_search": {"query": "Bitcoin", "size": 1, "limit": 1},
        "kaito_tweet_engagement_info": {"tweet_id": values.get("tweet_id")},
        "kaito_twitter_user_metadata": {"user_id": account},
        "kaito_ict_impressions": {"author_id": account, "user_id": account,
                                  "start_date": start, "end_date": end},
        "kaito_sentiment_entity": common,
        "kaito_engagement": common,
        "kaito_mentions": common,
        "kaito_mindshare_entity": common,
        "kaito_mindshare_entity_by_account": {"token": token, "duration": "7d", "top_n": 1},
        "kaito_events": {"token": token, "start_date": end,
                         "end_date": (today + timedelta(days=14)).isoformat(),
                         "sort_by": "event_date", "sort_order": "asc"},
        "kaito_mindshare_entity_arena": {"duration": "24h"},
        "kaito_mindshare_entity_delta": {"duration": "24h", "limit": 1},
        "kaito_smart_following_market": {"duration": "24h", "limit": 1},
        "kaito_smart_followers": {"username": "VitalikButerin", "mode": "count", "date": yesterday},
        "kaito_smart_following": {"username": "VitalikButerin"},
        "kaito_mindshare_narrative": {"narrative": narrative,
                                      "start_date": start, "end_date": end},
        "kaito_market_sentiment": {"start_date": start, "end_date": end},
    }
    return plans.get(name)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--list-only", action="store_true")
    args = parser.parse_args()
    client = McpClient(api_key())
    client.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                              "clientInfo": {"name": "SignalStudio-Kaito-probe", "version": "0.1.0"}})
    tools = client.rpc("tools/list").get("tools", [])
    report = {
        "observed_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": ENDPOINT,
        "meaning": "Live MCP probe; paths are response lower bounds, not crawler records or a complete output schema.",
        "tools": [{"name": tool["name"], "inputSchema": tool.get("inputSchema"),
                   "has_outputSchema": bool(tool.get("outputSchema"))} for tool in tools],
        "calls": [],
    }
    print(f"tools/list: {len(tools)} tools", flush=True)
    if not args.list_only:
        values = {}
        today = datetime.now(timezone.utc).date()
        order = {name: index for index, name in enumerate((
            "kaito_entities", "kaito_narratives", "kaito_feeds", "kaito_search",
            "kaito_advanced_search", "kaito_twitter_user_metadata",
            "kaito_ict_impressions", "kaito_tweet_engagement_info"))}
        for tool in sorted(tools, key=lambda item: order.get(item["name"], 100)):
            name = tool["name"]
            schema = tool.get("inputSchema") or {}
            properties = schema.get("properties") or {}
            offered = planned_arguments(name, values, today)
            if offered is None:
                report["calls"].append({"name": name, "status": "skipped_not_in_test_plan"})
                print(f"{name}: skipped_not_in_test_plan", flush=True)
                continue
            arguments = {key: value for key, value in offered.items()
                         if key in properties and value is not None}
            required = set(schema.get("required") or [])
            missing = sorted(required - set(arguments))
            result = {"name": name, "argument_names": sorted(arguments)}
            if missing:
                result.update(status="skipped_missing_input", missing_required=missing)
            else:
                try:
                    raw = client.rpc("tools/call", {"name": name, "arguments": arguments})
                    value = response_value(raw)
                    if name in {"kaito_entities", "kaito_narratives", "kaito_feeds",
                                "kaito_search", "kaito_advanced_search"}:
                        for key, identifier in public_id(value):
                            if key in ("token", "narrative") and key not in values:
                                values[key] = identifier
                            if key in ("author_user_id", "user_id") and "user_id" not in values:
                                values["user_id"] = identifier
                            if key in ("tweet_id", "doc_id") and "tweet_id" not in values and identifier.isdigit():
                                values["tweet_id"] = identifier
                    result.update(status="tool_error" if raw.get("isError") else "ok",
                                  response_kind=type(value).__name__,
                                  response_paths=sorted(paths(value)))
                except (RuntimeError, urllib.error.HTTPError, TimeoutError) as exc:
                    result.update(status="call_failed", error_type=type(exc).__name__,
                                  error_code=getattr(exc, "code", None))
            report["calls"].append(result)
            print(f'{name}: {result["status"]} ({len(result.get("response_paths", []))} paths)', flush=True)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"saved: {args.out}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.SubprocessError, urllib.error.HTTPError) as error:
        print(f"probe unavailable: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)
