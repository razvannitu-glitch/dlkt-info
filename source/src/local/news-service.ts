import {createHash} from 'node:crypto';
import type {City} from './contracts.js';
import type {SourceDefinition} from '../iceo/contracts.js';
import {extract} from '../iceo/extract.js';
import {readBounded,sourceRetryDelay} from '../iceo/transport.js';
import {robotsAllowed} from './publications.js';
import {NEWS_CHECK_MS,NEWS_WINDOW_MS,newsFeed,newsFeedsFor,newsGeographicAnchors,newsSourceForUrl,newsTopic,validLocalNewsArticle,type NewsFeedDefinition,type LocalNewsArticle,type NewsSourceHealth,type CityNewsSnapshot} from './news-policy.js';

const BODY_LIMIT=2_097_152;
const FEED_CACHE_MS=120000;
const ROBOTS_CACHE_MS=21600000;
interface NewsDocument {readonly body:string;readonly checkedAt:string;readonly until:number}
export interface LocalNewsExtraction {readonly articles:readonly LocalNewsArticle[];readonly rejected:number}
const iso=(now:number):string=>new Date(now).toISOString();
const sha=(value:string):string=>createHash('sha256').update(value).digest('hex');
const clean=(value:string):string=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
function feedConfiguration(source:NewsFeedDefinition):SourceDefinition{
  const home=new URL(source.home);
  return {id:source.id,label:source.publisher+' local reporting',publisher:source.publisher,topic:'public-affairs',adapter:'reviewed-feed',
    endpoint:source.endpoint,homepage:source.home,termsUrl:source.termsUrl,attribution:source.attribution,
    scope:'Publisher-provided local journalism with explicit article place references. Recent publication is not proof that a reported event happened today.',
    rightsCheckedAt:source.rightsCheckedAt,rightsReviewBy:source.rightsReviewBy,
    feed:{format:'rss',title:source.title,homeOrigin:home.origin,homePath:home.pathname,articleOrigins:[home.origin],articlePaths:[home.pathname],
      dateField:'pubDate',dateLabel:'Published',summary:'description',refreshSeconds:120,windowDays:3,requireDateTimezone:true,
      boundary:'Publisher headline or excerpt. Publication date is distinct from occurrence time. Claims remain attributed to the publisher; this is not independent confirmation or an emergency alert.',
      ...(source.licenseUrl?{credits:'creator' as const,licenseUrl:source.licenseUrl}:{})}};
}
/** WordPress attribution trailers are not article location evidence. */
function withoutTrailer(summary:string|undefined,title:string,source:NewsFeedDefinition):string|undefined{
  if(!summary)return undefined;
  let value=clean(summary);
  const trailers=[`Articolul ${title} apare prima dată în ${source.title}.`,`The post ${title} appeared first on ${source.title}.`];
  for(const trailer of trailers)if(value.endsWith(trailer))value=value.slice(0,-trailer.length).trim();
  return value||undefined;
}
/** Keep complete sentences that fit the quote allowance; never invent a summary or cut a qualifier mid-sentence. */
function boundedExcerpt(summary:string|undefined,remaining:number):string|undefined{
  if(!summary||remaining<40)return undefined;
  const segments=new Intl.Segmenter('ro',{granularity:'sentence'}).segment(summary);
  let output='';
  for(const segment of segments){
    const sentence=segment.segment.trim();
    if(!sentence||/\[(?:\.{3}|…)\]|\.\.\.|…/u.test(sentence)||!/[.!?](?:["”»])?$/u.test(sentence))break;
    const candidate=output?output+' '+sentence:sentence;
    if(candidate.length>remaining)break;
    output=candidate;
  }
  return output||undefined;
}
export function parseLocalNews(body:string,sourceId:string,city:City,checkedAt:string,now:number):LocalNewsExtraction{
  const source=newsFeed(sourceId);
  if(!source||!newsFeedsFor(city).some(s=>s.id===source.id)||!Number.isFinite(now))throw Error('NEWS_SOURCE_IDENTITY');
  if(new Date(now).toISOString().slice(0,10)>source.rightsReviewBy)throw Error('NEWS_RIGHTS_EXPIRED');
  const checked=Date.parse(checkedAt);
  if(!Number.isFinite(checked)||iso(checked)!==checkedAt||checked>now+5000||checked<=now-NEWS_CHECK_MS)throw Error('NEWS_CHECK_EXPIRED');
  if(Buffer.byteLength(body,'utf8')>BODY_LIMIT)throw Error('NEWS_BODY_TOO_LARGE');
  const extracted=extract(body,feedConfiguration(source),now),documentHash=sha(body),articles:LocalNewsArticle[]=[];
  let rejected=extracted.rejected;
  const seen=new Set<string>();
  for(const card of [...extracted.cards].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.sourceUrl.localeCompare(b.sourceUrl))){
    if(seen.has(card.sourceUrl)){rejected++;continue;}
    seen.add(card.sourceUrl);
    if(newsSourceForUrl(card.sourceUrl)?.id!==source.id||card.title.length>Math.min(300,source.quoteLimit)){rejected++;continue;}
    const title=card.title;
    const summary=boundedExcerpt(withoutTrailer(card.summary,title,source),source.quoteLimit-title.length-1);
    const geoAnchors=newsGeographicAnchors(title,summary,source.id,city);
    if(!geoAnchors.length){rejected++;continue;}
    const article:LocalNewsArticle={id:'local-news:'+city.id+':'+source.id+':'+sha(card.sourceUrl).slice(0,24),sourceId:source.id,title,
      ...(summary?{summary}:{}),publisher:source.publisher,url:card.sourceUrl,publishedAt:card.date,checkedAt,validUntil:iso(checked+NEWS_CHECK_MS),
      topic:newsTopic(title,summary),cityId:city.id,geographyBasis:'article-place-reference',geoAnchors,documentHash,documentUrl:source.endpoint,attribution:source.attribution,
      ...(card.byline?{byline:card.byline}:{}),...(source.licenseUrl?{licenseUrl:source.licenseUrl}:{})};
    if(!validLocalNewsArticle(article,city,now)){rejected++;continue;}
    articles.push(article);if(articles.length===20)break;
  }
  return{articles,rejected};
}

/** A bounded in-process cache uses only the reviewed endpoints; no article URL is fetched. */
export class LocalNewsService{
  private readonly documents=new Map<string,NewsDocument>();
  private readonly pending=new Map<string,Promise<NewsDocument>>();
  private readonly backoff=new Map<string,number>();
  constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
  private async acquire(url:string,robots:boolean):Promise<NewsDocument>{
    const now=this.clock(),cached=this.documents.get(url);if(cached&&cached.until>now)return cached;
    const running=this.pending.get(url);if(running)return running;
    const origin=new URL(url).origin;if(now<(this.backoff.get(origin)??0)||this.pending.size>=4)throw Error('NEWS_BACKOFF');
    const job=(async():Promise<NewsDocument>=>{
      const response=await this.fetcher(url,{method:'GET',credentials:'omit',redirect:'manual',headers:{
        Accept:robots?'text/plain':'application/rss+xml, application/xml, text/xml',
        'Accept-Encoding':'identity','User-Agent':'DLKT-Info/0.9.42 (+https://www.dlkt.ee)'},signal:AbortSignal.timeout(5000)});
      // Reviewed feeds only: a missing robots resource is not an authenticated/content access denial.
      if(robots&&response.status===404){await response.body?.cancel();const checked=this.clock(),value={body:'',checkedAt:iso(checked),until:checked+ROBOTS_CACHE_MS};this.documents.set(url,value);return value;}
      if(response.status!==200){const delay=sourceRetryDelay(response.headers,this.clock());await response.body?.cancel();if(delay!==null)this.backoff.set(origin,this.clock()+Math.max(60000,delay*1000));throw Error('NEWS_HTTP_'+response.status);}
      const type=(response.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase()??'';
      if(!(robots?['text/plain']:['application/rss+xml','application/xml','text/xml']).includes(type)){await response.body?.cancel();throw Error('NEWS_CONTENT_TYPE');}
      const body=await readBounded(response,robots?65536:BODY_LIMIT),checked=this.clock();
      const value={body,checkedAt:iso(checked),until:checked+(robots?ROBOTS_CACHE_MS:FEED_CACHE_MS)};
      if(this.documents.size>=16)this.documents.delete(this.documents.keys().next().value??'');
      this.documents.set(url,value);return value;
    })();
    this.pending.set(url,job);
    try{return await job;}catch(error){this.backoff.set(origin,Math.max(this.backoff.get(origin)??0,this.clock()+60000));throw error;}finally{this.pending.delete(url);}
  }
  private async source(source:NewsFeedDefinition,city:City):Promise<{readonly articles:readonly LocalNewsArticle[];readonly health:NewsSourceHealth}>{
    const common={sourceId:source.id,publisher:source.publisher,feedUrl:source.endpoint,termsUrl:source.termsUrl};
    try{
      const now=this.clock();if(new Date(now).toISOString().slice(0,10)>source.rightsReviewBy)throw Error('NEWS_RIGHTS_EXPIRED');
      const robots=await this.acquire(new URL(source.endpoint).origin+'/robots.txt',true);
      if(!robotsAllowed(robots.body,source.endpoint))throw Error('NEWS_ROBOTS_DENIED');
      const document=await this.acquire(source.endpoint,false);
      const parsed=parseLocalNews(document.body,source.id,city,document.checkedAt,this.clock());
      return{articles:parsed.articles,health:{...common,state:parsed.rejected?'partial':'ready',checkedAt:document.checkedAt,count:parsed.articles.length,rejected:parsed.rejected,error:null}};
    }catch(error){
      const message=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,80}$/u.test(error.message)?error.message:'NEWS_UNAVAILABLE';
      return{articles:[],health:{...common,state:'unavailable',checkedAt:null,count:0,rejected:0,error:message}};
    }
  }
  async snapshot(city:City):Promise<CityNewsSnapshot>{
    const results=await Promise.all(newsFeedsFor(city).map(source=>this.source(source,city)));
    const now=this.clock();
    // Each source check is retained; neither a cache hit nor a later snapshot restamps publication/check time.
    const articles=results.flatMap(result=>result.articles).filter(article=>validLocalNewsArticle(article,city,now)
      &&Date.parse(article.publishedAt)>=now-NEWS_WINDOW_MS).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||a.id.localeCompare(b.id)).slice(0,40);
    const sources=results.map(result=>({...result.health,count:articles.filter(article=>article.sourceId===result.health.sourceId).length}));
    return{articles,sources};
  }
}
export const localNewsService=new LocalNewsService();
