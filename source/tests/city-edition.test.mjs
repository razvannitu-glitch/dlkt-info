import {selectDaily} from '../.build/src/daily/selection.js';
import {nextReadingBoundary} from '../.build/src/daily/reading.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {CITY_NEWS_FEEDS} from '../.build/src/local/news-policy.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';
import {LocalBriefingService,newsCard} from '../.build/src/local/service.js';
import {parseCmteb,CMTEB_SOURCE} from '../.build/src/local/cmteb.js';
import {weatherCard} from '../.build/src/local/weather.js';
import {copyLocal,parseDaily,profileKey} from '../.build/src/daily/contracts.js';
import {selectHomeLocal,selectHomeLanguage} from '../.build/src/iceo/home-local.js';
import {keyThing} from '../.build/src/glance/presentation.js';

const now=Date.parse('2026-11-18T20:30:00.000Z'),checkedAt=new Date(now).toISOString(),city=findCity('683506');
const b365=CITY_NEWS_FEEDS.find(source=>source.id==='bucharest-b365'),buletin=CITY_NEWS_FEEDS.find(source=>source.id==='bucharest-buletin');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function parsed(source,titles,offset=0,published='Wed, 18 Nov 2026 18:00:00 +0000'){
 const items=titles.map((title,index)=>{
  const number=offset+index+1,url=source.id===b365.id?`https://b365.ro/control-local-${123450+number}/`:`https://buletin.de/bucuresti/control-local-${number}/`;
  return `<item><title>${escape(title)}</title><link>${url}</link><pubDate>${published}</pubDate><description>Consultati articolul pentru detalii.</description><dc:creator>Autor Exemplu</dc:creator><category>Stiri Bucuresti</category></item>`;
 });
 const body=`<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escape(source.title)}</title><link>${source.home}</link>${items.join('')}</channel></rss>`;
 const result=parseLocalNews(body,source.id,city,checkedAt,now);
 assert.equal(result.rejected,0,'controlled RSS entries must pass the real parser');
 assert.equal(result.articles.length,titles.length);
 return result.articles;
}
function health(articles){return CITY_NEWS_FEEDS.map(source=>({sourceId:source.id,publisher:source.publisher,feedUrl:source.endpoint,termsUrl:source.termsUrl,state:'ready',checkedAt,count:articles.filter(article=>article.sourceId===source.id).length,rejected:0,error:null}));}
function local(articles,support=[]){
 const cards=[...support,...articles.map(article=>newsCard(article,city))],coverage=[];
 if(support.some(card=>card.kind==='event'))coverage.push({domain:'events',state:'partial',checkedAt,sourceUrl:'https://arcub.ro/agenda',note:'Controlled ARCUB schedule.'});
 if(support.some(card=>card.kind==='utility-notice'))coverage.push({domain:'utilities',state:'partial',checkedAt,sourceUrl:CMTEB_SOURCE,note:'Controlled CMTEB operator list.'});
 return {version:'dlkt-local-1',city,checkedAt,state:cards.length?'partial':'unavailable',weatherState:support.some(card=>card.kind==='forecast')?'ready':'unavailable',transportState:'not-covered',cards,newsSources:health(articles),...(coverage.length?{coverage}:{})};
}
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function stateFor(snapshot){const profile={cityId:city.id,topics:[],query:'',budget:6,timezone:city.timezone};return {version:'dlkt-personal-edition-1',revision:'12345678-1234-4123-8123-123456789012',profile,edition:{generatedAt:checkedAt,profileKey:profileKey(profile),topicState:'not-selected',local:snapshot,records:[],complete:false},feedback:[]};}
function heating(){
 const headings='<tr><th>Sector</th><th>Zone afectate</th><th>Agentul termic afectat</th><th>Cauza / Descrierea interventiei</th><th>Data/ora estimarii punerii in functiune</th></tr>';
 const rows=[1,2,6].map(sector=>`<tr><td>${sector}</td><td>Punct termic -- 4 blocuri/imobile<br>• Str Exemplu - bl. PRIVATE</td><td>Oprire ACC/INC</td><td>Operator cause</td><td>18.11.2026 23:30</td></tr>`).join('');
 return parseCmteb({body:`<div id="ST"><table>${headings}${rows}</table></div>`,checkedAt},now).cards;
}
function event(index){return {id:'bucharest:arcub:'+index.toString(16).padStart(24,'0'),kind:'event',title:'Controlled local event '+index,text:'Published listing.',publisher:'ARCUB',sourceUrl:'https://arcub.ro/eveniment/controlled-event-'+index,sourceUpdatedAt:null,checkedAt,validFrom:checkedAt,validTo:new Date(now+300000).toISOString(),facts:['Listing from the organiser.'],boundary:'Exact event time is not established.',context:{section:'discover',place:'Bucharest venue',when:'Date not specified',why:'Publisher agenda listing.',action:'Check organiser.',sourceDate:'2026-11-18',startsAt:null,status:'scheduled',documentHash:'a'.repeat(64),documentUrl:'https://arcub.ro/agenda'}};}
function weatherPayload(){const start=Math.ceil(now/3600000)*3600000;return {type:'Feature',geometry:{coordinates:[city.lon,city.lat]},properties:{meta:{updated_at:checkedAt,units:{air_temperature:'celsius',wind_speed:'m/s',precipitation_amount:'mm'}},timeseries:Array.from({length:7},(_,index)=>({time:new Date(start+index*3600000).toISOString(),data:{instant:{details:{air_temperature:7,wind_speed:1}},next_1_hours:{details:{precipitation_amount:0}}}}))}};}
function forecast(){return weatherCard(weatherPayload(),city,checkedAt,now);}
const globalPublication=()=>({id:'a'.repeat(24),identity:'nasa:controlled',title:'A global science publication',topic:'science',kind:'publication',sourceUrl:'https://www.nasa.gov/news-release/controlled/',publisher:'NASA',sourceIds:['nasa-news'],date:'2026-11-18T20:00:00Z',dateLabel:'Published',observedAt:checkedAt,contentHash:'b'.repeat(64),boundary:'Publisher metadata, not an independently verified report.',deadline:null,version:null,attribution:'NASA',sourceState:'verified'});

