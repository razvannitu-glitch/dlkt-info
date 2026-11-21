import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {photoFor,displayPhotoFor,contextPhotoFor,contextPhotoSubject,usableContextPhoto} from '../.build/src/media/catalog.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
const pinned=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'));
const now=Math.max(...CONTEXT_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)),...REVIEWED_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;

test('a broad topic or feed never manufactures a subject for an unknown article',()=>{
 for(const topic of PUBLIC_TOPICS){const card={...pinned[0],id:'f'.repeat(24),contentHash:'e'.repeat(64),title:'A current publisher development',sourceUrl:'https://example.test/articles/unspecified',topic,sourceIds:['news-'+topic]},before=JSON.stringify(card);
  assert.equal(contextPhotoSubject(card),null,topic);assert.equal(displayPhotoFor(card,now),null,topic);assert.equal(JSON.stringify(card),before);
 }
 for(const sourceId of ['news-family','news-education','news-culture','news-gaming'])assert.equal(contextPhotoFor({title:'A new development',sourceIds:[sourceId]},now),null);
});
test('exact article pins retain priority and changed revisions never borrow an unrelated photograph',()=>{
 assert.equal(REVIEWED_PHOTOS.length,3);
 for(const card of pinned){assert.equal(displayPhotoFor(card,now),photoFor(card,now));
  const changed={...card,title:card.title+' Updated',contentHash:'b'.repeat(64)};
  assert.equal(photoFor(changed,now),null);const contextual=displayPhotoFor(changed,now);
  if(contextual){assert.equal(contextual.kind,'context');assert.equal(contextual.subject,contextPhotoSubject(changed));assert.notEqual(contextual.path,photoFor(card,now).path);}
  else assert.equal(contextPhotoFor(changed,now),null);
 }
});
test('specific headlines and public article paths select the matching subject rather than a broad topic',()=>{
 const cases=[
  [{title:'Show jumping championship opens',topic:'culture'},'equestrian'],
  [{title:'New processor promises more horsepower',topic:'technology'},'technology'],
  [{title:'Live music concert tonight',topic:'public-affairs'},'music'],
  [{title:'Football match announced',topic:'world'},'football'],
  [{title:'Road closures during bridge repairs',topic:'travel'},'roadworks'],
  [{title:'Parents and children return to the park',topic:'public-affairs'},'family'],
  [{title:'First aid training for volunteers',topic:'business'},'health'],
  [{title:'Scholarships for university students',topic:'business'},'education'],
  [{title:'Enterprise adoption rises',topic:'business'},'business'],
  [{title:'T20 World Cup campaign begins',topic:'sport'},'cricket'],
  [{title:'IPL final set for Sunday',topic:'sport'},'cricket'],
  [{title:'Indian Premier League schedule announced',topic:'sport'},'cricket'],
  [{title:'England beat Australia in series opener',sourceUrl:'https://www.bbc.com/sport/cricket/articles/example',topic:'sport'},'cricket'],
  [{title:'ATP finals draw announced',topic:'sport'},'tennis'],
  [{title:'A late comeback seals the match',sourceUrl:'https://example.test/sport/tennis/match-report',topic:'sport'},'tennis'],
  [{title:'NBA announces new season schedule',topic:'sport'},'basketball'],
  [{title:'Rugby World Cup fixtures announced',topic:'world'},'rugby'],
  [{title:'A new museum opens an exhibition',topic:'culture'},'art'],
  [{title:'New apartments planned for the city',topic:'housing'},'housing'],
  [{title:'New homes approved in Hetton, Sunderland',topic:'housing'},'uk-housing'],
  [{title:'Apartment prices increase in Bucharest',topic:'housing'},'ro-housing'],
  [{title:'Film festival announces new releases',topic:'culture'},'cinema'],
  [{title:'GTA 6 release date announced',topic:'technology'},'gaming'],
  [{title:'Solar panels supply a new power station',topic:'energy'},'energy'],
  [{title:'Eurozone inflation slows as savings rates fall',topic:'money'},'money'],
  [{title:'Governing Council changes interest rates',sourceUrl:'https://www.ecb.europa.eu/press/example',topic:'money'},'money'],
  [{title:'UK inflation slows again',topic:'money'},'uk-economy'],
  [{title:'Xi and Putin discuss bilateral trade',topic:'world'},'china-russia'],
  [{title:'Xi Jinping and Vladimir Putin discuss bilateral trade',topic:'world'},'china-russia'],
  [{title:'United Nations opens a new session',topic:'world'},'diplomacy'],
  [{title:'UN Security Council considers a resolution',topic:'world'},'diplomacy'],
  [{title:'UK government announces new policy',topic:'world'},'uk-politics'],
  [{title:'Minister sets out the next policy changes',sourceUrl:'https://www.theguardian.com/politics/2026/nov/21/example'},'uk-politics'],
  [{title:'European Commission presents its new agenda',topic:'world'},'eu-politics'],
  [{title:'EU negotiators reach an agreement',topic:'world'},'eu-politics'],
  [{title:'Ed Miliband: EU deal not dependent on tuition fees agreement',sourceUrl:'https://www.bbc.com/news/articles/cm9w9p4geke8o',topic:'work-education'},'eu-politics'],
  [{title:'Parent company announces an IPO',topic:'business'},'business'],
  [{title:'White House presents the federal budget',topic:'world'},'us-politics'],
  [{title:'US Congress debates the federal budget',topic:'world'},'us-politics'],
  [{title:'ATP synthesis in the laboratory',topic:'science'},'science'],
 ];
 for(const [input,expected]of cases){
  assert.equal(contextPhotoSubject(input),expected,JSON.stringify(input));
  const photo=contextPhotoFor(input,now),eligible=CONTEXT_PHOTOS.filter(item=>item.subject===expected&&usableContextPhoto(item,now));
  if(eligible.length){assert.ok(photo,expected);assert.equal(photo.subject,expected);assert.ok(eligible.includes(photo));assert.match(photo.path,/^\/card-media\/[a-f0-9]{16}\.jpg$/u);assert.match(photo.caption,/^Context photo: /u);assert.match(photo.changeNote,/Not the reported event/u);assert.ok(photo.credit);}
  else assert.equal(photo,null,expected+' has no reviewed matching asset');
 }
});
test('country conflicts and ambiguous city names never select a country-specific building or currency',()=>{
 for(const title of [
  'Housing prices rise in London, Ontario, Canada',
  'Housing prices rise in London',
  'Romanian apartment prices rise in Bucharest as UK investors return',
  'UK housing prices compared with Canadian housing prices',
  'Housing prices increase in China and Russia',
 ]){
  const input={title,topic:'housing'};assert.equal(contextPhotoSubject(input),'housing',title);assert.equal(contextPhotoFor(input,now),null,title);
 }
 for(const input of [
  {title:'UK investors watch inflation fall in India',topic:'money'},
  {title:'UK investors watch US inflation fall',topic:'money'},
  {title:'Canadian economy improves as UK investors return',topic:'money'},
  {title:'Inflation in Romania falls below UK levels',topic:'money'},
  {title:'Canada inflation slows',sourceUrl:'https://example.test/news/uk/financial-report',topic:'money'},
 ]){assert.notEqual(contextPhotoSubject(input),'uk-economy',input.title);assert.equal(contextPhotoFor(input,now),null,input.title);}
 assert.equal(contextPhotoSubject({title:'China and Russia launch a university student exchange'}),'education');
 assert.equal(contextPhotoSubject({title:'China and Russia announce bilateral talks'}),null);
});
test('metaphors, military reports, crime and unrelated currencies do not inherit decorative topic photos',()=>{
 const cases=[
  {title:'A fair-weather friend leaves the alliance',topic:'weather'},
  {title:'A fair–weather friend leaves the alliance',topic:'world'},
  {title:'Political storm over a new proposal',topic:'weather'},
  {title:'A new policy becomes a political football',topic:'sport'},
  {title:'A dark horse emerges in the leadership race',topic:'sport'},
  {title:'Military leaders consider their next move',topic:'other'},
  {title:'Soldiers return to the military school',topic:'work-education'},
  {title:'Music producer faces criminal charges',topic:'culture',sourceUrl:'https://example.test/music/producer-report'},
  {title:'Singer arrested after police investigation',topic:'culture'},
  {title:'Singer goes on trial over abuse allegations',topic:'culture'},
  {title:'Teacher appears in court over abuse allegations',topic:'work-education'},
  {title:'Parents charged with fraud',topic:'public-affairs',sourceIds:['news-family']},
  {title:'India pensions update',topic:'money'},
  {title:'New solar eclipse observations',topic:'science'},
  {title:'Wind farms expand electricity generation',topic:'energy'},
  {title:'Trump holds a summit',topic:'world'},
  {title:'US local update',topic:'world'},
  {title:'European destinations announce local changes',topic:'world'},
  {title:'Xi welcomes a new trade agreement',topic:'world'},
  {title:'New Nintendo video games announced',topic:'technology'},
  {title:'Xbox gaming hardware update',topic:'technology'},
  {title:'Casino gaming expands',topic:'business'},
  {title:'Inflation falls in India',sourceUrl:'https://www.bbc.co.uk/news/articles/example',topic:'money'},
  {title:'Unknown update',sourceUrl:'javascript:https://example.test/sport/football'},
  {title:'Unknown update',sourceUrl:'https://example.test/articles/update?subject=football#tennis'},
 ];
 for(const input of cases){assert.equal(contextPhotoSubject(input),null,JSON.stringify(input));assert.equal(contextPhotoFor(input,now),null,JSON.stringify(input));}
 assert.equal(contextPhotoSubject({title:'Football championship opens',sourceUrl:'https://example.test/sport/cricket/story'}),'cricket');
 assert.equal(contextPhotoFor({title:'Cricket championship opens'},now,CONTEXT_PHOTOS.filter(photo=>photo.subject!=='cricket')),null);
});
test('multiple matching photos vary deterministically by public article identity across saved and shared views',()=>{
 const photos=CONTEXT_PHOTOS.filter(photo=>photo.subject==='cricket'&&usableContextPhoto(photo,now));
 assert.ok(photos.length>=2,'two independently reviewed cricket photographs are required for this variation test');
 const seen=new Set();
 for(let index=0;index<64;index++){
  const input=Object.freeze({title:'Cricket match '+index,sourceUrl:'https://example.test/sport/cricket/match-'+index}),before=JSON.stringify(input);
  const first=contextPhotoFor(input,now,photos);assert.ok(first);seen.add(first.path);
  assert.equal(contextPhotoFor(input,now,[...photos].reverse())?.key,first.key);
  assert.equal(contextPhotoFor({...input,title:'Updated cricket match headline',sourceUrl:input.sourceUrl+'/?utm_source=shared#saved'},now,photos)?.key,first.key);
  assert.equal(contextPhotoFor({...input,sourceUrl:input.sourceUrl.replace('example.test','EXAMPLE.TEST')},now,photos)?.key,first.key);
  assert.equal(contextPhotoFor({...input,topic:'world',sourceIds:['news-world']},now,[...CONTEXT_PHOTOS.filter(photo=>photo.subject!=='cricket'),...photos])?.key,first.key);
  assert.equal(JSON.stringify(input),before);
 }
 assert.ok(seen.size>=2,'fixed article fixtures exercise more than one matching photograph');
 const titleOnly={title:'  Cricket   match report  '};
 assert.equal(contextPhotoFor(titleOnly,now,photos)?.key,contextPhotoFor({title:'cricket match report'},now,photos)?.key);
 const healthy=photos[0],expired={...photos[1],reviewBy:new Date(now-1).toISOString()};
 assert.equal(contextPhotoFor({title:'Cricket match report'},now,[healthy,expired])?.key,healthy.key);
 assert.equal(contextPhotoFor({title:'Cricket match report'},now,[expired]),null);
 assert.equal(contextPhotoFor({title:'Cricket match report'},NaN,photos),null);
});
test('local presentation input needs no fabricated ID, publisher, content hash or source date',()=>{
 const input=Object.freeze({title:'Roadworks on the main street',topic:'housing'});assert.equal(contextPhotoFor(input,now).subject,'roadworks');
 assert.equal(contextPhotoFor({title:'A public update'},now),null);
});
test('context license and URL validation reject remote injection and restricted or contradictory rights',()=>{
 const photo=CONTEXT_PHOTOS[0];
 for(const patch of [{assetUrl:'https://evil.example/photo.jpg'},{creditUrl:'javascript:alert(1)'},{creditUrl:'https://commons.wikimedia.org.evil.test/wiki/File:photo.jpg'},
  {path:'//elsewhere.example/photo.jpg'},{license:'CC BY-NC 4.0',licenseUrl:'https://creativecommons.org/licenses/by-nc/4.0/'},{licenseUrl:'https://creativecommons.org/licenses/by/3.0/'},
  {caption:'This is the reported event'},{alt:'The current event'},{credit:''},{sha256:'f'},{bytes:420001},{reviewBy:'invalid'}])assert.equal(usableContextPhoto({...photo,...patch},now),false,JSON.stringify(patch));
 assert.equal(usableContextPhoto(photo,Date.parse(photo.reviewBy)+1),false);assert.equal(usableContextPhoto(photo,NaN),false);
});
function jpegSize(bytes){let offset=2;while(offset<bytes.length){assert.equal(bytes[offset],255);while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;
  const length=bytes.readUInt16BE(offset);if([0xc0,0xc1,0xc2].includes(marker))return{width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};offset+=length;
 }throw Error('JPEG_DIMENSIONS_MISSING');}
