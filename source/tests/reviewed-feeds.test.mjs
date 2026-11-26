import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {ICEO_SOURCES,sourceRequest} from '../.build/src/iceo/registry.js';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
import {extract} from '../.build/src/iceo/extract.js';
import {IceoEngine} from '../.build/src/iceo/engine.js';
import {validCard,copyCard} from '../.build/src/iceo/card-validation.js';
import {validSettings} from '../.build/src/iceo/device-memory.js';
import {metadataChanges} from '../.build/src/iceo/comparison.js';
import {readingCard,selectReadingCards} from '../.build/src/iceo/reader.js';
import {validProfile} from '../.build/src/daily/contracts.js';
import {cardPath,sharedTopic} from '../.build/src/share/link.js';
import {emptyInsight} from '../.build/src/iceo/insight.js';
import {validInsight} from '../.build/src/iceo/insight-contracts.js';

const now=Date.parse('2026-11-15T12:00:00Z');
const source=id=>{const s=ICEO_SOURCES.find(s=>s.id===id);assert.ok(s);return s;};
const nasa=source('nasa-news'),usgs=source('usgs-news'),fda=source('fda-news'),gov=source('govuk-news');
const xml=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
function rss(s,{title='Publisher finding',link=s.feed.articleOrigins[0]+s.feed.articlePaths[0]+'example',summary='The publisher reports a bounded finding with its original qualification.',at='Sun, 15 Nov 2026 10:00:00 +0000',channel=s.feed.title,home=s.feed.homeOrigin}={}){
 return `<rss version="2.0"><channel><title>${xml(channel)}</title><link>${home}</link><item><title>${xml(title)}</title><link>${xml(link)}</link>${at===null?'':`<pubDate>${at}</pubDate>`}<description><![CDATA[${summary}]]></description></item></channel></rss>`;
}
function atom({at='2026-11-15T10:00:00+00:00',summary='Publisher statement, with its limitation intact.',link='https://www.gov.uk/government/news/example',title='Publisher communication'}={}){
 return `<feed xmlns="http://www.w3.org/2005/Atom"><title>News and communications</title><link rel="alternate" type="text/html" href="https://www.gov.uk"/><entry><title>${title}</title><link rel="alternate" type="text/html" href="${link}"/>${at===null?'':`<updated>${at}</updated>`}<summary type="html">${xml(summary)}</summary></entry></feed>`;
}

