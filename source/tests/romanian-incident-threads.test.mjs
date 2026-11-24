import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as grouping from '../.build/src/iceo/story-grouping.js';
import {groupNewsStories} from '../.build/src/iceo/news-story.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
const {groupStories,storyThreadKey}=grouping;
const evidence=JSON.parse(readFileSync(new URL('./fixtures/romanian-incident-originals.json',import.meta.url),'utf8'));
const globals=evidence.records.filter(row=>row.kind==='global').map(row=>row.original);
const find=id=>globals.find(card=>card.id===id);
const fire=[find('26b96c700db696d6a95645ae'),find('1bf2f186e12f58a0edfc6eb6'),find('8474e3521967db695ddce930')];
const court=[find('998218b980c65c3cc91d5abf'),find('5f3ceca9b5f185872c85563c')];
const exit=find('e5d91e6399db1f3598eba0a7');
const originalLocal=evidence.records.find(row=>row.kind==='local');
function localItem(row=originalLocal){
 const news=structuredClone(row.original);
 return {kind:'local',key:'local:'+news.id,category:'02000000',card:{
  id:news.id,kind:'local-news',title:news.title,text:news.summary??'Read the publisher report for the complete details.',
  publisher:news.publisher,sourceUrl:news.url,sourceUpdatedAt:null,checkedAt:news.checkedAt,
  validFrom:news.checkedAt,validTo:news.validUntil,facts:[],boundary:'Controlled wrapper around observed public source fields.',
  news,
 }};
}
const globalItem=card=>({kind:'global',key:'article:'+card.id,category:null,card});
function changed(card,title,extra={}){
 const suffix=createHash('sha256').update(title+JSON.stringify(extra)).digest('hex').slice(0,12);
 return {...structuredClone(card),id:'controlled-'+suffix,identity:'https://example.org/'+suffix,sourceUrl:'https://example.org/'+suffix,title,...extra};
}
function members(groups){return groups.map(g=>({key:g.storyKey,ids:g.sources.map(s=>s.card.id).sort(),basis:g.basis})).sort((a,b)=>a.key.localeCompare(b.key));}

test('the three observed hotel fire reports share one evolving thread and preserve every original status and date',()=>{
 const before=JSON.stringify(fire),groups=groupStories(fire);
 assert.equal(groups.length,1);assert.equal(groups[0].basis,'shared-event');
 assert.equal(groups[0].related.length,2);assert.equal(groups[0].key,storyThreadKey(fire[0]));
 assert.equal(JSON.stringify(fire),before);
 assert.deepEqual(new Set([groups[0].card,...groups[0].related].map(c=>c.date)),new Set(fire.map(c=>c.date)));
 assert.notEqual(storyThreadKey(fire[1]),storyThreadKey(fire[0]),'an incomplete standalone does not invent the named hotel');
});

test('the actual local/global house-arrest ruling groups three originals while the exit reaction stays separate',()=>{
 const originals=[...court.map(globalItem),localItem(),globalItem(exit)],before=JSON.stringify(originals);
 const groups=groupNewsStories(originals);assert.equal(groups.length,2);
 const ruling=groups.find(g=>g.sources.some(s=>s.kind==='local'));
 assert.equal(ruling.sources.length,3);assert.equal(ruling.basis,'shared-event');
 assert.equal(groups.find(g=>g.primary.card.id===exit.id).sources.length,1);
 assert.equal(JSON.stringify(originals),before);
 assert.deepEqual(new Set(ruling.sources.map(s=>s.kind==='global'?s.card.date:s.card.news.publishedAt)),new Set([...court.map(c=>c.date),originalLocal.original.publishedAt]));
});

test('actor, court, hotel and place extraction is not restricted to the observed names',()=>{
 const renamedCourt=court.map(c=>changed(c,c.title.replaceAll('Călin Georgescu','Andrei Ionescu').replaceAll('București','Cluj Napoca')));
 assert.equal(groupStories(renamedCourt).length,1);
 const renamedFire=fire.map(c=>changed(c,c.title.replaceAll('Alpin','Carpatina').replaceAll('Poiana Brașov','Sinaia')));
 assert.equal(groupStories(renamedFire).length,1);
});

test('different people, courts, custody outcomes, pending actions, negation and appeal filings remain separate',()=>{
 const complete=court[1];
 const negatives=[
  complete.title.replace('Călin Georgescu','Dudu Georgescu'),complete.title.replace('București','Iași'),
  complete.title.replace('a decis','nu a decis'),complete.title.replace('a decis să înlocuiască','va decide dacă înlocuiește'),
  complete.title.replace('cu arestul la domiciliu','cu controlul judiciar'),
  'Călin Georgescu, în arest la domiciliu. Curtea de Apel București a admis contestația DIICOT',
  'Călin Georgescu, în arest la domiciliu. Curtea de Apel București a primit o contestație nouă',
  'Curtea de Apel București a menținut arestul la domiciliu în cazul lui Călin Georgescu',
  'Călin Georgescu, în arest la domiciliu. A depus o contestație după ce Curtea de Apel București a respins contestația DIICOT',
 ];
 for(const title of negatives)assert.equal(groupStories([complete,changed(complete,title)]).length,2,title);
 assert.equal(groupStories([complete,exit]).length,2);
});

