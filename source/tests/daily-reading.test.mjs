import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';
import{planDailyReading,changeExplanation,nextLocalDay,nextReadingBoundary}from'../.build/src/daily/reading.js';
import{selectDaily}from'../.build/src/daily/selection.js';
import{DAILY_TOPIC_FRESHNESS_MS,localDay}from'../.build/src/daily/contracts.js';
const now=Date.parse('2026-11-15T06:00:00.000Z'),stamp=new Date(now).toISOString();
const profile={cityId:null,topics:['technology'],query:'',budget:6,timezone:'Europe/Bucharest'};
const card={id:'a'.repeat(24),identity:'https://github.com/nodejs/node/releases/tag/v22.1.0',title:'Node.js v22.1.0',topic:'technology',kind:'software-release',sourceUrl:'https://github.com/nodejs/node/releases/tag/v22.1.0',publisher:'Node.js maintainers',sourceIds:['nodejs'],date:'2026-11-14T09:00:00.000Z',dateLabel:'Published',observedAt:stamp,contentHash:'b'.repeat(64),boundary:'Publisher listing.',deadline:null,version:'v22.1.0',attribution:'Node.js',sourceState:'verified'};
const source={id:'nodejs',label:'Node.js',publisher:'Node.js maintainers',topic:'technology',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:1,rejected:0,error:null,retryAt:null,scope:'Last 30 releases',termsUrl:'https://github.com/nodejs/node/blob/main/LICENSE',windowed:true};
const snap=(c=card)=>({version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'test',mode:'current-official-records',generatedAt:stamp,state:'ready',sources:[source],cards:[c],conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['technology']});
const first=selectDaily(profile,snap(),null,null,[],now);
const returning=(s=snap())=>selectDaily(profile,s,null,first.edition,[],now+100);
test('first preparation shows every selected card without implicit previous/read labels',()=>{const p=planDailyReading(first);assert.equal(p.current.length,1);assert.equal(p.previous.length,0);assert.match(p.summary,/first selection/);});
test('unchanged topics remain available outside the primary reading sequence',()=>{const s=returning(),p=planDailyReading(s);assert.equal(p.current.length,0);assert.equal(p.previous.length,1);assert.equal(p.previous[0].topic.card.id,card.id);assert.match(p.summary,/unchanged/);assert.doesNotMatch(p.summary,/you read|newly published/);});
test('changed cards remain in the primary sequence with actual differences',()=>{const p=planDailyReading(returning(snap({...card,title:'Corrected title'})));assert.equal(p.current[0].change,'different');assert.equal(p.previous.length,0);assert.match(p.summary,/has changed/);});
test('a card absent from prior selection is not promoted as newly published',()=>{const s=selectDaily(profile,snap(),null,{...first.edition,records:[],comparison:[]},[],now),p=planDailyReading(s);assert.equal(p.current[0].change,'added');assert.match(p.summary,/may be older/);});
test('local information is never folded away merely because it appeared before',()=>{const local={...first.items[0],topic:null,local:{kind:'forecast'},change:'same'};const p=planDailyReading({...returning(),items:[local,...returning().items]});assert.equal(p.current[0],local);assert.equal(p.previous.length,1);});
test('partial comparison cannot turn absence into a no-change claim',()=>{const s=selectDaily(profile,null,null,first.edition,[],now),p=planDailyReading(s);assert.match(p.summary,/not confirmation that nothing changed/);assert.equal(p.previous.length,0);});
test('an empty filtered selection does not claim the world has no news',()=>{const s={...returning(),items:[],topicCount:0};assert.match(planDailyReading(s).summary,/No additional topic cards in this selection/);});
test('source freshness expires at the same boundary used by the selector',()=>{const boundary=nextReadingBoundary(profile,snap(),null,now);assert.equal(boundary,now+DAILY_TOPIC_FRESHNESS_MS+1);const s=selectDaily(profile,snap(),null,first.edition,[],boundary);assert.equal(s.edition.complete,false);assert.equal(s.items.length,0);});
test('the nearest operational expiry takes precedence over the topic clock',()=>{const local={cards:[{validTo:new Date(now+120000).toISOString()}]};assert.equal(nextReadingBoundary(profile,snap(),local,now),now+120000);});
test('old expiry values never schedule immediate infinite loops',()=>{const local={cards:[{validTo:new Date(now-1000).toISOString()}]};assert.ok(nextReadingBoundary(profile,null,local,now)>now);});
test('publisher date boundary is observed independently of the users timezone',()=>{const n=Date.parse('2026-11-15T22:59:50Z');assert.equal(nextReadingBoundary({...profile,topics:['opportunities'],timezone:'America/New_York'},null,null,n),Date.parse('2026-11-15T23:00:00Z'));});
for(const [zone,at,expected] of [
 ['Europe/Bucharest','2026-03-28T22:00:00Z','2026-03-29T21:00:00Z'],
 ['Europe/Bucharest','2026-10-24T21:00:00Z','2026-10-25T22:00:00Z'],
 ['Asia/Kathmandu','2026-11-15T12:00:00Z','2026-11-15T18:15:00Z'],
 ['America/New_York','2026-11-15T12:00:00Z','2026-11-16T05:00:00Z'],
 ['UTC','2026-11-15T23:59:59.999Z','2026-11-16T00:00:00Z']
])test(`next local date ${zone} ${at}`,()=>{const n=Date.parse(at),end=nextLocalDay(n,zone);assert.equal(end,Date.parse(expected));assert.equal(localDay(end-1,zone),localDay(n,zone));assert.notEqual(localDay(end,zone),localDay(n,zone));});
test('invalid clocks and timezone values fail explicitly',()=>{assert.throws(()=>nextLocalDay(NaN,'UTC'));assert.throws(()=>nextLocalDay(now,'not-a-zone'));});
test('field explanations preserve data without inventing effects',()=>{assert.match(changeExplanation({field:'deadline',before:null,after:'2026-12-01'}),/not provided.*2026-12-01/);assert.match(changeExplanation({field:'title',before:'old',after:'new'}),/exact previous and current wording/);for(const field of['version','date','dateLabel','publisher','sourceUrl'])assert.equal(typeof changeExplanation({field,before:'a',after:'b'}),'string');});
test('reading projection does not mutate input or archived source data',()=>{const s=returning(),before=JSON.stringify(s);planDailyReading(s);assert.equal(JSON.stringify(s),before);});
test('compiled reading asset exactly matches source compilation with approved imports',()=>{const compiled=readFileSync('.build/src/daily/reading.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./contracts.js'","'./daily-contracts.js'").replaceAll("'../local/news-policy.js'","'./local-news-policy.js'").replaceAll("'../iceo/source-relevance.js'","'./source-relevance.js'");assert.equal(readFileSync('public/daily-reading.js','utf8'),compiled);});
