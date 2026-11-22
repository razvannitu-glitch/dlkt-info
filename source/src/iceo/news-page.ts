import {createHmac,timingSafeEqual} from 'node:crypto';
import {localeFromPreference,type Locale} from '../i18n/locale.js';
import {findCity} from '../local/cities.js';
import {newsCard} from '../local/service.js';
import {newsFeed,NEWS_WINDOW_MS,validLocalNewsArticle} from '../local/news-policy.js';
import {ICEO_SOURCES} from './registry.js';
import {selectContextualToday} from './contextual-today.js';
import {newsLanguageMatches,selectNewsLanguage,sourceEditionCountryCode} from './news-sources.js';
import {selectNewsStream,type NewsStreamFilter,type NewsStreamItem} from './news-stream.js';
import {NEWS_ORDER_VERSION,NEWS_CORPUS_MAX_AGE_MS,type NewsCorpusEpoch} from './news-corpus.js';
import {createNewsCorpusStore,type NewsCorpusStore} from './news-corpus-store.js';
import {NEWS_PAGE_VERSION,NEWS_SERVER_PAGE_SIZE,validNewsCityId,validNewsEpochId,validNewsStreamFilter,validNewsPage,
 type NewsPage,type NewsPageItem,type NewsCountryCoverage,type NewsPageErrorCode} from './news-page-contracts.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import {newsDayWindow,newsPublishedInDay,validNewsDayWindow,validNewsPeriod,type NewsPeriod,type NewsDayWindow} from './news-day.js';

