import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {LocalNewsService,parseLocalNews} from '../.build/src/local/news-service.js';
import {CITY_NEWS_FEEDS,NEWS_CHECK_MS,newsFeed,newsFeedsFor,newsGeographicAnchors,newsSourceForUrl,validLocalNewsArticle} from '../.build/src/local/news-policy.js';

const now=Date.parse('2026-11-18T20:30:00.000Z'),checkedAt=new Date(now).toISOString();
const city={id:'683506',name:'Bucharest',countryCode:'RO',country:'Romania',region:'Bucuresti',lat:44.4323,lon:26.1063,timezone:'Europe/Bucharest'};
const london={id:'2643743',name:'London',countryCode:'GB',country:'United Kingdom',region:'England',lat:51.5085,lon:-0.1257,timezone:'Europe/London'};
const b365=newsFeed('bucharest-b365'),buletin=newsFeed('bucharest-buletin');
assert.ok(b365);assert.ok(buletin);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const articleUrl=(source,index=1)=>source.id===b365.id?`https://b365.ro/restrictii-trafic-${123450+index}/`:`https://buletin.de/bucuresti/restrictii-trafic-${index}/`;
function item(source,{index=1,title='București: restricții de trafic la Metrorex',summary='Metrorex anunță restricții pe durata lucrărilor. Verificați traseul în articol.',date='Wed, 18 Nov 2026 18:00:00 +0000',url=articleUrl(source,index),creator='Autor Exemplu',category='Transport'}={}){
 return `<item><title>${escape(title)}</title><link>${escape(url)}</link>${date===null?'':`<pubDate>${escape(date)}</pubDate>`}<description><![CDATA[${summary}]]></description>${creator===null?'':`<dc:creator>${escape(creator)}</dc:creator>`}<category>${escape(category)}</category></item>`;
}
function feed(source,items=[item(source)],{title=source.title,home=source.home}={}){
 return `<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escape(title)}</title><link>${escape(home)}</link>${items.join('')}</channel></rss>`;
}
const parse=(source,body=feed(source),time=now,at=checkedAt)=>parseLocalNews(body,source.id,city,at,time);
const xmlResponse=body=>new Response(body,{status:200,headers:{'content-type':'application/rss+xml; charset=UTF-8'}});
const robotsResponse=(body='User-agent: *\nAllow: /\n',status=200)=>new Response(body,{status,headers:{'content-type':'text/plain'}});
const sourceForRequest=url=>CITY_NEWS_FEEDS.find(source=>new URL(source.endpoint).origin===new URL(url).origin);


test('reviewed journalism keeps publisher dates, exact feed provenance, local anchors and required licence attribution',()=>{
 for(const source of CITY_NEWS_FEEDS){
  const body=feed(source),result=parse(source,body);assert.equal(result.articles.length,1);assert.equal(result.rejected,0);
  const article=result.articles[0];assert.ok(validLocalNewsArticle(article,city,now));
  assert.equal(article.publishedAt,'2026-11-18T18:00:00.000Z');assert.equal(article.checkedAt,checkedAt);
  assert.equal(article.validUntil,new Date(now+NEWS_CHECK_MS).toISOString());assert.equal(article.documentUrl,source.endpoint);
  assert.equal(article.documentHash,createHash('sha256').update(body).digest('hex'));
  assert.equal(article.geographyBasis,'article-place-reference');assert.ok(article.geoAnchors.includes('București'));assert.ok(article.geoAnchors.includes('Metrorex'));
  assert.ok(article.title.length+(article.summary?.length??0)<=source.quoteLimit);
  assert.equal(article.url,articleUrl(source));
  if(source.id===buletin.id){assert.equal(article.byline,'By Autor Exemplu');assert.equal(article.licenseUrl,'https://creativecommons.org/licenses/by/4.0/');}
 }
});

test('a saved or forged foreign city cannot make Bucharest feed records local there',()=>{
 assert.deepEqual(newsFeedsFor(london),[]);
 assert.throws(()=>parseLocalNews(feed(b365),b365.id,london,checkedAt,now),/NEWS_SOURCE_IDENTITY/u);
 const article=parse(b365).articles[0];
 for(const wrong of [london,{...city,countryCode:'GB'},{...city,timezone:'Europe/London'},{...city,id:'11111',name:'Bucharest'}])assert.equal(validLocalNewsArticle(article,wrong,now),false);
});

test('national headlines, publisher footer names and nearby-town references do not become city news',()=>{
 const title='Decizie privind taxele naționale';
 const trailer=`<p>Guvernul anunță o măsură națională.</p><p>The post ${title} appeared first on Buletin de București.</p>`;
 const result=parse(buletin,feed(buletin,[item(buletin,{title,summary:trailer,category:'Știri București'})]));
 assert.equal(result.articles.length,0);assert.equal(result.rejected,1);
 const national=parse(b365,feed(b365,[item(b365,{title:'Candidat la prezidențiale, plasat în arest la domiciliu de Tribunalul Ilfov',summary:'Decizia nu este definitivă.',category:'Știri București'})]));
 assert.equal(national.articles.length,0);
 assert.deepEqual(newsGeographicAnchors('Accident lângă București, în comuna Găneasa',undefined,b365.id,city),[]);
 assert.deepEqual(newsGeographicAnchors('Municipiul Voluntari, amânat de Curtea Constituțională',undefined,buletin.id,city),[]);
 assert.ok(newsGeographicAnchors('Programul Metrorex se modifică în 2027',undefined,buletin.id,city).includes('Metrorex'));
});

