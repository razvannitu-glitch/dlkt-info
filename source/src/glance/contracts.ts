import {validCard} from '../iceo/card-validation.js';
import type {EvidenceCard} from '../iceo/contracts.js';

export const GLANCE_VERSION='dlkt-glance-1' as const;
export const CURRENCIES=['USD','RON','GBP','CHF','JPY','CAD','AUD','CZK','PLN','HUF','SEK','NOK','DKK'] as const;
export type Currency=typeof CURRENCIES[number];
export interface GlancePreferences {readonly version:typeof GLANCE_VERSION;readonly weather:boolean;readonly forex:boolean;readonly keyThing:boolean;readonly currency:Currency|'auto'}
export const DEFAULT_PREFERENCES:GlancePreferences=Object.freeze({version:GLANCE_VERSION,weather:true,forex:true,keyThing:true,currency:'auto'});
export const FX_SOURCE='https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml';
export const FX_HOME='https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html';
export const FX_MAX_AGE=7*86400000;
export interface FxReference {readonly checkedAt:string;readonly date:string;readonly previousDate:string|null;readonly rates:Readonly<Partial<Record<Currency,number>>>;readonly previousRates:Readonly<Partial<Record<Currency,number>>>}
export interface GlanceSnapshot {readonly version:typeof GLANCE_VERSION;readonly generatedAt:string;readonly forex:FxReference|null;readonly publications:readonly EvidenceCard[]}
export function object(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
export function currency(v:unknown):v is Currency{return CURRENCIES.includes(v as Currency);}
export function isoDay(v:unknown):v is string {return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;}
export function stamp(v:unknown):v is string{return typeof v==='string'&&v.length<40&&Number.isFinite(Date.parse(v));}
export function validPreferences(v:unknown):v is GlancePreferences{return object(v)&&Object.keys(v).length===5&&v.version===GLANCE_VERSION&&typeof v.weather==='boolean'&&typeof v.forex==='boolean'&&typeof v.keyThing==='boolean'&&(v.currency==='auto'||currency(v.currency));}
function rateSet(v:unknown,allowEmpty:boolean):v is FxReference['rates'] {return object(v)&&(allowEmpty||Object.keys(v).length>0)&&Object.entries(v).every(([k,n])=>currency(k)&&typeof n==='number'&&Number.isFinite(n)&&n>0&&n<1e7);}
export function validFx(v:unknown,now:number):v is FxReference {
 return object(v)&&stamp(v.checkedAt)&&Date.parse(v.checkedAt)<=now+5000&&Date.parse(v.checkedAt)>=now-6*3600000&&isoDay(v.date)&&Date.parse(v.date)<=now&&Date.parse(v.date)>=now-FX_MAX_AGE&&rateSet(v.rates,false)&&rateSet(v.previousRates,true)&&(v.previousDate===null?Object.keys(v.previousRates).length===0:isoDay(v.previousDate)&&v.previousDate<v.date);
}
export function eligiblePublication(v:unknown,now:number):v is EvidenceCard {
 if(!validCard(v)||v.kind!=='publication'||v.sourceState==='stale'||v.sourceIds.length!==1||Date.parse(v.date)>now+300000||Date.parse(v.date)<now-7*86400000||Date.parse(v.observedAt)>now+5000||Date.parse(v.observedAt)<now-6*3600000)return false;
 const expected:Readonly<Record<string,readonly[string,string]>>={'nasa-news':['NASA','science'],'usgs-news':['U.S. Geological Survey','environment'],'fda-news':['U.S. Food and Drug Administration','health'],'govuk-news':['UK Government','public-affairs']};
 const source=expected[v.sourceIds[0]??''];return !!source&&v.publisher===source[0]&&v.topic===source[1];
}
export function validGlance(v:unknown,now:number):v is GlanceSnapshot{return object(v)&&v.version===GLANCE_VERSION&&stamp(v.generatedAt)&&Date.parse(v.generatedAt)<=now+5000&&Date.parse(v.generatedAt)>=now-6*3600000&&(v.forex===null||validFx(v.forex,now))&&Array.isArray(v.publications)&&v.publications.length<=12&&v.publications.every(c=>eligiblePublication(c,now))&&new Set(v.publications.map(c=>c.id)).size===v.publications.length;}
