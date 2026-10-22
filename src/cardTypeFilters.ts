import heatHistory from '../catalog/hottest-history.v1.json';
import { cardKind, cardKinds, kindLabel } from './cardModel';
import definitions from './cardPresentationData.json';
import sources from '../catalog/source-contracts.v1.json';
import stocks from '../catalog/coingecko-stocks.v1.json';

type Node = { id: string; name: string; type: string; kind?: string; reference_number?: number | null; is_system_state?: number; card_contract?: {config: {definition_refs?: {path: string}[]; read_only?: boolean}} | null };
type Choice = {id:string;label:string;count:number;tone:string};
export type CardTypeGroup = Choice & {style:string;children:Choice[]};
const purposes: Record<string,[string,string]> = {
  'source/stocks':['CoinGecko 股票数据','CoinGecko Stocks data'],
  'table/stocks':['Stocks 目录、历史与覆盖','Stocks directory, history and coverage'],
  'process/stocks':['Stocks 采集与适配','Stocks collection and adapters'],
  'source/coingecko':['CoinGecko 数据','CoinGecko data'], 'source/kaito-mcp':['Kaito MCP 数据','Kaito MCP data'],
  'source/kaito-resource':['Kaito 参考目录','Kaito reference lists'], 'source/binance':['Binance 数据','Binance data'],
  'source/dexscreener':['DexScreener 数据','DexScreener data'], 'source/rss':['RSS 新闻','RSS news'],
  'source/telegram':['Telegram 消息','Telegram messages'], 'source/taoli':['Taoli 页面数据','Taoli page data'],
  'table/board-history':['榜单历史结果','Leaderboard result history'], 'process/board-history':['榜单消费与历史查询','Board delivery and history queries'], 'channel/board-history':['榜单结果消息','Leaderboard result messages'],
  'table/base':['公共基础资料表','Shared core tables'], 'table/config':['公共规则配置表','Shared configuration tables'],
  'table/coingecko-history':['CoinGecko 行情历史表','CoinGecko market history'], 'table/history':['评分历史流水表','Score history tables'],
  'table/current':['当前评分结果表','Current score tables'], 'table/board':['榜单结果表','Leaderboard tables'],
  'table/content':['内容资料表','Content tables'], 'table/coverage':['采集覆盖记录表','Collection coverage tables'],
  'process/cg-metrics':['CoinGecko 指标处理','CoinGecko metrics'], 'process/cg-signals':['CoinGecko 信号处理','CoinGecko signals'],
  'process/cg-score':['CoinGecko 评分处理','CoinGecko scoring'], 'process/cg-identity':['CoinGecko 筛选与建档','CoinGecko filtering / identity'],
  'process/cg-delivery':['CoinGecko 归档与发布','CoinGecko archive / delivery'],
  'process/public-score':['公共评分处理','Shared scoring'], 'process/public-identity':['公共资产处理','Shared asset processing'],
  'process/public-delivery':['公共归档与同步','Shared archive / sync'], 'process/content':['内容筛选与生成','Content selection / generation'],
  'process/ai-check':['AI 资产核查','AI asset checks'], 'process/board':['榜单生成处理','Leaderboard generation'],
  'decision/automatic':['自动规则判断','Automatic decisions'], 'decision/human':['人工审核判断','Human review'],
  'channel/market':['CoinGecko 行情消息','CoinGecko market messages'], 'channel/indicator':['CoinGecko 指标消息','CoinGecko indicator messages'],
  'channel/signal':['CoinGecko 信号消息','CoinGecko signal messages'], 'channel/social':['CoinGecko 热榜消息','CoinGecko trending messages'], 'channel/kaito':['Kaito 关注消息','Kaito following messages'],
  'channel/score':['公共评分事件','Shared score events'], 'state/window':['公共评分窗口','Shared score window'], 'state/warming_candidates':['CoinGecko 升温候选','CoinGecko warming candidates'], 'state/heat':['CoinGecko 最热候选','CoinGecko heat candidates'],
  'interface/score':['资产得分界面','Asset scores UI'], 'interface/review':['资产审核界面','Asset review UI'],
  'interface/home':['榜单与信号界面','Boards / signals UI'],
};
const entries=definitions as Record<string,{kind:string;subtype:string;origin:string;definition_paths:string[]}>;
const providers: Record<string,string>={'binance-futures':'binance',coingecko:'coingecko',kaito:'kaito',dexscreener:'dexscreener',rss:'rss',taoli:'taoli','telegram-bot':'telegram','telegram-telethon':'telegram'};

