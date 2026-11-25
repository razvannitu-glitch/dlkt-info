import test from 'node:test';
import assert from 'node:assert/strict';
import {selectHomeLocal} from '../.build/src/iceo/home-local.js';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {localReading,localDiscoveryLabel} from '../.build/src/local/presentation.js';
import {referencePlaces} from '../.build/src/local/reference-places.js';
import {newsCard} from '../.build/src/local/service.js';
import {local as localNewsFixture} from './fixtures/news-corpus.mjs';

const now=Date.parse('2026-11-18T12:00:00Z'),checkedAt=new Date(now).toISOString();
const palma=findCity('2512989'),bucharest=findCity('683506'),london=findCity('2643743');
const forecast=city=>({id:'weather:'+city.id,kind:'forecast',title:'City-centre forecast',text:'Forecast: 8–10 °C.',publisher:'MET Norway',sourceUrl:`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${city.lat.toFixed(4)}&lon=${city.lon.toFixed(4)}`,sourceUpdatedAt:checkedAt,checkedAt,validFrom:checkedAt,validTo:new Date(now+3600000).toISOString(),facts:['Forecast values.'],boundary:'Forecast, not observed conditions.'});
const event=(id,start)=>({id,kind:'event',title:'Official event '+id,text:'Original event listing.',publisher:'PalmaCultura',sourceUrl:`https://www.palmacultura.com/ca/noticia/12345/event-${id}`,sourceUpdatedAt:null,checkedAt,validFrom:checkedAt,validTo:new Date(now+300000).toISOString(),facts:['Listed admission terms: gratuito'],boundary:'Confirm availability with the organiser.',context:{section:'discover',place:'Palma venue',when:'18 November, listed start',why:'Scheduled in the selected city.',action:'Check the organiser.',sourceDate:'2026-11-18',startsAt:start,status:'scheduled',documentHash:'a'.repeat(64),documentUrl:'https://www.palmacultura.com/index.php?Idi=2'}});
const announcement=(id,date)=>({...event(id,null),kind:'municipal-news',title:'Council announcement '+id,publisher:'Palma council',sourceUrl:'https://noticies.palma.es/-/announcement-'+id,context:{...event(id,null).context,section:'context',sourceDate:date,status:'publisher-announcement',documentUrl:'https://noticies.palma.es/-/announcement-'+id}});
const notice={...event('notice',null),kind:'transport-notice',title:'TIB notice',publisher:'TIB',sourceUrl:'https://www.tib.org/es/w/notice',context:{...event('notice',null).context,section:'essential',status:'operator-notice',documentUrl:'https://www.tib.org/es/w/notice'}};
const snapshot=(city,cards)=>({version:'dlkt-local-1',city,checkedAt,state:'partial',weatherState:cards.some(card=>card.kind==='forecast')?'ready':'unavailable',transportState:'not-covered',cards});
const arcub=id=>({...event(id,null),id:'bucharest:arcub:'+id.padStart(24,'0'),publisher:'ARCUB',sourceUrl:'https://arcub.ro/eveniment/listing-'+id,context:{...event(id,null).context,place:'Bucharest venue',when:'22 noiembrie',startsAt:null,documentUrl:'https://arcub.ro/agenda'}});
const bucharestSnapshot=()=>({...snapshot(bucharest,[forecast(bucharest),...Array.from({length:8},(_,index)=>arcub(String(index+1)))]),coverage:[{domain:'events',state:'partial',checkedAt,sourceUrl:'https://arcub.ro/agenda',note:'ARCUB agenda only.'}]});

test('a valid local edition is finite, diverse and preserves the original source records',()=>{
  const soon=event('soon','2026-11-18T13:00:00Z'),later=event('later','2026-11-18T18:00:00Z');
  const value=snapshot(palma,[later,announcement('old','2026-11-17'),notice,forecast(palma),soon,announcement('new','2026-11-18')]);
  assert.equal(currentLocalSnapshot(value,palma,now),true,'fixture uses the real browser contract');
  const before=JSON.stringify(value),selected=selectHomeLocal(value,palma,now);
  assert.deepEqual(selected.cards.map(card=>card.kind),['transport-notice','forecast','event','municipal-news','event','municipal-news']);
  assert.equal(selected.cards[2],soon);
  assert.equal(selected.cards[3].id,'new');
  assert.equal(selected.expiresAt,now+300000);
  assert.equal(JSON.stringify(value),before);
});

test('all eight ARCUB entries remain available before worldwide cards without inventing event dates',()=>{
  const value=bucharestSnapshot();assert.equal(currentLocalSnapshot(value,bucharest,now),true);
  const selected=selectHomeLocal(value,bucharest,now);
  assert.equal(selected.cards.length,9);
  const agenda=selected.cards.find(card=>card.kind==='event');
  assert.equal(agenda.context.startsAt,null);
  assert.equal(localDiscoveryLabel([agenda]),'From the ARCUB agenda');
  const reading=localReading(agenda,bucharest,now);
  assert.equal(reading.period,'22 noiembrie');
  assert.doesNotMatch(reading.paragraphs.join(' '),/today|tomorrow|tonight/i);
});

