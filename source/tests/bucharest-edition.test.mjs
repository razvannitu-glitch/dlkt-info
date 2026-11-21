import test from 'node:test';
import assert from 'node:assert/strict';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot,validLocalSnapshot} from '../.build/src/local/contracts.js';
import {copyLocal,parseDaily,profileKey} from '../.build/src/daily/contracts.js';
import {selectDaily} from '../.build/src/daily/selection.js';
import {PublicationCache} from '../.build/src/local/publications.js';
import {CMTEB_SOURCE} from '../.build/src/local/cmteb.js';

const now=Date.parse('2026-11-18T12:00:00Z'),checkedAt=new Date(now).toISOString(),city=findCity('683506');
const event=(precision)=>({id:'bucharest:arcub:'+ (precision==='day'?'a':'b').repeat(24),kind:'event',title:'Controlled event',text:'Published schedule.',publisher:'ARCUB',sourceUrl:'https://arcub.ro/eveniment/controlled-'+precision,sourceUpdatedAt:null,checkedAt,validFrom:checkedAt,validTo:new Date(now+300000).toISOString(),facts:['Schedule from the organiser.'],boundary:'Ticket availability is not known.',context:{section:'discover',place:'Bucharest venue',when:precision==='day'?'18–20 November 2026':'20 November 2026 19:00',why:'Published schedule.',action:'Check the organiser.',sourceDate:'2026-11-18',startsAt:precision==='day'?'2026-11-17T22:00:00.000Z':'2026-11-20T17:00:00.000Z',...(precision==='day'?{endsAt:'2026-11-20T22:00:00.000Z'}:{}),datePrecision:precision,status:'scheduled',documentHash:'c'.repeat(64),documentUrl:'https://arcub.ro/eveniment/controlled-'+precision}});
const snapshot=()=>({version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:'unavailable',transportState:'not-covered',cards:[event('day'),event('minute')],coverage:[{domain:'events',state:'partial',checkedAt,sourceUrl:'https://arcub.ro/agenda',note:'ARCUB schedules only.'}]});

test('saving and reading an enriched Bucharest edition preserves exact day and minute semantics',()=>{
 const local=snapshot();assert.equal(currentLocalSnapshot(local,city,now),true);
 const copied=copyLocal(local);assert.equal(validLocalSnapshot(copied,city.id),true);assert.equal(currentLocalSnapshot(copied,city,now),true);
 assert.deepEqual(copied.cards.map(c=>c.context),local.cards.map(c=>c.context));
 const profile={cityId:city.id,topics:[],query:'',budget:6,timezone:city.timezone};
 const state={version:'dlkt-personal-edition-1',revision:'12345678-1234-4123-8123-123456789012',profile,edition:{generatedAt:checkedAt,profileKey:profileKey(profile),topicState:'not-selected',local,records:[],complete:false},feedback:[]};
 const first=parseDaily(state);assert.ok(first);const second=parseDaily(JSON.parse(JSON.stringify(first)));assert.ok(second);
 assert.deepEqual(second.edition.local.cards.map(c=>c.context),local.cards.map(c=>c.context));
 const selected=selectDaily(profile,null,local,null,[],now);assert.equal(selected.items.length,2,'ongoing day listing and future minute listing are retained');
 assert.doesNotMatch(selected.notes.join(' '),/TIB notices|Utility interruptions.*not connected/);
});

test('a fresh agenda can reuse still-current matching detail documents without dropping the local edition',()=>{
 const local=snapshot(),older=new Date(now-20000).toISOString();
 for(const card of local.cards){card.checkedAt=older;card.validFrom=older;card.validTo=new Date(now+280000).toISOString();}
 assert.equal(currentLocalSnapshot(local,city,now),true);
 local.cards[0].checkedAt=new Date(now-300001).toISOString();assert.equal(currentLocalSnapshot(local,city,now),false);
});

test('CMTEB acquisition permits only its reviewed public endpoint and treats content denial as denial',async()=>{
 for(const robotsStatus of [403,404,410]){
  const calls=[];const cache=new PublicationCache(async url=>{calls.push(url);return url.endsWith('/robots.txt')?new Response('',{status:robotsStatus}):new Response('<html>operational facts</html>',{headers:{'content-type':'text/html'}});},()=>now);
  assert.match((await cache.read(CMTEB_SOURCE)).body,/operational facts/);assert.equal(calls.length,2);
  await assert.rejects(cache.read('https://www.cmteb.ro/private'),/PUBLICATION_URL/);
 }
 for(const denied of [401,429,500]){
  let calls=0;const cache=new PublicationCache(async()=>{calls++;return new Response('',{status:denied});},()=>now);
  await assert.rejects(cache.read(CMTEB_SOURCE));assert.equal(calls,1);
 }
 const blocked=new PublicationCache(async url=>url.endsWith('/robots.txt')?new Response('User-agent: *\nDisallow: /functionare_sistem_termoficare.php',{headers:{'content-type':'text/plain'}}):new Response('blocked'),()=>now);
 await assert.rejects(blocked.read(CMTEB_SOURCE),/PUBLICATION_ROBOTS/);
 const contentDenied=new PublicationCache(async url=>new Response('',{status:url.endsWith('/robots.txt')?404:403}),()=>now);
 await assert.rejects(contentDenied.read(CMTEB_SOURCE),/PUBLICATION_HTTP/);
});
