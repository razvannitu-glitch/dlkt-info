import {localeFromCountry,localeFromPreference,resolveLocale,type Locale} from '../i18n/locale.js';
import {NEWS_DISCOVERY_INDEXES,NEWS_PUBLICATION_SCOPES,NEWS_PUBLISHERS,REVIEWED_FEED_PUBLICATION_SCOPES,newsLanguageMatches,sourceLanguage,sourcePublicationContext,type NewsSourceLanguage} from './news-sources.js';

/** Country identities come from the existing validated City or /api/places?countries=1.
 * GeoNames reference: https://www.geonames.org/countries/
 * Locale defaults are CLDR likely-subtag heuristics, not official or exclusive languages:
 * https://www.unicode.org/reports/tr35/#Likely_Subtags
 * No country list, publisher connection, translation or location is inferred here.
 */
export interface CountryEditionCountry {readonly code:string;readonly name:string}
export interface CountryEditionCoverage {readonly national:number;readonly local:number;readonly international:number}
export type CountryEditionState='available'|'currentNoArticles'|'unconnected'|'unknown';
export interface CountryEditionProfile {
 readonly countryCode:string;readonly countryName:string;readonly language:Locale;
 readonly defaultLanguage:Locale;readonly likelyLanguage:string|null;
 /** Whether the likely CLDR language is shipped in the UI; English fallback is not a native-language claim. */
 readonly defaultLanguageSupported:boolean;
 readonly englishReadingOption:true;
 /** Reviewed publishers with an edition matching the selected reading language, not live source health. */
 readonly configuredPublisherIds:readonly string[];
 /** Only indexes with reviewed matching language evidence; missing language is never assumed English. */
 readonly configuredIndexIds:readonly string[];
 /** Reviewed publisher-edition languages for this country, not the country's official languages. */
 readonly countryEditionLanguages:readonly NewsSourceLanguage[];
 /** National/local availability only. International counts remain separate. */
 readonly state:CountryEditionState;
 readonly coverage:CountryEditionCoverage|null;
 readonly englishRecommended:boolean;
}
interface ConfiguredEdition {readonly publisherId:string;readonly countryCode:string;readonly languages:readonly NewsSourceLanguage[]}
const uniqueSorted=<T extends string>(values:readonly T[]):readonly T[]=>Object.freeze([...new Set(values)].sort());
const configured:readonly ConfiguredEdition[]=Object.freeze([
 ...NEWS_PUBLICATION_SCOPES.map(scope=>{
  const languages:NewsSourceLanguage[]=scope.editions.map(edition=>edition.language);
  // The existing NYT rule declares a dated English path instead of a broad '/' edition.
  // This is a resolver probe, not an article, network request or new publisher rule.
  if(languages.length===0){
   const origin=NEWS_PUBLISHERS.find(publisher=>publisher.id===scope.publisherId)?.origins[0];
   const context=origin?sourcePublicationContext(origin+'/2000/'):null;
   if(context?.publisherCountryCode===scope.countryCode&&context.language)languages.push(context.language);
  }
  return Object.freeze({publisherId:scope.publisherId,countryCode:scope.countryCode,languages:uniqueSorted(languages)});
 }),
 ...REVIEWED_FEED_PUBLICATION_SCOPES.map(scope=>Object.freeze({
   publisherId:scope.sourceId,countryCode:scope.countryCode,languages:Object.freeze([scope.language]),
  })),
]);
function validCountry(value:unknown):value is CountryEditionCountry {
 if(typeof value!=='object'||value===null||Array.isArray(value))return false;
 const country=value as Record<string,unknown>;
 return Object.keys(country).sort().join(',')==='code,name'&&typeof country.code==='string'
  &&/^[A-Z]{2}$/u.test(country.code)&&country.code!=='ZZ'&&typeof country.name==='string'
  &&country.name.trim().length>0&&country.name.length<=120
  &&!/[\u0000-\u001f\u007f<>\u202a-\u202e\u2066-\u2069]/u.test(country.name);
}
function validCoverage(value:unknown):value is CountryEditionCoverage {
 if(typeof value!=='object'||value===null||Array.isArray(value))return false;
 const coverage=value as Record<string,unknown>;
 if(Object.keys(coverage).sort().join(',')!=='international,local,national')return false;
 const values=[coverage.national,coverage.local,coverage.international];
 return values.every(value=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=5000)
  &&values.reduce<number>((sum,value)=>sum+Number(value),0)<=5000;
}
function validBrowserLanguages(value:unknown):value is readonly string[]{
 return Array.isArray(value)&&value.length<=32&&value.every(item=>typeof item==='string'&&item.length<=80);
}
function likelyCountryLanguage(code:string):string|null {
 try{
  const locale=new Intl.Locale('und-'+code).maximize();
  if(locale.language==='und')return null;
  return locale.language==='zh'?'zh-'+(locale.script??'Hans'):locale.language;
 }catch{return null;}
}
const scopedPublishers=new Set(NEWS_PUBLICATION_SCOPES.filter(scope=>scope.origins!==undefined).map(scope=>scope.publisherId));
function indexLanguage(index:typeof NEWS_DISCOVERY_INDEXES[number]):NewsSourceLanguage|null {
 if(index.language)return index.language;
 const explicit=sourceLanguage(index.url);if(explicit)return explicit;
 const edition=configured.find(value=>value.publisherId===index.publisherId);
 return edition?.languages.length===1?edition.languages[0]??null:null;
}
/** Pure presentation of a validated country and the current, matching page's aggregate counts.
 * Trim reference-label whitespace (present in GeoNames BQ); preserve the catalog and every country option.
 * Unknown counts never become zero. This helper does not change the selected language or news order.
 */
