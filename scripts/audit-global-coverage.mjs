/**
 * Operator-only, read-only coverage audit of the existing ICEO collector.
 * UN-state denominator is independent of the place picker. No new acquisition,
 * rights decisions, ranking, telemetry, runtime API, cron or production writes.
 */
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assessLiveIceo,collectLiveIceo} from './verify-iceo-live.mjs';

// 193 United Nations member states + Holy See (VA) + State of Palestine (PS).
// ISO alpha-2 identities, not the broader UN M49 country-or-area list.
// Product coverage convention only; preserves every selectable place and
// original publisher territory without making a sovereignty determination.
export const WORLD_STATE_CODES=Object.freeze(('AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW').split(' '));
const states=new Set(WORLD_STATE_CODES);
if(states.size!==195||WORLD_STATE_CODES.length!==195)throw Error('GLOBAL_STATE_REFERENCE_INVALID');
const code=value=>typeof value==='string'&&/^[A-Z]{2}$/u.test(value)&&value!=='ZZ';
const sorted=values=>[...new Set(values)].sort();
const boundedArray=value=>Array.isArray(value)&&value.length<=5000;

// The owner approved the exact 244 location codes already represented in
// the canonical place picker. The 49 additional entries have different
// legal statuses; this operational inventory is not a sovereignty claim.
export const WORLD_OPERATIONAL_CODES=Object.freeze(sorted([...WORLD_STATE_CODES,...'AI AS AW AX BL BM BQ CC CK CW CX EH FK FO GF GG GI GL GP GS GU HK IM JE KY MF MO MP MQ MS NC NF NU PF PM PN PR RE SH SJ SX TC TF TW VG VI WF XK YT'.split(' ')]));
const operationalCodes=new Set(WORLD_OPERATIONAL_CODES);
if(operationalCodes.size!==244||WORLD_OPERATIONAL_CODES.length!==244)throw Error('GLOBAL_OPERATIONAL_REFERENCE_INVALID');

/** A changed place catalogue requires an explicit reference review, not a
 * silently inflated or reduced worldwide denominator. */
export function assertOperationalCatalogue(placeCodes){
 if(!boundedArray(placeCodes)||placeCodes.some(x=>!code(x))||placeCodes.length!==WORLD_OPERATIONAL_CODES.length||
  new Set(placeCodes).size!==placeCodes.length||placeCodes.some(x=>!operationalCodes.has(x)))throw Error('GLOBAL_OPERATIONAL_CATALOGUE_DRIFT');
}

/** Independent measures: an entity with a direct registration need not have
 * a current publication; an observed publisher may arrive through discovery.
 * Neither fact establishes event geography or coverage of every category. */
export function operationalGapPlan(configuredCodes,publisherCountryCounts){
 if(!boundedArray(configuredCodes)||configuredCodes.some(x=>!code(x))||publisherCountryCounts===null||
  typeof publisherCountryCounts!=='object'||Array.isArray(publisherCountryCounts)||
  Object.entries(publisherCountryCounts).some(([k,v])=>!code(k)||!Number.isSafeInteger(v)||v<1||v>5000))
  throw Error('GLOBAL_OPERATIONAL_GAP_INPUT_INVALID');
 const configured=new Set(configuredCodes),observed=new Set(Object.keys(publisherCountryCounts));
 const buckets={configuredAndObserved:[],observedWithoutDirect:[],directWithoutObserved:[],neitherInThisAudit:[]};
 for(const entity of WORLD_OPERATIONAL_CODES){
  const hasDirect=configured.has(entity),hasObserved=observed.has(entity);
  buckets[hasDirect?(hasObserved?'configuredAndObserved':'directWithoutObserved'):(hasObserved?'observedWithoutDirect':'neitherInThisAudit')].push(entity);
 }
 return {denominator:WORLD_OPERATIONAL_CODES.length,
  configuredCount:WORLD_OPERATIONAL_CODES.filter(x=>configured.has(x)).length,
  observedCount:WORLD_OPERATIONAL_CODES.filter(x=>observed.has(x)).length,
  buckets,unexpectedConfiguredCodes:sorted(configuredCodes.filter(x=>!operationalCodes.has(x))),
  unexpectedObservedCodes:sorted([...observed].filter(x=>!operationalCodes.has(x)))};
}

function groupUnknownProvenance(card,model,groups){
 const publisher=model.publisherForNewsUrl(card.sourceUrl),context=model.sourcePublicationContext(card);
 const exactSource=card.sourceIds?.length===1?model.nonIndexSourceIds.has(card.sourceIds[0])?card.sourceIds[0]:null:null;
 const target=publisher?'publisher:'+publisher.id:exactSource?'source:'+exactSource:'unresolved';
 // Do not infer language/country from host, headline, TLD or headquarters.
 const reason=context===null?'reviewed-edition-context-missing':context.language===null?'reviewed-edition-language-missing':'canonical-provenance-unresolved';
 const key=target+'|'+reason;
 const previous=groups.get(key);
 if(previous)previous.count++;else groups.set(key,{target,reason,count:1});
}

