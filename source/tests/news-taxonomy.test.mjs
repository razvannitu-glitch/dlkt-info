import test from 'node:test';
import assert from 'node:assert/strict';
import {selectNewsStream} from '../.build/src/iceo/news-stream.js';
import {readingCard} from '../.build/src/iceo/reader.js';
import {classifyNewsHeadline,classifyEditorialCard,contradictedHeadlineHints} from '../.build/src/iceo/editorial-categories.js';
import {NEWS_CATEGORIES,NEWS_TAXONOMY_VERSION,isNewsCategoryId,newsCategoryLabel,legacyCategoryToNewsCategory,classifyNewsSubject,classifyEvidenceCard,classifyLocalCard,newsCategory} from '../.build/src/iceo/news-taxonomy.js';

const evidence=(title,overrides={})=>({title,sourceUrl:'https://www.theguardian.com/world/2026/nov/22/reported-story',sourceIds:['news-unclassified'],topic:'other',...overrides});
const local=(title,overrides={})=>({
 kind:'local-news',title,sourceUrl:'https://buletin.de/bucuresti/reported-story/',
 news:{title,url:'https://buletin.de/bucuresti/reported-story/',topic:'city',summary:'Context mentions a school, education and the city.'},
 ...overrides,
});
const category=(title,url)=>classifyNewsSubject(title,url??'https://www.theguardian.com/world/2026/nov/22/reported-story')?.category??null;

test('catalog preserves exactly the 17 IPTC top-level concepts and canonical identifiers',()=>{
 const expected=Array.from({length:17},(_,i)=>String(i+1).padStart(2,'0')+'000000');
 assert.deepEqual(NEWS_CATEGORIES.map(item=>item.id),expected);
 assert.equal(new Set(NEWS_CATEGORIES.map(item=>item.id)).size,17);
 assert.equal(NEWS_CATEGORIES.find(item=>item.id==='04000000').iptcLabel,'economy, business and finance');
 assert.equal(NEWS_CATEGORIES.find(item=>item.id==='09000000').iptcLabel,'labor');
 assert.equal(NEWS_CATEGORIES.find(item=>item.id==='11000000').iptcLabel,'politics and government');
 for(const item of NEWS_CATEGORIES){
  assert.equal(item.qcode,'medtop:'+item.id);
  assert.equal(item.uri,'http://cv.iptc.org/newscodes/mediatopic/'+item.id);
  assert.ok(Object.isFrozen(item));assert.ok(item.label&&item.labelRo&&item.iptcLabel);
 }
 assert.ok(Object.isFrozen(NEWS_CATEGORIES));assert.match(NEWS_TAXONOMY_VERSION,/2026-10-16/);
 for(const invalid of [null,undefined,4000000,'4000000','medtop:04000000','04000001','__proto__','other'])assert.equal(isNewsCategoryId(invalid),false);
 assert.equal(isNewsCategoryId('04000000'),true);
});

test('short reader labels retain ordinary newsroom names and separate DLKT Romanian translations',()=>{
 assert.equal(newsCategoryLabel('05000000'),'Education');
 assert.equal(newsCategoryLabel('05000000','ro-RO'),'Educatie');
 assert.equal(newsCategoryLabel('07000000','ro'),'Sanatate');
 assert.equal(newsCategoryLabel('07000000','de'),'Health');
 assert.ok(NEWS_CATEGORIES.every(item=>!item.label.includes('Education & learning')&&!item.label.includes('Housing & cities')));
});

test('care delivery and medical subjects are health, including the Retail Medicine regression',()=>{
 assert.equal(category('Retail Medicine'), '07000000');
 assert.equal(category('Retail medicine improves access to patient care','https://www.thehindu.com/business/retail-medicine/article123.ece'),'07000000');
 assert.equal(classifyEvidenceCard(evidence('Retail Medicine',{sourceIds:['news-shopping'],topic:'money'})).category,'07000000');
 assert.equal(category('Spitalul din Bucuresti deschide o sectie noua'),'07000000');
 assert.equal(category('Drug company quarterly earnings rise'),'04000000');
});

