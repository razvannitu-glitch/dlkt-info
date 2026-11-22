import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readNewsArticleMetadata,discoverNewsWithDiagnostics} from '../.build/src/iceo/news-discovery.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {validArticleSubject} from '../.build/src/iceo/article-subject.js';
import {NEWS_INDEX_URL} from '../.build/src/iceo/news-sources.js';

const now=Date.parse('2026-11-22T17:00:00.000Z'),date=new Date(now-60_000).toISOString(),checkedAt=new Date(now).toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row={sourceUrl:'https://www.reuters.com/technology/controlled-subject-article',title:'New artificial intelligence software launches for laptops',publisher:'Reuters',indexedAt:checkedAt,category:'technology'};
const article=(changes={})=>({'@type':'NewsArticle',url:row.sourceUrl,headline:row.title,datePublished:date,...changes});
const document=(values,{canonical=row.sourceUrl,extra='',body=''}={})=>'<html><head><link rel="canonical" href="'+canonical+'">'+extra+'<script type="application/ld+json">'+JSON.stringify(values)+'</script></head><body>'+body+'</body></html>';
const read=(values,options={})=>readNewsArticleMetadata(document(values,options),row,row.sourceUrl,now);
const subject=(sections=[],keywords=[])=>({basis:'publisher-jsonld',articleUrl:row.sourceUrl,sections,keywords});

test('publisher subject is normalized from the same explicitly bound eligible Article',()=>{
 const value=read(article({articleSection:[' Technology ','Cafe\u0301','Science','Science'],keywords:' innovation , A\u0301lpha, New   devices,innovation '}));
 assert.deepEqual(value.articleSubject,subject(['Café','Science','Technology'],['New devices','innovation','Álpha']));
 assert.equal(validArticleSubject(value.articleSubject,row.sourceUrl),true);
 assert.ok(Object.isFrozen(value.articleSubject));assert.ok(Object.isFrozen(value.articleSubject.sections));
 assert.equal(value.sourceUrl,row.sourceUrl);assert.equal(value.title,row.title);assert.equal(value.date,date);
});

test('missing publisher subject remains absent and preserves the existing content projection',()=>{
 const value=read(article());assert.equal(Object.hasOwn(value,'articleSubject'),false);
 const oldBase={identity:row.sourceUrl,title:row.title,sourceUrl:row.sourceUrl,date,dateLabel:'Published',publisher:row.publisher,deadline:null,version:null};
 const sameBase={identity:value.sourceUrl,title:value.title,sourceUrl:value.sourceUrl,date:value.date,dateLabel:'Published',publisher:value.publisher,deadline:null,version:null};
 assert.equal(digest(cardContent(oldBase)),digest(cardContent(sameBase)));
 assert.equal(Object.hasOwn(cardContent(sameBase),'articleSubject'),false);
});

test('unbound JSON-LD, unrelated graph nodes and global page tags cannot supply publisher subject',()=>{
 const unbound=article({articleSection:'Politics'});delete unbound.url;
 assert.equal(Object.hasOwn(read(unbound),'articleSubject'),false);
 const other=article({url:'https://www.reuters.com/world/another-canonical',articleSection:'Politics'});
 const graph={'@graph':[article(),other,{'@type':'WebPage',url:row.sourceUrl,articleSection:'Finance',keywords:'money'},{'@type':'Organization',keywords:'science'}]};
 const value=read(graph,{extra:'<meta name="keywords" content="Politics"><meta property="article:section" content="Finance">',body:'<div data-section="Politics">Unrelated body taxonomy</div>'});
 assert.equal(Object.hasOwn(value,'articleSubject'),false);
 const incomplete=article({articleSection:'Politics'});delete incomplete.datePublished;
 assert.equal(Object.hasOwn(read([article(),incomplete]),'articleSubject'),false);
});

