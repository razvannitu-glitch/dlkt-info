import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {knowledgeTargetFromHash} from '../.build/src/iceo/knowledge.js';

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
 const context={language:'en',newsFilter:'all',newsPeriod:'today',contextualCity:{id:'city'},newsInteractionRevision:1,knowledge:false,
  document:{visibilityState:'visible',body:{dataset:{entryView:'start'}}},innerHeight:800,
  announcement:{textContent:''},required(){return root;},getLocale(){return context.language;},
  knowledgeModeActive(){return context.knowledge;},renderDiscovery(){renders++;},
  newsContinuation:{view(){return state;},next(){calls++;return new Promise(resolve=>{release=()=>{state.items.push({key:'new'});resolve();};});}},
 };
 const run=vm.runInNewContext('('+handler+')',context);
 return {context,run,release(){release();},result(){return {renders,focus,calls,announcement:context.announcement.textContent};}};
}
test('pending news continuation never focuses or announces a page after changing the period or reader mode',async()=>{
 for(const change of [
  h=>{h.context.newsPeriod='recent';},
  h=>{h.context.knowledge=true;},
  h=>{h.context.document.body.dataset.entryView='local';},
  h=>{h.context.document.body.dataset.worldExplore='active';},
  h=>{h.context.language='it';},
  h=>{h.context.newsFilter='15000000';},
  h=>{h.context.contextualCity={id:'other'};},
  h=>{h.context.newsInteractionRevision+=2;},
 ]){
  const h=harness(),pending=h.run(true);assert.equal(h.result().calls,1);change(h);h.release();await pending;
  assert.deepEqual(h.result(),{renders:0,focus:0,calls:1,announcement:''});
 }
});
test('news continuation still focuses the first appended heading when its reading context is unchanged',async()=>{
 const h=harness(),pending=h.run(true);h.release();await pending;
 assert.equal(h.result().renders,1);assert.equal(h.result().focus,1);assert.match(h.result().announcement,/available below/);
});
test('knowledge and Explore views do not start hidden news continuation',async()=>{
 for(const change of [h=>{h.context.knowledge=true;},h=>{h.context.document.body.dataset.worldExplore='active';}]){
  const h=harness();change(h);await h.run(true);assert.equal(h.result().calls,0);
 }
});
test('returning to News removes knowledge deep links and plan anchors while preserving the chosen language',()=>{
 const source=readFileSync('.build/src/iceo/knowledge-browser.js','utf8');
 const begin=source.indexOf('function showMode('),finish=source.indexOf('function render()',begin);
 assert.ok(begin>=0&&finish>begin);
 const body=source.slice(begin,finish).trim();
 for(const hash of ['#know/venus-rotation','#knowledge-plan']){
  let replacement=null;
  const context={document:{body:{dataset:{}},dispatchEvent(){}},location:{hash,href:'https://www.dlkt.ee/?lang=it'+hash},
   history:{replaceState(_state,_title,url){replacement=url;}},URL,knowledgeTargetFromHash,
   clearShare(){},render(){},CustomEvent:class{constructor(type){this.type=type;}},required(){return {focus(){}};}};
  const show=vm.runInNewContext('('+body+')',context);show('news',false,true);
  assert.ok(replacement);assert.equal(replacement.hash,'');assert.equal(replacement.searchParams.get('lang'),'it');
  assert.equal(context.document.body.dataset.readerContent,'news');
 }
});
