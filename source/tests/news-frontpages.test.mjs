import test from 'node:test';
import assert from 'node:assert/strict';
import {collectFrontpageHighlights} from '../.build/src/iceo/news-frontpages.js';

const now=Date.parse('2026-11-20T20:00:00.000Z');
const home=['https://apnews.com/','https://www.theguardian.com/international','https://www.pcgamer.com/','https://www.bbc.com/news'];
const url='https://apnews.com/article/verified-news';
const candidate=(sourceUrl=url,publisher='Associated Press')=>({sourceUrl,publisher,title:'Controlled publisher headline',indexedAt:new Date(now).toISOString(),category:'world'});
const html=value=>new Response(value,{headers:{'content-type':'text/html; charset=utf-8'}});
const page=(links)=>`<html><body><main>${links}</main></body></html>`;
const empty=()=>html(page(''));

test('only exact candidate links in main count; no text/title match or article/body retention',async()=>{
  const requests=[];const result=await collectFrontpageHighlights(async(input,init)=>{
    requests.push({input:String(input),init});return String(input)===home[0]?html(`<header><a href="${url}">Headline</a></header><main>
      <a href="/article/not-a-candidate">Controlled publisher headline</a><a href="/article/verified-news?utm_source=home">Selected</a>
      <a href="${url}">Duplicate</a><a href="https://evil.example/">Other</a></main>`):empty();
  },[candidate()],now);
  assert.deepEqual(result,{urls:[url],checkedAt:new Date(now).toISOString(),available:true,rejected:0});
  assert.deepEqual(requests.map(row=>row.input),home);
  for(const {init} of requests){assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.headers.Authorization,undefined);}
  assert.deepEqual(Object.keys(result).sort(),['available','checkedAt','rejected','urls']);
});

test('header, navigation, templates, scripts and hidden links do not establish homepage selection',async()=>{
  const source=`<a href="${url}">outside</a><main><nav><a href="${url}">nav</a></nav>
    <template><a href="${url}">template</a></template><script>"<a href='${url}'>script</a>"</script>
    <section hidden><a href="${url}">hidden</a></section><section aria-hidden="true"><a href="${url}">aria</a></section></main>`;
  const result=await collectFrontpageHighlights(async()=>html(source),[candidate()],now);
  assert.deepEqual(result.urls,[]);assert.equal(result.available,true);
});

test('same-publisher matching is exact and the first ten unique matches retain DOM order',async()=>{
  const candidates=Array.from({length:12},(_,i)=>candidate(`https://apnews.com/article/item-${i}`));
  candidates.push(candidate('https://www.pcgamer.com/selected-game','PC Gamer'));
  const anchors=candidates.map(value=>`<a href="${value.sourceUrl}">Selected</a>`).join('');
  const result=await collectFrontpageHighlights(async(input)=>String(input)===home[0]?html(page(anchors)):empty(),candidates,now);
  assert.deepEqual(result.urls,candidates.slice(0,10).map(value=>value.sourceUrl));
});

test('a foreign base URL cannot turn a relative link into a publisher article match',async()=>{
  const result=await collectFrontpageHighlights(async(input)=>String(input)===home[0]
    ?html(`<head><base href="https://evil.example/"></head><main><a href="/article/verified-news">Foreign target</a></main>`):empty(),[candidate()],now);
  assert.deepEqual(result.urls,[]);
});

test('body-only, wrong publisher labels and unknown candidates cannot be featured',async()=>{
  let calls=0;const result=await collectFrontpageHighlights(async()=>{calls++;return html(`<body><article><a href="${url}">headline</a></article></body>`);},[candidate()],now);
  assert.equal(calls,4);assert.deepEqual(result.urls,[]);assert.equal(result.available,false);assert.equal(result.rejected,4);
  const forged=await collectFrontpageHighlights(async()=>{throw Error('must not fetch');},[candidate(url,'Reuters')],now);
  assert.deepEqual(forged.urls,[]);assert.equal(forged.available,false);
});

