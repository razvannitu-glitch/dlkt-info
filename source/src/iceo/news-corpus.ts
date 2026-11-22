import type {EvidenceCard,SourceHealth} from './contracts.js';
import type {City} from '../local/contracts.js';
import type {CityNewsSnapshot} from '../local/news-policy.js';

export const NEWS_CORPUS_VERSION='dlkt-news-corpus-1' as const;
export const NEWS_ORDER_VERSION='iptc17-rounds-20261122' as const;
export const NEWS_CORPUS_MAX_ARTICLES=5000;
export const NEWS_CORPUS_MAX_BYTES=8*1024*1024;
export const NEWS_CORPUS_MAX_AGE_MS=60*60*1000;
/** Full verified records before the compatibility snapshot's byte limit. */
export interface NewsCorpusLocal {readonly city:City;readonly snapshot:CityNewsSnapshot}
export interface NewsCorpus {
 readonly version:typeof NEWS_CORPUS_VERSION;readonly orderVersion:typeof NEWS_ORDER_VERSION;
 readonly generatedAt:string;readonly cards:readonly EvidenceCard[];readonly sources:readonly SourceHealth[];
 readonly local:readonly NewsCorpusLocal[];
}
export interface NewsCorpusEpoch {
 readonly version:'dlkt-news-epoch-1';readonly epoch:string;readonly revision:number;
 readonly generatedAt:string;readonly publishedAt:string;readonly expiresAt:string;
 readonly digest:string;readonly corpus:NewsCorpus;
}

import {createHash} from 'node:crypto';
import type {IceoSnapshot} from './contracts.js';
import {validArchiveCard} from '../share/archive.js';
import {ICEO_SOURCES} from './registry.js';
import {validNewsGlobalCard} from './news-page-contracts.js';
import {publicSnapshotDigest} from './refresh-ledger.js';
import {findCity} from '../local/cities.js';
import {validCity} from '../local/contracts.js';
import {CITY_NEWS_FEEDS,newsFeedsFor,newsFeed,validLocalNewsArticle} from '../local/news-policy.js';
import {localNewsService} from '../local/news-service.js';

