import test from 'node:test';
import assert from 'node:assert/strict';
import {AUDIENCE_TTL_SECONDS,issueAudienceToken,readAudienceToken,parseAudienceEvent,approximateGeography} from '../.build/src/audience/contracts.js';
const secret=Buffer.alloc(32,7).toString('base64url');
const other=Buffer.alloc(32,8).toString('base64url');
test('opaque tokens are random, purpose-separated, fixed-expiry and verified before deriving a storage key',()=>{
 const first=issueAudienceToken(secret,1000),second=issueAudienceToken(secret,1000);
 assert.notEqual(first,second);
 const key=readAudienceToken(first,secret,1000);
 assert.match(key,/^[0-9a-f]{64}$/);
 assert.equal(readAudienceToken(first,secret,1001),key);
 assert.notEqual(readAudienceToken(second,secret,1000),key);
 assert.equal(readAudienceToken(first,secret,1000+AUDIENCE_TTL_SECONDS),null);
 assert.equal(readAudienceToken(first,secret,999),null);
 assert.equal(readAudienceToken(first,other,1000),null);
 assert.equal(readAudienceToken(first.replace(/^v1/,'v2'),secret,1000),null);
 const [v,id,exp,sig]=first.split('.');
 assert.equal(readAudienceToken([v,id,Number(exp)+1,sig].join('.'),secret,1000),null);
 assert.throws(()=>issueAudienceToken('short',1000));
});
test('only explicit bounded pageview and presence payloads are accepted',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 assert.deepEqual(parseAudienceEvent({kind:'pageview',id,source:'search'}),{kind:'pageview',id,source:'search'});
 assert.deepEqual(parseAudienceEvent({kind:'presence'}),{kind:'presence'});
 for(const value of [null,[],{kind:'pageview',id,source:'https://example.test?email=x'},{kind:'pageview',id,source:'direct',email:'x'},{kind:'presence',ip:'127.0.0.1'},{kind:'pageview',id:'bad',source:'direct'},{kind:'presence',city:'Bucharest'}])assert.equal(parseAudienceEvent(value),null);
});
test('geography is approximate, trusted-ingress-only, decoded and bounded',()=>{
 const headers={'x-vercel-ip-country':'RO','x-vercel-ip-city':'Bucure%C8%99ti'};
 assert.deepEqual(approximateGeography(headers,false),{country:null,city:null});
 assert.deepEqual(approximateGeography(headers,true),{country:'RO',city:'București'});
 assert.deepEqual(approximateGeography({...headers,'x-vercel-ip-city':'%E0%A4%A'},true),{country:'RO',city:null});
 assert.deepEqual(approximateGeography({...headers,'x-vercel-ip-city':'%3Cscript%3E'},true),{country:'RO',city:null});
 assert.deepEqual(approximateGeography({...headers,'x-vercel-ip-country':'XX'},true),{country:null,city:null});
 assert.deepEqual(approximateGeography({...headers,'x-vercel-ip-city':['a','b']},true),{country:'RO',city:null});
});
