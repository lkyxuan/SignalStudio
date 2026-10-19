// SS-118/119: presentation membership, never a new node or execution contract.
import { cardKind } from './cardModel';
import type { GraphNode } from './contracts';
export type FeatureStep = { id: string; zh: string; en: string; nodes: GraphNode[] };
export type Feature = FeatureStep & { steps: FeatureStep[] };
type Spec = { id: string; zh: string; en: string; steps: { id: string; zh: string; en: string; names: string[] }[] };
export const FEATURE_SPECS: Spec[] = [
  {
    "id": "market",
    "zh": "市场发现与提醒",
    "en": "Market discovery and alerts",
    "steps": [
      {
        "id": "data",
        "zh": "行情与历史",
        "en": "Market data and history",
        "names": [
          "coingecko.coins_markets",
          "leaderboard_coverage",
          "Few Understand · market.snapshot",
          "归档 CoinGecko 行情",
          "coingecko_market_history"
        ]
      },
      {
        "id": "metrics",
        "zh": "计算行情指标",
        "en": "Market indicators",
        "names": [
          "Polars · 计算 CoinGecko 量价指标",
          "Polars · 整理24h涨跌幅",
          "Polars · 整理ATH百分比",
          "Polars · 计算成交额市值比",
          "Polars · 计算绝对24h涨跌幅",
          "Polars · 计算相对昨日放量倍数",
          "Polars · 汇总指标并发布",
          "Polars · 计算7日成交额基线",
          "Polars · 计算7日相对放量RVOL",
          "Few Understand · indicator.data"
        ]
      },
      {
        "id": "hottest",
        "zh": "交易最热榜",
        "en": "Hottest board",
        "names": [
          "CoinGecko · 最热榜候选快照",
          "生成基础最热榜",
          "leaderboard_hottest"
        ]
      },
      {
        "id": "warming",
        "zh": "交易升温榜",
        "en": "Warming board",
        "names": [
          "CoinGecko · 升温候选快照",
          "CoinGecko · 计算升温日冻结基准",
          "生成基础升温榜",
          "leaderboard_warming"
        ]
      },
      {
        "id": "discovery",
        "zh": "新资产榜与信号",
        "en": "New assets",
        "names": [
          "CoinGecko · 首次收录新资产",
          "生成最新UUID榜",
          "leaderboard_new_uuid"
        ]
      },
      {
        "id": "alerts",
        "zh": "异动提醒",
        "en": "Market alerts",
        "names": [
          "CoinGecko · 24 小时大涨",
          "CoinGecko · 24 小时大跌",
          "CoinGecko · 成交量市值比偏高",
          "CoinGecko · 接近历史高点",
          "CoinGecko · 较历史高点深度回撤",
          "Few Understand · signal.data"
        ]
      },
      {
        "id": "home",
        "zh": "首页展示",
        "en": "Home page",
        "names": [
          "榜单与信号首页"
        ]
      }
    ]
  },
  {
    "id": "identity",
    "zh": "资产识别与维护",
    "en": "Asset identity and maintenance",
    "steps": [
      {
        "id": "kaito",
        "zh": "关注账号入口",
        "en": "Account discovery",
        "names": [
          "kaito.mcp.kaito_smart_following_market",
          "Kaito 新关注账号 Topic"
        ]
      },
      {
        "id": "lookup",
        "zh": "识别已有资产",
        "en": "Resolve existing assets",
        "names": [
          "assets",
          "asset_identifiers",
          "市场账号查询内部资产",
          "已有 X 账号资产结果"
        ]
      },
      {
        "id": "create",
        "zh": "建立与核实资产",
        "en": "Create and verify assets",
        "names": [
          "新账号建立待识别资产",
          "CoinGecko · 筛选无UUID资产",
          "CoinGecko · 核实并建档"
        ]
      },
      {
        "id": "relations",
        "zh": "关系与监控规则",
        "en": "Relations and monitoring",
        "names": [
          "asset_relationships",
          "asset_monitoring_rules"
        ]
      },
      {
        "id": "review",
        "zh": "审核与执行纠错",
        "en": "Review and correct",
        "names": [
          "定期 AI 检查资产地图",
          "人工审核资产纠错建议",
          "执行获批资产纠错",
          "资产纠错审核页面"
        ]
      }
    ]
  },
  {
    "id": "scores",
    "zh": "资产评分与规则",
    "en": "Asset scoring and rules",
    "steps": [
      {
        "id": "initial",
        "zh": "确定起始评分",
        "en": "Initial scores",
        "names": [
          "确定资产起始评分",
          "asset_initial_score_sources"
        ]
      },
      {
        "id": "events",
        "zh": "评分事件与缓存",
        "en": "Score events and cache",
        "names": [
          "提交评分事件",
          "评分事件 Topic",
          "维护近期评分窗口",
          "Redis 近期评分窗口"
        ]
      },
      {
        "id": "rollup",
        "zh": "当前评分与衰减",
        "en": "Current score and decay",
        "names": [
          "计算当前资产评分",
          "asset_scores_current"
        ]
      },
      {
        "id": "archive",
        "zh": "评分归档",
        "en": "Score archive",
        "names": [
          "归档评分流水",
          "asset_score_events"
        ]
      },
      {
        "id": "market",
        "zh": "量价评分",
        "en": "Market scoring",
        "names": [
          "量价评分 · 生成贡献",
          "量价评分 · 汇总Redis记分",
          "market_scores_current",
          "market_score_history"
        ]
      },
      {
        "id": "attention",
        "zh": "热榜关注贡献",
        "en": "Trending contributions",
        "names": [
          "coingecko.search_trending",
          "Few Understand · social.data",
          "CoinGecko · 热榜上榜加分"
        ]
      },
      {
        "id": "weights",
        "zh": "权重规则与版本",
        "en": "Weights and versions",
        "names": [
          "weight_topics",
          "weight_rules_current",
          "weight_rule_versions",
          "weight_evaluations"
        ]
      },
      {
        "id": "page",
        "zh": "同步与得分页面",
        "en": "Sync and score page",
        "names": [
          "同步资产得分到 Supabase",
          "supabase_asset_scores",
          "资产得分页面"
        ]
      }
    ]
  },
  {
    "id": "webpage",
    "zh": "资产网页制作",
    "en": "Asset webpage preparation",
    "steps": [
      {
        "id": "candidates",
        "zh": "筛选候选资产",
        "en": "Select candidates",
        "names": [
          "候选代币筛选"
        ]
      },
      {
        "id": "refresh",
        "zh": "判断是否更新",
        "en": "Check page freshness",
        "names": [
          "刷新判断",
          "asset_pages"
        ]
      },
      {
        "id": "materials",
        "zh": "准备网页资料",
        "en": "Prepare page materials",
        "names": [
          "读取已有资料",
          "判断资料缺口",
          "搜索补缺",
          "搜索资料暂存",
          "组装生成资料"
        ]
      }
      , {"id":"writer","zh":"制作或更新网页","en":"Create or update the webpage","names":["Grokbot · 身份核验", "Grokbot · 盘点 FU 已有资料", "Grokbot · 判定研究重点", "Grokbot · 寻找数据来源", "Grokbot · 抓取并留存证据", "Grokbot · 处理冲突、过期与未知", "Grokbot · 组装页面", "Grokbot · 自检", "Grokbot · 保存并回写"]}
    ]
  },
  {
    "id": "reading",
    "zh": "值得读与中文阅读",
    "en": "Worth Reading",
    "steps": [
      {
        "id": "content",
        "zh": "原文与正文",
        "en": "Source content",
        "names": [
          "content.items",
          "content.bodies"
        ]
      },
      {
        "id": "versions",
        "zh": "摘要与正文指纹",
        "en": "Content fingerprints",
        "names": [
          "值得读 · 摘要指纹",
          "值得读 · 正文指纹"
        ]
      },
      {
        "id": "translation",
        "zh": "中文翻译",
        "en": "Chinese translation",
        "names": [
          "值得读 · 摘要翻译",
          "值得读 · 正文翻译",
          "content.translator_usage",
          "content.translations"
        ]
      },
      {
        "id": "sync",
        "zh": "译文同步",
        "en": "Translation sync",
        "names": [
          "值得读 · 译文同步",
          "app_worth_reading",
          "app_worth_reading_bodies",
          "app_worth_reading_translations"
        ]
      },
      {
        "id": "page",
        "zh": "中文阅读界面",
        "en": "Reading interface",
        "names": [
          "值得读 · 中文阅读界面"
        ]
      }
    ]
  },
  {
    "id": "interpret",
    "zh": "通用文本解读",
    "en": "Text interpretation",
    "steps": [
      {
        "id": "prepare",
        "zh": "准备原文",
        "en": "Prepare text",
        "names": [
          "文本解读 · 原文准备",
          "文本解读 · 任务与版本"
        ]
      },
      {
        "id": "research",
        "zh": "查找背景与依据",
        "en": "Background research",
        "names": [
          "文本解读 · 联网背景",
          "文本解读 · 资料与核查依据"
        ]
      },
      {
        "id": "interpret",
        "zh": "深度解读",
        "en": "Interpret text",
        "names": [
          "文本解读 · 深度解读"
        ]
      },
      {
        "id": "verify",
        "zh": "独立核查",
        "en": "Independent verification",
        "names": [
          "文本解读 · 独立核查"
        ]
      },
      {
        "id": "result",
        "zh": "修订与展示结果",
        "en": "Revise and present",
        "names": [
          "文本解读 · 修订汇总",
          "文本解读 · 最终结果",
          "文本解读 · 通用展示组件"
        ]
      }
    ]
  }
];

