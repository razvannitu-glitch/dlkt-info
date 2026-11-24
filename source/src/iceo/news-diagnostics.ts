import {NEWS_PUBLISHERS,NEWS_DISCOVERY_INDEXES,NEWS_SOURCE_LANGUAGES,publisherForNewsUrl,sourceLanguage,type NewsDiscoveryIndex,type NewsSourceLanguage} from './news-sources.js';

export const NEWS_DIAGNOSTICS_VERSION='dlkt-news-diagnostics-1' as const;
export const NEWS_DIAGNOSTIC_MAX_GROUPS=256;
export const NEWS_DIAGNOSTIC_MAX_BYTES=65_536;
/** Leave room for PostgreSQL JSONB spacing inside the persisted64KiB limit. */
export const NEWS_DIAGNOSTIC_EMIT_BYTES=49_152;
export const NEWS_DIAGNOSTIC_COUNTERS=Object.freeze([
  'freshDiscovered','pool','scheduled','attempted','requestAttempts','verifiedNow','rejected','duplicates',
  'deferredCapacity','deferredBeforeAttempt','retained',
] as const);
export type NewsDiagnosticCounter=typeof NEWS_DIAGNOSTIC_COUNTERS[number];
export type NewsDiagnosticCounts=Readonly<Record<NewsDiagnosticCounter,number>>;
export const NEWS_DIAGNOSTIC_REASONS=Object.freeze([
  'index-identity','index-schema','index-stale','index-unavailable','access-denied','rate-limited',
  'http-unavailable','timeout','deadline','request-capacity','origin-backoff','redirect',
  'content-type','response-size','empty-response','metadata-unverified','identity-conflict',
  'duplicate','request-unavailable','rights-review-expired','candidate-store',
] as const);
export type NewsDiagnosticReason=typeof NEWS_DIAGNOSTIC_REASONS[number];
export interface NewsDiagnosticGroup {
  readonly publisherId:string;readonly language:NewsSourceLanguage|null;
  readonly counts:NewsDiagnosticCounts;readonly reasons:readonly {readonly code:NewsDiagnosticReason;readonly count:number}[];
  readonly lastAttemptAt:string|null;readonly lastVerifiedAt:string|null;
}
export interface NewsIndexDiagnostic {
  readonly indexId:string;readonly publisherId:string|null;readonly language:NewsSourceLanguage|null;
  readonly attempted:boolean;readonly state:'verified'|'unavailable'|'deferred';
  readonly checkedAt:string;readonly reason:NewsDiagnosticReason|null;
}
export interface NewsDiagnostics {
  readonly version:typeof NEWS_DIAGNOSTICS_VERSION;readonly checkedAt:string;
  readonly indexes:readonly NewsIndexDiagnostic[];readonly groups:readonly NewsDiagnosticGroup[];
  readonly totals:NewsDiagnosticCounts;readonly issues:readonly NewsDiagnosticReason[];
}
const publishers=new Set(NEWS_PUBLISHERS.map(value=>value.id));
const languages:ReadonlySet<string>=new Set(NEWS_SOURCE_LANGUAGES);
const reasons:ReadonlySet<string>=new Set(NEWS_DIAGNOSTIC_REASONS);
const MAX_COUNT=5000*(NEWS_DISCOVERY_INDEXES.length+2);
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const integer=(value:unknown,maximum=MAX_COUNT):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=maximum;
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const language=(value:unknown):value is NewsSourceLanguage|null=>value===null||typeof value==='string'&&languages.has(value);
const reason=(value:unknown):value is NewsDiagnosticReason=>typeof value==='string'&&reasons.has(value);
const emptyCounts=():Record<NewsDiagnosticCounter,number>=>({freshDiscovered:0,pool:0,scheduled:0,attempted:0,requestAttempts:0,verifiedNow:0,rejected:0,duplicates:0,deferredCapacity:0,deferredBeforeAttempt:0,retained:0});
const groupKey=(publisherId:string,tag:NewsSourceLanguage|null):string=>publisherId+'|'+(tag??'');
function validCounts(value:unknown):value is NewsDiagnosticCounts {
  return object(value)&&exact(value,NEWS_DIAGNOSTIC_COUNTERS)&&NEWS_DIAGNOSTIC_COUNTERS.every(key=>integer(value[key]))
    &&value.pool===Number(value.scheduled)+Number(value.deferredCapacity)
    &&value.scheduled===Number(value.attempted)+Number(value.deferredBeforeAttempt)
    &&value.attempted===Number(value.verifiedNow)+Number(value.rejected)+Number(value.duplicates)
    &&Number(value.requestAttempts)>=Number(value.attempted);
}
function indexIdentity(index:NewsDiscoveryIndex|null):{indexId:string;publisherId:string|null;language:NewsSourceLanguage|null} {
  return index===null?{indexId:'gdelt-gal',publisherId:null,language:null}
    :{indexId:index.id,publisherId:index.publisherId,language:index.language??sourceLanguage(index.url)};
}
function validIndex(value:unknown,checkedAt:string):value is NewsIndexDiagnostic {
  if(!object(value)||!exact(value,['indexId','publisherId','language','attempted','state','checkedAt','reason'])
    ||typeof value.indexId!=='string'||typeof value.attempted!=='boolean'||value.checkedAt!==checkedAt
    ||!language(value.language)||typeof value.state!=='string'||!['verified','unavailable','deferred'].includes(value.state))return false;
  const registered=value.indexId==='gdelt-gal'?null:NEWS_DISCOVERY_INDEXES.find(index=>index.id===value.indexId);
  if(registered===undefined)return false;
  const identity=indexIdentity(registered);
  if(value.publisherId!==identity.publisherId||value.language!==identity.language)return false;
  return value.state==='verified'?value.attempted&&value.reason===null
    :reason(value.reason)&&(value.state==='unavailable'?value.attempted:!value.attempted);
}
/** Closed aggregate metadata contract. Historical receipts remain valid; future checks do not. */
export function validNewsDiagnostics(value:unknown,now=Date.now()):value is NewsDiagnostics {
  try{
    if(!Number.isFinite(now)||!object(value)||!exact(value,['version','checkedAt','indexes','groups','totals','issues'])
      ||value.version!==NEWS_DIAGNOSTICS_VERSION||!stamp(value.checkedAt)||Date.parse(value.checkedAt)>now+300_000
      ||Buffer.byteLength(JSON.stringify(value),'utf8')>NEWS_DIAGNOSTIC_MAX_BYTES
      ||!Array.isArray(value.indexes)||value.indexes.length>NEWS_DISCOVERY_INDEXES.length+1
      ||!value.indexes.every(index=>validIndex(index,value.checkedAt as string))
      ||new Set(value.indexes.map(index=>index.indexId)).size!==value.indexes.length
      ||!Array.isArray(value.groups)||value.groups.length>NEWS_DIAGNOSTIC_MAX_GROUPS
      ||!validCounts(value.totals)||!Array.isArray(value.issues)||value.issues.length>NEWS_DIAGNOSTIC_REASONS.length
      ||!value.issues.every(reason)||new Set(value.issues).size!==value.issues.length)return false;
    const totals=emptyCounts(),keys=new Set<string>(),expectedTotals=value.totals;
    for(const row of value.groups){
      if(!object(row)||!exact(row,['publisherId','language','counts','reasons','lastAttemptAt','lastVerifiedAt'])
        ||typeof row.publisherId!=='string'||!publishers.has(row.publisherId)||!language(row.language)||!validCounts(row.counts)
        ||!Array.isArray(row.reasons)||row.reasons.length>NEWS_DIAGNOSTIC_REASONS.length)return false;
      const key=groupKey(row.publisherId,row.language);if(keys.has(key))return false;keys.add(key);
      const reasonKeys=new Set<string>();let reasonTotal=0;
      for(const entry of row.reasons){
        if(!object(entry)||!exact(entry,['code','count'])||!reason(entry.code)||!integer(entry.count)||entry.count<1||reasonKeys.has(entry.code))return false;
        reasonKeys.add(entry.code);reasonTotal+=entry.count;
      }
      if(reasonTotal!==row.counts.rejected+row.counts.duplicates+row.counts.deferredCapacity+row.counts.deferredBeforeAttempt)return false;
      if(row.counts.attempted>0?row.lastAttemptAt!==value.checkedAt:row.lastAttemptAt!==null)return false;
      if(row.counts.verifiedNow+row.counts.retained>0){
        if(!stamp(row.lastVerifiedAt)||Date.parse(row.lastVerifiedAt)>Date.parse(value.checkedAt)+300_000)return false;
        if(row.counts.verifiedNow>0&&Date.parse(row.lastVerifiedAt)<Date.parse(value.checkedAt))return false;
      }else if(row.lastVerifiedAt!==null)return false;
      for(const counter of NEWS_DIAGNOSTIC_COUNTERS)totals[counter]+=row.counts[counter];
    }
    return NEWS_DIAGNOSTIC_COUNTERS.every(counter=>totals[counter]===expectedTotals[counter])
      &&totals.pool<=5000&&totals.scheduled<=80&&totals.requestAttempts<=80&&totals.retained<=5000;
  }catch{return false;}
}
export function newsDiagnosticReason(code:string):NewsDiagnosticReason {
  if(code==='RIGHTS_REVIEW_EXPIRED')return 'rights-review-expired';
  if(code==='NEWS_CANDIDATE_STORE_FAILED'||code==='NEWS_STORE_TIMEOUT')return 'candidate-store';
  if(code==='NEWS_PUBLICATION_METADATA_UNVERIFIED')return 'metadata-unverified';
  if(code==='NEWS_IDENTITY_CONFLICT')return 'identity-conflict';
  if(code==='NEWS_REQUEST_TIMEOUT')return 'timeout';
  if(code==='NEWS_GLOBAL_DEADLINE')return 'deadline';
  if(code==='NEWS_REQUEST_BUDGET_EXHAUSTED')return 'request-capacity';
  if(code==='NEWS_ORIGIN_BLOCKED')return 'origin-backoff';
  if(code==='NEWS_UNEXPECTED_REDIRECT'||code==='NEWS_REDIRECT_REJECTED')return 'redirect';
  if(code==='NEWS_CONTENT_TYPE_INVALID')return 'content-type';
  if(code==='NEWS_RESPONSE_TOO_LARGE')return 'response-size';
  if(code==='NEWS_EMPTY_RESPONSE')return 'empty-response';
  if(code==='NEWS_INDEX_IDENTITY_INVALID'||code==='NEWS_INDEX_NOT_REGISTERED')return 'index-identity';
  if(code==='NEWS_INDEX_XML_INVALID'||code==='NEWS_INDEX_SCHEMA_INVALID'||code==='NEWS_INDEX_TOO_MANY_ITEMS')return 'index-schema';
  if(code==='NEWS_INDEX_STALE')return 'index-stale';
  if(code==='NEWS_INDEX_UNAVAILABLE')return 'index-unavailable';
  if(/^NEWS_HTTP_(?:401|402|403)$/u.test(code))return 'access-denied';
  if(code==='NEWS_HTTP_429')return 'rate-limited';
  if(/^NEWS_HTTP_[45]\d\d$/u.test(code))return 'http-unavailable';
  return 'request-unavailable';
}
type Outcome='verified'|'rejected'|'duplicate'|'deferred';
interface CandidateObservation {
  readonly group:string;scheduled:boolean;attempted:boolean;requests:number;
  outcome:Outcome|null;reason:NewsDiagnosticReason|null;
}
interface MutableGroup {
  readonly publisherId:string;readonly language:NewsSourceLanguage|null;
  fresh:number;retained:number;lastVerifiedAt:string|null;
}
/** URLs exist only in this per-collection accumulator; the emitted receipt contains aggregates only. */
export class NewsDiagnosticsBuilder {
  private readonly checkedAt:string;
  private readonly groups=new Map<string,MutableGroup>();
  private readonly fresh=new Set<string>();
  private readonly candidates=new Map<string,CandidateObservation>();
  private readonly retained=new Set<string>();
  private readonly indexes=new Map<string,NewsIndexDiagnostic>();
  private readonly issues=new Set<NewsDiagnosticReason>();
  constructor(private readonly now:number){
    if(!Number.isFinite(now)||now<0)throw new Error('NEWS_DIAGNOSTICS_CLOCK_INVALID');
    this.checkedAt=new Date(now).toISOString();
  }
  private ensure(publisherId:string,tag:NewsSourceLanguage|null):string {
    if(!publishers.has(publisherId)||!language(tag))throw new Error('NEWS_DIAGNOSTICS_IDENTITY_INVALID');
    const key=groupKey(publisherId,tag);
    if(!this.groups.has(key)){
      if(this.groups.size>=NEWS_DIAGNOSTIC_MAX_GROUPS)throw new Error('NEWS_DIAGNOSTICS_LIMIT');
      this.groups.set(key,{publisherId,language:tag,fresh:0,retained:0,lastVerifiedAt:null});
    }
    return key;
  }
  private urlGroup(url:string):string {
    const publisher=publisherForNewsUrl(url);if(!publisher)throw new Error('NEWS_DIAGNOSTICS_IDENTITY_INVALID');
    return this.ensure(publisher.id,sourceLanguage(url));
  }
  private candidate(url:string):CandidateObservation {
    const value=this.candidates.get(url);
    if(!value||!value.scheduled)throw new Error('NEWS_DIAGNOSTICS_SEQUENCE_INVALID');
    return value;
  }
  index(index:NewsDiscoveryIndex|null,attempted:boolean,error:string|null):void {
    const identity=indexIdentity(index),row:NewsIndexDiagnostic=Object.freeze({...identity,attempted,
      state:error===null?'verified':attempted?'unavailable':'deferred',checkedAt:this.checkedAt,reason:error===null?null:newsDiagnosticReason(error)});
    if(!validIndex(row,this.checkedAt)||this.indexes.has(identity.indexId))throw new Error('NEWS_DIAGNOSTICS_INDEX_INVALID');
    this.indexes.set(identity.indexId,row);if(identity.publisherId!==null)this.ensure(identity.publisherId,identity.language);
  }
  discovered(values:readonly {readonly sourceUrl:string}[]):void {
    for(const value of values){
      if(this.fresh.has(value.sourceUrl))continue;
      if(this.fresh.size>=MAX_COUNT)throw new Error('NEWS_DIAGNOSTICS_LIMIT');
      this.fresh.add(value.sourceUrl);this.groups.get(this.urlGroup(value.sourceUrl))!.fresh++;
    }
  }
  pool(values:readonly {readonly sourceUrl:string}[]):void {
    if(this.candidates.size||values.length>5000)throw new Error('NEWS_DIAGNOSTICS_POOL_INVALID');
    for(const value of values){
      if(this.candidates.has(value.sourceUrl))throw new Error('NEWS_DIAGNOSTICS_POOL_INVALID');
      this.candidates.set(value.sourceUrl,{group:this.urlGroup(value.sourceUrl),scheduled:false,attempted:false,requests:0,outcome:null,reason:null});
    }
  }
  scheduled(values:readonly {readonly sourceUrl:string}[]):void {
    if(values.length>80)throw new Error('NEWS_DIAGNOSTICS_LIMIT');
    for(const value of values){
      const row=this.candidates.get(value.sourceUrl);if(!row||row.scheduled||row.outcome!==null)throw new Error('NEWS_DIAGNOSTICS_SEQUENCE_INVALID');
      row.scheduled=true;
    }
  }
  /** The legacy deferredCapacity counter is the unscheduled pool; reasons preserve why each item was deferred. */
  deferBeforeScheduling(url:string,code:NewsDiagnosticReason):void {
    const row=this.candidates.get(url);
    if(!row||row.scheduled||row.outcome!==null||!reason(code))throw new Error('NEWS_DIAGNOSTICS_SEQUENCE_INVALID');
    row.outcome='deferred';row.reason=code;
  }
  request(url:string):void {const row=this.candidate(url);row.attempted=true;row.requests++;}
  verified(url:string):void {const row=this.candidate(url);if(!row.attempted)throw new Error('NEWS_DIAGNOSTICS_SEQUENCE_INVALID');row.outcome='verified';row.reason=null;}
  duplicate(url:string):void {const row=this.candidate(url);if(!row.attempted)throw new Error('NEWS_DIAGNOSTICS_SEQUENCE_INVALID');row.outcome='duplicate';row.reason='duplicate';}
  failed(url:string,code:string):void {const row=this.candidate(url);row.outcome=row.attempted?'rejected':'deferred';row.reason=newsDiagnosticReason(code);}
  retain(value:{readonly sourceUrl:string;readonly observedAt:string}):void {
    if(this.retained.has(value.sourceUrl))return;
    if(!stamp(value.observedAt)||Date.parse(value.observedAt)>this.now+300_000||this.retained.size>=5000)throw new Error('NEWS_DIAGNOSTICS_RETAINED_INVALID');
    this.retained.add(value.sourceUrl);const group=this.groups.get(this.urlGroup(value.sourceUrl))!;group.retained++;
    if(group.lastVerifiedAt===null||value.observedAt>group.lastVerifiedAt)group.lastVerifiedAt=value.observedAt;
  }
  issue(code:NewsDiagnosticReason):void {if(!reason(code))throw new Error('NEWS_DIAGNOSTICS_REASON_INVALID');this.issues.add(code);}
  finish():NewsDiagnostics {
    const totals=emptyCounts(),groups:NewsDiagnosticGroup[]=[];
    for(const [key,group] of [...this.groups].sort(([a],[b])=>a<b?-1:a>b?1:0)){
      const counts=emptyCounts(),codes=new Map<NewsDiagnosticReason,number>();let verifiedAt=group.lastVerifiedAt;
      const addReason=(code:NewsDiagnosticReason):void=>{codes.set(code,(codes.get(code)??0)+1);};
      counts.freshDiscovered=group.fresh;counts.retained=group.retained;
      for(const row of this.candidates.values()){
        if(row.group!==key)continue;counts.pool++;
        if(!row.scheduled){counts.deferredCapacity++;addReason(row.reason??'request-capacity');continue;}
        counts.scheduled++;counts.requestAttempts+=row.requests;
        if(row.attempted)counts.attempted++;else counts.deferredBeforeAttempt++;
        if(row.outcome===null)throw new Error('NEWS_DIAGNOSTICS_INCOMPLETE');
        if(row.outcome==='verified'){counts.verifiedNow++;if(verifiedAt===null||verifiedAt<this.checkedAt)verifiedAt=this.checkedAt;}
        else if(row.outcome==='rejected')counts.rejected++;
        else if(row.outcome==='duplicate')counts.duplicates++;
        if(row.reason!==null)addReason(row.reason);
      }
      for(const counter of NEWS_DIAGNOSTIC_COUNTERS)totals[counter]+=counts[counter];
      groups.push(Object.freeze({publisherId:group.publisherId,language:group.language,counts:Object.freeze(counts),
        reasons:Object.freeze([...codes].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([code,count])=>Object.freeze({code,count}))),
        lastAttemptAt:counts.attempted?this.checkedAt:null,lastVerifiedAt:verifiedAt}));
    }
    const report:NewsDiagnostics=Object.freeze({version:NEWS_DIAGNOSTICS_VERSION,checkedAt:this.checkedAt,
      indexes:Object.freeze([...this.indexes.values()].sort((a,b)=>a.indexId<b.indexId?-1:a.indexId>b.indexId?1:0)),
      groups:Object.freeze(groups),totals:Object.freeze(totals),issues:Object.freeze([...this.issues].sort())});
    if(Buffer.byteLength(JSON.stringify(report),'utf8')>NEWS_DIAGNOSTIC_EMIT_BYTES)throw new Error('NEWS_DIAGNOSTICS_LIMIT');
    if(!validNewsDiagnostics(report,this.now))throw new Error('NEWS_DIAGNOSTICS_INVALID');
    return report;
  }
}
