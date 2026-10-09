"""Single-user local HTTP API and production static server."""

import json
import mimetypes
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from graph_service import GraphError, GraphService
from source_contract_store import SourceContractStore
from signal_contract_store import SignalContractStore
from table_backfill_store import TableBackfillStore
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from leaderboard_algorithms import ensure_leaderboard_algorithms
from leaderboard_simple import ensure_leaderboard_simple
from coingecko_reference_cards import ensure_coingecko_reference_cards

ROOT = Path(__file__).resolve().parent.parent
LOCAL_KAITO_CASE = ROOT / "data" / "kaito-advanced-search-live.json"
LOCAL_SOURCE_CASES = ROOT / "data" / "source-cases-live.json"
service = GraphService(os.environ.get("SIGNALSTUDIO_DB"))
table_backfill = TableBackfillStore()
source_contracts = SourceContractStore()
signal_contracts = SignalContractStore(source_contracts)
service.ensure_system_tables()
service.ensure_source_contract_sources(source_contracts.contract["operations"] + source_contracts.contract["resources"])
service.retire_legacy_record_types()
service.compact_retired_node_references()
service.group_node_references_once()
ensure_coingecko_reference_cards(service)
ensure_leaderboard_scaffolds(service)
ensure_leaderboard_algorithms(service)
ensure_leaderboard_simple(service)


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > 1_000_000:
            raise GraphError("Request is too large")
        try:
            return json.loads(self.rfile.read(size) or b"{}")
        except json.JSONDecodeError:
            raise GraphError("Invalid JSON")

    def handle_api(self):
        url = urlparse(self.path)
        parts = [part for part in url.path.split("/") if part]
        query = parse_qs(url.query)
        method = self.command
        if parts == ["api", "desktop-health"] and method == "GET":
            return {"app": "SignalStudio", "project_root": str(ROOT),
                    "database_path": str(Path(service.db.execute("PRAGMA database_list").fetchone()[2]).resolve()),
                    "client_ready": (ROOT / "dist" / "index.html").is_file()}
        if parts == ["api", "table-backfills", "1006"]:
            if method == "GET":
                return table_backfill.read()
            if method == "POST":
                return table_backfill.save(self.body())
        if parts == ["api", "graph"] and method == "GET":
            return service.graph()
        if parts == ["api", "signals"] and method == "GET":
            return {"catalog_version": "signal-contracts.v1",
                    "revision": signal_contracts.revision,
                    "signals": signal_contracts.list_signals(service)}
        if (len(parts) == 4 and parts[:2] == ["api", "signals"]
                and parts[3] == "package" and method == "GET"):
            return signal_contracts.package(service, unquote(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "signals"] and parts[3] == "reports":
            signal_id = unquote(parts[2])
            package = signal_contracts.package(service, signal_id)
            if method == "GET":
                return {"signal_key": package["signal_key"],
                        "reports": service.get_signal_reports(package["signal_key"])}
            if method == "POST":
                return service.create_signal_report(package, self.body())
        if parts == ["api", "source-contracts", "v1"] and method == "GET":
            return source_contracts.full()
        if parts == ["api", "source-contracts", "v1", "meta"] and method == "GET":
            return source_contracts.meta()
        if parts == ["api", "source-cases", "016"] and method == "GET":
            return json.loads(LOCAL_KAITO_CASE.read_text(encoding="utf-8")) if LOCAL_KAITO_CASE.is_file() else {"cases": []}
        if len(parts) == 4 and parts[:3] == ["api", "source-cases", "v1"] and method == "GET":
            saved = json.loads(LOCAL_SOURCE_CASES.read_text(encoding="utf-8")) if LOCAL_SOURCE_CASES.is_file() else {"operations": {}}
            return {"operation_id": unquote(parts[3]), "cases": saved.get("operations", {}).get(unquote(parts[3]), [])}
        if len(parts) == 6 and parts[:3] == ["api", "source-cases", "v1"] and parts[4] == "responses" and method == "GET":
            saved = json.loads(LOCAL_SOURCE_CASES.read_text(encoding="utf-8")) if LOCAL_SOURCE_CASES.is_file() else {"operations": {}}
            cases = saved.get("operations", {}).get(unquote(parts[3]), [])
            try:
                return cases[int(parts[5])]["response"]
            except (ValueError, IndexError, KeyError):
                raise GraphError("Source case response not found")
        if len(parts) == 5 and parts[:4] == ["api", "source-contracts", "v1", "operations"] and method == "GET":
            return source_contracts.get_operation(unquote(parts[4]))
        if len(parts) == 5 and parts[:4] == ["api", "source-contracts", "v1", "resources"] and method == "GET":
            return source_contracts.get_resource(unquote(parts[4]))
        if len(parts) == 6 and parts[:4] == ["api", "source-contracts", "v1", "fields"] and parts[5] == "use" and method == "POST":
            entity, field = source_contracts.get_field_definition(unquote(parts[4]))
            data = self.body()
            return service.use_catalog_field(entity, field, data.get("target_node_id"),
                                             requirement_id=data.get("requirement_id"))
        if parts == ["api", "nodes"]:
            if method == "GET":
                return service.search_nodes(query.get("q", [""])[0])
            if method == "POST":
                return service.create_node(self.body())
        if parts == ["api", "nodes", "layout"] and method == "POST":
            return service.update_layout(self.body())
        if parts == ["api", "search-description"] and method == "GET":
            return service.search_by_description(query.get("q", [""])[0])
        if len(parts) == 3 and parts[:2] == ["api", "nodes"]:
            if method == "GET":
                return service.get_node(parts[2])
            if method == "PATCH":
                return service.update_node(parts[2], self.body())
            if method == "DELETE":
                return service.delete_node(parts[2])
        if len(parts) == 4 and parts[:2] == ["api", "nodes"] and method == "GET":
            node_id, relation = parts[2], parts[3]
            if relation == "fields":
                return service.get_fields(node_id)
            if relation == "requirements":
                return service.get_requirements(node_id)
            hops = int(query.get("hops", ["1"])[0])
            if relation == "upstream":
                return service.get_upstream(node_id, hops)
            if relation == "downstream":
                return service.get_downstream(node_id, hops)
            if relation == "impact":
                return service.get_impact(node_id)
            if relation == "context":
                return service.get_context(node_id, hops)
        if len(parts) == 4 and parts[:2] == ["api", "nodes"] and parts[3] == "fields" and method == "POST":
            return service.create_field(parts[2], self.body())
        if len(parts) == 4 and parts[:2] == ["api", "nodes"] and parts[3] == "requirements" and method == "POST":
            return service.create_requirement(parts[2], self.body())
        if len(parts) == 4 and parts[:2] == ["api", "nodes"] and parts[3] == "contract" and method == "GET":
            return signal_contracts.processor(service, parts[2])
        if len(parts) == 3 and parts[:2] == ["api", "requirements"]:
            if method == "PATCH":
                return service.update_requirement(parts[2], self.body())
            if method == "DELETE":
                return service.delete_requirement(parts[2])
        if len(parts) == 3 and parts[:2] == ["api", "fields"]:
            if method == "GET":
                return service.get_field(parts[2])
            if method == "PATCH":
                return service.update_field(parts[2], self.body())
            if method == "DELETE":
                return service.delete_field(parts[2])
        if parts == ["api", "edges"] and method == "POST":
            return service.create_edge(self.body())
        if (len(parts) == 4 and parts[:2] == ["api", "edges"]
                and parts[3] == "contract" and method == "GET"):
            return signal_contracts.connection(service, parts[2])
        if len(parts) == 3 and parts[:2] == ["api", "edges"]:
            if method == "GET":
                return service.get_edge(parts[2])
            if method == "PATCH":
                return service.update_edge(parts[2], self.body())
            if method == "DELETE":
                return service.delete_edge(parts[2])
        if len(parts) == 4 and parts[:2] == ["api", "edges"] and parts[3] == "usages":
            if method == "GET":
                return service.get_field_usages(parts[2])
            if method == "POST":
                return service.create_field_usage(parts[2], self.body())
        if len(parts) == 3 and parts[:2] == ["api", "usages"]:
            if method == "PATCH":
                return service.update_field_usage(parts[2], self.body())
            if method == "DELETE":
                return service.delete_field_usage(parts[2])
        if parts == ["api", "proposals"] and method == "POST":
            return service.propose(self.body().get("prompt"))
        if parts == ["api", "proposals", "apply"] and method == "POST":
            return service.apply_proposal(self.body())
        raise GraphError("Route not found")

    def serve_file(self):
        dist = ROOT / "dist"
        requested = urlparse(self.path).path
        relative = requested.lstrip("/") or "index.html"
        candidate = (dist / relative).resolve()
        if not candidate.is_relative_to(dist.resolve()) or not candidate.is_file():
            candidate = dist / "index.html"
        if not candidate.is_file():
            self.respond(404, {"error": "Build the client with npm run build first"})
            return
        content = candidate.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(candidate.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def dispatch(self):
        try:
            if self.path.startswith("/api/"):
                self.respond(200, self.handle_api())
            elif self.command == "GET":
                self.serve_file()
            else:
                self.respond(404, {"error": "Not found"})
        except (GraphError, ValueError, sqlite3.IntegrityError) as exc:
            self.respond(400, {"error": str(exc)})

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    print(f"SignalStudio API: http://127.0.0.1:{port}", flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
