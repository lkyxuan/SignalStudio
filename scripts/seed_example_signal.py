"""Create the first graph-backed signal design without overwriting existing work."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "server"))

from graph_service import GraphError, GraphService  # noqa: E402
from signal_contract_store import SignalContractStore  # noqa: E402
from source_contract_store import SourceContractStore  # noqa: E402


def seed(graph, source_contracts, signal_contracts):
    spec = signal_contracts.signals["coingecko_market_turnover_candidate"]
    key = spec["signal_key"]
    existing = graph.find_signal_key(key)
    if existing:
        return existing
    if graph.find_name(spec["graph_node_name"]):
        raise GraphError("Example signal name is already used by another node")
    operation = source_contracts.operations[spec["collection"]["operation_id"]]
    graph.ensure_source_contract_sources([operation])
    node = graph.create_node({
        "name": spec["graph_node_name"],
        "type": "Metric",
        "signal_key": key,
        "definition": spec["interpretation_zh"],
        "decision_question": spec["question_zh"],
        "observation_window": spec["graph_display"]["observation_window"],
        "formula": spec["graph_display"]["formula"],
        "trigger_rule": spec["graph_display"]["trigger_rule"],
        "validation_plan": spec["validation"]["plan_zh"],
        "caveats": "阈值未验证；候选仅使用 CoinGecko 币种 ID，不自动认定内部资产身份。",
        "notes": "完整机器配置：GET /api/signals/" + key + "/package",
        "position_x": 470,
        "position_y": -550,
    }, actor="signal_contract")
    for item in spec["output"]["fields"]:
        graph.create_field(node["id"], {
            "name": item["name"], "data_type": item["type"],
            "definition": "执行包输出字段，取值来源：" + item["source"],
        }, actor="signal_contract")
    for item in spec["inputs"]:
        requirement = graph.create_requirement(node["id"], {
            "name": item["name"],
            "purpose": "执行包必需输入；上游路径 " + item["upstream_path"],
        }, actor="signal_contract")
        catalog_id = ("source-contracts.v1::" + operation["id"]
                      + "::" + item["upstream_path"])
        entity, field = source_contracts.get_field_definition(catalog_id)
        mapped = graph.use_catalog_field(entity, field, node["id"],
                                         requirement_id=requirement["id"],
                                         actor="signal_contract")
        output_field = next((field for field in graph.get_fields(node["id"])
                             if field["name"] == item["name"]), None)
        if output_field:
            graph.update_field_usage(mapped["usage_id"], {
                "target_field_id": output_field["id"],
                "usage_note": "按执行包读取上游路径 " + item["upstream_path"],
            }, actor="signal_contract")
    edge = graph.get_edge(mapped["edge_id"])
    transport = spec["transport"]["input"]
    graph.update_edge(edge["id"], {
        "rationale": "把 CoinGecko 市场列表中每个币种的完整来源记录送入 Redpanda，供下游节点读取。",
        "transformation": "每个币种一条消息；data 保留上游完整记录，meta 记录采集运行与观察 ID。",
        "transport_kind": transport["kind"],
        "transport_topic": transport["topic"],
        "transport_key": transport["message_key"],
        "payload_schema": transport["payload_schema"],
    }, actor="signal_contract")
    return graph.get_node(node["id"])


if __name__ == "__main__":
    source_contracts = SourceContractStore()
    signal_contracts = SignalContractStore(source_contracts)
    graph = GraphService(os.environ.get("DATA_LOGIC_DB"))
    node = seed(graph, source_contracts, signal_contracts)
    package = signal_contracts.package(graph, node["id"])
    print(node["id"], node["name"], package["implementation_readiness"])