test('real RSS parser, news wrapper and local service preserve current city articles despite an unavailable forecast',async()=>{
 const articles=[...parsed(b365,['Bucuresti: Metrorex anunta programul magistralei 6']),...parsed(buletin,['Bucuresti: Scoala 27 publica inscrierile pentru elevi'])];
 const service=new LocalBriefingService({read:async()=>{throw Error('WEATHER_UNAVAILABLE');}},{read:async()=>{throw Error('UNEXPECTED_TRANSIT');}},()=>now,{snapshot:async()=>({cards:[],coverage:[]})},null,{snapshot:async()=>({articles,sources:health(articles)})});
 const snapshot=await service.snapshot(city);
 assert.equal(snapshot.state,'partial');assert.equal(snapshot.weatherState,'unavailable');assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 assert.deepEqual(snapshot.cards.map(card=>card.news),articles);assert.deepEqual(snapshot.newsSources,health(articles));
 for(const card of snapshot.cards){assert.equal(card.context.documentUrl,card.news.documentUrl);assert.equal(card.context.documentHash,card.news.documentHash);assert.equal(card.sourceUpdatedAt,null);assert.equal(card.context.sourceDate,card.news.publishedAt.slice(0,10));assert.equal(card.sourceUrl,card.news.url);assert.equal(card.validTo,card.news.validUntil);}
 assert.equal(currentLocalSnapshot(snapshot,city,now+300000),false,'a check cannot be silently renewed');
});