export function stateCoverage(codes,placeCodes){
 if(!boundedArray(codes)||!boundedArray(placeCodes)||codes.some(x=>x!==null&&!code(x))||placeCodes.some(x=>!code(x)))throw Error('GLOBAL_COVERAGE_INPUT_INVALID');
 const places=new Set(placeCodes);
 const stateCodes=sorted(codes.filter(x=>states.has(x)));
 const otherCodes=sorted(codes.filter(x=>x!==null&&!states.has(x)&&places.has(x)));
 const unrecognizedCodes=sorted(codes.filter(x=>x!==null&&!states.has(x)&&!places.has(x)));
 return {stateCount:stateCodes.length,denominator:WORLD_STATE_CODES.length,stateCodes,
  missingStateCodes:WORLD_STATE_CODES.filter(x=>!stateCodes.includes(x)),otherPlaceCodes:otherCodes,unrecognizedCodes,
  unknownRecordCount:codes.filter(x=>x===null).length};
}

/** Direct index registrations and reviewed-feed registrations with explicit
 * publisher country provenance. Not proof of a functioning source, a native
 * language, the event location, or complete national coverage. */
export function configuredCountryCodes({indexes,publicationScopes,reviewedScopes,sources,resolvePublicationContext}){
 if(![indexes,publicationScopes,reviewedScopes,sources].every(boundedArray))throw Error('GLOBAL_COVERAGE_REGISTRY_INVALID');
 const byPublisher=new Map();
 for(const scope of publicationScopes){
  const scopes=byPublisher.get(scope.publisherId)??[];
  scopes.push(scope);byPublisher.set(scope.publisherId,scopes);
 }
 const configured=[];
 for(const index of indexes){
  const scopes=byPublisher.get(index.publisherId)??[];
  if(scopes.length===1&&scopes[0].origins===undefined){
   configured.push(scopes[0].countryCode);continue;
  }
  // Scoped and multi-edition publishers require the existing canonical
  // resolver to bind the actual index URL to a single reviewed edition.
  // Never multiply a shared sitemap across the publisher's editions.
  if(scopes.length===0||typeof resolvePublicationContext!=='function'||typeof index.url!=='string')continue;
  const context=resolvePublicationContext(index.url);
  if(!context||context.basis!=='reviewed-publisher'||!code(context.publisherCountryCode)||typeof context.language!=='string'||!context.language)continue;
  let origin;try{origin=new URL(index.url).origin;}catch{continue;}
  const matches=scopes.filter(scope=>Array.isArray(scope.origins)&&scope.origins.includes(origin)&&
   scope.countryCode===context.publisherCountryCode&&Array.isArray(scope.editions)&&scope.editions.some(edition=>edition.language===context.language));
  if(matches.length===1)configured.push(matches[0].countryCode);
 }
 const feeds=new Set(sources.filter(x=>x.adapter==='reviewed-feed').map(x=>x.id));
 return sorted([...configured,...reviewedScopes.filter(x=>feeds.has(x.sourceId)).map(x=>x.countryCode)]);
}

export function auditSnapshot(sample,now,model){
 const health=assessLiveIceo(sample,now);
 if(health.failures.length)return {status:'GLOBAL_COVERAGE_HELD',health,observed:null};
 const snapshot=JSON.parse(sample.body);
 const unique=new Map();
 for(const card of snapshot.cards){
  if(!model.validNewsGlobalCard(card,now))continue;
  const previous=unique.get(card.identity);
  if(previous&&previous.contentHash!==card.contentHash)throw Error('GLOBAL_COVERAGE_CONFLICTING_IDENTITY');
  if(!previous)unique.set(card.identity,card);
 }
 const publications=[...unique.values()];
 const byCountry={},byTaxonomy=Object.fromEntries(model.taxonomy.map(x=>[x.id,0])),byEditorial=Object.fromEntries(model.editorialCategories.map(x=>[x,0]));
 const unknownProvenance=new Map();
 let uncategorizedTaxonomy=0,uncategorizedEditorial=0;
 const countries=publications.map(card=>{
  const country=model.sourceEditionCountryCode(card);
  if(country!==null){if(!code(country))throw Error('GLOBAL_COVERAGE_COUNTRY_INVALID');byCountry[country]=(byCountry[country]??0)+1;}
  else groupUnknownProvenance(card,model,unknownProvenance);
  const taxonomy=model.classifyEvidenceCard(card)?.category??null;
  const editorial=model.editorialCategory(card);
  if(taxonomy!==null&&Object.hasOwn(byTaxonomy,taxonomy))byTaxonomy[taxonomy]++;else uncategorizedTaxonomy++;
  if(editorial!==null&&Object.hasOwn(byEditorial,editorial))byEditorial[editorial]++;else uncategorizedEditorial++;
  return country;
 });
 const sourcesByState={verified:0,partial:0,stale:0,unavailable:0};
 for(const source of snapshot.sources){if(!Object.hasOwn(sourcesByState,source.state))throw Error('GLOBAL_COVERAGE_SOURCE_STATE_INVALID');sourcesByState[source.state]++;}
 return {status:'GLOBAL_COVERAGE_OBSERVED',health,scope:'public ICEO snapshot only, not the full paginated corpus, event geography or audience',
  sourceStates:sourcesByState,eligiblePublicationCount:publications.length,
  publisherCountryCoverage:stateCoverage(countries,model.placeCodes),publisherCountryCounts:byCountry,
  unresolvedPublisherProvenance:[...unknownProvenance.values()].sort((a,b)=>b.count-a.count||a.target.localeCompare(b.target)||a.reason.localeCompare(b.reason)),
  languageCoverage:model.newsLanguageCoverage(publications),
  taxonomyCounts:byTaxonomy,uncategorizedTaxonomy,editorialCounts:byEditorial,uncategorizedEditorial};
}