test('public feed and publisher counts are distinct and match the release identity',()=>{
 const m=JSON.parse(readFileSync('RELEASE-0.9.46.json','utf8'));
 assert.equal(ICEO_SOURCES.length,52);assert.equal(new Set(ICEO_SOURCES.map(s=>s.id)).size,52);assert.equal(m.publicSourceCount,ICEO_SOURCES.length);
 assert.equal(m.publicPublisherCount,new Set(ICEO_SOURCES.map(s=>s.publisher)).size);
 assert.equal(m.publicPublisherCount,26);
 for(const s of [nasa,usgs,fda,gov])assert.equal(sourceRequest(s,now).href,s.endpoint);
 assert.throws(()=>sourceRequest({...nasa,endpoint:'https://127.0.0.1/'},now),/SOURCE_NOT_REGISTERED/);
});
test('NASA excerpts preserve complete qualifiers and are stored as text',()=>{
 const result=extract(rss(nasa,{summary:'<p>A reported finding <strong>in a limited sample</strong>.</p><script>steal()</script><style>hidden</style>'}),nasa,now);
 assert.equal(result.rejected,0);assert.equal(result.cards.length,1);const c=result.cards[0];
 assert.equal(c.summary,'A reported finding in a limited sample.');assert.ok(validCard(c));
 assert.equal(readingCard(c,now).context,c.summary);assert.equal(readingCard(c,now).label,'Publisher excerpt');
 assert.deepEqual(copyCard(c),c);assert.equal(c.dateLabel,'Published');
 assert.doesNotMatch(c.summary,/<|steal|hidden/);
});
test('publisher excerpts are included in content identity without observation-time churn',()=>{
 const a=extract(rss(nasa),nasa,now).cards[0],b=extract(rss(nasa),nasa,now+1000).cards[0];
 assert.equal(a.contentHash,b.contentHash);assert.notEqual(a.observedAt,b.observedAt);
 const changed=extract(rss(nasa,{summary:'The publisher corrected the qualification.'}),nasa,now).cards[0];
 assert.equal(changed.id,a.id);assert.notEqual(changed.contentHash,a.contentHash);
 assert.deepEqual(metadataChanges(a,changed),[{field:'summary',before:a.summary,after:changed.summary}]);
 const legacy={...a};delete legacy.summary;assert.deepEqual(metadataChanges(legacy,a),[{field:'summary',before:null,after:a.summary}]);
});
test('a long publisher excerpt is omitted rather than truncated or fabricated',()=>{
 const r=extract(rss(nasa,{summary:'word '.repeat(250)+'Only in this limited setting.'}),nasa,now);
 assert.equal(r.cards.length,1);assert.equal(r.cards[0].summary,undefined);assert.equal(r.rejected,0);
});
test('reviewed feeds reject DTD, entities, incorrect feed identity and homepage',()=>{
 assert.throws(()=>extract('<!DOCTYPE rss>'+rss(nasa),nasa,now),/SOURCE_XML_REJECTED/);
 assert.throws(()=>extract('<!ENTITY bad "x">'+rss(nasa),nasa,now),/SOURCE_XML_REJECTED/);
 assert.throws(()=>extract(rss(nasa,{channel:'NASA lookalike'}),nasa,now),/SOURCE_IDENTITY_MISMATCH/);
 assert.throws(()=>extract(rss(nasa,{home:'https://www.nasa.gov.attacker.invalid'}),nasa,now),/SOURCE_LINK_REJECTED/);
});
test('NASA accepts its reviewed science origin but no wildcard host or unsafe link',()=>{
 assert.equal(extract(rss(nasa,{link:'https://science.nasa.gov/missions/example'}),nasa,now).cards.length,1);
 for(const link of ['https://science.nasa.gov.attacker.invalid/x','https://127.0.0.1/x','https://user:pass@www.nasa.gov/x','http://www.nasa.gov/x','https://www.nasa.gov:8443/x','javascript:alert(1)','https://www.nasa.gov/x?redirect=other','https://www.nasa.gov/<b>example</b>','https://www.nasa.gov/&lt;b&gt;example&lt;/b&gt;']){
  const r=extract(rss(nasa,{link}),nasa,now);assert.equal(r.cards.length,0,link);assert.equal(r.rejected,1);
 }
});
test('USGS canonicalisation removes only reviewed tracking parameters',()=>{
 const clean=extract(rss(usgs),usgs,now).cards[0];
 const tracked=extract(rss(usgs,{link:clean.sourceUrl+'?utm_source=comms&amp;utm_medium=rss&utm_campaign=news'}),usgs,now).cards[0];
 assert.ok(tracked);assert.equal(tracked.sourceUrl,clean.sourceUrl);assert.equal(tracked.contentHash,clean.contentHash);
 assert.equal(extract(rss(usgs,{link:clean.sourceUrl+'?download=private'}),usgs,now).rejected,1);
 assert.equal(extract(rss(usgs,{link:'https://www.usgs.gov/admin/example'}),usgs,now).rejected,1);
});
test('FDA legacy links upgrade only the reviewed first-party hostname and path',()=>{
 const r=extract(rss(fda,{home:'http://www.fda.gov/',link:'http://www.fda.gov/news-events/press-announcements/example'}),fda,now);
 assert.equal(r.cards[0].sourceUrl,'https://www.fda.gov/news-events/press-announcements/example');
 assert.match(r.cards[0].boundary,/US regulatory information/);
 assert.equal(extract(rss(fda,{link:'http://www.fda.gov.attacker.invalid/news-events/press-announcements/example'}),fda,now).rejected,1);
});
test('feed records need source dates and respect future tolerance and publication window',()=>{
 for(const at of [null,'2030-01-01','not a date']){
  const r=extract(rss(nasa,{at}),nasa,now);assert.equal(r.cards.length,0);assert.equal(r.rejected,1);
 }
 const old=extract(rss(nasa,{at:new Date(now-31*86400000).toUTCString()}),nasa,now);
 assert.equal(old.cards.length,0);assert.equal(old.rejected,0);
});
test('Atom update dates never become publication dates and need an explicit timezone',()=>{
 const r=extract(atom({summary:'A publisher statement about people&#39;s choices.'}),gov,now);
 assert.equal(r.cards.length,1);assert.equal(r.cards[0].dateLabel,'Updated');
 assert.equal(r.cards[0].summary,"A publisher statement about people's choices.");
 for(const at of [null,'2026-11-15T10:00:00','not a date'])assert.equal(extract(atom({at}),gov,now).rejected,1);
 const duplicated=atom().replace('<entry>','<entry><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/other"/>');
 assert.equal(extract(duplicated,gov,now).rejected,1);
});
test('new topics survive personal settings and card sharing without altering old profiles',()=>{
 const settings={topics:[...PUBLIC_TOPICS],query:'',budget:12,mode:'briefing'};
 assert.ok(validSettings(settings));assert.ok(validProfile({cityId:null,topics:[...PUBLIC_TOPICS],query:'',budget:12,timezone:'Europe/Bucharest'}));
 assert.ok(validProfile({cityId:null,topics:['technology'],query:'',budget:6,timezone:'Europe/London'}));
 assert.equal(sharedTopic('#briefing-topic=public-affairs'),'public-affairs');
 assert.equal(sharedTopic('#briefing-topic=private-admin'),null);
 const cards=[extract(rss(nasa),nasa,now).cards[0],extract(atom(),gov,now).cards[0]];
 assert.equal(selectReadingCards(cards,settings,now).cards.length,2);
 for(const c of cards)assert.equal(cardPath(c),`/card/${c.id}?v=${c.contentHash}`);
});
test('saved excerpt validation is bounded and copied without unknown fields',()=>{
 const c=extract(rss(nasa),nasa,now).cards[0];
 assert.equal(validCard({...c,summary:'x'.repeat(1001)}),false);
 assert.equal(validCard({...c,summary:12}),false);
 assert.equal(copyCard({...c,untrusted:'drop'}).untrusted,undefined);
});
test('new source exports keep their actual terms even when full-document extraction is unsupported',()=>{
 for(const s of [nasa,usgs,fda,gov]){
  const c=extract(s===gov?atom():rss(s),s,now).cards[0];assert.ok(c);
  const i=emptyInsight(c,now,'unsupported','FORMAT_NOT_REVIEWED');assert.equal(i.termsUrl,s.termsUrl);assert.ok(validInsight(i,c));
 }
});
test('new source cache intervals avoid repeated FDA acquisition and 304 does not extend the item window',async()=>{
 let clock=now,calls=0;
 const engine=new IceoEngine(async()=>{calls++;return calls===1?new Response(rss(fda),{headers:{'content-type':'application/rss+xml',etag:'"feed"'}}):new Response(null,{status:304});},()=>clock);
 await engine.read(fda);clock+=3599999;await engine.read(fda);assert.equal(calls,1);
 clock+=2;await engine.read(fda);assert.equal(calls,2);
 const age=now-30*86400000+3600000;clock=now;calls=0;
 const windowed=new IceoEngine(async()=>{calls++;return calls===1?new Response(rss(nasa,{at:new Date(age).toUTCString()}),{headers:{'content-type':'application/rss+xml',etag:'"feed"'}}):new Response(null,{status:304});},()=>clock);
 assert.equal((await windowed.read(nasa)).cards.length,1);clock+=3600001;
 assert.equal((await windowed.read(nasa)).cards.length,0);assert.equal(calls,2);
});