test('only complete publisher sentences inside the combined quote allowance are exposed',()=>{
 const title='București: '+('titlu '.repeat(35)).trim();
 const result=parse(b365,feed(b365,[item(b365,{title,summary:'O frază foarte lungă '+('calificare '.repeat(40))+' care nu trebuie tăiată la mijloc.'})]));
 assert.equal(result.articles.length,1);assert.equal(result.articles[0].title,title);assert.equal(result.articles[0].summary,undefined);
 const longer=feed(b365,[item(b365,{title:'București: '+('x'.repeat(250))})]);assert.equal(parse(b365,longer).articles.length,0);
 const withScripts=parse(b365,feed(b365,[item(b365,{summary:'<script>secret()</script><p>Metrorex publică programul complet.</p>'})])).articles[0];
 assert.doesNotMatch(JSON.stringify(withScripts),/secret\(\)|<script/);
});

test('changed channel identities, homepages, malformed XML, entities and oversized bytes fail closed',()=>{
 assert.throws(()=>parse(b365,feed(b365,undefined,{title:'B365 lookalike'})),/SOURCE_IDENTITY_MISMATCH/u);
 assert.throws(()=>parse(buletin,feed(buletin,undefined,{home:'https://buletin.de/'})),/SOURCE_IDENTITY_MISMATCH/u);
 assert.throws(()=>parse(b365,'<!DOCTYPE rss>'+feed(b365)),/SOURCE_XML_REJECTED/u);
 assert.throws(()=>parse(b365,'<rss><channel>'),/SOURCE_XML_REJECTED/u);
 assert.throws(()=>parse(b365,'é'.repeat(1_048_577)),/NEWS_BODY_TOO_LARGE/u);
 assert.throws(()=>parse(b365,feed(b365,Array.from({length:201},(_,index)=>item(b365,{index:index+1})))),/SOURCE_SCHEMA_INVALID/u);
});

test('wrong hosts, private targets, credentials, non-article paths and unreviewed query URLs are rejected',()=>{
 for(const url of ['https://b365.ro.attacker.invalid/restrictii-123456/','https://127.0.0.1/restrictii-123456/','https://user:pass@b365.ro/restrictii-123456/','http://b365.ro/restrictii-123456/','https://b365.ro:8443/restrictii-123456/','https://b365.ro/wp-admin/','https://b365.ro/restrictii-123456/?redirect=private','javascript:alert(1)']){
  const result=parse(b365,feed(b365,[item(b365,{url})]));assert.equal(result.articles.length,0,url);assert.equal(newsSourceForUrl(url),undefined,url);
 }
 assert.equal(newsSourceForUrl('https://buletin.de/bucuresti/termeni-si-conditii/'),undefined);
});

test('unknown, future and old publication dates are never replaced with retrieval time',()=>{
 for(const date of [null,'not a date',new Date(now+301000).toUTCString(),'2026-11-18','2026-11-18T18:00:00','Wed, 18 Nov 2026 18:00:00']){
  const result=parse(b365,feed(b365,[item(b365,{date})]));assert.equal(result.articles.length,0);assert.equal(result.rejected,1);
 }
 assert.equal(parse(b365,feed(b365,[item(b365,{date:new Date(now-72*3600000-1000).toUTCString()})])).articles.length,0);
 assert.equal(parse(b365,feed(b365,[item(b365,{date:new Date(now-72*3600000).toUTCString()})])).articles.length,1);
 for(const at of [new Date(now-NEWS_CHECK_MS).toISOString(),new Date(now+5001).toISOString(),'2026-02-31T00:00:00.000Z','invalid'])assert.throws(()=>parse(b365,feed(b365),now,at),/NEWS_CHECK_EXPIRED/u);
 assert.throws(()=>parse(b365,feed(b365),Date.parse('2026-12-19T12:00:00Z'), '2026-12-19T12:00:00.000Z'),/NEWS_RIGHTS_EXPIRED/u);
});

test('duplicate URLs are collapsed and each source is capped without fabricated padding',()=>{
 const result=parse(b365,feed(b365,[item(b365),item(b365),item(b365,{index:2})]));
 assert.equal(result.articles.length,2);assert.equal(result.rejected,1);assert.equal(new Set(result.articles.map(a=>a.id)).size,2);
 const many=parse(b365,feed(b365,Array.from({length:50},(_,i)=>item(b365,{index:i+1}))));assert.equal(many.articles.length,20);
});

