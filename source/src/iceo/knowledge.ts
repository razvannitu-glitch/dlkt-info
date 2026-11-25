import {isNewsCategoryId,type NewsCategoryId} from './news-taxonomy.js';

export const KNOWLEDGE_VERSION='dlkt-knowledge-1' as const;
export type KnowledgeLanguage='en'|'ro'|'it';
export type KnowledgeFilter='all'|NewsCategoryId;
export type KnowledgeFormat='did-you-know'|'on-this-day'|'recipe'|'care'|'useful'|'elsewhere';
export interface KnowledgeCopy {readonly title:string;readonly explanation:string;readonly connection:string}
export interface KnowledgeCard {
 readonly kind:'knowledge';readonly id:string;readonly revision:number;readonly category:NewsCategoryId;
 readonly format?:KnowledgeFormat;readonly calendarDay?:string;
 readonly topic:Readonly<Record<KnowledgeLanguage,string>>;
 readonly source:Readonly<{publisher:string;url:string}>;
 readonly geography?:Readonly<{countryCode:string;cityIds:readonly string[];label:Readonly<Record<KnowledgeLanguage,string>>}>;
 readonly copy:Readonly<Record<KnowledgeLanguage,KnowledgeCopy>>;
 /** Editorial release is separate from the source review; omission preserves existing cards. */
 readonly publishAt?:string;
 readonly reviewedAt:string;readonly reviewBy:string;
}
export const DLKT_PLUS_PLAN=Object.freeze({
 id:'dlkt-plus',currency:'EUR',monthlyMinor:699,trialDays:7,status:'planned',billingAvailable:false,
} as const);
const languages:readonly KnowledgeLanguage[]=['en','ro','it'];
const origins=new Set([
 'https://science.nasa.gov','https://home.cern','https://www.kew.org',
 'https://oceanservice.noaa.gov','https://weather.metoffice.gov.uk','https://www.qrcode.com',
 'https://www.nps.gov','https://www.ecb.europa.eu','https://www.olympics.com','https://www.afb.org',
 'https://www.museoegizio.it','https://www.filarmonicaenescu.ro',
 'https://www.computerhistory.org','https://foodhero.org',
 'https://www.who.int','https://fundatiarenasterea.ro','https://hospice.ro',
 'https://support.google.com','https://www.ncsc.gov.uk','https://www.repaircafe.org',
 'https://oodihelsinki.fi','https://www.paris.fr','https://www.zooniverse.org',
]);
function object(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value);}
function text(value:unknown,max:number):value is string{return typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/u.test(value);}
function validKnowledgeGeography(value:unknown):boolean{
 if(!object(value)||typeof value.countryCode!=='string'||!/^[A-Z]{2}$/u.test(value.countryCode)||!Array.isArray(value.cityIds)||value.cityIds.length>20||!object(value.label))return false;
 if(value.cityIds.some(id=>typeof id!=='string'||!/^[1-9]\d{0,11}$/u.test(id))||new Set(value.cityIds).size!==value.cityIds.length)return false;
 const label=value.label;return languages.every(language=>text(label[language],100));
}
function instant(value:unknown):value is string{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))return false;
 const ms=Date.parse(value);return Number.isFinite(ms)&&new Date(ms).toISOString()===value;
}
export function safeKnowledgeSource(input:unknown):input is string{
 if(typeof input!=='string'||input.length>1000||/[\s\\]/u.test(input))return false;
 try{const url=new URL(input);return url.protocol==='https:'&&origins.has(url.origin)&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname.length>1&&url.href===input;}catch{return false;}
}
export function validKnowledgeCard(value:unknown):value is KnowledgeCard {
 if(!object(value)||value.kind!=='knowledge'||typeof value.id!=='string'||!/^[a-z][a-z0-9-]{2,79}$/u.test(value.id)||
  !Number.isSafeInteger(value.revision)||Number(value.revision)<1||!isNewsCategoryId(value.category)||
  !object(value.source)||!text(value.source.publisher,100)||!safeKnowledgeSource(value.source.url)||
  value.geography!==undefined&&!validKnowledgeGeography(value.geography)||
  value.format!==undefined&&!['did-you-know','on-this-day','recipe','care','useful','elsewhere'].includes(String(value.format))||
  value.format==='on-this-day'&&(!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/u.test(String(value.calendarDay))||!Number.isFinite(Date.parse('2024-'+String(value.calendarDay)+'T12:00:00.000Z'))||new Date('2024-'+String(value.calendarDay)+'T12:00:00.000Z').toISOString().slice(5,10)!==value.calendarDay)||
  value.format!=='on-this-day'&&value.calendarDay!==undefined||
  !instant(value.reviewedAt)||!instant(value.reviewBy)||Date.parse(value.reviewBy)<=Date.parse(value.reviewedAt)||
  value.publishAt!==undefined&&(!instant(value.publishAt)||Date.parse(value.publishAt)<Date.parse(value.reviewedAt)||Date.parse(value.publishAt)>=Date.parse(value.reviewBy))||
  Date.parse(value.reviewBy)-Date.parse(value.reviewedAt)>366*86400000||!object(value.copy)||!object(value.topic))return false;
 return languages.every(language=>{
  const copy=value.copy as Record<string,unknown>,topic=value.topic as Record<string,unknown>,entry=copy[language];
  return object(entry)&&text(entry.title,160)&&text(entry.explanation,600)&&text(entry.connection,240)&&text(topic[language],60);
 });
}
export function validateKnowledgeCatalog(input:unknown):readonly KnowledgeCard[]{
 if(!Array.isArray(input)||input.length>5000)throw Error('KNOWLEDGE_CATALOG_INVALID');
 const ids=new Set<string>(),cards:KnowledgeCard[]=[];
 for(const value of input){
  if(!validKnowledgeCard(value)||ids.has(value.id))throw Error('KNOWLEDGE_CARD_INVALID');
  ids.add(value.id);cards.push(value);
 }
 return cards;
}
export function knowledgeLanguage(locale:string):KnowledgeLanguage{
 const root=locale.toLowerCase().split(/[-_]/u)[0];return root==='ro'||root==='it'?root:'en';
}
function score(value:string):number{let hash=2166136261;for(const c of value){hash=Math.imul(hash^c.charCodeAt(0),16777619);}return hash>>>0;}
function knowledgeCalendar(now:number,timeZone:string):{readonly day:string;readonly formatter:Intl.DateTimeFormat}{
 if(!Number.isSafeInteger(now)||Math.abs(now)>8_640_000_000_000_000-48*3_600_000)throw Error('KNOWLEDGE_CONTEXT_INVALID');
 if(typeof timeZone!=='string'||!timeZone||timeZone.length>70)throw Error('KNOWLEDGE_TIMEZONE_INVALID');
 try{
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,calendar:'gregory',numberingSystem:'latn',year:'numeric',month:'2-digit',day:'2-digit'});
  return{day:knowledgeCalendarDay(formatter,now),formatter};
 }catch{throw Error('KNOWLEDGE_TIMEZONE_INVALID');}
}
function knowledgeCalendarDay(formatter:Intl.DateTimeFormat,now:number):string{
 const parts=formatter.formatToParts(now),part=(name:Intl.DateTimeFormatPartTypes):string=>parts.find(item=>item.type===name)?.value??'';
 return part('year')+'-'+part('month')+'-'+part('day');
}
/** Absolute next lifecycle boundary; this schedules presentation only, never source research.
 * Calendar search is bounded to48 hours and uses the selected zone, including DST.
 * The caller may cap its timer delay and recheck when the page returns to the foreground.
 */
