"""Save complete paired Kaito MCP calls for the other source cards locally.

The output is gitignored. It may contain post text, account identifiers, and
URLs; never print the response or credentials to the terminal.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from probe_kaito_mcp import McpClient, api_key, response_value

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "catalog" / "kaito-mcp-call-examples.json"
OUTPUT = ROOT / "data" / "source-cases-live.json"
SKIP_TOOL = "kaito_advanced_search"


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


def main():
    saved = json.loads(OUTPUT.read_text(encoding="utf-8"))["operations"] if OUTPUT.exists() else {}
    examples = [case for case in json.loads(EXAMPLES.read_text(encoding="utf-8"))["examples"]
                if case["tool"] != SKIP_TOOL]
    client = McpClient(api_key())
    client.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                              "clientInfo": {"name": "SignalStudio-case-capture", "version": "0.1.0"}})
    for index, case in enumerate(examples, 1):
        operation_id = "kaito.mcp." + case["tool"]
        key = case["observed_at"]
        if any(item.get("source_example_at") == key for item in saved.get(operation_id, [])):
            continue
        try:
            result = client.rpc("tools/call", {"name": case["tool"], "arguments": case["request"]})
            if result.get("isError"):
                print(f"{index}/{len(examples)} {case['tool']}: tool_error", flush=True)
                continue
            captured = {"case_label_zh": case.get("case_label_zh"), "request": case["request"],
                        "response": response_value(result), "response_complete": True,
                        "observed_at": datetime.now(timezone.utc).isoformat(),
                        "source_example_at": key, "evidence": "live_mcp_call"}
            saved.setdefault(operation_id, []).append(captured)
            save(saved)
            print(f"{index}/{len(examples)} {case['tool']}: saved", flush=True)
        except Exception as error:
            print(f"{index}/{len(examples)} {case['tool']}: {type(error).__name__}", flush=True)
    for uri, operation_id in (("kaito://tokens", "kaito.resource.tokens"),
                              ("kaito://narratives", "kaito.resource.narratives")):
        if saved.get(operation_id):
            continue
        try:
            result = client.rpc("resources/read", {"uri": uri})
            if result.get("isError"):
                print(f"{operation_id}: resource_error", flush=True)
                continue
            saved[operation_id] = [{"case_label_zh": "资源读取", "request": {"uri": uri},
                                    "response": response_value(result), "response_complete": True,
                                    "observed_at": datetime.now(timezone.utc).isoformat(),
                                    "evidence": "live_mcp_resource_read"}]
            save(saved)
            print(f"{operation_id}: saved", flush=True)
        except Exception as error:
            print(f"{operation_id}: {type(error).__name__}", flush=True)


if __name__ == "__main__":
    main()