test('publisher sections are exact path segments, never a city or words in an article slug',()=>{
 const classified=classifyNewsSubject('An unexpected outcome','https://www.bbc.com/sport/football/articles/abc123');
 assert.equal(classified.category,'15000000');assert.equal(classified.basis,'publisher-section');
 assert.equal(category('An unexpected outcome','https://www.theguardian.com/education/2026/nov/22/reported-story'),'05000000');
 assert.equal(category('An unexpected outcome','https://www.thehindu.com/news/cities/Delhi/reported-story/article123.ece'),null);
 assert.equal(category('An unexpected outcome','https://www.bbc.com/news/articles/education-and-housing'),null);
 assert.equal(category('An unexpected outcome','https://example.test/news/reported-story?section=health'),null);
});

test('headlines distinguish legal action, disasters, war, labour, technology and education',()=>{
 for(const [title,expected] of [
  ['Police investigate a school burglary','02000000'],
  ['Earthquake damages a university building','03000000'],
  ['Airstrikes hit a hospital','16000000'],
  ['Teachers strike over pay','09000000'],
  ['Machine learning model improves predictions','13000000'],
  ['Students receive new scholarships','05000000'],
  ['Elevii de la Liceul Tehnologic Elie Radu vor face practica','05000000'],
  ['Primaria Bucuresti anunta un nou plan urbanistic','11000000'],
  ['Locuinte sociale pentru persoane fara adapost','14000000'],
  ['Prognoza meteo: temperaturi scazute maine','17000000'],
 ])assert.equal(category(title),expected,title);
});

test('a summary mention or stale local topic cannot override the reported headline',()=>{
 const card=local('Retail Medicine');
 card.news.topic='education';
 assert.equal(classifyLocalCard(card).category,'07000000');
 const culture=local('Un concert nou la Ateneul Roman');
 culture.news.topic='education';
 assert.equal(classifyLocalCard(culture).category,'01000000');
 const unknown=local('O noua etapa pentru Bucuresti');
 unknown.news.topic='education';
 assert.equal(classifyLocalCard(unknown),null);
 assert.equal(classifyLocalCard({...unknown,news:{...unknown.news,summary:'The economy, health, school, housing and money.'}}),null);
});

test('unknown and geographic-only subjects remain unclassified without an Economy default',()=>{
 for(const overrides of [
  {sourceIds:['news-unclassified'],topic:'business'},
  {sourceIds:['news-housing'],topic:'housing'},
  {sourceIds:['news-world'],topic:'world'},
  {sourceIds:['general-feed'],topic:'business'},
 ])assert.equal(classifyEvidenceCard(evidence('A new chapter for this city',overrides)),null);
 assert.equal(classifyEvidenceCard(evidence('A new chapter',{sourceIds:['news-health'],topic:'health'})).category,'07000000');
 assert.equal(classifyEvidenceCard(evidence('A new chapter',{sourceIds:['news-health','news-culture'],topic:'health'})),null);
});

test('existing multilingual headline semantics remain available without translating article text',()=>{
 for(const [title,url,expected] of [
  ['Une etude revele de nouvelles galaxies','https://www.france24.com/fr/20261122-nouvelles-galaxies','13000000'],
  ['Forscher entdecken neue Galaxien','https://www.dw.com/de/neue-galaxien/a-12345678','13000000'],
  ['Gana la final de futbol','https://www.dw.com/es/final-del-torneo/a-12345678','15000000'],
  ['وقف إطلاق النار يدخل حيز التنفيذ','https://www.dw.com/ar/report/a-12345678','16000000'],
  ['新製品を発売するソフトウェア企業','https://www.bbc.com/japanese/articles/abc123','13000000'],
 ])assert.equal(category(title,url),expected,title);
});

test('compatibility is a pure projection; ambiguous preferences and persisted identities remain intact',()=>{
 assert.equal(legacyCategoryToNewsCategory('business'),'04000000');
 assert.equal(legacyCategoryToNewsCategory('education'),'05000000');
 assert.equal(legacyCategoryToNewsCategory('technology'),'13000000');
 assert.equal(legacyCategoryToNewsCategory('work-education'),null);
 assert.equal(legacyCategoryToNewsCategory('other'),null);
 assert.equal(legacyCategoryToNewsCategory('__proto__'),null);
 const card=evidence('Retail Medicine',{id:'record-1',identity:'same-identity',contentHash:'same-hash',sourceIds:['news-shopping'],topic:'money',summary:'Original publisher excerpt.'});
 const before=JSON.stringify(card);assert.equal(newsCategory(card),'07000000');assert.equal(JSON.stringify(card),before);
 assert.equal(newsCategory(local('Concert la Bucuresti')),'01000000');
});

