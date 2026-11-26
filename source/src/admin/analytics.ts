import type {Environment} from '../account/http.js';
import {boundedJson} from '../account/http.js';
import type {ReadyPersistenceConfiguration} from '../persistence/contracts.js';

export const RANGES = ['24h','7d','30d','90d','all'] as const;
export type Range = typeof RANGES[number];
const DAY = 86_400_000;
const LIMITS: Record<Exclude<Range,'all'>,number> = {'24h':DAY,'7d':7*DAY,'30d':30*DAY,'90d':90*DAY};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export function adminIds(env:Environment):ReadonlySet<string>{
 const ids=(env.DLKT_INFO_ADMIN_USER_IDS??'').split(',').map(s=>s.trim().toLowerCase());
 return env.DLKT_INFO_ADMIN_ENABLED==='1'&&ids.length<=20&&ids.every(id=>UUID.test(id))?new Set(ids):new Set();
}
export function parseRange(value:string|null):Range|null{
 return value===null?'7d':RANGES.includes(value as Range)?value as Range:null;
}
export function rangeStart(range:Range,now:Date):string|null{
 return range==='all'?null:new Date(now.getTime()-LIMITS[range]).toISOString();
}
function record(v:unknown):Record<string,unknown>|null{
 return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
}
function count(v:unknown):number|null{
 return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
}
export interface Totals{visitors:number;pageviews:number}
export interface Row{label:string;visitors:number;pageviews:number}
export type Dimension='day'|'country'|'referrerHostname'|'requestPath'|'deviceType';
export function parseTotals(value:unknown):Totals|null{
 const data=record(record(value)?.data);
 const visitors=count(data?.visitors),pageviews=count(data?.pageviews);
 return visitors===null||pageviews===null?null:{visitors,pageviews};
}
export function parseRows(value:unknown,dimension:Dimension):Row[]|null{
 const data=record(value)?.data;
 if(!Array.isArray(data)||data.length>100)return null;
 const rows:Row[]=[];
 for(const raw of data){
  const r=record(raw);if(!r)return null;
  const v=count(r.visitors),p=count(r.pageviews);
  const label=dimension==='day'?r.timestamp:r[dimension];
  if(v===null||p===null||typeof label!=='string'||label.length>250)return null;
  if(dimension==='day'&&!Number.isFinite(Date.parse(label)))return null;
  rows.push({label:label||'(unknown)',visitors:v,pageviews:p});
 }
 return rows.sort((a,b)=>dimension==='day'?Date.parse(a.label)-Date.parse(b.label):b.pageviews-a.pageviews);
}
export function parseContentRange(value:string|null):number|null{
 const match=/^(?:\d+-\d+|\*)\/(\d+)$/u.exec(value??'');
 return match?count(Number(match[1])):null;
}
async function profileCount(config:ReadyPersistenceConfiguration,env:Environment,request:typeof fetch,since:string|null):Promise<number|null>{
 const key=env.DLKT_INFO_SUPABASE_SECRET_KEY;
 if(!key||!/^sb_secret_[A-Za-z0-9_-]{20,240}$/u.test(key))return null;
 const u=new URL('/rest/v1/dlkt_info_profiles',config.url);
 u.searchParams.set('select','id');
 if(since)u.searchParams.set('created_at','gte.'+since);
 try{
  const response=await request(u,{method:'HEAD',headers:{apikey:key,Prefer:'count=exact',Range:'0-0'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});
  return response.ok?parseContentRange(response.headers.get('content-range')):null;
 }catch{return null;}
}
const PROJECT='prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P';
const TEAM='team_ohj6PflzAec8005UK4uiAqFw';
function audienceStart(env:Environment,now:Date):string|null{
 const s=env.DLKT_INFO_ANALYTICS_SINCE;
 if(!s||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(s))return null;
 const n=Date.parse(s);
 return Number.isFinite(n)&&n<=now.getTime()?new Date(n).toISOString():null;
}
async function audienceQuery(env:Environment,request:typeof fetch,since:string,until:string,dimension?:Dimension):Promise<unknown>{
 const token=env.DLKT_INFO_ANALYTICS_VERCEL_TOKEN;
 if(!token)return null;
 const u=new URL('https://api.vercel.com/v1/query/web-analytics/visits/'+(dimension?'aggregate':'count'));
 for(const [k,v] of Object.entries({projectId:PROJECT,teamId:TEAM,since,until,filter:"environment eq 'production'"}))u.searchParams.set(k,v);
 if(dimension){u.searchParams.set('by',dimension);u.searchParams.set('limit','100');}
 try{
  const res=await request(u,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok){await res.body?.cancel();return null;}
  return await boundedJson(res,128_000);
 }catch{return null;}
}
export interface Analytics{
 range:Range;asOf:string;profiles:number|null;newProfiles:number|null;
 audienceSince:string|null;audienceEnabled:boolean;totals:Totals|null;recent:Totals|null;
 daily:Row[]|null;countries:Row[]|null;referrers:Row[]|null;pages:Row[]|null;devices:Row[]|null;
}
export async function readAnalytics(config:ReadyPersistenceConfiguration,env:Environment,range:Range,request:typeof fetch=fetch,now:Date=new Date()):Promise<Analytics>{
 const since=rangeStart(range,now),asOf=now.toISOString();
 const activation=audienceStart(env,now);
 const audienceEnabled=env.DLKT_INFO_ANALYTICS_READ_ENABLED==='1'&&Boolean(env.DLKT_INFO_ANALYTICS_VERCEL_TOKEN)&&activation!==null;
 const audienceSince=audienceEnabled&&activation?(since&&since>activation?since:activation):null;
 const totals=(start:string|null)=>start?audienceQuery(env,request,start,asOf).then(parseTotals):Promise.resolve(null);
 const rows=(dimension:Dimension)=>audienceSince?audienceQuery(env,request,audienceSince,asOf,dimension).then(v=>parseRows(v,dimension)):Promise.resolve(null);
 const last30=new Date(now.getTime()-30*60_000).toISOString();
 const [profiles,newProfiles,traffic,recent,daily,countries,referrers,pages,devices]=await Promise.all([
  profileCount(config,env,request,null),
  since?profileCount(config,env,request,since):Promise.resolve(null),
  totals(audienceSince),
  totals(audienceEnabled&&activation?(activation>last30?activation:last30):null),
  rows('day'),rows('country'),rows('referrerHostname'),rows('requestPath'),rows('deviceType')
 ]);
 return {range,asOf,profiles,newProfiles:since?newProfiles:profiles,audienceSince,audienceEnabled,totals:traffic,recent,daily,countries,referrers,pages,devices};
}
