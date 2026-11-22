import type {EvidenceCard} from './contracts.js';
import {validCard} from './card-validation.js';
import {NEWS_CATEGORIES,isNewsCategoryId,newsCategory,type NewsCategoryId} from './news-taxonomy.js';
import type {NewsStreamFilter} from './news-stream.js';
import {sourceLanguage,newsLanguageMatches,sourceEditionCountryCode} from './news-sources.js';
import {localeFromPreference,type Locale} from '../i18n/locale.js';
import {validCity,type LocalCard,type City} from '../local/contracts.js';
import {newsFeed,validLocalNewsArticle,NEWS_WINDOW_MS} from '../local/news-policy.js';
import {newsPublishedInDay,validNewsDayWindow,validNewsPeriod,type NewsPeriod,type NewsDayWindow} from './news-day.js';
export type {NewsPeriod,NewsDayWindow} from './news-day.js';

export const NEWS_PAGE_VERSION='dlkt-news-page-3' as const;
export const NEWS_SERVER_PAGE_SIZE=20;
export type NewsPageItem=
 |{readonly kind:'global';readonly key:string;readonly category:NewsCategoryId|null;readonly card:EvidenceCard}
 |{readonly kind:'local';readonly key:string;readonly category:NewsCategoryId|null;readonly card:LocalCard};
/** Full edition counts. National means reviewed publisher-edition provenance, not a story's event location. */
export interface NewsCountryCoverage {readonly national:number;readonly local:number;readonly international:number}
export interface NewsPage {
 readonly version:typeof NEWS_PAGE_VERSION;readonly epoch:string;readonly revision:number;
 readonly generatedAt:string;readonly startedAt:string;readonly expiresAt:string;readonly language:Locale;readonly cityId:string|null;readonly countryCode:string|null;
 readonly coverage:NewsCountryCoverage;readonly period:NewsPeriod;readonly day:NewsDayWindow|null;
 readonly filter:NewsStreamFilter;readonly items:readonly NewsPageItem[];
 readonly total:number;readonly filteredTotal:number;readonly counts:Readonly<Record<string,number>>;
 readonly nextCursor:string|null;
}
export type NewsPageErrorCode='NEWS_PAGE_QUERY_INVALID'|'NEWS_CURSOR_INVALID'|'NEWS_CONTEXT_MISMATCH'|'NEWS_EDITION_EXPIRED'|'NEWS_CORPUS_UNAVAILABLE';
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fields=(value:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[]):boolean=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const integer=(value:unknown,max=5000):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const bounded=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
export const validNewsCityId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,11}$/u.test(value);
export const validNewsEpochId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,15}$/u.test(value)&&Number.isSafeInteger(Number(value));
export const validNewsStreamFilter=(value:unknown):value is NewsStreamFilter=>value==='all'||value==='other'||isNewsCategoryId(value);
const GLOBAL_REQUIRED=['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState'];
const GLOBAL_OPTIONAL=['summary','byline','licenseUrl','context','articleSubject'];
const LOCAL_REQUIRED=['id','kind','title','text','publisher','sourceUrl','sourceUpdatedAt','checkedAt','validFrom','validTo','facts','boundary','context','news'];
const NEWS_REQUIRED=['id','sourceId','title','publisher','url','publishedAt','checkedAt','validUntil','topic','cityId','geographyBasis','geoAnchors','documentHash','documentUrl','attribution'];
const CONTEXT_REQUIRED=['section','place','when','why','action','sourceDate','startsAt','status','documentHash','documentUrl'];