test('daily persistence round trip preserves news evidence, licence, anchors and source health without sharing mutable arrays',()=>{
 const articles=[...parsed(b365,['Bucuresti: Metrorex schimba programul magistralei 6']),...parsed(buletin,['Bucuresti: Scoala 28 prezinta calendarul pentru elevi'])];
 const snapshot=freeze(local(articles));assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const copied=copyLocal(snapshot);assert.deepEqual(copied,snapshot);assert.notEqual(copied.newsSources,snapshot.newsSources);assert.notEqual(copied.cards[0].news.geoAnchors,snapshot.cards[0].news.geoAnchors);
 copied.cards[0].news.geoAnchors.push('Unverified place');copied.newsSources[0].count=19;
 assert.equal(snapshot.newsSources[0].count,1);assert.equal(snapshot.cards[0].news.geoAnchors.includes('Unverified place'),false);
 const first=parseDaily(stateFor(snapshot));assert.ok(first);const second=parseDaily(JSON.parse(JSON.stringify(first)));assert.ok(second);
 assert.deepEqual(second.edition.local,snapshot);assert.equal(currentLocalSnapshot(second.edition.local,city,now),true);
 const credited=second.edition.local.cards.find(card=>card.news.sourceId===buletin.id).news;assert.equal(credited.byline,'By Autor Exemplu');assert.equal(credited.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');
});

test('local and daily boundaries reject modified source identity, publisher, geography, wrapper and health counts',()=>{
 const snapshot=local([...parsed(b365,['Bucuresti: Metrorex publica programul magistralei 6']),...parsed(buletin,['Bucuresti: Scoala 29 publica programul pentru elevi'])]);
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const mutations=[
  ['missing source health',value=>{delete value.newsSources;}],
  ['wrong source count',value=>{value.newsSources[0].count=2;}],
  ['wrong feed origin',value=>{value.newsSources[0].feedUrl='https://example.com/feed/';}],
  ['news from another city',value=>{value.cards[0].news.cityId='2643743';}],
  ['forged geographic anchor',value=>{value.cards[0].news.geoAnchors=['London'];}],
  ['forged publisher',value=>{value.cards[0].news.publisher='UK Government';}],
  ['publisher text changed only in wrapper',value=>{value.cards[0].title='A replacement title';}],
  ['evidence URL changed only in context',value=>{value.cards[0].context.documentUrl='https://example.com/feed/';}],
  ['source health claims no access while keeping stories',value=>{value.newsSources[0].state='unavailable';value.newsSources[0].checkedAt=null;value.newsSources[0].error='NEWS_HTTP';}],
  ['stale source timestamp',value=>{value.cards[0].news.checkedAt=new Date(now-300001).toISOString();}],
  ['news metadata on another kind',value=>{value.cards[0].kind='event';}],
 ];
 for(const [name,mutate] of mutations){const changed=structuredClone(snapshot);mutate(changed);assert.equal(currentLocalSnapshot(changed,city,now),false,name);assert.equal(parseDaily(stateFor(changed)),null,name+' must also fail on browser persistence');}
});

test('home selection leads with diverse current city news, bounds repetition and total size, and leaves raw evidence unchanged',()=>{
 const titles=(offset)=>Array.from({length:8},(_,index)=>[
  `Bucuresti: Metrorex publica programul liniei ${offset+index}`,
  `Bucuresti: Scoala ${offset+index} publica inscrierile pentru elevi`,
  `Bucuresti: Termoenergetica publica anuntul ${offset+index}`,
  `Bucuresti: Primaria prezinta masura ${offset+index} pentru mediu`,
 ][index%4]);
 const articles=[...parsed(b365,titles(100)),...parsed(buletin,titles(200))],snapshot=freeze(local(articles,[...heating(),forecast(),...Array.from({length:8},(_,index)=>event(index+1))]));
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);const before=JSON.stringify(snapshot),selected=selectHomeLocal(snapshot,city,now),news=selected.cards.filter(card=>card.kind==='local-news');
 assert.equal(news.length,8);assert.equal(selected.cards.length,12);assert.deepEqual(selected.cards.slice(0,news.length),news);assert.equal(new Set(news.map(card=>card.publisher)).size,2);assert.ok(new Set(news.map(card=>card.news.topic)).size>=3);
 for(const publisher of new Set(news.map(card=>card.publisher)))assert.ok(news.filter(card=>card.publisher===publisher).length<=4);
 for(const topic of new Set(news.map(card=>card.news.topic)))assert.ok(news.filter(card=>card.news.topic===topic).length<=3);
 assert.equal(selected.cards.filter(card=>card.kind==='event').length,2);assert.equal(selected.cards.filter(card=>card.kind==='utility-notice').length,1);assert.equal(new Set(selected.cards.map(card=>card.id)).size,selected.cards.length);
 assert.equal(selected.expiresAt,now+300000);assert.equal(JSON.stringify(snapshot),before);assert.equal(selectHomeLocal(snapshot,city,now+300000).cards.length,0);
});

