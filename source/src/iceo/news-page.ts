import {createHmac,timingSafeEqual} from 'node:crypto';
import {localeFromPreference,type Locale} from '../i18n/locale.js';
import {findCity} from '../local/cities.js';
import {newsCard} from '../local/service.js';
import {newsFeed,NEWS_WINDOW_MS} from '../local/news-policy.js';
import {ICEO_SOURCES} from './registry.js';
import {selectContextualToday} from './contextual-today.js';
import {newsLanguageMatches,selectNewsLanguage} from './news-sources.js';
import {selectNewsStream,type NewsStreamFilter,type NewsStreamItem} from './news-stream.js';
import {NEWS_ORDER_VERSION,NEWS_CORPUS_MAX_AGE_MS,type NewsCorpusEpoch} from './news-corpus.js';
import {createNewsCorpusStore,type NewsCorpusStore} from './news-corpus-store.js';
import {NEWS_PAGE_VERSION,NEWS_SERVER_PAGE_SIZE,validNewsCityId,validNewsEpochId,validNewsStreamFilter,validNewsPage,
 type NewsPage,type NewsPageItem,type NewsPageErrorCode} from './news-page-contracts.js';
import type {PersistenceFetch} from '../persistence/contracts.js';

export interface NewsPageRequest {readonly language:Locale;readonly cityId:string|null;readonly filter:NewsStreamFilter;readonly cursor:string|null}
export interface NewsPageReader {read(query:NewsPageRequest):Promise<NewsPage>}
export class NewsPageError extends Error {constructor(readonly code:NewsPageErrorCode){super(code);this.name='NewsPageError';}}
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u;
const WRITER=/^[A-Za-z0-9_-]{43,128}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function validRequest(value:unknown):value is NewsPageRequest {
 return object(value)&&exact(value,['language','cityId','filter','cursor'])&&localeFromPreference(value.language)!==null
  &&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&(value.cursor===null||typeof value.cursor==='string'&&value.cursor.length<=2048&&TOKEN.test(value.cursor));
}
export function parseNewsPageRequest(input:string|URL):NewsPageRequest {
 let url:URL;try{url=new URL(input instanceof URL?input.href:input,'https://www.dlkt.ee');}catch{throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');}
 const keys=['lang','category','city','cursor'],entries=[...url.searchParams];
 if(url.href.length>4096||url.hash||entries.some(([key])=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length>1)
  ||url.searchParams.getAll('lang').length!==1)throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 const value={language:url.searchParams.get('lang'),cityId:url.searchParams.get('city'),filter:url.searchParams.get('category')??'all',cursor:url.searchParams.get('cursor')};
 if(!validRequest(value))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 return value;
}
interface Cursor {
 readonly version:'news-cursor-1';readonly orderVersion:typeof NEWS_ORDER_VERSION;readonly epoch:string;readonly revision:number;readonly digest:string;
 readonly language:Locale;readonly cityId:string|null;readonly filter:NewsStreamFilter;readonly after:number;readonly expiresAt:string;
}
function validCursor(value:unknown):value is Cursor {
 return object(value)&&exact(value,['version','orderVersion','epoch','revision','digest','language','cityId','filter','after','expiresAt'])
  &&value.version==='news-cursor-1'&&value.orderVersion===NEWS_ORDER_VERSION&&validNewsEpochId(value.epoch)
  &&typeof value.revision==='number'&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.digest==='string'&&HASH.test(value.digest)
  &&localeFromPreference(value.language)!==null&&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&typeof value.after==='number'&&Number.isSafeInteger(value.after)&&value.after>=NEWS_SERVER_PAGE_SIZE&&value.after<5000&&value.after%NEWS_SERVER_PAGE_SIZE===0
  &&stamp(value.expiresAt);
}
interface OrderedEdition {readonly epoch:NewsCorpusEpoch;readonly items:readonly NewsPageItem[];readonly counts:Readonly<Record<string,number>>;readonly expiresAt:string}
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
  if(!validCursor(value))throw new NewsPageError('NEWS_CURSOR_INVALID');
  return value;
 }
 private ordered(epoch:NewsCorpusEpoch,query:NewsPageRequest):OrderedEdition {
  const key=JSON.stringify([epoch.epoch,epoch.digest,epoch.corpus.orderVersion,query.language,query.cityId]),cached=this.orders.get(key);
  if(cached)return cached;
  if(epoch.corpus.orderVersion!==NEWS_ORDER_VERSION)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const at=Date.parse(epoch.generatedAt),today=selectContextualToday(selectNewsLanguage(epoch.corpus.cards,query.language),{countryCode:null,preferredTopics:[]},at);
  const local=epoch.corpus.local.filter(entry=>entry.city.id===query.cityId).flatMap(entry=>entry.snapshot.articles
   .filter(article=>newsLanguageMatches(newsFeed(article.sourceId)?.language??null,query.language)).map(article=>newsCard(article,entry.city)));
  const selection=selectNewsStream(today,local,at,'all',JSON.stringify([NEWS_ORDER_VERSION,epoch.epoch,query.language,query.cityId]));
  const items=Object.freeze(selection.items.map(itemRecord));
  const expires=Math.min(Date.parse(epoch.expiresAt),at+NEWS_CORPUS_MAX_AGE_MS,...items.map(itemExpires));
  const result={epoch,items,counts:selection.counts,expiresAt:new Date(expires).toISOString()};
  if(this.orders.size>=16)this.orders.delete(this.orders.keys().next().value??'');
  this.orders.set(key,result);return result;
 }
 async read(query:NewsPageRequest):Promise<NewsPage> {
  if(!validRequest(query))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
  const cursor=query.cursor===null?null:this.decode(query.cursor),now=this.clock();
  if(cursor&&(cursor.language!==query.language||cursor.cityId!==query.cityId||cursor.filter!==query.filter))throw new NewsPageError('NEWS_CONTEXT_MISMATCH');
  if(cursor&&Date.parse(cursor.expiresAt)<=now)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  let epoch:NewsCorpusEpoch|null;
  try{epoch=await this.store.read(cursor?.epoch);}catch{throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');}
  if(!epoch)throw new NewsPageError(cursor?'NEWS_EDITION_EXPIRED':'NEWS_CORPUS_UNAVAILABLE');
  if(cursor&&(epoch.epoch!==cursor.epoch||epoch.revision!==cursor.revision||epoch.digest!==cursor.digest))throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const edition=this.ordered(epoch,query),completed=this.clock();
  if(Date.parse(edition.expiresAt)<=completed||cursor&&cursor.expiresAt!==edition.expiresAt)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const filtered=edition.items.filter(item=>query.filter==='all'||(item.category??'other')===query.filter),after=cursor?.after??0;
  if(after>filtered.length||cursor&&after===filtered.length)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const items=filtered.slice(after,after+NEWS_SERVER_PAGE_SIZE),next=after+items.length;
  const nextCursor=next<filtered.length?this.sign({version:'news-cursor-1',orderVersion:NEWS_ORDER_VERSION,epoch:epoch.epoch,revision:epoch.revision,digest:epoch.digest,
   language:query.language,cityId:query.cityId,filter:query.filter,after:next,expiresAt:edition.expiresAt}):null;
  const page:NewsPage={version:NEWS_PAGE_VERSION,epoch:epoch.epoch,revision:epoch.revision,generatedAt:epoch.generatedAt,expiresAt:edition.expiresAt,
   language:query.language,cityId:query.cityId,filter:query.filter,items,total:edition.items.length,filteredTotal:filtered.length,counts:edition.counts,nextCursor};
  const city=query.cityId===null?undefined:findCity(query.cityId)??undefined;
  if(!validNewsPage(page,completed,city))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  return Object.freeze(page);
 }
}
export function createNewsPageService(environment:Readonly<Record<string,string|undefined>>,fetcher:PersistenceFetch=fetch):NewsPageReader|null {
 const store=createNewsCorpusStore(environment,fetcher),key=environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
 return store&&key&&WRITER.test(key)?new NewsPageService(store,key):null;
}