test('CFPB original RSS is admitted only under the verified official newsroom identity',()=>{
 const cfpb=source('cfpb-newsroom'),date=Date.parse('2026-11-26T14:00:00Z');
 const home='https://www.consumerfinance.gov/about-us/newsroom/';
 const url=home+'consumer-credit-terms-update/';
 const feed=rss(cfpb,{title:'US consumer agency reports credit and mortgage changes',link:url,home,at:'Wed, 25 Nov 2026 00:00:00 -0500',summary:'Agency reports a consumer financial regulatory change.'});
 const result=extract(feed,cfpb,date);
 assert.equal(sourceRequest(cfpb,date).href,cfpb.endpoint);
 assert.equal(result.rejected,0);assert.equal(result.cards.length,1);
 assert.equal(result.cards[0].sourceUrl,url);assert.equal(result.cards[0].dateLabel,'Published');
 assert.equal(result.cards[0].topic,'money');
 assert.ok(validCard(result.cards[0]));
 assert.match(result.cards[0].attribution,/CFPB/);
 for(const bad of [
  'https://consumerfinance.gov/about-us/newsroom/consumer-credit-terms-update/',
  'https://www.consumerfinance.gov.attacker.invalid/about-us/newsroom/consumer-credit-terms-update/',
  'https://www.consumerfinance.gov/admin/private',
  url+'?redirect=https://attacker.invalid'
 ]){
  const invalid=extract(rss(cfpb,{link:bad,home}),cfpb,date);
  assert.equal(invalid.cards.length,0,bad);assert.equal(invalid.rejected,1,bad);
 }
 assert.throws(()=>extract(rss(cfpb,{home:'https://attacker.invalid/'}),cfpb,date),/SOURCE_LINK_REJECTED/);
});
