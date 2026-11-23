import {createHash} from 'node:crypto';
import {completeDigi24TruncatedHeadline} from './digi24-metadata.js';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseDocument,DomUtils} from 'htmlparser2';
import type {ArticleSubjectMetadata,EvidenceCard,SourceResult} from './contracts.js';
import {cardContent,validCard} from './card-validation.js';
import {COMPARISON_MAX_AGE_MS} from './comparison.js';
import {classifyEvidenceCard,classifyNewsSubject,type NewsCategoryId} from './news-taxonomy.js';
import {newsDayWindow,newsPublishedInDay,type NewsDayWindow} from './news-day.js';
import {groupStories} from './story-grouping.js';
import {consistentCards} from './evidence-consistency.js';
import {collectFrontpageHighlights} from './news-frontpages.js';
import {NewsDiagnosticsBuilder,type NewsDiagnostics} from './news-diagnostics.js';
import {EDITORIAL_CATEGORY_TOPICS,classifyNewsHeadline,headlineDiscoveryPriority,type PublicEditorialCategory} from './editorial-categories.js';
import {NEWS_INDEX_URL,NEWS_PUBLISHERS,NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE,NEWS_FEATURED_SOURCE,NEWS_DISCOVERY_INDEXES,NEWS_SOURCES,canonicalNewsUrl,publisherForNewsUrl,sourcePublicationContext,sourceLanguage,type NewsDiscoveryIndex,type NewsSourceLanguage} from './news-sources.js';

/** Untrusted discovery metadata. indexedAt is never a publisher publication date. */
export interface NewsCandidate {readonly sourceUrl:string;readonly title:string;readonly publisher:string;readonly indexedAt:string;readonly category:PublicEditorialCategory|null}
export interface NewsDiscoveryOptions {readonly deadlineMs?:number;readonly requestTimeoutMs?:number;readonly maxArticleRequests?:number;readonly concurrency?:number;readonly publisherIndexes?:boolean;readonly publisherIndexBatch?:number;readonly frontpageHighlights?:boolean;readonly originBackoff?:Map<string,string|null>;readonly retainedCards?:readonly EvidenceCard[]}
const DAY=86_400_000,INDEX_BYTES=3_145_728,HTML_BYTES=1_048_576,MAX_CANDIDATES=5000;
export const NEWS_ACQUISITION_ROTATION_MS=120_000;

/** Acquisition objectives, never a claim that incomplete source supply is complete. */
export const NEWS_CATEGORY_ACQUISITION_POLICY=Object.freeze({minimum:7,target:10});
const promotionMarker=/^\s*(?:\[(?:p|advertorial|publicitate)\]|\((?:p|advertorial|publicitate)\))|^\s*(?:advertorial|publicitate)\s*[:–—-]|(?:\[(?:p|advertorial|publicitate)\]|\((?:p|advertorial|publicitate)\))\s*$/iu;
function explicitlyPromotional(title:string):boolean{return promotionMarker.test(title);}
const headlineIdentity=(title:string):string=>title.normalize('NFKC').toLowerCase().replace(/\s+/gu,' ').trim();

/** Only this exact reviewed publisher's separated suffix is decoration. */
function publisherHeadline(title:string,publisher:string):string{
 const normalized=headlineIdentity(title),label=headlineIdentity(publisher);
 if(!NEWS_PUBLISHERS.some(value=>value.label===publisher))return normalized;
 for(const separator of [' – ',' — ',' | ',' : ',' - ']){
  const suffix=separator+label;if(normalized.endsWith(suffix))return normalized.slice(0,-suffix.length).trim();
 }
 return normalized;
}

/** The same exact eligibility boundary governs both retention and acquisition planning. */
function eligibleRetainedNewsCards(values:readonly EvidenceCard[],now:number):readonly EvidenceCard[]{
 return consistentCards(values.slice(0,5000).filter(validCard)).filter(card=>{
  if(card.id!==digest(card.identity).slice(0,24)||card.contentHash!==digest(cardContent(card))
   ||Object.keys(card).some(key=>!['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState','summary','byline','licenseUrl','context','articleSubject'].includes(key))
   ||card.kind!=='publication'||card.dateLabel!=='Published'||card.sourceState==='stale'||explicitlyPromotional(card.title))return false;
  const published=Date.parse(card.date),observed=Date.parse(card.observedAt),publisher=publisherForNewsUrl(card.sourceUrl);
  const categoryIds=card.sourceIds.filter(id=>id===NEWS_UNCLASSIFIED_SOURCE.id||NEWS_CATEGORY_SOURCES.some(source=>source.id===id));
  return publisher?.label===card.publisher&&canonicalNewsUrl(card.sourceUrl)===card.sourceUrl&&card.identity===card.sourceUrl
   &&published<=now&&published>now-DAY&&observed<=now+300_000&&now-observed<COMPARISON_MAX_AGE_MS
   &&categoryIds.length===1&&card.sourceIds.every(id=>id===NEWS_FEATURED_SOURCE.id||id===categoryIds[0]);
 });
}


/**
 * Cycle every reviewed publisher index, without re-fetching all registries
 * every two minutes. GDELT remains an independent always-on index.
 * The batch is selected exclusively from the static reviewed allowlist.
 */
export function rotatedPublisherIndexes(now:number,batchSize:number=NEWS_DISCOVERY_INDEXES.length):readonly NewsDiscoveryIndex[]{
 if(!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>NEWS_DISCOVERY_INDEXES.length)
  throw new Error('NEWS_INDEX_ROTATION_INVALID');
 const groups=Math.ceil(NEWS_DISCOVERY_INDEXES.length/batchSize);
 const group=Math.floor(now/NEWS_ACQUISITION_ROTATION_MS)%groups;
 return Object.freeze(NEWS_DISCOVERY_INDEXES.slice(group*batchSize,(group+1)*batchSize));
}

