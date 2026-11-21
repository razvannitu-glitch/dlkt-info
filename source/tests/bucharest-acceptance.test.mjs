import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicationCache,LocalPublicationService,parseCulture} from '../.build/src/local/publications.js';
import {ARCUB_AGENDA,parseArcubAgenda} from '../.build/src/local/arcub.js';
import {LocalBriefingService} from '../.build/src/local/service.js';
import {currentLocalSnapshot,localCardLabel} from '../.build/src/local/contracts.js';
import {localReading,localDiscoveryLabel,localCoverageReading} from '../.build/src/local/presentation.js';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot as currentPublicSnapshot,localCardLabel as publicCardLabel} from '../public/local-contracts.js';

const now=Date.parse('2026-11-17T18:00:00Z');
const checkedAt=new Date(now).toISOString();
const city=findCity('683506'),palma=findCity('2512989');
assert.ok(city);assert.ok(palma);
const agenda='<div class="pgrid-item"><a href="https://arcub.ro/eveniment/fixture-concert"><h3>Fixture concert</h3><div class="meta"><span>20 noiembrie</span><span>Hanul Gabroveni</span></div></a></div>';
const unavailableWeather={read:async()=>{throw Error('FIXTURE_WEATHER_UNAVAILABLE');}};
async function bucharestSnapshot(body=agenda) {
 const fetcher=async url=>{
  if(url==='https://arcub.ro/robots.txt')return new Response('User-agent: *\nDisallow:\n',{headers:{'content-type':'text/plain'}});
  if(url===ARCUB_AGENDA)return new Response(body,{headers:{'content-type':'text/html'}});
  throw Error('UNEXPECTED_FIXTURE_REQUEST '+url);
 };
 const publications=new LocalPublicationService(new PublicationCache(fetcher,()=>now),()=>now);
 return new LocalBriefingService(unavailableWeather,undefined,()=>now,publications).snapshot(city);
}
const clone=v=>JSON.parse(JSON.stringify(v));
test('ARCUB parser through publication and local services reaches the actual browser validator and truthful renderer',async()=>{
 const snapshot=await bucharestSnapshot();
 assert.equal(snapshot.cards.length,1);
 assert.equal(snapshot.state,'partial');
 assert.equal(snapshot.cards[0].context.startsAt,null);
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 assert.equal(currentPublicSnapshot(snapshot,city,now),true);
 assert.equal(publicCardLabel(snapshot.cards[0]),'From the ARCUB agenda');
 assert.equal(localCardLabel(snapshot.cards[0]),'From the ARCUB agenda');
 const reading=localReading(snapshot.cards[0],city,now);
 assert.match(reading.paragraphs.join(' '),/Listed on the ARCUB agenda: 20 noiembrie/u);
 assert.equal(reading.period,'20 noiembrie');
 assert.match(reading.nextStep,/Confirm the date, time and tickets/u);
 assert.doesNotMatch(localCardLabel(snapshot.cards[0]),/today|upcoming|verified/iu);
});
test('Bucharest ARCUB browser acceptance rejects foreign identities, invented dates and incoherent coverage',async()=>{
 const good=await bucharestSnapshot();
 const mutations=[
  ['foreign publisher',s=>{s.cards[0].publisher='Another publisher';}],
  ['foreign host',s=>{s.cards[0].sourceUrl='https://evil.example/eveniment/fixture-concert';}],
  ['Palma event',s=>{s.cards[0].sourceUrl='https://www.palmacultura.com/es/noticia/12345/concert';s.cards[0].context.documentUrl='https://www.palmacultura.com/index.php?Idi=2';}],
  ['foreign document',s=>{s.cards[0].context.documentUrl='https://www.tib.org/es/avisos';}],
  ['wrong card id',s=>{s.cards[0].id='palma:other';}],
  ['wrong status',s=>{s.cards[0].context.status='publisher-announcement';}],
  ['wrong kind',s=>{s.cards[0].kind='municipal-news';}],
  ['invented start',s=>{s.cards[0].context.startsAt='2026-11-20T18:00:00Z';}],
  ['invented publication',s=>{s.cards[0].sourceUpdatedAt=checkedAt;}],
  ['wrong checked date',s=>{s.cards[0].context.sourceDate='2026-11-16';}],
  ['wrong validity start',s=>{s.cards[0].validFrom='2026-11-17T17:59:00Z';}],
  ['extended validity',s=>{s.cards[0].validTo='2026-11-17T18:06:00Z';}],
  ['coverage missing',s=>{delete s.coverage;}],
  ['coverage invented ready',s=>{s.coverage[0].state='ready';}],
  ['coverage wrong source',s=>{s.coverage[0].sourceUrl='https://www.palmacultura.com/index.php?Idi=2';}],
  ['coverage wrong domain',s=>{s.coverage[0].domain='administration';}],
  ['coverage wrong clock',s=>{s.coverage[0].checkedAt='2026-11-17T17:59:00Z';}],
  ['snapshot invented ready',s=>{s.state='ready';}],
 ];
 for(const [name,mutate] of mutations){const snapshot=clone(good);mutate(snapshot);assert.equal(currentLocalSnapshot(snapshot,city,now),false,name);}
 assert.equal(currentLocalSnapshot(good,city,now+300000),false,'exact expiry');
 const wrongCity=clone(good);wrongCity.city=palma;assert.equal(currentLocalSnapshot(wrongCity,palma,now),false,'ARCUB cannot be moved into Palma');
 const wrongCountry={...city,countryCode:'ES'};assert.equal(currentLocalSnapshot({...good,city:wrongCountry},wrongCountry,now),false,'Bucharest identity cannot claim another country');
});
test('failed ARCUB acquisition stays a valid unavailable browser state without fabricated cards',async()=>{
 const snapshot=await bucharestSnapshot('<html></html>');
 assert.deepEqual(snapshot.cards,[]);
 assert.equal(snapshot.state,'unavailable');
 assert.equal(snapshot.coverage[0].state,'unavailable');
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const invented=clone(snapshot);invented.coverage[0].state='partial';
 assert.equal(currentLocalSnapshot(invented,city,now),false);
});
test('Palma upcoming today acceptance and its strict clock rules are preserved',async()=>{
 const body='<div class="box"><h3><a href="/ca/noticia/12345/fixture-concert">Palma fixture concert</a></h3><p><strong>Fecha:</strong> 17 de noviembre de 2026<br><strong>Hora:</strong> 21 h<br><strong>Lugar:</strong> Municipal theatre<br><strong>Dirección:</strong> Main square, 2<br><strong>Precio:</strong> entrada libre con reserva previa</p></div>';
 const parsed=parseCulture({body,checkedAt},now);
 assert.equal(parsed.cards.length,1);
 const publications={snapshot:async()=>({cards:parsed.cards,coverage:[]})};
 const snapshot=await new LocalBriefingService(unavailableWeather,undefined,()=>now,publications).snapshot(palma);
 assert.equal(currentLocalSnapshot(snapshot,palma,now),true);
 assert.equal(localCardLabel(snapshot.cards[0]),'Discover today');
 for(const start of [null,checkedAt,'2026-11-18T20:00:00Z']){
  const invalid=clone(snapshot);invalid.cards[0].context.startsAt=start;
  assert.equal(currentLocalSnapshot(invalid,palma,now),false,String(start));
 }
 const misplaced=clone(snapshot);misplaced.city=city;
 assert.equal(currentLocalSnapshot(misplaced,city,now),false,'Palma event cannot be moved into Bucharest');
});