test('other hotels, places, new fires, negation and investigation or reopening phases do not merge',()=>{
 const complete=fire[2];
 const negatives=[complete.title.replace('Alpin','Carpatina'),complete.title.replace('Poiana Brașov','Sinaia'),
  complete.title.replace('Incendiu puternic','Un nou incendiu'),complete.title.replace('Incendiu puternic','Al doilea incendiu'),
  'Incendiul de la hotelul Alpin din Poiana Brașov nu a existat. Alarmă falsă',
  'Incendiu la hotelul Alpin din Poiana Brașov. Ancheta stabilește cauza',
  'Incendiu la hotelul Alpin din Poiana Brașov. Proprietarul anunță redeschiderea',
 ];
 for(const title of negatives)assert.equal(groupStories([complete,changed(complete,title)]).length,2,title);
});

test('adding a second compatible complete court or hotel leaves the incomplete report separate and complete keys stable',()=>{
 for(const [partial,complete,other]of [
  [court[0],court[1],changed(court[1],court[1].title.replace('București','Iași'))],
  [fire[1],fire[0],changed(fire[0],fire[0].title.replace('Alpin','Carpatina'))],
 ]){
  assert.equal(groupStories([partial,complete]).length,1);
  const groups=groupStories([partial,complete,other]);assert.equal(groups.length,3);
  for(const full of [complete,other])assert.equal(groups.find(g=>g.card.id===full.id).key,storyThreadKey(full));
 }
});

test('missing details never form a transitive chain and fixed windows or explicit country conflicts prevent inference',()=>{
 const otherPartial=changed(fire[1],'Incendiu puternic la hotelul din Poiana Brașov. Pompierii intervin în continuare');
 assert.equal(groupStories([fire[1],otherPartial]).length,2);
 assert.equal(groupStories([fire[0],changed(fire[1],fire[1].title,{date:'2026-11-26T10:43:18.000Z'})]).length,2);
 const country=(card,name)=>({...card,sourceIds:['gv-world'],context:contextFromPublisherCategories('gv-world',[name])});
 assert.equal(groupStories([country(fire[0],'Romania'),country(fire[1],'Moldova')]).length,2);
 assert.equal(groupStories([country(fire[0],'Romania'),fire[1]]).length,2,'unknown context does not erase a positive country boundary');
});

test('input permutations preserve global output and mixed-source membership and stable canonical keys',()=>{
 const baseline=JSON.stringify(groupStories(globals));
 for(const input of [[...globals].reverse(),[...globals.slice(2),...globals.slice(0,2)]])assert.equal(JSON.stringify(groupStories(input)),baseline);
 const originals=[...globals.map(globalItem),localItem()],expected=members(groupNewsStories(originals));
 for(const input of [[...originals].reverse(),[...originals.slice(3),...originals.slice(0,3)]])assert.deepEqual(members(groupNewsStories(input)),expected);
 assert.equal(expected.length,3);assert.equal(expected.reduce((n,g)=>n+g.ids.length,0),7);
});

test('a complete local target can resolve a partial global and a conflicting local target removes that inference',()=>{
 const partial=globalItem(court[0]),local=localItem();
 const grouped=groupNewsStories([partial,local]);assert.equal(grouped.length,1);assert.equal(grouped[0].sources.length,2);
 assert.equal(grouped[0].primary.card.id,local.card.id);assert.equal(grouped[0].sources[0].card.id,local.card.id);
 const conflicting=localItem();conflicting.card.id+='-conflict';conflicting.key='local:'+conflicting.card.id;
 conflicting.card.sourceUrl+='?controlled=other';conflicting.card.title=conflicting.card.title.replace('București','Iași');
 conflicting.card.news={...conflicting.card.news,id:conflicting.card.id,url:conflicting.card.sourceUrl,title:conflicting.card.title,geoAnchors:['Iași']};
 assert.equal(groupNewsStories([partial,local,conflicting]).length,3);
 assert.deepEqual(members(groupNewsStories([conflicting,partial,local])),members(groupNewsStories([partial,local,conflicting])));
});

