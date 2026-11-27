import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const KNOWLEDGE_ORIGIN='https://www.dlkt.ee';
const evidence=JSON.parse(readFileSync(new URL('../source/tests/evidence/nsw-fuelcheck-admission-20261126.json',import.meta.url),'utf8'));
const id='dlkt-elsewhere-nsw-fuelcheck';
const digest=evidence.candidateDigest, revision=evidence.revision;
const decision=evidence.decisions.filter(item=>item.scope==='standalone');
const reviewedAt=Date.parse(evidence.reviewedAt);
const expiresAt=Math.min(Date.parse(evidence.reviewBy),Date.parse(decision[0]?.expiresAt));
const source=evidence.observation.receipt.sourceUrl, terms=evidence.observation.receipt.policyUrl;
const labDigest=evidence.priorLabDigest;
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const requireIdentity=evidence.cardId===id&&revision===1&&hash(digest)&&hash(labDigest)&&digest!==labDigest
  &&decision.length===1&&decision[0].id===id&&decision[0].revision===revision&&decision[0].digest===digest
  &&decision[0].decision==='permit-on-verified-release'&&Number.isFinite(reviewedAt)&&expiresAt>reviewedAt
  &&source.startsWith('https://www.nsw.gov.au/')&&terms.startsWith('https://www.nsw.gov.au/');
if(!requireIdentity)throw Error('DLKT_LIVE_KNOWLEDGE_IDENTITY');
export const KNOWLEDGE_IDENTITY=Object.freeze({id,digest,labDigest,revision,reviewedAt,expiresAt,source,terms,
  license:'https://creativecommons.org/licenses/by/4.0/'});
