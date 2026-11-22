import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {photoFor,usablePhoto,displayPhotoFor} from '../.build/src/media/catalog.js';
import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {renderSharedCard} from '../.build/src/share/render.js';
import {cardContent,validCard} from '../.build/src/iceo/card-validation.js';
import {contextForCard,contextFromPublisherCategories} from '../.build/src/iceo/context.js';
const cards=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'));
const now=Date.parse(REVIEWED_PHOTOS[0].reviewedAt)+1000;
const html=card=>renderSharedCard({card,insight:null,now,validUntil:now+60000,changed:false,partial:false});
test('reviewed photos bind real source fixtures in at least two public topics',()=>{assert.equal(REVIEWED_PHOTOS.length,3);assert.equal(new Set(REVIEWED_PHOTOS.map(p=>p.topic)).size,2);for(const c of cards){assert.ok(validCard(c));assert.equal(photoFor(c,now)?.cardId,c.id);}});
test('each exact context revision is reproducible from the unchanged reviewed fixture and evidenced context',()=>{
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 for(const card of cards){
  const photo=REVIEWED_PHOTOS.find(p=>p.cardId===card.id),context=card.sourceIds[0]==='gv-world'?contextFromPublisherCategories('gv-world',['East Asia','English','History','Human Rights','Indonesia','Law','Politics','Weblog']):contextForCard(card);
  assert.equal(digest(cardContent(card)),photo.contentHash);assert.deepEqual(context,photo.contextRevision.context);
  const revised={...card,context,contentHash:digest(cardContent({...card,context}))};
  assert.equal(revised.contentHash,photo.contextRevision.contentHash);assert.ok(validCard(revised));assert.equal(photoFor(revised,now)?.key,photo.key);
  assert.equal(photoFor({...card,context},now),null);assert.equal(photoFor({...card,contentHash:photo.contextRevision.contentHash},now),null);
  assert.equal(photoFor({...revised,contentHash:'a'.repeat(64)},now),null);
  const changed={...revised,summary:revised.summary+' Changed by publisher.'};changed.contentHash=digest(cardContent(changed));assert.equal(photoFor(changed,now),null);
 }
});
test('photo context compatibility is finite, source-bound and never a generic context bypass',()=>{
 const card=cards[0],photo=REVIEWED_PHOTOS[0],context=contextFromPublisherCategories('gv-world',['Romania']);
 const changed={...card,context};changed.contentHash=createHash('sha256').update(JSON.stringify(cardContent(changed))).digest('hex');
 assert.equal(photoFor(changed,now),null);assert.equal(photoFor({...changed,contentHash:photo.contextRevision.contentHash},now),null);
 const invalid={...photo.contextRevision.context,boundary:'This applies to you'};assert.equal(photoFor({...card,context:invalid,contentHash:photo.contextRevision.contentHash},now),null);
 assert.equal(usablePhoto({...photo,contextRevision:{...photo.contextRevision,contentHash:'invalid'}},now),false);
 assert.equal(usablePhoto({...photo,contextRevision:{...photo.contextRevision,context:contextForCard({sourceIds:['fda-news']})}},now),false);
});
for(const p of REVIEWED_PHOTOS)test('local licensed asset integrity and bounded raster type: '+p.key,()=>{assert.ok(usablePhoto(p,now));const b=readFileSync('public'+p.path);assert.equal(b.length,p.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),p.sha256);assert.ok(b.length<=260000);if(p.path.endsWith('.webp')){assert.equal(b.subarray(0,4).toString(),'RIFF');assert.equal(b.subarray(8,12).toString(),'WEBP');}else assert.deepEqual([...b.subarray(0,3)],[255,216,255]);});
test('unknown, unrelated and changed source revisions never inherit an image',()=>{const c=cards[0];for(const patch of [{id:'f'.repeat(24)},{identity:'other'},{sourceUrl:'https://globalvoices.org/other/'},{topic:'business'},{publisher:'Other'},{sourceIds:['other']},{title:c.title+' changed'},{date:'2026-11-16T00:00:00Z'},{contentHash:'f'.repeat(64)},{kind:'procurement-notice'}])assert.equal(photoFor({...c,...patch},now),null);});
test('image lookup leaves card evidence and stored hash unchanged',()=>{for(const c of cards){const before=JSON.stringify(c),content=JSON.stringify(cardContent(c));photoFor(c,now);assert.equal(JSON.stringify(c),before);assert.equal(JSON.stringify(cardContent(c)),content);assert.equal('photo' in c,false);}});
test('unsafe, unsupported, incomplete and out-of-review image metadata fail closed',()=>{const p=REVIEWED_PHOTOS[0];for(const patch of [{path:'//evil.test/a.webp'},{assetUrl:'https://evil.test/a.webp'},{creditUrl:'javascript:alert(1)'},{licenseUrl:'https://creativecommons.org/licenses/by-nc/4.0/'},{credit:''},{alt:''},{bytes:260001},{width:63},{reviewBy:'invalid'},{reviewedAt:new Date(now+1).toISOString()},{sha256:'x'.repeat(64)}])assert.equal(usablePhoto({...p,...patch},now),false);assert.equal(usablePhoto(p,NaN),false);assert.equal(photoFor(cards[0],Date.parse(p.reviewBy)+1),null);});
test('recipient page keeps image credits, source, date and share actions together',()=>{for(const c of cards){const p=photoFor(c,now),doc=parseDocument(html(c));const figures=DomUtils.findAll(n=>n.name==='figure',doc.children);assert.equal(figures.length,1);const imgs=DomUtils.findAll(n=>n.name==='img'&&n.attribs['data-reviewed-photo'],figures);assert.equal(imgs.length,1);assert.equal(imgs[0].attribs.src,p.path);assert.equal(imgs[0].attribs.alt,p.alt);assert.equal(imgs[0].attribs.loading,'lazy');assert.equal(imgs[0].attribs.decoding,'async');assert.ok(DomUtils.textContent(figures[0]).includes(p.credit));const links=DomUtils.findAll(n=>n.name==='a',figures[0].children).map(n=>n.attribs.href);assert.deepEqual(links,[p.creditUrl,p.licenseUrl]);assert.ok(html(c).includes('Open original source'));assert.ok(html(c).includes('Facebook'));assert.ok(html(c).includes('Download share image'));}});
test('archive date and source photo collage are clearly distinguished',()=>{assert.match(html(cards[0]),/Jakarta \(2018\)/u);assert.match(html(cards[1]),/captured 29 Oct 2026/u);assert.match(html(cards[2]),/source photo collage/u);assert.match(html(cards[2]),/photo-contain/u);});
test('expired exact source photo is removed while an independently current editorial illustration remains distinct',()=>{const checkedAt=Date.parse(REVIEWED_PHOTOS[0].reviewBy)+1,photo=displayPhotoFor(cards[0],checkedAt);assert.equal(photo?.kind,'editorial');const output=renderSharedCard({card:cards[0],insight:null,now:checkedAt,validUntil:checkedAt+60000,changed:false,partial:false});assert.ok(!output.includes(REVIEWED_PHOTOS[0].path));assert.match(output,/data-photo-kind="editorial"/u);assert.ok(output.includes(photo.path));assert.ok(output.includes(photo.caption));assert.ok(output.includes(photo.credit));assert.ok(output.includes(cards[0].title));assert.ok(output.includes('Open original source'));});
test('shared recipient page uses the same relevant image and attribution as the reader lookup',()=>{
 const checkedAt=Math.max(...CONTEXT_PHOTOS.map(photo=>Date.parse(photo.reviewedAt)))+1000;
 const title='England win the opening T20 match',sourceUrl='https://www.bbc.com/sport/cricket/articles/photo-test';
 const card={...cards[0],id:'d'.repeat(24),identity:sourceUrl,sourceUrl,title,publisher:'BBC',sourceIds:['news-sport'],topic:'sport',contentHash:'e'.repeat(64)};
 const photo=displayPhotoFor(card,checkedAt);assert.equal(photo?.subject,'cricket');
 const output=renderSharedCard({card,insight:null,now:checkedAt,validUntil:checkedAt+60000,changed:false,partial:false});
 const doc=parseDocument(output),figures=DomUtils.findAll(node=>node.name==='figure',doc.children);assert.equal(figures.length,1);
 assert.equal(figures[0].attribs['data-photo-kind'],'context');assert.equal(figures[0].attribs['data-photo-id'],photo.key);
 const images=DomUtils.findAll(node=>node.name==='img',figures);assert.equal(images.length,1);assert.equal(images[0].attribs.src,photo.path);assert.equal(images[0].attribs.alt,photo.alt);
 assert.ok(DomUtils.textContent(figures[0]).includes(photo.credit));assert.ok(DomUtils.textContent(figures[0]).includes('Not the reported event'));
 assert.deepEqual(DomUtils.findAll(node=>node.name==='a',figures[0].children).map(node=>node.attribs.href),[photo.creditUrl,photo.licenseUrl]);
 assert.ok(output.includes('Open original source'));assert.ok(output.includes('Download share image'));
});
test('public image modules exactly match reviewed compilation and allow no remote image fetch',()=>{for(const[source,target]of[['catalog','card-photo-catalog'],['reviewed-photos','reviewed-photos'],['editorial-photos','editorial-photos'],['browser','card-photo-browser']]){const compiled=readFileSync('.build/src/media/'+source+'.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./catalog.js'","'./card-photo-catalog.js'").replaceAll('../i18n/browser.js','./i18n-browser.js').replaceAll('../iceo/','./');assert.equal(readFileSync('public/'+target+'.js','utf8'),compiled);}const browser=readFileSync('public/card-photo-browser.js','utf8');assert.doesNotMatch(browser,/innerHTML|fetch\(|document\.cookie|localStorage/u);assert.match(browser,/naturalWidth === 0/u);assert.match(browser,/addEventListener\('error'/u);});
