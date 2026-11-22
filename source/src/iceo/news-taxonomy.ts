import type {EvidenceCard} from './contracts.js';
import type {LocalCard} from '../local/contracts.js';
import {classifyNewsHeadline,newsCategoryFromSourceId} from './editorial-categories.js';

/**
 * IPTC Media Topics, 17 top-level concepts, checked 2026-11-22.
 * Source: https://www.iptc.org/std/NewsCodes/treeview/mediatopic/mediatopic-en-US.html
 * Vocabulary snapshot: 2026-10-16; © IPTC, CC BY 4.0.
 * Official names are en-US. Short reader labels and Romanian translations are DLKT's.
 * Concept URIs deliberately retain IPTC's canonical http scheme.
 */
const DEFINITIONS = [
 ['01000000','arts, culture, entertainment and media','Culture','Cultura'],
 ['02000000','crime, law and justice','Crime & justice','Justitie'],
 ['03000000','disaster, accident and emergency incident','Disasters & accidents','Accidente si dezastre'],
 ['04000000','economy, business and finance','Economy','Economie'],
 ['05000000','education','Education','Educatie'],
 ['06000000','environment','Environment','Mediu'],
 ['07000000','health','Health','Sanatate'],
 ['08000000','human interest','Human interest','Fapt divers'],
 ['09000000','labor','Labour','Munca'],
 ['10000000','lifestyle and leisure','Lifestyle','Stil de viata'],
 ['11000000','politics and government','Politics','Politica'],
 ['12000000','religion','Religion','Religie'],
 ['13000000','science and technology','Science & technology','Stiinta si tehnologie'],
 ['14000000','society','Society','Societate'],
 ['15000000','sport','Sport','Sport'],
 ['16000000','conflict, war and peace','War & peace','Razboi si pace'],
 ['17000000','weather','Weather','Vreme'],
] as const;
export type NewsCategoryId = typeof DEFINITIONS[number][0];
export interface NewsCategoryDefinition {
 readonly id:NewsCategoryId; readonly qcode:`medtop:${NewsCategoryId}`; readonly uri:string;
 readonly iptcLabel:string; readonly label:string; readonly labelRo:string;
}
export const NEWS_TAXONOMY_VERSION='iptc-media-topics-top-level-2026-10-16-dlkt-1' as const;
export const NEWS_CATEGORIES:readonly NewsCategoryDefinition[]=Object.freeze(DEFINITIONS.map(([id,iptcLabel,label,labelRo])=>
 Object.freeze({id,qcode:('medtop:'+id) as `medtop:${NewsCategoryId}`,uri:'http://cv.iptc.org/newscodes/mediatopic/'+id,iptcLabel,label,labelRo})));
const ids:ReadonlySet<string>=new Set(NEWS_CATEGORIES.map(category=>category.id));
export function isNewsCategoryId(value:unknown):value is NewsCategoryId{return typeof value==='string'&&ids.has(value);}
export function newsCategoryLabel(id:NewsCategoryId,locale='en'):string{
 const category=NEWS_CATEGORIES.find(item=>item.id===id);
 return category?(locale.toLowerCase().split(/[-_]/u)[0]==='ro'?category.labelRo:category.label):'';
}
export interface NewsClassification {
 readonly category:NewsCategoryId;
 readonly basis:'publisher-section'|'headline'|'legacy-topic'|'record-kind';
}
const result=(category:NewsCategoryId,basis:NewsClassification['basis']):NewsClassification=>Object.freeze({category,basis});

/** Compatibility projection only. Never rewrites stored topic/category IDs or preferences.
 * Ambiguous work-education and other are deliberately unmapped. These are not IPTC mappings.
 */
const LEGACY:Readonly<Record<string,NewsCategoryId>>=Object.freeze({
 culture:'01000000',business:'04000000',money:'04000000',shopping:'04000000',education:'05000000',
 environment:'06000000',energy:'06000000',health:'07000000',work:'09000000',
 gaming:'10000000',travel:'10000000',food:'10000000',world:'11000000','public-affairs':'11000000',
 housing:'11000000',regulation:'02000000',technology:'13000000',science:'13000000',space:'13000000',
 'digital-life':'13000000',family:'14000000',sport:'15000000',weather:'17000000',
});
export function legacyCategoryToNewsCategory(value:string):NewsCategoryId|null{
 return Object.hasOwn(LEGACY,value)?LEGACY[value]??null:null;
}
const fold=(value:string):string=>value.normalize('NFKC').toLowerCase().normalize('NFKD')
 .replace(/(\p{Script=Latin})\p{M}+/gu,'$1').normalize('NFC').replace(/[’‘]/gu,"'").replace(/\s+/gu,' ').trim();
