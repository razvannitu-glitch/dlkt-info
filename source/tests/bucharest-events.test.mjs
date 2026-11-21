import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArcubAgenda,ARCUB_AGENDA} from '../.build/src/local/arcub.js';
import {PublicationCache,LocalPublicationService} from '../.build/src/local/publications.js';
import {localSource,validLocalSnapshot} from '../.build/src/local/contracts.js';
import {findCity} from '../.build/src/local/cities.js';

const now=Date.parse('2026-11-17T18:00:00Z');
const checkedAt=new Date(now).toISOString();
const eventUrl='https://arcub.ro/eveniment/intalniri-cu-oameni-pasari';
const event=(url=eventUrl,title='Concert at ARCUB',when='20 noiembrie',place='Hanul Gabroveni')=>
 '<div class="pgrid-item"><div class="project-box"><a href="'+url+'"><div class="head"><h3>'+title+'</h3><div class="meta"><span>'+when+'</span><span>'+place+'</span></div></div></a></div></div>';
const html=(...entries)=>'<html><body><div class="pgrid">'+entries.join('')+'</div></body></html>';
const document=(body)=>({body,checkedAt});
const good=html(event());
const fakeFetch=(agenda=good,robots='User-agent: *\nDisallow:\n',type='text/html')=>async url=>{
 if(url==='https://arcub.ro/robots.txt')return new Response(robots,{status:200,headers:{'content-type':'text/plain'}});
 if(url===ARCUB_AGENDA)return new Response(agenda,{status:200,headers:{'content-type':type}});
 throw Error('Unexpected outbound request '+url);
};

test('ARCUB entries are labelled publisher listings; an absent event year or time is never inferred',()=>{
 const parsed=parseArcubAgenda(document(good),now);
 assert.equal(parsed.scanned,1);
 assert.equal(parsed.rejected,0);
 assert.equal(parsed.cards.length,1);
 const card=parsed.cards[0];
 assert.equal(card.kind,'event');
 assert.equal(card.publisher,'ARCUB');
 assert.equal(card.context?.when,'20 noiembrie');
 assert.equal(card.context?.startsAt,null);
 assert.equal(card.context?.documentUrl,ARCUB_AGENDA);
 assert.equal(card.context?.sourceDate,'2026-11-17');
 assert.equal(card.text.includes('2026'),false);
 assert.equal(card.sourceUpdatedAt,null);
 assert.match(card.boundary,/not a complete Bucharest event feed/u);
 assert.equal(localSource(card.sourceUrl,'event'),true);
});
test('only the exact ARCUB event host and event paths are accepted; duplicates and tracking links are rejected',()=>{
 assert.equal(localSource(eventUrl,'event'),true);
 for(const url of ['http://arcub.ro/eveniment/x','https://arcub.ro.evil.example/eveniment/x','https://arcub.ro/eveniment/x?utm_source=tracking','https://arcub.ro/admin','https://arcub.ro@evil.example/eveniment/x','https://evil.example/eveniment/x'])
  assert.equal(localSource(url,'event'),false,url);
 const parsed=parseArcubAgenda(document(html(event(),event(),event('https://arcub.ro.evil.example/eveniment/x'),event('https://arcub.ro/eveniment/two','Another event','23 noiembrie'))),now);
 assert.equal(parsed.scanned,4);
 assert.equal(parsed.cards.length,2);
 assert.equal(parsed.rejected,2);
});
test('malformed, oversized, altered, or stale agenda payloads fail closed',()=>{
 assert.throws(()=>parseArcubAgenda(document('<html></html>'),now),/ARCUB_STRUCTURE/u);
 assert.throws(()=>parseArcubAgenda(document('x'.repeat(1_048_577)),now),/ARCUB_DOCUMENT/u);
 assert.throws(()=>parseArcubAgenda(document(html(event('https://evil.example/eveniment/fake'))),now),/ARCUB_NO_VALID_EVENTS/u);
 assert.throws(()=>parseArcubAgenda({...document(good),checkedAt:new Date(now-3600000).toISOString()},now),/ARCUB_FRESHNESS/u);
 assert.throws(()=>parseArcubAgenda({...document(good),checkedAt:new Date(now+300000).toISOString()},now),/ARCUB_FRESHNESS/u);
 assert.throws(()=>parseArcubAgenda(document(html(...Array.from({length:41},()=>event()))),now),/ARCUB_STRUCTURE/u);
 assert.throws(()=>parseArcubAgenda(document(html(event(eventUrl,'A','TBD','Unknown'))),now),/ARCUB_NO_VALID_EVENTS/u);
});
test('publisher robots policy and MIME are enforced before local cards are built',async()=>{
 const cache=new PublicationCache(fakeFetch(good,'User-agent: *\nDisallow: /agenda\n'),()=>now);
 await assert.rejects(cache.read(ARCUB_AGENDA),/PUBLICATION_ROBOTS/u);
 const wrong=new PublicationCache(fakeFetch(good,'User-agent: *\nDisallow:\n','application/json'),()=>now);
 await assert.rejects(wrong.read(ARCUB_AGENDA),/PUBLICATION_TYPE/u);
 const restricted=new PublicationCache(fakeFetch(),()=>now);
 await assert.rejects(restricted.read('https://arcub.ro/private'),/PUBLICATION_URL/u);
 await assert.rejects(restricted.read('https://attacker.example/agenda'),/PUBLICATION_URL/u);
});
test('Bucharest publication snapshot is source-backed, explicitly partial, and conforms to the shared contract',async()=>{
 const city=findCity('683506');
 assert.ok(city);
 const publication=new LocalPublicationService(new PublicationCache(fakeFetch(),()=>now),()=>now);
 const snapshot=await publication.snapshot(city);
 assert.equal(snapshot.cards.length,1);
 assert.equal(snapshot.coverage[0]?.state,'partial');
 assert.equal(snapshot.coverage[0]?.sourceUrl,ARCUB_AGENDA);
 const assembled={version:'dlkt-local-1',city,checkedAt,weatherState:'unavailable',transportState:'not-covered',state:'partial',cards:snapshot.cards,coverage:snapshot.coverage};
 assert.equal(validLocalSnapshot(assembled,city.id),true);
});
test('source failure returns unavailability, not fabricated Bucharest events',async()=>{
 const city=findCity('683506');
 assert.ok(city);
 const publication=new LocalPublicationService(new PublicationCache(fakeFetch('<html/>'),()=>now),()=>now);
 const result=await publication.snapshot(city);
 assert.deepEqual(result.cards,[]);
 assert.equal(result.coverage[0]?.state,'unavailable');
 assert.equal(result.coverage[0]?.sourceUrl,ARCUB_AGENDA);
});
