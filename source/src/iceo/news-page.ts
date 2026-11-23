import {createHmac,timingSafeEqual} from 'node:crypto';
import {localeFromPreference,type Locale} from '../i18n/locale.js';
import {findCity} from '../local/cities.js';
import {newsCard} from '../local/service.js';
import {newsFeed,NEWS_WINDOW_MS,validLocalNewsArticle} from '../local/news-policy.js';
import {ICEO_SOURCES} from './registry.js';
import {selectContextualToday} from './contextual-today.js';
import {newsLanguageMatches,selectNewsLanguage,sourceEditionCountryCode} from './news-sources.js';
import {balanceNewsEdition} from './news-edition-order.js';
import {selectNewsStream,type NewsStreamFilter,type NewsStreamItem} from './news-stream.js';
import {NEWS_ORDER_VERSION,NEWS_CORPUS_MAX_AGE_MS,type NewsCorpusEpoch} from './news-corpus.js';
import {createNewsCorpusStore,type NewsCorpusStore} from './news-corpus-store.js';
import {groupNewsStories,type NewsStoryGroup} from './news-story.js';
import {NEWS_PAGE_VERSION,NEWS_STORY_SOURCES_VERSION,NEWS_SERVER_PAGE_SIZE,NEWS_SOURCE_PAGE_SIZE,NEWS_STORY_PREVIEW_SIZE,NEWS_MAX_RESPONSE_BYTES,validNewsCityId,validNewsEpochId,validNewsStreamFilter,validNewsPage,validNewsStorySourcesPage,validNewsSourceScope,
 type NewsSourceScope,type NewsPage,type NewsPageOriginal,type NewsPageItem,type NewsStorySource,type NewsStorySourcesPage,type NewsCountryCoverage,type NewsPageErrorCode} from './news-page-contracts.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import {newsDayWindow,newsPublishedInDay,validNewsDayWindow,validNewsPeriod,type NewsPeriod,type NewsDayWindow} from './news-day.js';