const SECTIONS:Readonly<Record<string,NewsCategoryId>>=Object.freeze({
 culture:'01000000',arts:'01000000',entertainment:'01000000',music:'01000000',film:'01000000',books:'01000000',cultura:'01000000',kultur:'01000000',
 crime:'02000000',justice:'02000000',law:'02000000',justitie:'02000000',justicia:'02000000',
 disasters:'03000000',accidents:'03000000',
 business:'04000000',economy:'04000000',finance:'04000000',markets:'04000000',economics:'04000000',economie:'04000000',economia:'04000000',wirtschaft:'04000000',
 education:'05000000',educatie:'05000000',educacion:'05000000',bildung:'05000000',
 environment:'06000000',climate:'06000000',mediu:'06000000',environnement:'06000000',umwelt:'06000000',
 health:'07000000',medicine:'07000000',sanatate:'07000000',sante:'07000000',salud:'07000000',gesundheit:'07000000',
 'human-interest':'08000000',
 labour:'09000000',labor:'09000000',employment:'09000000',munca:'09000000',
 lifestyle:'10000000',leisure:'10000000',travel:'10000000',food:'10000000',recipes:'10000000',
 politics:'11000000',government:'11000000',politica:'11000000',politique:'11000000',politik:'11000000',
 religion:'12000000',religie:'12000000',
 science:'13000000',technology:'13000000',tech:'13000000','science-and-technology':'13000000',stiinta:'13000000',tehnologie:'13000000',wissenschaft:'13000000',tecnologia:'13000000',
 society:'14000000',societate:'14000000',societe:'14000000',gesellschaft:'14000000',
 sport:'15000000',sports:'15000000',deportes:'15000000',
 weather:'17000000',meteo:'17000000',
});
function sectionCategory(url:URL):NewsCategoryId|null {
 // A place/country and words inside an article slug are not publisher subject metadata.
 const segments=url.pathname.split('/').filter(Boolean).slice(0,-1);
 for(const segment of segments){
  let key:string;try{key=fold(decodeURIComponent(segment));}catch{continue;}
  if(Object.hasOwn(SECTIONS,key))return SECTIONS[key]??null;
 }
 return null;
}
const FINANCIAL=/\b(?:quarterly (?:earnings|profits|results)|earnings|profits? (?:rise|fall|jump|drop)|revenue|stock market|share price|ipo|interest rates?|inflation|rezultate financiare|profit(?:ul|uri)?|cifra de afaceri|inflatie|dobanzi)\b/u;
const MEDICAL=/\b(?:retail medicine|healthcare|health care|medical treatment|medicine|medicines|vaccines?|vaccination|hospitals?|patients?|cancer|diabetes|sanatate|medicina|medicamente|vaccin(?:uri|are)?|spital(?:ul|e|ele)?|pacienti|tratament(?:e|ul)?)\b/u;
const TECH=/\b(?:machine learning|deep learning|artificial intelligence|inteligenta artificiala|semiconductors?|software|quantum computing)\b/u;
const DIRECT:readonly (readonly [NewsCategoryId,RegExp])[]=[
 ['02000000',/\b(?:charged with|convicted|sentenced|arrested|murder|homicide|police investigat\w*|court (?:rules|ruling|orders|judgment)|criminal trial|sentinta|condamnat\w*|arestat\w*|dosar penal|ancheta penala|urmarire penala|justitie|coruptie|tribunal|meurtre|verurteilt|asesinato)\b/u],
 ['03000000',/\b(?:earthquakes?|tsunami|wildfires?|plane crash|train crash|building collapse|flash floods?|cutremur\w*|incendiu\w*|inundatii\w*|accident (?:rutier|feroviar|aviatic)|terremoto|erdbeben|seisme)\b|地震|津波|زلزال/u],
 ['16000000',/\b(?:ceasefire|airstrikes?|air strikes?|armed conflict|peace talks|war in|war against|invasion|razboi(?:ul)?|bombardamente|armistitiu|conflict armat|incetarea focului|cessez-le-feu|waffenstillstand|alto el fuego)\b|停戦|空爆|وقف إطلاق النار/u],
 ['09000000',/\b(?:workers? strike|teachers? strike|industrial action|trade unions?|layoffs?|unemployment|workforce|labour market|labor market|greva|grevis\w*|sindicat\w*|concedieri|somaj|angajari|locuri de munca)\b/u],
 ['14000000',/\b(?:homelessness|social services|public housing|human rights|child protection|parenting|childcare|saracie|asistenta sociala|protectia copilului|drepturile omului|locuinte sociale|persoane fara adapost)\b/u],
 ['11000000',/\b(?:elections?|parliament|prime minister|government policy|city council|urban planning|election results|alegeri|parlament\w*|primari[ae]|primarul|consiliul local|consiliul general|consilierii locali|politic[ai]|guvern(?:ul)?|plan urbanistic)\b/u],
 ['05000000',/\b(?:education|schools?|universit(?:y|ies)|students?|curriculum|tuition|scholarships?|educatie|scoal[ai]|scoli|liceu(?:l)?|elevi(?:i|lor)?|gradinit[ae]|universitat\w*|burse scolare|invatamant|bacalaureat)\b/u],
 ['01000000',/\b(?:concert(?:s|ul|e)?|festival(?:s|ul|uri)?|muzeu\w*|teatru\w*|expoziti[aei]|cinema|filme|muzica|literatura)\b/u],
 ['15000000',/\b(?:football|soccer|tennis|basketball|formula 1|formula one|grand prix|world cup|fotbal|baschet|tenis|handbal|campionat\w*)\b/u],
 ['12000000',/\b(?:religion|religious worship|pope|papal|ramadan|pilgrimage|pelerinaj|liturghie|religie|papa|patriarh)\b/u],
 ['06000000',/\b(?:climate change|biodiversity|deforestation|renewable energy|schimbari climatice|poluare|defrisari|biodiversitate|energie regenerabila|protectia mediului)\b/u],
 ['17000000',/\b(?:weather forecast|prognoza meteo|vremea|temperaturi|avertizare meteorologica)\b/u],
];
function headlineCategory(title:string):NewsCategoryId|null {
 const event=DIRECT.slice(0,3).find(([,pattern])=>pattern.test(title));
 if(event)return event[0];
 // Commercial vocabulary cannot turn care delivery into shopping; financial results remain economy.
 if(FINANCIAL.test(title))return '04000000';
 if(TECH.test(title))return '13000000';
 if(MEDICAL.test(title)&&!/\b(?:medical school|medical students?|medical education|facultatea de medicina)\b/u.test(title))return '07000000';
 return DIRECT.find(([,pattern])=>pattern.test(title))?.[0]??null;
}

