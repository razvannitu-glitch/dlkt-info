import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as typed from '../.build/src/iceo/news-taxonomy.js';
import * as browser from '../public/news-taxonomy.js';

const evidence=JSON.parse(readFileSync(new URL('./fixtures/news-context-originals.json',import.meta.url),'utf8'));
const expected=new Map([['81a33e91794b623ec97f3e43','07000000'],['dae3c109c29e1711fad9fccd','16000000'],['e34754229ca99fa494a1650a','10000000']]);
const modules=[typed,browser],url='https://www.bbc.com/news/articles/controlled-subject';
const card=(title,sourceIds=['news-unclassified'])=>({title,sourceUrl:url,sourceIds,topic:'other'});
const category=(api,title,sourceUrl=url)=>api.classifyNewsSubject(title,sourceUrl)?.category??null;

for(const original of evidence.originals)test('observed original uses its reported subject: '+original.publisher,()=>{
 for(const api of modules){
  const before=JSON.stringify(original),classification=api.classifyEvidenceCard(original);
  assert.equal(classification?.category,expected.get(original.id));assert.equal(classification?.basis,'headline');
  assert.equal(JSON.stringify(original),before,'title, URL, publication/check times, source IDs, original topic and hash stay unchanged');
 }
});

test('a game launch can contain a fictional theft title without becoming crime reporting',()=>{
 for(const api of modules)for(const title of ['Silver Theft Moon II launches on Xbox','New Nintendo trailer reveals Midnight Theft Runner 3','Video game Crystal Theft Quest IV gets a release date']){
  assert.equal(category(api,title),'10000000',title);
 }
});

test('independent criminal evidence and real theft syntax survive game launch context',()=>{
 const titles=['Police investigate theft during PlayStation launch','Theft of video games disrupts a Nintendo launch','Thefts rise after a PlayStation launch',
  'Player arrested during Grand Theft Auto VI launch','Lawsuit over Grand Theft Auto VI launch reaches court',
  'Theft delays a video game launch','Car theft remains a problem during the Xbox launch','Man charged with theft during Nintendo release',
  'PlayStation launch ends in theft spree','Xbox launch marred by rampant theft','PlayStation Launch Ends In Theft Spree',
  'PlayStation Launch Sparks Identity Theft Warnings','Identity Theft Threatens PlayStation Launch'];
 for(const api of modules)for(const title of titles)assert.equal(category(api,title),'02000000',title);
});

test('financial results and real accidents retain priority over game product context',()=>{
 for(const api of modules){
  assert.equal(category(api,'Grand Theft Auto VI launch on PlayStation drives quarterly earnings'),'04000000');
  assert.equal(category(api,'Train crash disrupts the PlayStation game launch'),'03000000');
  assert.equal(category(api,'Theft reported at a city store'),'02000000');
 }
});

test('figurative demand waves stay medical with explicit care context and quote variants',()=>{
 for(const api of modules)for(const title of ['GP surgery faces a tsunami of demand','General practice surgery faces a “tsunami” of requests',
  'General practitioners halt appointments after a tsunami of calls','Hospital appointments delayed by a tsunami of paperwork']){
  assert.equal(category(api,title),'07000000',title);
 }
});

test('a literal tsunami and an independent second hazard are still disasters',()=>{
 for(const api of modules)for(const title of ['Tsunami hits a GP surgery','GP surgery closes after tsunami warning',
  'A tsunami of water destroys a hospital','GP surgery faces a tsunami of demand after an earthquake',
  'Tsunami hits coast while hospitals report a tsunami of calls']){
  assert.equal(category(api,title),'03000000',title);
 }
});

test('a figurative tsunami does not revive a stale weather discovery hint without a real subject',()=>{
 for(const api of modules){
  assert.equal(category(api,'A tsunami of requests arrives'),null);
  assert.equal(api.classifyEvidenceCard(card('A tsunami of requests arrives',['news-weather'])),null);
  assert.equal(api.classifyEvidenceCard(card('GP surgery faces a tsunami of demand',['news-weather']))?.category,'07000000');
 }
});

test('warfare disrupting humanitarian supplies is war coverage, including plural wars',()=>{
 for(const api of modules)for(const title of ['Wars disrupt food supplies and threaten humanitarian aid','War blocks aid routes to refugees',
  'Food shipments halted as wars threaten civilian relief','War has left civilians displaced']){
  assert.equal(category(api,title),'16000000',title);
 }
});

test('trade, price, console and fictional wars do not become armed conflict from aid vocabulary',()=>{
 for(const api of modules)for(const title of ['Trade wars threaten food aid routes','Price wars disrupt food supplies',
  'Console wars threaten a video game aid campaign','A film about wars blocking food aid premieres',
  'War on poverty disrupts aid delivery','Brand wars threaten a humanitarian fundraising campaign']){
  assert.notEqual(category(api,title),'16000000',title);
 }
});

test('food, fundraising and relief without explicit warfare do not gain a war category',()=>{
 for(const api of modules){
  for(const title of ['Food recipes for winter','Chefs launch a food festival','WFP warns food aid is threatened by funding cuts',
   'A charity campaign raises funds for food relief'])assert.notEqual(category(api,title),'16000000',title);
  assert.equal(category(api,'Food recipes for winter'),'10000000');
 }
});

test('precise publisher sections and correctly bound metadata retain priority',()=>{
 for(const api of modules)for(const original of evidence.originals){
  const section=api.classifyNewsSubject(original.title,'https://www.bbc.com/business/reported-story');
  assert.equal(section?.category,'04000000');assert.equal(section?.basis,'publisher-section');
  const provided={...original,articleSubject:{basis:'publisher-jsonld',articleUrl:original.sourceUrl,sections:['Education'],keywords:['food']}};
  const before=JSON.stringify(provided),classification=api.classifyEvidenceCard(provided);
  assert.equal(classification?.category,'05000000');assert.equal(classification?.basis,'publisher-metadata');assert.equal(JSON.stringify(provided),before);
  const unbound={...provided,articleSubject:{...provided.articleSubject,articleUrl:'https://www.bbc.com/news/articles/unrelated'}};
  assert.equal(api.classifyEvidenceCard(unbound)?.category,expected.get(original.id));
 }
});
