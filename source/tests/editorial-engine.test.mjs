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
