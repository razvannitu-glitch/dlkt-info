import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {parseDocument,DomUtils} from 'htmlparser2';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {publisherExcerpt,publicShareDescription} from '../.build/src/share/content.js';
import {previewPlan} from '../.build/src/share/preview.js';
import {renderCardImage,validPreviewPng} from '../.build/src/share/image.js';
import {renderSharedCard} from '../.build/src/share/render.js';

const now=Date.parse('2026-11-20T12:00:00.000Z');
const full='The change applies only to batch 17, and only after inspection. Other batches are excluded.';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function card(changes={}){
  const identity='https://www.nasa.gov/mission-update/';
  const value={id:hash(identity).slice(0,24),identity,title:'Publisher update',topic:'science',kind:'publication',sourceUrl:identity,
    publisher:'NASA',sourceIds:['nasa-news'],date:'2026-11-20T09:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),
    boundary:'Publisher statement with its limitations.',deadline:null,version:null,attribution:'Source: NASA.',sourceState:'verified',summary:full,...changes};
  return {...value,contentHash:hash(cardContent(value))};
}
function pixels(bytes){
  const buffer=Buffer.from(bytes);assert.ok(validPreviewPng(buffer));
  assert.equal(buffer[24],8);assert.equal(buffer[25],6);assert.equal(buffer[28],0);
  const chunks=[];let at=8,ended=false;
  while(at<buffer.length){
    const size=buffer.readUInt32BE(at),type=buffer.toString('ascii',at+4,at+8);
    assert.ok(at+size+12<=buffer.length);
    if(type==='IDAT')chunks.push(buffer.subarray(at+8,at+8+size));
    at+=size+12;
    if(type==='IEND'){assert.equal(size,0);ended=true;break;}
  }
  assert.ok(ended);assert.equal(at,buffer.length);assert.ok(chunks.length>0);
  const decoded=inflateSync(Buffer.concat(chunks));
  assert.equal(decoded.length,630*(1200*4+1));return decoded;
}

test('complete qualifying clauses survive share descriptions and fitting preview text',()=>{
  const value=card();assert.equal(publisherExcerpt(value),full);
  assert.equal(publicShareDescription(value,'Fallback listing.'),full);
  const plan=previewPlan(value);assert.equal(plan.generic,false);assert.equal(plan.excerpt,full);
  const procurement=card({kind:'procurement-notice',deadline:'2026-12-01'});
  assert.equal(publicShareDescription(procurement,'Fallback listing.'),`${full} Listed closing date: 2026-12-01. Confirm the procedure status, exact time and eligibility in the source.`);
});

test('long publisher text keeps its final condition in HTML and metadata, while the PNG plan omits the whole excerpt',()=>{
  const summary='The publisher describes a conditional change. '.repeat(9)+'This applies only after approval; no entitlement is established.';
  const value=card({summary});assert.equal(publisherExcerpt(value),summary);assert.equal(publicShareDescription(value,'Fallback'),summary);
  const plan=previewPlan(value);assert.equal(plan.generic,false);assert.equal(plan.excerpt,'');
  const document=parseDocument(renderSharedCard({card:value,insight:null,now,validUntil:now+60_000,changed:false,partial:false}));
  const meta=DomUtils.findOne(node=>node.name==='meta'&&node.attribs.property==='og:description',document.children);
  assert.equal(meta.attribs.content,summary);
  assert.ok(DomUtils.textContent(document).includes(summary));
});

test('unsupported excerpt glyphs are omitted and crowded or unsupported credits use the generic preview',()=>{
  const unsupported=card({summary:'Available in București only after inspection; other locations are excluded.'});
  assert.equal(previewPlan(unsupported).generic,false);assert.equal(previewPlan(unsupported).excerpt,'');
  assert.equal(publicShareDescription(unsupported,'Fallback'),unsupported.summary);
  for(const patch of [{title:'Actualizare din București'},{title:'Detailed publisher statement '.repeat(8)},
    {byline:'Written by A · Translated by B',licenseUrl:'https://creativecommons.org/licenses/by/3.0/'}]){
    const value=card(patch),plan=previewPlan(value);
    assert.equal(plan.generic,true);assert.equal(plan.excerpt,'');assert.equal(plan.original,'');assert.equal(plan.byline,'');assert.equal(plan.license,'');
    assert.match(plan.title,/Open this card/);assert.equal(publicShareDescription(value,'Fallback'),full);
  }
  const crowded=card({title:'Publisher announcement about a limited regional pilot',summary:full+' The status can change.'});
  assert.ok(crowded.summary.length<260);assert.equal(previewPlan(crowded).generic,false);assert.equal(previewPlan(crowded).excerpt,'');
  assert.equal(publicShareDescription(crowded,'Fallback'),crowded.summary);
});

test('a repeated title provides no invented excerpt; a real limiting sentence remains complete',()=>{
  const repeated=card({summary:'  PUBLISHER   UPDATE!  '});
  assert.equal(publisherExcerpt(repeated),null);assert.equal(publicShareDescription(repeated,'Original listing; read the source.'),'Original listing; read the source.');
  const qualified=card({summary:'Publisher update. This applies only to the named batch.'});
  assert.equal(publisherExcerpt(qualified),qualified.summary);
});

test('the real bundled renderer encodes a complete fitting excerpt into a decodable 1200 by 630 PNG',async()=>{
  const previous=globalThis.fetch;globalThis.fetch=async()=>{throw Error('REMOTE_ASSET_FORBIDDEN');};
  try{
    const value=card();assert.equal(previewPlan(value).excerpt,full);
    const included=await renderCardImage(value);
    // Keep every other rendering input, including the public URL, identical so
    // differing pixels prove the excerpt is rendered rather than a changed hash.
    const {summary,...withoutExcerpt}=value;
    const omitted=await renderCardImage(withoutExcerpt);
    assert.notDeepEqual(pixels(included),pixels(omitted));
    assert.ok(included.length>10_000);
  }finally{globalThis.fetch=previous;}
});