test('non-news record kinds do not fabricate housing categories or affect article text',()=>{
 assert.equal(classifyLocalCard({kind:'forecast',title:'Forecast',sourceUrl:'https://api.met.no/weatherapi/locationforecast/2.0/compact'}).category,'17000000');
 assert.equal(classifyLocalCard({kind:'event',title:'Tonight at the theatre',sourceUrl:'https://arcub.ro/eveniment/tonight/'}).category,'01000000');
 assert.equal(classifyLocalCard({kind:'municipal-news',title:'A new chapter for the city',sourceUrl:'https://noticies.palma.es/-/a-new-chapter'}),null);
});

test('invalid headline or source inputs cannot supply inferred classifications',()=>{
 for(const [title,url] of [
  ['', 'https://www.bbc.com/health/article'],
  ['A'.repeat(4001),'https://www.bbc.com/health/article'],
  ['Health\u0000story','https://www.bbc.com/health/article'],
  ['Retail Medicine','http://www.bbc.com/health/article'],
  ['Retail Medicine','https://user:pass@www.bbc.com/health/article'],
  ['Retail Medicine','https://www.bbc.com:444/health/article'],
  ['Retail Medicine','not a url'],
 ])assert.equal(classifyNewsSubject(title,url),null);
});

test('identifier-style publisher URLs never turn the preceding article slug into a subject section',()=>{
 const dw='https://www.dw.com/ro/sanatate/a-12345678';
 assert.equal(classifyNewsSubject('Airstrikes hit a hospital',dw).category,'16000000');
 for(const url of [
  dw,'https://www.dw.com/en/health/a-12345678','https://dw.com/ro/health/a-12345678',
  'https://www.thehindu.com/news/health/article12345678.ece','https://thehindu.com/news/health/article12345678.ece',
  'https://www.theguardian.com/world/2026/nov/22/health',
 ])assert.equal(classifyNewsSubject('An unexpected outcome',url),null,url);
 const health=classifyNewsSubject('An unexpected outcome','https://www.thehindu.com/sci-tech/health/a-reported-story/article12345678.ece');
 assert.equal(health.category,'07000000');assert.equal(health.basis,'publisher-section');
});

test('markets, crypto, insurance and commercial sectors use economy without creating new categories',()=>{
 for(const [title,expected] of [
  ['S&P500 closes at a record high','04000000'],
  ['S & P 500 posts a weekly gain','04000000'],
  ['Nasdaq rises as Bitcoin drops','04000000'],
  ['Ethereum and cryptocurrency trading accelerate','04000000'],
  ['Criptomonedele cresc la Bursa de valori','04000000'],
  ['Insurance premiums rise for motorists','04000000'],
  ['Asiguratorii prezinta noi polite de asigurari','04000000'],
  ['Manufacturing output expands across the region','04000000'],
  ['Automotive industry opens a new factory','04000000'],
  ['Freight operators expand logistics capacity','04000000'],
  ['Oportunitati de afaceri pentru firmele mici','04000000'],
  ['Startup funding creates new business opportunities','04000000'],
  ['Health insurance expands access to treatment','07000000'],
  ['Health insurance company quarterly earnings rise','04000000'],
  ['Students receive a new scholarship','05000000'],
 ])assert.equal(category(title),expected,title);
});

test('Hollywood personal stories, entertainment, employment and development retain distinct subjects',()=>{
 for(const [title,expected] of [
  ['Hollywood gossip focuses on a celebrity wedding','08000000'],
  ['Actorii anunta o nunta dupa logodna','08000000'],
  ['Hollywood prepares a new film premiere','01000000'],
  ['Entertainment festival announces its programme','01000000'],
  ['Software companies announce layoffs','09000000'],
  ['Workers strike at a crypto exchange over wages','09000000'],
  ['Crypto company announces layoffs','09000000'],
  ['Hiring rises for information technology specialists','09000000'],
  ['Companiile anunta locuri de munca si posturi vacante','09000000'],
  ['JavaScript introduces a new web development tool','13000000'],
  ['Limbaje de programare pentru dezvoltare web','13000000'],
  ['Cybersecurity researchers publish a new defence','13000000'],
 ])assert.equal(category(title),expected,title);
});

