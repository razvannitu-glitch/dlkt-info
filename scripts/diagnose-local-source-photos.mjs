import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {findCity} from '../source/.build/src/local/cities.js';
import {currentLocalSnapshot} from '../source/.build/src/local/contracts.js';
import {PublicationCache} from '../source/.build/src/local/publications.js';
import {ARCUB_AGENDA,parseArcubAgenda,parseArcubDetail} from '../source/.build/src/local/arcub.js';
import {localCardPhotoReference} from '../source/.build/src/local/photo-reference.js';
import {articlePhotoPath} from '../source/.build/src/media/article-photo-reference.js';
import {readArticlePhoto} from '../source/.build/src/media/article-photo-source.js';
import {resolvePhotoArticle} from '../source/.build/api/article-photo.js';
const origin='https://www.dlkt.ee',expected='fbbb42b6a4b41165d4850922a48ebd742f60f6ff',started=Date.now(),deadline=started+75000;
const evidence=JSON.parse(readFileSync(new URL('../docs/local-source-photos-20261126-primary-evidence.json',import.meta.url),'utf8'));
const source=evidence.verified.pages[0].url;
const allowed=new Set([origin+'/release.json',origin+'/api/local?city=683506','https://arcub.ro/robots.txt',ARCUB_AGENDA,source]);
const report={check:'local-photo-revision-diagnosis-1',expectedCommit:expected,startedAt:new Date(started).toISOString(),requests:[]};
const output=join(process.env.RUNNER_TEMP??'/tmp','dlkt-local-source-photo-diagnosis');mkdirSync(output,{recursive:true});
async function bounded(input,init={}){
 const address=String(input);
 if(!allowed.has(address)||report.requests.length>=6||Date.now()>=deadline)throw Error('DIAGNOSIS_REQUEST_BOUND');
 const observation={url:address};report.requests.push(observation);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(15000,deadline-Date.now()));
 try{
  const response=await fetch(address,{...init,credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal,
   headers:{Accept:'application/json','User-Agent':'DLKT-Info/0.9.46 (+https://www.dlkt.ee)',...init.headers}});
  observation.status=response.status;observation.cacheControl=response.headers.get('cache-control');observation.vercelCache=response.headers.get('x-vercel-cache');
  observation.type=response.headers.get('content-type');assert.ok(response.body);
  const reader=response.body.getReader(),parts=[];let total=0;
  try{for(;;){const chunk=await reader.read();if(chunk.done)break;total+=chunk.value.byteLength;if(total>1572864)throw Error('DIAGNOSIS_BYTES');parts.push(Buffer.from(chunk.value));}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=Buffer.concat(parts);observation.bytes=bytes.length;observation.sha256=createHash('sha256').update(bytes).digest('hex');
  if(response.status!==200)observation.body=bytes.toString('utf8').slice(0,1000);
  return new Response(bytes,{status:response.status,headers:response.headers});
 }finally{clearTimeout(timer);}
}
const semantics=card=>({id:card.id,kind:card.kind,title:card.title,publisher:card.publisher,sourceUrl:card.sourceUrl,
 section:card.context?.section,status:card.context?.status,place:card.context?.place,when:card.context?.when,
 sourceDate:card.context?.sourceDate,startsAt:card.context?.startsAt,endsAt:card.context?.endsAt??null,datePrecision:card.context?.datePrecision??null});
try{
 const release=await(await bounded(origin+'/release.json')).json();assert.equal(release.gitCommitSha,expected);report.release=release;
 const snapshot=await(await bounded(origin+'/api/local?city=683506')).json(),city=findCity('683506');
 assert.ok(city);assert.ok(currentLocalSnapshot(snapshot,city,Date.now()));
 const card=snapshot.cards.find(value=>value.sourceUrl===source);assert.ok(card);
 const reference=localCardPhotoReference(card,city.id,Date.now());assert.ok(reference);
 report.live={reference,documentHash:card.context.documentHash,documentUrl:card.context.documentUrl,semantics:semantics(card)};
 const photoUrl=origin+articlePhotoPath(reference);allowed.add(photoUrl);
 const photoResponse=await bounded(photoUrl);report.photoStatus=photoResponse.status;
 const cache=new PublicationCache(bounded,Date.now),agenda=await cache.read(ARCUB_AGENDA),parsed=parseArcubAgenda(agenda,Date.now());
 const agendaCard=parsed.cards.find(value=>value.sourceUrl===source);assert.ok(agendaCard);
 const detail=await cache.read(source),fresh=parseArcubDetail({...detail,url:source},agendaCard,Date.now())??agendaCard;
 const freshRef=localCardPhotoReference(fresh,city.id,Date.now());assert.ok(freshRef);
 const events=snapshot.coverage.find(value=>value.domain==='events');assert.ok(events);
 const listing={cards:[fresh],coverage:[{...events,checkedAt:agenda.checkedAt}]};
 const dependencies={global:async()=>{throw Error('UNUSED_GLOBAL');},local:async()=>{throw Error('UNUSED_LOCAL_NEWS');},
  official:async()=>listing,photos:{read:async()=>{throw Error('UNUSED_PHOTO_ACQUISITION');}},clock:Date.now};
 const original=await resolvePhotoArticle(reference,dependencies),current=await resolvePhotoArticle(freshRef,dependencies);
 report.fresh={reference:freshRef,documentHash:fresh.context.documentHash,documentUrl:fresh.context.documentUrl,semantics:semantics(fresh)};
 report.sameSemantics=JSON.stringify(report.live.semantics)===JSON.stringify(report.fresh.semantics);
 report.sameDocumentHash=card.context.documentHash===fresh.context.documentHash;
 report.originalReferenceResolved=Boolean(original);report.freshReferenceResolved=Boolean(current);
 report.metadata=current?readArticlePhoto(detail.body,current):null;
 report.status='DIAGNOSIS_COMPLETED';
}catch(error){report.status='DIAGNOSIS_FAILED';report.error=error instanceof Error?error.message:'diagnosis failed';process.exitCode=1;}
report.finishedAt=new Date().toISOString();
writeFileSync(join(output,'diagnosis.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify(report,null,2));