export interface NewsPageRequest {readonly language:Locale;readonly cityId:string|null;readonly filter:NewsStreamFilter;readonly cursor:string|null;readonly period?:NewsPeriod;readonly sourceScope?:NewsSourceScope}
export interface NewsPageReader {read(query:NewsPageRequest):Promise<NewsPage>;readSources(cursor:string):Promise<NewsStorySourcesPage>}
export class NewsPageError extends Error {constructor(readonly code:NewsPageErrorCode){super(code);this.name='NewsPageError';}}
const NEWS_CURSOR_VERSION='news-cursor-6' as const;
const NEWS_COUNTRY_ORDER_VERSION='iptc17-source-scope-publisher-rounds-20261124' as const;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u;
const WRITER=/^[A-Za-z0-9_-]{43,128}$/u;
const HASH=/^[a-f0-9]{64}$/u;
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function validRequest(value:unknown):value is NewsPageRequest {
 return object(value)&&['language','cityId','filter','cursor'].every(key=>Object.hasOwn(value,key))
  &&Object.keys(value).every(key=>['language','cityId','filter','cursor','period','sourceScope'].includes(key))&&(value.period===undefined||validNewsPeriod(value.period))&&(value.sourceScope===undefined||validNewsSourceScope(value.sourceScope))&&localeFromPreference(value.language)!==null
  &&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&(value.cursor===null||typeof value.cursor==='string'&&value.cursor.length<=2048&&TOKEN.test(value.cursor));
}
export function parseNewsPageRequest(input:string|URL):NewsPageRequest {
 let url:URL;try{url=new URL(input instanceof URL?input.href:input,'https://www.dlkt.ee');}catch{throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');}
 const keys=['lang','category','city','cursor','period','sourceScope'],entries=[...url.searchParams];
 if(url.href.length>4096||url.hash||entries.some(([key])=>!keys.includes(key))||keys.some(key=>url.searchParams.getAll(key).length>1)
  ||url.searchParams.getAll('lang').length!==1)throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 const value={language:url.searchParams.get('lang'),cityId:url.searchParams.get('city'),filter:url.searchParams.get('category')??'all',cursor:url.searchParams.get('cursor'),
  ...(url.searchParams.has('period')?{period:url.searchParams.get('period')}: {}),...(url.searchParams.has('sourceScope')?{sourceScope:url.searchParams.get('sourceScope')}: {})};
 if(!validRequest(value))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 return value;
}
/** Source continuation carries context only in the signed cursor, never a caller-supplied URL. */
export function parseNewsSourcesRequest(input:string|URL):string|null {
 let url:URL;try{url=new URL(input instanceof URL?input.href:input,'https://www.dlkt.ee');}catch{throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');}
 if(!url.searchParams.has('sources'))return null;
 const entries=[...url.searchParams],token=url.searchParams.get('sources');
 if(url.href.length>4096||url.hash||entries.length!==1||entries[0]?.[0]!=='sources'||token===null||token.length>2048||!TOKEN.test(token))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
 return token;
}
interface Cursor {
 readonly version:typeof NEWS_CURSOR_VERSION;readonly orderVersion:typeof NEWS_COUNTRY_ORDER_VERSION;readonly epoch:string;readonly revision:number;readonly digest:string;
 readonly language:Locale;readonly cityId:string|null;readonly countryCode:string|null;readonly filter:NewsStreamFilter;readonly after:number;readonly startedAt:string;readonly expiresAt:string;
 readonly period:NewsPeriod;readonly sourceScope:NewsSourceScope;readonly day:NewsDayWindow|null;readonly kind:'page'|'sources';readonly storyKey:string|null;
}
function validCursor(value:unknown):value is Cursor {
 return object(value)&&exact(value,['version','orderVersion','epoch','revision','digest','language','cityId','countryCode','filter','after','startedAt','expiresAt','period','sourceScope','day','kind','storyKey'])
  &&value.version===NEWS_CURSOR_VERSION&&value.orderVersion===NEWS_COUNTRY_ORDER_VERSION&&validNewsEpochId(value.epoch)
  &&typeof value.revision==='number'&&Number.isSafeInteger(value.revision)&&value.revision>0&&typeof value.digest==='string'&&HASH.test(value.digest)
  &&localeFromPreference(value.language)!==null&&(value.cityId===null||validNewsCityId(value.cityId))&&validNewsStreamFilter(value.filter)
  &&(value.countryCode===null||typeof value.countryCode==='string'&&/^[A-Z]{2}$/u.test(value.countryCode))&&(value.cityId===null)===(value.countryCode===null)
  &&typeof value.after==='number'&&Number.isSafeInteger(value.after)&&value.after>=1&&value.after<5000
  &&(value.kind==='page'?value.storyKey===null&&value.after>=NEWS_SERVER_PAGE_SIZE&&value.after%NEWS_SERVER_PAGE_SIZE===0
   :value.kind==='sources'&&typeof value.storyKey==='string'&&/^story:[a-f0-9]{64}$/u.test(value.storyKey))
  &&stamp(value.startedAt)&&stamp(value.expiresAt)&&Date.parse(value.startedAt)<Date.parse(value.expiresAt)&&validNewsPeriod(value.period)&&validNewsSourceScope(value.sourceScope)
  &&(value.period==='recent'?value.day===null:object(value.day)&&typeof value.day.timeZone==='string'
   &&validNewsDayWindow(value.day,Date.parse(value.startedAt),value.day.timeZone)&&Date.parse(value.expiresAt)<=Date.parse(value.day.end));
}
interface OrderedEdition {readonly epoch:NewsCorpusEpoch;readonly items:readonly NewsStoryGroup[];readonly articleTotal:number;readonly counts:Readonly<Record<string,number>>;readonly coverage:NewsCountryCoverage;readonly expiresAt:string;readonly period:NewsPeriod;readonly day:NewsDayWindow|null}
function itemRecord(item:NewsStreamItem):NewsPageOriginal {
 return item.kind==='global'?{kind:'global',key:item.key,category:item.category,card:item.view.card}
  :{kind:'local',key:item.key,category:item.category,card:item.card};
}
function itemExpires(item:NewsStorySource):number {
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
 private decode(token:string,kind:Cursor['kind']):Cursor {
  if(token.length>2048||!TOKEN.test(token))throw new NewsPageError('NEWS_CURSOR_INVALID');
  const [encoded,signature]=token.split('.');if(!encoded||!signature)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const actual=Buffer.from(signature,'base64url'),expected=createHmac('sha256',this.key).update('dlkt-info/news-page/cursor/v1:'+encoded).digest();
  if(actual.length!==expected.length||actual.toString('base64url')!==signature||!timingSafeEqual(actual,expected))throw new NewsPageError('NEWS_CURSOR_INVALID');
  let value:unknown;
  try{const bytes=Buffer.from(encoded,'base64url');if(bytes.toString('base64url')!==encoded)throw Error('base64');value=JSON.parse(bytes.toString('utf8')) as unknown;}catch{throw new NewsPageError('NEWS_CURSOR_INVALID');}
  if(object(value)&&(value.version==='news-cursor-1'||value.version==='news-cursor-2'||value.version==='news-cursor-3'||value.version==='news-cursor-4'||value.version==='news-cursor-5'||value.version===NEWS_CURSOR_VERSION&&value.orderVersion!==NEWS_COUNTRY_ORDER_VERSION))throw new NewsPageError('NEWS_EDITION_EXPIRED');
  if(!validCursor(value)||value.kind!==kind)throw new NewsPageError('NEWS_CURSOR_INVALID');
  return value;
 }
 private ordered(epoch:NewsCorpusEpoch,query:NewsPageRequest,startedAt:string,countryCode:string|null,timeZone:string):OrderedEdition {
  const period=query.period??'recent',sourceScope=query.sourceScope??'edition';
  const key=JSON.stringify([epoch.epoch,epoch.digest,NEWS_COUNTRY_ORDER_VERSION,query.language,query.cityId,countryCode,startedAt,period,timeZone,sourceScope]),cached=this.orders.get(key);
  if(cached)return cached;
  if(epoch.corpus.orderVersion!==NEWS_ORDER_VERSION)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const at=Date.parse(startedAt),day=period==='today'?newsDayWindow(at,timeZone):null;
  const current=epoch.corpus.cards.filter(card=>(day===null||newsPublishedInDay(card.date,day))&&itemExpires({kind:'global',card})>at);
  const eligible=sourceScope==='all'?current:selectNewsLanguage(current,query.language),context={countryCode:null,preferredTopics:[]};
  // Rank within each provenance group, then keep national sources ahead inside
  // every category queue. The full same-language international corpus remains.
  const national=countryCode===null?[]:eligible.filter(card=>sourceEditionCountryCode(card)===countryCode);
  const international=countryCode===null?eligible:eligible.filter(card=>sourceEditionCountryCode(card)!==countryCode);
  const countryToday=selectContextualToday(national,context,at),worldToday=selectContextualToday(international,context,at);
  const today={first:[...countryToday.first,...countryToday.more],more:[...worldToday.first,...worldToday.more]};
  const local=epoch.corpus.local.filter(entry=>entry.city.id===query.cityId).flatMap(entry=>entry.snapshot.articles
   .filter(article=>(day===null||newsPublishedInDay(article.publishedAt,day))&&validLocalNewsArticle(article,entry.city,at)&&(sourceScope==='all'||newsLanguageMatches(newsFeed(article.sourceId)?.language??null,query.language))).map(article=>newsCard(article,entry.city)));
  const seed=JSON.stringify([NEWS_COUNTRY_ORDER_VERSION,epoch.epoch,query.language,query.cityId,countryCode,period,day?.date??null,sourceScope]);
  const originals=selectNewsStream(today,local,at,'all',seed),groups=groupNewsStories(originals.items.map(itemRecord));
  const byPrimary=new Map(groups.map(group=>[group.primary.key,group]));
  const representatives=originals.items.filter(item=>byPrimary.has(item.key));
  // Group the full edition before rebuilding the existing category rounds.
  // Related originals are never expanded back into standalone feed cards.
  const selection=selectNewsStream({first:representatives.flatMap(item=>item.kind==='global'?[item.view]:[]),more:[]},
   representatives.flatMap(item=>item.kind==='local'?[item.card]:[]),at,'all',seed);
  // One relevant local/national opening, then publisher/category diversity for
  // the whole immutable edition. Category filters and page boundaries never
  // restart these rounds, and every grouped original remains reachable.
  const items=Object.freeze(balanceNewsEdition(selection.items,
   item=>item.category??'other',item=>item.publisher,item=>{
    const group=byPrimary.get(item.key)!;
    if(group.primary.kind==='local')return 'local';
    return countryCode!==null&&sourceEditionCountryCode(group.primary.card)===countryCode?'national':'international';
   }).map(item=>byPrimary.get(item.key)!)),coverage={national:0,local:0,international:0};
  for(const group of items){
   const item=group.primary;
   if(item.kind==='local')coverage.local++;
   else if(countryCode!==null&&sourceEditionCountryCode(item.card)===countryCode)coverage.national++;
   else coverage.international++;
  }
  const sources=items.flatMap(group=>group.sources),articleTotal=sources.length;
  const expires=Math.min(Date.parse(epoch.expiresAt),Date.parse(epoch.generatedAt)+NEWS_CORPUS_MAX_AGE_MS,day===null?Infinity:Date.parse(day.end),...sources.map(itemExpires));
  const result={epoch,items,articleTotal,counts:selection.counts,coverage:Object.freeze(coverage),expiresAt:new Date(expires).toISOString(),period,day};
  if(this.orders.size>=16)this.orders.delete(this.orders.keys().next().value??'');
  this.orders.set(key,result);return result;
 }
 private sourceCursor(edition:OrderedEdition,query:NewsPageRequest,startedAt:string,countryCode:string|null,storyKey:string,after:number):string {
  const epoch=edition.epoch;
  return this.sign({version:NEWS_CURSOR_VERSION,orderVersion:NEWS_COUNTRY_ORDER_VERSION,kind:'sources',storyKey,
   epoch:epoch.epoch,revision:epoch.revision,digest:epoch.digest,language:query.language,cityId:query.cityId,countryCode,
   filter:query.filter,after,startedAt,expiresAt:edition.expiresAt,period:edition.period,sourceScope:query.sourceScope??'edition',day:edition.day});
 }
 private pageItem(group:NewsStoryGroup,edition:OrderedEdition,query:NewsPageRequest,startedAt:string,countryCode:string|null,preview=NEWS_STORY_PREVIEW_SIZE):NewsPageItem {
  if(group.sources.length===1)return group.primary;
  const related=Object.freeze(group.sources.slice(1,1+preview)),after=1+related.length;
  return Object.freeze({...group.primary,story:Object.freeze({key:group.storyKey,basis:group.basis==='single'?'matching-headlines' as const:group.basis,
   related,sourceTotal:group.sources.length,nextSourcesCursor:after<group.sources.length?this.sourceCursor(edition,query,startedAt,countryCode,group.storyKey,after):null})});
 }
 async read(query:NewsPageRequest):Promise<NewsPage> {
  if(!validRequest(query))throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
  const city=query.cityId===null?undefined:findCity(query.cityId)??undefined;
  if(query.cityId!==null&&!city)throw new NewsPageError('NEWS_PAGE_QUERY_INVALID');
  const countryCode=city?.countryCode??null,timeZone=city?.timezone??'UTC',period=query.period??'recent',sourceScope=query.sourceScope??'edition',cursor=query.cursor===null?null:this.decode(query.cursor,'page'),now=this.clock();
  if(cursor&&(cursor.language!==query.language||cursor.cityId!==query.cityId||cursor.countryCode!==countryCode||cursor.filter!==query.filter||cursor.period!==period||cursor.sourceScope!==sourceScope
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
  const filtered=edition.items.filter(group=>query.filter==='all'||(group.primary.category??'other')===query.filter),after=cursor?.after??0;
  if(after>filtered.length||cursor&&after===filtered.length)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const visibleGroups=filtered.slice(after,after+NEWS_SERVER_PAGE_SIZE),items=visibleGroups.map(group=>this.pageItem(group,edition,query,startedAt,countryCode)),next=after+items.length;
  const nextCursor=next<filtered.length?this.sign({version:NEWS_CURSOR_VERSION,orderVersion:NEWS_COUNTRY_ORDER_VERSION,kind:'page',storyKey:null,epoch:epoch.epoch,revision:epoch.revision,digest:epoch.digest,
   language:query.language,cityId:query.cityId,countryCode,filter:query.filter,after:next,startedAt,expiresAt:edition.expiresAt,period,sourceScope,day:edition.day}):null;
  let page:NewsPage={version:NEWS_PAGE_VERSION,epoch:epoch.epoch,revision:epoch.revision,generatedAt:epoch.generatedAt,startedAt,expiresAt:edition.expiresAt,
   language:query.language,sourceScope,cityId:query.cityId,countryCode,coverage:edition.coverage,period,day:edition.day,filter:query.filter,items,total:edition.items.length,articleTotal:edition.articleTotal,filteredTotal:filtered.length,counts:edition.counts,nextCursor};
  // Only the preview is reduced to meet the existing transport boundary.
  // Every remaining original stays reachable through its signed source cursor.
  while(Buffer.byteLength(JSON.stringify(page),'utf8')>NEWS_MAX_RESPONSE_BYTES){
   let drop=-1;for(let index=page.items.length-1;index>=0;index--)if((page.items[index]?.story?.related.length??0)>0){drop=index;break;}
   if(drop<0)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
   const previous=page.items[drop]!.story!;
   page={...page,items:page.items.map((item,index)=>index===drop?this.pageItem(visibleGroups[index]!,edition,query,startedAt,countryCode,previous.related.length-1):item)};
  }
  completed=this.clock();
  if(Date.parse(page.expiresAt)<=completed)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  if(!validNewsPage(page,completed,city))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  return Object.freeze(page);
 }
 async readSources(token:string):Promise<NewsStorySourcesPage> {
  const cursor=this.decode(token,'sources'),city=cursor.cityId===null?undefined:findCity(cursor.cityId)??undefined;
  if(cursor.cityId!==null&&!city||cursor.countryCode!==(city?.countryCode??null))throw new NewsPageError('NEWS_CONTEXT_MISMATCH');
  if(cursor.period==='today'&&!validNewsDayWindow(cursor.day,Date.parse(cursor.startedAt),city?.timezone??'UTC'))throw new NewsPageError('NEWS_CONTEXT_MISMATCH');
  if(Date.parse(cursor.expiresAt)<=this.clock())throw new NewsPageError('NEWS_EDITION_EXPIRED');
  let epoch:NewsCorpusEpoch|null;
  try{epoch=await this.store.read(cursor.epoch);}catch{throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');}
  if(!epoch||epoch.epoch!==cursor.epoch||epoch.revision!==cursor.revision||epoch.digest!==cursor.digest)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  if(Date.parse(cursor.startedAt)<Date.parse(epoch.generatedAt)-5000||Date.parse(cursor.startedAt)>this.clock()+5000)throw new NewsPageError('NEWS_CURSOR_INVALID');
  const query:NewsPageRequest={language:cursor.language,cityId:cursor.cityId,filter:cursor.filter,cursor:null,period:cursor.period,sourceScope:cursor.sourceScope};
  const committed=epoch,edition=this.ordered(committed,query,cursor.startedAt,cursor.countryCode,city?.timezone??'UTC');
  if(cursor.expiresAt!==edition.expiresAt||Date.parse(edition.expiresAt)<=this.clock())throw new NewsPageError('NEWS_EDITION_EXPIRED');
  const group=edition.items.find(item=>item.storyKey===cursor.storyKey);
  if(!group||cursor.filter!=='all'&&(group.primary.category??'other')!==cursor.filter||cursor.after>=group.sources.length)throw new NewsPageError('NEWS_CURSOR_INVALID');
  let end=Math.min(cursor.after+NEWS_SOURCE_PAGE_SIZE,group.sources.length);
  const build=():NewsStorySourcesPage=>({version:NEWS_STORY_SOURCES_VERSION,epoch:committed.epoch,revision:committed.revision,
   generatedAt:committed.generatedAt,startedAt:cursor.startedAt,expiresAt:edition.expiresAt,language:cursor.language,sourceScope:cursor.sourceScope,cityId:cursor.cityId,countryCode:cursor.countryCode,
   period:edition.period,day:edition.day,filter:cursor.filter,storyKey:group.storyKey,sourceTotal:group.sources.length,offset:cursor.after,
   sources:Object.freeze(group.sources.slice(cursor.after,end)),nextCursor:end<group.sources.length?this.sourceCursor(edition,query,cursor.startedAt,cursor.countryCode,group.storyKey,end):null});
  let page=build();
  while(Buffer.byteLength(JSON.stringify(page),'utf8')>NEWS_MAX_RESPONSE_BYTES){
   if(end-cursor.after<=1)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');end--;page=build();
  }
  const completed=this.clock();
  if(Date.parse(page.expiresAt)<=completed)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  if(!validNewsStorySourcesPage(page,completed,city))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  return Object.freeze(page);
 }
}
export function createNewsPageService(environment:Readonly<Record<string,string|undefined>>,fetcher:PersistenceFetch=fetch):NewsPageReader|null {
 const store=createNewsCorpusStore(environment,fetcher),key=environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
 return store&&key&&WRITER.test(key)?new NewsPageService(store,key):null;
}
