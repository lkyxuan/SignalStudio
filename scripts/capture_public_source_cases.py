"""Save complete responses for the public HTTP source examples locally."""

import json
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "catalog" / "public-call-examples.json"
CONTRACT = ROOT / "catalog" / "source-contracts.v1.json"
OUTPUT = ROOT / "data" / "source-cases-live.json"


def save(cases):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix(".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        os.fchmod(stream.fileno(), 0o600)
        json.dump({"source": "Live upstream calls; not crawler records", "operations": cases},
                  stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    os.replace(temporary, OUTPUT)


def url_for(operation, request):
    operation_id = operation["id"]
    if operation_id.startswith("binance.usdm."):
        return "https://fapi.binance.com" + operation["endpoint"] + "?" + urllib.parse.urlencode(request)
    if operation_id == "coingecko.coins_markets":
        return "https://api.coingecko.com" + operation["endpoint"] + "?" + urllib.parse.urlencode(request)
    if operation_id == "dexscreener.token_pairs_by_address":
        return "https://api.dexscreener.com/token-pairs/v1/" + urllib.parse.quote(request["chainId"]) + "/" + urllib.parse.quote(request["tokenAddress"])
    if operation_id == "rss.item":
        return request["feed_url"]
    return None


def main():
    saved = json.loads(OUTPUT.read_text(encoding="utf-8"))["operations"] if OUTPUT.exists() else {}
    operations = {item["id"]: item for item in json.loads(CONTRACT.read_text(encoding="utf-8"))["operations"]}
    examples = json.loads(EXAMPLES.read_text(encoding="utf-8"))["examples"]
    for index, case in enumerate(examples, 1):
        operation_id = case["operation_id"]
        url = url_for(operations[operation_id], case["request"])
        if not url or saved.get(operation_id):
            continue
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "SignalStudio-case-capture/0.1 (API reference review)",
                                                       "Accept": "application/json, application/rss+xml, application/xml, */*"})
            with urllib.request.urlopen(req, timeout=30) as http:
                raw = http.read().decode("utf-8")
                status = http.status
            response = raw if operation_id == "rss.item" else json.loads(raw)
            saved[operation_id] = [{"case_label_zh": case.get("case_label_zh"),
                                    "request": case["request"], "response": response,
                                    "response_format": "xml" if operation_id == "rss.item" else "json",
                                    "response_complete": True, "http_status": status,
                                    "observed_at": datetime.now(timezone.utc).isoformat(),
                                    "evidence": "live_http_call"}]
            save(saved)
            print(f"{index}/{len(examples)} {operation_id}: saved", flush=True)
        except Exception as error:
            print(f"{index}/{len(examples)} {operation_id}: {type(error).__name__}", flush=True)


if __name__ == "__main__":
    main()
