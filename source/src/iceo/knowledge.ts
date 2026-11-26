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
 /** Reviewed editorial suitability across borders, not a content licence or a local availability claim. */
 readonly distribution?:'cross-border';
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
/** Exact page/card bindings. A publisher domain is not a commercial licence.
 * Lab candidates only: the live catalogue is deliberately unchanged.
 * Admission requires a fresh item-level editorial and permitted-use review.
 */
const KNOWLEDGE_CC_BY='https://creativecommons.org/licenses/by/4.0/' as const;
export interface KnowledgeSourceRights {
 readonly credit:string;
 readonly licenseUrl:typeof KNOWLEDGE_CC_BY;
 readonly policyUrl:string;
}
interface ReviewedKnowledgePage {
 readonly id:string;readonly url:string;readonly publisher:string;
 readonly country:string;readonly label:Readonly<Record<KnowledgeLanguage,string>>;
 readonly rights:KnowledgeSourceRights;
}
const reviewedKnowledgePages:readonly ReviewedKnowledgePage[]=Object.freeze([
 Object.freeze({id:"dlkt-elsewhere-nsw-fuelcheck",url:"https://www.nsw.gov.au/legal-and-justice/consumer-rights-and-protection/advertising-product-packaging-and-pricing-laws/fuel-pricing-discounts-and-signage/check-fuel-prices",publisher:"NSW Government",country:"AU",label:Object.freeze({"en":"New South Wales, Australia","ro":"New South Wales, Australia","it":"Nuovo Galles del Sud, Australia"}),rights:Object.freeze({credit:"© State of New South Wales. For current information go to www.nsw.gov.au.",licenseUrl:KNOWLEDGE_CC_BY,policyUrl:"https://www.nsw.gov.au/nsw-government/about-website/copyright"})}),
 Object.freeze({id:"dlkt-elsewhere-nz-unit-pricing",url:"https://www.comcom.govt.nz/regulated-industries/grocery/information-for-consumers/",publisher:"Commerce Commission",country:"NZ",label:Object.freeze({"en":"New Zealand","ro":"Noua Zeelanda","it":"Nuova Zelanda"}),rights:Object.freeze({credit:"Crown Copyright ©, Commerce Commission.",licenseUrl:KNOWLEDGE_CC_BY,policyUrl:"https://www.comcom.govt.nz/using-our-website/copyright/"})}),
]);
function reviewedKnowledgeBinding(id:unknown,url:unknown):ReviewedKnowledgePage|undefined {
 return reviewedKnowledgePages.find(page=>page.id===id||page.url===url);
}
function matchesReviewedKnowledgeBinding(value:Record<string,unknown>,source:Record<string,unknown>):boolean {
 const page=reviewedKnowledgeBinding(value.id,source.url);
 if(page===undefined)return true;
 const geography=value.geography;
 if(value.id!==page.id||source.url!==page.url||source.publisher!==page.publisher||
  value.format!=='elsewhere'||value.distribution!=='cross-border'||value.category!=='04000000'||
  !object(geography)||geography.countryCode!==page.country||!Array.isArray(geography.cityIds)||geography.cityIds.length!==0||
  !object(geography.label))return false;
 const label=geography.label;
 return languages.every(language=>label[language]===page.label[language]);
}

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
 try{const url=new URL(input);return url.protocol==='https:'&&(origins.has(url.origin)||reviewedKnowledgePages.some(page=>page.url===input))&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&url.pathname.length>1&&url.href===input;}catch{return false;}
}
export function validKnowledgeCard(value:unknown):value is KnowledgeCard {
 if(!object(value)||value.kind!=='knowledge'||typeof value.id!=='string'||!/^[a-z][a-z0-9-]{2,79}$/u.test(value.id)||
  !Number.isSafeInteger(value.revision)||Number(value.revision)<1||!isNewsCategoryId(value.category)||
  !object(value.source)||!text(value.source.publisher,100)||!safeKnowledgeSource(value.source.url)||!matchesReviewedKnowledgeBinding(value,value.source)||
  value.geography!==undefined&&!validKnowledgeGeography(value.geography)||
  value.distribution!==undefined&&(!Object.hasOwn(value,'distribution')||value.distribution!=='cross-border'||!Object.hasOwn(value,'format')||value.format!=='elsewhere'||!Object.hasOwn(value,'geography')||value.geography===undefined)||
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
/** Attribution is derived from the exact reviewed binding, not visitor-supplied URLs. */
export function knowledgeRightsForCard(card:KnowledgeCard):KnowledgeSourceRights|null {
 const page=reviewedKnowledgeBinding(card.id,card.source.url);
 if(page===undefined)return null;
 if(!validKnowledgeCard(card))throw Error('KNOWLEDGE_RIGHTS_BINDING_INVALID');
 return page.rights;
}
/** Canonical visible editorial payload. Explicit fields avoid property-order
 * changes or unrelated metadata changing the identity of a reviewed edition.
 */
export function knowledgeEditorialPayload(card:KnowledgeCard):string {
 if(!validKnowledgeCard(card))throw Error('KNOWLEDGE_EDITORIAL_PAYLOAD_INVALID');
 const rights=knowledgeRightsForCard(card),geography=card.geography;
 return JSON.stringify(['dlkt-knowledge-editorial-v1',card.kind,card.id,card.revision,card.category,
  card.format??null,card.calendarDay??null,card.distribution??null,
  [card.source.publisher,card.source.url],
  geography===undefined?null:[geography.countryCode,[...geography.cityIds],languages.map(language=>geography.label[language])],
  languages.map(language=>[language,card.topic[language],card.copy[language].title,card.copy[language].explanation,card.copy[language].connection]),
  card.reviewedAt,card.publishAt??null,card.reviewBy,
  rights===null?null:[rights.credit,rights.licenseUrl,rights.policyUrl]]);
}
export interface KnowledgeEditorialApproval {
 readonly id:string;readonly revision:number;readonly payload:string;readonly digest:string;
}
// Intentionally empty: source terms and deterministic test fixtures are not an
// actual editorial approval. A decision must be committed after item-level review.
// CI verifies SHA-256(payload) for every decision. The synchronous browser gate
// compares the full canonical payload byte-for-byte (no custom crypto in client).
export const KNOWLEDGE_EDITORIAL_APPROVALS:readonly KnowledgeEditorialApproval[]=Object.freeze([]);
export function matchesKnowledgeEditorialApproval(card:KnowledgeCard,approval:KnowledgeEditorialApproval):boolean {
 return validKnowledgeCard(card)&&approval.id===card.id&&approval.revision===card.revision&&
  /^[a-f0-9]{64}$/u.test(approval.digest)&&approval.payload===knowledgeEditorialPayload(card);
}
function hasRequiredKnowledgeEditorialApproval(card:KnowledgeCard):boolean {
 // Preserve legacy cards; the new reviewed-page source bindings require
 // explicit exact editorial admission independently of source attribution.
 if(reviewedKnowledgeBinding(card.id,card.source.url)===undefined)return true;
 const decisions=KNOWLEDGE_EDITORIAL_APPROVALS.filter(approval=>approval.id===card.id);
 return decisions.length===1&&matchesKnowledgeEditorialApproval(card,decisions[0]!);
}
export function validateKnowledgeCatalog(input:unknown):readonly KnowledgeCard[]{
 if(!Array.isArray(input)||input.length>5000)throw Error('KNOWLEDGE_CATALOG_INVALID');
 const ids=new Set<string>(),cards:KnowledgeCard[]=[];
 for(const value of input){
  if(!validKnowledgeCard(value)||ids.has(value.id))throw Error('KNOWLEDGE_CARD_INVALID');
  if(!hasRequiredKnowledgeEditorialApproval(value))throw Error('KNOWLEDGE_EDITORIAL_APPROVAL_REQUIRED');
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