test('article validation detects metadata, scope, quote, provenance and date substitution',()=>{
 const article=parse(buletin).articles[0];
 const changes=[{cityId:london.id},{publisher:'Other publisher'},{sourceId:b365.id},{url:articleUrl(b365)},{documentUrl:'https://buletin.de/private/'},{documentHash:'bad'},{geoAnchors:['London']},{geographyBasis:'publisher-country'},{topic:'events'},{publishedAt:checkedAt,checkedAt:new Date(now-NEWS_CHECK_MS).toISOString()},{validUntil:new Date(now+NEWS_CHECK_MS+1).toISOString()},{attribution:'No attribution'},{byline:undefined},{licenseUrl:undefined},{summary:'x'.repeat(500)}];
 for(const change of changes)assert.equal(validLocalNewsArticle({...article,...change},city,now),false,JSON.stringify(change));
});

test('source caching shares concurrent requests and preserves original check and publication timestamps',async()=>{
 let time=now;const calls=[];
 const fetcher=async(url)=>{calls.push(String(url));const source=sourceForRequest(String(url));assert.ok(source);return String(url).endsWith('/robots.txt')?robotsResponse():xmlResponse(feed(source));};
 const service=new LocalNewsService(fetcher,()=>time);
 const [first,parallel]=await Promise.all([service.snapshot(city),service.snapshot(city)]);assert.equal(calls.length,4);assert.deepEqual(first,parallel);assert.equal(first.articles.length,2);
 time+=60000;const cached=await service.snapshot(city);assert.equal(calls.length,4);assert.equal(cached.articles[0].checkedAt,first.articles[0].checkedAt);assert.equal(cached.articles[0].publishedAt,first.articles[0].publishedAt);
 time=now+120001;const refreshed=await service.snapshot(city);assert.equal(calls.length,6);assert.equal(refreshed.articles[0].checkedAt,new Date(time).toISOString());assert.equal(refreshed.articles[0].publishedAt,first.articles[0].publishedAt);
 assert.deepEqual(await service.snapshot(london),{articles:[],sources:[]});assert.equal(calls.length,6);
});

test('robots denial and content denial isolate the failed source while preserving the other publication',async()=>{
 for(const denied of [401,403,429,500]){
  const requests=[];const service=new LocalNewsService(async url=>{
   const value=String(url);requests.push(value);const source=sourceForRequest(value);assert.ok(source);
   if(value===new URL(b365.endpoint).origin+'/robots.txt')return robotsResponse('Denied',denied);
   return value.endsWith('/robots.txt')?robotsResponse():xmlResponse(feed(source));
  },()=>now);
  const result=await service.snapshot(city);assert.equal(result.articles.length,1);assert.equal(result.articles[0].sourceId,buletin.id);
  assert.equal(result.sources.find(s=>s.sourceId===b365.id).state,'unavailable');assert.ok(!requests.includes(b365.endpoint));
 }
 const requests=[];const denied=new LocalNewsService(async url=>{const value=String(url);requests.push(value);const source=sourceForRequest(value);assert.ok(source);return value.endsWith('/robots.txt')?robotsResponse(source.id===b365.id?'User-agent: *\nDisallow: /feed/\n':'User-agent: *\nAllow: /\n'):xmlResponse(feed(source));},()=>now);
 const result=await denied.snapshot(city);assert.equal(result.articles.length,1);assert.ok(!requests.includes(b365.endpoint));
});

test('only a missing reviewed robots resource gets unavailable semantics; a missing feed remains unavailable',async()=>{
 const service=new LocalNewsService(async url=>{const value=String(url);const source=sourceForRequest(value);assert.ok(source);if(value.endsWith('/robots.txt'))return robotsResponse('Not found',404);if(source.id===b365.id)return new Response('Not found',{status:404});return xmlResponse(feed(source));},()=>now);
 const result=await service.snapshot(city);assert.equal(result.articles.length,1);assert.equal(result.sources.find(s=>s.sourceId===b365.id).error,'NEWS_HTTP_404');
});

test('rate-limit backoff observes Retry-After and does not refetch or restamp during the wait',async()=>{
 let time=now,limited=true;const calls=[];
 const service=new LocalNewsService(async url=>{const value=String(url);calls.push(value);const source=sourceForRequest(value);assert.ok(source);if(value.endsWith('/robots.txt'))return robotsResponse();if(source.id===b365.id&&limited)return new Response('Limited',{status:429,headers:{'retry-after':'120'}});return xmlResponse(feed(source));},()=>time);
 const first=await service.snapshot(city);assert.equal(first.articles.length,1);const count=calls.filter(x=>x===b365.endpoint).length;
 limited=false;time=now+61000;const waiting=await service.snapshot(city);assert.equal(calls.filter(x=>x===b365.endpoint).length,count);assert.equal(waiting.sources.find(s=>s.sourceId===b365.id).error,'NEWS_BACKOFF');
 time=now+120001;const recovered=await service.snapshot(city);assert.equal(recovered.articles.length,2);assert.equal(calls.filter(x=>x===b365.endpoint).length,count+1);
});
