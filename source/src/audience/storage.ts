import type {Environment} from '../account/http.js';
import {boundedJson} from '../account/http.js';
import {AUDIENCE_VERSION,SOURCES,type AudienceEvent,type ApproximateGeography,type TrafficSource} from './contracts.js';

export type AudienceHours=24|168|720|2160|null;
export interface AudienceBreakdown {readonly label:string;readonly visitors:number;readonly sessions:number}
export interface AudienceBucket {readonly timestamp:string;readonly pageviews:number;readonly sessionStarts:number}
export interface AudienceSnapshot {
 readonly version:typeof AUDIENCE_VERSION;
 readonly asOf:string;readonly since:string;readonly bucket:'hour'|'day';readonly retentionDays:90;
 readonly visitors:number;readonly sessionStarts:number;readonly pageviews:number;readonly repeatBrowsers:number;readonly active5m:number;
 readonly countries:readonly AudienceBreakdown[];readonly cities:readonly AudienceBreakdown[];
 readonly sources:readonly AudienceBreakdown[];readonly series:readonly AudienceBucket[];
}
export type AudienceWriteResult='accepted'|'duplicate'|'throttled'|'no-session'|'revoked';
export interface AudienceStore {
 snapshot(hours:AudienceHours):Promise<AudienceSnapshot>;
 record(browser:string,event:AudienceEvent,geo:ApproximateGeography):Promise<AudienceWriteResult>;
 forget(browser:string):Promise<void>;
}
export interface AudienceStorageConfig{readonly projectRef:string;readonly secretKey:string}
const DIGEST=/^[0-9a-f]{64}$/u;
const REF=/^[a-z0-9]{20}$/u;
const SECRET=/^sb_secret_[A-Za-z0-9_-]{20,240}$/u;
function obj(v:unknown):Record<string,unknown>|null{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}
function nonnegative(v:unknown):number{
 if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)throw Error('AUDIENCE_INVALID_RESPONSE');
 return v;
}
function instant(v:unknown):string{
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/u.test(v))throw Error('AUDIENCE_INVALID_RESPONSE');
 const n=Date.parse(v);if(!Number.isFinite(n))throw Error('AUDIENCE_INVALID_RESPONSE');return new Date(n).toISOString();
}
function rows(value:unknown,dimension:'country'|'city'|'source',total:number):AudienceBreakdown[]{
 if(!Array.isArray(value)||value.length>100)throw Error('AUDIENCE_INVALID_RESPONSE');
 const used=new Set<string>();
 return value.map(raw=>{
  const r=obj(raw);if(!r)throw Error('AUDIENCE_INVALID_RESPONSE');
  let label:string;
  if(dimension==='source'){
   if(typeof r.source!=='string'||!(SOURCES as readonly string[]).includes(r.source))throw Error('AUDIENCE_INVALID_RESPONSE');
   label=r.source as TrafficSource;
  }else{
   if(typeof r.country!=='string'||!/^[A-Z]{2}$/u.test(r.country)||r.country==='XX'||r.country==='ZZ')throw Error('AUDIENCE_INVALID_RESPONSE');
   if(dimension==='city'){
    if(typeof r.city!=='string'||!r.city||Array.from(r.city).length>80||Buffer.byteLength(r.city,'utf8')>160||!/^[\p{L}\p{M}\p{N} .,'’()\-]+$/u.test(r.city))throw Error('AUDIENCE_INVALID_RESPONSE');
    label=r.city+' · '+r.country;
   }else label=r.country;
  }
  const visitors=nonnegative(r.visitors),sessions=nonnegative(r.sessions);
  if(visitors>total||sessions<visitors||(dimension!=='source'&&visitors<3)||used.has(label))throw Error('AUDIENCE_INVALID_RESPONSE');
  used.add(label);return {label,visitors,sessions};
 });
}
export function parseAudienceSnapshot(raw:unknown,hours:AudienceHours,now:Date=new Date()):AudienceSnapshot{
 const r=obj(raw);if(!r||r.version!==AUDIENCE_VERSION||r.retentionDays!==90)throw Error('AUDIENCE_INVALID_RESPONSE');
 const asOf=instant(r.asOf),since=instant(r.since),bucket=hours===24?'hour':'day';
 const end=Date.parse(asOf),start=Date.parse(since);
 if(r.bucket!==bucket||!Number.isFinite(now.getTime())||Math.abs(end-now.getTime())>300_000||end-start!==(hours??2160)*3_600_000)throw Error('AUDIENCE_INVALID_RESPONSE');
 const visitors=nonnegative(r.visitors),sessionStarts=nonnegative(r.sessionStarts),pageviews=nonnegative(r.pageviews),repeatBrowsers=nonnegative(r.repeatBrowsers),active5m=nonnegative(r.active5m);
 if(repeatBrowsers>visitors||active5m>visitors||sessionStarts>pageviews)throw Error('AUDIENCE_INVALID_RESPONSE');
 if(!Array.isArray(r.series)||r.series.length>(bucket==='hour'?25:91))throw Error('AUDIENCE_INVALID_RESPONSE');
 let previous=-Infinity;const step=bucket==='hour'?3_600_000:86_400_000;
 const series=r.series.map(raw=>{
  const row=obj(raw);if(!row)throw Error('AUDIENCE_INVALID_RESPONSE');
  const timestamp=instant(row.timestamp),t=Date.parse(timestamp);
  if(t<=previous||t%step!==0||t<Math.floor(start/step)*step||t>end)throw Error('AUDIENCE_INVALID_RESPONSE');
  previous=t;return {timestamp,pageviews:nonnegative(row.pageviews),sessionStarts:nonnegative(row.sessionStarts)};
 });
 if(series.reduce((a,b)=>a+b.pageviews,0)!==pageviews||series.reduce((a,b)=>a+b.sessionStarts,0)!==sessionStarts)throw Error('AUDIENCE_INVALID_RESPONSE');
 return {version:AUDIENCE_VERSION,asOf,since,bucket,retentionDays:90,visitors,sessionStarts,pageviews,repeatBrowsers,active5m,countries:rows(r.countries,'country',visitors),cities:rows(r.cities,'city',visitors),sources:rows(r.sources,'source',visitors),series};
}
/** Separate credential boundary. No fallback to the main application's secret. */
export function audienceStorageConfig(env:Environment):AudienceStorageConfig|null{
 const projectRef=env.DLKT_INFO_AUDIENCE_SUPABASE_PROJECT_REF,secretKey=env.DLKT_INFO_AUDIENCE_SUPABASE_SECRET_KEY;
 if(!projectRef||!REF.test(projectRef)||projectRef===env.DLKT_INFO_SUPABASE_PROJECT_REF||!secretKey||!SECRET.test(secretKey)||secretKey===env.DLKT_INFO_SUPABASE_SECRET_KEY)return null;
 return {projectRef,secretKey};
}
type Rpc='snapshot'|'record_activity'|'forget_browser';
export class SupabaseAudienceStore implements AudienceStore{
 private readonly origin:string;
 constructor(private readonly config:AudienceStorageConfig,private readonly request:typeof fetch=fetch,private readonly clock:()=>Date=()=>new Date()){
  if(!REF.test(config.projectRef)||!SECRET.test(config.secretKey))throw Error('AUDIENCE_STORAGE_CONFIG');
  this.origin='https://'+config.projectRef+'.supabase.co';
 }
 private async rpc(name:Rpc,parameters:Record<string,unknown>):Promise<unknown>{
  try{
   const res=await this.request(new URL('/rest/v1/rpc/'+name,this.origin),{
    method:'POST',headers:{apikey:this.config.secretKey,'Content-Profile':'dlkt_audience','Content-Type':'application/json',Accept:'application/json'},
    body:JSON.stringify(parameters),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(8_000)
   });
   if(!res.ok){await res.body?.cancel();throw Error('AUDIENCE_STORAGE_UNAVAILABLE');}
   if(name==='forget_browser'&&(res.status===204||res.headers.get('content-length')==='0'))return null;
   return await boundedJson(res,128_000);
  }catch{throw Error('AUDIENCE_STORAGE_UNAVAILABLE');}
 }
 async snapshot(hours:AudienceHours):Promise<AudienceSnapshot>{
  if(hours!==null&&![24,168,720,2160].includes(hours))throw Error('AUDIENCE_INVALID_RANGE');
  return parseAudienceSnapshot(await this.rpc('snapshot',{p_hours:hours}),hours,this.clock());
 }
 async record(browser:string,event:AudienceEvent,geo:ApproximateGeography):Promise<AudienceWriteResult>{
  if(!DIGEST.test(browser))throw Error('AUDIENCE_INVALID_BROWSER');
  const v=await this.rpc('record_activity',{p_browser:browser,p_kind:event.kind,p_event:event.kind==='pageview'?event.id:null,p_source:event.kind==='pageview'?event.source:null,p_country:event.kind==='pageview'?geo.country:null,p_city:event.kind==='pageview'?geo.city:null});
  if(v==='accepted'||v==='duplicate'||v==='throttled'||v==='no-session'||v==='revoked')return v;
  throw Error('AUDIENCE_INVALID_RESPONSE');
 }
 async forget(browser:string):Promise<void>{
  if(!DIGEST.test(browser))throw Error('AUDIENCE_INVALID_BROWSER');
  const result=await this.rpc('forget_browser',{p_browser:browser});
  if(result!==null)throw Error('AUDIENCE_INVALID_RESPONSE');
 }
}
