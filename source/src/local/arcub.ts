import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {localSource,type LocalCard} from './contracts.js';
import {arcubPhotoSource} from './photo-reference.js';

/** Only a publisher's own agenda, not a city-wide events feed. */
export const ARCUB_AGENDA='https://arcub.ro/agenda';
export interface ArcubDocument {readonly body:string;readonly checkedAt:string}
export interface ArcubResult {readonly cards:readonly LocalCard[];readonly scanned:number;readonly rejected:number}
export interface ArcubDetailDocument extends ArcubDocument {readonly url:string}

const has=(node:{attribs:Record<string,string>},name:string):boolean=>(node.attribs.class??'').split(/\s+/u).includes(name);
const clean=(value:string):string=>value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/gu,' ').replace(/\s+/gu,' ').trim();
const digest=(value:string):string=>createHash('sha256').update(value).digest('hex');
const month=/\b(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)\b/iu;

export function parseArcubAgenda(document:ArcubDocument,now:number):ArcubResult{
 if(!Number.isFinite(now)||document.body.length>1_048_576||!document.body.length||/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(document.body))throw Error('ARCUB_DOCUMENT');
 const checked=Date.parse(document.checkedAt);
 if(!Number.isFinite(checked)||checked>now+120000||now-checked>600000)throw Error('ARCUB_FRESHNESS');
 const parsed=parseDocument(document.body,{decodeEntities:true});
 const items=DomUtils.findAll(node=>has(node,'pgrid-item'),parsed.children);
 if(!items.length||items.length>40)throw Error('ARCUB_STRUCTURE');
 const cards:LocalCard[]=[];
 const seen=new Set<string>();
 const sourceHash=digest(document.body),date=new Date(checked).toISOString().slice(0,10);
 let rejected=0;
 for(const item of items){
  try{
   const anchors=DomUtils.findAll(node=>node.name==='a'&&DomUtils.findAll(child=>child.name==='h3',node.children).length===1,item.children);
   if(anchors.length!==1||!anchors[0])throw Error('ARCUB_ENTRY');
   const anchor=anchors[0],url=anchor.attribs.href??'';
   if(!localSource(url,'event')||!url.startsWith('https://arcub.ro/eveniment/'))throw Error('ARCUB_URL');
   const headings=DomUtils.findAll(node=>node.name==='h3',anchor.children);
   const meta=DomUtils.findAll(node=>has(node,'meta'),anchor.children);
   if(headings.length!==1||meta.length!==1||!headings[0]||!meta[0])throw Error('ARCUB_STRUCTURE');
   const spans=DomUtils.findAll(node=>node.name==='span',meta[0]!.children);
   const title=clean(DomUtils.textContent(headings[0]));
   const when=clean(spans[0]?DomUtils.textContent(spans[0]):'');
   const venue=clean(spans[1]?DomUtils.textContent(spans[1]):'');
   if(!title||title.length>300||when.length<6||when.length>150||!month.test(when)||venue.length>280)throw Error('ARCUB_FIELDS');
   if(seen.has(url)){rejected++;continue;}seen.add(url);
   const place=venue||'Venue not specified in the agenda';
   const card:LocalCard={
    id:'bucharest:arcub:'+digest(url).slice(0,24),kind:'event',title,
    text:'Listed on the ARCUB agenda: '+when+'. '+(venue?'Venue: '+venue+'. ':'')+'Check the organiser for exact times and ticket availability.',
    publisher:'ARCUB',sourceUrl:url,sourceUpdatedAt:null,checkedAt:document.checkedAt,
    validFrom:document.checkedAt,validTo:new Date(checked+300000).toISOString(),
    facts:['Date as published: '+when,'Venue as published: '+place],
    boundary:'This is an official ARCUB agenda entry, not a complete Bucharest event feed. The publisher may omit the year or exact time; neither is inferred. The sourceDate is the date checked, not a publication date. Tickets and availability are not verified.',
    context:{section:'discover',place,when,why:'Listed on the official ARCUB agenda at retrieval time.',action:'Confirm the date, time and tickets with ARCUB.',sourceDate:date,startsAt:null,status:'scheduled',documentHash:sourceHash,documentUrl:ARCUB_AGENDA}
   };
   cards.push(card);
  }catch{rejected++;}
 }
 if(!cards.length)throw Error('ARCUB_NO_VALID_EVENTS');
 return{cards:cards.slice(0,8),scanned:items.length,rejected};
}