test('canonical and explicit URL binding must agree before subject is copied',()=>{
 const malformed=article({url:123,articleSection:'Technology'});
 assert.equal(Object.hasOwn(read(malformed),'articleSubject'),false);
 const mismatched=article({url:'https://www.reuters.com/world/unrelated-story',articleSection:'Technology'});
 assert.equal(Object.hasOwn(read([article(),mismatched]),'articleSubject'),false);
 const redirect='https://www.reuters.com/technology/changed-canonical';
 const redirected=readNewsArticleMetadata(document(article({url:redirect,articleSection:'Technology'}),{canonical:redirect}),row,redirect,now);
 assert.ok(redirected,'the existing original metadata policy may admit a publisher canonical redirect');
 assert.equal(Object.hasOwn(redirected,'articleSubject'),false,'a canonical different from the candidate cannot lend publisher subject');
 const mainEntity=article({mainEntityOfPage:{'@id':row.sourceUrl},articleSection:'Technology'});delete mainEntity.url;
 assert.deepEqual(read(mainEntity).articleSubject,subject(['Technology']));
});

test('contradictory or malformed declarations on the same bound Article omit subject without inventing a choice',()=>{
 for(const other of [
  article({articleSection:'Politics'}),
  article({articleSection:['Technology','Politics']}),
  article({articleSection:123}),
  article({articleSection:'<b>Technology</b>'}),
 ]){
  const value=read([article({articleSection:'Technology'}),other]);
  assert.ok(value);assert.equal(Object.hasOwn(value,'articleSubject'),false);
 }
 const same=read([article({articleSection:['Technology','Science']}),article({articleSection:[' Science ','Technology','Science']})]);
 assert.deepEqual(same.articleSubject,subject(['Science','Technology']));
});

test('subject does not bypass publication date or headline identity checks',()=>{
 const wrongHeadline=article({headline:'Government rejects the proposed hospital reforms',articleSection:'Health'});
 assert.equal(Object.hasOwn(read([article(),wrongHeadline]),'articleSubject'),false);
 assert.equal(read(article({articleSection:'Technology',datePublished:'2026-11-22T16:59:00'})),null);
 assert.equal(read([article({articleSection:'Technology'}),article({articleSection:'Technology',datePublished:new Date(now-120_000).toISOString()})]),null);
 assert.equal(read(article({articleSection:'Technology',datePublished:new Date(now-86_400_001).toISOString()})),null);
});

test('publisher subject bounds accept eight sections twelve keywords and eighty Unicode codepoints',()=>{
 const sections=Array.from({length:8},(_,i)=>'S'+i),keywords=Array.from({length:12},(_,i)=>'K'+String(i).padStart(2,'0'));
 assert.deepEqual(read(article({articleSection:sections,keywords})).articleSubject,subject(sections,keywords));
 const emoji='😀'.repeat(80),ascii='x'.repeat(80);
 assert.deepEqual(read(article({articleSection:ascii,keywords:[emoji]})).articleSubject,subject([ascii],[emoji]));
 for(const changes of [
  {articleSection:[...sections,'S8']},{keywords:[...keywords,'K12']},
  {articleSection:'x'.repeat(81)},{keywords:['😀'.repeat(81)]},
  {articleSection:Array.from({length:33},()=> 'Technology')},
  {articleSection:['Technology',null]},{articleSection:'\u0000Technology'},
  {keywords:['Technology\u001f']},{articleSection:'<Technology>'},
  {articleSection:[],keywords:[]},{keywords:''},
 ]){
  const value=read(article(changes));assert.ok(value);assert.equal(Object.hasOwn(value,'articleSubject'),false,JSON.stringify(changes));
 }
});

test('normalization is deterministic without folding the publisher wording or case',()=>{
 const value=read(article({articleSection:['science','Science','Cafe\u0301','Café'],keywords:[' A  B ','A\nB','case','Case']}));
 assert.deepEqual(value.articleSubject,subject(['Café','Science','science'],['A B','Case','case']));
 assert.equal(validArticleSubject(value.articleSubject,row.sourceUrl),true);
});

