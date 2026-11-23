import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const OFFICIAL_ORIGIN='https://www.dlkt.ee';
const PATHS=Object.freeze(['/release.json','/','/robots.txt','/sources','/terms','/privacy','/contact','/about','/company','/header.css','/iceo.css','/iceo.js']);
const HTML_ROUTES=new Set(['/','/sources','/terms','/privacy','/contact','/about','/company']);
const ASSETS=Object.freeze(['/header.css','/iceo.css','/iceo.js']);
const MAX_BYTES=600_000;
const SHA=/^[a-f0-9]{40}$/u;
const hex=value=>createHash('sha256').update(value).digest('hex');
const isObject=v=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const isExact=(object,keys)=>Object.keys(object).length===keys.length&&keys.every(k=>Object.hasOwn(object,k));

/**
 * Source vs official-domain read-back. Static-only; never attests runtime
 * ingestion, Supabase readiness, payment, or Vercel deployment assignment.
 * An expected Git SHA is mandatory to prevent green results from stale builds.
 */
export function assessOfficialReadback(expected,snapshot){
 if(!isObject(expected)||typeof expected.sha!=='string'||!SHA.test(expected.sha)||
    typeof expected.manifest!=='string'||typeof expected.html!=='string'||!isObject(expected.assets)||
    ASSETS.some(p=>typeof expected.assets[p]!=='string')||!isObject(snapshot)){
  throw Error('DLKT_OFFICIAL_READBACK_INPUT');
 }
 const checks=[],failures=[];
 const check=(name,ok)=>{checks.push(Object.freeze({name,pass:Boolean(ok)}));if(!ok)failures.push(name);};
 const entries=isObject(snapshot.responses)?snapshot.responses:{};
 const get=p=>isObject(entries[p])?entries[p]:{};
 const ok=p=>get(p).status===200&&typeof get(p).body==='string';
 const header=(p,name)=>isObject(get(p).headers)?get(p).headers[name]??'': '';
 const manifestHash=hex(expected.manifest);
 let manifest=null,receipt=null;
 try{manifest=JSON.parse(expected.manifest);}catch{}
 try{if(ok('/release.json'))receipt=JSON.parse(get('/release.json').body);}catch{}
 check('exact-git-commit',isObject(receipt)&&receipt.gitCommitSha===expected.sha);
 check('exact-release-manifest',isObject(manifest)&&manifest.product==='dlkt-info'&&
  isObject(receipt)&&receipt.format==='dlkt-info-public-build-1'&&receipt.product===manifest.product&&
  receipt.version===manifest.version&&receipt.revision===manifest.revision&&receipt.manifestSha256===manifestHash);
 check('prelaunch-receipt-integrity',isObject(receipt)&&receipt.indexability==='prelaunch-noindex'&&
  receipt.runtimeVerification==='not-attested-by-receipt');
 check('reader-html-integrity',ok('/')&&hex(get('/').body)===hex(expected.html)&&
  expected.html.includes('<title>DLKT INFO')&&expected.html.includes('Daily Life. Key Things.'));
 check('served-security-headers',ok('/')&&
  String(header('/','content-security-policy')).includes("default-src 'none'")&&
  String(header('/','x-content-type-options')).toLowerCase()==='nosniff'&&
  /\bnoindex\b/iu.test(String(header('/','x-robots-tag'))));
 check('prelaunch-robots',ok('/robots.txt')&&/User-agent:\s*\*[\s\S]*?Disallow:\s*\/(?:\s|$)/iu.test(get('/robots.txt').body));
 for(const p of HTML_ROUTES){
  if(p==='/')continue;
  check('html-route:'+p,ok(p)&&/^\s*<!doctype html>/iu.test(get(p).body)&&get(p).body.includes('DLKT INFO'));
 }
 check('source-directory-rendered',ok('/sources')&&get('/sources').body.includes('id="iceo-source-atlas"'));
 for(const p of ASSETS)check('asset-integrity:'+p,ok(p)&&hex(get(p).body)===hex(expected.assets[p]));
 return Object.freeze({
  scope:'official-origin-readback-only',expectedSha:expected.sha,
  reportedSha:isObject(receipt)&&typeof receipt.gitCommitSha==='string'?receipt.gitCommitSha:null,
  status:failures.length===0?'LIVE_READBACK_PASS':'LIVE_READBACK_BLOCKED',
  passed:checks.length-failures.length,failed:failures.length,
  checks:Object.freeze(checks),failures:Object.freeze(failures),
  notAttested:Object.freeze(['Vercel project, production target and domain-alias binding (verify separately in Vercel)',
   'Supabase runtime and current data freshness','Payments, sign-in, notifications and live source rights',
   'Browser interactions and manual visual QA','Public discoverability; prelaunch noindex is intentional']),
 });
}

/** Fixed official URLs only; no dynamic URLs, redirects, credentials or large bodies. */
export async function collectOfficialResponses(fetcher=fetch){
 const responses={};
 for(const path of PATHS){
  const response=await fetcher(OFFICIAL_ORIGIN+path,{
   method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',
   headers:{Accept:HTML_ROUTES.has(path)?'text/html':path.endsWith('.json')?'application/json':'*/*'},
   signal:AbortSignal.timeout(8000),
  });
  const headers={
   'content-security-policy':response.headers.get('content-security-policy')??'',
   'x-content-type-options':response.headers.get('x-content-type-options')??'',
   'x-robots-tag':response.headers.get('x-robots-tag')??'',
  };
  if(response.status!==200||response.redirected){
   await response.body?.cancel();
   responses[path]={status:response.status,headers,body:''};continue;
  }
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_BYTES))throw Error('DLKT_READBACK_SIZE:'+path);
  if(!response.body)throw Error('DLKT_READBACK_EMPTY:'+path);
  const reader=response.body.getReader();
  const chunks=[];let bytes=0;
  try{
   for(;;){
    const part=await reader.read();
    if(part.done)break;
    bytes+=part.value.byteLength;
    if(bytes>MAX_BYTES){await reader.cancel();throw Error('DLKT_READBACK_SIZE:'+path);}
    chunks.push(part.value);
   }
  }finally{reader.releaseLock();}
  responses[path]={status:200,headers,body:new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))};
 }
 return Object.freeze({responses:Object.freeze(responses)});
}
export function expectedOfficialRelease(root,sha){
 if(typeof sha!=='string'||!SHA.test(sha))throw Error('DLKT_EXPECTED_SHA_REQUIRED');
 const pkg=JSON.parse(readFileSync(join(root,'source/package.json'),'utf8'));
 return Object.freeze({sha,manifest:readFileSync(join(root,'source','RELEASE-'+pkg.version+'.json'),'utf8'),
  html:readFileSync(join(root,'source/public/iceo.html'),'utf8'),
  assets:Object.fromEntries(ASSETS.map(p=>[p,readFileSync(join(root,'source/public',p.slice(1)),'utf8')])),
 });
}
const called=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(called){
 const sha=process.argv[2]??process.env.GITHUB_SHA;
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 try{
  const report=assessOfficialReadback(expectedOfficialRelease(root,sha),await collectOfficialResponses());
  console.log('DLKT_OFFICIAL_READBACK '+JSON.stringify(report));
  if(report.failed>0)process.exitCode=1;
 }catch(error){
  console.error('DLKT_OFFICIAL_READBACK_BLOCKED',error instanceof Error?error.message:'UNKNOWN_ERROR');
  process.exitCode=1;
 }
}
