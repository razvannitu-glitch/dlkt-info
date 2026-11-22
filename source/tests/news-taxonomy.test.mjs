import test from 'node:test';
import assert from 'node:assert/strict';
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
