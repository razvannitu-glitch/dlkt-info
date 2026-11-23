import {ICEO_SOURCES} from './registry.js';
import {NEWS_PUBLISHERS} from './news-sources.js';

/**
 * Dynamic source inventory. "Configured" is not a claim that a feed returned
 * an eligible item; "origin-reviewed" is not a content-licensing permission.
 * Proposed and newly discovered entries are NEVER passed to outbound fetchers.
 */
export type AtlasStatus='configured'|'origin-reviewed'|'candidate';
export type AtlasScope='unknown'|'hyperlocal'|'city'|'region'|'country'|'international';
export type AtlasVertical='news'|'official'|'science'|'health'|'climate'|'environment'|'humanitarian'|'education'|'culture'|'economy'|'consumer'|'geography'|'technology'|'sport'|'civic'|'community';
export interface SourceAtlasEntry {
 readonly id:string;
 readonly name:string;
 readonly origin:string;
 readonly vertical:AtlasVertical;
 readonly scope:AtlasScope;
 readonly countryCode:string|null;
 readonly status:AtlasStatus;
 readonly acquisition:'configured'|'origin-index'|'discovery-only';
 readonly rights:'reviewed-until-expiry'|'source-specific-review-required';
}

type Candidate=Readonly<{
 id:string;name:string;origin:string;vertical:AtlasVertical;scope:AtlasScope;countryCode?:string;
}>;

/** A non-exhaustive initial set of primary discovery entrances, NOT live feeds. */
const SEED:readonly Candidate[]=[
 {id:'gdelt',name:'GDELT Project',origin:'https://gdeltproject.org',vertical:'news',scope:'international'},
 {id:'common-crawl',name:'Common Crawl',origin:'https://www.commoncrawl.org',vertical:'technology',scope:'international'},
 {id:'reliefweb',name:'ReliefWeb / OCHA',origin:'https://reliefweb.int',vertical:'humanitarian',scope:'international'},
 {id:'hdx',name:'Humanitarian Data Exchange',origin:'https://data.humdata.org',vertical:'humanitarian',scope:'international'},
 {id:'iati',name:'International Aid Transparency Initiative',origin:'https://iatistandard.org',vertical:'humanitarian',scope:'international'},
 {id:'globalgiving',name:'GlobalGiving',origin:'https://www.globalgiving.org',vertical:'humanitarian',scope:'international'},
 {id:'openalex',name:'OpenAlex',origin:'https://openalex.org',vertical:'science',scope:'international'},
 {id:'crossref',name:'Crossref',origin:'https://www.crossref.org',vertical:'science',scope:'international'},
 {id:'datacite',name:'DataCite',origin:'https://datacite.org',vertical:'science',scope:'international'},
 {id:'pubmed',name:'PubMed',origin:'https://pubmed.ncbi.nlm.nih.gov',vertical:'health',scope:'international'},
 {id:'who',name:'World Health Organization',origin:'https://www.who.int',vertical:'health',scope:'international'},
 {id:'iarc',name:'IARC / Global Cancer Observatory',origin:'https://gco.iarc.who.int',vertical:'health',scope:'international'},
 {id:'unicef',name:'UNICEF Data',origin:'https://data.unicef.org',vertical:'education',scope:'international'},
 {id:'unhcr',name:'UN Refugee Agency',origin:'https://www.unhcr.org',vertical:'humanitarian',scope:'international'},
 {id:'ifrc',name:'International Federation of Red Cross',origin:'https://www.ifrc.org',vertical:'humanitarian',scope:'international'},
 {id:'un-news',name:'United Nations News',origin:'https://news.un.org',vertical:'official',scope:'international'},
 {id:'undp',name:'United Nations Development Programme',origin:'https://www.undp.org',vertical:'official',scope:'international'},
 {id:'unwomen',name:'UN Women',origin:'https://www.unwomen.org',vertical:'community',scope:'international'},
 {id:'fao',name:'FAO',origin:'https://www.fao.org',vertical:'environment',scope:'international'},
 {id:'unesco',name:'UNESCO',origin:'https://www.unesco.org',vertical:'culture',scope:'international'},
 {id:'ilo',name:'International Labour Organization',origin:'https://www.ilo.org',vertical:'economy',scope:'international'},
 {id:'worldbank',name:'World Bank Open Data',origin:'https://data.worldbank.org',vertical:'economy',scope:'international'},
 {id:'imf',name:'IMF Data',origin:'https://www.imf.org',vertical:'economy',scope:'international'},
 {id:'oecd',name:'OECD Data',origin:'https://www.oecd.org',vertical:'economy',scope:'international'},
 {id:'wmo',name:'World Meteorological Organization',origin:'https://wmo.int',vertical:'climate',scope:'international'},
 {id:'noaa',name:'NOAA',origin:'https://www.noaa.gov',vertical:'climate',scope:'international'},
 {id:'usgs',name:'USGS Earthquakes',origin:'https://earthquake.usgs.gov',vertical:'environment',scope:'international'},
 {id:'nasa',name:'NASA',origin:'https://www.nasa.gov',vertical:'science',scope:'international'},
 {id:'esa',name:'European Space Agency',origin:'https://www.esa.int',vertical:'science',scope:'international'},
 {id:'wikidata',name:'Wikidata',origin:'https://www.wikidata.org',vertical:'culture',scope:'international'},
 {id:'openstreetmap',name:'OpenStreetMap',origin:'https://www.openstreetmap.org',vertical:'geography',scope:'international'},
 {id:'eurostat',name:'Eurostat',origin:'https://ec.europa.eu',vertical:'economy',scope:'region'},
 {id:'eu-open-data',name:'data.europa.eu',origin:'https://data.europa.eu',vertical:'official',scope:'region'},
 {id:'eu-health',name:'European Commission Public Health',origin:'https://health.ec.europa.eu',vertical:'health',scope:'region'},
 {id:'eu-cancer',name:'European Cancer Information System',origin:'https://ecis.jrc.ec.europa.eu',vertical:'health',scope:'region'},
 {id:'ecdc',name:'European Centre for Disease Prevention and Control',origin:'https://www.ecdc.europa.eu',vertical:'health',scope:'region'},
 {id:'ema',name:'European Medicines Agency',origin:'https://www.ema.europa.eu',vertical:'health',scope:'region'},
 {id:'copernicus',name:'Copernicus',origin:'https://www.copernicus.eu',vertical:'environment',scope:'region'},
 {id:'bnr',name:'Banca Nationala a Romaniei',origin:'https://www.bnr.ro',vertical:'economy',scope:'country',countryCode:'RO'},
 {id:'ins',name:'Institutul National de Statistica',origin:'https://www.insse.ro',vertical:'economy',scope:'country',countryCode:'RO'},
 {id:'data-gov-ro',name:'Portal date deschise Romania',origin:'https://data.gov.ro',vertical:'official',scope:'country',countryCode:'RO'},
 {id:'anpc',name:'Autoritatea Nationala pentru Protectia Consumatorilor',origin:'https://anpc.ro',vertical:'consumer',scope:'country',countryCode:'RO'},
 {id:'stb',name:'Societatea de Transport Bucuresti',origin:'https://www.stb.ro',vertical:'civic',scope:'city',countryCode:'RO'},
 {id:'fundatia-renasterea',name:'Fundatia Renasterea - Harta Preventiei',origin:'https://caravana-preventiei.fundatiarenasterea.ro',vertical:'health',scope:'country',countryCode:'RO'},
 {id:'hospice-ro',name:'HOSPICE Casa Sperantei',origin:'https://hospice.ro',vertical:'humanitarian',scope:'country',countryCode:'RO'},
 {id:'who-blood',name:'WHO World Blood Donor Day',origin:'https://www.who.int',vertical:'humanitarian',scope:'international'},
] as const;