// Navigation only: explicit module identity, never numbering or transitive graph inference.
export function cardTypeKey(node: Node): string {
  const kind=cardKind(node);
  if (heatHistory.cards.some(card => card.name === node.name && card.kind === kind) &&
      node.card_contract?.config.definition_refs?.some(ref => ref.path === 'catalog/hottest-history.v1.json')) return `${kind}/board-history`;
  if (stocks.cards.some(card => card.name === node.name && card.kind === kind) &&
      node.card_contract?.config.definition_refs?.some(ref => ref.path === 'catalog/coingecko-stocks.v1.json')) return `${kind}/stocks`;
  if (kind==='source') {
    const source=sources.operations.find(item=>item.id===node.name) || sources.resources.find(item=>item.id===node.name);
    const provider=source && providers[source.source_id];
    return `source/${provider==='kaito' ? node.name.startsWith('kaito.resource.') ? 'kaito-resource' : 'kaito-mcp' : provider || 'unknown'}`;
  }
  const entry=entries[node.name];
  if (!entry || entry.kind!==kind || node.card_contract?.config.read_only ||
    (entry.definition_paths.length && !node.card_contract?.config.definition_refs?.some(ref=>entry.definition_paths.includes(ref.path)))) return `${kind}/unknown`;
  const sub=entry.subtype;
  if (kind==='table') return `table/${node.name==='coingecko_market_history' ? 'coingecko-history' : sub}`;
  if (kind==='process') {
    if (entry.origin==='coingecko') return `process/${({metric:'cg-metrics',reshape:'cg-metrics',signal:'cg-signals',score:'cg-score',filter:'cg-identity',identity:'cg-identity',sync:'cg-delivery'} as Record<string,string>)[sub] || 'unknown'}`;
    return `process/${({score:'public-score',identity:'public-identity',sync:'public-delivery',filter:node.name==='已有 X 账号资产结果'?'public-identity':'content',generate:'content',save:'content',ai_check:'ai-check',board_build:'board'} as Record<string,string>)[sub] || 'unknown'}`;
  }
  if (kind==='channel') return `channel/${entry.origin==='coingecko'?({market:'market',indicator:'indicator',signal_message:'signal',social:'social'} as Record<string,string>)[sub] || 'unknown':entry.origin==='kaito'?'kaito':sub==='score_event'?'score':'unknown'}`;
  if (kind==='interface') return `interface/${({score_page:'score',review_page:'review',home_page:'home'} as Record<string,string>)[sub] || 'unknown'}`;
  return `${kind}/${sub}`;
}
export function matchesCardType(node: Node, selected: string): boolean {
  return selected==='All types' || (selected==='unknown' && !cardKinds.some(item=>item.id===cardKind(node))) || selected===cardKind(node) || selected===cardTypeKey(node);
}
export function cardTypeGroups(nodes: Node[], language: string): CardTypeGroup[] {
  const zh=language==='zh-CN';
  const unique=[...new Map(nodes.map(node=>[node.id,node])).values()];
  const order=['source','table','process','decision','channel','state','interface'];
  if(unique.some(node=>!order.includes(cardKind(node))))order.push('unknown');
  return order.map(kind=>{
    const members=unique.filter(node=>kind==='unknown'?!cardKinds.some(item=>item.id===cardKind(node)):cardKind(node)===kind);
    const counts=new Map<string,number>();
    for(const node of members){const key=cardTypeKey(node);counts.set(key,(counts.get(key)||0)+1);}
    const ordered=[...Object.keys(purposes).filter(key=>counts.has(key)),...Array.from(counts.keys()).filter(key=>!purposes[key])];
    return {id:kind,label:kindLabel(kind,language),count:members.length,tone:'medium',style:cardKinds.find(item=>item.id===kind)?.style || 'raw',
      children:ordered.map((id,index)=>({id,label:purposes[id]?.[zh?0:1] || (zh?'待分类':'Unclassified'),count:counts.get(id)!,tone:['light','medium','deep'][index%3]!}))};
  });
}
