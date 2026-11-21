import test from 'node:test';
import assert from 'node:assert/strict';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {extract} from '../.build/src/iceo/extract.js';
import {validCard} from '../.build/src/iceo/card-validation.js';
import {readingCard} from '../.build/src/iceo/reader.js';

const now=Date.parse('2026-11-20T12:00:00Z');
const source=id=>ICEO_SOURCES.find(item=>item.id===id);
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ecb=(description='',title='ECB publication')=>`<rss><channel><title>ECB - European Central Bank</title><item><title>${xml(title)}</title><link>https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html</link><pubDate>Fri, 20 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[${description}]]></description></item></channel></rss>`;
const rss=(s,title,summary)=>`<rss><channel><title>${xml(s.feed.title)}</title><link>${s.feed.homeOrigin}</link><item><title>${xml(title)}</title><link>${s.feed.articleOrigins[0]}${s.feed.articlePaths[0]}example</link><pubDate>Fri, 20 Nov 2026 10:00:00 +0000</pubDate><description><![CDATA[${summary}]]></description></item></channel></rss>`;

test('ECB keeps complete feed excerpts and qualifiers without an extra source request',()=>{
 const description='<p>The measure applies <strong>only to the stated reporting period</strong>; it is not a forecast.</p><script>ignored()</script>';
 const result=extract(ecb(description),source('ecb-statistics'),now),card=result.cards[0];
 assert.equal(result.rejected,0);assert.equal(card.summary,'The measure applies only to the stated reporting period; it is not a forecast.');
 assert.ok(validCard(card));assert.equal(readingCard(card,now).context,card.summary);
 const changed=extract(ecb('<p>The publisher corrected the reporting period.</p>'),source('ecb-statistics'),now).cards[0];
 assert.equal(changed.id,card.id);assert.notEqual(changed.contentHash,card.contentHash);
});

test('missing, malformed and overlong ECB descriptions never erase a valid listing or truncate conditions',()=>{
 for(const description of ['', '<script>onlyExecutable()</script>','Complete words '.repeat(100)+'A final restriction.','${item.unresolved}']){
  const result=extract(ecb(description),source('ecb-news'),now);
  assert.equal(result.cards.length,1);assert.equal(result.rejected,0);assert.equal(result.cards[0].summary,undefined);
 }
});

test('title-only excerpts are omitted across ECB, RSS and Atom without dropping cards',()=>{
 const ecbResult=extract(ecb('<p> ECB PUBLICATION. </p>'),source('ecb-news'),now);
 const nasa=source('nasa-news'),rssResult=extract(rss(nasa,'Finding & scope','<p>Finding &amp; scope</p>'),nasa,now);
 const gov=source('govuk-news'),atom=`<feed xmlns="http://www.w3.org/2005/Atom"><title>News and communications</title><link rel="alternate" type="text/html" href="https://www.gov.uk"/><entry><title>Publisher statement</title><link rel="alternate" type="text/html" href="https://www.gov.uk/government/news/example"/><updated>2026-11-20T10:00:00Z</updated><summary type="text">Publisher statement</summary></entry></feed>`;
 for(const result of [ecbResult,rssResult,extract(atom,gov,now)]){assert.equal(result.cards.length,1);assert.equal(result.rejected,0);assert.equal(result.cards[0].summary,undefined);assert.ok(validCard(result.cards[0]));}
 const retained=extract(rss(nasa,'Finding & scope','Finding &amp; scope. The finding applies only to this experiment.'),nasa,now).cards[0];
 assert.equal(retained.summary,'Finding & scope. The finding applies only to this experiment.');
});

test('a procurement excerpt does not change deadline classification or establish eligibility',()=>{
 const card=extract(ecb('Closing date: 24/11/2026. Eligibility must be checked in the full notice.','Contract notice: supplied services'),source('ecb-procurement'),now).cards[0];
 assert.equal(card.deadline,'2026-11-24');assert.equal(readingCard(card,now).noticeState,'deadline-ahead');
 assert.match(readingCard(card,now).context,/Confirm the current procedure status and eligibility/u);
 assert.match(card.summary,/Eligibility must be checked/u);
});
