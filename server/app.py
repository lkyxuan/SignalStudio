"""Single-user local HTTP API and production static server."""

import json
import gzip
import hashlib
import mimetypes
import os
import sqlite3
import signal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from graph_service import GraphError, GraphService
from live_state import snapshot, guard, RevisionConflict
from graph_transport import GraphTransport, details
from source_contract_store import SourceContractStore
from signal_contract_store import SignalContractStore
from table_backfill_store import TableBackfillStore
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from leaderboard_algorithms import ensure_leaderboard_algorithms
from leaderboard_simple import ensure_leaderboard_simple
from leaderboard_trends import ensure_leaderboard_trends
from leaderboard_foundation import ensure_leaderboard_foundation
from market_channel import ensure_market_channel
from market_polars import ensure_market_polars
from coingecko_indicator_signals import ensure_coingecko_indicator_signals
from polars_indicator_module import ensure_polars_indicator_module
from polars_indicator_flow import ensure_polars_indicator_flow
from coingecko_identity_handoff import ensure_coingecko_identity_handoff
from retire_market_discovery import ensure_retire_market_discovery
from trending_channel import ensure_trending_channel
from content_refresh import ensure_content_refresh
from coingecko_reference_cards import ensure_coingecko_reference_cards
from coingecko_trending import ensure_coingecko_trending
from initial_score_sources import ensure_initial_score_sources
from score_rollup_alignment import ensure_score_rollup_alignment
from card_model import CardModel, MODEL, VERSION
from application_interfaces import ensure_application_interfaces
from homepage_interface import ensure_homepage_interface

