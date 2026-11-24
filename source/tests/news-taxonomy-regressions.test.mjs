import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNewsHeadline,classifyEditorialCard,contradictedHeadlineHints,editorialInterestTopic} from '../.build/src/iceo/editorial-categories.js';
import {classifyNewsSubject,classifyEvidenceCard,NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';

const generic='https://www.theguardian.com/world/2026/nov/24/reported-story';
const sourceCard=(title,sourceUrl=generic,overrides={})=>({title,sourceUrl,sourceIds:['news-unclassified'],topic:'other',...overrides});
const category=(title,url=generic)=>classifyNewsSubject(title,url)?.category??null;

// Original public metadata observed in DLKT epoch1590 on 2026-11-24.
// A discovery topic is retained as provenance, never rewritten to make a test pass.
const observed=[
 {title:'Cum au „devenit români” separatiști, afaceriști apropiați de Putin, trădători ucraineni sau oameni de încredere ai lui Kadîrov',
  sourceUrl:'https://www.digi24.ro/stiri/actualitate/cum-au-devenit-romani-separatisti-afaceristi-apropiati-de-putin-tradatori-ucraineni-sau-oameni-de-incredere-ai-lui-kadirov-4048575',
  sourceIds:['news-technology'],topic:'technology',articleSubject:undefined,expected:null},
 {title:'Southern Railway AGM inspects Salem Division',
  sourceUrl:'https://www.thehindu.com/news/cities/Coimbatore/southern-railway-agm-inspects-salem-division/article71735687.ece',
  sourceIds:['news-travel'],topic:'travel',
  articleSubject:{basis:'publisher-jsonld',keywords:['Mettur dam railway station','Salem',"Salem DRM&#039;s office",'Salem Railway Division','Southern Railway AGM','inspection at Salem Railway Division'],sections:['Coimbatore'],articleUrl:'https://www.thehindu.com/news/cities/Coimbatore/southern-railway-agm-inspects-salem-division/article71735687.ece'},
  expected:null},
 {title:'Nouă persoane au fost împușcate la un concert din California. Ce spun autoritățile despre atac - HotNews.ro',
  sourceUrl:'https://hotnews.ro/noua-persoane-au-fost-impuscate-la-un-concert-din-california-2411218',
  sourceIds:['news-culture'],topic:'culture',
  articleSubject:{basis:'publisher-jsonld',keywords:[],sections:['Actualitate, International'],articleUrl:'https://hotnews.ro/noua-persoane-au-fost-impuscate-la-un-concert-din-california-2411218'},
  expected:'02000000'},
 {title:'Science department advertises 24 senior management vacancies',
  sourceUrl:'https://www.sanews.gov.za/south-africa/science-department-advertises-24-senior-management-vacancies',
  sourceIds:['sanews'],topic:'science',articleSubject:undefined,expected:'09000000'},
];

test('observed originals classify by supported subject without mutating title, URL or discovery provenance',()=>{
 assert.equal(NEWS_CATEGORIES.length,17);
 for(const row of observed){
  const {expected,...card}=row;const before=JSON.stringify(card);
  assert.equal(classifyEvidenceCard(card)?.category??null,expected,card.title);
  assert.equal(JSON.stringify(card),before,'classification must not rewrite original evidence');
 }
});

test('Romanian ai cannot become artificial intelligence or revive a stale technology discovery hint',()=>{
 const title=observed[0].title,url=observed[0].sourceUrl;
 assert.equal(classifyNewsHeadline(title,url),null);
 assert.equal(classifyNewsSubject(title,url),null);
 assert.ok(contradictedHeadlineHints(title).includes('technology'));
 const card=sourceCard(title,url,{sourceIds:['news-technology'],topic:'technology'});
 assert.equal(classifyEditorialCard(card),null);
 assert.equal(editorialInterestTopic(card),'other');
 for(const headline of ['Ai vazut ce s-a intamplat?','Oamenii de incredere ai liderului au sosit']){
  assert.equal(classifyNewsHeadline(headline,url),null,headline);
  assert.equal(classifyEvidenceCard(sourceCard(headline,url,{sourceIds:['news-technology'],topic:'technology'})),null,headline);
 }
});

test('explicit AI acronyms, supported AI phrases and independent technical evidence stay available',()=>{
 for(const title of ['AI models improve image recognition','Generative ai changes image editing','An ai-powered assistant launches','New ai tools are available','Oamenii de incredere ai companiei prezinta software nou']){
  assert.equal(classifyNewsHeadline(title,generic),'technology',title);
  assert.equal(classifyEvidenceCard(sourceCard(title,generic,{sourceIds:['news-technology'],topic:'technology'}))?.category,'13000000',title);
  assert.equal(contradictedHeadlineHints(title).includes('technology'),false,title);
 }
 const explicit=classifyNewsSubject('Ai aflat noutatile?','https://www.theguardian.com/technology/2026/nov/24/reported-story');
 assert.equal(explicit?.category,'13000000');assert.equal(explicit?.basis,'publisher-section');
});

test('operational transport is not inferred leisure; real leisure and precise publisher sections survive',()=>{
 for(const title of ['Southern Railway AGM inspects Salem Division','Railway maintenance affects services','Airport authority inspects a terminal']){
  assert.equal(category(title),null,title);
  assert.equal(classifyEvidenceCard(sourceCard(title,generic,{sourceIds:['news-travel'],topic:'travel'})),null,title);
 }
 for(const title of ['Tourism grows around the restored railway','A travel guide to scenic railways','Holiday destinations reachable by train','Solo travel on a budget']){
  assert.equal(category(title),'10000000',title);
 }
 const section=classifyNewsSubject('New destinations announced','https://www.theguardian.com/travel/2026/nov/24/reported-story');
 assert.equal(section?.category,'10000000');assert.equal(section?.basis,'publisher-section');
 assert.equal(category('Train crash closes a railway'),'03000000');
 assert.equal(category('Railway operator reports quarterly earnings'),'04000000');
});

test('a reported shooting is not a culture story merely because the location is a concert',()=>{
 assert.equal(category(observed[2].title,observed[2].sourceUrl),'02000000');
 for(const title of ['Un barbat a fost impuscat langa un muzeu','Doua persoane au fost impuscate la festival']){
  assert.equal(category(title),'02000000',title);
 }
 for(const title of ['Un film despre o impuscatura are premiera','Concertul de solidaritate pentru victimele atacului','Fotograful anunta o expozitie despre un concert']){
  assert.equal(category(title),'01000000',title);
 }
});

test('explicit management and staff vacancies describe employment, without treating room or crystal vacancies as jobs',()=>{
 for(const title of ['Science department advertises 24 senior management vacancies','Technology company announces staff vacancies','Hospital advertises management vacancies']){
  assert.equal(category(title),'09000000',title);
  assert.equal(classifyNewsHeadline(title,generic),'work',title);
 }
 assert.notEqual(category('Hotel reports room vacancies'),'09000000');
 assert.equal(category('Researchers discover vacancies in a crystal lattice'),'13000000');
});


test('new shooting recognition preserves explicit warfare, fictional depictions and negation',()=>{
 for(const title of ['Un soldat a fost impuscat in razboi','Un reporter a fost impuscat in timpul unui conflict armat']){
  assert.equal(category(title),'16000000',title);
 }
 assert.equal(category('In noul film, eroul a fost impuscat'),'01000000');
 assert.equal(category('Un actor a fost impuscat pe platoul de filmare'),'02000000');
 assert.equal(category('Un barbat nu a fost impuscat'),null);
 assert.equal(category('生成aiの新製品','https://www.bbc.com/japanese/articles/reported-story'),'13000000');
});

test('Romanian era wording is not weather and cannot revive a stale discovery hint',()=>{
 // This title, URL and section were observed in the public reader on 2026-11-24.
 const sourceUrl='https://www.descopera.ro/istorie/21160837-un-lant-muntos-din-vremea-gondwanei-se-ascunde-sub-gheata-din-antarctica';
 const title='Un lanț muntos din vremea Gondwanei se ascunde sub gheața din Antarctica';
 const articleSubject={basis:'publisher-jsonld',sections:['Istorie'],keywords:[],articleUrl:sourceUrl};
 for(const sourceIds of [['news-unclassified'],['news-weather']]){
  const card=sourceCard(title,sourceUrl,{sourceIds,topic:'weather',articleSubject}),before=JSON.stringify(card);
  assert.equal(classifyNewsSubject(title,sourceUrl),null);
  assert.equal(classifyEvidenceCard(card),null,'unsupported Istorie does not supply a forced quota category');
  assert.equal(JSON.stringify(card),before,'original metadata is not rewritten');
 }
 for(const headline of ['Obiecte din vremea romanilor au fost gasite','O amintire DIN VREMEA copilariei','Un obiect din   vremea bunicilor']){
  assert.equal(category(headline),null,headline);
  assert.equal(classifyEvidenceCard(sourceCard(headline,generic,{sourceIds:['news-weather'],topic:'weather'})),null,headline);
 }
});

test('genuine weather wording and explicit source evidence survive Romanian era masking',()=>{
 for(const headline of ['Vremea se schimba maine','Pe vremea rea se circula greu','In vremea rece drumurile raman alunecoase',
  'În vremea rece drumurile rămân alunecoase','Prognoza meteo anunta temperaturi scazute',
  'Cum era clima din vremea romanilor: meteorologii publica o analiza']){
  assert.equal(category(headline),'17000000',headline);
 }
 const title='O inregistrare din vremea bunicilor',sourceUrl='https://www.theguardian.com/weather/2026/nov/24/reported-story';
 const section=classifyNewsSubject(title,sourceUrl);assert.equal(section?.category,'17000000');assert.equal(section?.basis,'publisher-section');
 const bound=sourceCard(title,generic,{articleSubject:{basis:'publisher-jsonld',sections:['Weather'],keywords:[],articleUrl:generic}});
 assert.equal(classifyEvidenceCard(bound)?.category,'17000000');assert.equal(classifyEvidenceCard(bound)?.basis,'publisher-metadata');
});