export interface NewsPageRequest {readonly language:Locale;readonly cityId:string|null;readonly filter:NewsStreamFilter;readonly cursor:string|null;readonly period?:NewsPeriod}
export interface NewsPageReader {read(query:NewsPageRequest):Promise<NewsPage>}
export class NewsPageError extends Error {constructor(readonly code:NewsPageErrorCode){super(code);this.name='NewsPageError';}}
const NEWS_CURSOR_VERSION='news-cursor-4' as const;
const NEWS_COUNTRY_ORDER_VERSION='iptc17-country-day-rounds-20261123' as const;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u;
const WRITER=/^[A-Za-z0-9_-]{43,128}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function validRequest(value:unknown):value is NewsPageRequest {
 return object(value)&&['language','cityId','filter','cursor'].every(key=>Object.hasOwn(value,key))
  &&Object.keys(value).every(key=>['language','cityId','filter','cursor','period'].includes(key))&&(value.period===undefined||validNewsPeriod(value.period))&&localeFromPreference(value.language)!==null
  &&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&(value.cursor===null||typeof value.cursor==='string'&&value.cursor.length<=2048&&TOKEN.test(value.cursor));
}
export function parseNewsPageRequest(input:string|URL):NewsPageRequest {
 let url:URL;try{url=new URL(input instanceof URL?input.href:input,'https://www.dlkt.ee');}catch{throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');}
 const keys=['lang','category','city','cursor','period'],entries=[...url.searchParams];
 if(url.href.length>4096||url.hash||entries.some(([key])=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length>1)
  ||url.searchParams.getAll('lang').length!==1)throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 const value={language:url.searchParams.get('lang'),cityId:url.searchParams.get('city'),filter:url.searchParams.get('category')??'all',cursor:url.searchParams.get('cursor'),
  ...(url.searchParams.has('period')?{period:url.searchParams.get('period')}: {})};
 if(!validRequest(value))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 return value;
}
interface Cursor {
 readonly version:typeof NEWS_CURSOR_VERSION;readonly orderVersion:typeof NEWS_COUNTRY_ORDER_VERSION;readonly epoch:string;readonly revision:number;readonly digest:string;
 readonly language:Locale;readonly cityId:string|null;readonly countryCode:string|null;readonly filter:NewsStreamFilter;readonly after:number;readonly startedAt:string;readonly expiresAt:string;
 readonly period:NewsPeriod;readonly day:NewsDayWindow|null;
}
function validCursor(value:unknown):value is Cursor {
 return object(value)&&exact(value,['version','orderVersion','epoch','revision','digest','language','cityId','countryCode','filter','after','startedAt','expiresAt','period','day'])
  &&value.version===NEWS_CURSOR_VERSION&&value.orderVersion===NEWS_COUNTRY_ORDER_VERSION&&validNewsEpochId(value.epoch)
  &&typeof value.revision==='number'&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.digest==='string'&&HASH.test(value.digest)
  &&localeFromPreference(value.language)!==null&&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&(value.countryCode===null||typeof value.countryCode==='string'&&/^[A-Z]{2}$/u.test(value.countryCode))&&(value.cityId===null)===(value.countryCode===null)
  &&typeof value.after==='number'&&Number.isSafeInteger(value.after)&&value.after>=NEWS_SERVER_PAGE_SIZE&&value.after<5000&&value.after%NEWS_SERVER_PAGE_SIZE===0
  &&stamp(value.startedAt)&&stamp(value.expiresAt)&&Date.parse(value.startedAt)<Date.parse(value.expiresAt)&&validNewsPeriod(value.period)
  &&(value.period==='recent'?value.day===null:object(value.day)&&typeof value.day.timeZone==='string'
   &&validNewsDayWindow(value.day,Date.parse(value.startedAt),value.day.timeZone)&&Date.parse(value.expiresAt)<=Date.parse(value.day.end));
}
interface OrderedEdition {readonly epoch:NewsCorpusEpoch;readonly items:readonly NewsPageItem[];readonly counts:Readonly<Record<string,number>>;readonly coverage:NewsCountryCoverage;readonly expiresAt:string;readonly period:NewsPeriod;readonly day:NewsDayWindow|null}
function itemRecord(item:NewsStreamItem):NewsPageItem {
 return item.kind==='global'?{kind:'global',key:item.key,category:item.category,card:item.view.card}
  :{kind:'local',key:item.key,category:item.category,card:item.card};
}
function itemExpires(item:NewsPageItem):number {
 if(item.kind==='local'){
  const article=item.card.news!,source=newsFeed(article.sourceId);
  return Math.min(Date.parse(article.validUntil),Date.parse(article.publishedAt)+NEWS_WINDOW_MS+1,source?Date.parse(source.rightsReviewBy+'T00:00:00.000Z')+86400000:0);
 }
 const rights=item.card.sourceIds.map(id=>ICEO_SOURCES.find(source=>source.id===id)?.rightsReviewBy).map(day=>day?Date.parse(day+'T00:00:00.000Z')+86400000:0);
 return Math.min(Date.parse(item.card.observedAt)+3600000,Date.parse(item.card.date)+86400000,...rights);
}
/** One immutable full-context order is projected into category pages; no request-time reshuffle or expiry skipping. */
export class NewsPageService implements NewsPageReader {
 private readonly key:Buffer;
 private readonly orders=new Map<string,OrderedEdition>();
 constructor(private readonly store:NewsCorpusStore,writerKey:string,private readonly clock:()=>number=Date.now){
  if(!WRITER.test(writerKey))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  this.key=createHmac('sha256',writerKey).update('dlkt-info/news-page/cursor-key/v1').digest();
 }
 private sign(value:Cursor):string {
  const encoded=Buffer.from(JSON.stringify(value),'utf8').toString('base64url');
  return encoded+'.'+createHmac('sha256',this.key).update('dlkt-info/news-page/cursor/v1:'+encoded).digest('base64url');
 }
 private decode(token:string):Cursor {
  if(token.length>2048||!TOKEN.test(token))throw new NewsPageError('NEWS_CURSOR_INVALID');
  const [encoded,signature]=token.split('.');if(!encoded||!signature)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',this.key).update('dlkt-info/news-page/cursor/v1:'+encoded).digest();
  if(actual.length!==expected.length||actual.toString('base64url')!==signature||!timingSafeEqual(actual,expected))throw new NewsPageError('NEWS_CURSOR_INVALID');
  let value:unknown;
  try{const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw Error('base64');value=JSON.parse(bytes.toString('utf8')) as unknown;}catch{throw new NewsPageError('NEWS_CURSOR_INVALID');}
  if(object(value)&&(value.version==='news-cursor-1'||value.version==='news-cursor-2'||value.version==='news-cursor-3'||value.version===NEWS_CURSOR_VERSION&&value.orderVersion!==NEWS_COUNTRY_ORDER_VERSION))throw new NewsPageError('NEWS_EDITION_EXPIRED');
  if(!validCursor(value))throw new NewsPageError('NEWS_CURSOR_INVALID');
  return value;
 }
 private ordered(epoch:NewsCorpusEpoch,query:NewsPageRequest,startedAt:string,countryCode:string|null,timeZone:string):OrderedEdition {
  const period=query.period??'recent';
  const key=JSON.stringify([epoch.epoch,epoch.digest,NEWS_COUNTRY_ORDER_VERSION,query.language,query.cityId,countryCode,startedAt,period,timeZone]),cached=this.orders.get(key);
  if(cached)return cached;
  if(epoch.corpus.orderVersion!==NEWS_ORDER_VERSION)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const at=Date.parse(startedAt),day=period==='today'?newsDayWindow(at,timeZone):null;
  const current=epoch.corpus.cards.filter(card=>(day===null||newsPublishedInDay(card.date,day))&&itemExpires({kind:'global',key:'article:'+card.id,category:null,card})>at);
  const eligible=selectNewsLanguage(current,query.language),context={countryCode:null,preferredTopics:[]};
  // Rank within each provenance group, then keep national sources ahead inside
  // every category queue. The full same-language international corpus remains.
  const national=countryCode===null?[]:eligible.filter(card=>sourceEditionCountryCode(card)===countryCode);
  const international=countryCode===null?eligible:eligible.filter(card=>sourceEditionCountryCode(card)!==countryCode);
  const countryToday=selectContextualToday(national,context,at),worldToday=selectContextualToday(international,context,at);
  const today={first:[...countryToday.first,...countryToday.more],more:[...worldToday.first,...worldToday.more]};
  const local=epoch.corpus.local.filter(entry=>entry.city.id===query.cityId).flatMap(entry=>entry.snapshot.articles
   .filter(article=>(day===null||newsPublishedInDay(article.publishedAt,day))&&validLocalNewsArticle(article,entry.city,at)&&newsLanguageMatches(newsFeed(article.sourceId)?.language??null,query.language)).map(article=>newsCard(article,entry.city)));
  const selection=selectNewsStream(today,local,at,'all',JSON.stringify([NEWS_COUNTRY_ORDER_VERSION,epoch.epoch,query.language,query.cityId,countryCode,period,day?.date??null]));
  const items=Object.freeze(selection.items.map(itemRecord)),coverage={national:0,local:0,international:0};
  for(const item of items){
   if(item.kind==='local')coverage.local++;
   else if(countryCode!==null&&sourceEditionCountryCode(item.card)===countryCode)coverage.national++;
   else coverage.international++;
  }
  const expires=Math.min(Date.parse(epoch.expiresAt),Date.parse(epoch.generatedAt)+NEWS_CORPUS_MAX_AGE_MS,day===null?Infinity:Date.parse(day.end),...items.map(itemExpires));
  const result={epoch,items,counts:selection.counts,coverage:Object.freeze(coverage),expiresAt:new Date(expires).toISOString(),period,day};
  if(this.orders.size>=16)this.orders.delete(this.orders.keys().next().value??'');
  this.orders.set(key,result);return result;
 }
 async read(query:NewsPageRequest):Promise<NewsPage> {
  if(!validRequest(query))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
  const city=query.cityId===null?undefined:findCity(query.cityId)??undefined;
  if(query.cityId!==null&&!city)throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
  const countryCode=city?.countryCode??null,timeZone=city?.timezone??'UTC',period=query.period??'recent',cursor=query.cursor===null?null:this.decode(query.cursor),now=this.clock();
  if(cursor&&(cursor.language!==query.language||cursor.cityId!==query.cityId||cursor.countryCode!==countryCode||cursor.filter!==query.filter||cursor.period!==period
   ||cursor.period==='today'&&!validNewsDayWindow(cursor.day,Date.parse(cursor.startedAt),timeZone)))throw new NewsPageError('NEWS_CONTEXT_MISMATCH');
  if(cursor&&Date.parse(cursor.expiresAt)<=now)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  let epoch:NewsCorpusEpoch|null;
  try{epoch=await this.store.read(cursor?.epoch);}catch{throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');}
  if(!epoch)throw new NewsPageError(cursor?'NEWS_EDITION_EXPIRED':'NEWS_CORPUS_UNAVAILABLE');
  if(cursor&&(epoch.epoch!==cursor.epoch||epoch.revision!==cursor.revision||epoch.digest!==cursor.digest))throw new NewsPageError('NEWS_EDITION_EXPIRED');
  let startedAt=cursor?.startedAt??new Date(this.clock()).toISOString();
  if(Date.parse(startedAt)<Date.parse(epoch.generatedAt)-5000||Date.parse(startedAt)>this.clock()+5000)throw new NewsPageError('NEWS_CURSOR_INVALID');
  let edition=this.ordered(epoch,query,startedAt,countryCode,timeZone),completed=this.clock();
  // A first response has no visible prefix yet. If a marginal source expires
  // during planning, retry once at completion without restamping any evidence.
  if(cursor===null&&Date.parse(edition.expiresAt)<=completed&&Date.parse(epoch.expiresAt)>completed){
   startedAt=new Date(completed).toISOString();edition=this.ordered(epoch,query,startedAt,countryCode,timeZone);completed=this.clock();
  }
  if(Date.parse(edition.expiresAt)<=completed||cursor&&cursor.expiresAt!==edition.expiresAt)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const filtered=edition.items.filter(item=>query.filter==='all'||(item.category??'other')===query.filter),after=cursor?.after??0;
  if(after>filtered.length||cursor&&after===filtered.length)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const items=filtered.slice(after,after+NEWS_SERVER_PAGE_SIZE),next=after+items.length;
  const nextCursor=next<filtered.length?this.sign({version:NEWS_CURSOR_VERSION,orderVersion:NEWS_COUNTRY_ORDER_VERSION,epoch:epoch.epoch,revision:epoch.revision,digest:epoch.digest,
   language:query.language,cityId:query.cityId,countryCode,filter:query.filter,after:next,startedAt,expiresAt:edition.expiresAt,period,day:edition.day}):null;
  const page:NewsPage={version:NEWS_PAGE_VERSION,epoch:epoch.epoch,revision:epoch.revision,generatedAt:epoch.generatedAt,startedAt,expiresAt:edition.expiresAt,
   language:query.language,cityId:query.cityId,countryCode,coverage:edition.coverage,period,day:edition.day,filter:query.filter,items,total:edition.items.length,filteredTotal:filtered.length,counts:edition.counts,nextCursor};
  if(!validNewsPage(page,completed,city))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  return Object.freeze(page);
 }
}
export function createNewsPageService(environment:Readonly<Record<string,string|undefined>>,fetcher:PersistenceFetch=fetch):NewsPageReader|null {
 const store=createNewsCorpusStore(environment,fetcher),key=environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
 return store&&key&&WRITER.test(key)?new NewsPageService(store,key):null;
}