test('a complete printed identity represents a resolved group even when an incomplete original ranks first',()=>{
 for(const [partial,complete]of [[court[0],court[1]],[fire[1],fire[0]]]){
  const input=[partial,complete],groups=groupStories(input,(a,b)=>input.indexOf(a)-input.indexOf(b));
  assert.equal(groups.length,1);assert.equal(groups[0].card.id,complete.id);assert.equal(groups[0].related[0].id,partial.id);
  const another=changed(complete,complete.title.replace('București','Iași').replace('Alpin','Carpatina'));
  const next=groupStories([partial,another],()=>0);assert.equal(next.length,1);assert.equal(next[0].card.id,another.id);
  assert.notEqual(next[0].key,groups[0].key);
 }
});

test('a promoted local primary retains global-member eligibility for another compatible local original',()=>{
 const partial=globalItem(court[0]),first=localItem(),second=localItem();
 second.card.id+='-another-publisher';second.key='local:'+second.card.id;second.card.sourceUrl+='?controlled=another-publisher';
 second.card.news={...second.card.news,id:second.card.id,url:second.card.sourceUrl};
 const groups=groupNewsStories([partial,first,second]);
 assert.equal(groups.length,1);assert.equal(groups[0].sources.length,3);assert.equal(groups[0].primary.kind,'local');
 assert.equal(groups[0].sources[0].card.id,groups[0].primary.card.id);
 assert.deepEqual(members(groupNewsStories([second,partial,first])),members(groups));
});

test('non-publication records cannot enter an incident through external context key collisions',()=>{
 const nonPublication=changed(court[1],court[1].title,{kind:'legal-document'});
 const context={recordKey:'global:'+nonPublication.id,title:nonPublication.title,date:nonPublication.date,countries:''};
 assert.equal(groupStories([court[1],nonPublication],undefined,[context]).length,2);
 assert.equal(groupStories([nonPublication]).length,1);assert.equal(storyThreadKey(nonPublication),null);
});

test('local geography and existing conflicting-id and URL exclusion remain effective',()=>{
 const local=localItem();local.card.news.geoAnchors=['Constanța'];
 assert.equal(groupNewsStories([globalItem(court[1]),local]).length,2);
 const conflicting=changed(court[1],court[1].title+' Conflict',{id:court[1].id,identity:court[1].identity,sourceUrl:court[1].sourceUrl,contentHash:'0'.repeat(64)});
 const feedCopy=localItem();feedCopy.card.sourceUrl=court[1].sourceUrl;feedCopy.card.news.url=court[1].sourceUrl;
 assert.equal(groupNewsStories([globalItem(court[1]),globalItem(conflicting),feedCopy]).length,0);
});

test('standalone local complete identity supplies the same canonical alias as a later complete global',()=>{
 const local=localItem();
 assert.equal(typeof grouping.romanianIncidentThreadKey,'function');
 const localKey=grouping.romanianIncidentThreadKey({recordKey:local.key,title:local.card.title,date:local.card.news.publishedAt,countries:''});
 assert.equal(localKey,storyThreadKey(court[1]));
 assert.equal(grouping.romanianIncidentThreadKey(grouping.romanianIncidentRecord(court[0])),null);
 assert.equal(groupNewsStories([local])[0].storyKey,groupNewsStories([globalItem(court[1])])[0].storyKey);
});

test('ambiguous, invalid and partial historical printed dates never become undated current incidents',()=>{
 for(const original of [fire[2],court[1]]){
  for(const suffix of [' — 1 octombrie 2026 si 2 noiembrie 2026',' — 31 noiembrie 2026',' — Imagini din 2025',' — 23 noiembrie 2025']){
   assert.equal(groupStories([original,changed(original,original.title+suffix)]).length,2,suffix);
  }
 }
});

test('complete local reports from different city contexts retain distinct stable presentation keys',()=>{
 const first=localItem(),second=localItem();second.card.id+='-another-city';second.key='local:'+second.card.id;
 second.card.sourceUrl+='?controlled=another-city';second.card.news={...second.card.news,id:second.card.id,url:second.card.sourceUrl,cityId:'675810'};
 const groups=groupNewsStories([first,second]);assert.equal(groups.length,2);
 assert.equal(new Set(groups.map(g=>g.storyKey)).size,2);
 assert.deepEqual(members(groupNewsStories([second,first])),members(groups));
});

test('the indexed resolver accepts the existing maximum record bound and rejects larger inputs',()=>{
 const unrelated=Array.from({length:4997},(_,i)=>changed(fire[0],'Unrelated controlled original '+i));
 const groups=groupStories([...fire,...unrelated]);assert.equal(groups.length,4998);
 assert.throws(()=>groupStories([...fire,...unrelated,exit]),/STORY_INPUT_INVALID/);
 assert.throws(()=>groupStories([...fire,...unrelated],undefined,[{recordKey:'external',title:originalLocal.original.title,date:originalLocal.original.publishedAt,countries:''}]),/STORY_INPUT_INVALID/);
});
