import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_ORIGIN,
  assessAnonymousAccountBoundary,
  collectAnonymousAccountBoundary,
} from '../scripts/verify-anonymous-account.mjs';

const headers=(extra={})=>({
  'content-type':'application/json; charset=utf-8',
  'cache-control':'private, no-store',
  'set-cookie':'',
  vary:'Cookie, Origin',
  ...extra,
});
const fixture=()=>({
  blocked:{
    status:403,redirected:false,durationMs:32,headers:headers(),
    body:JSON.stringify({error:'ORIGIN_REJECTED'}),
  },
  session:{
    status:200,redirected:false,durationMs:43,headers:headers(),
    body:JSON.stringify({
      version:'dlkt-info-identity-1',configured:true,enabled:true,
      authenticated:false,user:null,blocker:null,
    }),
  },
  account:{
    status:401,redirected:false,durationMs:61,headers:headers(),
    body:JSON.stringify({error:'AUTHENTICATION_REQUIRED'}),
  },
});

test('a configured production anonymous session and rejected account read pass',()=>{
  const result=assessAnonymousAccountBoundary(fixture());
  assert.equal(result.status,'ANONYMOUS_ACCOUNT_BOUNDARY_PASS');
  assert.equal(result.requests,3);
  assert.deepEqual(result.failures,[]);
  assert.deepEqual(result.statuses,{blocked:403,session:200,account:401});
});
test('unauthorized origin access cannot masquerade as a healthy session',()=>{
  const data=fixture();
  data.blocked.status=200;
  data.blocked.body=JSON.stringify({error:'none'});
  assert.ok(assessAnonymousAccountBoundary(data).failures.includes('unauthorized-origin-blocked'));
});
test('a disabled or falsely authenticated anonymous account blocks acceptance',()=>{
  const data=fixture();
  data.session.body=JSON.stringify({
    version:'dlkt-info-identity-1',configured:false,enabled:false,
    authenticated:false,user:null,blocker:'ACCOUNT_NOT_READY',
  });
  assert.ok(assessAnonymousAccountBoundary(data).failures.includes('anonymous-session-safe'));
  data.session.body=JSON.stringify({
    version:'dlkt-info-identity-1',configured:true,enabled:true,
    authenticated:true,user:{id:'private'},
  });
  assert.ok(assessAnonymousAccountBoundary(data).failures.includes('anonymous-session-safe'));
});
test('no cookies, bearer tokens, caching or HTML errors accepted',()=>{
  const data=fixture();
  data.session.headers['set-cookie']='__Host-dlkt_info_at=accidental';
  data.session.body=JSON.stringify({access_token:'eyJ.this.is.forbidden'});
  data.account.headers['cache-control']='public, max-age=86400';
  data.blocked.headers['content-type']='text/html';
  const errors=assessAnonymousAccountBoundary(data).failures;
  for(const check of ['no-session-cookie:session','no-credential-body:session',
    'no-public-cache:account','json-only:blocked'])
    assert.ok(errors.includes(check),check);
});
test('anonymous response must be bounded, nonredirected and include privacy Vary',()=>{
  const data=fixture();
  data.session.redirected=true;
  data.account.durationMs=120_000;
  delete data.account.headers.vary;
  const errors=assessAnonymousAccountBoundary(data).failures;
  for(const check of ['single-response:session','single-response:account','account-privacy-vary'])
    assert.ok(errors.includes(check),check);
});
test('reads make exactly three query-free GET requests with no credential or mutation',async()=>{
  const data=fixture();
  const requests=[];
  const fetcher=async (url,options)=>{
    requests.push({url,options});
    let item;
    if(url.endsWith('/api/account'))item=data.account;
    else item=options.headers['X-DLKT-INFO-REQUEST']?data.session:data.blocked;
    return new Response(item.body,{status:item.status,headers:item.headers});
  };
  let tick=1000;
  const readings=await collectAnonymousAccountBoundary(fetcher,()=>tick+=10);
  assert.equal(assessAnonymousAccountBoundary(readings).status,'ANONYMOUS_ACCOUNT_BOUNDARY_PASS');
  assert.equal(requests.length,3);
  for(const x of requests){
    assert.ok(x.url===ACCOUNT_ORIGIN+'/api/account'||
      x.url===ACCOUNT_ORIGIN+'/api/account-session');
    assert.equal(x.url.includes('?'),false);
    assert.equal(x.options.method,'GET');
    assert.equal(x.options.credentials,'omit');
    assert.equal(x.options.redirect,'manual');
    assert.equal(x.options.cache,'no-store');
    assert.equal(x.options.headers.authorization,undefined);
    assert.equal(x.options.headers.cookie,undefined);
  }
  assert.equal(requests[0].options.headers.Origin,undefined);
  assert.equal(requests[1].options.headers.Origin,ACCOUNT_ORIGIN);
  assert.equal(requests[1].options.headers['X-DLKT-INFO-REQUEST'],'identity-v1');
  assert.equal(requests[2].options.headers['X-DLKT-INFO-REQUEST'],'account-v1');
});
test('oversized bodies and redirects fail closed',async()=>{
  await assert.rejects(
    collectAnonymousAccountBoundary(async()=>new Response('x',{
      headers:{'content-length':'999999'}})),
    /DLKT_ACCOUNT_RESPONSE_TOO_LARGE/,
  );
  const r=await collectAnonymousAccountBoundary(async()=>new Response('{}',{
    status:200,headers:headers(),
  }));
  assert.equal(assessAnonymousAccountBoundary(r).status,'ANONYMOUS_ACCOUNT_BOUNDARY_BLOCKED');
});
test('invalid report input is rejected, never treated as success',()=>{
  assert.throws(()=>assessAnonymousAccountBoundary(null),/DLKT_ACCOUNT_AUDIT_INPUT/);
  assert.throws(()=>assessAnonymousAccountBoundary({session:{}}),/DLKT_ACCOUNT_AUDIT_INPUT/);
});
