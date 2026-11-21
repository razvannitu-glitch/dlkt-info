import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {captureArchiveRecord} from '../.build/src/share/archive.js';
import {currentCard} from '../.build/src/share/current-card.js';
import {resolveShare} from '../.build/src/share/resolve.js';
import {cardPath,cardImagePath} from '../.build/src/share/link.js';
import {handleShareArchive} from '../.build/api/share-archive.js';
import {handleCard} from '../.build/api/card.js';
import {handleCardImage} from '../.build/api/card-image.js';

const now=Date.parse('2026-11-20T12:00:00.000Z'),stamp=new Date(now).toISOString();
const later=now+8*86400000;
const source=ICEO_SOURCES.find(item=>item.id==='ecb-news');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function card(patch={}){
 const identity='https://www.ecb.europa.eu/press/pr/date/2026/html/preservation-example.en.html';
 const value={identity,title:'A dated publisher statement',topic:'business',kind:'publication',sourceUrl:identity,
  publisher:source.publisher,sourceIds:[source.id],date:stamp,dateLabel:'Published',observedAt:stamp,
  boundary:'The figures describe the stated reporting period; they are not personalised financial advice.',
  deadline:null,version:null,attribution:source.attribution,sourceState:'verified',
  summary:'The publisher reports a result for a limited reporting period. It does not establish an individual entitlement.',...patch};
 return{...value,id:hash(value.identity).slice(0,24),contentHash:hash(cardContent(value))};
}
const original=card();
function snapshot(cards=[original],state='ready',at=now){
 const checkedAt=new Date(at).toISOString();
 const health={id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:state==='ready'?'verified':state,
  checkedAt,verifiedAt:state==='unavailable'?null:checkedAt,count:cards.length,rejected:state==='partial'?1:0,error:state==='unavailable'?'SOURCE_OFFLINE':null,retryAt:null,scope:source.scope,termsUrl:source.termsUrl,windowed:true};
 return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:checkedAt,state,
  sources:[health],cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:cards.length?['business']:[]};
}
function stored(subject=original){return captureArchiveRecord(currentCard(snapshot([subject]),{id:subject.id,revision:subject.contentHash},now,true),now);}
function memoryArchive(records=[],writable=true){
 const rows=new Map(records.map(record=>[record.card.id+':'+record.card.contentHash,record]));
 const calls={reads:[],captures:[]};
 return{writable,calls,
  async read(id,revision){calls.reads.push({id,revision});const value=revision===null?[...rows.values()].filter(item=>item.card.id===id).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt))[0]:rows.get(id+':'+revision);return value?structuredClone(value):null;},
  async capture(current,at){calls.captures.push({current:structuredClone(current),at});const value=captureArchiveRecord(current,at),key=value.card.id+':'+value.card.contentHash;if(!rows.has(key))rows.set(key,value);return structuredClone(rows.get(key));},
 };
}
function response(){
 const headers={};let body;
 return{headers,res:{statusCode:0,setHeader(name,value){headers[name.toLowerCase()]=value;},end(value){body=value;}},
  get body(){return body;},get text(){return body===undefined?'':Buffer.isBuffer(body)?body.toString('utf8'):String(body);},get json(){return JSON.parse(this.text);}};
}
const ref=subject=>({id:subject.id,revision:subject.contentHash});
const originHeaders={'host':'www.dlkt.ee','origin':'https://www.dlkt.ee','content-type':'application/json','x-dlkt-info-request':'share-archive'};
function postRequest(value=ref(original),options={}){
 const raw=options.raw??JSON.stringify(value),request=Readable.from([Buffer.from(raw)]);
 request.method=options.method??'POST';request.url=options.url??'/api/share-archive';request.headers={...originHeaders,...options.headers};return request;
}
async function prepare({request=postRequest(),archive=memoryArchive(),load=async()=>snapshot(),clock=()=>now}={}){
 const out=response();let loads=0;await handleShareArchive(request,out.res,async()=>{loads++;return load();},archive,clock);
 return{...out,status:out.res.statusCode,text:out.text,json:out.json,loads,archive};
}
async function html({url=cardPath(original),method='GET',archive=memoryArchive([stored()]),load=async()=>snapshot(),clock=()=>later}={}){
 const out=response();let loads=0,explains=0;
 await handleCard({method,url,headers:{}},out.res,async()=>{loads++;return load();},async()=>{explains++;throw Error('LIVE_EXCERPT_MUST_NOT_BE_FETCHED');},clock,archive);
 return{status:out.res.statusCode,headers:out.headers,text:out.text,body:out.body,loads,explains};
}
function pngBytes(){const result=Buffer.alloc(24);Buffer.from('89504e470d0a1a0a','hex').copy(result);result.write('IHDR',12);result.writeUInt32BE(1200,16);result.writeUInt32BE(630,20);return result;}
async function png({url=cardImagePath(original),method='GET',archive=memoryArchive([stored()]),load=async()=>snapshot(),clock=()=>later,render=async()=>pngBytes()}={}){
 const out=response();let loads=0;const renders=[];
 await handleCardImage({method,url,headers:{}},out.res,async()=>{loads++;return load();},{read:async(subject,until)=>{renders.push({card:structuredClone(subject),until});return render(subject,until);}},clock,archive);
 return{status:out.res.statusCode,headers:out.headers,text:out.text,body:out.body,loads,renders};
}

