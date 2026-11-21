import test from 'node:test';
import assert from 'node:assert/strict';
import {editorialCardPresentation,compactEditionStatus} from '../.build/src/iceo/editorial-presentation.js';
import {readingCard} from '../.build/src/iceo/reader.js';

const now=Date.parse('2026-11-21T12:00:00Z');
const base={id:'presentation-fixture',identity:'fixture:editorial',title:'A controlled headline',kind:'publication',topic:'world',publisher:'Fixture publisher',sourceUrl:'https://example.com/article',sourceIds:['news-world'],date:'2026-11-21T10:00:00Z',dateLabel:'Published',observedAt:'2026-11-21T11:00:00Z',sourceState:'verified',contentHash:'a'.repeat(64),attribution:'Fixture attribution',boundary:'Fixture boundary'};
const present=(patch={},saved=false)=>editorialCardPresentation(readingCard({...base,...patch},now),saved);

test('ordinary listing boilerplate moves to details while the complete headline remains visible',()=>{
 const title='A very long controlled original headline with its important qualification intact. '.repeat(4);
 const result=present({title});
 assert.equal(result.headline,title);assert.equal(result.kindLabel,'');assert.equal(result.visibleContext,null);
 assert.match(result.detailContext,/publisher listing/);assert.equal(result.originalTitleInDetails,false);
});
test('a publisher excerpt remains visible and attributed without inventing a summary',()=>{
 const result=present({summary:'The exact publisher excerpt supplied by the fixture.'});
 assert.equal(result.visibleContext,'The exact publisher excerpt supplied by the fixture.');
 assert.equal(result.kindLabel,'From the publisher');assert.equal(result.detailContext,null);
});
test('saved and stale identities remain visible',()=>{
 const result=present({sourceState:'stale'},true);
 assert.match(result.kindLabel,/Saved copy/);assert.match(result.kindLabel,/Older source check/);
});
test('an awarded contract with a future date cannot look like an open invitation',()=>{
 const result=present({kind:'procurement-notice',title:'Contract award notice: Controlled contract',deadline:'2027-01-20'});
 assert.match(result.kindLabel,/Contract awarded/);assert.match(result.visibleContext,/not an invitation to apply/);
});
test('legal document semantics and consolidation date meaning remain visible',()=>{
 const result=present({kind:'legal-document',identity:'celex:02020R0001-20261121',title:'Controlled consolidated legal text',dateLabel:'Document date'});
 assert.equal(result.kindLabel,'Consolidated text');assert.match(result.visibleContext,/does not mean a new law/);
});
test('source-specific product, regulatory and cyber-security limits remain visible',()=>{
 for(const [source,pattern] of [['govuk-products',/United Kingdom.*model, batch/],['fda-news',/United States.*country/],['ncsc-news',/United Kingdom.*not a personal breach check/]]){
  assert.match(present({sourceIds:[source]}).safetyNote,pattern);
 }
 assert.equal(present().safetyNote,null);
});
const status={state:'ready',count:30,continuation:61,checkedTime:'18:32',refreshing:false,refreshFailed:false,partial:false,updates:0};
test('edition status is compact without replacing its source-check timestamp',()=>{
 assert.equal(compactEditionStatus(status),'30 stories · Checked 18:32');
 assert.equal(compactEditionStatus({...status,updates:2}),'30 stories · Checked 18:32 · 2 updates available');
});
test('a failed refresh keeps the previous check explicit and preserves partial coverage',()=>{
 const result=compactEditionStatus({...status,refreshFailed:true,partial:true});
 assert.match(result,/Checked 18:32/);assert.match(result,/previous check/);assert.match(result,/Partial coverage/);
 assert.doesNotMatch(result,/Updated|all clear/i);
});
test('loading, failed acquisition and successful empty results remain distinct',()=>{
 assert.match(compactEditionStatus({...status,state:'pending',count:0,continuation:0}),/Loading/);
 assert.match(compactEditionStatus({...status,state:'unavailable',count:0}),/could not be checked.*Refresh/);
 assert.match(compactEditionStatus({...status,state:'empty',count:0}),/No current stories.*incomplete/);
 assert.match(compactEditionStatus({...status,count:0,continuation:1}),/^1 current story below/);
});
test('refresh with retained stories keeps the count, previous check, coverage and pending updates',()=>{
 const manual=compactEditionStatus({...status,state:'pending',refreshing:true,partial:true,updates:2});
 assert.match(manual,/30 stories/);assert.match(manual,/Checked 18:32/);assert.match(manual,/Checking for updates/);assert.match(manual,/Partial coverage/);assert.match(manual,/2 updates/);
 const automatic=compactEditionStatus({...status,state:'pending',refreshing:false,partial:true});
 assert.match(automatic,/30 stories.*Checked 18:32.*Partial coverage/);assert.doesNotMatch(automatic,/Loading/);
});