test('redirects stay on reviewed origins of the same publisher and stop after two',async()=>{
  const calls=[];const result=await collectFrontpageHighlights(async(input)=>{
    const value=String(input);calls.push(value);
    if(value===home[0])return new Response(null,{status:302,headers:{location:'https://www.apnews.com/'}});
    if(value==='https://www.apnews.com/')return html(page(`<a href="${url}">Selected</a>`));
    if(value===home[1])return new Response(null,{status:302,headers:{location:'https://evil.example/'}});
    return empty();
  },[candidate()],now);
  assert.deepEqual(result.urls,[url]);assert.equal(result.rejected,1);assert.ok(!calls.some(value=>value.includes('evil.example')));
  let redirects=0;const loop=await collectFrontpageHighlights(async(input)=>{
    if(String(input)===home[0]){redirects++;return new Response(null,{status:302,headers:{location:home[0]}});}return empty();
  },[candidate()],now);
  assert.equal(redirects,3);assert.equal(loop.rejected,1);
});

test('oversized pages preserve only completed main links within the byte budget and expose partial inspection',async()=>{
  const prefix=`<main><a href="${url}">Selected</a>`;
  let cancelled=0;
  const result=await collectFrontpageHighlights(async(input)=>String(input)===home[0]?new Response(new ReadableStream({
    start(controller){controller.enqueue(new TextEncoder().encode(prefix+' '.repeat(1_048_576)));},cancel(){cancelled++;},
  }),{headers:{'content-type':'text/html','content-length':'2000000'}}):empty(),[candidate()],now);
  assert.deepEqual(result.urls,[url]);assert.equal(result.available,true);assert.equal(result.rejected,1);assert.equal(cancelled,1);
  const incomplete=await collectFrontpageHighlights(async(input)=>String(input)===home[0]?html(`<main><a href="${url}"`):empty(),[candidate()],now);
  assert.deepEqual(incomplete.urls,[]);
});

test('errors, authorization walls and wrong content types isolate the failing page',async()=>{
  const other='https://www.pcgamer.com/game-news';
  const result=await collectFrontpageHighlights(async(input)=>{
    if(String(input)===home[0])return new Response('private error',{status:403});
    if(String(input)===home[1])return new Response('{}',{headers:{'content-type':'application/json'}});
    return html(page(`<a href="${other}">Game</a>`));
  },[candidate(),candidate(other,'PC Gamer')],now);
  assert.deepEqual(result.urls,[other]);assert.equal(result.rejected,2);assert.equal(result.available,true);
});

test('BBC news main adds only exact BBC candidates when the other reviewed homepages are unavailable',async()=>{
  const first='https://www.bbc.com/news/articles/cmde1lw9y54ko';
  const second='https://www.bbc.com/news/articles/c39w9l4v1p9ro';
  const unselected='https://www.bbc.com/news/articles/not-on-main';
  const requests=[];
  const result=await collectFrontpageHighlights(async(input)=>{
    const address=String(input);requests.push(address);
    if(address!==home[3])return new Response('unavailable',{status:403});
    return html(`<header><a href="${unselected}">Navigation</a></header><main>
      <nav><a href="${unselected}">Navigation</a></nav><a href="/news/articles/cmde1lw9y54ko">Selected</a>
      <a href="${second}">Selected</a><a href="${first}">Repeated</a><a href="${url}">Other publisher</a>
      <a href="/news/articles/not-in-pool">Controlled publisher headline</a></main>`);
  },[candidate(first,'BBC'),candidate(second,'BBC'),candidate(unselected,'BBC'),candidate()],now);
  assert.deepEqual(requests,home);assert.deepEqual(result.urls,[first,second]);assert.equal(result.available,true);assert.equal(result.rejected,3);
});

test('all requests share a bounded duration even when a transport ignores abort',async()=>{
  const started=Date.now();const signals=[];
  const result=await collectFrontpageHighlights(async(_input,init)=>{signals.push(init.signal);return new Promise(()=>{});},[candidate()],now,15);
  assert.ok(Date.now()-started<500);assert.equal(signals.length,4);assert.ok(signals.every(signal=>signal.aborted));
  assert.equal(result.available,false);assert.equal(result.rejected,4);
  const noBudget=await collectFrontpageHighlights(async()=>{throw Error('must not fetch');},[candidate()],now,0);
  assert.equal(noBudget.rejected,4);assert.deepEqual(noBudget.urls,[]);
});