/** Exact public field allowlist; server persistence also verifies the cryptographic record identity. */
export function validNewsGlobalCard(value:unknown,now:number):value is EvidenceCard {
 if(!Number.isFinite(now)||!object(value)||!fields(value,GLOBAL_REQUIRED,GLOBAL_OPTIONAL)||!validCard(value)
  ||value.kind!=='publication'||value.dateLabel!=='Published'||value.sourceState==='stale'||value.sourceIds.length===0||value.sourceIds.length>100
  ||new Set(value.sourceIds).size!==value.sourceIds.length)return false;
 const published=Date.parse(value.date),observed=Date.parse(value.observedAt);
 return published<=now&&published>now-86400000&&observed<=now+300000&&observed>now-3600000;
}
/** Local article metadata is validated against the existing reviewed city/source policy. */
export function validNewsLocalCard(value:unknown,cityId:string,now:number,city?:City):value is LocalCard {
 if(!city||!validCity(city)||city.id!==cityId||!object(value)||!exact(value,LOCAL_REQUIRED)||!object(value.news)||!fields(value.news,NEWS_REQUIRED,['summary','byline','licenseUrl'])
  ||!validLocalNewsArticle(value.news,city,now)||!object(value.context)||!exact(value.context,CONTEXT_REQUIRED))return false;
 const article=value.news,context=value.context;
 return value.kind==='local-news'&&value.id===article.id&&value.title===article.title
  &&value.text===(article.summary??'Read the publisher report for the complete details.')
  &&value.publisher===article.publisher&&value.sourceUrl===article.url&&value.sourceUpdatedAt===null
  &&value.checkedAt===article.checkedAt&&value.validFrom===article.checkedAt&&value.validTo===article.validUntil
  &&Array.isArray(value.facts)&&value.facts.length===0&&bounded(value.boundary,1000)
  &&context.section==='context'&&context.status==='publisher-announcement'&&context.place===city.name
  &&context.when==='Published '+article.publishedAt&&bounded(context.why,1000)&&bounded(context.action,1000)
  &&context.sourceDate===article.publishedAt.slice(0,10)&&context.startsAt===null
  &&context.documentHash===article.documentHash&&context.documentUrl===article.documentUrl;
}
export function validNewsPageItem(value:unknown,now:number,city?:City):value is NewsPageItem {
 if(!object(value)||!exact(value,['kind','key','category','card'])||(value.category!==null&&!isNewsCategoryId(value.category)))return false;
 if(value.kind==='global')return validNewsGlobalCard(value.card,now)&&value.key==='article:'+value.card.id&&value.category===newsCategory(value.card);
 return value.kind==='local'&&object(value.card)&&object(value.card.news)&&validNewsCityId(value.card.news.cityId)
  &&validNewsLocalCard(value.card,value.card.news.cityId,now,city)&&value.key==='local:'+value.card.id&&value.category===newsCategory(value.card);
}
/** Browser-safe boundary. Context continuity and cross-page duplicates are checked by the reader controller. */
export function validNewsPage(value:unknown,now=Date.now(),city?:City):value is NewsPage {
 if(!Number.isFinite(now)||!object(value)||!exact(value,['version','epoch','revision','generatedAt','startedAt','expiresAt','language','cityId','countryCode','coverage','period','day','filter','items','total','filteredTotal','counts','nextCursor'])
  ||value.version!==NEWS_PAGE_VERSION||!validNewsPeriod(value.period)||!validNewsEpochId(value.epoch)||!integer(value.revision,Number.MAX_SAFE_INTEGER)||value.revision===0
  ||!timestamp(value.generatedAt)||!timestamp(value.startedAt)||!timestamp(value.expiresAt)||Date.parse(value.generatedAt)>now+5000
  ||Date.parse(value.startedAt)>now+5000||Date.parse(value.startedAt)<Date.parse(value.generatedAt)-5000||Date.parse(value.expiresAt)<=Date.parse(value.startedAt)||Date.parse(value.expiresAt)<=now
  ||Date.parse(value.expiresAt)>Date.parse(value.generatedAt)+3600000||Date.parse(value.expiresAt)<=Date.parse(value.generatedAt)
  ||localeFromPreference(value.language)===null||(value.cityId!==null&&!validNewsCityId(value.cityId))||!validNewsStreamFilter(value.filter)
  ||(value.countryCode!==null&&(typeof value.countryCode!=='string'||!/^[A-Z]{2}$/u.test(value.countryCode)))
  ||(value.cityId===null)!==(value.countryCode===null)
  ||city!==undefined&&(!validCity(city)||value.cityId!==city.id||value.countryCode!==city.countryCode)
  ||!object(value.coverage)||!exact(value.coverage,['national','local','international'])||!Object.values(value.coverage).every(count=>integer(count))
  ||Number(value.coverage.national)+Number(value.coverage.local)+Number(value.coverage.international)!==value.total
  ||value.countryCode===null&&(value.coverage.national!==0||value.coverage.local!==0)
  ||!integer(value.total)||!integer(value.filteredTotal)||value.filteredTotal>value.total
  ||!object(value.counts)||!exact(value.counts,['other',...NEWS_CATEGORIES.map(category=>category.id)])||!Object.values(value.counts).every(count=>integer(count))
  ||Object.values(value.counts).reduce<number>((sum,count)=>sum+Number(count),0)!==value.total
  ||value.filteredTotal!==(value.filter==='all'?value.total:value.counts[value.filter])
  ||!Array.isArray(value.items)||value.items.length>NEWS_SERVER_PAGE_SIZE||value.items.length>value.filteredTotal
  ||(value.nextCursor!==null&&(!bounded(value.nextCursor,2048)||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(value.nextCursor)||value.items.length!==NEWS_SERVER_PAGE_SIZE))
  ||(value.filteredTotal===0&&(value.items.length!==0||value.nextCursor!==null)))return false;
 if(value.period==='recent'){if(value.day!==null)return false;}
 else if(value.cityId!==null&&city===undefined||!validNewsDayWindow(value.day,Date.parse(value.startedAt),city?.timezone??'UTC')
  ||Date.parse(value.expiresAt)>Date.parse(value.day.end))return false;
 const day=value.period==='today'?value.day as NewsDayWindow:null;
 const language=value.language as Locale,keys=new Set<string>(),ids=new Set<string>(),urls=new Set<string>(),identities=new Set<string>();
 const observed={national:0,local:0,international:0};
 for(const item of value.items){
  if(!validNewsPageItem(item,now,city)||(value.filter!=='all'&&(item.category??'other')!==value.filter)
   ||day!==null&&!newsPublishedInDay(item.kind==='global'?item.card.date:item.card.news!.publishedAt,day))return false;
  const url=item.card.sourceUrl,identity=item.kind==='global'?item.card.identity:url;
  if(keys.has(item.key)||ids.has(item.card.id)||urls.has(url)||identities.has(identity))return false;
  keys.add(item.key);ids.add(item.card.id);urls.add(url);identities.add(identity);
  if(item.kind==='global'){
   if(value.countryCode!==null&&sourceEditionCountryCode(item.card)===value.countryCode)observed.national++;else observed.international++;
   if(!newsLanguageMatches(sourceLanguage(item.card),language)||Date.parse(value.expiresAt)>Math.min(Date.parse(item.card.observedAt)+3600000,Date.parse(item.card.date)+86400000))return false;
  }else{
   observed.local++;
   const article=item.card.news;
   if(!article||article.cityId!==value.cityId||!newsLanguageMatches(newsFeed(article.sourceId)?.language??null,language)
    ||Date.parse(value.expiresAt)>Math.min(Date.parse(article.validUntil),Date.parse(article.publishedAt)+NEWS_WINDOW_MS+1))return false;
  }
 }
 return observed.national<=Number(value.coverage.national)&&observed.local<=Number(value.coverage.local)&&observed.international<=Number(value.coverage.international);
}