export function buildFeatureTree(nodes: GraphNode[]): Feature[] {
  const assigned = new Set<string>();
  const features = FEATURE_SPECS.map(spec => {
    const steps = spec.steps.map(step => {
      const members = nodes.filter(n => step.names.includes(n.name) && !assigned.has(n.id));
      members.forEach(n => assigned.add(n.id));
      return { ...step, nodes: members };
    });
    return { ...spec, steps, nodes: steps.flatMap(s => s.nodes) };
  });
  const buckets = new Map<string, GraphNode[]>();
  for (const node of nodes) if (!assigned.has(node.id)) {
    const key = cardKind(node) === 'source' ? node.name.split('.')[0]! : 'other';
    buckets.set(key, [...(buckets.get(key) || []), node]);
  }
  const steps = [...buckets].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => ({
    id: key, zh: key === 'other' ? '其他卡片 · 待归类' : `${key} 来源与参考`,
    en: key === 'other' ? 'Other cards · unclassified' : `${key} sources and references`, nodes: members,
  }));
  return [...features, { id: 'library', zh: '共用资源库', en: 'Shared resource library', steps, nodes: steps.flatMap(s => s.nodes) }];
}

export function featureLocation(tree: Feature[], nodeId: string) {
  for (const feature of tree) for (const step of feature.steps) if (step.nodes.some(n => n.id === nodeId))
    return { featureId: feature.id, stepId: step.id };
  return null;
}

