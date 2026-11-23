import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const ACCOUNT_ORIGIN='https://www.dlkt.ee';
const MAX_BYTES=16_384;
const TIMEOUT_MS=12_000;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeTime=ms=>Number.isFinite(ms)&&ms>=0&&ms<120_000;
const cleanBody=body=>{
  try{return JSON.parse(body);}catch{return null;}
};

/** Anonymous account readiness only. This never emails, signs in or mutates user data. */
export function assessAnonymousAccountBoundary(readings) {
  if(!object(readings)||!['blocked','session','account'].every(k=>object(readings[k])))
    throw Error('DLKT_ACCOUNT_AUDIT_INPUT');
  const checks=[],failures=[];
  const verify=(code,pass)=>{
    checks.push({code,pass:Boolean(pass)});
    if(!pass)failures.push(code);
  };
  const get=(key)=>readings[key];
  const header=(key,name)=>{
    const value=get(key).headers?.[name];
    return typeof value==='string'?value:'';
  };
  const body=Object.fromEntries(['blocked','session','account'].map(key=>[key,cleanBody(get(key).body)]));
  for(const key of ['blocked','session','account']){
    verify('json-only:'+key,/^application\/json(?:\s*;|$)/iu.test(header(key,'content-type'))
      &&object(body[key]));
    verify('no-public-cache:'+key,/\bno-store\b/iu.test(header(key,'cache-control')));
    verify('no-session-cookie:'+key,header(key,'set-cookie')==='');
    verify('no-credential-body:'+key,!/access_token|refresh_token|sb_secret_|eyJ[A-Za-z0-9._-]{16}/iu.test(get(key).body));
    verify('single-response:'+key,safeTime(get(key).durationMs)
      &&get(key).redirected!==true);
  }
  verify('unauthorized-origin-blocked',get('blocked').status===403
    &&body.blocked?.error==='ORIGIN_REJECTED');
  verify('anonymous-session-safe',get('session').status===200
    &&body.session?.version==='dlkt-info-identity-1'
    &&body.session?.configured===true&&body.session?.enabled===true
    &&body.session?.authenticated===false&&body.session?.user===null);
  verify('anonymous-account-denied',get('account').status===401
    &&body.account?.error==='AUTHENTICATION_REQUIRED');
  verify('identity-privacy-vary',header('session','vary').toLowerCase().includes('cookie')
    &&header('session','vary').toLowerCase().includes('origin'));
  verify('account-privacy-vary',header('account','vary').toLowerCase().includes('cookie')
    &&header('account','vary').toLowerCase().includes('origin'));
  return Object.freeze({
    status:failures.length===0?'ANONYMOUS_ACCOUNT_BOUNDARY_PASS':'ANONYMOUS_ACCOUNT_BOUNDARY_BLOCKED',
    checkedAt:new Date().toISOString(),
    readOnly:true,
    requests:3,
    statuses:Object.freeze({
      blocked:get('blocked').status,session:get('session').status,account:get('account').status,
    }),
    durationsMs:Object.freeze({
      blocked:get('blocked').durationMs,session:get('session').durationMs,account:get('account').durationMs,
    }),
    checks:Object.freeze(checks),
    failures:Object.freeze(failures),
    scope:'anonymous HTTP boundary only; no OTP delivery, signed-in session or cross-user access attested',
  });
}

/** Exact first-party origin; no cookies, credentials, redirects, query strings or write operations. */
export async function collectAnonymousAccountBoundary(fetcher=fetch,now=()=>Date.now()){
  const targets=[
    {key:'blocked',path:'/api/account-session',headers:{Accept:'application/json'}},
    {key:'session',path:'/api/account-session',headers:{
      Accept:'application/json',
      Origin:ACCOUNT_ORIGIN,
      'X-DLKT-INFO-REQUEST':'identity-v1',
    }},
    {key:'account',path:'/api/account',headers:{
      Accept:'application/json',
      Origin:ACCOUNT_ORIGIN,
      'X-DLKT-INFO-REQUEST':'account-v1',
    }},
  ];
  const readings={};
  for(const item of targets){
    const started=now();
    const response=await fetcher(ACCOUNT_ORIGIN+item.path,{
      method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
      headers:item.headers,signal:AbortSignal.timeout(TIMEOUT_MS),
    });
    const headers=Object.fromEntries(['content-type','cache-control','set-cookie','vary'].map(
      name=>[name,response.headers.get(name)??'']));
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_BYTES)){
      await response.body?.cancel();
      throw Error('DLKT_ACCOUNT_RESPONSE_TOO_LARGE');
    }
    if(!response.body)throw Error('DLKT_ACCOUNT_RESPONSE_EMPTY');
    const reader=response.body.getReader(),parts=[];
    let bytes=0;
    try{
      for(;;){
        const part=await reader.read();
        if(part.done)break;
        bytes+=part.value.byteLength;
        if(bytes>MAX_BYTES){
          await reader.cancel();
          throw Error('DLKT_ACCOUNT_RESPONSE_TOO_LARGE');
        }
        parts.push(part.value);
      }
    }finally{reader.releaseLock();}
    readings[item.key]={
      status:response.status,redirected:response.redirected,
      durationMs:Math.max(0,now()-started),
      headers,body:Buffer.concat(parts).toString('utf8'),
    };
  }
  return readings;
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  try{
    const report=assessAnonymousAccountBoundary(await collectAnonymousAccountBoundary());
    console.log('DLKT_ANONYMOUS_ACCOUNT_AUDIT '+JSON.stringify(report));
    if(report.failures.length)process.exitCode=1;
  }catch(error){
    const label=error instanceof Error&&['DLKT_ACCOUNT_RESPONSE_TOO_LARGE','DLKT_ACCOUNT_RESPONSE_EMPTY'].includes(error.message)
      ?error.message:'DLKT_ACCOUNT_BOUNDARY_UNREACHABLE';
    console.error('DLKT_ANONYMOUS_ACCOUNT_BLOCKED '+label);
    process.exitCode=1;
  }
}
