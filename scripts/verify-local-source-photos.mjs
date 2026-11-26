import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {findCity} from '../source/.build/src/local/cities.js';
import {currentLocalSnapshot} from '../source/.build/src/local/contracts.js';
import {localCardPhotoReference} from '../source/.build/src/local/photo-reference.js';
import {articlePhotoPath} from '../source/.build/src/media/article-photo-reference.js';
import {inspectPhotoRaster} from '../source/.build/src/media/article-photo-raster.js';

const origin='https://www.dlkt.ee',started=Date.now(),deadline=started+75000,expected=process.env.GITHUB_SHA;
assert.match(expected??'',/^[a-f0-9]{40}$/u);
const evidence=JSON.parse(readFileSync(new URL('../docs/local-source-photos-20261126-primary-evidence.json',import.meta.url),'utf8'));
const required=evidence.verified.pages;assert.equal(required.length,2);
const output=join(process.env.RUNNER_TEMP??'/tmp','dlkt-local-source-photos');
mkdirSync(output,{recursive:true});
let requests=0;
async function get(path,kind){
 if(++requests>4||Date.now()>=deadline)throw Error('PRODUCTION_PHOTO_READBACK_LIMIT');
 const url=new URL(path,origin);assert.equal(url.origin,origin);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(20000,deadline-Date.now()));
 try{
  const response=await fetch(url,{redirect:'manual',credentials:'omit',cache:'no-store',signal:controller.signal,
   headers:{Accept:kind==='image'?'image/jpeg,image/png,image/webp':'application/json','User-Agent':'DLKT-Info-Source-Photo-Verification/1.0 (+https://www.dlkt.ee)'}});
  assert.equal(response.status,200,'public request succeeds: '+url.pathname);
  const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
  assert.ok((kind==='image'?['image/jpeg','image/png','image/webp']:['application/json']).includes(type));
  const limit=kind==='image'?1572864:1048576;
  assert.ok(Number(response.headers.get('content-length')??0)<=limit);
  assert.ok(response.body);const reader=response.body.getReader(),parts=[];let total=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>limit)throw Error('PRODUCTION_PHOTO_READBACK_BYTES');parts.push(Buffer.from(chunk.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return{bytes:Buffer.concat(parts),headers:response.headers,type};
 }finally{clearTimeout(timer);}
}
const report={check:'dlkt-local-source-photos-production-1',expectedCommit:expected,startedAt:new Date(started).toISOString(),photos:[]};
try{
 const release=JSON.parse((await get('/release.json','json')).bytes.toString('utf8'));
 assert.equal(release.gitCommitSha,expected,'the official domain serves the exact promoted main commit');
 report.release=release;
 const snapshot=JSON.parse((await get('/api/local?city=683506','json')).bytes.toString('utf8')),city=findCity('683506');
 assert.ok(city);assert.equal(currentLocalSnapshot(snapshot,city,Date.now()),true,'production local source records are current and valid');
 for(const row of required){
  const card=snapshot.cards.find(value=>value.sourceUrl===row.url);assert.ok(card,'original source event remains present: '+row.url);
  const reference=localCardPhotoReference(card,city.id,Date.now());assert.ok(reference);
  const path=articlePhotoPath(reference),response=await get(path,'image'),raster=inspectPhotoRaster(response.bytes);
  assert.ok(raster);assert.equal(raster.mime,response.type);
  const sha256=createHash('sha256').update(response.bytes).digest('hex');
  assert.equal(response.headers.get('x-dlkt-photo-basis'),'local-event-hero');
  assert.equal(response.headers.get('x-dlkt-photo-sha256'),sha256);
  assert.equal(response.headers.get('link'),'<'+card.sourceUrl+'>; rel="canonical"');
  assert.equal(sha256,row.image.sha256,'production returns the original source image verified in the primary probe');
  const filename='source-photo-'+(report.photos.length+1)+'.'+(response.type==='image/webp'?'webp':response.type==='image/png'?'png':'jpg');
  writeFileSync(join(output,filename),response.bytes,{mode:0o600});
  report.photos.push({id:card.id,title:card.title,sourceUrl:card.sourceUrl,reference,requestPath:path,sha256,bytes:response.bytes.length,...raster,filename});
 }
 assert.notEqual(report.photos[0].sha256,report.photos[1].sha256);
 report.status='PRODUCTION_SOURCE_PHOTOS_PASS';
}catch(error){report.status='PRODUCTION_SOURCE_PHOTOS_FAILED';report.error=error instanceof Error?error.message:'readback failed';process.exitCode=1;}
report.requests=requests;report.finishedAt=new Date().toISOString();
writeFileSync(join(output,'production-source-photos.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