export function countryEditionProfile(country:CountryEditionCountry,language:Locale,coverage?:CountryEditionCoverage,navigatorLanguages:readonly string[]=[]):CountryEditionProfile {
 if(!validCountry(country)||typeof language!=='string'||localeFromPreference(language)!==language||!validBrowserLanguages(navigatorLanguages))throw Error('COUNTRY_EDITION_CONTEXT_INVALID');
 if(coverage!==undefined&&!validCoverage(coverage))throw Error('COUNTRY_EDITION_COVERAGE_INVALID');
 const defaultLanguage=localeFromCountry(country.code,navigatorLanguages)??'en',likelyLanguage=likelyCountryLanguage(country.code);
 const defaultLanguageSupported=likelyLanguage!==null&&newsLanguageMatches(likelyLanguage,resolveLocale(likelyLanguage));
 const countryEditions=configured.filter(edition=>edition.countryCode===country.code);
 const configuredPublisherIds=uniqueSorted(countryEditions.filter(edition=>edition.languages.some(value=>newsLanguageMatches(value,language))).map(edition=>edition.publisherId));
 const configuredIndexIds=uniqueSorted(NEWS_DISCOVERY_INDEXES.filter(index=>{
  if(!configuredPublisherIds.includes(index.publisherId))return false;
  // A shared sitemap is not proof of an edition-specific index.
  if(scopedPublishers.has(index.publisherId)){
   const context=sourcePublicationContext(index.url);
   return context!==null&&context.publisherCountryCode===country.code&&newsLanguageMatches(context.language,language);
  }
  return newsLanguageMatches(indexLanguage(index),language);
 }).map(index=>index.id));
 const counts=coverage===undefined?null:Object.freeze({...coverage});
 const state:CountryEditionState=counts&&counts.national+counts.local>0?'available'
  :configuredPublisherIds.length===0?'unconnected':counts?'currentNoArticles':'unknown';
 return Object.freeze({
  countryCode:country.code,countryName:country.name.trim(),language,defaultLanguage,likelyLanguage,defaultLanguageSupported,
  englishReadingOption:true,configuredPublisherIds,configuredIndexIds,
  countryEditionLanguages:uniqueSorted(countryEditions.flatMap(edition=>edition.languages)),
  state,coverage:counts,
  englishRecommended:language!=='en'&&counts!==null&&counts.national+counts.local+counts.international===0,
 });
}
/** One profile for every existing country option; never filter the list down to configured publishers. */
export function countryEditionProfiles(countries:readonly CountryEditionCountry[],language?:Locale,navigatorLanguages:readonly string[]=[]):readonly CountryEditionProfile[] {
 if(!Array.isArray(countries)||countries.length>300||countries.some(country=>!validCountry(country))
  ||new Set(countries.map(country=>country.code)).size!==countries.length)throw Error('COUNTRY_EDITION_COUNTRIES_INVALID');
 if((language!==undefined&&(typeof language!=='string'||localeFromPreference(language)!==language))||!validBrowserLanguages(navigatorLanguages))throw Error('COUNTRY_EDITION_CONTEXT_INVALID');
 return Object.freeze(countries.map(country=>countryEditionProfile(country,language??localeFromCountry(country.code,navigatorLanguages)??'en',undefined,navigatorLanguages)));
}