const KEYS=['category','indexedAt','publisher','sourceUrl','title'];
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function titleText(value:unknown):string|null{
  if(typeof value!=='string')return null;
  // GAL sometimes XML-escapes an already HTML-escaped headline. Decode text entities once.
  if(/[<>]/u.test(value))return null;
  const clean=DomUtils.textContent(parseDocument(value,{decodeEntities:true})).normalize('NFC').replace(/\s+/gu,' ').trim();
  return clean.length>0&&clean.length<=200&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(clean)?clean:null;
}
export function validateNewsCandidate(value:unknown,now:number):NewsCandidate|null{
  if(!Number.isFinite(now)||!object(value)||Object.keys(value).sort().join('|')!==KEYS.join('|')||typeof value.sourceUrl!=='string'||typeof value.indexedAt!=='string')return null;
  const sourceUrl=canonicalNewsUrl(value.sourceUrl),title=titleText(value.title),publisher=publisherForNewsUrl(value.sourceUrl),indexed=Date.parse(value.indexedAt);
  if(!sourceUrl||!title||explicitlyPromotional(title)||!publisher||value.publisher!==publisher.label||!Number.isFinite(indexed)||indexed<now-DAY||indexed>now+300_000||!/^\d{4}-\d\d-\d\dT/u.test(value.indexedAt))return null;
  const category=classifyNewsHeadline(title,sourceUrl);
  if(value.category!==category)return null;
  return Object.freeze({sourceUrl,title,publisher:publisher.label,indexedAt:new Date(indexed).toISOString(),category});
}
/** No query-specific brand/event priorities. This is a cheap acquisition order, not a truth score. */
function acquisitionScore(value:NewsCandidate):number{
  const text=value.title.toLowerCase().normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC');
  return (/\b(?:announces?|launch(?:es|ed)?|approves?|agrees?|signs?|wins?|discovers?|reveals?|cuts?|raises?|opens?|closes?|elections?|earthquake|ceasefire|record|new|first|annonce|annoncent|lance|lancent|approuve|approuvent|signe|signent|remporte|decouvre|decouvrent|revele|ouvre|nouveau|nouvelle|premier|premiere|seisme|cessez-le-feu|anuncia|anuncian|lanza|lanzan|aprueba|firman|gana|descubren|nuevo|nueva|estrena|kundigt|startet|genehmigt|vereinbart|entdeckt|offnet|neue?r?|erstmals|lanca|aprova|vence|descobre|novo|nova|primeiro|primeira)\b|يعلن|تعلن|يطلق|تطلق|يوافق|توافق|يكتشف|تكتشف|جديد|発表|発売|承認|合意|締結|優勝|発見|開設|初めて|停戦/u.test(text)?10:0)
    -(/\b(?:review|opinion|horoscope|quiz|best deals|buying guide|how to|what to know|explained|live updates|avis|tribune|guide d'achat|comment faire|ce qu'il faut savoir|en direct|horoscopo|guia de compra|como hacer|en vivo|meinung|horoskop|kaufberatung|opiniao|ao vivo)\b|(?<!\p{L})(?:رأي|الأبراج|دليل الشراء|بث مباشر)(?!\p{L})|社説|論説|占い|クイズ|購入ガイド|ライブ更新/u.test(text)?8:0)
    -(/[?؟]$/u.test(text)?4:0);
}
function candidatePriority(value:NewsCandidate):number {
  return value.category===null?0:headlineDiscoveryPriority(value.title,value.category);
}
/** Categories balance observed subjects; they never decide admission or impose a per-category cap. */
function fairNewsOrder(values:readonly NewsCandidate[],limit:number,featuredUrls:ReadonlySet<string>=new Set()):NewsCandidate[]{
  const rank=(row:NewsCandidate):number=>Number(candidatePriority(row)===2)*1000+Number(featuredUrls.has(row.sourceUrl))*100+candidatePriority(row)*20+acquisitionScore(row);
  const compare=(a:NewsCandidate,b:NewsCandidate):number=>rank(b)-rank(a)||b.indexedAt.localeCompare(a.indexedAt)||a.sourceUrl.localeCompare(b.sourceUrl);
  // Give each observed, reviewed edition one acquisition opportunity. Unknown
  // languages remain unknown; a single-language supply keeps its existing order.
  const firstByLanguage=new Map<NewsSourceLanguage,NewsCandidate>();
  for(const row of values){
    const language=sourceLanguage(row.sourceUrl);if(language===null)continue;
    const previous=firstByLanguage.get(language);
    if(!previous||compare(row,previous)<0)firstByLanguage.set(language,row);
  }
  const languageFirst=firstByLanguage.size>1?[...firstByLanguage.values()].sort(compare).slice(0,limit):[];
  const promoted=new Set(languageFirst),orderingLimit=limit+languageFirst.length;
  const groups=new Map<NewsCandidate['category'],NewsCandidate[]>();
  for(const row of values){const group=groups.get(row.category)??[];group.push(row);groups.set(row.category,group);}
  const queues=[...groups.values()].map(rows=>{
    // Vary publication countries and publishers within the same evidence tier.
    // Country describes supply diversity, never the reported event's location.
    const tiers=new Map<number,NewsCandidate[]>();
    for(const row of [...rows].sort(compare)){const tier=tiers.get(rank(row))??[];tier.push(row);tiers.set(rank(row),tier);}
    const ordered:NewsCandidate[]=[];
    for(const tier of tiers.values()){
      const regions=new Map<string,Map<string,{rows:NewsCandidate[];cursor:number}>>();
      for(const row of tier){
        const region=sourcePublicationContext(row.sourceUrl)?.publisherCountryCode??'unreviewed';
        const publishers=regions.get(region)??new Map<string,{rows:NewsCandidate[];cursor:number}>();
        const queue=publishers.get(row.publisher)??{rows:[],cursor:0};queue.rows.push(row);publishers.set(row.publisher,queue);regions.set(region,publishers);
      }
      const regionQueues=[...regions.values()].map(publishers=>{
        const rows:NewsCandidate[]=[];
        for(;;){
          const active=[...publishers.values()].filter(queue=>queue.cursor<queue.rows.length).sort((a,b)=>compare(a.rows[a.cursor]!,b.rows[b.cursor]!));
          if(!active.length)break;
          for(const queue of active)rows.push(queue.rows[queue.cursor++]!);
        }
        return {rows,cursor:0};
      });
      for(;;){
        const active=regionQueues.filter(queue=>queue.cursor<queue.rows.length).sort((a,b)=>compare(a.rows[a.cursor]!,b.rows[b.cursor]!));
        if(!active.length)break;
        for(const queue of active)ordered.push(queue.rows[queue.cursor++]!);
      }
    }
    return {rows:ordered,cursor:0};
  });
  const selected:NewsCandidate[]=[];
  for(;;){
    const active=queues.filter(queue=>queue.cursor<queue.rows.length).sort((a,b)=>compare(a.rows[a.cursor]!,b.rows[b.cursor]!));
    if(!active.length||selected.length>=orderingLimit)break;
    for(const queue of active){if(selected.length>=orderingLimit)break;selected.push(queue.rows[queue.cursor++]!);}
  }
  // Removing only the promoted row references preserves the previous remaining
  // order and leaves canonical-URL deduplication to mergeNewsCandidates.
  return languageFirst.length?[...languageFirst,...selected.filter(row=>!promoted.has(row))].slice(0,limit):selected;
}
/** A global bounded pool includes uncategorized topics and lends unused capacity to any subject. */
/** Preserve urgent/language opportunities, then rotate the remaining finite queue.
 * A stable pool is traversed across refresh slots instead of repeatedly checking its first80 rows.
 * This schedules requests only; every admitted card still needs original publication metadata.
 */
function rotatedNewsOrder(ordered:readonly NewsCandidate[],limit:number,now:number):readonly NewsCandidate[]{
 if(ordered.length<=limit)return ordered;
 const anchors=ordered.slice(0,Math.min(4,limit)),anchored=new Set(anchors.map(row=>row.sourceUrl)),languages=new Set(anchors.map(row=>sourceLanguage(row.sourceUrl)).filter(language=>language!==null));
 for(const row of ordered){
  const language=sourceLanguage(row.sourceUrl);
  if(language!==null&&!languages.has(language)&&anchors.length<limit){anchors.push(row);anchored.add(row.sourceUrl);languages.add(language);}
 }
 const rest=ordered.filter(row=>!anchored.has(row.sourceUrl)),capacity=limit-anchors.length;
 if(capacity===0)return anchors;
 const offset=(Math.floor(now/NEWS_ACQUISITION_ROTATION_MS)*capacity)%rest.length;
 return [...anchors,...Array.from({length:Math.min(capacity,rest.length)},(_,index)=>rest[(offset+index)%rest.length]!)];
}
interface CategoryAcquisitionQueue {
 readonly language:NewsSourceLanguage;readonly category:NewsCategoryId;readonly rows:NewsCandidate[];
 readonly covered:number;attempted:number;cursor:number;
}
/**
 * Spend finite verification opportunities on gaps in the reader's IPTC categories
 * within each reviewed language. A scheduled request is not an accepted article.
 * Unknown subjects/languages keep their rotation and can use all remaining capacity.
 */
