import { cardKind, kindLabel } from './cardModel';
import data from './cardPresentationData.json';
import sources from '../catalog/source-contracts.v1.json';

type Node = { name: string; type: string; kind?: string; reference_number?: number | null; is_system_state?: number; card_contract?: { config: { read_only?: boolean; definition_refs?: {path: string}[] } } | null };
const labels: Record<string, [string, string]> = {
  base:['基础资料','Core records'], config:['规则配置','Configuration'], history:['历史流水','History'],
  current:['当前结果','Current results'], board:['榜单结果','Leaderboard'], content:['内容资料','Content'], coverage:['采集覆盖','Coverage'],
  filter:['筛选匹配','Filtering / matching'], identity:['资产建档','Asset records'], ai_check:['AI 核查','AI checks'],
  score:['评分汇总','Scoring'], sync:['归档同步','Archiving / delivery'], signal:['信号生成','Signal generation'],
  board_build:['榜单生成','Leaderboard generation'], generate:['内容生成','Content generation'], save:['验证保存','Validation / storage'],
  metric:['指标计算','Metrics'], reshape:['字段整理','Field preparation'], automatic:['自动规则','Automatic rules'], human:['人工审核','Human review'],
  score_event:['评分事件','Score events'], social:['社交消息','Social messages'], market:['行情消息','Market messages'],
  signal_message:['信号消息','Signal messages'], indicator:['指标消息','Indicator messages'], window:['近期评分窗口','Recent score window'],
  score_page:['资产得分','Asset scores'], review_page:['纠错审核','Correction review'], home_page:['榜单与信号','Boards / signals'],
  api:['接口采集','API collection'], mcp:['MCP 操作','MCP operation'], resource:['参考资源','Reference resource'],
  feed:['订阅消息','Feed messages'], page:['页面采集','Page collection'], pending:['用途待确认','Purpose unconfirmed'],
};
const origins: Record<string,[string,string]> = {
  coingecko:['CoinGecko','CoinGecko'], kaito:['Kaito','Kaito'], binance:['Binance','Binance'], dexscreener:['DexScreener','DexScreener'],
  rss:['RSS 订阅','RSS feeds'], telegram:['Telegram','Telegram'], taoli:['Taoli','Taoli'],
  collection_meta:['内部采集记录','Internal collection metadata'],
  internal_data:['内部资料','Internal records'], internal_config:['内部配置','Internal configuration'],
  internal_compute:['内部计算','Internal computation'], multi:['多来源汇合','Multiple origins'], pending:['来源待确认','Origin unconfirmed'],
};
const tones: Record<string,string> = {
  base:'light', config:'light', content:'light', coverage:'light', history:'medium', current:'medium', board:'deep',
  reshape:'light', metric:'light', filter:'light', ai_check:'light', score:'medium', signal:'medium', board_build:'medium',
  identity:'deep', sync:'deep', generate:'deep', save:'deep',
};
const providers: Record<string,string> = {'binance-futures':'binance',kaito:'kaito',coingecko:'coingecko',dexscreener:'dexscreener',
  'crypto-rss-collector':'rss',rss:'rss',taoli:'taoli','telegram-bot':'telegram','telegram-telethon':'telegram','tg-spider':'telegram','tg-spider-telethon':'telegram'};
const entries = data as Record<string,{kind:string;subtype:string;origin:string;definition_paths:string[]}>;
const localize = (pair: [string,string], language: string) => pair[language === 'zh-CN' ? 0 : 1];

// Display metadata only. Names, current kind and module references must match;
// historical numbers and graph reachability never establish an origin or execution kind.
export function cardPresentation(node: Node, language: string) {
  const kind = cardKind(node);
  const operation = kind === 'source' ? sources.operations.find(item => item.id === node.name) : undefined;
  const resource = kind === 'source' ? sources.resources.find(item => item.id === node.name) : undefined;
  const entry = entries[node.name];
  const accepted = !node.card_contract?.config.read_only && entry?.kind === kind &&
    (entry.definition_paths.length === 0 || node.card_contract?.config.definition_refs?.some(ref => entry.definition_paths.includes(ref.path)));
  let subtype = accepted ? entry.subtype : 'pending';
  let origin = accepted ? entry.origin : 'pending';
  if (operation || resource) {
    origin = providers[(operation || resource)!.source_id] || 'pending';
    subtype = resource ? 'resource' : node.name.startsWith('kaito.mcp.') ? 'mcp' : origin === 'rss' || origin === 'telegram' ? 'feed' : origin === 'taoli' ? 'page' : 'api';
  }
  const subtypeLabel = localize(labels[subtype] || labels.pending!,language);
  const originLabel = localize(origins[origin] || origins.pending!,language);
  return {kind,subtype,origin,tone:tones[subtype] || 'medium',subtypeLabel,originLabel,
    label:`${kindLabel(kind,language)} · ${subtypeLabel}`,
    originText:`${language === 'zh-CN' ? '来源' : 'Origin'}：${originLabel}`};
}
