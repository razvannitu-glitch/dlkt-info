import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {readBounded,sourceRetryDelay} from '../iceo/transport.js';
import {PALMA_ID,localSource,type City,type LocalCard,type LocalCoverage,type LocalDomain} from './contracts.js';
import {ARCUB_AGENDA,parseArcubAgenda,parseArcubDetail,arcubPhotoRevision} from './arcub.js';
import {CMTEB_SOURCE,parseCmteb} from './cmteb.js';

/** Reviewed publisher capabilities. Discovery never turns a browser value into an outbound URL. */
export const PALMA_SOURCES={
 transport:{url:'https://www.tib.org/es/avisos',domain:'transport',publisher:'Consorci de Transports de Mallorca / TIB'},
 events:{url:'https://www.palmacultura.com/index.php?Idi=2',domain:'events',publisher:'Ajuntament de Palma / PalmaCultura'},
 administration:{url:'https://noticies.palma.es/inici',domain:'administration',publisher:'Ajuntament de Palma'},
} as const;
type SourceKey=keyof typeof PALMA_SOURCES;
type Element=ReturnType<typeof DomUtils.findAll>[number];
const clean=(v:string):string=>v.normalize('NFC').replace(/\s+/gu,' ').trim();
const text=(n:Element):string=>clean(DomUtils.textContent(n));
const has=(n:Element,c:string):boolean=>(n.attribs.class??'').split(/\s+/u).includes(c);
const digest=(v:string):string=>createHash('sha256').update(v).digest('hex');
const document=(v:string)=>{if(v.length>1_048_576||/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(v))throw Error('PUBLICATION_FORMAT');return parseDocument(v,{decodeEntities:true});};
const one=(nodes:readonly Element[]):Element=>{if(nodes.length!==1||!nodes[0])throw Error('PUBLICATION_IDENTITY');return nodes[0];};
const byClass=(root:ReturnType<typeof parseDocument>|Element,c:string):Element[]=>DomUtils.findAll(n=>has(n,c),root.children);
const monthNames=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const caMonths=['gener','febrer','març','abril','maig','juny','juliol','agost','setembre','octubre','novembre','desembre'];
export function sourceDay(v:string):string|null{
 const m=/^(\d{1,2})\s+(?:de\s+)?([a-zç]+)\s+de\s+(\d{4})$/iu.exec(clean(v));if(!m)return null;
 const index=Math.max(monthNames.indexOf((m[2]??'').toLowerCase()),caMonths.indexOf((m[2]??'').toLowerCase()));if(index<0)return null;
 const day=`${m[3]}-${String(index+1).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
 return Number.isFinite(Date.parse(day))&&new Date(day).toISOString().slice(0,10)===day?day:null;
}
export function madridDay(now:number):string{return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
/** Resolve a local wall-clock time with round-trip validation; nonexistent or ambiguous times are rejected. */
export function madridTime(day:string,hour:number,minute=0):number{
 if(!/^\d{4}-\d{2}-\d{2}$/u.test(day)||hour<0||hour>23||minute<0||minute>59)throw Error('PUBLICATION_TIME');
 const base=Date.parse(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
 const matches=[base-3600000,base-7200000].filter(t=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(t);const get=(k:string)=>p.find(x=>x.type===k)?.value;return `${get('year')}-${get('month')}-${get('day')}`===day&&Number(get('hour'))===hour&&Number(get('minute'))===minute;});
 if(matches.length!==1||!matches[0])throw Error('PUBLICATION_TIME');return matches[0];
}
function nextMidnight(now:number):number{const day=madridDay(now);let lo=now,hi=now+27*3600000;while(hi-lo>1){const m=Math.floor((lo+hi)/2);if(madridDay(m)===day)lo=m;else hi=m;}return hi;}
function canonical(href:string,base:string,kind:LocalCard['kind']):string{const u=new URL(href,base);u.search='';u.hash='';if(!localSource(u.href,kind))throw Error('PUBLICATION_URL');return u.href;}
const stamp=(t:number):string=>new Date(t).toISOString();
function expiry(checkedAt:string,now:number,until=nextMidnight(now)):string{return stamp(Math.min(Date.parse(checkedAt)+300000,until));}
interface PublicationDocument {readonly body:string;readonly checkedAt:string}
interface CachedDocument extends PublicationDocument{readonly until:number}

/** RFC-style user-agent groups and longest matching allow/disallow rule. Unknown policy fails closed. */
export function robotsAllowed(body:string,url:string):boolean{
 if(body.length>65536||/[\u0000]/u.test(body)||/<html/iu.test(body))return false;
 const groups:{agents:string[];rules:{allow:boolean;pattern:string}[]}[]=[];let group:{agents:string[];rules:{allow:boolean;pattern:string}[]}|null=null;
 for(const line of body.split(/\r?\n/u)){const raw=line.split('#')[0]?.trim()??'';const m=/^([^:]+):\s*(.*)$/u.exec(raw);if(!m)continue;const key=(m[1]??'').trim().toLowerCase(),v=(m[2]??'').trim();if(key==='user-agent'){if(!group||group.rules.length){group={agents:[],rules:[]};groups.push(group);}group.agents.push(v.toLowerCase());}else if(group&&(key==='allow'||key==='disallow')&&v)group.rules.push({allow:key==='allow',pattern:v});}
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'dlkt-info'.includes(a)));
 const applicable=specific.length?specific:groups.filter(g=>g.agents.includes('*'));if(!applicable.length)return groups.length===0&&body.trim().length===0;
 const u=new URL(url),path=u.pathname+u.search;let best=-1,allow=true;
 for(const rule of applicable.flatMap(g=>g.rules)){const end=rule.pattern.endsWith('$'),p=end?rule.pattern.slice(0,-1):rule.pattern;const expression='^'+p.split('*').map(x=>x.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('.*')+(end?'$':'');if(new RegExp(expression,'u').test(path)){const length=p.replaceAll('*','').length;if(length>best||length===best&&rule.allow){best=length;allow=rule.allow;}}}
 return allow;
}
export class PublicationCache{
 private readonly cache=new Map<string,CachedDocument>();private readonly pending=new Map<string,Promise<PublicationDocument>>();private readonly backoff=new Map<string,number>();
 constructor(private readonly fetcher:typeof fetch=fetch,private readonly clock:()=>number=Date.now){}
 async read(url:string):Promise<PublicationDocument>{
  const u=new URL(url),arcub=url===ARCUB_AGENDA||u.hostname==='arcub.ro'&&localSource(url,'event'),cmteb=url===CMTEB_SOURCE;const key=(Object.keys(PALMA_SOURCES) as SourceKey[]).find(k=>new URL(PALMA_SOURCES[k].url).origin===u.origin);
  const kind=key==='transport'?'transport-notice':key==='events'?'event':'municipal-news';
  if(!arcub&&!cmteb&&(!key||u.username||u.password||u.port||u.hash||(url!==PALMA_SOURCES[key].url&&!localSource(url,kind))))throw Error('PUBLICATION_URL');
  const robots=await this.acquire(u.origin+'/robots.txt',21600000,true,cmteb);if(!robotsAllowed(robots.body,url))throw Error('PUBLICATION_ROBOTS');
  return this.acquire(url,120000,false);
 }
 private async acquire(url:string,age:number,robots:boolean,unavailablePolicy=false):Promise<PublicationDocument>{
  const now=this.clock(),hit=this.cache.get(url);if(hit&&hit.until>now)return hit;const running=this.pending.get(url);if(running)return running;
  if(this.pending.size>=10||now<(this.backoff.get(new URL(url).origin)??0))throw Error('PUBLICATION_BACKOFF');
  const job=(async()=>{const r=await this.fetcher(url,{method:'GET',credentials:'omit',redirect:'manual',headers:{Accept:robots?'text/plain':'text/html','Accept-Encoding':'identity','User-Agent':'DLKT-Info/0.9.14 (+https://www.dlkt.ee)'},signal:AbortSignal.timeout(5000)});
   // RFC 9309 2.3.1.3: a missing robots resource is distinct from a denied content request.
   // This reviewed exception applies only to CMTEB robots; content, 401, 429, network and 5xx still fail closed.
   if(robots&&unavailablePolicy&&[403,404,410].includes(r.status)){await r.body?.cancel();const value={body:'',checkedAt:stamp(this.clock()),until:this.clock()+age};this.cache.set(url,value);return value;}
   if(r.status!==200){const delay=sourceRetryDelay(r.headers,this.clock());if(delay!==null)this.backoff.set(new URL(url).origin,this.clock()+Math.max(60000,delay*1000));await r.body?.cancel();throw Error('PUBLICATION_HTTP');}
   const type=r.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();if(type!==(robots?'text/plain':'text/html')){await r.body?.cancel();throw Error('PUBLICATION_TYPE');}
   const body=await readBounded(r,robots?65536:1_048_576),checkedAt=stamp(this.clock());if(this.cache.size>=48)this.cache.delete(this.cache.keys().next().value??'');const value={body,checkedAt,until:this.clock()+age};this.cache.set(url,value);return value;
  })();this.pending.set(url,job);try{return await job;}catch(e){this.backoff.set(new URL(url).origin,Math.max(this.backoff.get(new URL(url).origin)??0,this.clock()+60000));throw e;}finally{this.pending.delete(url);}
 }
}

export function parseCulture(d:PublicationDocument,now:number):{cards:LocalCard[];rejected:number;scanned:number}{
 const doc=document(d.body),boxes=byClass(doc,'box').filter(b=>DomUtils.findAll(n=>n.name==='h3',b.children).length>0);if(!boxes.length||boxes.length>50)throw Error('CULTURE_STRUCTURE');
 const cards:LocalCard[]=[];let rejected=0;const ids=new Set<string>();
 for(const box of boxes){try{
  const heading=one(DomUtils.findAll(n=>n.name==='h3',box.children));const a=one(DomUtils.findAll(n=>n.name==='a',heading.children));const url=canonical(a.attribs.href??'',PALMA_SOURCES.events.url,'event');
  const fields=new Map<string,string>();for(const p of DomUtils.findAll(n=>n.name==='p',box.children)){const html=DomUtils.getOuterHTML(p).replace(/<br\s*\/?\s*>/giu,'\n');for(const line of html.split('\n')){const plain=clean(DomUtils.textContent(parseDocument(line,{decodeEntities:true})));const m=/^([^:]+):\s*(.+)$/u.exec(plain);if(m)fields.set((m[1]??'').toLowerCase(),m[2]??'');}}
  const day=sourceDay(fields.get('fecha')??'');if(!day)throw Error('CULTURE_DATE');if(day!==madridDay(now))continue;
  const time=fields.get('hora')??'',m=/^(?:a partir de las\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*h$/iu.exec(time);if(!m)throw Error('CULTURE_TIME');const start=madridTime(day,Number(m[1]),Number(m[2]??0));if(start<=now)continue;
  const place=fields.get('lugar'),address=fields.get('dirección'),price=fields.get('precio');if(!place||!price)throw Error('CULTURE_TERMS');const title=text(heading);if(title.length>300)throw Error('CULTURE_TITLE');
  const id='palma:event:'+(new URL(url).pathname.split('/')[3]??'');if(ids.has(id))continue;ids.add(id);
  cards.push({id,kind:'event',title,text:`${place}${address?' · '+address:''}. ${time}. ${price}.`,publisher:PALMA_SOURCES.events.publisher,sourceUrl:url,sourceUpdatedAt:null,checkedAt:d.checkedAt,validFrom:d.checkedAt,validTo:expiry(d.checkedAt,now,start),facts:[`Published schedule: ${day} · ${time}`,`Venue: ${place}${address?' · '+address:''}`,`Listed admission terms: ${price}`],boundary:'Same-day municipal cultural listing, not a ticket availability check. Original publisher wording is retained. Reservation, capacity and any changes must be confirmed with the organiser.',context:{section:'discover',place:`${place}${address?' · '+address:''}`,when:`${day} · ${time} (Europe/Madrid)`,why:'Scheduled in your selected city today; its listed start is still ahead.',action:'Open the organiser listing to check reservation, capacity and current admission terms before leaving.',sourceDate:day,startsAt:stamp(start),status:'scheduled',documentHash:digest(d.body),documentUrl:PALMA_SOURCES.events.url}});
 }catch{rejected++;}}
 cards.sort((a,b)=>Date.parse(a.context?.startsAt??'')-Date.parse(b.context?.startsAt??''));return{cards:cards.slice(0,3),rejected,scanned:boxes.length};
}
interface Listing {readonly url:string;readonly title:string}
export function transportListings(d:PublicationDocument):readonly Listing[]{const doc=document(d.body);const links=DomUtils.findAll(n=>n.name==='a'&&has(n,'avisos-element'),doc.children);if(!links.length||links.length>100)throw Error('TIB_STRUCTURE');return links.flatMap(a=>{const headings=byClass(a,'avisos-card-title');if(headings.length!==1)return[];const title=text(one(headings));if(!/\bPalma\b/iu.test(title))return[];try{return[{url:canonical(a.attribs.href??'',PALMA_SOURCES.transport.url,'transport-notice'),title}];}catch{return[];}}).filter((v,i,all)=>all.findIndex(a=>a.url===v.url)===i).slice(0,3);}
export function parseTransport(d:PublicationDocument,listing:Listing,now:number):LocalCard|null{
 const doc=document(d.body),main=one(byClass(doc,'avisos-container'));const title=text(one(byClass(main,'avisos-container-title')));if(title!==listing.title)throw Error('TIB_IDENTITY');
 const published=text(one(byClass(main,'avisos-container-date'))),date=/^(\d{2})-(\d{2})-(\d{4})/u.exec(published);if(!date)throw Error('TIB_PUBLICATION_DATE');const publishedDay=`${date[3]}-${date[2]}-${date[1]}`;
 const body=text(one(byClass(main,'avisos-container-content-body')));const year=Number(date[3]),period=/^(\d{1,2})\s+de\s+([a-z]+):/iu.exec(title);if(!period)throw Error('TIB_EFFECTIVE_DATE');const day=sourceDay(`${period[1]} de ${period[2]} de ${year}`);if(!day)throw Error('TIB_EFFECTIVE_DATE');if(day!==madridDay(now))return null;
 const end=/hasta las?\s+(\d{1,2})(?:[.:](\d{2}))?\s*h/iu.exec(body);if(!end)throw Error('TIB_END_UNKNOWN');const until=madridTime(day,Number(end[1]),Number(end[2]??0));if(until<=now)return null;
 const start=/(?:entre|desde|a partir de)\s+las?\s+(\d{1,2})(?:[.:](\d{2}))?(?:\s*h\b|(?=\s+(?:hasta|y|a)\b))/iu.exec(body);if(/(?:entre|desde|a partir de)\s+las?\s+/iu.test(body)&&!start)throw Error('TIB_START_UNKNOWN');if(start&&madridTime(day,Number(start[1]),Number(start[2]??0))>now)return null;
 const lines=byClass(main,'avisos-container-lines-body').map(n=>text(n)).filter(Boolean);if(!lines.length||body.length>7000)throw Error('TIB_SCOPE');
 return{id:'palma:tib:'+digest(listing.url).slice(0,24),kind:'transport-notice',title,text:`TIB reports a change affecting ${lines.join(', ')} and access to Palma. Check the operator notice for affected stops and directions.`,publisher:PALMA_SOURCES.transport.publisher,sourceUrl:listing.url,sourceUpdatedAt:null,checkedAt:d.checkedAt,validFrom:d.checkedAt,validTo:expiry(d.checkedAt,now,until),facts:[`Operator notice published: ${publishedDay}`,`Affected lines: ${lines.join(', ')}`,body],boundary:'A TIB interurban bus notice explicitly naming Palma. This is not complete EMT, road, train or airport coverage. Missing notices do not establish normal service.',context:{section:'essential',place:'Palma · '+lines.join(', '),when:`${day} · operator end time ${end[1]}:${end[2]??'00'} (Europe/Madrid)`,why:'The operator identifies a change to a service entering or leaving your selected city today.',action:'Open the complete operator notice and check your line and stop before travelling.',sourceDate:publishedDay,startsAt:null,status:'operator-notice',documentHash:digest(d.body),documentUrl:listing.url}};
}
export function municipalListings(d:PublicationDocument):readonly Listing[]{const doc=document(d.body);const items=byClass(doc,'news-item');if(!items.length||items.length>50)throw Error('MUNICIPAL_STRUCTURE');return items.flatMap(item=>{const parent=item.parent;if(parent?.type!=='tag'||parent.name!=='a')return[];const titles=byClass(item,'news-content-title');if(titles.length!==1)return[];const p=DomUtils.findAll(n=>n.name==='p'&&Boolean(text(n)),one(titles).children)[0];if(!p)return[];try{return[{url:canonical(parent.attribs.href??'',PALMA_SOURCES.administration.url,'municipal-news'),title:text(p)}];}catch{return[];}}).filter((v,i,all)=>all.findIndex(a=>a.url===v.url)===i).slice(0,2);}
export function parseMunicipal(d:PublicationDocument,listing:Listing,now:number):LocalCard|null{
 const doc=document(d.body),heading=one(byClass(doc,'title-noticia'));if(text(heading)!==listing.title)throw Error('MUNICIPAL_IDENTITY');
 const dateText=text(one(byClass(doc,'detail-date'))),day=sourceDay(dateText);if(!day)throw Error('MUNICIPAL_DATE');const today=madridDay(now);if(day>today||Date.parse(today)-Date.parse(day)>3*86400000)return null;
 const title=listing.title;if(title.length>300)throw Error('MUNICIPAL_TITLE');
 return{id:'palma:municipal:'+digest(listing.url).slice(0,24),kind:'municipal-news',title,text:'The city council published this announcement. It is included as recent local context; publication alone does not establish a rule, an effective date or an independently confirmed outcome.',publisher:PALMA_SOURCES.administration.publisher,sourceUrl:listing.url,sourceUpdatedAt:null,checkedAt:d.checkedAt,validFrom:d.checkedAt,validTo:expiry(d.checkedAt,now),facts:[`Publisher date: ${day}`,`Publisher headline: ${title}`],boundary:'Recent announcement from the city council, with its original headline. This source represents the council’s account. Legal status, implementation, disputed claims and other parties’ accounts are not independently established by this card.',context:{section:'context',place:'Palma',when:`Published ${day}; effective date not established`,why:'A recent announcement by the administration of your selected city. It may describe a proposal, proceeding or decision; consult the underlying document.',action:'Read the complete announcement and the underlying decision or official register before relying on any claimed change.',sourceDate:day,startsAt:null,status:'publisher-announcement',documentHash:digest(d.body),documentUrl:listing.url}};
}

export interface LocalPublications {readonly cards:readonly LocalCard[];readonly coverage:readonly LocalCoverage[]}
export class LocalPublicationService{
 constructor(private readonly cache=new PublicationCache(),private readonly clock:()=>number=Date.now){}
 async snapshot(city:City):Promise<LocalPublications>{
  const uncovered:LocalCoverage[]=(['utilities','emergency-alerts','exchange','accommodation','opportunities'] as const).map(domain=>({domain,state:'not-covered',sourceUrl:null,checkedAt:null,note:`${({utilities:'Utility interruptions','emergency-alerts':'Official emergency warnings',exchange:'Currency reference rates',accommodation:'Accommodation prices and availability',opportunities:'Local opportunities and deadlines'})[domain]} are not connected for this city.`}));
  if(city.id==='683506'){
   const results=await Promise.allSettled([
    (async()=>{
     const agenda=await this.cache.read(ARCUB_AGENDA),parsed=parseArcubAgenda(agenda,this.clock());
     const candidates=parsed.cards.filter(card=>card.context?.place!=='Venue not specified in the agenda').slice(0,6);
     const enriched=new Map<string,LocalCard|null>();
     await Promise.all(candidates.map(async card=>{
      try{const detail=await this.cache.read(card.sourceUrl);enriched.set(card.id,parseArcubDetail({...detail,url:card.sourceUrl},card,this.clock())??card);}
      catch(error){enriched.set(card.id,error instanceof Error&&error.message==='ARCUB_DETAIL_PAST'?null:card);}
     }));
     return{cards:parsed.cards.flatMap(card=>{const value=enriched.has(card.id)?enriched.get(card.id):card;return value?[value]:[];}),checkedAt:agenda.checkedAt};
    })(),
    (async()=>{const document=await this.cache.read(CMTEB_SOURCE);return{...parseCmteb(document,this.clock()),checkedAt:document.checkedAt};})()
   ]);
   const cards:LocalCard[]=[],coverage:LocalCoverage[]=[];
   const events=results[0],utilities=results[1];
   if(events?.status==='fulfilled'){
    cards.push(...events.value.cards.map(card=>{const photoRevision=arcubPhotoRevision(card,city.id);return photoRevision?{...card,photoRevision}:card;}));coverage.push({domain:'events',state:'partial',checkedAt:events.value.checkedAt,sourceUrl:ARCUB_AGENDA,note:'ARCUB agenda and up to six linked event schedules. Confirmed date ranges retain their published precision; hours, ticket availability and other organisers are not covered.'});
   }else coverage.push({domain:'events',state:'unavailable',checkedAt:null,sourceUrl:ARCUB_AGENDA,note:'ARCUB could not be checked. Missing listings do not establish that no events are taking place.'});
   if(utilities?.status==='fulfilled'){
    cards.push(...utilities.value.cards);coverage.push({domain:'utilities',state:'partial',checkedAt:utilities.value.checkedAt,sourceUrl:CMTEB_SOURCE,note:'CMTEB public heating and hot-water status, summarised by sector. Estimates are not confirmed restoration times. Your address is not known; water, electricity and other utilities are not covered.'});
   }else coverage.push({domain:'utilities',state:'unavailable',checkedAt:null,sourceUrl:CMTEB_SOURCE,note:'CMTEB heating and hot-water status could not be checked. No normal-service or restoration claim is made.'});
   return{cards,coverage};
  }
  if(city.id!==PALMA_ID)return{cards:[],coverage:[]};
  const now=this.clock(),cards:LocalCard[]=[],coverage:LocalCoverage[]=[];
  const results=await Promise.allSettled((Object.keys(PALMA_SOURCES) as SourceKey[]).map(async key=>{
   const source=PALMA_SOURCES[key],index=await this.cache.read(source.url);let selected:LocalCard[]=[],rejected=0;
   if(key==='events'){const result=parseCulture(index,this.clock());selected=result.cards;rejected=result.rejected;}
   else{const listings=key==='transport'?transportListings(index):municipalListings(index);const details=await Promise.allSettled(listings.map(async listing=>{const d=await this.cache.read(listing.url);return key==='transport'?parseTransport(d,listing,this.clock()):parseMunicipal(d,listing,this.clock());}));for(const result of details){if(result.status==='fulfilled'){if(result.value)selected.push(result.value);}else rejected++;}}
   return{key,cards:selected,rejected,checkedAt:index.checkedAt};
  }));
  const keys=Object.keys(PALMA_SOURCES) as SourceKey[];
  for(let i=0;i<results.length;i++){const key=keys[i];if(!key)continue;const source=PALMA_SOURCES[key],result=results[i];if(result?.status==='fulfilled'){cards.push(...result.value.cards);coverage.push({domain:source.domain,state:result.value.rejected?'partial':'ready',sourceUrl:source.url,checkedAt:result.value.checkedAt,note:key==='transport'?`TIB notices explicitly naming Palma checked. Only notices with a verifiable same-day schedule can appear. EMT, roads, trains and other routes are not covered; this is not an all-clear.`:key==='events'?`PalmaCultura: up to 3 upcoming same-day listings, removed when their listed start or check expiry is reached. Ticket availability and the rest of the city’s events are not checked.${result.value.rejected?' Some listings could not be verified.':''}`:`City council: up to 2 announcements from the last 3 days. These are the publisher’s account, not independently verified measures.${result.value.rejected?' Some announcements could not be checked.':''}`});}else coverage.push({domain:source.domain,state:'unavailable',sourceUrl:source.url,checkedAt:null,note:`${key==='transport'?'Palma transport notices':key==='events'?'Palma cultural events':'Palma council announcements'} could not be verified. Missing information does not mean nothing is happening.`});}
  const completed=this.clock();return{cards:cards.filter(c=>Date.parse(c.validFrom)<Date.parse(c.validTo)&&Date.parse(c.validTo)>completed&&(c.kind!=='event'||c.context?.startsAt!==null&&Date.parse(c.context?.startsAt??'')>completed)),coverage:[...coverage,...uncovered]};
 }
}
export const localPublicationService=new LocalPublicationService();