test('a foreign city, modified coordinates, poisoned URL, stale snapshot or expired card produces no homepage local cards',()=>{
  const fresh=snapshot(palma,[forecast(palma)]);
  for(const [value,city,clock] of [
    [fresh,london,now],
    [fresh,{...palma,lon:palma.lon+1},now],
    [{...fresh,cards:[{...fresh.cards[0],sourceUrl:'https://attacker.invalid/weather'}]},palma,now],
    [fresh,palma,now+300001],
    [{...fresh,cards:[{...fresh.cards[0],validTo:checkedAt,validFrom:new Date(now-1000).toISOString()}]},palma,now],
    [fresh,palma,now-6000],
  ])assert.deepEqual(selectHomeLocal(value,city,clock),{cards:[],expiresAt:null});
});

test('unknown location, unavailable source and malformed input leave room for independent world cards',()=>{
  for(const value of [null,undefined,{},'not a snapshot'])assert.deepEqual(selectHomeLocal(value,palma,now),{cards:[],expiresAt:null});
  assert.deepEqual(selectHomeLocal(snapshot(palma,[forecast(palma)]),null,now),{cards:[],expiresAt:null});
  assert.deepEqual(selectHomeLocal(snapshot(palma,[]),palma,now),{cards:[],expiresAt:null});
  assert.deepEqual(selectHomeLocal(snapshot(palma,[forecast(palma)]),palma,NaN),{cards:[],expiresAt:null});
});

test('local place references never fill an edition with directory cards',()=>{
  const value={...snapshot(bucharest,[]),places:referencePlaces(bucharest)};
  assert.ok(value.places.items.length>0);
  assert.equal(currentLocalSnapshot(value,bucharest,now),true);
  assert.deepEqual(selectHomeLocal(value,bucharest,now),{cards:[],expiresAt:null});
});

test('one expiring local record does not erase other current local information',()=>{
  const selected=event('selected','2026-11-18T13:00:00Z');
  const unselected={...event('unselected','2026-11-18T14:00:00Z'),validTo:new Date(now+45000).toISOString()};
  const value=snapshot(palma,[forecast(palma),selected,unselected]);
  const before=selectHomeLocal(value,palma,now);
  assert.equal(before.cards.find(card=>card.kind==='event'),selected);
  assert.equal(before.expiresAt,now+45000);
  const after=selectHomeLocal(value,palma,now+45000);assert.deepEqual(after.cards.map(card=>card.id),[forecast(palma).id,selected.id]);assert.equal(after.expiresAt,now+300000);
});

test('a future forecast window retains its meaning and is not treated as observed weather',()=>{
  const card={...forecast(palma),validFrom:new Date(now+600000).toISOString()};
  const selected=selectHomeLocal(snapshot(palma,[card]),palma,now);
  assert.equal(selected.cards[0],card);
  assert.equal(selected.cards[0].boundary,'Forecast, not observed conditions.');
  assert.equal(selected.expiresAt,now+300000);
});

test('the continuous local stream retains more than twelve validated operational records',()=>{
  const events=Array.from({length:14},(_,index)=>event('continuous-'+index,new Date(now+3600000+index*60000).toISOString()));
  const value=snapshot(palma,[forecast(palma),...events]),before=JSON.stringify(value);
  assert.equal(currentLocalSnapshot(value,palma,now),true);
  const selected=selectHomeLocal(value,palma,now);
  assert.equal(selected.cards.length,15,'the previous homepage display cap does not drop checked records');
  assert.deepEqual(new Set(selected.cards),new Set(value.cards));
  assert.equal(new Set(selected.cards.map(card=>card.id)).size,15);
  assert.deepEqual(selected.cards.filter(card=>card.kind==='event'),events);
  assert.equal(JSON.stringify(value),before);
});

test('city news does not hide additional eligible events of the same kind',()=>{
  const local=localNewsFixture(3,{now,published:now-10000}),base=bucharestSnapshot();
  const news=local.snapshot.articles.map(article=>newsCard(article,bucharest));
  const value={...base,cards:[...base.cards,...news],newsSources:local.snapshot.sources},before=JSON.stringify(value);
  assert.equal(currentLocalSnapshot(value,bucharest,now),true,'city originals and health use the actual local contracts');
  const selected=selectHomeLocal(value,bucharest,now);
  assert.equal(selected.cards.filter(card=>card.kind==='event').length,8,'the previous two-per-kind cap does not discard events');
  assert.equal(selected.cards.filter(card=>card.kind==='local-news').length,3);
  assert.equal(selected.cards.length,12);
  assert.deepEqual(new Set(selected.cards),new Set(value.cards));
  assert.equal(JSON.stringify(value),before);
});