test('identical normalized publisher headlines are grouped while route numbers remain distinct',()=>{
 const same='Bucuresti: Metrorex modifica programul magistralei 6';
 const duplicates=local([...parsed(b365,[same]),...parsed(buletin,['VIDEO: '+same])]);
 assert.equal(currentLocalSnapshot(duplicates,city,now),true);assert.equal(selectHomeLocal(duplicates,city,now).cards.length,1);
 const routes=local(parsed(b365,['Bucuresti: tramvai 41 circula pe traseul modificat astazi','Bucuresti: tramvai 42 circula pe traseul modificat astazi']));
 assert.equal(selectHomeLocal(routes,city,now).cards.length,2,'different numbered services are separate reports');
});

test('opposite local claims remain separate even when every other word matches',()=>{
 const claims=local([...parsed(b365,['Bucuresti: Metrorex confirma ca trenurile circula normal pe magistrala 6 in cursul zilei de astazi']),...parsed(buletin,['Bucuresti: Metrorex confirma ca trenurile nu circula normal pe magistrala 6 in cursul zilei de astazi'])]);
 assert.equal(currentLocalSnapshot(claims,city,now),true);
 const selected=selectHomeLocal(claims,city,now);assert.equal(selected.cards.length,2,'fuzzy overlap must not erase a negation or an opposing report');assert.ok(selected.cards.some(card=>card.title.includes(' nu circula ')));assert.ok(selected.cards.some(card=>card.title.includes(' trenurile circula ')));
});

test('CMTEB is one derived overview in the home projection while original sector evidence remains independently valid',()=>{
 const sectors=heating(),snapshot=freeze(local([],sectors)),before=JSON.stringify(snapshot);assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const selected=selectHomeLocal(snapshot,city,now);assert.equal(selected.cards.length,1);const overview=selected.cards[0];
 assert.equal(overview.id,'bucharest:cmteb:overview');assert.match(overview.context.place,/sectors 1, 2, 6/u);assert.equal(overview.sourceUrl,CMTEB_SOURCE);assert.equal(overview.context.documentHash,sectors[0].context.documentHash);assert.equal(overview.checkedAt,checkedAt);assert.equal(overview.validTo,sectors[0].validTo);assert.deepEqual(overview.facts,sectors.map(card=>card.title));
 assert.equal(JSON.stringify(snapshot),before);assert.equal(currentLocalSnapshot(snapshot,city,now),true);assert.equal(currentLocalSnapshot({...snapshot,cards:[overview]},city,now),false,'a derived summary is not a new operator source record');
});

test('ticker leads with the selected local report and does not substitute global sources for an unpersonalised known city',()=>{
 const snapshot=local([...parsed(b365,['Bucuresti: Metrorex modifica programul magistralei 6']),...parsed(buletin,['Bucuresti: Scoala 30 publica programul pentru elevi'])]),publication=globalPublication();
 const chosen=keyThing([publication],snapshot,city,[],now,city.timezone);assert.equal(chosen?.kind,'local-news');assert.equal(chosen.news.id,selectHomeLocal(snapshot,city,now).cards[0].news.id);
 assert.equal(keyThing([publication],null,city,[],now,city.timezone),null);assert.equal(keyThing([publication],local([]),city,[],now,city.timezone),null);
 assert.equal(keyThing([publication],null,city,['science'],now,city.timezone)?.publication,publication,'an explicit topic remains available');
 assert.equal(keyThing([publication],null,null,[],now,'UTC')?.publication,publication,'unknown city retains the separate global behaviour');
 assert.equal(keyThing([publication],snapshot,city,[],now+300000,city.timezone),null,'expired local news is not replaced with an unsolicited global topic');
});

test('a report crossing its 72-hour publication window expires without erasing the still-current forecast',()=>{
 const articles=parsed(b365,['Bucuresti: Metrorex publica programul magistralei 6'],0,new Date(now-72*3600000+1000).toUTCString()),snapshot=local(articles,[forecast()]);
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);const before=selectHomeLocal(snapshot,city,now);assert.equal(before.cards[0].kind,'local-news');assert.equal(before.expiresAt,now+1001);
 const after=selectHomeLocal(snapshot,city,now+1001);assert.deepEqual(after.cards.map(card=>card.kind),['forecast']);assert.equal(after.expiresAt,now+300000);
});