test('anonymous same-origin preservation accepts only a public identity and revision',async()=>{
 const request=postRequest(),result=await prepare({request});
 assert.equal(request.headers.cookie,undefined);assert.equal(request.headers.authorization,undefined);
 assert.equal(result.status,200);assert.deepEqual(result.json,{state:'preserved',path:cardPath(original)});
 assert.equal(result.loads,1);assert.equal(result.archive.calls.captures.length,1);
 assert.deepEqual(result.archive.calls.captures[0].current.card,original);
 assert.equal(result.headers['cache-control'],'private, no-store');assert.equal(result.headers['set-cookie'],undefined);
 assert.doesNotMatch(result.text,/profile|private-query|savedHistory|auth-token/u);
});

test('CSRF, unrecognised hosts, query parameters and non-POST methods fail before archive or source access',async()=>{
 for(const [options,status]of[
  [{headers:{origin:'https://attacker.example'}},403],
  [{headers:{host:'attacker.example'}},403],
  [{headers:{'x-dlkt-info-request':''}},403],
  [{headers:{'sec-fetch-site':'cross-site'}},403],
  [{url:'/api/share-archive?query=private-query'},403],
  [{method:'GET'},405],[{method:'HEAD'},405],[{method:'OPTIONS'},405],
 ]){
  const archive=memoryArchive(),result=await prepare({archive,request:postRequest(ref(original),options)});
  assert.equal(result.status,status,JSON.stringify(options));assert.equal(result.loads,0);assert.equal(archive.calls.reads.length,0);assert.equal(archive.calls.captures.length,0);
  if(status===405)assert.equal(result.headers.allow,'POST');
 }
});

test('forged article content, preferences, malformed references and oversized bodies cannot enter the archive',async()=>{
 const invalid=[null,[],42,{id:original.id},{revision:original.contentHash},
  {...ref(original),title:'Client-written fact'}, {...ref(original),sourceUrl:'https://attacker.example'},
  {...ref(original),privateQuery:'private-query'}, {...ref(original),savedHistory:['private-history']},
  {id:'invalid',revision:original.contentHash},{id:original.id,revision:null},{id:original.id,revision:'f'.repeat(63)}];
 for(const value of invalid){const archive=memoryArchive(),result=await prepare({archive,request:postRequest(value)});assert.equal(result.status,400);assert.equal(result.loads,0);assert.equal(archive.calls.reads.length,0);}
 for(const options of [{raw:'{'},{raw:''},{raw:' '.repeat(257)+JSON.stringify(ref(original))},{headers:{'content-type':'text/plain'}}]){
  const archive=memoryArchive(),result=await prepare({archive,request:postRequest(ref(original),options)});assert.equal(result.status,400);assert.equal(result.loads,0);assert.equal(archive.calls.reads.length,0);
 }
});

test('preserving an already archived exact revision is idempotent and never refreshes its historic source date',async()=>{
 const archive=memoryArchive([stored()],false),result=await prepare({archive,clock:()=>later,load:async()=>{throw Error('MUST_NOT_LOAD');}});
 assert.equal(result.status,200);assert.equal(result.loads,0);assert.equal(archive.calls.captures.length,0);
 const record=await archive.read(original.id,original.contentHash);assert.equal(record.capturedAt,stamp);assert.equal(record.card.observedAt,stamp);
});

