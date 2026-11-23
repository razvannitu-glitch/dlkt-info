import test from 'node:test';
import assert from 'node:assert/strict';
import {collectEditorialSnapshot} from '../.build/src/iceo/editorial-engine.js';
import {NEWS_INDEX_URL} from '../.build/src/iceo/news-sources.js';
import {validTopicSnapshot} from '../.build/src/daily/contracts.js';
import {validDailySnapshot} from '../.build/src/iceo/daily-cache.js';
import {currentCard} from '../.build/src/share/current-card.js';
import {validArchiveCard} from '../.build/src/share/archive.js';

test('verified public news survives an isolated official-record conflict and resolves the same share',async()=>{
  const now=Date.now(),stamp=new Date(now).toISOString(),date=new Date(now-60_000).toISOString();
  const url='https://www.reuters.com/world/controlled-international-summit';
  const title='World leaders meet at international summit to negotiate a ceasefire';
  const response=(body,type)=>new Response(body,{headers:{'Content-Type':type}});
  const fetcher=async input=>{
    const address=String(input);
    if(address===NEWS_INDEX_URL)return response(`<rss><channel><title>GDELT Article List RSS Feed</title><link>${NEWS_INDEX_URL}</link><lastBuildDate>${new Date(now).toUTCString()}</lastBuildDate><item><title>${title}</title><link>${url}</link></item></channel></rss>`,'application/rss+xml');
    if(address===url)return response(`<html><head><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({'@type':'NewsArticle',url,headline:title,datePublished:date})}</script></head></html>`,'text/html');
    return new Response('',{status:503});
  };
  const official={version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'test',mode:'current-official-records',generatedAt:stamp,state:'partial',
    sources:[{id:'ecb-news',label:'ECB',publisher:'European Central Bank',topic:'business',state:'partial',checkedAt:stamp,verifiedAt:stamp,count:0,rejected:2,error:null,retryAt:null,scope:'Conflicting records isolated.',termsUrl:'https://www.ecb.europa.eu/services/disclaimer/html/index.en.html',windowed:true}],
    cards:[],conflictCount:1,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['business']};
  const snapshot=await collectEditorialSnapshot(fetcher,()=>now,async()=>official,{});
  assert.equal(snapshot.mode,'current-source-records');assert.equal(snapshot.state,'partial');assert.equal(snapshot.conflictCount,1);
  assert.equal(snapshot.cards.length,1);assert.equal(snapshot.cards[0].publisher,'Reuters');
  assert.equal(validTopicSnapshot(snapshot,now),true);assert.equal(validDailySnapshot(snapshot,now),true);
  const card=snapshot.cards[0],resolved=currentCard(snapshot,{id:card.id,revision:card.contentHash},now,true);
  assert.equal(resolved.card.sourceUrl,url);assert.equal(validArchiveCard(resolved.card),true);
  assert.equal(snapshot.sources.find(source=>source.id==='news-world').count,1);
});


const candidateEnvironment={
  DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',
  DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrstuvwx',
  DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'x'.repeat(43),
};
const editorialCandidate=(now,name,changes={})=>({
  sourceUrl:'https://www.ign.com/articles/'+name,
  title:'GTA 6 launches with a new multiplayer update',
  publisher:'IGN',indexedAt:new Date(now).toISOString(),category:'gaming',...changes,
});

async function candidateCollection({now,seeds,incoming,advanceMs=0,originals=[...seeds,...incoming]}){
  let current=now,reads=0;
  const posts=[],publishedAt=new Date(now-60_000).toISOString(),stamp=new Date(now).toISOString();
  const articles=new Map(originals.map(candidate=>[candidate.sourceUrl,candidate]));
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const fetcher=async(input,init={})=>{
    const address=new URL(String(input));
    if(address.origin===candidateEnvironment.DLKT_INFO_SUPABASE_URL&&address.pathname==='/rest/v1/dlkt_info_news_candidates'){
      reads++;
      const offset=Number(address.searchParams.get('offset')??0),limit=Number(address.searchParams.get('limit'));
      return json(seeds.slice(offset,offset+limit).map(candidate=>({
        source_url:candidate.sourceUrl,title:candidate.title,publisher:candidate.publisher,
        indexed_at:candidate.indexedAt,category:candidate.category,
      })));
    }
    if(address.origin===candidateEnvironment.DLKT_INFO_SUPABASE_URL&&address.pathname==='/rest/v1/rpc/dlkt_info_upsert_news_candidates'){
      const payload=JSON.parse(init.body);
      posts.push({method:init.method,payload});
      return json({accepted:payload.p_candidates.length});
    }
    if(address.href===NEWS_INDEX_URL){
      current=now+advanceMs;
      const items=incoming.map(candidate=>'<item><title>'+candidate.title+'</title><link>'+candidate.sourceUrl+'</link></item>').join('');
      return new Response('<rss><channel><title>GDELT Article List RSS Feed</title><link>'+NEWS_INDEX_URL+
        '</link><lastBuildDate>'+new Date(now).toUTCString()+'</lastBuildDate>'+items+'</channel></rss>',
        {headers:{'Content-Type':'application/rss+xml'}});
    }
    const article=articles.get(address.href);
    if(article)return new Response('<html><head><link rel="canonical" href="'+article.sourceUrl+
      '"><script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:article.sourceUrl,
        headline:article.title,datePublished:publishedAt})+'</script></head></html>',{headers:{'Content-Type':'text/html'}});
    return new Response('',{status:503});
  };
  const official={version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'test',mode:'current-official-records',
    generatedAt:stamp,state:'partial',sources:[],cards:[],conflictCount:0,duplicateCount:0,deltaAvailable:false,
    scheduledDelivery:false,accountPersistence:false,coverage:[]};
  const snapshot=await collectEditorialSnapshot(fetcher,()=>current,async()=>official,candidateEnvironment);
  return {snapshot,posts,reads,persistAt:current,publishedAt};
}