test('leisure, pets, nature, science and transport incidents use the reported subject',()=>{
 for(const [title,expected] of [
  ['Gardening tips for a weekend hobby','10000000'],
  ['Gradinarit si ingrijirea plantelor in gradina','10000000'],
  ['Birdwatching becomes a popular hobby','10000000'],
  ['Pet care and dog training improve daily routines','06000000'],
  ['Pet care becomes a weekend hobby','10000000'],
  ['Animale de companie: ingrijirea cainilor','06000000'],
  ['Veterinary treatment protects pets','07000000'],
  ['Wildlife conservation protects endangered species','06000000'],
  ['Conservarea naturii protejeaza specii pe cale de disparitie','06000000'],
  ['Cercetatori descopera noi galaxii in cosmos','13000000'],
  ['New telescope observes a distant exoplanet','13000000'],
  ['Vacante in noi destinatii turistice','10000000'],
  ['Classic cars attract car enthusiasts','10000000'],
  ['Motorcycle review explores a new touring model','10000000'],
  ['MotoGP championship announces the final result','15000000'],
  ['Football club wins the championship','15000000'],
  ['Car crash closes a busy road','03000000'],
  ['Train derailment disrupts freight services','03000000'],
  ['Coliziune rutiera: accidentul rutier blocheaza traficul','03000000'],
  ['Police investigate a robbery','02000000'],
  ['Bitcoin crash sparks investor concern','04000000'],
  ['Software crash prompts an urgent update','13000000'],
 ])assert.equal(category(title),expected,title);
});

test('adult-sector reporting distinguishes business, government regulation and court action',()=>{
 for(const [title,expected] of [
  ['Adult entertainment industry expands internationally','04000000'],
  ['Porn industry reports commercial expansion','04000000'],
  ['Pornography industry faces new regulations','11000000'],
  ['Noi reglementari pentru industria pornografica','11000000'],
  ['Adult-content platforms announce new business models','04000000'],
  ['Industria pentru adulti prezinta noi rezultate financiare','04000000'],
  ['Regulators introduce new laws for adult websites','11000000'],
  ['Noi reglementari pentru industria pentru adulti','11000000'],
  ['Court rules on adult industry licensing','02000000'],
  ['Adult entertainment companies announce layoffs','09000000'],
  ['Adult education opens new courses','05000000'],
  ['Entertainment festival opens to adults','01000000'],
 ])assert.equal(category(title),expected,title);
});

test('new section hints remain exact subject segments and do not classify words in a final article slug',()=>{
 for(const [section,expected] of [
  ['crypto','04000000'],['insurance','04000000'],['jobs','09000000'],['gossip','08000000'],
  ['gardening','10000000'],['pets','06000000'],['software-development','13000000'],['motogp','15000000'],
 ]){
  const sourceUrl='https://www.theguardian.com/'+section+'/2026/nov/22/reported-story';
  const classified=classifyNewsSubject('An unexpected outcome',sourceUrl);
  assert.equal(classified?.category,expected,section);assert.equal(classified?.basis,'publisher-section');
  assert.equal(category('An unexpected outcome','https://www.theguardian.com/world/2026/nov/22/'+section),null,section+' slug');
  assert.equal(category('An unexpected outcome','https://www.dw.com/ro/'+section+'/a-12345678'),null,section+' DW slug');
 }
 assert.equal(category('An unexpected outcome','https://www.theguardian.com/development/reported-story'),null,'development alone is not software evidence');
});

test('unknown original news stays available in Other topics with all source fields intact',()=>{
 const now=Date.parse('2026-11-22T12:00:00.000Z');
 const original=Object.freeze(evidence('An unexpected outcome',{
  id:'1'.repeat(24),identity:'controlled:unknown-news',kind:'publication',date:new Date(now-1000).toISOString(),dateLabel:'Published',
  observedAt:new Date(now).toISOString(),contentHash:'2'.repeat(64),publisher:'The Guardian',sourceState:'verified',
  boundary:'Controlled original news fixture.',attribution:'Source: The Guardian.',deadline:null,version:null,
 }));
 const before=JSON.stringify(original),view={...readingCard(original,now),reason:'Controlled source.',localMatch:false,grouping:'single'};
 assert.equal(newsCategory(original),null);
 const stream=selectNewsStream({first:[view],more:[]},[],now,'other');
 assert.equal(stream.total,1);assert.equal(stream.filtered.length,1);assert.equal(stream.counts.other,1);
 assert.strictEqual(stream.filtered[0].view.card,original);assert.equal(JSON.stringify(original),before);
});