test('unavailable or read-only storage never reports a durable share and does not leak backend details',async()=>{
 const unavailable=await prepare({archive:null});assert.equal(unavailable.status,503);assert.equal(unavailable.loads,0);
 const readOnly=await prepare({archive:memoryArchive([],false)});assert.equal(readOnly.status,503);assert.equal(readOnly.loads,0);
 for(const stage of ['read','capture']){
  const archive=memoryArchive();archive[stage]=async()=>{throw Error('secret-backend-credential');};
  const result=await prepare({archive});assert.equal(result.status,503);assert.equal(result.json.state,undefined);assert.equal(result.headers['retry-after'],'30');assert.doesNotMatch(result.text,/secret-backend/u);
 }
});

test('server-only capture rejects a changed revision, missing record and private extra fields',async()=>{
 const changed=card({summary:'A later publisher revision.'});
 const conflict=await prepare({load:async()=>snapshot([changed])});assert.equal(conflict.status,410);assert.equal(conflict.json.error,'CARD_REVISION_CHANGED');assert.equal(conflict.archive.calls.captures.length,0);
 const missing=await prepare({load:async()=>snapshot([])});assert.equal(missing.status,404);assert.equal(missing.json.error,'CARD_NOT_FOUND');
 const partial=await prepare({load:async()=>snapshot([],'partial')});assert.equal(partial.status,503);
 const poisoned=card({userId:'private-user'}),privateFields=await prepare({request:postRequest(ref(poisoned)),load:async()=>snapshot([poisoned])});
 assert.equal(privateFields.status,503);assert.doesNotMatch(privateFields.text,/private-user/u);
});

test('concurrent preservation of one revision shares the verified acquisition and capture',async()=>{
 const archive=memoryArchive();let loads=0,release;const wait=new Promise(resolve=>{release=resolve;});
 const load=async()=>{loads++;await wait;return snapshot();};
 const first=prepare({archive,load}),second=prepare({archive,load});await new Promise(resolve=>setImmediate(resolve));release();
 const results=await Promise.all([first,second]);assert.deepEqual(results.map(item=>item.status),[200,200]);assert.equal(loads,1);assert.equal(archive.calls.captures.length,1);
});

test('exact archived HTML survives feed disappearance and source failure without fetching live data or excerpts',async()=>{
 for(const load of [async()=>snapshot([], 'ready',later),async()=>snapshot([], 'unavailable',later),async()=>{throw Error('SOURCE_OFFLINE');}]){
  const result=await html({load});assert.equal(result.status,200);assert.equal(result.loads,0);assert.equal(result.explains,0);
  assert.ok(result.text.includes(original.summary));assert.ok(result.text.includes(original.title));
  assert.match(result.text,/exact edition preserved/u);assert.match(result.text,/historical information/u);assert.match(result.text,/Current status has not been checked/u);
  assert.doesNotMatch(result.text,/data-valid-until=/u);assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['set-cookie'],undefined);
 }
});

test('an archived link keeps its exact old revision even when the live listing has newer wording',async()=>{
 const changed=card({summary:'A completely different current statement.'});
 const result=await html({load:async()=>snapshot([changed],'ready',later)});
 assert.equal(result.status,200);assert.equal(result.loads,0);assert.ok(result.text.includes(original.summary));assert.ok(!result.text.includes(changed.summary));
 assert.ok(result.text.includes(cardPath(original)));assert.ok(!result.text.includes(changed.contentHash));
});

test('a current unversioned URL can fall back to clearly labelled history, without pretending to be current',async()=>{
 const result=await html({url:'/card/'+original.id,load:async()=>{throw Error('SOURCE_DOWN');}});
 assert.equal(result.status,200);assert.equal(result.loads,1);assert.equal(result.explains,0);assert.match(result.text,/A current check is unavailable/u);assert.match(result.text,/saved edition is shown/u);assert.ok(result.text.includes(original.summary));
});

test('archive backend failure remains 503 when live evidence cannot establish an exact record, never false 404',async()=>{
 const archive={writable:false,read:async()=>{throw Error('secret-database-url');},capture:async()=>{throw Error('NOT_USED');}};
 for(const load of [async()=>snapshot([],'ready',later),async()=>{throw Error('SOURCE_OFFLINE');}]){
  const result=await html({archive,load});assert.equal(result.status,503);assert.equal(result.headers['retry-after'],'60');assert.doesNotMatch(result.text,/secret-database-url|not in the current catalog/u);
  const image=await png({archive,load});assert.equal(image.status,503);assert.equal(image.renders.length,0);assert.equal(image.headers['cache-control'],'no-store');assert.doesNotMatch(image.text,/secret-database-url/u);
 }
});

