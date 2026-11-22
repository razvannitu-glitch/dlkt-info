import {selectHomeLocal,selectHomeLanguage} from '../iceo/home-local.js';
import {sourceLanguage,newsLanguageMatches} from '../iceo/news-sources.js';
import type {EvidenceCard,Topic} from '../iceo/contracts.js';
import type {City,LocalCard,LocalSnapshot} from '../local/contracts.js';
import {eligiblePublication,type Currency,type FxReference} from './contracts.js';
export function localDay(now:number,timeZone:string):string{return new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);}
export function quoteCurrency(country:string|undefined):Currency {const map:Readonly<Record<string,Currency>>={RO:'RON',GB:'GBP',CH:'CHF',LI:'CHF',JP:'JPY',CA:'CAD',AU:'AUD',CZ:'CZK',PL:'PLN',HU:'HUF',SE:'SEK',NO:'NOK',DK:'DKK'};return map[country??'']??'USD';}
export function currentLocalCards(snapshot:LocalSnapshot|null,city:City|null,now:number):readonly LocalCard[]{return !snapshot||!city||snapshot.city.id!==city.id||Date.parse(snapshot.checkedAt)>now+5000?[]:snapshot.cards.filter(c=>Date.parse(c.checkedAt)<=now+5000&&Date.parse(c.validTo)>now&&Date.parse(c.checkedAt)>=now-(c.kind==='forecast'||c.kind==='transport'?18*3600000:300000));}
export function forecastRange(card:LocalCard):string|null {if(card.kind!=='forecast')return null;const match=/^Hourly forecast temperatures (-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?) °C\./u.exec(card.text);return match?`${match[1]}–${match[2]} °C`:null;}
/** Re-project at expiry without polling sources; the calendar also advances in an open tab. */
export function nextGlanceDelay(cards:readonly LocalCard[],publications:readonly EvidenceCard[],fx:FxReference|null,now:number):number {
 const boundaries=[...cards.map(c=>Date.parse(c.validTo)),...cards.flatMap(c=>c.context?.startsAt?[Date.parse(c.context.startsAt)]:[]),...publications.flatMap(c=>[Date.parse(c.date)+7*86400000,Date.parse(c.observedAt)+6*3600000]),...(fx?[Date.parse(fx.date)+7*86400000,Date.parse(fx.checkedAt)+6*3600000]:[])].filter(t=>t>now);
 return Math.min(30000,...boundaries.map(t=>Math.max(25,t-now+10)));
}
export interface KeyThing {readonly kind:'local-news'|'event'|'publication';readonly title:string;readonly reason:string;readonly publication?:EvidenceCard;readonly event?:LocalCard;readonly news?:LocalCard}
export function keyThing(publications:readonly EvidenceCard[],local:LocalSnapshot|null,city:City|null,topics:readonly Topic[],now:number,timeZone:string,language?:string):KeyThing|null {
 const localSelection=language===undefined?selectHomeLocal(local,city,now):selectHomeLanguage(local,city,now,language);
 const news=localSelection.cards.find(card=>card.kind==='local-news');
 if(news)return{kind:'local-news',title:news.title,reason:'A recent report selected from the connected city publishers.',news};
 const event=currentLocalCards(local,city,now).filter(c=>c.kind==='event'&&c.context?.startsAt&&Date.parse(c.context.startsAt)>now&&localDay(Date.parse(c.context.startsAt),timeZone)===localDay(now,timeZone)).sort((a,b)=>Date.parse(a.context?.startsAt??'')-Date.parse(b.context?.startsAt??''))[0];
 if(event)return{kind:'event',title:event.title,reason:'Upcoming today in your selected city, from the connected municipal listings.',event};
 if(city&&!topics.length)return null;
 // The optional reader projection requires reviewed language provenance; unknown never means English.
 const candidates=publications.filter(c=>eligiblePublication(c,now)&&(language===undefined||newsLanguageMatches(sourceLanguage(c),language))&&(!city||topics.includes(c.topic))&&(c.topic!=='health'||city?.countryCode==='US'||topics.includes('health'))&&(c.topic!=='public-affairs'||city?.countryCode==='GB'||topics.includes('public-affairs'))).sort((a,b)=>Number(topics.includes(b.topic))-Number(topics.includes(a.topic))||Date.parse(b.date)-Date.parse(a.date)||a.id.localeCompare(b.id));
 const p=candidates[0];return p?{kind:'publication',title:p.title,reason:topics.includes(p.topic)?'A recent publication from one of your selected topics.':p.topic==='health'?'A recent US FDA announcement, relevant to the selected country.':p.topic==='public-affairs'?'A recent UK government announcement, relevant to the selected country.':`A recent ${p.topic==='environment'?'Earth science':'science'} publication from the connected publishers.`,publication:p}:null;
}
