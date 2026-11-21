import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {photoFor,displayPhotoFor,contextPhotoFor,contextPhotoSubject,usableContextPhoto} from '../.build/src/media/catalog.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
const pinned=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'));
const now=Date.parse(CONTEXT_PHOTOS[0].reviewedAt)+1000;

test('every public topic gets locally served, attributed context without changing article evidence',()=>{
 for(const topic of PUBLIC_TOPICS){const card={...pinned[0],id:'f'.repeat(24),contentHash:'e'.repeat(64),title:'A current publisher development',topic,sourceIds:[]},before=JSON.stringify(card);
  const photo=displayPhotoFor(card,now);assert.ok(photo,topic);assert.equal(photo.kind,'context');assert.match(photo.path,/^\/card-media\/[a-f0-9]{16}\.jpg$/u);
  assert.match(photo.caption,/^Context photo: /u);assert.match(photo.changeNote,/Not the reported event/u);assert.ok(photo.credit);assert.equal(JSON.stringify(card),before);
 }
});
test('existing exact article pins retain priority and changed revisions only receive context',()=>{
 assert.equal(REVIEWED_PHOTOS.length,3);
 for(const card of pinned){assert.equal(displayPhotoFor(card,now),photoFor(card,now));
  const changed={...card,title:card.title+' Updated',contentHash:'b'.repeat(64)};
  assert.equal(photoFor(changed,now),null);const contextual=displayPhotoFor(changed,now);assert.equal(contextual.kind,'context');assert.notEqual(contextual.path,photoFor(card,now).path);
 }
});
test('specific public headline subjects beat broad topics without unrelated keyword matches',()=>{
 const cases=[
  [{title:'Show jumping championship opens',topic:'culture'},'equestrian'],
  [{title:'New processor promises more horsepower',topic:'technology'},'technology'],
  [{title:'Live music concert tonight',topic:'public-affairs'},'music'],
  [{title:'Football match announced',topic:'world'},'football'],
  [{title:'Road closures during bridge repairs',topic:'travel'},'roadworks'],
  [{title:'Parents and children return to the park',topic:'public-affairs'},'family'],
  [{title:'First aid training for volunteers',topic:'business'},'health'],
  [{title:'A new development',topic:'public-affairs',sourceIds:['news-family']},'family'],
  [{title:'Scholarships for university students',topic:'business'},'education'],
  [{title:'Enterprise adoption rises',topic:'business'},'business'],
 ];
 for(const [input,expected]of cases){assert.equal(contextPhotoSubject(input),expected);assert.equal(contextPhotoFor(input,now).subject,expected);}
});
test('local presentation input needs no fabricated ID, publisher, content hash or source date',()=>{
 const input=Object.freeze({title:'Roadworks on the main street',topic:'housing'});assert.equal(contextPhotoFor(input,now).subject,'roadworks');
 assert.equal(contextPhotoFor({title:'A public update'},now).kind,'context');
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
 assert.equal(CONTEXT_PHOTOS.length,14);assert.equal(new Set(CONTEXT_PHOTOS.map(p=>p.subject)).size,14);
 assert.equal(new Set(CONTEXT_PHOTOS.map(p=>p.sha256)).size,14);
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