test('a clean archive miss can use current evidence, while exact PNG conflicts remain 410',async()=>{
 const archive=memoryArchive(),result=await html({archive,clock:()=>now});assert.equal(result.status,200);assert.equal(result.loads,1);assert.match(result.text,/Current source listing/u);assert.match(result.text,/not an archived edition/u);
 const changed=card({summary:'Different revision.'}),image=await png({archive,load:async()=>snapshot([changed]),clock:()=>now});
 assert.equal(image.status,410);assert.equal(image.renders.length,0);assert.equal(image.headers['cache-control'],'no-store');
});

test('archived PNG rendering receives only the exact historical card, keeping its original observedAt',async()=>{
 const result=await png({load:async()=>{throw Error('MUST_NOT_LOAD');}});
 assert.equal(result.status,200);assert.equal(result.loads,0);assert.equal(result.renders.length,1);
 assert.deepEqual(result.renders[0].card,original);assert.equal(result.renders[0].card.observedAt,stamp);
 assert.equal(result.renders[0].until,later+60000);assert.equal(result.headers['content-type'],'image/png');assert.equal(result.headers['cache-control'],'public, max-age=60, s-maxage=60, no-transform');
 assert.ok(Buffer.isBuffer(result.body));assert.equal(result.headers['set-cookie'],undefined);
});

test('HEAD retains archive status and metadata but emits no HTML or PNG and performs no image rendering',async()=>{
 const page=await html({method:'HEAD'});assert.equal(page.status,200);assert.equal(page.text,'');assert.equal(page.loads,0);assert.equal(page.explains,0);assert.equal(page.headers['content-type'],'text/html; charset=utf-8');
 const image=await png({method:'HEAD'});assert.equal(image.status,200);assert.equal(image.body,undefined);assert.equal(image.loads,0);assert.equal(image.renders.length,0);assert.equal(image.headers['content-type'],'image/png');
 const bad=await png({method:'HEAD',url:'/api/card-image?id=invalid'});assert.equal(bad.status,400);assert.equal(bad.text,'');assert.equal(bad.loads,0);
});

test('invalid references and writes cannot trigger historical reads or live acquisition',async()=>{
 for(const options of [{url:cardPath(original)+'&query=private-query'},{method:'POST'}]){
  const archive=memoryArchive([stored()]),result=await html({...options,archive});assert.equal(result.status,options.method?405:400);assert.equal(result.loads,0);assert.equal(archive.calls.reads.length,0);
 }
 for(const options of [{url:cardImagePath(original)+'&text=private-query'},{method:'POST'}]){
  const archive=memoryArchive([stored()]),result=await png({...options,archive});assert.equal(result.status,options.method?405:400);assert.equal(result.loads,0);assert.equal(archive.calls.reads.length,0);
 }
});

test('archived publisher text is escaped and recipients need neither an account nor preferences',async()=>{
 const unsafe=card({title:'Publisher <img src=x onerror=alert(1)>',summary:'A qualified finding <script>alert(1)</script> for this report only.'});
 const result=await html({url:cardPath(unsafe),archive:memoryArchive([stored(unsafe)])});
 assert.equal(result.status,200);assert.equal(result.headers['set-cookie'],undefined);assert.equal(result.headers['www-authenticate'],undefined);
 assert.doesNotMatch(result.text,/<img src=x|<script>alert|auth-token|savedHistory/u);assert.match(result.text,/&lt;script&gt;/u);
 assert.match(result.text,/Nothing is saved by opening this card/u);assert.match(result.text,/No account/u);
});

test('resolver exact archival read is independent of later wall clock and does not acquire a live substitute',async()=>{
 const archive=memoryArchive([stored()]);let loads=0;
 const result=await resolveShare(ref(original),async()=>{loads++;return snapshot([card({title:'Substitute'})]);},archive,()=>later,true);
 assert.equal(loads,0);assert.equal(result.reason,'shared-edition');assert.deepEqual(result.current.card,original);assert.ok(result.current.validUntil<later);assert.ok(result.archived);
});