ROOT = Path(__file__).resolve().parent.parent
CONTRACT_REVISION = hashlib.sha256(b"".join(path.read_bytes() for path in sorted((ROOT / "catalog").rglob("*.json")))).hexdigest()
graph_transport = GraphTransport()
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
ensure_coingecko_trending(service)
ensure_leaderboard_scaffolds(service)
ensure_leaderboard_algorithms(service)
ensure_leaderboard_simple(service)
ensure_content_refresh(service)
ensure_initial_score_sources(service)
card_model = CardModel(service)
card_model.migrate()
ensure_score_rollup_alignment(service)
ensure_leaderboard_trends(service)
ensure_leaderboard_foundation(service)
ensure_market_channel(service)
ensure_trending_channel(service)
ensure_market_polars(service)
ensure_coingecko_indicator_signals(service)
ensure_polars_indicator_module(service)
ensure_polars_indicator_flow(service)
ensure_coingecko_identity_handoff(service)
ensure_retire_market_discovery(service)
ensure_application_interfaces(service)
ensure_homepage_interface(service)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        # Bound incomplete bodies so a stalled client cannot block graceful updates.
        self.connection.settimeout(10)

    def log_request(self, code='-', size='-'):
        if urlparse(self.path).path != '/api/desktop-health':
            super().log_request(code, size)

    def send_payload(self, status, payload, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Vary", "Accept-Encoding")
        # Explicit gzip;q=0 overrides wildcard acceptance. Invalid q is rejected.
        qualities = {}
        for item in self.headers.get("Accept-Encoding", "").lower().split(","):
            parts = [part.strip() for part in item.split(";")]
            quality = 1.0
            for parameter in parts[1:]:
                if parameter.startswith("q="):
                    try:
                        quality = float(parameter[2:])
                    except ValueError:
                        quality = 0.0
            qualities[parts[0]] = quality if 0 <= quality <= 1 else 0.0
        if len(payload) >= 512 and qualities.get('gzip', qualities.get('*', 0)) > 0:
            payload = gzip.compress(payload, compresslevel=5, mtime=0)
            self.send_header("Content-Encoding", "gzip")
        self.send_header("Content-Length", str(len(payload)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(payload)

    def respond(self, status, data, headers=None):
        self.send_payload(status, json.dumps(data, ensure_ascii=False).encode("utf-8"),
                          "application/json; charset=utf-8", {"Cache-Control": "no-store", **(headers or {})})

    def workspace(self):
        return {"project_root": str(ROOT),
                "database_path": str(Path(service.db.execute("PRAGMA database_list").fetchone()[2]).resolve())}

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size > (10_000_000 if urlparse(self.path).path == '/api/graph/import' else 1_000_000):
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
        if method != 'GET' and len(parts) >= 3:
            editable_nodes = []
            if parts[:2] == ['api','nodes'] and parts[2] != 'layout' and not (method == 'DELETE' and len(parts)==3):
                editable_nodes = [parts[2]]
            elif parts[:2] == ['api','fields']:
                editable_nodes = [service.get_field(parts[2])['node_id']]
            elif parts[:2] == ['api','requirements']:
                editable_nodes = [service.get_requirement(parts[2])['node_id']]
            elif parts[:2] == ['api','edges']:
                edge = service.get_edge(parts[2])
                editable_nodes = [edge['upstream_id'],edge['downstream_id']]
            for node_id in editable_nodes:
                if card_model.contract(node_id)['config'].get('read_only'):
                    raise GraphError('Unknown imported definitions are read-only')
        if parts == ["api", "desktop-health"] and method == "GET":
            return {"app": "SignalStudio", "project_root": str(ROOT),
                    "database_path": str(Path(service.db.execute("PRAGMA database_list").fetchone()[2]).resolve()),
                    "pid": os.getpid(), "mode": os.environ.get("SIGNALSTUDIO_MODE", "production"),
                    "client_ready": (ROOT / "dist" / "index.html").is_file()}
        if parts == ["api", "table-backfills", "1006"]:
            if method == "GET":
                return table_backfill.read()
            if method == "POST":
                return table_backfill.save(self.body())
        if parts == ["api", "graph"] and method == "GET":
            graph = {**snapshot(service, CONTRACT_REVISION), "workspace": self.workspace()}
            if self.headers.get('X-Graph-Transport') == 'canvas.v1':
                return graph_transport.response(graph, self.headers.get('X-Graph-Base') if self.headers.get('X-Workspace-Identity') else None)
            return graph
        if parts == ["api", "graph", "details"] and method == "GET":
            graph = {**snapshot(service, CONTRACT_REVISION), "workspace": self.workspace()}
            if query.get('revision', [''])[0] != graph['revision']:
                raise RevisionConflict('详情版本已更新，请重试。')
            node_ids = set(query.get('node_id', []))
            if not node_ids or len(node_ids) > 100 or not node_ids.issubset({n['id'] for n in graph['nodes']}):
                raise GraphError('Invalid detail selection')
            return details(graph, node_ids)
        if parts == ['api','card-model'] and method == 'GET':
            return {**MODEL,'actions':card_model.action_registry()}
        if parts == ['api','graph','readiness'] and method == 'GET':
            return card_model.readiness()
        if parts == ['api','graph','package'] and method == 'GET':
            return card_model.package()
        if parts == ['api','graph','import'] and method == 'POST':
            try:
                result = card_model.import_package(self.body())
            except (KeyError,TypeError,AttributeError) as exc:
                raise GraphError('Malformed definition package') from exc
            service._event('user','import_definition','graph','all',after=result)
            return result
        if parts == ['api','graph','reports']:
            if method == 'GET':
                return [{**dict(row),'report':json.loads(row['report'])} for row in service.db.execute('SELECT * FROM graph_definition_reports ORDER BY created_at')]
            if method == 'POST':
                return card_model.report(self.body())
        if len(parts) == 4 and parts[:2] == ['api','nodes'] and parts[3] == 'definition':
            if method == 'GET':
                return {**card_model.contract(parts[2]), 'readiness':card_model.readiness([parts[2]])}
            if method == 'PATCH':
                before = card_model.contract(parts[2])
                result = card_model.update_contract(parts[2], self.body())
                service._event('user','update_definition','node',parts[2],before,result)
                return result
        if len(parts) == 4 and parts[:2] == ['api','edges'] and parts[3] == 'bindings':
            edge = service.get_edge(parts[2])
            if method == 'GET':
                return [b for b in card_model.bindings() if b['edge_id'] == edge['id']]
            if method == 'PUT':
                bindings = self.body().get('bindings')
                if not isinstance(bindings,list) or not bindings:
                    raise GraphError('At least one explicit connection meaning is required')
                service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?',(edge['id'],))
                for binding in bindings:
                    card_model.add_binding(edge,binding)
                service._event('user','update_bindings','edge',edge['id'],after=bindings)
                return [b for b in card_model.bindings() if b['edge_id'] == edge['id']]
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
        self.send_payload(200, content, mimetypes.guess_type(candidate.name)[0] or "application/octet-stream",
                          {"Cache-Control": "public, max-age=31536000, immutable" if candidate.parent.name == 'assets' and candidate != dist / 'index.html' else "no-cache"})

    def dispatch(self):
        try:
            if self.path.startswith("/api/"):
                identity = self.headers.get('X-Workspace-Identity')
                if identity and json.loads(identity) != self.workspace():
                    self.respond(412, {'error': '工作台身份不匹配，已禁止读取与保存。'})
                    return
                expected = self.headers.get("If-Match")
                if self.command != 'GET' and (self.headers.get('X-Card-Model') != VERSION or not expected):
                    raise RevisionConflict('卡片模型已更新，请刷新工作台后再编辑。')
                if self.command != "GET" and expected:
                    guard(service, expected, CONTRACT_REVISION)
                try:
                    result = self.handle_api()
                    if service.db.in_transaction:
                        service.db.commit()
                except Exception:
                    service.db.rollback()
                    raise
                if self.command == 'GET' and urlparse(self.path).path == '/api/graph':
                    revision_tag = '"' + result['revision'] + '"'
                    etag = 'W/' + revision_tag  # Same logical graph across gzip representations.
                    matches = [value.strip().removeprefix('W/') for value in self.headers.get('If-None-Match', '').split(',')]
                    if identity and (revision_tag in matches or '*' in matches):
                        self.send_response(304)
                        self.send_header('ETag', etag)
                        self.send_header('Cache-Control', 'no-store')
                        self.send_header('Vary', 'Accept-Encoding')
                        self.end_headers()
                    else:
                        self.respond(200, result, {'ETag': etag})
                else:
                    self.respond(200, result)
            elif self.command == "GET":
                self.serve_file()
            else:
                self.respond(404, {"error": "Not found"})
        except RevisionConflict as exc:
            self.respond(409, {"error": str(exc)})
        except (GraphError, ValueError, sqlite3.IntegrityError) as exc:
            self.respond(400, {"error": str(exc)})

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8787"))
    print(f"SignalStudio API: http://127.0.0.1:{port}", flush=True)
    # Finish the active request/transaction before shutdown. The runtime stops the
    # public client first, so no new proxied writes arrive during a host update.
    stopping = False

    def request_stop(*_):
        global stopping
        stopping = True

    for stop_signal in (signal.SIGTERM, signal.SIGINT):
        signal.signal(stop_signal, request_stop)
    with HTTPServer(("127.0.0.1", port), Handler) as http:
        http.timeout = .25
        while not stopping:
            http.handle_request()
    service.db.close()