test('an exact bound alternative headline carries only its own selected Article subject',()=>{
 const primary='Government sets funding terms for university laboratories',short='New research programme approved';
 const candidate={...row,title:short};
 const bound=article({headline:primary,alternativeHeadline:short,articleSection:'Science'});
 const value=readNewsArticleMetadata(document(bound),candidate,candidate.sourceUrl,now);
 assert.equal(value.title,primary);assert.deepEqual(value.articleSubject,subject(['Science']));
 const other=article({headline:short,articleSection:'Politics'});
 const combined=readNewsArticleMetadata(document([bound,other]),candidate,candidate.sourceUrl,now);
 assert.equal(combined.title,primary);assert.deepEqual(combined.articleSubject,subject(['Science']));
 const unbound={...bound};delete unbound.url;
 assert.equal(readNewsArticleMetadata(document(unbound),candidate,candidate.sourceUrl,now),null,'an unbound alternate title cannot admit a different primary headline');
});

test('Digi24 subject remains bound to the exact Article and explicit head publication offset',()=>{
 const candidate={sourceUrl:'https://www.digi24.ro/stiri/actualitate/guvernul-anunta-noi-masuri-1234567',title:'Guvernul anunta noi masuri pentru cetateni',publisher:'Digi24',indexedAt:checkedAt,category:null};
 const localDate='2026-11-22 18:59:00',explicit='2026-11-22T18:59:00+02:00';
 const bound={'@type':'NewsArticle',url:candidate.sourceUrl,headline:candidate.title,datePublished:localDate,articleSection:'Actualitate',keywords:['Romania']};
 const doc=(meta,body='')=>document(bound,{canonical:candidate.sourceUrl,extra:meta,body});
 const head='<meta name="publish-date" content="'+explicit+'">';
 const value=readNewsArticleMetadata(doc(head),candidate,candidate.sourceUrl,now);
 assert.equal(value.date,date);
 assert.deepEqual(value.articleSubject,{basis:'publisher-jsonld',articleUrl:candidate.sourceUrl,sections:['Actualitate'],keywords:['Romania']});
 assert.equal(validArticleSubject(value.articleSubject,candidate.sourceUrl),true);
 assert.equal(readNewsArticleMetadata(doc('',head),candidate,candidate.sourceUrl,now),null);
 assert.equal(readNewsArticleMetadata(doc('<meta name="publish-date" content="2026-11-22T18:59:00">'),candidate,candidate.sourceUrl,now),null);
 assert.equal(readNewsArticleMetadata(doc(head.replace('publish-date','article:modified_time')),candidate,candidate.sourceUrl,now),null);
});

test('discovery content hash and retained observation include the exact bound publisher subject',async()=>{
 const rss='<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(now).toUTCString()+'</lastBuildDate><item><title>'+row.title+'</title><link>'+row.sourceUrl+'</link></item></channel></rss>';
 const first=await discoverNewsWithDiagnostics(async input=>new Response(String(input)===NEWS_INDEX_URL?rss:document(article({articleSection:'Technology',keywords:['laptops']})),{headers:{'content-type':String(input)===NEWS_INDEX_URL?'application/rss+xml':'text/html'}}),now,[],undefined,{publisherIndexes:false,frontpageHighlights:false});
 const cards=first.sources.flatMap(result=>result.cards);assert.equal(cards.length,1);
 const card=cards[0];assert.deepEqual(card.articleSubject,subject(['Technology'],['laptops']));
 assert.equal(card.contentHash,digest(cardContent(card)));
 assert.notEqual(card.contentHash,digest(cardContent({...card,articleSubject:subject(['Science'],['laptops'])})));
 const later=now+120_000,empty='<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+'</link><lastBuildDate>'+new Date(later).toUTCString()+'</lastBuildDate></channel></rss>';
 const retained=await discoverNewsWithDiagnostics(async input=>{assert.equal(String(input),NEWS_INDEX_URL);return new Response(empty,{headers:{'content-type':'application/rss+xml'}});},later,[],undefined,{publisherIndexes:false,frontpageHighlights:false,retainedCards:cards});
 const kept=retained.sources.flatMap(result=>result.cards);assert.deepEqual(kept,[card]);
 assert.equal(kept[0].observedAt,checkedAt);assert.equal(kept[0].contentHash,card.contentHash);
 assert.equal(retained.diagnostics.totals.retained,1);assert.equal(retained.diagnostics.totals.verifiedNow,0);
});
