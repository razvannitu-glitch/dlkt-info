import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {displayPhotoFor,contextPhotoFor,contextPhotoSubject,editorialPhotoFor,usableEditorialPhoto,photoFor} from '../.build/src/media/catalog.js';
import {EDITORIAL_PHOTOS} from '../.build/src/media/editorial-photos.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';

const sourceCards=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'));
const now=Math.max(...EDITORIAL_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
function card(category,title='A new information update',kind='publication'){
 const url=`https://www.bbc.com/news/articles/visual-fixture-${category}-${kind}`;
 const {summary,byline,licenseUrl,context,...base}=sourceCards[0];
 const value={...base,id:createHash('sha256').update(url).digest('hex').slice(0,24),identity:url,sourceUrl:url,title,publisher:'BBC fixture',boundary:'Synthetic source metadata for presentation tests; no live article is claimed.',attribution:'Synthetic fixture only.',sourceIds:[`news-${category}`],topic:EDITORIAL_CATEGORY_TOPICS[category],kind,version:kind==='software-release'?'v1.2.3':null};
 value.contentHash=createHash('sha256').update(JSON.stringify(cardContent(value))).digest('hex');
 return value;
}

test('every public category and renderable record kind has a licensed image without changing source evidence',()=>{
 for(const category of PUBLIC_EDITORIAL_CATEGORIES)for(const kind of ['publication','legal-document','software-release','procurement-notice']){
  const value=Object.freeze(card(category,'A new information update',kind));assert.ok(validCard(value),`${category}/${kind}`);
  const before=JSON.stringify(value),photo=displayPhotoFor(value,now);
  assert.ok(photo,`${category}/${kind}`);assert.equal(photo.kind,'editorial');assert.ok(usableEditorialPhoto(photo,now));
  assert.equal(JSON.stringify(value),before);assert.equal('photo' in value,false);
 }
});

test('editorial fallback never converts crime, war or ambiguous places into photographic subject evidence',()=>{
 for(const [category,title]of [
  ['world','Military leaders consider their next move'],['public-affairs','Parents charged with fraud'],
  ['housing','Housing prices rise in London, Ontario, Canada'],['education','Scholarships for university students'],
  ['health','Nouvelle information publiée aujourd’hui'],['world','世界各地から新しい情報'],['world','معلومات جديدة اليوم'],
 ]){
  const value=card(category,title);assert.equal(contextPhotoFor(value,now),null,title);
  const strictBefore=contextPhotoSubject(value),photo=displayPhotoFor(value,now);assert.equal(photo.kind,'editorial',title);
  assert.match(photo.alt,/^Illustrative photograph: .*Not the reported event\.$/u);assert.match(photo.caption,/^Illustrative photograph:/u);
  assert.equal(contextPhotoSubject(value),strictBefore);assert.equal('subject' in photo,false);assert.equal('cardId' in photo,false);
 }
});

test('exact source revisions and strict subject photos retain priority over neutral editorial imagery',()=>{
 for(const value of sourceCards)assert.equal(displayPhotoFor(value,now),photoFor(value,now));
 const cricket=card('sport','England win the opening T20 match');assert.equal(contextPhotoFor(cricket,now)?.subject,'cricket');
 assert.equal(displayPhotoFor(cricket,now),contextPhotoFor(cricket,now));
});

test('editorial representation follows the existing public category and is deterministic without query tracking',()=>{
 const expected={world:'world','public-affairs':'world',technology:'digital-reading',education:'reading'};
 for(const [category,motif]of Object.entries(expected)){
  const value=card(category),photo=editorialPhotoFor(value,now);assert.equal(photo.motif,motif);
  assert.equal(editorialPhotoFor({...value,sourceUrl:value.sourceUrl+'/?utm_source=share#saved'},now)?.key,photo.key);
  assert.equal(editorialPhotoFor(value,now,[...EDITORIAL_PHOTOS].reverse())?.key,photo.key);
  assert.equal(editorialPhotoFor({title:value.title,editorialCategory:category},now)?.motif,motif);
 }
 const used=new Set();
 for(let index=0;index<64;index++)used.add(editorialPhotoFor({title:`Unclassified bulletin ${index}`,sourceUrl:`https://example.org/bulletin/${index}`},now)?.key);
 assert.equal(used.size,EDITORIAL_PHOTOS.length);
});

test('expiry and incomplete or injected editorial metadata fail closed independently of source photographs',()=>{
 const photo=EDITORIAL_PHOTOS[0];
 for(const patch of [
  {kind:'context'},{motif:'politician'},{assetUrl:'https://evil.example/photo.jpg'},{creditUrl:'javascript:alert(1)'},
  {creditUrl:'https://commons.wikimedia.org.evil.example/wiki/File:photo.jpg'},{path:'//tracker.example/photo.jpg'},
  {license:'CC BY-NC 4.0'},{licenseUrl:'https://creativecommons.org/licenses/by/4.0/'},{credit:''},
  {alt:'The reported event'},{caption:'Source photograph: the event'},{bytes:260001},{width:63},{sha256:'invalid'},
  {reviewBy:'invalid'},{reviewedAt:new Date(now+1).toISOString()},
 ])assert.equal(usableEditorialPhoto({...photo,...patch},now),false,JSON.stringify(patch));
 assert.equal(editorialPhotoFor({title:'News'},NaN),null);assert.equal(editorialPhotoFor({title:'News'},now,[]),null);
 const later=Math.max(...EDITORIAL_PHOTOS.map(photo=>Date.parse(photo.reviewBy)))+1;
 assert.equal(editorialPhotoFor({title:'News'},later),null);
 const expired={...photo,reviewBy:new Date(now-1).toISOString()},healthy=EDITORIAL_PHOTOS[1];
 assert.equal(editorialPhotoFor({title:'News'},now,[expired,healthy]),healthy);
});

function jpegSize(bytes){let offset=2;while(offset<bytes.length){assert.equal(bytes[offset],255);while(bytes[offset]===255)offset++;const marker=bytes[offset++];if(marker===0xd9||marker===0xda)break;
 const length=bytes.readUInt16BE(offset);if([0xc0,0xc1,0xc2].includes(marker))return{width:bytes.readUInt16BE(offset+5),height:bytes.readUInt16BE(offset+3)};offset+=length;
 }throw Error('JPEG_DIMENSIONS_MISSING');}
test('all editorial photos are locally pinned real JPEG files with bounded payload and retained attribution',()=>{
 assert.equal(EDITORIAL_PHOTOS.length,3);assert.equal(new Set(EDITORIAL_PHOTOS.map(photo=>photo.sha256)).size,3);
 let total=0;
 for(const photo of EDITORIAL_PHOTOS){const bytes=readFileSync('public'+photo.path);total+=bytes.length;
  assert.ok(usableEditorialPhoto(photo,now));assert.deepEqual([...bytes.subarray(0,3)],[255,216,255]);
  assert.equal(bytes.length,photo.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),photo.sha256);
  assert.deepEqual(jpegSize(bytes),{width:photo.width,height:photo.height});assert.equal(photo.fit,'contain');
  assert.ok(photo.credit);assert.equal(photo.sourceUrl,photo.creditUrl);assert.match(photo.sourceUrl,/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
 }
 assert.ok(total<300000);
});