/** Remove duplicate candidate homes; distinct configured feeds remain separate. */
export function worldSourceAtlas():readonly SourceAtlasEntry[]{
 const existing:SourceAtlasEntry[]=[];
 for(const source of ICEO_SOURCES)existing.push({
  id:'configured:'+source.id,name:source.publisher,origin:new URL(source.homepage).origin,
  vertical:'news',scope:'unknown',countryCode:null,status:'configured',
  acquisition:'configured',rights:'reviewed-until-expiry',
 });
 for(const publisher of NEWS_PUBLISHERS)existing.push({
  id:'publisher:'+publisher.id,name:publisher.label,origin:publisher.origins[0]??'',
  vertical:'news',scope:'unknown',countryCode:null,status:'origin-reviewed',
  acquisition:'origin-index',rights:'source-specific-review-required',
 });
 const seen=new Set<string>(),result:SourceAtlasEntry[]=[];
 for(const value of SEED){
  const origin=new URL(value.origin).origin;
  if(seen.has(origin))continue;
  seen.add(origin);
  existing.push({
   id:'candidate:'+value.id,name:value.name,origin,vertical:value.vertical,scope:value.scope,
   countryCode:value.countryCode??null,status:'candidate',acquisition:'discovery-only',
   rights:'source-specific-review-required',
  });
 }
 const ids=new Set<string>();
 for(const entry of existing){
  if(ids.has(entry.id)||entry.origin!==new URL(entry.origin).origin)throw Error('SOURCE_ATLAS_COLLISION');
  ids.add(entry.id);result.push(Object.freeze(entry));
 }
 return Object.freeze(result);
}

const unsafeHost=/(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$|\.onion$)/u;
/** Non-fetching candidate discovery. Every newly observed host remains unapproved. */
export function stageSourceCandidate(originInput:unknown,nameInput:unknown):SourceAtlasEntry|null {
 if(typeof originInput!=='string'||originInput.length>1000||typeof nameInput!=='string'||nameInput.length>140||
    nameInput.trim().length<2||/[<>\u0000-\u001f]/u.test(nameInput))return null;
 try{
  const url=new URL(originInput);
  if(url.protocol!=='https:'||url.username||url.password||url.port||
     unsafeHost.test(url.hostname)||!url.hostname.includes('.')||/^\d+(?:\.\d+){3}$/u.test(url.hostname)||url.hostname.includes(':'))return null;
  const origin=url.origin;
  if(worldSourceAtlas().some(source=>source.origin===origin))return null;
  return Object.freeze({
   id:'discovered:'+url.hostname,name:nameInput.trim(),origin,vertical:'news',
   scope:'international',countryCode:null,status:'candidate',
   acquisition:'discovery-only',rights:'source-specific-review-required',
  });
 }catch{return null;}
}

