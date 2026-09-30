"""Capture paired, complete Kaito advanced-search responses for local review.

The output is kept under gitignored data/ because responses may contain post
text, account identifiers, and URLs. Never print the API key or response body.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from probe_kaito_mcp import McpClient, api_key, response_value

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "catalog" / "kaito-mcp-call-examples.json"
OUTPUT = ROOT / "data" / "kaito-advanced-search-live.json"
TOOL = "kaito_advanced_search"


def main():
    cases = [item for item in json.loads(EXAMPLES.read_text(encoding="utf-8"))["examples"]
             if item["tool"] == TOOL]
    client = McpClient(api_key())
    client.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                              "clientInfo": {"name": "SignalStudio-case-capture", "version": "0.1.0"}})
    captured = []
    for index, case in enumerate(cases, 1):
        request = case["request"]
        result = client.rpc("tools/call", {"name": TOOL, "arguments": request})
        if result.get("isError"):
            raise RuntimeError(f"Kaito MCP call {index} returned an error")
        captured.append({"case_label_zh": case["case_label_zh"],
                         "request": request, "response": response_value(result),
                         "observed_at": datetime.now(timezone.utc).isoformat(),
                         "response_complete": True})
        print(f"captured call {index}/{len(cases)}", flush=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(OUTPUT, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        os.fchmod(output.fileno(), 0o600)
        json.dump({"tool": TOOL, "source": "Kaito MCP tools/call", "cases": captured},
                  output, ensure_ascii=False, indent=2)
        output.write("\n")
    print(f"saved {len(captured)} full responses in local ignored data/", flush=True)


if __name__ == "__main__":
    main()