test('a slow independent provider cannot leave expired news counts that invalidate the completed local snapshot',async()=>{
 const articles=parsed(b365,['Bucuresti: Metrorex publica programul magistralei 6'],0,new Date(now-72*3600000+1000).toUTCString());let clock=now;
 const service=new LocalBriefingService({read:async()=>{await Promise.resolve();clock=now+1001;return {value:weatherPayload(),checkedAt};}},{read:async()=>{throw Error('UNEXPECTED_TRANSIT');}},()=>clock,{snapshot:async()=>({cards:[],coverage:[]})},null,{snapshot:async()=>({articles,sources:health(articles)})});
 const snapshot=await service.snapshot(city);assert.equal(snapshot.checkedAt,new Date(now+1001).toISOString());assert.deepEqual(snapshot.cards.map(card=>card.kind),['forecast']);assert.equal(currentLocalSnapshot(snapshot,city,clock),true);
 const source=snapshot.newsSources.find(item=>item.sourceId===b365.id);assert.equal(source.count,0);assert.equal(source.rejected,1);assert.equal(source.state,'partial');assert.equal(source.checkedAt,checkedAt,'the source-check date is preserved');assert.equal(snapshot.state,'partial');
});


test('explicit personal reading honors the same news publication window and schedules its expiry',()=>{
 const articles=parsed(buletin,['Bucuresti: Metrorex publica programul magistralei 6'],0,new Date(now-72*3600000+1000).toUTCString()),snapshot=local(articles,[forecast()]),profile=stateFor(snapshot).profile;
 assert.equal(selectDaily(profile,null,snapshot,null,[],now).items.filter(item=>item.local?.kind==='local-news').length,1);
 assert.equal(nextReadingBoundary(profile,null,snapshot,now),now+1001);
 const later=selectDaily(profile,null,snapshot,null,[],now+1001);
 assert.deepEqual(later.items.map(item=>item.local?.kind),['forecast']);assert.ok(later.notes.some(note=>/expired or unavailable/u.test(note)));
});


test('Romanian local publications under24h join Top as the same checked records and older reports remain local',()=>{
 const articles=[
  ...parsed(b365,['Bucuresti: Metrorex publica programul magistralei 6'],40),
  ...parsed(buletin,['Bucuresti: Scoala 42 publica inscrierile pentru elevi'],40),
  ...parsed(b365,['Bucuresti: Primaria anunta un nou program pentru mediu'],50,new Date(now-25*3600000).toUTCString()),
 ];
 const snapshot=freeze(local(articles,[forecast(),event(41)])),before=JSON.stringify(snapshot);
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const selection=selectHomeLanguage(snapshot,city,now,'ro');
 assert.equal(selection.topNews.length,2);assert.equal(selection.supporting.filter(card=>card.kind==='local-news').length,1);
 assert.deepEqual(new Set([...selection.topNews,...selection.supporting].map(card=>card.id)),new Set(selection.cards.map(card=>card.id)));
 assert.equal(new Set([...selection.topNews,...selection.supporting].map(card=>card.id)).size,selection.cards.length);
 const promoted=new Set(selection.topNews.map(card=>card.id));assert.ok(selection.supporting.every(card=>!promoted.has(card.id)));
 for(const card of selection.cards){
  const original=snapshot.cards.find(record=>record.id===card.id);assert.strictEqual(card,original);
  assert.equal(card.checkedAt,checkedAt);assert.equal(card.sourceUrl,original.sourceUrl);
  if(card.news){assert.strictEqual(card.news,original.news);assert.equal(card.context.documentHash,original.news.documentHash);assert.equal(card.title,original.news.title);}
 }
 assert.equal(selection.expiresAt,now+300000);assert.equal(JSON.stringify(snapshot),before);
 assert.equal(Object.isFrozen(selection.topNews),true);assert.equal(Object.isFrozen(selection.supporting),true);
});

