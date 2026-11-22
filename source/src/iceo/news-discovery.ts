import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {parseDocument,DomUtils} from 'htmlparser2';
import type {EvidenceCard,SourceResult} from './contracts.js';
import {cardContent} from './card-validation.js';
import {collectFrontpageHighlights} from './news-frontpages.js';
import {EDITORIAL_CATEGORY_TOPICS,classifyNewsHeadline,headlineDiscoveryPriority,type PublicEditorialCategory} from './editorial-categories.js';
import {NEWS_INDEX_URL,NEWS_PUBLISHERS,NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE,NEWS_FEATURED_SOURCE,NEWS_DISCOVERY_INDEXES,NEWS_SOURCES,canonicalNewsUrl,publisherForNewsUrl,sourcePublicationContext,sourceLanguage,type NewsDiscoveryIndex,type NewsSourceLanguage} from './news-sources.js';

/** Untrusted discovery metadata. indexedAt is never a publisher publication date. */
export interface NewsCandidate {readonly sourceUrl:string;readonly title:string;readonly publisher:string;readonly indexedAt:string;readonly category:PublicEditorialCategory|null}
export interface NewsDiscoveryOptions {readonly deadlineMs?:number;readonly requestTimeoutMs?:number;readonly maxArticleRequests?:number;readonly concurrency?:number;readonly publisherIndexes?:boolean;readonly frontpageHighlights?:boolean;readonly originBackoff?:Map<string,string|null>}
const DAY=86_400_000,INDEX_BYTES=3_145_728,HTML_BYTES=1_048_576,MAX_CANDIDATES=500;
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
  if(!sourceUrl||!title||!publisher||value.publisher!==publisher.label||!Number.isFinite(indexed)||indexed<now-DAY||indexed>now+300_000||!/^\d{4}-\d\d-\d\dT/u.test(value.indexedAt))return null;
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
export function mergeNewsCandidates(values:readonly unknown[],now:number):readonly NewsCandidate[]{
  const byUrl=new Map<string,NewsCandidate>();
  for(const raw of values.slice(0,20_000)){const row=validateNewsCandidate(raw,now);if(!row)continue;const old=byUrl.get(row.sourceUrl);if(!old||row.indexedAt>old.indexedAt)byUrl.set(row.sourceUrl,row);}
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
  if(!registered||(['url','publisherId','format','language','feedTitle','feedHome','articlePath'] as const).some(key=>registered[key]!==index[key]))throw new Error('NEWS_INDEX_NOT_REGISTERED');
  if(Buffer.byteLength(xml)>HTML_BYTES||/<!\s*(?:DOCTYPE|ENTITY)/iu.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('NEWS_INDEX_XML_INVALID');
  // RSS atom:link/dc:language are distinct from channel link/language; collapsing
  // namespaces would corrupt the identity check on the reviewed live feeds.
  const parsed:unknown=new XMLParser({ignoreAttributes:false,removeNSPrefix:registered.format!=='rss',parseTagValue:false,parseAttributeValue:false,trimValues:true}).parse(xml);
  if(registered.format==='rss'){
    if(!object(parsed)||!object(parsed.rss)||!object(parsed.rss.channel))throw new Error('NEWS_INDEX_SCHEMA_INVALID');
    const channel=parsed.rss.channel;
    if(channel.title!==registered.feedTitle||channel.link!==registered.feedHome||!matchingIndexLanguage(channel.language,registered.language??'en'))throw new Error('NEWS_INDEX_IDENTITY_INVALID');
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
  if(language&&!(['en','fr','es','ar','de','pt-BR','pt-002'] as readonly string[]).includes(language))return same();
  // CJK has no reliable word boundaries here. Require the same normalized title,
  // rather than letting token overlap erase a negation in a Japanese clause.
  if(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(a+b))return same();
  const x=tokens(a),y=tokens(b);if(x.size<3||y.size<3)return a.normalize('NFKC').toLowerCase()===b.normalize('NFKC').toLowerCase();
  const shared=[...x].filter(word=>y.has(word)).length;
  const critical=(v:string):string=>[...(v.normalize('NFKC').toLowerCase().replace(/(\p{Script=Arabic})\p{M}+/gu,'$1').match(/(?<![\p{L}\p{N}])(?:not|never|no|without|pas|jamais|sans|aucun|aucune|ni|sin|nunca|jam[aá]s|ning[uú]n|ninguna|tampoco|nicht|ohne|nie|keinerlei|kein(?:e|en|em|er|es)?|n[aã]o|sem|nenhum|nenhuma|لا|ولا|ليس|ليست|لم|ولم|لن|ولن|دون|بدون|غير|وغير)(?![\p{L}\p{N}])|\p{Nd}+(?:[.,٫٬]\p{Nd}+)*/gu)??[])].sort().join('|');
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
export interface VerifiedNewsMetadata {readonly sourceUrl:string;readonly title:string;readonly date:string;readonly publisher:string;readonly category:PublicEditorialCategory|null}
/** Parse inert metadata only; never execute scripts, read article bodies or infer a date from dateModified. */
export function readNewsArticleMetadata(html:string,candidate:NewsCandidate,finalUrl:string,now:number):VerifiedNewsMetadata|null{
  if(Buffer.byteLength(html)>HTML_BYTES)return null;
  const publisher=publisherForNewsUrl(finalUrl);if(!publisher||publisher.label!==candidate.publisher)return null;
  const document=parseDocument(html,{decodeEntities:true,withStartIndices:true,withEndIndices:true});
  const completeTag=(node:{readonly startIndex:number|null;readonly endIndex:number|null},script=false):boolean=>{
    if(node.startIndex===null||node.endIndex===null)return false;
    const raw=html.slice(node.startIndex,node.endIndex+1);return script?/<\/script\s*>$/iu.test(raw):raw.endsWith('>');
  };
  const meta=DomUtils.getElementsByTagName('meta',document,true).filter(node=>completeTag(node)),links=DomUtils.getElementsByTagName('link',document,true).filter(node=>completeTag(node));
  let canonical=canonicalNewsUrl(finalUrl);if(!canonical)return null;
  const canonicalLinks=links.filter(node=>(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical')).map(node=>node.attribs.href).filter((value):value is string=>typeof value==='string');
  if(canonicalLinks.length>1&&new Set(canonicalLinks).size>1)return null;
  if(canonicalLinks[0]){
    try{const declared=canonicalNewsUrl(new URL(canonicalLinks[0],finalUrl).href);if(!declared||publisherForNewsUrl(declared)?.id!==publisher.id)return null;canonical=declared;}catch{return null;}
  }
  const titles:string[]=[],dates:string[]=[];
  const add=(headline:unknown,date:unknown):void=>{const title=titleText(headline),stamp=publicationDate(date);if(title&&stamp&&matchingNewsHeadline(candidate.title,title,publisher.label,sourceLanguage(canonical))){titles.push(title);dates.push(stamp);}};
  let nodes=0;
  const inspect=(value:unknown,depth=0):void=>{
    if(depth>8||++nodes>200)return;
    if(Array.isArray(value)){for(const entry of value.slice(0,100))inspect(entry,depth+1);return;}
    if(!object(value))return;
    const type=Array.isArray(value['@type'])?value['@type']:[value['@type']];
    if(type.some(t=>typeof t==='string'&&/^(?:NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|TechArticle|ScholarlyArticle|MedicalScholarlyArticle|LiveBlogPosting)$/u.test(t))){
      const entity=value.mainEntityOfPage;
      const declared=[value.url,value['@id'],typeof entity==='string'?entity:object(entity)?entity['@id']??entity.url:undefined].filter((entry):entry is string=>typeof entry==='string');
      let same=true;
      for(const binding of declared){try{if(canonicalNewsUrl(new URL(binding,finalUrl).href)!==canonical)same=false;}catch{same=false;}}
      if(same)add(value.headline??value.name,value.datePublished);
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
  const ogTitles=fields.get('og:title')??[];
  for(const title of ogTitles)for(const date of fields.get('article:published_time')??[])add(title,date);
  if(!titles.length||!dates.length||new Set(dates).size!==1)return null;
  const title=titles[0],date=dates[0];if(!title||!date||Date.parse(date)<now-DAY||Date.parse(date)>now+300_000)return null;
  // The original bound headline determines presentation; an index category is not evidence of identity.
  return Object.freeze({sourceUrl:canonical,title,date,publisher:publisher.label,category:classifyNewsHeadline(title,canonical)});
}
class NewsRequestError extends Error {constructor(readonly code:string,readonly retryAt:string|null=null){super(code);}}
interface Budget {readonly deadline:number;readonly timeout:number;remaining:number;readonly blocked:Map<string,string|null>}
function retryAt(response:Response,now:number):string|null{
  const raw=response.headers.get('retry-after');if(!raw)return null;const at=/^\d+$/u.test(raw)?now+Number(raw)*1000:Date.parse(raw);
  return Number.isFinite(at)&&at>=now?new Date(Math.min(now+DAY,at)).toISOString():null;
}
async function fetchText(fetcher:typeof fetch,url:string,limit:number,budget:Budget,article:boolean,now:number):Promise<{text:string;url:string}>{
  const initial=publisherForNewsUrl(url),deadline=Math.min(budget.deadline,Date.now()+(article?budget.timeout:url===NEWS_INDEX_URL?Math.min(8000,budget.timeout*2):Math.min(3000,budget.timeout)));
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const run=async():Promise<{text:string;url:string}>=>{
    let current=url;
    for(let redirects=0;redirects<=2;redirects++){
      if(Date.now()>=deadline)throw new NewsRequestError('NEWS_REQUEST_TIMEOUT');
      const origin=new URL(current).origin;
      if(budget.blocked.has(origin)){const until=budget.blocked.get(origin);if(until&&Date.parse(until)<=now)budget.blocked.delete(origin);else throw new NewsRequestError('NEWS_ORIGIN_BLOCKED',until??null);}
      if(article&&budget.remaining--<=0)throw new NewsRequestError('NEWS_REQUEST_BUDGET_EXHAUSTED');
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
export async function discoverNews(fetcher:typeof fetch,now:number,seedCandidates:readonly NewsCandidate[]=[],onCandidates?:(candidates:readonly NewsCandidate[])=>Promise<void>,options:NewsDiscoveryOptions={}):Promise<readonly SourceResult[]>{
  if(!Number.isFinite(now))throw new Error('NEWS_CLOCK_INVALID');
  const checkedAt=new Date(now).toISOString(),today=checkedAt.slice(0,10);
  // Discovery shares one acquisition pipeline. An expired review blocks its
  // indexes, originals, homepage requests and retained-candidate callbacks.
  if(NEWS_SOURCES.some(source=>today>source.rightsReviewBy))return Object.freeze(NEWS_SOURCES.map(source=>Object.freeze({
    cards:Object.freeze([]),
    health:Object.freeze({id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:'unavailable' as const,
      checkedAt,verifiedAt:null,count:0,rejected:0,error:'RIGHTS_REVIEW_EXPIRED',retryAt:null,scope:source.scope,termsUrl:source.termsUrl,windowed:true}),
  })));
  const budget:Budget={deadline:Date.now()+bounded(options.deadlineMs,35_000,35_000),timeout:bounded(options.requestTimeoutMs,4000,4000),remaining:bounded(options.maxArticleRequests,80,80),blocked:options.originBackoff??new Map()};
  let incoming:NewsCandidate[]=[],indexError:string|null=null,indexRetry:string|null=null,successfulIndexes=0,indexCursor=0;
  const indexes:(NewsDiscoveryIndex|null)[]=[null,...(options.publisherIndexes===false?[]:NEWS_DISCOVERY_INDEXES)];
  const indexWorker=async():Promise<void>=>{for(;;){const index=indexes[indexCursor++];if(index===undefined)return;
    try{
      const response=await fetchText(fetcher,index?.url??NEWS_INDEX_URL,index?HTML_BYTES:INDEX_BYTES,budget,false,now);
      incoming.push(...(index?readPublisherNewsCandidates(response.text,index,now):readNewsCandidates(response.text,now)));successfulIndexes++;
    }catch(error){indexError=error instanceof NewsRequestError?error.code:error instanceof Error&&/^NEWS_/u.test(error.message)?error.message:'NEWS_INDEX_UNAVAILABLE';indexRetry=error instanceof NewsRequestError?error.retryAt:null;}
  }};
  await Promise.all(Array.from({length:Math.min(4,indexes.length)},()=>indexWorker()));
  const pool=mergeNewsCandidates([...incoming,...seedCandidates.slice(0,MAX_CANDIDATES)],now);
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
  if(onCandidates){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([onCandidates(pool),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('NEWS_STORE_TIMEOUT')),Math.max(1,Math.min(3000,budget.deadline-Date.now())));})]);}catch{storeError=true;}finally{if(timer)clearTimeout(timer);}}
  const frontpages=await frontpagePromise,knownCandidateUrls=new Set(pool.map(row=>row.sourceUrl));
  const featuredUrls=new Set(frontpages.urls.filter(url=>knownCandidateUrls.has(url)));
  const selected=fairNewsOrder(pool,budget.remaining,featuredUrls);
  const identities=new Map<string,{card:EvidenceCard;category:NewsCandidate['category']}>(),conflicts=new Set<string>();
  const cards=new Map<NewsCandidate['category'],EvidenceCard[]>(),errors=new Map<NewsCandidate['category'],string[]>(),retries=new Map<NewsCandidate['category'],string>();let cursor=0;
  const worker=async():Promise<void>=>{for(;;){const candidate=selected[cursor++];if(!candidate)return;
    try{
      if(Date.now()>=budget.deadline)throw new NewsRequestError('NEWS_GLOBAL_DEADLINE');
      const response=await fetchText(fetcher,candidate.sourceUrl,HTML_BYTES,budget,true,now),verified=readNewsArticleMetadata(response.text,candidate,response.url,now);
      if(!verified)throw new NewsRequestError('NEWS_PUBLICATION_METADATA_UNVERIFIED');
      const base={identity:verified.sourceUrl,title:verified.title,sourceUrl:verified.sourceUrl,date:verified.date,dateLabel:'Published' as const,publisher:verified.publisher,deadline:null,version:null};
      const card:EvidenceCard=Object.freeze({...base,id:digest(base.identity).slice(0,24),contentHash:digest(cardContent(base)),kind:'publication',topic:verified.category===null?NEWS_UNCLASSIFIED_SOURCE.topic:EDITORIAL_CATEGORY_TOPICS[verified.category],sourceIds:Object.freeze([verified.category===null?NEWS_UNCLASSIFIED_SOURCE.id:`news-${verified.category}`,...(featuredUrls.has(verified.sourceUrl)?[NEWS_FEATURED_SOURCE.id]:[])]),observedAt:new Date(now).toISOString(),
        boundary:'Original publisher headline and publication metadata checked. Discovery uses GDELT and reviewed publisher news indexes; not independent corroboration of the reported facts.',
        attribution:`Source: ${verified.publisher}. News discovery: GDELT (https://www.gdeltproject.org/) and public publisher indexes. No article body or images republished.`,sourceState:'verified'});
      const prior=identities.get(card.identity);
      if(conflicts.has(card.identity))throw new NewsRequestError('NEWS_IDENTITY_CONFLICT');
      if(prior&&prior.card.contentHash!==card.contentHash){
        cards.set(prior.category,(cards.get(prior.category)??[]).filter(row=>row.identity!==card.identity));conflicts.add(card.identity);
        const priorErrors=errors.get(prior.category)??[];priorErrors.push('NEWS_IDENTITY_CONFLICT');errors.set(prior.category,priorErrors);
        throw new NewsRequestError('NEWS_IDENTITY_CONFLICT');
      }
      if(prior)continue;
      identities.set(card.identity,{card,category:verified.category});
      const previous=cards.get(verified.category)??[];previous.push(card);cards.set(verified.category,previous);
    }catch(error){const previous=errors.get(candidate.category)??[];previous.push(error instanceof NewsRequestError?error.code:'NEWS_ARTICLE_UNAVAILABLE');errors.set(candidate.category,previous);if(error instanceof NewsRequestError&&error.retryAt)retries.set(candidate.category,error.retryAt);}
  }};
  await Promise.all(Array.from({length:Math.min(bounded(options.concurrency,10,10),selected.length)},()=>worker()));
  const categoryResults:SourceResult[]=[...NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE].map(source=>{
    const category=source.id===NEWS_UNCLASSIFIED_SOURCE.id?null:source.id.slice(5) as PublicEditorialCategory,accepted=cards.get(category)??[],failed=errors.get(category)??[],checkedAt=new Date(now).toISOString();
    // A failed alternative does not invalidate a separately checked public card.
    const error=accepted.length?null:indexError??(storeError?'NEWS_CANDIDATE_STORE_FAILED':null)??failed[0]??null;
    return Object.freeze({cards:Object.freeze(accepted),health:Object.freeze({id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:accepted.length?'partial' as const:error?'unavailable' as const:'partial' as const,checkedAt,verifiedAt:accepted.length?checkedAt:null,count:accepted.length,rejected:failed.length,error,retryAt:retries.get(category)??indexRetry,scope:source.scope+` Discovery indexes with valid metadata: ${successfulIndexes}/${indexes.length}.`,termsUrl:source.termsUrl,windowed:true})});
  });
  const featuredCount=categoryResults.flatMap(result=>result.cards).filter(card=>card.sourceIds.includes(NEWS_FEATURED_SOURCE.id)).length;
  const featuredResult:SourceResult=Object.freeze({cards:Object.freeze([]),health:Object.freeze({id:NEWS_FEATURED_SOURCE.id,label:NEWS_FEATURED_SOURCE.label,publisher:NEWS_FEATURED_SOURCE.publisher,topic:NEWS_FEATURED_SOURCE.topic,
    state:frontpages.available?(frontpages.rejected?'partial' as const:'verified' as const):'unavailable' as const,checkedAt:frontpages.checkedAt,verifiedAt:frontpages.available?frontpages.checkedAt:null,count:featuredCount,rejected:frontpages.rejected,
    error:featuredCount||frontpages.available?null:'NEWS_FRONTPAGES_UNAVAILABLE',retryAt:null,scope:NEWS_FEATURED_SOURCE.scope,termsUrl:NEWS_FEATURED_SOURCE.termsUrl,windowed:true})});
  // Category results carry each card once; reconcile counts this audit source through sourceIds.
  return Object.freeze([...categoryResults,featuredResult]);
}