// Lookup once per graph/language instead of scanning every field for each node
// on every inspector keystroke. Complete logical graph remains searchable.
export function graphSearchIndex(nodes: GraphNode[], fields: {node_id:string; name:string; definition?:string | null}[], requirements: {node_id:string; name:string; purpose?:string | null}[], label: (name:string)=>string) {
  const index = new Map(nodes.map(n => [n.id, `#${n.reference_number} ${n.name} ${label(n.name)} ${n.definition || ''} ${n.decision_question || ''} ${n.trigger_rule || ''} ${n.type || ''}`]));
  for (const field of fields) index.set(field.node_id, `${index.get(field.node_id) || ''} ${field.name} ${field.definition || ''}`);
  for (const need of requirements) index.set(need.node_id, `${index.get(need.node_id) || ''} ${need.name} ${need.purpose || ''}`);
  return new Map([...index].map(([id, text]) => [id, text.toLowerCase()]));
}

export function scopeGraph<N extends {data?: {id?:string}; id:string}, E extends {id:string; source?:string; target?:string}>(nodes:N[], edges:E[], ids:Set<string>) {
  const members = nodes.filter(n => ids.has(n.data?.id || n.id));
  const renderedIds = new Set(members.map(n => n.id));
  const internal = edges.filter(e => renderedIds.has(e.source!) && renderedIds.has(e.target!));
  const connected = new Set(internal.flatMap(e => [e.source!, e.target!]));
  const connectedLogical = new Set(members.filter(n => connected.has(n.id)).map(n => n.data?.id || n.id));
  const fallback = new Map<string, N>();
  for (const node of members) {
    const logical = node.data?.id || node.id;
    if (!fallback.has(logical) || node.id === logical) fallback.set(logical, node);
  }
  // A far-away shared occurrence with no internal edge must not shrink the
  // useful local route. Keep every internal endpoint; otherwise one original
  // occurrence per logical card, with its unchanged ID and saved position.
  const scoped = members.filter(n => connected.has(n.id) ||
    (!connectedLogical.has(n.data?.id || n.id) && fallback.get(n.data?.id || n.id) === n));
  return { nodes: scoped, edges: internal };
}
