import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import type {EvidenceCard} from './contracts.js';
import {ICEO_SOURCES} from './registry.js';
import {readBounded,sourceRetryDelay} from './transport.js';
import {INSIGHT_VERSION,insightSupported,type SourceInsight,type SourcePoint} from './insight-contracts.js';
const digest=(value:string):string=>createHash('sha256').update(value).digest('hex');
const clean=(value:string):string=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
const terms=(card:EvidenceCard):string=>ICEO_SOURCES.find(source=>card.sourceIds.includes(source.id))?.termsUrl??'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html';
const policy=(card:EvidenceCard,now:number):void=>{
  const source=ICEO_SOURCES.find(s=>card.sourceIds.includes(s.id));
  if(!source||new Date(now).toISOString().slice(0,10)>source.rightsReviewBy)throw new Error('INSIGHT_RIGHTS_REVIEW_REQUIRED');
  if(card.sourceState==='stale')throw new Error('INSIGHT_STALE_LISTING');
};
export function emptyInsight(card:EvidenceCard,now:number,state:'unsupported'|'unavailable',reason:string):SourceInsight {
  return {version:INSIGHT_VERSION,cardId:card.id,cardHash:card.contentHash,state,method:'publisher-excerpts',sourceUrl:card.sourceUrl,checkedAt:new Date(now).toISOString(),documentHash:null,introduction:'',points:[],availablePoints:0,nextStep:'Read the original source for the full context.',attribution:card.publisher,termsUrl:terms(card),reason};
}
function result(card:EvidenceCard,now:number,body:string,items:readonly string[],section:string,introduction:string):SourceInsight {
  if(items.length===0)throw new Error('INSIGHT_NO_SUPPORTED_PASSAGES');
  // Whole publisher bullets/paragraphs only. No sentence truncation or generated claims.
  const eligible=items.map((text,index)=>({text:clean(text),index})).filter(p=>p.text.length>=20&&p.text.length<=1000&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(p.text));
  const points:SourcePoint[]=[];let used=0;
  for(const p of eligible){if(points.length===3)break;if(used+p.text.length>2000)continue;points.push({...p,section,hash:digest(p.text)});used+=p.text.length;}
  if(points.length===0)throw new Error('INSIGHT_NO_SUPPORTED_PASSAGES');
  return Object.freeze({version:INSIGHT_VERSION,cardId:card.id,cardHash:card.contentHash,state:'ready',method:'publisher-excerpts',sourceUrl:card.sourceUrl,checkedAt:new Date(now).toISOString(),documentHash:digest(body),introduction,points:Object.freeze(points),availablePoints:eligible.length,
    nextStep:card.kind==='software-release'?'Review the complete release notes and compatibility with your application before updating. No software is installed by DLKT.':'Read the full publication for definitions, reporting period and methodology. These figures are not a personalised financial recommendation.',
    attribution:card.kind==='software-release'?`Source: ${card.publisher}. Selected release-note passages; formatting normalised. Licence and original source remain linked.`:'Source: European Central Bank. Selected official publication passages; formatting normalised. Original information is available free of charge on the ECB website.',termsUrl:terms(card),reason:null});
}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('INSIGHT_SCHEMA_INVALID');return value as Record<string,unknown>;}
function plainMarkdown(value:string):string {
  return clean(value.replace(/!\[[^\]]*\]\([^\n)]*\)/gu,'').replace(/\[([^\]]+)\]\(https:\/\/[^\n)]*\)/gu,'$1').replace(/\\([_\[\]*`])/gu,'$1').replace(/[*`]/gu,''));
}
export function extractRelease(body:string,card:EvidenceCard,now:number):SourceInsight {
  const data=record(JSON.parse(body) as unknown);
  if(data.html_url!==card.sourceUrl||data.tag_name!==card.version||data.draft!==false||data.prerelease!==false
    ||typeof data.body!=='string'||data.body.length>500_000
    ||typeof data.published_at!=='string'||Date.parse(data.published_at)!==Date.parse(card.date))throw new Error('INSIGHT_DOCUMENT_MISMATCH');
  const lines=data.body.replace(/\r\n?/gu,'\n').split('\n');
  let section='',collect=false;const points:string[]=[];
  for(let i=0;i<lines.length;i++){
    const line=lines[i]??'';const h=/^#{1,4}\s+(.+)$/u.exec(line);
    if(h){if(collect)break;section=h[1]??'';collect=/^(?:Notable Changes|Core Changes|What's Changed|Changes|Bug fixes)$/iu.test(section);continue;}
    if(!collect||!/^\s*[-*]\s+/u.test(line))continue;
    let item=line.replace(/^\s*[-*]\s+/u,'');
    // Keep indented continuation lines attached; dropping qualifiers is not allowed.
    while(i+1<lines.length&&/^\s{2,}\S/u.test(lines[i+1]??'')){item+=' '+(lines[++i]??'').trim();}
    points.push(plainMarkdown(item));
  }
  const security=/^This is a security release\.$/mu.test(data.body);
  return result(card,now,body,points,section,security?'The maintainers identify this as a security release. Selected fixes from their release notes:':'Selected changes from the maintainers’ release notes. This selection is not the complete changelog.');
}
export function extractEcb(body:string,card:EvidenceCard,now:number):SourceInsight {
  if(/<!\s*ENTITY/iu.test(body))throw new Error('INSIGHT_HTML_INVALID');
  const doc=parseDocument(body,{decodeEntities:true});
  const mains=DomUtils.findAll(n=>n.name==='main',doc.children);if(mains.length!==1)throw new Error('INSIGHT_CONTENT_NOT_IDENTIFIED');
  const main=mains[0];if(!main)throw new Error('INSIGHT_CONTENT_NOT_IDENTIFIED');
  const titles=DomUtils.findAll(n=>n.name==='h1',main.children);
  if(titles.length!==1||clean(DomUtils.textContent(titles[0]??main))!==clean(card.title))throw new Error('INSIGHT_DOCUMENT_MISMATCH');
  const canonical=DomUtils.findAll(n=>n.name==='link'&&n.attribs.rel==='canonical',doc.children)[0];
  if(canonical?.attribs.href){
    const expected=new URL(card.sourceUrl),actual=new URL(canonical.attribs.href,card.sourceUrl);
    // ECB intermittently emits one duplicate leading slash in its own canonical tag.
    // Only that exact spelling variation is tolerated; title, host, path and content gates remain.
    const duplicateLeadingSlash=expected.origin==='https://www.ecb.europa.eu'&&actual.origin===expected.origin
      &&!actual.username&&!actual.password&&!actual.port&&!actual.search&&!actual.hash
      &&expected.pathname.startsWith('/press/')&&actual.pathname==='/'+expected.pathname;
    if(actual.href!==expected.href&&!duplicateLeadingSlash)throw new Error('INSIGHT_DOCUMENT_MISMATCH');
  }
  if(DomUtils.findAll(n=>/(?:^|\s)(?:author|byline)(?:\s|$)/iu.test(n.attribs.class??''),main.children).length)throw new Error('INSIGHT_AUTHOR_REVIEW_REQUIRED');
  for(const n of DomUtils.findAll(n=>['script','style','nav','aside','form','template','noscript','iframe','figure'].includes(n.name)||n.attribs.hidden!==undefined||n.attribs['aria-hidden']==='true',main.children))DomUtils.removeElement(n);
  const section=DomUtils.findAll(n=>n.name==='div'&&(n.attribs.class??'').split(/\s/u).includes('section'),main.children)[0];
  if(!section)throw new Error('INSIGHT_CONTENT_NOT_IDENTIFIED');
  const firstList=section.children.find(n=>n.type==='tag'&&n.name==='ul');
  const firstHeading=section.children.findIndex(n=>n.type==='tag'&&/^h[2-6]$/u.test(n.name));
  if(!firstList||(firstHeading>=0&&section.children.indexOf(firstList)>firstHeading))throw new Error('INSIGHT_NO_PUBLISHER_HIGHLIGHTS');
  const items=DomUtils.findAll(n=>n.name==='li', [firstList]).map(n=>DomUtils.textContent(n));
  return result(card,now,body,items,'Publisher highlights','Key points published by the ECB. The figures refer to the reporting period in the original publication, not the date you read this card.');
}
interface CacheEntry{readonly until:number;readonly value:SourceInsight}
export class InsightService {
  private readonly cache=new Map<string,CacheEntry>();
  private readonly pending=new Map<string,Promise<SourceInsight>>();
  private readonly nextHostAttempt=new Map<string,number>();
  constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
  async read(card:EvidenceCard):Promise<SourceInsight>{
    const now=this.clock();
    if(!insightSupported(card))return emptyInsight(card,now,'unsupported','FORMAT_NOT_REVIEWED');
    try{policy(card,now);}catch(error){return emptyInsight(card,now,'unavailable',error instanceof Error?error.message:'POLICY_REJECTED');}
    const key=`${card.id}:${card.contentHash}`;const hit=this.cache.get(key);
    if(hit&&now<hit.until)return hit.value;
    const pending=this.pending.get(key);if(pending)return pending;
    if(this.pending.size>=4)return emptyInsight(card,now,'unavailable','SOURCE_CAPACITY_BUSY');
    const job=this.acquire(card).then(value=>{
      if(this.cache.size>=256){const oldest=this.cache.keys().next().value;if(oldest)this.cache.delete(oldest);}
      this.cache.set(key,{until:this.clock()+(value.state==='ready'?900_000:60_000),value});return value;
    });
    this.pending.set(key,job);try{return await job;}finally{this.pending.delete(key);}
  }
  private async acquire(card:EvidenceCard):Promise<SourceInsight>{
    try{
      let url=card.sourceUrl;
      if(card.kind==='software-release'){
        const repo=card.sourceIds.includes('nodejs')?'nodejs/node':'vercel/next.js';
        url=`https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(card.version??'')}`;
      }
      const host=new URL(url).hostname;
      if(this.clock()<(this.nextHostAttempt.get(host)??0))throw new Error('SOURCE_BACKOFF');
      const headers:Record<string,string>={Accept:card.kind==='software-release'?'application/vnd.github+json':'text/html','User-Agent':'DLKT-Info-ICEO/0.9.2 (+https://www.dlkt.ee)'};
      if(card.kind==='software-release')headers['X-GitHub-Api-Version']='2022-11-28';
      const r=await this.fetcher(url,{method:'GET',headers,credentials:'omit',redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(8000)});
      if(r.status!==200){const delay=sourceRetryDelay(r.headers,this.clock());if(delay!==null)this.nextHostAttempt.set(host,this.clock()+Math.max(60,delay)*1000);await r.body?.cancel();throw new Error(r.status>=300&&r.status<400?'SOURCE_REDIRECT_REJECTED':`SOURCE_HTTP_${r.status}`);}
      const type=(r.headers.get('content-type')??'').split(';')[0]?.trim().toLowerCase();
      if(type!==(card.kind==='software-release'?'application/json':'text/html')){await r.body?.cancel();throw new Error('SOURCE_CONTENT_TYPE_REJECTED');}
      const body=await readBounded(r,1_048_576);
      return card.kind==='software-release'?extractRelease(body,card,this.clock()):extractEcb(body,card,this.clock());
    }catch(error){return emptyInsight(card,this.clock(),'unavailable',error instanceof Error&&/^[A-Z][A-Z0-9_]+$/u.test(error.message)?error.message:'SOURCE_UNAVAILABLE');}
  }
}
export const insightService=new InsightService();