test('ARCUB parser cannot attribute a Palma or foreign publisher event to ARCUB',async()=>{
 const crossed=agenda+agenda.replace('https://arcub.ro/eveniment/fixture-concert','https://www.palmacultura.com/es/noticia/12345/concert');
 const parsed=parseArcubAgenda({body:crossed,checkedAt},now);
 assert.equal(parsed.cards.length,1);
 assert.equal(parsed.rejected,1);
 assert.equal(parsed.cards[0].sourceUrl,'https://arcub.ro/eveniment/fixture-concert');
 const snapshot=await bucharestSnapshot(crossed);
 assert.equal(snapshot.cards.length,1);
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 assert.throws(()=>parseArcubAgenda({body:crossed.slice(agenda.length),checkedAt},now),/ARCUB_NO_VALID_EVENTS/u);
});
test('ARCUB section heading and partial coverage describe a limited agenda without claiming today or unverified rows',async()=>{
 const snapshot=await bucharestSnapshot();
 assert.equal(localDiscoveryLabel(snapshot.cards),'From the ARCUB agenda');
 const notes=localCoverageReading(snapshot,now).map(x=>x.text).join(' ');
 assert.match(notes,/limited to the ARCUB agenda/u);
 assert.doesNotMatch(notes,/Some source records could not be verified|start time still ahead today/u);
 const empty={...snapshot,cards:[]};
 assert.match(localCoverageReading(empty,now).map(x=>x.text).join(' '),/No current ARCUB agenda entry/u);
 assert.equal(localDiscoveryLabel([{...snapshot.cards[0],context:{...snapshot.cards[0].context,startsAt:'2026-11-17T20:00:00Z'}}]),'Discover today');
});