test('all individually reviewed context files are complete JPEG photographs with pinned bytes and real dimensions',()=>{
 assert.ok(CONTEXT_PHOTOS.length>=14);assert.equal(new Set(CONTEXT_PHOTOS.map(p=>p.key)).size,CONTEXT_PHOTOS.length);
 assert.equal(new Set(CONTEXT_PHOTOS.map(p=>p.sha256)).size,CONTEXT_PHOTOS.length);
 for(const photo of CONTEXT_PHOTOS){assert.ok(usableContextPhoto(photo,now),photo.key);const bytes=readFileSync('public'+photo.path);
  assert.deepEqual([...bytes.subarray(0,3)],[255,216,255]);assert.equal(bytes.length,photo.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),photo.sha256);
  assert.deepEqual(jpegSize(bytes),{width:photo.width,height:photo.height});assert.equal(photo.fit,'contain');
 }
});
test('presentation still makes no client-side article scrape or remote image request',()=>{
 const browser=readFileSync('src/media/browser.ts','utf8');assert.doesNotMatch(browser,/innerHTML|fetch\(|document\.cookie|localStorage/u);
 assert.match(browser,/image\.src=p\.path/u);assert.match(browser,/photoKind/u);assert.match(browser,/addEventListener\('error'/u);
});
test('explicit rights-holder attribution accompanies the creator when the Commons record requires it',()=>{
 const horse=CONTEXT_PHOTOS.find(p=>p.subject==='equestrian'),family=CONTEXT_PHOTOS.find(p=>p.subject==='family');
 assert.match(horse.credit,/Tara Moradi.*Mehr News Agency/u);assert.match(family.credit,/Xavier Lejeune.*© European Union, 2026/u);
 assert.equal(usableContextPhoto({...horse,credit:'Tara Moradi'},now),false);assert.equal(usableContextPhoto({...family,credit:'Xavier Lejeune'},now),false);
});