test('West Bank is geographic text, not a banking subject or a reusable legacy business hint',()=>{
 const title='Israel investigates West Bank fires',sourceUrl='https://www.france24.com/en/live-news/controlled-report';
 assert.equal(classifyNewsHeadline(title,sourceUrl),null);
 assert.equal(classifyNewsSubject(title,sourceUrl),null,'place alone must not imply economy or conflict');
 const original=Object.freeze(evidence(title,{sourceUrl,sourceIds:['news-business'],topic:'business',id:'controlled-west-bank',contentHash:'unchanged-hash'}));
 const before=JSON.stringify(original);
 assert.equal(classifyEditorialCard(original),null);assert.equal(classifyEvidenceCard(original),null);
 assert.equal(JSON.stringify(original),before,'classification never rewrites the original record');
 for(const headline of [
  'Bank of England keeps interest rates unchanged',
  'A bank opens branches in the West Bank',
  'West Bank economy expands',
  'Israel investigates West Bank fires as bank shares fall',
 ]){
  assert.equal(classifyNewsHeadline(headline,sourceUrl),'business',headline);
  assert.equal(classifyEvidenceCard(evidence(headline,{sourceUrl,sourceIds:['news-business'],topic:'business'}))?.category,'04000000',headline);
 }
 const section=classifyNewsSubject(title,'https://www.theguardian.com/business/2026/nov/22/controlled-report');
 assert.equal(section?.category,'04000000');assert.equal(section?.basis,'publisher-section','an explicit publisher business section remains independent evidence');
});

test('explicit Romanian prime-minister headlines classify as politics without a generic premier or company-president rule',()=>{
 const title='Fiul fostului președinte din Republika Srpska, propus pentru funcția de prim-ministru. Este cel mai tânăr premier desemnat din istoria țării - HotNews.ro';
 const original=Object.freeze(evidence(title,{sourceUrl:'https://hotnews.ro/controlled-report',sourceIds:['news-unclassified'],topic:'other',id:'controlled-ro-politics',contentHash:'unchanged-hash'}));
 const before=JSON.stringify(original),classified=classifyEvidenceCard(original);
 assert.equal(classified?.category,'11000000');assert.equal(classified?.basis,'headline');assert.equal(JSON.stringify(original),before);
 for(const headline of ['Prim ministrul isi prezinta echipa','Premierul desemnat isi prezinta echipa']){
  assert.equal(classifyEvidenceCard(evidence(headline,{sourceIds:['news-unclassified']}))?.category,'11000000',headline);
 }
 assert.equal(classifyEvidenceCard(evidence('Premier League announces its fixtures',{sourceIds:['news-unclassified']}))?.category,'15000000');
 assert.equal(classifyEvidenceCard(evidence('Compania si-a desemnat noul presedinte',{sourceIds:['news-unclassified']})),null);
});

test('West Bank does not erase independent economic evidence when another headline subject ranks first',()=>{
 const title='West Bank transport investment expands',sourceUrl='https://www.france24.com/en/live-news/controlled-report';
 assert.equal(classifyNewsHeadline(title,sourceUrl),'travel','existing headline subject priority stays unchanged');
 assert.equal(contradictedHeadlineHints(title.toLowerCase()).includes('business'),false,'investment independently supports the existing business hint');
 const original=Object.freeze(evidence(title,{sourceUrl,sourceIds:['news-business'],topic:'business'})),before=JSON.stringify(original);
 assert.equal(classifyEditorialCard(original)?.category,'business');assert.equal(JSON.stringify(original),before);
 assert.equal(contradictedHeadlineHints('west bank ipo announced').includes('business'),false,'explicit financial developments remain independent evidence');
});

test('West Bank preserves existing budget-cut evidence with multiple discovery hints',()=>{
 const title='West Bank budget cuts announced',sourceUrl='https://www.france24.com/en/live-news/controlled-report';
 assert.equal(classifyNewsHeadline(title,sourceUrl),'business');
 assert.equal(contradictedHeadlineHints(title.toLowerCase()).includes('business'),false);
 const original=Object.freeze(evidence(title,{sourceUrl,sourceIds:['news-business','news-travel'],topic:'business'})),before=JSON.stringify(original);
 assert.equal(classifyEditorialCard(original)?.category,'business');assert.equal(JSON.stringify(original),before);
});