const months=['ianuarie','februarie','martie','aprilie','mai','iunie','iulie','august','septembrie','octombrie','noiembrie','decembrie'];
const monthPattern=months.join('|');
interface SourcePeriod {readonly firstDay:number;readonly firstMonth:number;readonly firstYear:number|null;readonly lastDay:number;readonly lastMonth:number;readonly lastYear:number|null}
/** A year at the end of a same-year written range applies to that range, never to another date. */
function sourcePeriod(value:string):SourcePeriod|null {
 const m=new RegExp(`^(?:(\\d{1,2})(?:\\s+(${monthPattern}))?(?:\\s+(\\d{4}))?\\s*[-–—]\\s*)?(\\d{1,2})\\s+(${monthPattern})(?:\\s+(\\d{4}))?$`,'iu').exec(clean(value));
 if(!m)return null;
 const lastMonth=months.indexOf((m[5]??'').toLowerCase())+1,lastYear=m[6]?Number(m[6]):null;
 return{firstDay:Number(m[1]??m[4]),firstMonth:m[2]?months.indexOf(m[2].toLowerCase())+1:lastMonth,firstYear:m[3]?Number(m[3]):lastYear,lastDay:Number(m[4]),lastMonth,lastYear};
}
function calendarDay(year:number,monthNumber:number,day:number):string {
 const value=`${year}-${String(monthNumber).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
 if(year<2000||year>2200||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)throw Error('ARCUB_DETAIL_DATE');
 return value;
}
function bucharestTime(day:string,hour:number,minute:number):number {
 if(hour<0||hour>23||minute<0||minute>59)throw Error('ARCUB_DETAIL_TIME');
 const base=Date.parse(`${day}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00Z`);
 const matches=[base-7200000,base-10800000].filter(value=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bucharest',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(value);
  const get=(kind:string)=>parts.find(part=>part.type===kind)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`===day&&Number(get('hour'))===hour&&Number(get('minute'))===minute;
 });
 if(matches.length!==1||matches[0]===undefined)throw Error('ARCUB_DETAIL_TIME');
 return matches[0];
}
function samePeriod(left:SourcePeriod,right:SourcePeriod):boolean {
 return left.firstDay===right.firstDay&&left.firstMonth===right.firstMonth&&left.lastDay===right.lastDay&&left.lastMonth===right.lastMonth
  &&(left.firstYear===null||left.firstYear===right.firstYear)&&(left.lastYear===null||left.lastYear===right.lastYear);
}

/** Enrich only the agenda's own event with an explicit matching schedule from its detail page.
 * null means a verifiable schedule is absent; a labelled agenda-only fallback may be retained.
 * ARCUB_DETAIL_PAST means a verified schedule expired and the caller must omit that record.
 */