const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fields=(value:Record<string,unknown>,required:readonly string[],optional:readonly string[]=[]):boolean=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const stamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const count=(value:unknown,max=Number.MAX_SAFE_INTEGER):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const HEALTH_KEYS=['id','label','publisher','topic','state','checkedAt','verifiedAt','count','rejected','error','retryAt','scope','termsUrl','windowed'];
const CITY_KEYS=['id','name','countryCode','country','region','lat','lon','timezone'];
const NEWS_KEYS=['id','sourceId','title','publisher','url','publishedAt','checkedAt','validUntil','topic','cityId','geographyBasis','geoAnchors','documentHash','documentUrl','attribution'];
function sourceHealth(value:unknown,cards:readonly EvidenceCard[],now:number):value is SourceHealth {
 if(!object(value)||!exact(value,HEALTH_KEYS)||typeof value.id!=='string')return false;
 const definition=ICEO_SOURCES.find(source=>source.id===value.id);
 return definition!==undefined&&value.label===definition.label&&value.publisher===definition.publisher&&value.topic===definition.topic&&value.termsUrl===definition.termsUrl
  &&['verified','partial','stale','unavailable'].includes(String(value.state))&&stamp(value.checkedAt)&&Date.parse(value.checkedAt)<=now+300000
  &&(value.verifiedAt===null||stamp(value.verifiedAt)&&Date.parse(value.verifiedAt)<=now+300000)
  &&count(value.count,5000)&&value.count===cards.filter(card=>card.sourceIds.includes(definition.id)).length&&count(value.rejected)
  &&(value.error===null||typeof value.error==='string'&&/^[A-Z][A-Z0-9_]{0,199}$/u.test(value.error))
  &&(value.retryAt===null||stamp(value.retryAt))&&text(value.scope,8000)&&value.windowed===true
  &&(value.state!=='unavailable'||value.count===0);
}
function localCorpus(value:unknown,now:number):value is NewsCorpusLocal {
 if(!object(value)||!exact(value,['city','snapshot'])||!object(value.city)||!exact(value.city,CITY_KEYS)||!validCity(value.city))return false;
 const city=findCity(value.city.id),snapshot=value.snapshot;
 if(!city||publicSnapshotDigest(city)!==publicSnapshotDigest(value.city)||newsFeedsFor(city).length===0
  ||!object(snapshot)||!exact(snapshot,['articles','sources'])||!Array.isArray(snapshot.articles)||snapshot.articles.length>5000||!Array.isArray(snapshot.sources))return false;
 const ids=new Set<string>(),urls=new Set<string>();
 for(const article of snapshot.articles){
  if(!object(article)||!fields(article,NEWS_KEYS,['summary','byline','licenseUrl'])||!validLocalNewsArticle(article,city,now)
   ||article.id!=='local-news:'+city.id+':'+article.sourceId+':'+createHash('sha256').update(article.url).digest('hex').slice(0,24)
   ||ids.has(article.id)||urls.has(article.url))return false;
  ids.add(article.id);urls.add(article.url);
 }
 const definitions=newsFeedsFor(city);
 if(snapshot.sources.length!==definitions.length||new Set(snapshot.sources.map(source=>object(source)?source.sourceId:null)).size!==snapshot.sources.length)return false;
 return snapshot.sources.every(source=>{
  if(!object(source)||!exact(source,['sourceId','publisher','feedUrl','termsUrl','state','checkedAt','count','rejected','error'])||typeof source.sourceId!=='string')return false;
  const definition=newsFeed(source.sourceId);
  if(!definition||!definitions.includes(definition)||source.publisher!==definition.publisher||source.feedUrl!==definition.endpoint||source.termsUrl!==definition.termsUrl
   ||!['ready','partial','unavailable'].includes(String(source.state))||!count(source.count,5000)||!count(source.rejected))return false;
  const articles=snapshot.articles.filter(article=>object(article)&&article.sourceId===definition.id);
  if(source.count!==articles.length)return false;
  if(source.state==='unavailable')return source.checkedAt===null&&source.count===0&&typeof source.error==='string'&&/^[A-Z][A-Z0-9_]{1,80}$/u.test(source.error);
  return source.error===null&&stamp(source.checkedAt)&&Date.parse(source.checkedAt)<=now+5000&&Date.parse(source.checkedAt)>now-300000
   &&articles.every(article=>object(article)&&article.checkedAt===source.checkedAt)&&((source.state==='partial')===(Number(source.rejected)>0));
 });
}
/** Revalidate stored records at their fixed generation time. Request-time expiry is context-specific. */
export function validNewsCorpus(value:unknown,now=Date.now()):value is NewsCorpus {
 if(!Number.isFinite(now)||!object(value)||!exact(value,['version','orderVersion','generatedAt','cards','sources','local'])
  ||value.version!==NEWS_CORPUS_VERSION||value.orderVersion!==NEWS_ORDER_VERSION||!stamp(value.generatedAt)
  ||Date.parse(value.generatedAt)>now+5000||Date.parse(value.generatedAt)<=now-NEWS_CORPUS_MAX_AGE_MS
  ||!Array.isArray(value.cards)||value.cards.length>NEWS_CORPUS_MAX_ARTICLES||!Array.isArray(value.sources)||value.sources.length===0||value.sources.length>100
  ||!Array.isArray(value.local)||value.local.length>new Set(CITY_NEWS_FEEDS.map(feed=>feed.cityId)).size)return false;
 const generated=Date.parse(value.generatedAt),cards:EvidenceCard[]=[],ids=new Set<string>(),identities=new Set<string>(),urls=new Set<string>();
 for(const card of value.cards){
  if(!validNewsGlobalCard(card,generated)||!validArchiveCard(card)||ids.has(card.id)||identities.has(card.identity)||urls.has(card.sourceUrl)
   ||card.sourceIds.some(id=>{const source=ICEO_SOURCES.find(entry=>entry.id===id);return !source||new Date(generated).toISOString().slice(0,10)>source.rightsReviewBy;}))return false;
  ids.add(card.id);identities.add(card.identity);urls.add(card.sourceUrl);cards.push(card);
 }
 if(new Set(value.sources.map(source=>object(source)?source.id:null)).size!==value.sources.length||!value.sources.every(source=>sourceHealth(source,cards,generated)))return false;
 const available=new Set(value.sources.filter(source=>object(source)&&source.state!=='unavailable').map(source=>source.id));
 if(cards.some(card=>card.sourceIds.some(id=>!available.has(id)))||!value.local.every(entry=>localCorpus(entry,generated))
  ||new Set(value.local.map(entry=>entry.city.id)).size!==value.local.length
  ||cards.length+value.local.reduce((total,entry)=>total+entry.snapshot.articles.length,0)>NEWS_CORPUS_MAX_ARTICLES)return false;
 try{return Buffer.byteLength(JSON.stringify(value),'utf8')<=NEWS_CORPUS_MAX_BYTES;}catch{return false;}
}
/** The compatibility snapshot may contain non-news; only current original publications enter this corpus. */
export function buildNewsCorpus(snapshot:IceoSnapshot,local:readonly NewsCorpusLocal[],now:number):NewsCorpus {
 if(!Number.isFinite(now)||!stamp(snapshot.generatedAt))throw Error('NEWS_CORPUS_INVALID');
 const generated=Date.parse(snapshot.generatedAt);
 const cards=snapshot.cards.filter(card=>card.kind==='publication'&&card.dateLabel==='Published'&&card.sourceState!=='stale'
  &&Date.parse(card.date)<=generated&&Date.parse(card.date)>generated-86400000&&Date.parse(card.observedAt)>generated-3600000);
 const sources=snapshot.sources.map(source=>({...source,count:cards.filter(card=>card.sourceIds.includes(source.id)).length}));
 const value:NewsCorpus={version:NEWS_CORPUS_VERSION,orderVersion:NEWS_ORDER_VERSION,generatedAt:snapshot.generatedAt,cards,sources,local};
 if(!validNewsCorpus(value,now))throw Error('NEWS_CORPUS_INVALID');
 return Object.freeze(value);
}
/** Only invoked by the authenticated collector; no public page read calls this helper. */
export async function collectCorpusLocalNews(signal?:AbortSignal):Promise<readonly NewsCorpusLocal[]> {
 if(signal?.aborted)throw Error('NEWS_CORPUS_ABORTED');
 const cities=[...new Set(CITY_NEWS_FEEDS.map(source=>source.cityId))].map(id=>findCity(id));
 if(cities.some(city=>city===null))throw Error('NEWS_CORPUS_CITY_INVALID');
 const pending=Promise.all(cities.map(async city=>({city:city!,snapshot:await localNewsService.snapshot(city!,{full:true})})));
 if(!signal)return pending;
 let abort:()=>void=()=>{};
 try{return await Promise.race([pending,new Promise<never>((_resolve,reject)=>{
  abort=()=>reject(Error('NEWS_CORPUS_ABORTED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 })]);}finally{signal.removeEventListener('abort',abort);}
}
