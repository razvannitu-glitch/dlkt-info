import type {Environment} from '../account/http.js';
import {boundedJson} from '../account/http.js';
import {isUuid} from '../data/guards.js';
import type {ReadyPersistenceConfiguration} from '../persistence/contracts.js';
import {audienceStorageConfig,SupabaseAudienceStore,type AudienceSnapshot,type AudienceHours} from '../audience/storage.js';

import {PROFILE_COUNT_FUNCTION,parseProfileCounts,rangeStart,parseContentRange,type ProfileCounts,type Range} from './profile-count-edge.js';
export {RANGES,parseRange,rangeStart,parseContentRange,type Range} from './profile-count-edge.js';
export function adminIds(env:Environment):ReadonlySet<string>{
 const ids=(env.DLKT_INFO_ADMIN_USER_IDS??'').split(',').map(s=>s.trim().toLowerCase());
 return env.DLKT_INFO_ADMIN_ENABLED==='1'&&ids.length<=20&&ids.every(isUuid)?new Set(ids):new Set();
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
async function profileCounts(config:ReadyPersistenceConfiguration,env:Environment,request:typeof fetch,range:Range,since:string|null,accessToken?:string):Promise<ProfileCounts>{
 if(env.DLKT_INFO_ADMIN_PROFILE_EDGE_ENABLED==='1'){
  if(!accessToken)return {profiles:null,newProfiles:null};
  try{
   const url=new URL('/functions/v1/'+PROFILE_COUNT_FUNCTION,config.url);
   url.searchParams.set('range',range);
   const res=await request(url,{headers:{apikey:config.publishableKey,Authorization:'Bearer '+accessToken,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20_000)});
   if(!res.ok){await res.body?.cancel();return {profiles:null,newProfiles:null};}
   return parseProfileCounts(await boundedJson(res,4096),range)??{profiles:null,newProfiles:null};
  }catch{return {profiles:null,newProfiles:null};}
 }
 const [profiles,selected]=await Promise.all([profileCount(config,env,request,null),since?profileCount(config,env,request,since):Promise.resolve(null)]);
 return {profiles,newProfiles:since?selected:profiles};
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
export type FirstPartyAudience={status:'disabled'|'unavailable'}|{status:'ready';snapshot:AudienceSnapshot;coverageSince:string};
const AUDIENCE_HOURS:Record<Range,AudienceHours>={'24h':24,'7d':168,'30d':720,'90d':2160,all:null};
async function readFirstParty(env:Environment,range:Range,request:typeof fetch,now:Date):Promise<FirstPartyAudience>{
 if(env.DLKT_INFO_AUDIENCE_READ_ENABLED!=='1')return {status:'disabled'};
 const storage=audienceStorageConfig(env),activated=env.DLKT_INFO_AUDIENCE_ACTIVATED_AT;
 if(!storage||env.DLKT_INFO_AUDIENCE_RETENTION_READY!=='1'||!activated||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(activated)||!Number.isFinite(Date.parse(activated))||Date.parse(activated)>now.getTime())return {status:'unavailable'};
 try{
  const snapshot=await new SupabaseAudienceStore(storage,request,()=>now).snapshot(AUDIENCE_HOURS[range]);
  return {status:'ready',snapshot,coverageSince:new Date(Math.max(Date.parse(activated),Date.parse(snapshot.since))).toISOString()};
 }catch{return {status:'unavailable'};}
}
export interface Analytics{
 range:Range;asOf:string;profiles:number|null;newProfiles:number|null;
 firstParty:FirstPartyAudience;
 audienceSince:string|null;audienceEnabled:boolean;totals:Totals|null;recent:Totals|null;
 daily:Row[]|null;countries:Row[]|null;referrers:Row[]|null;pages:Row[]|null;devices:Row[]|null;
}
export async function readAnalytics(config:ReadyPersistenceConfiguration,env:Environment,range:Range,request:typeof fetch=fetch,now:Date=new Date(),accessToken?:string):Promise<Analytics>{
 const since=rangeStart(range,now),asOf=now.toISOString();
 const firstPartyPromise=readFirstParty(env,range,request,now);
 const activation=env.DLKT_INFO_AUDIENCE_READ_ENABLED==='1'?null:audienceStart(env,now);
 const audienceEnabled=env.DLKT_INFO_ANALYTICS_READ_ENABLED==='1'&&Boolean(env.DLKT_INFO_ANALYTICS_VERCEL_TOKEN)&&activation!==null;
 const audienceSince=audienceEnabled&&activation?(since&&since>activation?since:activation):null;
 const totals=(start:string|null)=>start?audienceQuery(env,request,start,asOf).then(parseTotals):Promise.resolve(null);
 const rows=(dimension:Dimension)=>audienceSince?audienceQuery(env,request,audienceSince,asOf,dimension).then(v=>parseRows(v,dimension)):Promise.resolve(null);
 const last30=new Date(now.getTime()-30*60_000).toISOString();
 const [firstParty,profile,traffic,recent,daily,countries,referrers,pages,devices]=await Promise.all([
  firstPartyPromise,
  profileCounts(config,env,request,range,since,accessToken),
  totals(audienceSince),
  totals(audienceEnabled&&activation?(activation>last30?activation:last30):null),
  rows('day'),rows('country'),rows('referrerHostname'),rows('requestPath'),rows('deviceType')
 ]);
 return {range,asOf,...profile,firstParty,audienceSince,audienceEnabled,totals:traffic,recent,daily,countries,referrers,pages,devices};
}