const MAX_BYTES=128_000;
const TIMEOUT_MS=10_000;
const headers=['content-type','cache-control','set-cookie','x-content-type-options','x-robots-tag'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeClock=now=>Number.isSafeInteger(now)&&now>=0;
const active=now=>now>=reviewedAt&&now<expiresAt;
export function knowledgeCases(now){
  if(!safeClock(now))throw Error('DLKT_LIVE_KNOWLEDGE_CLOCK');
  const canonical='/card/'+id,api='/api/card?id='+id;
  const query=(language,h)=>'v='+revision+'&lang='+language+'&h='+h;
  const admitted=active(now)?200:404;
  return Object.freeze([
    ...['en','ro','it'].flatMap(language=>[
      {key:'canonical-'+language,path:canonical+'?'+query(language,digest),language,status:admitted},
      {key:'api-'+language,path:api+'&'+query(language,digest),language,status:admitted},
    ]),
    {key:'lab-canonical',path:canonical+'?'+query('en',labDigest),language:'en',status:404},
    {key:'lab-api',path:api+'&'+query('en',labDigest),language:'en',status:404},
    {key:'duplicate-digest',path:canonical+'?'+query('en',digest)+'&h='+digest,language:'en',status:400},
    {key:'duplicate-id',path:api+'&'+query('en',digest)+'&id='+id,language:'en',status:400},
  ].map(item=>Object.freeze(item)));
}
const escapeAmp=value=>value.replace(/&/gu,'&amp;');
export function assessKnowledgeResponse(item,reading){
  const failures=[];
  const check=(name,ok)=>{if(!ok)failures.push(name);};
  if(!object(reading)||!object(reading.headers)||typeof reading.body!=='string')return ['unreachable'];
  const header=name=>reading.headers[name]??'';
  const body=reading.body;
  check('status',reading.status===item.status);
  check('no-redirect',reading.redirected===false);
  check('html',/^text\/html(?:;|$)/iu.test(header('content-type')));
  check('no-store',/\bno-store\b/iu.test(header('cache-control')));
  check('no-cookie',header('set-cookie')==='');
  check('nosniff',header('x-content-type-options').toLowerCase()==='nosniff');
  check('noindex',/\bnoindex\b/iu.test(header('x-robots-tag'))&&/\bnofollow\b/iu.test(header('x-robots-tag')));
  check('language',body.includes('<html lang="'+item.language+'">'));
  const marker='data-shared-knowledge-id="'+id+'"';
  if(item.status===200){
    check('identity',body.includes(marker));
    check('expiry',body.includes('data-valid-until="'+expiresAt+'"'));
    const canonical=KNOWLEDGE_ORIGIN+'/card/'+id+'?v='+revision+'&lang='+item.language+'&h='+digest;
    check('canonical',body.includes('rel="canonical" href="'+escapeAmp(canonical)+'"'));
    check('source',body.includes('href="'+source+'"'));
    check('terms',body.includes('href="'+terms+'"'));
    check('license',body.includes('href="'+KNOWLEDGE_IDENTITY.license+'"'));
    check('credit',body.includes('class="card-credits"'));
  }else{
    check('no-substitute',!body.includes('data-shared-knowledge-id=')&&!body.includes('id="shared-copy"'));
  }
  return failures;
}
function receipt(reading){
  if(!object(reading)||reading.status!==200||reading.redirected!==false
    ||!/^application\/json(?:;|$)/iu.test(reading.headers?.['content-type']??''))return null;
  try{
    const data=JSON.parse(reading.body);
    return data.format==='dlkt-info-public-build-1'&&data.product==='dlkt-info'
      &&typeof data.gitCommitSha==='string'&&/^[a-f0-9]{40}$/u.test(data.gitCommitSha)
      &&hash(data.manifestSha256)?{commit:data.gitCommitSha,manifest:data.manifestSha256}:null;
  }catch{return null;}
}
async function read(path,fetcher,accept){
  const response=await fetcher(KNOWLEDGE_ORIGIN+path,{
    method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
    headers:{Accept:accept},signal:AbortSignal.timeout(TIMEOUT_MS),
  });
  const resultHeaders=Object.fromEntries(headers.map(name=>[name,response.headers.get(name)??'']));
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/u.test(declared)||Number(declared)>MAX_BYTES)){
    await response.body?.cancel();throw Error('DLKT_LIVE_KNOWLEDGE_BODY_LIMIT');
  }
  if(!response.body)throw Error('DLKT_LIVE_KNOWLEDGE_EMPTY');
  const reader=response.body.getReader(),parts=[];let count=0;
  try{
    for(;;){
      const part=await reader.read();if(part.done)break;
      count+=part.value.byteLength;
      if(count>MAX_BYTES){await reader.cancel();throw Error('DLKT_LIVE_KNOWLEDGE_BODY_LIMIT');}
      parts.push(part.value);
    }
  }finally{reader.releaseLock();}
  return {status:response.status,redirected:response.redirected,headers:resultHeaders,body:Buffer.concat(parts).toString('utf8')};
}
export async function collectLiveKnowledge(fetcher=fetch,clock=()=>Date.now()){
  const started=clock(),cases=knowledgeCases(started);
  const bounded=async(path,accept)=>{try{return await read(path,fetcher,accept);}catch{return null;}};
  const before=receipt(await bounded('/release.json','application/json'));
  const results=[];
  for(const item of cases){
    const sample=await bounded(item.path,'text/html');
    results.push({key:item.key,expected:item.status,status:sample?.status??null,failures:assessKnowledgeResponse(item,sample)});
  }
  const after=receipt(await bounded('/release.json','application/json')),completed=clock();
  const stable=before!==null&&after!==null&&before.commit===after.commit&&before.manifest===after.manifest;
  const stableClock=safeClock(completed)&&completed>=started&&active(started)===active(completed);
  const failures=[...(!stable?['release-receipt-changed-or-unavailable']:[]),...(!stableClock?['review-window-changed-or-clock-invalid']:[]),
    ...results.flatMap(item=>item.failures.map(failure=>item.key+':'+failure))];
  return {status:failures.length?'LIVE_KNOWLEDGE_HTTP_BLOCKED':'LIVE_KNOWLEDGE_HTTP_PASS',scope:'direct anonymous GET to fixed public origin; no credentials, no redirects, no mutations',
    checkedAt:new Date(started).toISOString(),commit:stable?before.commit:null,manifest:stable?before.manifest:null,
    activeAtStart:active(started),requests:cases.length+2,results,failures};
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  try{
    const report=await collectLiveKnowledge();
    console.log('DLKT_LIVE_KNOWLEDGE_HTTP '+JSON.stringify(report));
    if(report.failures.length)process.exitCode=1;
  }catch{
    console.error('DLKT_LIVE_KNOWLEDGE_HTTP_BLOCKED');process.exitCode=1;
  }
}