/** DLKT classification, not an IPTC-provided classifier. No summaries, place names or invented tags. */
export function classifyNewsSubject(title:string,sourceUrl:string):NewsClassification|null{
 if(!title.trim()||title.length>4000||/[\u0000-\u001f\u007f]/u.test(title))return null;
 let url:URL;try{url=new URL(sourceUrl);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 const normalized=fold(title),section=sectionCategory(url);
 // This care-delivery subject is explicit even when a publisher files it on a broad business desk.
 if(/\bretail medicine\b/u.test(normalized)&&!FINANCIAL.test(normalized))return result('07000000','headline');
 if(section!==null)return result(section,'publisher-section');
 const direct=headlineCategory(normalized);
 if(direct!==null)return result(direct,'headline');
 // Preserve the existing reviewed FR/DE/ES/PT/AR/JA and English semantic safeguards.
 const legacy=classifyNewsHeadline(title,sourceUrl);
 if(legacy===null)return null;
 if(legacy==='world')return result('11000000','headline'); // International relations, not presumed warfare.
 if(legacy==='housing')return null; // Needs explicit commercial, planning or welfare evidence above.
 const category=legacyCategoryToNewsCategory(legacy);
 return category===null?null:result(category,'headline');
}
type EvidenceInput=Pick<EvidenceCard,'title'|'sourceUrl'|'sourceIds'|'topic'>;
type LocalInput=Pick<LocalCard,'title'|'sourceUrl'|'kind'|'news'>;
export function classifyEvidenceCard(card:EvidenceInput):NewsClassification|null{
 const subject=classifyNewsSubject(card.title,card.sourceUrl);
 if(subject)return subject;
 if(card.sourceIds.includes('news-unclassified'))return null;
 // A specific, agreed discovery hint can support an otherwise terse headline.
 // Generic world/housing/other/topic defaults cannot classify an unknown article.
 const hints=new Set(card.sourceIds.map(newsCategoryFromSourceId)
  .filter(value=>value!==null&&value!=='world'&&value!=='housing')
  .map(value=>value===null?null:legacyCategoryToNewsCategory(value)).filter(isNewsCategoryId));
 if(hints.size===1){const category=[...hints][0];if(category)return result(category,'legacy-topic');}
 return null;
}
export function classifyLocalCard(card:LocalInput):NewsClassification|null{
 if(card.kind==='forecast')return result('17000000','record-kind');
 if(card.kind==='local-news'&&card.news)return classifyNewsSubject(card.news.title,card.news.url);
 const subject=classifyNewsSubject(card.title,card.sourceUrl);
 if(subject)return subject;
 return card.kind==='event'?result('01000000','record-kind'):null;
}
export function newsCategory(card:EvidenceCard|LocalCard):NewsCategoryId|null{
 return ('sourceIds' in card?classifyEvidenceCard(card):classifyLocalCard(card))?.category??null;
}
