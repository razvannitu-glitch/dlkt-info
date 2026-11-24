import type {EvidenceCard} from './contracts.js';
import {validArticleSubject} from './article-subject.js';
import type {LocalCard} from '../local/contracts.js';
import {classifyNewsHeadline,newsCategoryFromSourceId,contradictedHeadlineHints} from './editorial-categories.js';

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
export const NEWS_TAXONOMY_VERSION='iptc-media-topics-top-level-2026-10-16-dlkt-6' as const;
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
 readonly basis:'publisher-metadata'|'publisher-section'|'headline'|'legacy-topic'|'record-kind';
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
 culture:'01000000',arts:'01000000',entertainment:'01000000',music:'01000000',film:'01000000',movies:'01000000',hollywood:'01000000',television:'01000000',showbiz:'01000000',books:'01000000',cultura:'01000000',kultur:'01000000',
 crime:'02000000',justice:'02000000',law:'02000000',justitie:'02000000',justicia:'02000000',
 disasters:'03000000',accidents:'03000000',
 business:'04000000',economy:'04000000',finance:'04000000',markets:'04000000',stocks:'04000000','stock-market':'04000000',crypto:'04000000',cryptocurrency:'04000000',investing:'04000000',insurance:'04000000',industries:'04000000',economics:'04000000',economie:'04000000',economia:'04000000',wirtschaft:'04000000',asigurari:'04000000',investitii:'04000000',
 education:'05000000',educatie:'05000000',educacion:'05000000',bildung:'05000000',
 environment:'06000000',climate:'06000000',pets:'06000000',nature:'06000000',wildlife:'06000000',mediu:'06000000',environnement:'06000000',umwelt:'06000000',
 health:'07000000',medicine:'07000000',sanatate:'07000000',sante:'07000000',salud:'07000000',gesundheit:'07000000',
 'human-interest':'08000000',celebrity:'08000000',celebrities:'08000000',gossip:'08000000',monden:'08000000',
 labour:'09000000',labor:'09000000',employment:'09000000',jobs:'09000000',careers:'09000000',munca:'09000000',
 lifestyle:'10000000',leisure:'10000000',travel:'10000000',tourism:'10000000',vacations:'10000000',gardening:'10000000',hobbies:'10000000',motoring:'10000000',food:'10000000',recipes:'10000000',turism:'10000000',vacante:'10000000',gradinarit:'10000000',
 politics:'11000000',government:'11000000',politica:'11000000',politic:'11000000',politique:'11000000',politik:'11000000',
 religion:'12000000',religie:'12000000',
 // Exact subject keyword observed on the bound original France24 Spanish article; place names alone never imply war.
 'guerra-en-ucrania':'16000000',
 science:'13000000',technology:'13000000',tech:'13000000',software:'13000000',programming:'13000000','software-development':'13000000','web-development':'13000000',astronomy:'13000000',space:'13000000','science-and-technology':'13000000',stiinta:'13000000',tehnologie:'13000000',wissenschaft:'13000000',tecnologia:'13000000',
 society:'14000000',societate:'14000000',familie:'14000000',societe:'14000000',gesellschaft:'14000000',
 sport:'15000000',sports:'15000000',football:'15000000',soccer:'15000000',motorsport:'15000000',motogp:'15000000',deportes:'15000000',fotbal:'15000000',
 weather:'17000000',meteo:'17000000',
});
// Exact observed publisher sections; these labels do not classify URL paths or article keywords.
const PUBLISHER_SECTION_LABELS:Readonly<Record<string,NewsCategoryId>>=Object.freeze({
 'fotbal-intern':'15000000','liga-1':'15000000',superliga:'15000000',
});
function sectionCategory(url:URL):NewsCategoryId|null {
 // A place/country and words inside an article slug are not publisher subject metadata.
 const path=url.pathname.split('/').filter(Boolean);
 const tail=path.at(-1)??'';
 const includesSlug=(['www.dw.com','dw.com'].includes(url.hostname)&&/^a-\d+$/u.test(tail))
  ||(['www.thehindu.com','thehindu.com'].includes(url.hostname)&&/^article\d+\.ece$/u.test(tail));
 const segments=path.slice(0,includesSlug?-2:-1);
 for(const segment of segments){
  let key:string;try{key=fold(decodeURIComponent(segment));}catch{continue;}
  if(Object.hasOwn(SECTIONS,key))return SECTIONS[key]??null;
 }
 return null;
}
const FINANCIAL=/\b(?:quarterly (?:earnings|profits|results)|earnings|profits? (?:rise|fall|jump|drop)|revenue|stock market|share price|venture capital|startup funding|ipo|interest rates?|inflation|rezultate financiare|profit(?:ul|uri)?|cifra de afaceri|inflatie|dobanzi)\b/u;
const MARKET_SUBJECT=/\b(?:s\s*&\s*p\s*500|nasdaq|dow jones|ftse 100|nikkei 225|cryptocurrenc(?:y|ies)|crypto|bitcoin|ethereum|bursa de valori|indici bursieri|piete bursiere|criptomonede(?:le)?|fonduri de investitii)\b/u;
const MEDICAL=/\b(?:retail medicine|healthcare|health care|health insurance|asigurari de sanatate|veterinary|veterinar(?:i|e)?|medical treatment|general practitioners?|(?:gp|general practice) surger(?:y|ies)|medicine|medicines|vaccines?|vaccination|hospitals?|patients?|cancer|diabetes|sanatate|medicina|medicamente|vaccin(?:uri|are)?|spital(?:ul|e|ele)?|pacienti|tratament(?:e|ul)?)\b/u;
const TECH=/\b(?:machine learning|deep learning|artificial intelligence|inteligenta artificiala|semiconductors?|software|web development|software development|programming languages?|javascript|typescript|devops|information technology|cybersecurity|dezvoltare web|limbaje de programare|securitate cibernetica|quantum computing)\b/u;
// Explicit sector context is needed: a hobby, personal story or legal action is not an industry report.
// IPTC animal (including pets) sits under environment/nature; industry regulation sits under government.
const INDUSTRY=/\b(?:manufacturing|industrial production|automotive industry|motorcycle industry|transport industry|transport sector|freight|logistics|insurance|insurers?|business opportunities|antreprenoriat|oportunitati de afaceri|productie industriala|industria auto|industria transporturilor|transportul de marfa|logistica|asigurari|asiguratori|investitii)\b/u;
const ADULT_BUSINESS=/\b(?:(?:adult(?: entertainment|[- ]content)?|porn|pornography) (?:industry|industries|business(?:es)?|companies|platforms|websites)|industria(?: de divertisment)? pentru adulti|industria pornografica|platforme(?:le)? pentru adulti)\b/u;
const SECTOR_REGULATION=/\b(?:regulations?|regulators?|regulatory|legislation|laws?|rules|legal requirements?|reglement\w*|legislati\w*|legi|legea|norme legale)\b/u;
const CELEBRITY=/\b(?:celebrit(?:y|ies)|hollywood|movie stars?|pop stars?|actors?|actresses|vedet(?:a|e|ele)|actor(?:ul|i|ii)?|actrit(?:a|e|ele))\b/u;
const PERSONAL_LIFE=/\b(?:gossip|wedding|engagement|married|marriage|divorce|birthday|relationship|barfe|nunta|logodn\w*|casatori\w*|divort\w*|ziua de nastere)\b/u;
const DIRECT:readonly (readonly [NewsCategoryId,RegExp])[]=[
 ['02000000',/\b(?:charged with|convicted|sentenced|arrested|murder|homicide|police investigat\w*|court (?:rules|ruling|orders|judgment)|criminal trial|crime rates?|robber(?:y|ies)|burglar(?:y|ies)|thefts?|criminalitate|furt(?:ul|uri)?|jaf(?:ul|uri)?|sentinta|condamnat\w*|arestat\w*|arest(?:ul|ului)?|dosar penal|ancheta penala|urmarire penala|justitie|coruptie|tribunal|diicot|curtea de apel|inalta curte|procuror(?:ul|ului|i|ii|ilor)?|magistrat(?:ul|ului|i|ii|ilor)?|judecator(?:ul|ului|i|ii|ilor)?|meurtre|verurteilt|asesinato)\b/u],
 ['03000000',/\b(?:earthquakes?|tsunami|wildfires?|(?:plane|train|car|road|traffic|motorcycle|bus) (?:crash(?:es)?|accidents?|collisions?)|train derailment|building collapse|flash floods?|cutremur\w*|incendiu\w*|inundatii\w*|accident(?:ul|e|ele)? (?:rutier|rutiere|feroviar|feroviare|aviatic|aviatice)|coliziune rutiera|coliziuni rutiere|munitie neexplodata|bomba de aviatie|deraiere|terremoto|erdbeben|seisme)\b|地震|津波|زلزال/u],
 ['16000000',/\b(?:ceasefire|airstrikes?|air strikes?|armed conflict|peace talks|war in|war against|invasion|razboi(?:ul)?|bombardamente|armistitiu|conflict armat|incetarea focului|cessez-le-feu|waffenstillstand|alto el fuego)\b|停戦|空爆|وقف إطلاق النار/u],
 ['09000000',/\b(?:workers? strike|teachers? strike|industrial action|trade unions?|layoffs?|unemployment|workforce|(?:job|staff|management) vacancies|hiring|recruitment|labour market|labor market|greva|grevis\w*|sindicat\w*|concedieri|somaj|angajari|recrutare|posturi vacante|locuri de munca|salarizar(?:e|ea|ii)|salari(?:u|ul|ului) minim|majorari salariale|ministrul muncii)\b/u],
 ['14000000',/\b(?:homelessness|social services|public housing|human rights|child protection|parenting|childcare|saracie|asistenta sociala|protectia copilului|drepturile omului|locuinte sociale|persoane fara adapost)\b/u],
 ['11000000',/\b(?:elections?|parliament|prime minister|prim[- ]ministru(?:l)?|premier(?:ul)? desemnat|government policy|city council|urban planning|election results|alegeri(?:le|lor)?|politicien(?:i|ii|ilor)|referendum(?:ul|uri)?|parlament\w*|primari[ae]|primarul|consiliul local|consiliul general|consilierii locali|politic[ai]|guvern(?:ul)?|plan urbanistic)\b/u],
 ['05000000',/\b(?:education|schools?|universit(?:y|ies)|students?|curriculum|tuition|scholarships?|educatie|scoal[ai]|scoli|liceu(?:l)?|elevi(?:i|lor)?|gradinit[ae]|universitat\w*|burse scolare|invatamant|bacalaureat)\b/u],
 ['01000000',/\b(?:concert(?:s|ul|e)?|festival(?:s|ul|uri)?|muzeu\w*|teatru\w*|expoziti[aei]|cinema|hollywood|film premieres?|box office|filme|muzica|literatura)\b/u],
 ['15000000',/\b(?:football|soccer|tennis|basketball|formula 1|formula one|grand prix|world cup|motogp|motocross|superbike|rugby|cricket|cycling championship|fotbal|baschet|tenis|handbal|campionat\w*)\b/u],
 ['12000000',/\b(?:religion|religious worship|pope|papal|ramadan|pilgrimage|pelerinaj(?:ul|e|ele|elor)?|liturghi(?:e|a|i|ile)|rugaciun(?:e|ea|i|ile|ilor)|religie|papa|patriarh(?:ul|ului|i|ii)?|episcop(?:ul|ului|i|ii)?|maica domnului|dumnezeu)\b/u],
 ['06000000',/\b(?:climate change|biodiversity|deforestation|wildlife conservation|endangered species|renewable energy|schimbari climatice|poluare|defrisari|biodiversitate|conservarea naturii|specii protejate|specii pe cale de disparitie|energie regenerabila|protectia mediului|deseuri(?:le|lor)? voluminoase|deseuri(?:le|lor)? medicale|garda de mediu)\b/u],
 ['17000000',/\b(?:weather forecast|prognoza meteo|vremea|temperatur(?:i|ile)|prognoza anm|administratia nationala de meteorologie|meteorologi(?:i|lor)?|avertizare meteorologica)\b/u],
 ['10000000',/\b(?:gardening|hobbies|hobby|knitting|birdwatching|car reviews?|motorcycle reviews?|classic cars|classic motorcycles|car enthusiasts|motoring|vacations?|holiday destinations?|gradinarit|masini clasice|motociclete clasice|pasionati (?:auto|moto)|vacante|destinatii turistice|turism)\b/u],
 ['13000000',/\b(?:cosmos|astronomie|astronauti|galaxii|exoplanete|telescop(?:ul)?|cercetatori(?:i|lor)?|studiu stiintific|biologie|botanica)\b/u],
 ['06000000',/\b(?:pet[- ]care|pet adoption|dog training|cat care|animale de companie|ingrijirea (?:cainilor|pisicilor))\b/u],
];
// Mask an explicitly figurative wave only for subject inference; stored evidence is untouched.
function literalHeadline(title:string):string {
 return title.replace(/\btsunami(?=["'’”]?\s+of\s+(?:demand|requests|calls|appointments|paperwork)\b)/giu,' ');
}
// A bounded capitalized name plus an edition marker can identify a title in explicit game release coverage.
function crimeSubjectText(title:string):string {
 const normalized=fold(title);
 const game=/\b(?:video games?|videogames?|gaming|gameplay|playstation|xbox|nintendo)\b/u.test(normalized);
 const release=/\b(?:launch(?:es|ed|ing)?|release(?:s|d)?|debut(?:s|ed)?|trailers?|dlc|expansion packs?)\b/u.test(normalized);
 const reported=/\b(?:police|officers?|suspects?|victims?|stolen|steal(?:s|ing)?|charges?|lawsuits?|trials?|courts?|arrests?|investigations?|fraud|spree|rampant)\b/u.test(normalized)
  ||/^(?:(?:a|an|the|another|suspected|alleged)\s+)*theft\b|\btheft\s+(?:of|from|at|near|during|outside|inside|in|on|by|after|before|reported|suspected|alleged|delays?|disrupts?|hits?|rises?|surges?|falls?|increases?|decreases?|sparks?|prompts?|causes?|remains?)\b/u.test(normalized);
 return game&&release&&!reported?title.replace(/\b(\p{Lu}[\p{L}’'-]{1,60})\s+Theft\s+(\p{Lu}[\p{L}’'-]{1,60})\s+([IVX]{1,6}|\d{1,2})(?=\s|[.,:;!?'"’”]|$)/gu,'$1 $2 $3'):title;
}
// Humanitarian disruption provides explicit warfare context; commercial and fictional wars do not.
function humanitarianWar(title:string):boolean {
 return /\bwars?\b/u.test(title)
  &&/\b(?:humanitarian|aid|relief|civilians?|refugees?|displaced|food (?:routes|supplies|shipments)|supply routes)\b/u.test(title)
  &&/\b(?:chok(?:e|es|ed|ing)|disrupt(?:s|ed|ing)?|threaten(?:s|ed|ing)?|block(?:s|ed|ing)?|halt(?:s|ed|ing)?|cut(?:s|ting)?|displac(?:e|es|ed|ing)|leave|leaves|left)\b/u.test(title)
  &&!/\b(?:(?:trade|price|culture|console|streaming|tariff|currency|bidding|brand) wars?|wars? of words|war on (?:drugs|poverty)|films?|movies?|novels?|fiction(?:al)?|video games?|videogames?|gaming|gameplay|playstation|xbox|nintendo)\b/u.test(title);
}
// A newly recognized shooting must not turn explicit warfare or a fictional depiction into crime reporting.
const REPORTED_SHOOTING=/\b(?:a|au) fost impuscat(?:a|e|i)?\b/u;
const FICTIONAL_SHOOTING=/\b(?:in|din) (?:(?:noul|acest|un) )?(?:film(?:ul)?|serial(?:ul)?|roman(?:ul)?)\b/u;
function headlineCategory(title:string,originalTitle:string):NewsCategoryId|null {
 const crimeTitle=fold(crimeSubjectText(originalTitle)),war=humanitarianWar(title);
 const matches=(category:NewsCategoryId,pattern:RegExp):boolean=>pattern.test(category==='02000000'?crimeTitle:title)||(category==='16000000'&&war);
 const event=DIRECT.slice(0,3).find(([category,pattern])=>matches(category,pattern));
 if(event)return event[0];
 if(REPORTED_SHOOTING.test(title)&&!FICTIONAL_SHOOTING.test(title)&&!/\bnu (?:a|au) fost impuscat(?:a|e|i)?\b/u.test(title))return '02000000';
 // Commercial vocabulary cannot turn care delivery into shopping; financial results remain economy.
 const adultBusiness=ADULT_BUSINESS.test(title);
 if(adultBusiness&&SECTOR_REGULATION.test(title))return '11000000';
 if(FINANCIAL.test(title))return '04000000';
 // Employment changes remain labour news when the employer happens to make software.
 if(DIRECT[3]?.[1].test(title))return '09000000';
 if(MARKET_SUBJECT.test(title))return '04000000';
 if(adultBusiness)return '04000000';
 if(TECH.test(title))return '13000000';
 if(MEDICAL.test(title)&&!/\b(?:medical school|medical students?|medical education|facultatea de medicina)\b/u.test(title))return '07000000';
 if(CELEBRITY.test(title)&&PERSONAL_LIFE.test(title))return '08000000';
 const direct=DIRECT.find(([category,pattern])=>matches(category,pattern));
 return direct?.[0]??(INDUSTRY.test(title)?'04000000':null);
}

// Operational transport alone does not establish an IPTC lifestyle or leisure subject.
const LEISURE_TRAVEL=/\b(?:tourism|tourists?|vacations?|holiday destinations?|city breaks?|backpacking|cruises?|getaways?|(?:solo|family|budget|leisure) travel|travel (?:guides?|tips|destinations?|itineraries|inspiration)|turism|turisti|vacante|calatorii de agrement|destinatii turistice|ghid turistic)\b/u;

const retailCare=(title:string):boolean=>/\bretail medicine\b/u.test(title)&&!FINANCIAL.test(title);

/** DLKT classification, not an IPTC-provided classifier. No summaries, place names or invented tags. */
export function classifyNewsSubject(title:string,sourceUrl:string):NewsClassification|null{
 if(!title.trim()||title.length>4000||/[\u0000-\u001f\u007f]/u.test(title))return null;
 let url:URL;try{url=new URL(sourceUrl);}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
 const headline=literalHeadline(title),normalized=fold(headline),section=sectionCategory(url);
 // This care-delivery subject is explicit even when a publisher files it on a broad business desk.
 if(retailCare(normalized))return result('07000000','headline');
 if(section!==null)return result(section,'publisher-section');
 const direct=headlineCategory(normalized,headline);
 if(direct!==null)return result(direct,'headline');
 // Preserve the existing reviewed FR/DE/ES/PT/AR/JA and English semantic safeguards.
 // Legacy semantics use the edition language and publisher, never the article slug or a generic place desk.
 const semanticUrl=new URL(url.href),language=/^\/(fr|de|es|pt-br|pt-002|ar|japanese)(?:\/|$)/u.exec(url.pathname)?.[1];
 semanticUrl.pathname=language?'/'+language+'/':'/';semanticUrl.search='';semanticUrl.hash='';
 const legacy=classifyNewsHeadline(headline,semanticUrl.href);
 if(legacy===null)return null;
 if(legacy==='world')return result('11000000','headline'); // International relations, not presumed warfare.
 if(legacy==='housing')return null; // Needs explicit commercial, planning or welfare evidence above.
 if(legacy==='travel'&&!LEISURE_TRAVEL.test(normalized))return null;
 const category=legacyCategoryToNewsCategory(legacy);
 return category===null?null:result(category,'headline');
}
type EvidenceInput=Pick<EvidenceCard,'title'|'sourceUrl'|'sourceIds'|'topic'|'articleSubject'>;
type LocalInput=Pick<LocalCard,'title'|'sourceUrl'|'kind'|'news'>;
function publisherSubject(card:EvidenceInput):NewsClassification|null {
 const metadata=card.articleSubject;
 if(!validArticleSubject(metadata,card.sourceUrl))return null;
  const termCategory=(term:string,section:boolean):NewsCategoryId|null=>{
  const normalized=fold(term),key=normalized.replaceAll(' ','-');
  const definition=NEWS_CATEGORIES.find(category=>[category.iptcLabel,category.label,category.labelRo,category.qcode,category.uri].some(label=>fold(label)===normalized));
   return definition?.id??(Object.hasOwn(SECTIONS,key)?SECTIONS[key]??null:null)
    ??(section&&Object.hasOwn(PUBLISHER_SECTION_LABELS,key)?PUBLISHER_SECTION_LABELS[key]??null:null);
 };
 // Some publishers encode a section hierarchy as "Actualitate, Politic".
 // Keep complete IPTC labels intact, then inspect explicit separated section terms.
 // Multiple distinct subjects remain ambiguous; a quota never supplies a subject.
  const mapped=(values:readonly string[],section:boolean):Set<NewsCategoryId>=>new Set(values.flatMap(term=>{
   const whole=termCategory(term,section);if(whole)return [whole];
   return term.split(/[,;|]/u).map(part=>termCategory(part,section)).filter(isNewsCategoryId);
 }));
  const sections=mapped(metadata.sections,true),keywords=mapped(metadata.keywords,false);
 // A precise section takes precedence over broad keywords. Conflicting sections are not collapsed into one label.
 if(sections.size>1)return null;
 const choices=sections.size?sections:keywords;
 const category=choices.size===1?[...choices][0]:undefined;
 return category?result(category,'publisher-metadata'):null;
}
export function classifyEvidenceCard(card:EvidenceInput):NewsClassification|null{
 if(retailCare(fold(card.title)))return result('07000000','headline');
 const provided=publisherSubject(card);if(provided)return provided;
 const subject=classifyNewsSubject(card.title,card.sourceUrl);
 if(subject)return subject;
 if(card.sourceIds.includes('news-unclassified'))return null;
 // A specific, agreed discovery hint can support an otherwise terse headline.
 // Generic world/housing/other/topic defaults cannot classify an unknown article.
 const contradicted=contradictedHeadlineHints(card.title),leisure=LEISURE_TRAVEL.test(fold(card.title)),metaphor=literalHeadline(card.title)!==card.title;
 const hints=new Set(card.sourceIds.map(newsCategoryFromSourceId)
  .filter(value=>value!==null&&value!=='world'&&value!=='housing'&&!contradicted.includes(value)&&!(value==='travel'&&!leisure)&&!(value==='weather'&&metaphor))
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