export function nextKnowledgeBoundary(cards:readonly KnowledgeCard[],now:number,timeZone='UTC'):number|null{
 const calendar=knowledgeCalendar(now,timeZone),catalog=validateKnowledgeCatalog(cards),boundaries:number[]=[];
 let needsCalendar=false;
 for(const card of catalog){
  const release=Date.parse(card.publishAt??card.reviewedAt),expiry=Date.parse(card.reviewBy);
  if(expiry<=now)continue;
  if(release>now)boundaries.push(release);
  boundaries.push(expiry);
  if(card.format==='on-this-day'&&release<=now)needsCalendar=true;
 }
 if(needsCalendar){
  let low=now+1,high=now+48*3_600_000;
  // At most28 comparisons over the bounded millisecond interval.
  while(low<high){const middle=Math.floor((low+high)/2);if(knowledgeCalendarDay(calendar.formatter,middle)===calendar.day)low=middle+1;else high=middle;}
  boundaries.push(low);
 }
 return boundaries.length?Math.min(...boundaries):null;
}
/** Stable category rounds. The finite catalogue is never recycled to imitate new facts. */
export function selectKnowledgeCards(cards:readonly KnowledgeCard[],filter:KnowledgeFilter,now:number,seed:string,timeZone='UTC'):readonly KnowledgeCard[]{
 if(filter!=='all'&&!isNewsCategoryId(filter))throw Error('KNOWLEDGE_CATEGORY_INVALID');
 if(!Number.isFinite(now)||typeof seed!=='string'||seed.length>100)throw Error('KNOWLEDGE_CONTEXT_INVALID');
 const day=knowledgeCalendar(now,timeZone).day;
 const valid=validateKnowledgeCatalog(cards).filter(card=>Date.parse(card.publishAt??card.reviewedAt)<=now&&now<Date.parse(card.reviewBy)&&(filter==='all'||card.category===filter)&&(card.format!=='on-this-day'||card.calendarDay===day.slice(-5)));
 const groups=new Map<NewsCategoryId,KnowledgeCard[]>();
 for(const card of valid){const group=groups.get(card.category)??[];group.push(card);groups.set(card.category,group);}
 for(const group of groups.values())group.sort((a,b)=>score(seed+a.id)-score(seed+b.id)||a.id.localeCompare(b.id));
 const result:KnowledgeCard[]=[];let round=0,last:NewsCategoryId|null=null;
 while(groups.size){
  const order=[...groups.keys()].sort((a,b)=>score(seed+round+a)-score(seed+round+b)||a.localeCompare(b));
  if(order.length>1&&order[0]===last){const first=order.shift();if(first)order.push(first);}
  for(const category of order){const group=groups.get(category),card=group?.shift();if(card){result.push(card);last=category;}if(!group?.length)groups.delete(category);}
  round++;
 }
 return result;
}
export function knowledgeShareUrl(card:KnowledgeCard,language:KnowledgeLanguage):string {
 if(!validKnowledgeCard(card)||!languages.includes(language))throw Error('KNOWLEDGE_SHARE_INVALID');
 const url=new URL('https://www.dlkt.ee/');url.searchParams.set('lang',language);url.hash='know/'+card.id;return url.href;
}
export function knowledgeTargetFromHash(hash:string):string|null{
 const match=/^#know\/([a-z][a-z0-9-]{2,79})$/u.exec(hash);return match?.[1]??null;
}