test('English excludes Romanian news while retaining the exact current forecast and non-news local support',()=>{
 const snapshot=freeze(local(parsed(b365,['Bucuresti: Metrorex anunta programul magistralei 6'],60),[forecast(),event(42)]));
 const before=JSON.stringify(snapshot),english=selectHomeLanguage(snapshot,city,now,'en');
 assert.deepEqual(english.topNews,[]);assert.equal(english.cards.length,2);
 assert.deepEqual(new Set(english.supporting.map(card=>card.kind)),new Set(['forecast','event']));
 assert.ok(english.cards.every(card=>card.kind!=='local-news'));
 for(const card of english.supporting)assert.strictEqual(card,snapshot.cards.find(record=>record.id===card.id));
 const romanian=selectHomeLanguage(snapshot,city,now,'ro');assert.equal(romanian.topNews.length,1);
 assert.equal(JSON.stringify(snapshot),before);assert.equal(romanian.topNews[0].checkedAt,checkedAt);
});

test('promoted duplicate reports appear only once and never again among the supporting local cards',()=>{
 const title='Bucuresti: Metrorex modifica programul magistralei 6';
 const snapshot=freeze(local([...parsed(b365,[title],70),...parsed(buletin,['VIDEO: '+title],70)],[forecast()]));
 assert.equal(currentLocalSnapshot(snapshot,city,now),true);
 const selected=selectHomeLanguage(snapshot,city,now,'ro');
 assert.equal(selected.topNews.length,1);assert.equal(selected.cards.filter(card=>card.kind==='local-news').length,1);
 assert.ok(selected.supporting.every(card=>card.id!==selected.topNews[0].id));
 const ids=[...selected.topNews,...selected.supporting].map(card=>card.id);
 assert.equal(new Set(ids).size,ids.length);assert.equal(snapshot.cards.filter(card=>card.kind==='local-news').length,2);
});

test('changing language cannot renew a local check and its Top and support both expire at five minutes',()=>{
 const snapshot=freeze(local(parsed(buletin,['Bucuresti: Scoala 43 publica programul pentru elevi'],80),[forecast()]));
 const before=JSON.stringify(snapshot),romanian=selectHomeLanguage(snapshot,city,now,'ro');
 assert.equal(romanian.topNews.length,1);assert.equal(romanian.expiresAt,now+300000);
 selectHomeLanguage(snapshot,city,now+299999,'en');
 const last=selectHomeLanguage(snapshot,city,now+299999,'ro');
 assert.equal(last.topNews.length,1);assert.equal(last.expiresAt,now+300000);
 assert.equal(last.topNews[0].checkedAt,checkedAt);assert.equal(last.topNews[0].news.checkedAt,checkedAt);
 for(const language of ['ro','en']){
  const expired=selectHomeLanguage(snapshot,city,now+300000,language);
  assert.deepEqual(expired.cards,[]);assert.deepEqual(expired.topNews,[]);assert.deepEqual(expired.supporting,[]);assert.equal(expired.expiresAt,null);
 }
 assert.equal(JSON.stringify(snapshot),before);
});

test('a publication leaving the24h Top remains an unchanged local report within its72h window',()=>{
 const published=new Date(now-24*3600000+1000).toUTCString();
 const snapshot=freeze(local(parsed(b365,['Bucuresti: Metrorex publica programul magistralei 8'],90,published),[forecast()]));
 const before=JSON.stringify(snapshot),initial=selectHomeLanguage(snapshot,city,now,'ro');
 assert.equal(initial.topNews.length,1);
 const boundary=selectHomeLanguage(snapshot,city,now+1000,'ro');
 assert.equal(boundary.topNews.length,0);assert.equal(boundary.supporting.filter(card=>card.kind==='local-news').length,1);
 const retained=boundary.supporting.find(card=>card.kind==='local-news');assert.strictEqual(retained,initial.topNews[0]);
 assert.equal(retained.checkedAt,checkedAt);assert.equal(retained.news.publishedAt,snapshot.cards.find(card=>card.kind==='local-news').news.publishedAt);
 assert.equal(boundary.expiresAt,now+300000);assert.equal(JSON.stringify(snapshot),before);
});
