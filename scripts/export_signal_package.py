"""Write one current signal package as a portable JSON handoff file."""

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from graph_service import GraphService  # noqa: E402
from signal_contract_store import SignalContractStore  # noqa: E402
from source_contract_store import SourceContractStore  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("signal_key")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    sources = SourceContractStore()
    signals = SignalContractStore(sources)
    graph = GraphService(os.environ.get("SIGNALSTUDIO_DB"))
    try:
        package = signals.package(graph, args.signal_key)
    finally:
        graph.db.close()
    if package["implementation_readiness"]["status"] != "ready":
        raise SystemExit("Signal package is incomplete: " + json.dumps(
            package["implementation_readiness"]["issues"], ensure_ascii=False))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary = args.output.with_suffix(args.output.suffix + ".tmp")
    temporary.write_text(json.dumps(package, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(args.output)
    print(args.output, package["revision"])


if __name__ == "__main__":
    main()
