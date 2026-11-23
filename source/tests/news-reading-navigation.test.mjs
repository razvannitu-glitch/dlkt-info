import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const reader=readFileSync('.build/src/iceo/browser.js','utf8');
const start=reader.indexOf('async function showNewsPage(');
const end=reader.indexOf("required('#discovery').addEventListener('click'",start);
assert.ok(start>=0&&end>start,'test executes the actual compiled progressive-loading handler');
const handler=reader.slice(start,end).trim();
function harness(){
 let release,renders=0,focus=0,calls=0;const state={items:[{key:'old'}],loading:false,error:null,page:{nextCursor:'next'}};
 const title={tabIndex:0,focus(){focus++;},getBoundingClientRect(){return {top:100,bottom:140};},scrollIntoView(){}};
 const old={dataset:{newsStreamKey:'old'}},added={dataset:{newsStreamKey:'new'},querySelector(){return title;}};
 const root={querySelectorAll(){return state.items.length>1?[old,added]:[old];}};
 const context={language:'en',newsFilter:'all',newsPeriod:'today',newsSourceScope:'all',contextualCity:{id:'city'},newsInteractionRevision:1,newsInteractionKey:'',restartNewsEdition:false,
  document:{visibilityState:'visible',body:{dataset:{entryView:'start'}}},innerHeight:800,
  announcement:{textContent:''},required(){return root;},getLocale(){return context.language;},
  renderDiscovery(){renders++;},
  newsContinuation:{view(){return state;},next(){calls++;return new Promise(resolve=>{release=()=>{state.items.push({key:'new'});resolve();};});}},
 };
 const run=vm.runInNewContext('('+handler+')',context);
 return {context,run,release(){release();},result(){return {renders,focus,calls,announcement:context.announcement.textContent};}};
}
test('pending news continuation never focuses or announces a page after changing its period or reading context',async()=>{
 for(const [name,change] of [
  ['period',h=>{h.context.newsPeriod='recent';}],
  ['source scope',h=>{h.context.newsSourceScope='edition';}],
  ['local view',h=>{h.context.document.body.dataset.entryView='local';}],
  ['Explore',h=>{h.context.document.body.dataset.worldExplore='active';}],
  ['language',h=>{h.context.language='it';}],
  ['category',h=>{h.context.newsFilter='15000000';}],
  ['city',h=>{h.context.contextualCity={id:'other'};}],
  ['interaction revision',h=>{h.context.newsInteractionRevision+=2;}],
 ]){
  const h=harness(),pending=h.run(true);assert.equal(h.result().calls,1,name);change(h);h.release();await pending;
  assert.deepEqual(h.result(),{renders:0,focus:0,calls:1,announcement:''},name);
 }
});
test('news continuation still focuses the first appended heading when its reading context is unchanged',async()=>{
 const h=harness(),pending=h.run(true);h.release();await pending;
 assert.equal(h.result().renders,1);assert.equal(h.result().focus,1);assert.match(h.result().announcement,/available below/);
});
test('Explore, other reader views and hidden documents do not start news continuation',async()=>{
 for(const [name,change] of [
  ['Explore',h=>{h.context.document.body.dataset.worldExplore='active';}],
  ['local view',h=>{h.context.document.body.dataset.entryView='local';}],
  ['daily view',h=>{h.context.document.body.dataset.entryView='daily';}],
  ['hidden document',h=>{h.context.document.visibilityState='hidden';}],
 ]){
  const h=harness();change(h);const pending=h.run(true);
  // Release an unexpectedly started request so a failed guard reports directly,
  // rather than leaving a pending promise that cancels the rest of this file.
  if(h.result().calls)h.release();await pending;
  assert.deepEqual(h.result(),{renders:0,focus:0,calls:0,announcement:''},name);
 }
});
test('returning to the same News context still invalidates a request begun before an Explore or period round trip',async()=>{
 const renderStart=reader.indexOf('function renderDiscovery()');
 const begin=reader.indexOf('const interactionKey =',renderStart),finish=reader.indexOf('renderReturnBrief();',begin);
 assert.ok(renderStart>=0&&begin>renderStart&&finish>begin,'execute the actual compiled context revision guard');
 const contextGuard=reader.slice(begin,finish);
 for(const [name,leave,returnToNews] of [
  ['Explore',h=>{h.context.document.body.dataset.worldExplore='active';},h=>{delete h.context.document.body.dataset.worldExplore;}],
  ['period',h=>{h.context.newsPeriod='recent';},h=>{h.context.newsPeriod='today';}],
  ['source scope',h=>{h.context.newsSourceScope='edition';},h=>{h.context.newsSourceScope='all';}],
 ]){
  const h=harness();h.context.language='it';
  const update=vm.runInNewContext('(function(){'+contextGuard+'})',h.context);
  update();const before=h.context.newsInteractionRevision,originalKey=h.context.newsInteractionKey;
  const pending=h.run(true);assert.equal(h.result().calls,1,name);
  leave(h);update();returnToNews(h);update();
  assert.equal(h.context.newsInteractionKey,originalKey,'the final visible context matches the initial context');
  assert.equal(h.context.newsInteractionRevision,before+2,'both navigation changes invalidate earlier work');
  h.release();await pending;
  assert.deepEqual(h.result(),{renders:0,focus:0,calls:1,announcement:''},name);
  assert.equal(h.context.language,'it','navigation does not alter the chosen reading language');
 }
});