export function parseArcubDetail(document:ArcubDetailDocument,agendaCard:LocalCard,now:number):LocalCard|null {
 const context=agendaCard.context;
 if(!Number.isFinite(now)||!localSource(document.url,'event')||!document.url.startsWith('https://arcub.ro/eveniment/')||document.url!==agendaCard.sourceUrl
  ||agendaCard.kind!=='event'||agendaCard.publisher!=='ARCUB'||agendaCard.id!=='bucharest:arcub:'+digest(document.url).slice(0,24)||!context||context.documentUrl!==ARCUB_AGENDA)throw Error('ARCUB_DETAIL_IDENTITY');
 const checked=Date.parse(document.checkedAt);
 if(!Number.isFinite(checked)||checked>now+120000||now-checked>=300000)throw Error('ARCUB_DETAIL_FRESHNESS');
 if(!document.body.length||document.body.length>1_048_576||/<!\s*(?:ENTITY|DOCTYPE[^>]*\[)/iu.test(document.body))throw Error('ARCUB_DETAIL_DOCUMENT');
 const parsed=parseDocument(document.body,{decodeEntities:true});
 const containers=DomUtils.findAll(node=>has(node,'phead'),parsed.children);
 if(containers.length!==1||!containers[0])throw Error('ARCUB_DETAIL_STRUCTURE');
 const root=containers[0],headings=DomUtils.findAll(node=>node.name==='h1'&&has(node,'title'),root.children);
 if(headings.length!==1||!headings[0]||clean(DomUtils.textContent(headings[0]))!==clean(agendaCard.title))throw Error('ARCUB_DETAIL_IDENTITY');
 const tables=DomUtils.findAll(node=>node.name==='table'&&has(node,'feat'),root.children),contents=DomUtils.findAll(node=>has(node,'content'),root.children);
 if(tables.length!==1||!tables[0]||contents.length!==1||!contents[0])throw Error('ARCUB_DETAIL_STRUCTURE');
 const fields=new Map<string,string>();
 for(const row of DomUtils.findAll(node=>node.name==='tr',tables[0].children)){
  const labels=DomUtils.findAll(node=>node.name==='td'&&has(node,'lbl'),row.children),values=DomUtils.findAll(node=>node.name==='td'&&has(node,'val'),row.children);
  if(labels.length!==1||values.length!==1||!labels[0]||!values[0])continue;
  const key=clean(DomUtils.textContent(labels[0])).toLowerCase();
  if(fields.has(key))throw Error('ARCUB_DETAIL_STRUCTURE');
  fields.set(key,clean(DomUtils.textContent(values[0])));
 }
 const when=fields.get('când'),venue=fields.get('unde');
 if(!when||clean(when)!==clean(context.when)||!venue||venue.length>280||venue!==context.place)throw Error('ARCUB_DETAIL_IDENTITY');
 const expected=sourcePeriod(when);if(!expected)return null;
 // Inspect only the event body, excluding menu/footer dates and premiere metadata.
 for(const hidden of DomUtils.findAll(node=>['script','style','template','noscript'].includes(node.name),contents[0].children))DomUtils.removeElement(hidden);
 const body=clean(when+' '+DomUtils.textContent(contents[0]));
 const expression=new RegExp(`\\b(?:(\\d{1,2})(?:\\s+(${monthPattern}))?(?:\\s+(\\d{4}))?\\s*[-–—]\\s*)?(\\d{1,2})\\s+(${monthPattern})\\s+(\\d{4})\\b`,'giu');
 const schedules:{period:SourcePeriod;when:string;hour:number|null;minute:number|null}[]=[];
 for(const match of body.matchAll(expression)){
  const period=sourcePeriod(match[0]);
  if(!period||!samePeriod({...expected,firstYear:null,lastYear:null},period))continue;
  if(!samePeriod(expected,period))throw Error('ARCUB_DETAIL_DATE_CONFLICT');
  const after=body.slice((match.index??0)+match[0].length,(match.index??0)+match[0].length+55);
  const time=/^\s*,?\s*(?:de la\s+)?ora\s+(\d{1,2})[.:](\d{2})\b/iu.exec(after);
  schedules.push({period,when:match[0],hour:time?Number(time[1]):null,minute:time?Number(time[2]):null});
 }
 if(!schedules.length)return null;
 const years=new Set(schedules.map(item=>`${item.period.firstYear}:${item.period.lastYear}`));
 if(years.size!==1)throw Error('ARCUB_DETAIL_DATE_CONFLICT');
 const times=new Set(schedules.filter(item=>item.hour!==null).map(item=>`${item.hour}:${item.minute}`));
 if(times.size>1)throw Error('ARCUB_DETAIL_TIME_CONFLICT');
 const schedule=schedules.find(item=>item.hour!==null)??schedules[0];
 if(!schedule||schedule.period.firstYear===null||schedule.period.lastYear===null)return null;
 const first=calendarDay(schedule.period.firstYear,schedule.period.firstMonth,schedule.period.firstDay),last=calendarDay(schedule.period.lastYear,schedule.period.lastMonth,schedule.period.lastDay);
 if(last<first)throw Error('ARCUB_DETAIL_DATE_CONFLICT');
 // A bounded public agenda does not promote open-ended recruitment to a dated local outing.
 if(Date.parse(last)-Date.parse(first)>120*86400000)return null;
 const precise=first===last&&schedule.hour!==null&&schedule.minute!==null;
 const start=bucharestTime(first,precise?schedule.hour??0:0,precise?schedule.minute??0:0);
 const nextDay=new Date(Date.parse(last)+86400000).toISOString().slice(0,10),end=bucharestTime(nextDay,0,0);
 if((precise?start:end)<=now)throw Error('ARCUB_DETAIL_PAST');
 const validUntil=Math.min(checked+300000,precise?start:end);
 const periodCopy=precise?`${first} · ${String(schedule.hour).padStart(2,'0')}:${String(schedule.minute).padStart(2,'0')} (Europe/Bucharest)`:`${first}${first===last?'':' to '+last} · dates only; check opening hours`;
 return{...agendaCard,text:`${venue}. Published schedule: ${periodCopy}. Check the organiser for current admission and availability.`,checkedAt:document.checkedAt,validFrom:document.checkedAt,validTo:new Date(validUntil).toISOString(),
  facts:[`Published event schedule: ${periodCopy}`,`Venue as published: ${venue}`],
  boundary:'Schedule and venue from the official ARCUB event page. A published date range does not mean the venue is open now. Tickets, capacity, cancellations and availability are not verified. SourceDate is the retrieval date, not a publication date.',
  context:{...context,place:venue,when:periodCopy,why:'The event page supplies an explicit year and schedule matching its agenda entry.',action:'Check the organiser for opening hours, admission and any schedule changes.',sourceDate:new Date(checked).toISOString().slice(0,10),startsAt:new Date(start).toISOString(),...(precise?{}:{endsAt:new Date(end).toISOString()}),datePrecision:precise?'minute':'day',documentHash:digest(document.body),documentUrl:document.url}};
}

/** Stable current-event identity; the raw observed HTML hash remains separate evidence. */
export function arcubPhotoRevision(card:LocalCard,cityId:string):string|undefined {
 const context=card.context;
 if(card.kind!=='event'||card.publisher!=='ARCUB'||!context||!arcubPhotoSource(card.sourceUrl,{id:card.id,cityId}))return undefined;
 return digest(JSON.stringify(['dlkt-local-event-photo-1',cityId,card.id,card.kind,card.publisher,card.sourceUrl,card.title,
  context.section,context.status,context.place,context.when,context.startsAt,context.endsAt??null,context.datePrecision??null,context.documentUrl]));
}
