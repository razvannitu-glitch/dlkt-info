import test from 'node:test';
import assert from 'node:assert/strict';
import {DAILY_FEEDS} from '../.build/src/iceo/daily-feeds.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {extract} from '../.build/src/iceo/extract.js';
import {editorialTopic,hasEditorialTopics} from '../.build/src/iceo/editorial-topics.js';
import {validCard} from '../.build/src/iceo/card-validation.js';
import {validTopicSnapshot} from '../.build/src/daily/contracts.js';
import {reconcile} from '../.build/src/iceo/engine.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
const now=Date.parse('2026-11-20T14:00:00Z');
const source=id=>{const s=ICEO_SOURCES.find(s=>s.id===id);assert.ok(s,id);return s;};
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
function rss(s,{title='Controlled funding for health research',link=s.feed.articleOrigins[0]+s.feed.articlePaths[0]+'controlled',at='Fri, 20 Nov 2026 12:00:00 GMT',home=s.feed.homeUrl??s.feed.homeOrigin+(s.feed.homePath??'/'),author='Controlled author',description='<p>A complete publisher paragraph with its qualification intact.</p><p>Another paragraph.</p>'}={}){
 return `<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:a10="http://www.w3.org/2005/Atom"><channel><title>${esc(s.feed.title)}</title><link>${esc(home)}</link><item><title>${esc(title)}</title><link>${esc(link)}</link><${s.feed.dateField}>${at}</${s.feed.dateField}><dc:creator>${author}</dc:creator><description><![CDATA[${description}]]></description></item></channel></rss>`;
}
function result(s,cards){return {health:{id:s.id,label:s.label,publisher:s.publisher,topic:s.topic,state:'verified',checkedAt:new Date(now).toISOString(),verifiedAt:new Date(now).toISOString(),count:cards.length,rejected:0,error:null,retryAt:null,scope:s.scope,termsUrl:s.termsUrl,windowed:true},cards};}
test('reviewed daily feeds have distinct IDs, bounded refresh and dated reuse review',()=>{
 assert.equal(DAILY_FEEDS.length,14);assert.equal(new Set(ICEO_SOURCES.map(s=>s.id)).size,ICEO_SOURCES.length);
 for(const s of DAILY_FEEDS){assert.ok(s.rightsCheckedAt<='2026-11-20');assert.ok(s.rightsReviewBy>'2026-11-20');assert.equal(s.feed.refreshSeconds,1800);assert.ok(s.feed.windowDays<=7);assert.match(s.endpoint,/^https:/);}
});
test('publisher taxonomy and title rules are bounded editorial labels',()=>{
 assert.equal(editorialTopic('eu-council','regulation','Traditional sports and games',[]),'sport');
 assert.equal(editorialTopic('ec-press','public-affairs','An announcement',['Education & training']),'work-education');
 assert.equal(editorialTopic('unknown','world','Football and sports',[]),'world');
 assert.equal(hasEditorialTopics('eu-law'),false);
 assert.equal(editorialTopic('govuk-products','public-affairs','Product Recall: a dangerous cutting blade',[]),'food');
});
test('Council update field remains Updated and malformed or future dates do not become current',()=>{
 const s=source('eu-council');const good=extract(rss(s,{title:'Traditional sports and games',at:'2026-11-20T12:00:00Z'}),s,now);
 assert.equal(good.cards.length,1);assert.equal(good.cards[0].dateLabel,'Updated');assert.equal(good.cards[0].topic,'sport');assert.ok(validCard(good.cards[0]));
 assert.equal(extract(rss(s,{at:'2026-11-21T12:00:00Z'}),s,now).cards.length,0);
 assert.equal(extract(rss(s,{at:'not-a-date'}),s,now).cards.length,0);
});
test('exact feed home queries are identity checked and article links still reject queries and outside hosts',()=>{
 const s=source('ec-press');assert.equal(extract(rss(s),s,now).cards.length,1);
 assert.throws(()=>extract(rss(s,{home:s.feed.homeUrl+'&other=1'}),s,now),/SOURCE_IDENTITY_MISMATCH/);
 assert.equal(extract(rss(s,{link:'https://attacker.invalid/article'}),s,now).cards.length,0);
 assert.equal(extract(rss(s,{link:s.feed.articleOrigins[0]+s.feed.articlePaths[0]+'controlled?secret=1'}),s,now).cards.length,0);
});
test('first paragraph is complete and does not copy the rest of a long article or executable markup',()=>{
 const s=source('sanews'),r=extract(rss(s,{description:'<p>A factual sentence. <script>untrusted()</script> A limiting sentence.</p><p>'+('Uncopied full article '.repeat(100))+'</p>'}),s,now);
 assert.equal(r.cards.length,1);assert.equal(r.cards[0].summary,'A factual sentence. A limiting sentence.');
 assert.doesNotMatch(r.cards[0].summary,/untrusted|Uncopied/);
});
test('licensed creator and publisher credits survive extraction',()=>{
 for(const id of ['ec-press','cbs-news','360-news','scidev-news']){const s=source(id),c=extract(rss(s),s,now).cards[0];assert.ok(c,id);assert.ok(c.byline);assert.match(c.licenseUrl,/creativecommons/);assert.ok(validCard(c));}
 const s=source('360-news');assert.equal(extract(rss(s,{author:''}),s,now).cards.length,0);
});
test('editorial topics keep public snapshot and sharing validation intact after reconciliation',()=>{
 const s=source('ec-press'),a=extract(rss(s,{title:'New support for health services'}),s,now).cards;
 const catalog=reconcile([result(s,a)]);assert.notEqual(a[0].topic,s.topic);assert.equal(validTopicSnapshot(catalog,now),true);
 assert.equal(selectContextualToday(catalog.cards,{countryCode:null,preferredTopics:[]},now).first.length,1);
 const forged={...catalog,sources:catalog.sources.map(h=>({...h,id:'unreviewed'})),cards:catalog.cards.map(c=>({...c,sourceIds:['unreviewed']}))};assert.equal(validTopicSnapshot(forged,now),false);
});
test('multi-feed duplicates remain one story without inventing corroboration',()=>{
 const s=source('gv-world'),b=source('gv-culture');
 const raw=rss(s).replace('</item>','<content:encoded><![CDATA[<div class="gv-rss-footer"><div class="text-credits-section"><span class="credit-label">Written by</span><span class="user-link">Controlled author</span></div></div>]]></content:encoded></item>');
 const a=extract(raw,s,now).cards;assert.equal(a.length,1);
 const second=a.map(c=>({...c,sourceIds:[b.id],topic:'science'}));
 const catalog=reconcile([result(s,a),result(b,second)]);
 assert.equal(catalog.cards.length,1);assert.equal(catalog.duplicateCount,1);assert.equal(catalog.cards[0].sourceIds.length,2);assert.equal(validTopicSnapshot(catalog,now),true);
});
test('FTC nested title links are accepted only for the exact reviewed source and safe article origin',()=>{
 const s=source('ftc-consumer');const raw=rss(s).replace('<title>Controlled funding for health research</title>','<title><a href="https://consumer.ftc.gov/consumer-alerts/2026/11/controlled" hreflang="en">Controlled consumer alert</a></title>');
 assert.equal(extract(raw,s,now).cards.length,1);
 assert.equal(extract(raw.replace('href="https://consumer.ftc.gov/consumer-alerts/2026/11/controlled"','href="https://attacker.invalid/"'),s,now).cards.length,0);
});