export function newsAcquisitionOrder(values:readonly NewsCandidate[],limit:number,now:number,featuredUrls:ReadonlySet<string>=new Set(),retainedCards:readonly EvidenceCard[]=[]):readonly NewsCandidate[]{
 if(!Number.isFinite(now)||!Number.isSafeInteger(limit)||limit<1||limit>80)throw new Error('NEWS_SCHEDULE_INVALID');
 const unique=new Map<string,NewsCandidate>();
 for(const row of values)if(!unique.has(row.sourceUrl)&&!explicitlyPromotional(row.title))unique.set(row.sourceUrl,row);
 const ordered=fairNewsOrder([...unique.values()],unique.size,featuredUrls),retained=eligibleRetainedNewsCards(retainedCards,now);
 const fresh=new Map(retained.filter(card=>now-Date.parse(card.observedAt)<COMPARISON_MAX_AGE_MS-2*NEWS_ACQUISITION_ROTATION_MS).map(card=>[card.sourceUrl,card]));
 const unchanged=(row:NewsCandidate):boolean=>{
  const prior=fresh.get(row.sourceUrl);return prior!==undefined&&prior.publisher===row.publisher
   &&publisherHeadline(prior.title,prior.publisher)===publisherHeadline(row.title,row.publisher);
 };
 const counts=new Map<string,Set<string>>(),coveredHeadlines=new Map<string,Set<string>>(),days=new Map<string,NewsDayWindow>();
 // Explicit acquisition editions: Romanian uses Bucharest's reader day; other
 // languages use UTC until a specific edition time zone has been reviewed.
 // This governs supply planning only and never asserts an event's geography.
 const acquisitionDay=(language:NewsSourceLanguage):NewsDayWindow=>{
  const zone=language==='ro'?'Europe/Bucharest':'UTC';let day=days.get(zone);
  if(!day){day=newsDayWindow(now,zone);days.set(zone,day);}return day;
 };
 const currentByLanguage=new Map<NewsSourceLanguage,EvidenceCard[]>();
 for(const card of fresh.values()){
  const language=sourceLanguage(card.sourceUrl);
  if(language===null||!newsPublishedInDay(card.date,acquisitionDay(language)))continue;
  const rows=currentByLanguage.get(language)??[];rows.push(card);currentByLanguage.set(language,rows);
  const category=classifyEvidenceCard(card)?.category;
  if(category!==undefined){
   const key=language+'|'+category,headlines=coveredHeadlines.get(key)??new Set<string>();
   headlines.add(publisherHeadline(card.title,card.publisher));coveredHeadlines.set(key,headlines);
  }
 }
 // Use the same explicit shared-event grouping as the feed. Ten reports about
 // one identified event count once, never as ten completed category subjects.
 for(const [language,cards] of currentByLanguage)for(const group of groupStories(cards)){
  const category=classifyEvidenceCard(group.card)?.category;if(category===undefined)continue;
  const key=language+'|'+category,subjects=counts.get(key)??new Set<string>();
  subjects.add(group.key);counts.set(key,subjects);
 }
 const queues=new Map<string,CategoryAcquisitionQueue>(),byLanguage=new Map<NewsSourceLanguage|null,NewsCandidate[]>();
 for(const row of ordered){
  const language=sourceLanguage(row.sourceUrl),rows=byLanguage.get(language)??[];
  rows.push(row);byLanguage.set(language,rows);
  const category=classifyNewsSubject(row.title,row.sourceUrl)?.category;
  if(language===null||category===undefined||unchanged(row))continue;
  const key=language+'|'+category;
  if(coveredHeadlines.get(key)?.has(publisherHeadline(row.title,row.publisher)))continue;
  const queue:CategoryAcquisitionQueue=queues.get(key)??{language,category,rows:[],covered:counts.get(key)?.size??0,attempted:0,cursor:0};
  queue.rows.push(row);queues.set(key,queue);
 }
 // Keep the tested global rotation unchanged when no reviewed-language category
 // opportunity is available, including unknown-language publisher supply.
 if(!queues.size)return Object.freeze(rotatedNewsOrder(ordered,limit,now));
 const slot=Math.floor(now/NEWS_ACQUISITION_ROTATION_MS);
 for(const queue of queues.values()){
  const offset=(slot*Math.max(1,Math.floor(limit/Math.max(1,byLanguage.size))))%queue.rows.length;
  queue.rows.push(...queue.rows.splice(0,offset));
 }
 const selected:NewsCandidate[]=[],selectedUrls=new Set<string>(),plannedSubjects=new Set<string>();
 const take=(row:NewsCandidate):boolean=>{
  if(selected.length>=limit||selectedUrls.has(row.sourceUrl))return false;
  selected.push(row);selectedUrls.add(row.sourceUrl);
  const language=sourceLanguage(row.sourceUrl),category=classifyNewsSubject(row.title,row.sourceUrl)?.category;
  if(language!==null&&category!==undefined){
   plannedSubjects.add(language+'|'+category+'|'+publisherHeadline(row.title,row.publisher));
   const queue=queues.get(language+'|'+category);if(queue&&!unchanged(row))queue.attempted++;
  }
  return true;
 };
 const nextGap=(language:NewsSourceLanguage|null,ceiling:number):NewsCandidate|undefined=>{
  if(language===null)return undefined;
  const available=[...queues.values()].filter(queue=>queue.language===language&&queue.covered+queue.attempted<ceiling)
   .sort((a,b)=>(a.covered+a.attempted)-(b.covered+b.attempted)||a.category.localeCompare(b.category));
  for(const queue of available){
   for(;;){
    const row=queue.rows[queue.cursor++];if(!row)break;
    if(!selectedUrls.has(row.sourceUrl)&&!plannedSubjects.has(language+'|'+queue.category+'|'+publisherHeadline(row.title,row.publisher)))return row;
   }
  }
  return undefined;
 };
 // At least one bounded discovery opportunity can learn a previously unknown
 // subject from original publisher metadata while classified deficits persist.
 const unknownSubjects=limit<4?[]:ordered.filter(row=>sourceLanguage(row.sourceUrl)!==null
  &&classifyNewsSubject(row.title,row.sourceUrl)===null&&!unchanged(row));
 const unknown=unknownSubjects.length?unknownSubjects[slot%unknownSubjects.length]:undefined;
 const languages=[...byLanguage.keys()],start=slot%languages.length,languageOrder=[...languages.slice(start),...languages.slice(0,start)];
 // Give reviewed editions their first opportunity before a larger language can
 // occupy the leading request slots with urgent headlines. Reserve the bounded
 // unknown-subject opportunity when the batch has room for it.
 for(const language of languageOrder){
  if(selected.length>=limit-(unknown?1:0))break;
  if(selected.some(row=>sourceLanguage(row.sourceUrl)===language))continue;
  const rows=byLanguage.get(language)!;
  const row=nextGap(language,NEWS_CATEGORY_ACQUISITION_POLICY.minimum)
   ??nextGap(language,NEWS_CATEGORY_ACQUISITION_POLICY.target)
   ??rows.find(candidate=>!selectedUrls.has(candidate.sourceUrl)&&!unchanged(candidate))
   ??rows.find(candidate=>!selectedUrls.has(candidate.sourceUrl));
  if(row)take(row);
 }
 if(unknown)take(unknown);
 // Keep up to four additional strong developments inside the same finite budget.
 let prioritySelections=0;
 for(const row of ordered){
  if(prioritySelections>=4||selected.length>=limit)break;
  if(!unchanged(row)&&(candidatePriority(row)===2||featuredUrls.has(row.sourceUrl))&&take(row))prioritySelections++;
 }
 for(const ceiling of [NEWS_CATEGORY_ACQUISITION_POLICY.minimum,NEWS_CATEGORY_ACQUISITION_POLICY.target]){
  for(;;){
   let progress=false;
   for(const language of languageOrder){
    if(selected.length>=limit)break;
    const row=nextGap(language,ceiling);if(row){take(row);progress=true;}
   }
   if(!progress||selected.length>=limit)break;
  }
 }
 // Deficit targets guide requests, not admission caps. Unclassified, saturated
 // and unknown-language discoveries retain all spare verification capacity.
 const remaining=ordered.filter(row=>!selectedUrls.has(row.sourceUrl));
 for(const pool of [remaining.filter(row=>!unchanged(row)),remaining.filter(unchanged)]){
  if(selected.length>=limit)break;
  for(const row of rotatedNewsOrder(pool,limit-selected.length,now))take(row);
 }
 return Object.freeze(selected);
}
export function mergeNewsCandidates(values:readonly unknown[],now:number):readonly NewsCandidate[]{
  const byUrl=new Map<string,NewsCandidate>();
  for(const raw of values.slice(0,MAX_CANDIDATES*(NEWS_DISCOVERY_INDEXES.length+2))){const row=validateNewsCandidate(raw,now);if(!row)continue;const old=byUrl.get(row.sourceUrl);if(!old||row.indexedAt>old.indexedAt)byUrl.set(row.sourceUrl,row);}
  return Object.freeze(fairNewsOrder([...byUrl.values()],MAX_CANDIDATES));
}
/** The index's pubDate is deliberately ignored: GAL mixes publication and first-seen times. */
export function readNewsCandidates(xml:string,now:number):readonly NewsCandidate[]{
  if(Buffer.byteLength(xml)>INDEX_BYTES||/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('NEWS_INDEX_XML_INVALID');
  const parsed:unknown=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(xml);
  if(!object(parsed)||!object(parsed.rss)||!object(parsed.rss.channel))throw new Error('NEWS_INDEX_SCHEMA_INVALID');
  const channel=parsed.rss.channel;
  if(channel.title!=='GDELT Article List RSS Feed'||!['http://data.gdeltproject.org/gdeltv3/gal/feed.rss',NEWS_INDEX_URL].includes(String(channel.link)))throw new Error('NEWS_INDEX_IDENTITY_INVALID');
  const built=typeof channel.lastBuildDate==='string'?Date.parse(channel.lastBuildDate):NaN;
  if(!Number.isFinite(built)||built<now-3_600_000||built>now+300_000)throw new Error('NEWS_INDEX_STALE');
  const rows:unknown[]=channel.item===undefined?[]:Array.isArray(channel.item)?channel.item:[channel.item];
  if(rows.length>20_000)throw new Error('NEWS_INDEX_TOO_MANY_ITEMS');
  const candidates:NewsCandidate[]=[];
  for(const raw of rows){
    if(!object(raw)||typeof raw.link!=='string')continue;
    const sourceUrl=canonicalNewsUrl(raw.link),title=titleText(raw.title),publisher=publisherForNewsUrl(raw.link);
    if(!sourceUrl||!title||!publisher)continue;
    const category=classifyNewsHeadline(title,sourceUrl);
    candidates.push({sourceUrl,title,publisher:publisher.label,indexedAt:new Date(now).toISOString(),category});
  }
  return mergeNewsCandidates(candidates,now);
}
function matchingIndexLanguage(value:unknown,expected:NewsSourceLanguage):boolean{
  if(typeof value!=='string'||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/iu.test(value))return false;
  const primary=value.toLowerCase().split('-')[0],wanted=expected.toLowerCase(),expectedPrimary=wanted.split('-')[0];
  const aliases:Readonly<Record<string,readonly string[]>>={en:['en','eng'],fr:['fr','fra','fre'],ja:['ja','jpn'],es:['es','spa'],ar:['ar','ara'],de:['de','deu','ger'],pt:['pt','por']};
  if(!expectedPrimary||!(aliases[expectedPrimary]??[expectedPrimary]).includes(primary??''))return false;
  // A primary-language index may declare a region (e.g. es-419). A specifically
  // configured regional/script edition must not silently accept another one.
  return !wanted.includes('-')||value.toLowerCase()===wanted;
}
/** RSS dates need an explicit timezone and valid calendar date; no locale-dependent date guessing. */
function rssPublicationDate(value:unknown):string|null{
  if(typeof value!=='string')return null;
  const iso=publicationDate(value);if(iso)return iso;
  const match=/^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+(GMT|UTC|UT|[+-]\d{4})$/iu.exec(value);
  if(!match)return null;
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2]!.toLowerCase())+1;
  const zone=/^[+-]/u.test(match[7]!)?match[7]!:'Z';
  return publicationDate(`${match[3]}-${String(month).padStart(2,'0')}-${match[1]!.padStart(2,'0')}T${match[4]}:${match[5]}:${match[6]}${zone}`);
}
/** Index dates only filter candidates. The bound original headline and publication date must still agree. */
export function readPublisherNewsCandidates(xml:string,index:NewsDiscoveryIndex,now:number):readonly NewsCandidate[]{
  const registered=NEWS_DISCOVERY_INDEXES.find(row=>row.id===index.id);
  if(!registered||(['url','publisherId','format','language','feedTitle','feedHome','articlePath','allowMissingLanguage'] as const).some(key=>registered[key]!==index[key]))throw new Error('NEWS_INDEX_NOT_REGISTERED');
  if(Buffer.byteLength(xml)>HTML_BYTES||/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('NEWS_INDEX_XML_INVALID');
  // RSS atom:link/dc:language are distinct from channel link/language; collapsing
  // namespaces would corrupt the identity check on the reviewed live feeds.
  const parsed:unknown=new XMLParser({ignoreAttributes:false,removeNSPrefix:registered.format!=='rss',parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(xml);
  if(registered.format==='rss'){
    if(!object(parsed)||!object(parsed.rss)||!object(parsed.rss.channel))throw new Error('NEWS_INDEX_SCHEMA_INVALID');
    const channel=parsed.rss.channel;
    const languageMatches=channel.language===undefined&&registered.allowMissingLanguage===true||matchingIndexLanguage(channel.language,registered.language??'en');
    if(channel.title!==registered.feedTitle||channel.link!==registered.feedHome||!languageMatches)throw new Error('NEWS_INDEX_IDENTITY_INVALID');
    const entries:unknown[]=channel.item===undefined?[]:Array.isArray(channel.item)?channel.item:[channel.item];
    if(entries.length>5000)throw new Error('NEWS_INDEX_TOO_MANY_ITEMS');
    const candidates:NewsCandidate[]=[];
    for(const entry of entries){
      if(!object(entry)||typeof entry.link!=='string')continue;
      const sourceUrl=canonicalNewsUrl(entry.link),publisher=publisherForNewsUrl(entry.link),title=titleText(entry.title),date=rssPublicationDate(entry.pubDate);
      if(!sourceUrl||!publisher||publisher.id!==registered.publisherId||!title||!date||Date.parse(date)<now-DAY||Date.parse(date)>now+300_000)continue;
      if(!registered.articlePath||!new URL(sourceUrl).pathname.startsWith(registered.articlePath))continue;
      candidates.push({sourceUrl,title,publisher:publisher.label,indexedAt:new Date(now).toISOString(),category:classifyNewsHeadline(title,sourceUrl)});
    }
    return mergeNewsCandidates(candidates,now);
  }
  if(!object(parsed)||!object(parsed.urlset))throw new Error('NEWS_INDEX_SCHEMA_INVALID');
  const entries:unknown[]=parsed.urlset.url===undefined?[]:Array.isArray(parsed.urlset.url)?parsed.urlset.url:[parsed.urlset.url];
  if(entries.length>5000)throw new Error('NEWS_INDEX_TOO_MANY_ITEMS');
  const candidates:NewsCandidate[]=[];
  for(const entry of entries){
    if(!object(entry)||typeof entry.loc!=='string'||!object(entry.news)||!object(entry.news.publication))continue;
    if(!matchingIndexLanguage(entry.news.publication.language,registered.language??'en'))continue;
    const sourceUrl=canonicalNewsUrl(entry.loc),publisher=publisherForNewsUrl(entry.loc),title=titleText(entry.news.title),date=publicationDate(entry.news.publication_date);
    if(!sourceUrl||!publisher||publisher.id!==index.publisherId||!title||!date||Date.parse(date)<now-DAY||Date.parse(date)>now+300_000)continue;
    if(registered.articlePath&&!new URL(sourceUrl).pathname.startsWith(registered.articlePath))continue;
    const category=classifyNewsHeadline(title,sourceUrl);
    candidates.push({sourceUrl,title,publisher:publisher.label,indexedAt:new Date(now).toISOString(),category});
  }
  return mergeNewsCandidates(candidates,now);
}
function tokens(text:string):Set<string>{return new Set(text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)?.filter(word=>word.length>1&&!['the','and','with','for','from','this','that','into','of','to','in','on','at','by','an','as','is','a'].includes(word))??[]);}
export function matchingNewsHeadline(a:string,b:string,publisherLabel?:string,language?:NewsSourceLanguage|null):boolean{
  if(publisherLabel&&NEWS_PUBLISHERS.some(row=>row.label===publisherLabel)){
    // Remove only an explicitly separated suffix for this bound publisher.
    // This preserves meaningful numbers while accepting the actual brand "France 24".
    const suffix=new RegExp(`\\s+[–—|:-]\\s+${publisherLabel.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')}\\s*$`,'iu');
    a=a.replace(suffix,'');b=b.replace(suffix,'');
  }
  // Additional reviewed editions have no token/negation rules here. Preserve
  // access for their exact original titles without claiming semantic equivalence.
  const same=():boolean=>a.normalize('NFKC').toLowerCase()===b.normalize('NFKC').toLowerCase();
  if(language&&!(['en','fr','es','ar','de','it','pt-BR','pt-002'] as readonly string[]).includes(language))return same();
  // CJK has no reliable word boundaries here. Require the same normalized title,
  // rather than letting token overlap erase a negation in a Japanese clause.
  if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(a+b))return same();
  const x=tokens(a),y=tokens(b);if(x.size<3||y.size<3)return a.normalize('NFKC').toLowerCase()===b.normalize('NFKC').toLowerCase();
  const shared=[...x].filter(word=>y.has(word)).length;
  const critical=(v:string):string=>{
    const normalized=v.normalize('NFKC').toLowerCase().replace(/(\p{Script=Arabic})\p{M}+/gu,'$1');
    const protectedTerms=[...(normalized.match(/(?<![\p{L}\p{N}])(?:not|never|no|without|pas|jamais|sans|aucun|aucune|ni|sin|nunca|jam[aá]s|ning[uú]n|ninguna|tampoco|nicht|ohne|nie|keinerlei|kein(?:e|en|em|er|es)?|n[aã]o|sem|nenhum|nenhuma|لا|ولا|ليس|ليست|لم|ولم|لن|ولن|دون|بدون|غير|وغير)(?![\p{L}\p{N}])|\p{Nd}+(?:[.,٫٬]\p{Nd}+)*/gu)??[])];
    if(language==='it')protectedTerms.push(...(normalized.match(/(?<![\p{L}\p{N}])(?:non|mai|senza|nessun(?:o|a)?|neppure|nemmeno|neanche|mica|n[éè])(?![\p{L}\p{N}])/gu)??[]));
    return protectedTerms.sort().join('|');
  };
  return shared/Math.min(x.size,y.size)>=0.7&&shared/Math.max(x.size,y.size)>=0.55&&critical(a)===critical(b);
}
function publicationDate(raw:unknown):string|null{
  if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?(?:Z|[+-]\d\d:?\d\d)$/iu.test(raw))return null;
  const parts=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/u.exec(raw);
  if(!parts||Number(parts[4])>23||Number(parts[5])>59||Number(parts[6]??0)>59)return null;
  const calendar=new Date(Date.UTC(Number(parts[1]),Number(parts[2])-1,Number(parts[3])));
  if(calendar.toISOString().slice(0,10)!==raw.slice(0,10))return null;
  const at=Date.parse(raw);return Number.isFinite(at)&&at>=0?new Date(at).toISOString():null;
}
export interface VerifiedNewsMetadata {readonly sourceUrl:string;readonly title:string;readonly date:string;readonly publisher:string;readonly category:PublicEditorialCategory|null;readonly articleSubject?:ArticleSubjectMetadata}
/** Publisher terms are evidence only inside the already-bound eligible Article node. */
function articleSubject(value:Record<string,unknown>,articleUrl:string):ArticleSubjectMetadata|null|undefined {
  if(value.articleSection===undefined&&value.keywords===undefined)return undefined;
  const terms=(input:unknown,maximum:number,split:boolean):readonly string[]|null=>{
    if(input===undefined)return Object.freeze([]);
    const rows=typeof input==='string'?(split?input.split(','):[input]):Array.isArray(input)?input:null;
    if(rows===null||rows.length>maximum*4||!rows.every((row):row is string=>typeof row==='string'))return null;
    const normalized=rows.map(row=>row.normalize('NFC').replace(/\s+/gu,' ').trim());
    if(normalized.some(row=>row.length===0||[...row].length>80||/[\u0000-\u001f\u007f<>]/u.test(row)))return null;
    const result=[...new Set(normalized)].sort();return result.length<=maximum?Object.freeze(result):null;
  };
  const sections=terms(value.articleSection,8,false),keywords=terms(value.keywords,12,true);
  if(sections===null||keywords===null||sections.length+keywords.length===0)return null;
  return Object.freeze({basis:'publisher-jsonld',articleUrl,sections,keywords});
}
/** Parse inert metadata only; never execute scripts, read article bodies or infer a date from dateModified. */
export function readNewsArticleMetadata(html:string,candidate:NewsCandidate,finalUrl:string,now:number):VerifiedNewsMetadata|null{
  if(Buffer.byteLength(html)>HTML_BYTES||explicitlyPromotional(candidate.title))return null;
  const publisher=publisherForNewsUrl(finalUrl);if(!publisher||publisher.label!==candidate.publisher)return null;
  const document=parseDocument(html,{decodeEntities:true,withStartIndices:true,withEndIndices:true});
  const completeTag=(node:{readonly startIndex:number|null;readonly endIndex:number|null},script=false):boolean=>{
    if(node.startIndex===null||node.endIndex===null)return false;
    const raw=html.slice(node.startIndex,node.endIndex+1);return script?/<\/script\s*>$/iu.test(raw):raw.endsWith('>');
  };
  const meta=DomUtils.getElementsByTagName('meta',document,true).filter(node=>completeTag(node)),links=DomUtils.getElementsByTagName('link',document,true).filter(node=>completeTag(node));
  const inHead=(node:typeof meta[number]):boolean=>{
    const head=node.parent,html=head?.parent;
    return head?.type==='tag'&&head.name==='head'&&html?.type==='tag'&&html.name==='html'&&html.parent?.type==='root';
  };
  let canonical=canonicalNewsUrl(finalUrl);if(!canonical)return null;
  const canonicalLinks=links.filter(node=>(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical')).map(node=>node.attribs.href).filter((value):value is string=>typeof value==='string');
  if(canonicalLinks.length>1&&new Set(canonicalLinks).size>1)return null;
  if(canonicalLinks[0]){
    try{const declared=canonicalNewsUrl(new URL(canonicalLinks[0],finalUrl).href);if(!declared||publisherForNewsUrl(declared)?.id!==publisher.id)return null;canonical=declared;}catch{return null;}
  }
  const canonicalInHead=links.some(node=>{
    const href=node.attribs.href;
    if(!inHead(node)||!(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical')
      ||typeof href!=='string'||href.length===0||/[\u0000-\u0020\u007f<>\\]/u.test(href))return false;
    try{return canonicalNewsUrl(new URL(href,finalUrl).href)===canonical;}catch{return false;}
  });
  const titles:string[]=[],dates:string[]=[],boundAlternativeTitles:string[]=[];
  const subjectBindings:{readonly headline:string;readonly date:string;readonly subject:ArticleSubjectMetadata|null}[]=[];
  const digi24Bindings:{readonly headline:string;readonly localDate:string;readonly subject?:ArticleSubjectMetadata|null}[]=[];
  const titleKey=(value:string):string=>value.normalize('NFKC').toLowerCase(),candidateTitle=titleText(candidate.title);
  const add=(headline:unknown,date:unknown,alternativeHeadline?:unknown):boolean=>{
    const title=titleText(headline),stamp=publicationDate(date),alternative=titleText(alternativeHeadline);
    if(!title||!stamp)return false;
    // An exact alternate title is identity evidence only when the caller has
    // bound this same Article to the candidate URL. Publish its primary headline.
    const alternativeMatches=alternative!==null&&candidateTitle!==null&&titleKey(alternative)===titleKey(candidateTitle);
    if(matchingNewsHeadline(candidate.title,title,publisher.label,sourceLanguage(canonical))||alternativeMatches){
      titles.push(title);dates.push(stamp);if(alternativeMatches)boundAlternativeTitles.push(title);return true;
    }
    return false;
  };
  let nodes=0;
  const inspect=(value:unknown,depth=0):void=>{
    if(depth>8||++nodes>200)return;
    if(Array.isArray(value)){for(const entry of value.slice(0,100))inspect(entry,depth+1);return;}
    if(!object(value))return;
    const type=Array.isArray(value['@type'])?value['@type']:[value['@type']];
    if(type.some(t=>typeof t==='string'&&/^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|TechArticle|ScholarlyArticle|MedicalScholarlyArticle|LiveBlogPosting)$/u.test(t))){
      const entity=value.mainEntityOfPage;
      const bindings=[value.url,value['@id'],typeof entity==='string'?entity:undefined,object(entity)?entity['@id']:undefined,object(entity)?entity.url:undefined];
      const declared=bindings.filter((entry):entry is string=>typeof entry==='string');
      let same=true;
      for(const binding of declared){try{if(canonicalNewsUrl(new URL(binding,finalUrl).href)!==canonical)same=false;}catch{same=false;}}
      const explicitBinding=declared.length>0&&(entity===undefined||typeof entity==='string'||object(entity))
        &&bindings.every(binding=>binding===undefined||typeof binding==='string'&&binding.length>0&&!/[\u0000-\u0020\u007f<>\\]/u.test(binding));
      // Digi24's reviewed page binds an Article with local date text and
      // publishes its explicit offset separately in head meta[name=publish-date].
      // Keep the two declarations bound; never infer a timezone from the publisher.
      if(same&&explicitBinding&&publisher.id==='digi24'&&canonicalLinks.length===1
        &&canonicalInHead&&canonicalNewsUrl(candidate.sourceUrl)===canonical
        &&typeof value.datePublished==='string'&&/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/u.test(value.datePublished)){
        const abbreviated=titleText(value.headline);
        const headline=abbreviated&&matchingNewsHeadline(candidate.title,abbreviated,publisher.label,'ro')?abbreviated
          :abbreviated&&candidateTitle?completeDigi24TruncatedHeadline({
            articleHeadline:abbreviated,candidateTitle,canonicalUrl:canonical,
            headTitles:meta.filter(node=>(node.attribs.property??node.attribs.name??'').toLowerCase()==='og:title'&&inHead(node)).map(node=>titleText(node.attribs.content)),
            headUrls:meta.filter(node=>(node.attribs.property??node.attribs.name??'').toLowerCase()==='og:url'&&inHead(node)).map(node=>node.attribs.content),
          }):null;
        if(headline){
          const subject=articleSubject(value,canonical);digi24Bindings.push({headline,localDate:value.datePublished,...(subject===undefined?{}:{subject})});
        }
      }
      if(same){
        const accepted=add(value.headline??value.name,value.datePublished,
          explicitBinding&&typeof value.headline==='string'&&canonicalNewsUrl(candidate.sourceUrl)===canonical?value.alternativeHeadline:undefined);
        if(accepted&&explicitBinding&&canonicalNewsUrl(candidate.sourceUrl)===canonical){
          const headline=titleText(value.headline??value.name),date=publicationDate(value.datePublished),subject=articleSubject(value,canonical);
          if(headline&&date&&subject!==undefined)subjectBindings.push({headline,date,subject});
        }
      }
    }
    if(value['@graph']!==undefined)inspect(value['@graph'],depth+1);
    if(value.mainEntity!==undefined)inspect(value.mainEntity,depth+1);
  };
  for(const script of DomUtils.getElementsByTagName('script',document,true).slice(0,150)){
    if((script.attribs.type??'').toLowerCase()!=='application/ld+json'||!completeTag(script,true))continue;
    const raw=DomUtils.textContent(script);if(raw.length>200_000)continue;
    try{inspect(JSON.parse(raw) as unknown);}catch{/* Other metadata can still provide a complete published record. */}
  }
  const fields=new Map<string,string[]>();
  for(const node of meta){const key=(node.attribs.property??node.attribs.name??'').toLowerCase(),value=node.attribs.content;if(value){const previous=fields.get(key)??[];previous.push(value);fields.set(key,previous);}}
  if(digi24Bindings.length){
    const explicit=meta.filter(node=>node.attribs.name?.toLowerCase()==='publish-date'&&inHead(node)).map(node=>node.attribs.content);
    const parsed=explicit.map(publicationDate);
    if(explicit.length&&(parsed.some(value=>value===null)||new Set(parsed).size!==1||new Set(digi24Bindings.map(value=>value.localDate)).size!==1))return null;
    for(const binding of digi24Bindings)for(const raw of explicit){
      if(typeof raw==='string'&&raw.slice(0,19).replace('T',' ')===binding.localDate&&add(binding.headline,raw)){
        const date=publicationDate(raw);if(date&&binding.subject!==undefined)subjectBindings.push({headline:binding.headline,date,subject:binding.subject});
      }
    }
  }
  const ogTitles=fields.get('og:title')??[],boundTitleKeys=new Set(boundAlternativeTitles.map(titleKey));
  for(const headline of ogTitles)for(const date of fields.get('article:published_time')??[]){
    const title=titleText(headline),stamp=publicationDate(date);
    // A conflicting OG date for the admitted primary headline must still fail
    // closed when the index carried the publisher's shorter alternate title.
    if(title&&stamp&&boundTitleKeys.has(titleKey(title))){titles.push(title);dates.push(stamp);}
    else add(headline,date);
  }
  if(!titles.length||!dates.length||new Set(dates).size!==1||boundTitleKeys.size>1)return null;
  const title=boundAlternativeTitles[0]??titles[0],date=dates[0];if(!title||explicitlyPromotional(title)||!date||Date.parse(date)<now-DAY||Date.parse(date)>now+300_000)return null;
  // The original bound headline determines presentation; an index category is not evidence of identity.
  const boundSubjects=subjectBindings.filter(binding=>binding.date===date&&titleKey(binding.headline)===titleKey(title));
  const subjects=new Set(boundSubjects.map(binding=>JSON.stringify(binding.subject))),subject=boundSubjects[0]?.subject;
  return Object.freeze({sourceUrl:canonical,title,date,publisher:publisher.label,category:classifyNewsHeadline(title,canonical),
    ...(subjects.size===1&&subject!==undefined&&subject!==null?{articleSubject:subject}:{})});
}
class NewsRequestError extends Error {constructor(readonly code:string,readonly retryAt:string|null=null){super(code);}}
interface Budget {readonly deadline:number;readonly timeout:number;remaining:number;readonly blocked:Map<string,string|null>}
function retryAt(response:Response,now:number):string|null{
  const raw=response.headers.get('retry-after');if(!raw)return null;const at=/^\d+$/u.test(raw)?now+Number(raw)*1000:Date.parse(raw);
  return Number.isFinite(at)&&at>=now?new Date(Math.min(now+DAY,at)).toISOString():null;
}
async function fetchText(fetcher:typeof fetch,url:string,limit:number,budget:Budget,article:boolean,now:number,onRequest?:()=>void):Promise<{text:string;url:string}>{
  const initial=publisherForNewsUrl(url),deadline=Math.min(budget.deadline,Date.now()+(article?budget.timeout:url===NEWS_INDEX_URL?Math.min(8000,budget.timeout*2):Math.min(3000,budget.timeout)));
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const run=async():Promise<{text:string;url:string}>=>{
    let current=url;
    for(let redirects=0;redirects<=2;redirects++){
      if(Date.now()>=deadline)throw new NewsRequestError('NEWS_REQUEST_TIMEOUT');
      const origin=new URL(current).origin;
      if(budget.blocked.has(origin)){const until=budget.blocked.get(origin);if(until&&Date.parse(until)<=now)budget.blocked.delete(origin);else throw new NewsRequestError('NEWS_ORIGIN_BLOCKED',until??null);}
      if(article&&budget.remaining--<=0)throw new NewsRequestError('NEWS_REQUEST_BUDGET_EXHAUSTED');
      onRequest?.();
      const response=await fetcher(current,{method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal,headers:{Accept:article?'text/html, application/xhtml+xml':'application/rss+xml, application/xml, text/xml','User-Agent':'DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)'}});
      if(response.redirected){await response.body?.cancel();throw new NewsRequestError('NEWS_UNEXPECTED_REDIRECT');}
      if(response.status>=300&&response.status<400){
        const location=response.headers.get('location');await response.body?.cancel();
        if(!article||!location||redirects===2)throw new NewsRequestError('NEWS_REDIRECT_REJECTED');
        let next:string;try{next=new URL(location,current).href;}catch{throw new NewsRequestError('NEWS_REDIRECT_REJECTED');}
        if(!canonicalNewsUrl(next)||publisherForNewsUrl(next)?.id!==initial?.id)throw new NewsRequestError('NEWS_REDIRECT_REJECTED');
        current=next;continue;
      }
      if(!response.ok){
        const retry=retryAt(response,now);await response.body?.cancel();
        if([401,402,403,429].includes(response.status))budget.blocked.set(new URL(current).origin,retry??new Date(now+900_000).toISOString());
        throw new NewsRequestError(`NEWS_HTTP_${response.status}`,retry);
      }
      const type=(response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()??'';
      if(!(article?['text/html','application/xhtml+xml']:['application/rss+xml','application/xml','text/xml']).includes(type)){await response.body?.cancel();throw new NewsRequestError('NEWS_CONTENT_TYPE_INVALID');}
      const declared=response.headers.get('content-length');if(declared&&(!/^\d+$/u.test(declared)||!article&&Number(declared)>limit)){await response.body?.cancel();throw new NewsRequestError('NEWS_RESPONSE_TOO_LARGE');}
      if(!response.body)throw new NewsRequestError('NEWS_EMPTY_RESPONSE');
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0,partial=false;
      const cancel=():void=>{void reader.cancel().catch(()=>undefined);};controller.signal.addEventListener('abort',cancel,{once:true});
      try{for(;;){const part=await reader.read();if(part.done)break;
        const remaining=limit-size;
        if(part.value.byteLength>remaining){
          await reader.cancel();if(!article)throw new NewsRequestError('NEWS_RESPONSE_TOO_LARGE');
          chunks.push(part.value.subarray(0,remaining));size+=remaining;partial=true;break;
        }
        chunks.push(part.value);size+=part.value.byteLength;
        if(article&&size===limit){await reader.cancel();partial=true;break;}
      }}
      finally{controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
      if(!size)throw new NewsRequestError('NEWS_EMPTY_RESPONSE');
      // Article reads stop at the prefix budget; XML indexes must remain complete.
      return {text:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks),{stream:partial}),url:current};
    }
    throw new NewsRequestError('NEWS_REDIRECT_REJECTED');
  };
  try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new NewsRequestError('NEWS_REQUEST_TIMEOUT'));},Math.max(1,deadline-Date.now()));})]);}
  finally{if(timer)clearTimeout(timer);controller.abort();}
}
const bounded=(value:number|undefined,fallback:number,max:number):number=>value!==undefined&&Number.isFinite(value)?Math.max(1,Math.min(max,Math.floor(value))):fallback;
export interface NewsDiscoveryResult {readonly sources:readonly SourceResult[];readonly diagnostics:NewsDiagnostics}
export async function discoverNewsWithDiagnostics(fetcher:typeof fetch,now:number,seedCandidates:readonly NewsCandidate[]=[],onCandidates?:(candidates:readonly NewsCandidate[])=>Promise<void>,options:NewsDiscoveryOptions={}):Promise<NewsDiscoveryResult>{
  if(!Number.isFinite(now))throw new Error('NEWS_CLOCK_INVALID');
  const checkedAt=new Date(now).toISOString(),today=checkedAt.slice(0,10),diagnostics=new NewsDiagnosticsBuilder(now);
  const indexes:(NewsDiscoveryIndex|null)[]=[null,...(options.publisherIndexes===false?[]:rotatedPublisherIndexes(now,options.publisherIndexBatch))];
  // Discovery shares one acquisition pipeline. An expired review blocks its
  // indexes, originals, homepage requests and retained-candidate callbacks.
  if(NEWS_SOURCES.some(source=>today>source.rightsReviewBy)){
    for(const index of indexes)diagnostics.index(index,false,'RIGHTS_REVIEW_EXPIRED');
    diagnostics.issue('rights-review-expired');
    const sources=Object.freeze(NEWS_SOURCES.map(source=>Object.freeze({
      cards:Object.freeze([]),
      health:Object.freeze({id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:'unavailable' as const,
        checkedAt,verifiedAt:null,count:0,rejected:0,error:'RIGHTS_REVIEW_EXPIRED',retryAt:null,scope:source.scope,termsUrl:source.termsUrl,windowed:true}),
    })));
    return Object.freeze({sources,diagnostics:diagnostics.finish()});
  }
  const budget:Budget={deadline:Date.now()+bounded(options.deadlineMs,35_000,35_000),timeout:bounded(options.requestTimeoutMs,4000,4000),remaining:bounded(options.maxArticleRequests,80,80),blocked:options.originBackoff??new Map()};
  let incoming:NewsCandidate[]=[],indexError:string|null=null,indexRetry:string|null=null,successfulIndexes=0,indexCursor=0;
  const indexWorker=async():Promise<void>=>{for(;;){const index=indexes[indexCursor++];if(index===undefined)return;
    let attempted=false;
    try{
      const response=await fetchText(fetcher,index?.url??NEWS_INDEX_URL,index?HTML_BYTES:INDEX_BYTES,budget,false,now,()=>{attempted=true;});
      incoming.push(...(index?readPublisherNewsCandidates(response.text,index,now):readNewsCandidates(response.text,now)));successfulIndexes++;diagnostics.index(index,attempted,null);
    }catch(error){indexError=error instanceof NewsRequestError?error.code:error instanceof Error&&/^NEWS_/u.test(error.message)?error.message:'NEWS_INDEX_UNAVAILABLE';indexRetry=error instanceof NewsRequestError?error.retryAt:null;diagnostics.index(index,attempted,indexError);}
  }};
  await Promise.all(Array.from({length:Math.min(4,indexes.length)},()=>indexWorker()));
  const pool=mergeNewsCandidates([...incoming,...seedCandidates.slice(0,MAX_CANDIDATES)],now);
  diagnostics.discovered(incoming);diagnostics.pool(pool);
  const unavailableFrontpages={urls:[] as readonly string[],checkedAt:new Date(now).toISOString(),available:false,rejected:4};
  // Homepage inspection and the durable candidate write share the same bounded phase.
  const frontpageFetcher:typeof fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url,origin=new URL(url).origin,until=budget.blocked.get(origin);
    if(until&&Date.parse(until)>now)throw new NewsRequestError('NEWS_ORIGIN_BLOCKED',until);
    const response=await fetcher(input,init);if([401,402,403,429].includes(response.status))budget.blocked.set(origin,retryAt(response,now)??new Date(now+900_000).toISOString());
    return response;
  };
  const frontpagePromise=options.frontpageHighlights===false||pool.length===0||Date.now()>=budget.deadline?Promise.resolve(unavailableFrontpages):collectFrontpageHighlights(frontpageFetcher,pool,now,Math.min(2500,budget.deadline-Date.now())).catch(()=>unavailableFrontpages);
  let storeError=false;
  if(onCandidates){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([onCandidates(pool),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('NEWS_STORE_TIMEOUT')),Math.max(1,Math.min(3000,budget.deadline-Date.now())));})]);}catch{storeError=true;diagnostics.issue('candidate-store');}finally{if(timer)clearTimeout(timer);}}
  const frontpages=await frontpagePromise,knownCandidateUrls=new Set(pool.map(row=>row.sourceUrl));
  const featuredUrls=new Set(frontpages.urls.filter(url=>knownCandidateUrls.has(url)));
  const eligibleRetained=eligibleRetainedNewsCards(options.retainedCards??[],now);
  const selected=newsAcquisitionOrder(pool,budget.remaining,now,featuredUrls,eligibleRetained);diagnostics.scheduled(selected);
  const selectedUrls=new Set(selected.map(row=>row.sourceUrl));
  const identities=new Map<string,{card:EvidenceCard;category:NewsCandidate['category'];candidateUrl:string}>(),conflicts=new Set<string>();
  const cards=new Map<NewsCandidate['category'],EvidenceCard[]>(),errors=new Map<NewsCandidate['category'],string[]>(),retries=new Map<NewsCandidate['category'],string>();let cursor=0;
  const worker=async():Promise<void>=>{for(;;){const candidate=selected[cursor++];if(!candidate)return;
    try{
      if(Date.now()>=budget.deadline)throw new NewsRequestError('NEWS_GLOBAL_DEADLINE');
      const response=await fetchText(fetcher,candidate.sourceUrl,HTML_BYTES,budget,true,now,()=>diagnostics.request(candidate.sourceUrl)),verified=readNewsArticleMetadata(response.text,candidate,response.url,now);
      if(!verified)throw new NewsRequestError('NEWS_PUBLICATION_METADATA_UNVERIFIED');
      const base={identity:verified.sourceUrl,title:verified.title,sourceUrl:verified.sourceUrl,date:verified.date,dateLabel:'Published' as const,publisher:verified.publisher,deadline:null,version:null,...(verified.articleSubject?{articleSubject:verified.articleSubject}:{})};
      const card:EvidenceCard=Object.freeze({...base,id:digest(base.identity).slice(0,24),contentHash:digest(cardContent(base)),kind:'publication',topic:verified.category===null?NEWS_UNCLASSIFIED_SOURCE.topic:EDITORIAL_CATEGORY_TOPICS[verified.category],sourceIds:Object.freeze([verified.category===null?NEWS_UNCLASSIFIED_SOURCE.id:`news-${verified.category}`,...(featuredUrls.has(verified.sourceUrl)?[NEWS_FEATURED_SOURCE.id]:[])]),observedAt:new Date(now).toISOString(),
        boundary:'Original publisher headline and publication metadata checked. Discovery uses GDELT and reviewed publisher news indexes; not independent corroboration of the reported facts.',
        attribution:`Source: ${verified.publisher}. News discovery: GDELT (https://www.gdeltproject.org/) and public publisher indexes. No article body or images republished.`,sourceState:'verified'});
      const prior=identities.get(card.identity);
      if(conflicts.has(card.identity))throw new NewsRequestError('NEWS_IDENTITY_CONFLICT');
      if(prior&&prior.card.contentHash!==card.contentHash){
        diagnostics.failed(prior.candidateUrl,'NEWS_IDENTITY_CONFLICT');
        cards.set(prior.category,(cards.get(prior.category)??[]).filter(row=>row.identity!==card.identity));conflicts.add(card.identity);
        const priorErrors=errors.get(prior.category)??[];priorErrors.push('NEWS_IDENTITY_CONFLICT');errors.set(prior.category,priorErrors);
        throw new NewsRequestError('NEWS_IDENTITY_CONFLICT');
      }
      if(prior){diagnostics.duplicate(candidate.sourceUrl);continue;}
      diagnostics.verified(candidate.sourceUrl);
      identities.set(card.identity,{card,category:verified.category,candidateUrl:candidate.sourceUrl});
      const previous=cards.get(verified.category)??[];previous.push(card);cards.set(verified.category,previous);
    }catch(error){const code=error instanceof NewsRequestError?error.code:'NEWS_ARTICLE_UNAVAILABLE';diagnostics.failed(candidate.sourceUrl,code);const previous=errors.get(candidate.category)??[];previous.push(code);errors.set(candidate.category,previous);if(error instanceof NewsRequestError&&error.retryAt)retries.set(candidate.category,error.retryAt);}
  }};
  await Promise.all(Array.from({length:Math.min(bounded(options.concurrency,10,10),selected.length)},()=>worker()));
  // Only untouched, still-eligible prior observations survive rotation. Never
  // refresh their timestamp/hash or resurrect a selected original that failed revalidation.
  let retainedCount=0;const retainedIdentities=new Set<string>();
  const retained=eligibleRetained.filter(card=>!selectedUrls.has(card.sourceUrl));
  for(const card of retained){
    if(identities.has(card.identity)||conflicts.has(card.identity))continue;
    const sourceId=card.sourceIds.find(id=>id!==NEWS_FEATURED_SOURCE.id)!;
    const category=sourceId===NEWS_UNCLASSIFIED_SOURCE.id?null:sourceId.slice(5) as PublicEditorialCategory;
    identities.set(card.identity,{card,category,candidateUrl:card.sourceUrl});const previous=cards.get(category)??[];previous.push(card);cards.set(category,previous);retainedIdentities.add(card.identity);retainedCount++;diagnostics.retain(card);
  }
  const categoryResults:SourceResult[]=[...NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE].map(source=>{
    const category=source.id===NEWS_UNCLASSIFIED_SOURCE.id?null:source.id.slice(5) as PublicEditorialCategory,accepted=cards.get(category)??[],failed=errors.get(category)??[],checkedAt=new Date(now).toISOString();
    // A failed alternative does not invalidate a separately checked public card.
    const error=accepted.length?null:indexError??(storeError?'NEWS_CANDIDATE_STORE_FAILED':null)??failed[0]??null;
    return Object.freeze({cards:Object.freeze(accepted),health:Object.freeze({id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:accepted.length?'partial' as const:error?'unavailable' as const:'partial' as const,checkedAt,verifiedAt:accepted.length?new Date(Math.max(...accepted.map(card=>Date.parse(card.observedAt)))).toISOString():null,count:accepted.length,rejected:failed.length,error,retryAt:retries.get(category)??indexRetry,scope:source.scope+` Discovery indexes with valid metadata: ${successfulIndexes}/${indexes.length}. Retained candidate pool: ${pool.length}; scheduled originals: ${selected.length}; candidates deferred by request capacity: ${Math.max(0,pool.length-selected.length)}. Queue rotation: two minutes. Earlier eligible observations retained without re-dating: ${retainedCount}.`,termsUrl:source.termsUrl,windowed:true})});
  });
  const featuredCards=categoryResults.flatMap(result=>result.cards).filter(card=>card.sourceIds.includes(NEWS_FEATURED_SOURCE.id));
  const featuredCount=featuredCards.length,priorFeatured=featuredCards.filter(card=>retainedIdentities.has(card.identity));
  const featuredVerifiedAt=frontpages.available?frontpages.checkedAt:priorFeatured.length?new Date(Math.max(...priorFeatured.map(card=>Date.parse(card.observedAt)))).toISOString():null;
  const featuredResult:SourceResult=Object.freeze({cards:Object.freeze([]),health:Object.freeze({id:NEWS_FEATURED_SOURCE.id,label:NEWS_FEATURED_SOURCE.label,publisher:NEWS_FEATURED_SOURCE.publisher,topic:NEWS_FEATURED_SOURCE.topic,
    state:frontpages.available?(frontpages.rejected?'partial' as const:'verified' as const):priorFeatured.length?'partial' as const:'unavailable' as const,checkedAt:frontpages.checkedAt,verifiedAt:featuredVerifiedAt,count:featuredCount,rejected:frontpages.rejected,
    error:frontpages.available?null:'NEWS_FRONTPAGES_UNAVAILABLE',retryAt:null,scope:NEWS_FEATURED_SOURCE.scope+(priorFeatured.length?` Earlier eligible homepage observations retained with original timestamps: ${priorFeatured.length}; their placement is not asserted again at this check.`:''),termsUrl:NEWS_FEATURED_SOURCE.termsUrl,windowed:true})});
  // Category results carry each card once; reconcile counts this audit source through sourceIds.
  return Object.freeze({sources:Object.freeze([...categoryResults,featuredResult]),diagnostics:diagnostics.finish()});
}

/** Compatibility API: existing callers receive the same source results. */
export async function discoverNews(fetcher:typeof fetch,now:number,seedCandidates:readonly NewsCandidate[]=[],onCandidates?:(candidates:readonly NewsCandidate[])=>Promise<void>,options:NewsDiscoveryOptions={}):Promise<readonly SourceResult[]>{
  return (await discoverNewsWithDiagnostics(fetcher,now,seedCandidates,onCandidates,options)).sources;
}
