import {NEWS_TAXONOMY_VERSION,type NewsCategoryId} from '../iceo/news-taxonomy.js';

/**
 * Offline aggregate contract only. This module has no producer, storage, route,
 * consent grant or recommendation authority. Coverage is asserted by an input
 * provider; a valid shape is NOT proof of provenance or permission to collect.
 */
export const EDITORIAL_AGGREGATE_VERSION='dlkt-editorial-aggregate-1' as const;
export const EDITORIAL_AGGREGATE_SCOPE='public-home-opt-in' as const;
// Proposed laboratory subset, NOT an approved production privacy allowlist.
export const EDITORIAL_PILOT_CATEGORIES=Object.freeze([
 '05000000','06000000','13000000','15000000','17000000',
] as const satisfies readonly NewsCategoryId[]);
type PilotCategory=typeof EDITORIAL_PILOT_CATEGORIES[number];
// Conservative analytical display heuristic, not a privacy or significance threshold.
export const MIN_QUALIFIED_IMPRESSIONS=100;
const MAX_DAILY_IMPRESSIONS=1_000_000;
const DAY_MS=86_400_000;
const categoryIds:ReadonlySet<string>=new Set(EDITORIAL_PILOT_CATEGORIES);

type CategoryResult=
 | {readonly category: PilotCategory; readonly status:'no-impressions'|'small-sample'}
 | {readonly category: PilotCategory; readonly status:'descriptive'; readonly qualifiedImpressions:number; readonly attributableOpens:number; readonly openRate:number};
export type EditorialAggregateReport=
 | {readonly status:'unavailable'; readonly reason:'invalid-input'|'incomplete-coverage'|'window-not-complete'; readonly automationAllowed:false}
 | {readonly status:'ready'; readonly day:string; readonly activatedAt:string; readonly scope:typeof EDITORIAL_AGGREGATE_SCOPE; readonly taxonomyVersion:typeof NEWS_TAXONOMY_VERSION; readonly rows:readonly CategoryResult[]; readonly automationAllowed:false};

function record(value:unknown):Record<string,unknown>|null{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function exactKeys(value:Record<string,unknown>,keys:string):boolean{
 return Object.keys(value).sort().join(',')===keys;
}
function category(value:unknown):value is PilotCategory{
 return typeof value==='string'&&categoryIds.has(value);
}
function count(value:unknown):value is number{
 return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=MAX_DAILY_IMPRESSIONS;
}
function utcInstant(value:unknown):value is string{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
}
function utcDay(value:unknown):value is string{
 return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(value)&&utcInstant(value+'T00:00:00.000Z');
}
function unavailable(reason:Extract<EditorialAggregateReport,{status:'unavailable'}>['reason']):EditorialAggregateReport{
 return {status:'unavailable',reason,automationAllowed:false};
}

/**
 * Interpret a single completed UTC day, under one fixed measurement definition.
 * Each eligible row must be present, including explicit zero counts. Missing,
 * partial, mixed-version or contradictory input fails closed. Never rank,
 * estimate unconsented activity, infer individual interests or change the feed.
 */
export function describeEditorialAggregate(input:unknown,now:Date):EditorialAggregateReport{
 const data=record(input);
 if(!data||!exactKeys(data,'activatedAt,coverage,day,rows,scope,taxonomyVersion,version')
 ||data.version!==EDITORIAL_AGGREGATE_VERSION||data.scope!==EDITORIAL_AGGREGATE_SCOPE
 ||data.taxonomyVersion!==NEWS_TAXONOMY_VERSION||!utcDay(data.day)||!utcInstant(data.activatedAt)
 ||(data.coverage!=='complete'&&data.coverage!=='partial')||!Number.isFinite(now.getTime())
 ||!Array.isArray(data.rows)||data.rows.length!==EDITORIAL_PILOT_CATEGORIES.length)return unavailable('invalid-input');
 const day=data.day,activatedAt=data.activatedAt,start=Date.parse(day+'T00:00:00.000Z');
 const parsed=new Map<PilotCategory,CategoryResult>();
 for(const raw of data.rows){
  const row=record(raw);
  if(!row||!exactKeys(row,'attributableOpens,category,qualifiedImpressions')
  ||!category(row.category)||parsed.has(row.category)
  ||!count(row.qualifiedImpressions)||!count(row.attributableOpens)||row.attributableOpens>row.qualifiedImpressions)return unavailable('invalid-input');
  const id=row.category,impressions=row.qualifiedImpressions,opens=row.attributableOpens;
  const result:CategoryResult=impressions===0?{category:id,status:'no-impressions'}
   :impressions<MIN_QUALIFIED_IMPRESSIONS?{category:id,status:'small-sample'}
   :{category:id,status:'descriptive',qualifiedImpressions:impressions,attributableOpens:opens,openRate:opens/impressions};
  parsed.set(id,result);
 }
 if(data.coverage!=='complete'||Date.parse(activatedAt)>start)return unavailable('incomplete-coverage');
 if(start+DAY_MS>now.getTime())return unavailable('window-not-complete');
 const rows:CategoryResult[]=[];
 for(const id of EDITORIAL_PILOT_CATEGORIES){
  const row=parsed.get(id);
  if(!row)return unavailable('invalid-input');
  rows.push(row);
 }
 return {status:'ready',day,activatedAt,scope:EDITORIAL_AGGREGATE_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,rows,automationAllowed:false};
}