async function main(){
 // The existing source modules remain authoritative. Import only after the
 // canonical TypeScript build; packaging fixture tests need no generated JS.
 const [places,cityData,i18n,news,registry,local,taxonomy,editorial,contracts,atlas]=await Promise.all([
  import('../source/.build/src/local/cities.js'),import('../source/.build/src/local/city-data.js'),
  import('../source/.build/src/i18n/catalog.js'),import('../source/.build/src/iceo/news-sources.js'),
  import('../source/.build/src/iceo/registry.js'),import('../source/.build/src/local/news-policy.js'),
  import('../source/.build/src/iceo/news-taxonomy.js'),import('../source/.build/src/iceo/editorial-categories.js'),
  import('../source/.build/src/iceo/news-page-contracts.js'),import('../source/.build/src/iceo/world-source-atlas.js'),
 ]);
 const placeCodes=places.listCountries().map(x=>x.code);
 assertOperationalCatalogue(placeCodes);
 const configuredCodes=configuredCountryCodes({indexes:news.NEWS_DISCOVERY_INDEXES,
  publicationScopes:news.NEWS_PUBLICATION_SCOPES,reviewedScopes:news.REVIEWED_FEED_PUBLICATION_SCOPES,
  sources:registry.ICEO_SOURCES,resolvePublicationContext:news.sourcePublicationContext});
 const configured=stateCoverage(configuredCodes,placeCodes);
 const directory=atlas.worldSourceAtlas();
 const baseline={stateReference:WORLD_STATE_CODES.length,operationalEntityReference:WORLD_OPERATIONAL_CODES.length,placeOptions:placeCodes.length,
  cityOptions:JSON.parse(cityData.cityJson).rows.length,interfaceLocales:i18n.LOCALES.length,
  editorialCategories:editorial.PUBLIC_EDITORIAL_CATEGORIES.length,taxonomyCategories:taxonomy.NEWS_CATEGORIES.length,
  configuredDefinitions:registry.ICEO_SOURCES.length,allowlistedPublishers:news.NEWS_PUBLISHERS.length,
  directDiscoveryIndexes:news.NEWS_DISCOVERY_INDEXES.length,
  directIndexPublishers:new Set(news.NEWS_DISCOVERY_INDEXES.map(x=>x.publisherId)).size,
  discoveryOnlyEntries:directory.filter(x=>x.status==='candidate').length,
  stateCodesMissingFromPlacePicker:WORLD_STATE_CODES.filter(x=>!placeCodes.includes(x)),
  configuredDirectPublisherCountryCoverage:configured,
  dedicatedCityNewsFeedCount:local.CITY_NEWS_FEEDS.length,
  dedicatedCityNewsCityIds:sorted(local.CITY_NEWS_FEEDS.map(x=>x.cityId))};
 // Keep local fixture/testing possible without touching any live API.
 const sample=await collectLiveIceo();
 const observed=auditSnapshot(sample,Date.now(),{placeCodes,taxonomy:taxonomy.NEWS_CATEGORIES,
  editorialCategories:editorial.PUBLIC_EDITORIAL_CATEGORIES,validNewsGlobalCard:contracts.validNewsGlobalCard,
  sourceEditionCountryCode:news.sourceEditionCountryCode,newsLanguageCoverage:news.newsLanguageCoverage,
  classifyEvidenceCard:taxonomy.classifyEvidenceCard,editorialCategory:editorial.editorialCategory,
  publisherForNewsUrl:news.publisherForNewsUrl,sourcePublicationContext:news.sourcePublicationContext,
  nonIndexSourceIds:new Set(registry.ICEO_SOURCES.filter(x=>x.adapter!=='news-index').map(x=>x.id))});
 const operational=observed.status==='GLOBAL_COVERAGE_OBSERVED'?operationalGapPlan(configuredCodes,observed.publisherCountryCounts):null;
 console.log('DLKT_GLOBAL_COVERAGE '+JSON.stringify({baseline,observed,operational}));
 if(observed.status!=='GLOBAL_COVERAGE_OBSERVED')process.exitCode=1;
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked)try{await main();}catch(error){
 console.error('DLKT_GLOBAL_COVERAGE_HELD '+(error instanceof Error&&/^GLOBAL_COVERAGE_[A-Z_]+$/u.test(error.message)?error.message:'AUDIT_UNAVAILABLE'));
 process.exitCode=1;
}
