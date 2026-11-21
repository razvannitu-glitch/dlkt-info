import type {EvidenceCard,Topic} from './contracts.js';
import {contextForCard} from './context.js';
import {PUBLIC_TOPICS,TOPIC_LABELS} from './topics.js';

export interface ConfirmedEditorialCity {
  readonly id:string;
  readonly name:string;
  readonly countryCode:string;
  readonly confirmed:true;
}
export interface EditorialReaderContext {
  readonly countryCode:string|null;
  readonly preferredTopics:readonly Topic[];
  readonly city?:ConfirmedEditorialCity;
}
export interface EditorialRelevance {
  readonly country:'publisher-category'|'headline-mention'|null;
  readonly cityMention:boolean;
  readonly explicitInterest:boolean;
  /** Ordering only; not measured impact, confidence or personal exposure. */
  readonly priority:number;
  readonly reasons:readonly string[];
}
const NEUTRAL:EditorialReaderContext=Object.freeze({countryCode:null,preferredTopics:Object.freeze([])});
export function validateEditorialContext(context:EditorialReaderContext):void {
  if(context.countryCode!==null&&!/^[A-Za-z]{2}$/u.test(context.countryCode)
    ||context.preferredTopics.length>PUBLIC_TOPICS.length||new Set(context.preferredTopics).size!==context.preferredTopics.length
    ||context.preferredTopics.some(topic=>!PUBLIC_TOPICS.includes(topic)))throw Error('DAILY_EDITION_CONTEXT_INVALID');
  const city=context.city;
  if(city!==undefined&&(city===null||typeof city!=='object'||city.confirmed!==true||typeof city.id!=='string'||!/^\d{1,12}$/u.test(city.id)||typeof city.countryCode!=='string'||!/^[A-Za-z]{2}$/u.test(city.countryCode)
    ||typeof city.name!=='string'||city.name.length<2||city.name.length>120||city.name.trim()!==city.name
    ||/[\u0000-\u001f\u007f<>\p{Surrogate}]/u.test(city.name)))throw Error('DAILY_EDITION_CONTEXT_INVALID');
}
function normalized(value:string):string{return value.normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').trim();}
function phrase(value:string,term:string):boolean {
  if(!term)return false;
  let offset=0;
  while(offset<value.length){
    const position=value.indexOf(term,offset);if(position<0)return false;
    const before=position===0?'':value[position-1]??'',after=value[position+term.length]??'';
    if(!/[\p{L}\p{N}]/u.test(before)&&!/[\p{L}\p{N}]/u.test(after))return true;
    offset=position+term.length;
  }
  return false;
}
function cityWording(title:string,cityName:string):boolean {
  const casePreserved=(value:string):string=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').trim();
  if(!phrase(casePreserved(title),casePreserved(cityName)))return false;
  const value=normalized(title),city=normalized(cityName);
  // City + country is still insufficient for "Reading books in UK schools".
  // Require a location phrase or an explicit civic subject around the name.
  const escaped=city.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:in|near|across|around|at|from|to|outside) ${escaped}(?=$|[^\\p{L}\\p{N}])`,'u').test(value)
    ||new RegExp(`(?:^|[^\\p{L}\\p{N}])${escaped} (?:city|council|mayor|residents|airport|metro|rail|transport|schools|hospital|housing|streets|district|police)(?=$|[^\\p{L}\\p{N}])`,'u').test(value);
}
const countryLabels=new Map<string,string|null>();
function countryLabel(code:string):string|null {
  if(countryLabels.has(code))return countryLabels.get(code)??null;
  let label:string|null=null;
  try{const name=new Intl.DisplayNames(['en'],{type:'region',fallback:'none'}).of(code);label=name&&name!==code?name:null;}catch{/* Unsupported region stays unknown. */}
  countryLabels.set(code,label);return label;
}
/** Ambiguous country/person/US-state names require actual publisher country categories. */
const AMBIGUOUS_COUNTRIES=new Set(['GE','JO','TD','CG','CD']);
function countryMention(title:string,code:string,label:string|null):boolean {
  if(label===null||AMBIGUOUS_COUNTRIES.has(code))return false;
  const normalizedTitle=normalized(title),names=[label];
  if(code==='US')names.push('United States of America');
  if(code==='GB')names.push('United Kingdom');
  if(names.some(name=>phrase(normalizedTitle,normalized(name))))return true;
  // Never match the English pronoun "us" or a country code within a name.
  return code==='US'?/(?:^|[^\p{L}\p{N}])(?:USA|U\.S\.)(?=$|[^\p{L}\p{N}])/u.test(title)
    :code==='GB'?/(?:^|[^\p{L}\p{N}])(?:UK|U\.K\.)(?=$|[^\p{L}\p{N}])/u.test(title):false;
}

/** Country/city signals describe headline mentions or publisher categories, never an established event location. */
export function editorialRelevance(card:EvidenceCard,context:EditorialReaderContext=NEUTRAL):EditorialRelevance {
  const code=(context.city?.countryCode??context.countryCode)?.toUpperCase()??null;
  const label=code===null?null:countryLabel(code),geography=contextForCard(card);
  const categoryMatch=code!==null&&geography.basis==='publisher-category'&&geography.countries.some(country=>country.code===code);
  const mention=code!==null&&!categoryMatch&&countryMention(card.title,code,label);
  const country:EditorialRelevance['country']=categoryMatch?'publisher-category':mention?'headline-mention':null;
  // Require corroborating country context for every city name. A saved "Paris"
  // alone cannot distinguish France from Texas, and "Reading" may be a verb.
  const cityMention=context.city!==undefined&&country!==null&&cityWording(card.title,context.city.name);
  const explicitInterest=context.preferredTopics.includes(card.topic),reasons:string[]=[];
  if(cityMention)reasons.push(`Headline mentions your confirmed city, ${context.city?.name}, with matching country context; this is not verified event-location evidence.`);
  if(categoryMatch)reasons.push(`Publisher country category matches ${label??code}; publisher headquarters are not used as location evidence.`);
  else if(mention)reasons.push(`Headline mentions ${label??code}; this is a wording match, not proof of the event location or personal impact.`);
  if(explicitInterest)reasons.push(`From your explicitly selected ${TOPIC_LABELS[card.topic]} interest.`);
  return Object.freeze({country,cityMention,explicitInterest,priority:(cityMention?8:0)+(categoryMatch?4:mention?2:0)+(explicitInterest?1:0),reasons:Object.freeze(reasons)});
}