test('candidate persistence expires a seed at the write clock without discarding fresh discovery',async()=>{
  const now=Date.now();
  const expired=editorialCandidate(now,'expired-discovery',{indexedAt:new Date(now-86_400_000+1).toISOString()});
  const fresh=editorialCandidate(now,'fresh-discovery',{title:'GTA 6 announces a new multiplayer update'});
  const result=await candidateCollection({now,seeds:[expired],incoming:[fresh],advanceMs:2_000,originals:[fresh]});
  assert.equal(result.reads,1);
  assert.equal(result.persistAt,now+2_000);
  assert.equal(result.posts.length,1,'an expired seed must not prevent the fresh candidate from reaching the RPC');
  assert.equal(result.posts[0].method,'POST');
  assert.deepEqual(result.posts[0].payload,{p_candidates:[fresh]});
  const card=result.snapshot.cards.find(card=>card.sourceUrl===fresh.sourceUrl);
  assert.ok(card,'fresh discovery still requires and obtains valid original publication metadata');
  assert.equal(card.publisher,fresh.publisher);
  assert.equal(card.title,fresh.title);
  assert.equal(card.date,result.publishedAt,'indexedAt must not replace the original publication date');
  assert.equal(validTopicSnapshot(result.snapshot,result.persistAt),true);
  assert.equal(validDailySnapshot(result.snapshot,result.persistAt),true);
});

test('unchanged candidate observations are reverified without another persistence POST',async()=>{
  const now=Date.now();
  const unchanged=editorialCandidate(now,'unchanged-discovery',{indexedAt:new Date(now-30_000).toISOString()});
  const result=await candidateCollection({now,seeds:[unchanged],incoming:[]});
  assert.equal(result.reads,1,'the persisted observation must actually be read');
  assert.equal(result.posts.length,0,'an unchanged seed must not be rewritten');
  const card=result.snapshot.cards.find(card=>card.sourceUrl===unchanged.sourceUrl);
  assert.ok(card,'skipping an unchanged cache write must not skip original verification');
  assert.equal(card.date,result.publishedAt);
  assert.equal(validTopicSnapshot(result.snapshot,result.persistAt),true);
});

test('new candidates and changed observations persist, including indexedAt-only rediscovery',async()=>{
  const now=Date.now();
  const renewed=editorialCandidate(now,'renewed-discovery',{indexedAt:new Date(now-30_000).toISOString()});
  const revised=editorialCandidate(now,'revised-discovery',{title:'GTA 6 multiplayer release date announced'});
  const fresh=editorialCandidate(now,'new-discovery',{title:'GTA 6 announces a new multiplayer update'});
  const rediscovered={...renewed,indexedAt:new Date(now).toISOString()};
  const updated={...revised,title:'GTA 6 multiplayer release date delayed'};
  const incoming=[rediscovered,updated,fresh];
  const result=await candidateCollection({now,seeds:[renewed,revised],incoming,advanceMs:2_000});
  assert.equal(result.reads,1);
  assert.equal(result.posts.length,1);
  assert.equal(result.posts[0].method,'POST');
  const written=result.posts[0].payload.p_candidates;
  const byUrl=new Map(written.map(candidate=>[candidate.sourceUrl,candidate]));
  assert.equal(written.length,3);
  for(const expected of incoming)assert.deepEqual(byUrl.get(expected.sourceUrl),expected);
  assert.notEqual(byUrl.get(renewed.sourceUrl).indexedAt,renewed.indexedAt,'a new observation refreshes cache eligibility even when its headline is unchanged');
  assert.equal(byUrl.get(revised.sourceUrl).indexedAt,revised.indexedAt,'headline-only changes remain writes even at the same observation timestamp');
  const card=result.snapshot.cards.find(card=>card.sourceUrl===fresh.sourceUrl);
  assert.ok(card);
  assert.equal(card.date,result.publishedAt);
  assert.equal(validTopicSnapshot(result.snapshot,result.persistAt),true);
  assert.equal(validDailySnapshot(result.snapshot,result.persistAt),true);
});
