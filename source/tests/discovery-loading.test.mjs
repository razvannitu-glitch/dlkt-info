import test from 'node:test';
import assert from 'node:assert/strict';
import {DiscoveryLoading,DISCOVERY_SLOW_MS,discoveryLoadingPhase,renderDiscoveryLoading,bindDiscoveryLoadingActions} from '../.build/src/iceo/loading.js';

const pending={pending:true,unavailable:false,firstCount:0,moreCount:0};
const empty={...pending,pending:false};
const unavailable={...empty,unavailable:true};

// Explicit clock fixtures exercise request boundaries without real time or network requests.
function controlledClock(){
 let time=100,sequence=0;
 const jobs=new Map(),cancelled=[];
 const clock={
  now:()=>time,
  schedule:(callback,delay)=>{const handle={id:++sequence};jobs.set(handle,{callback,at:time+delay});return handle;},
  cancel:handle=>{cancelled.push(handle);jobs.delete(handle);},
 };
 const advance=elapsed=>{
  time+=elapsed;
  for(const [handle,job]of [...jobs])if(job.at<=time){jobs.delete(handle);job.callback();}
 };
 return{clock,advance,jobs,cancelled};
}

test('first waiting, verified empty and unavailable acquisition are distinct states',()=>{
 assert.equal(discoveryLoadingPhase(pending,null,50_000),'initial');
 assert.equal(discoveryLoadingPhase(empty,null,50_000),'hidden');
 assert.equal(discoveryLoadingPhase(unavailable,null,50_000),'error');
 assert.equal(discoveryLoadingPhase({...unavailable,pending:true},100,100),'initial');
});

test('both top cards and continuation-only reports remain usable during refresh or a refresh failure',()=>{
 for(const selection of [{firstCount:2,moreCount:0},{firstCount:0,moreCount:12}]){
  assert.equal(discoveryLoadingPhase({...pending,...selection},0,50_000),'hidden');
  assert.equal(discoveryLoadingPhase({...unavailable,...selection},null,50_000),'hidden');
 }
});

test('one request becomes slow only after eight seconds and repeated begin calls do not restart it',()=>{
 const runtime=controlledClock();let notices=0;
 const loading=new DiscoveryLoading(()=>{notices++;},runtime.clock);
 loading.begin();runtime.advance(4_000);loading.begin();
 assert.equal(runtime.jobs.size,1);
 runtime.advance(3_999);assert.equal(notices,0);assert.equal(loading.phase(pending),'initial');
 runtime.advance(1);assert.equal(notices,1);assert.equal(loading.phase(pending),'slow');
 runtime.advance(20_000);assert.equal(notices,1);assert.equal(runtime.jobs.size,0);
 loading.finish();
});

test('fast successful results are immediately visible and cancel the waiting timer',()=>{
 const runtime=controlledClock();let notices=0;
 const loading=new DiscoveryLoading(()=>{notices++;},runtime.clock);
 loading.begin();runtime.advance(1);loading.finish();
 assert.equal(loading.phase({...empty,firstCount:3}),'hidden');
 assert.equal(runtime.jobs.size,0);assert.equal(runtime.cancelled.length,1);
 runtime.advance(DISCOVERY_SLOW_MS);assert.equal(notices,0);
});

test('a failed request finishes as an error and retry receives a fresh waiting deadline',()=>{
 const runtime=controlledClock();let notices=0;
 const loading=new DiscoveryLoading(()=>{notices++;},runtime.clock);
 loading.begin();runtime.advance(DISCOVERY_SLOW_MS);assert.equal(notices,1);
 loading.finish();assert.equal(loading.phase(unavailable),'error');
 loading.begin();assert.equal(loading.phase({...pending,unavailable:true}),'initial');
 runtime.advance(DISCOVERY_SLOW_MS-1);assert.equal(notices,1);
 runtime.advance(1);assert.equal(notices,2);assert.equal(loading.phase(pending),'slow');
 loading.finish();
});

test('a cancelled callback from an earlier request cannot mark the retry as slow',()=>{
 const runtime=controlledClock();let notices=0;
 const loading=new DiscoveryLoading(()=>{notices++;},runtime.clock);
 loading.begin();const stale=[...runtime.jobs.values()][0].callback;
 loading.finish();loading.begin();stale();
 assert.equal(notices,0);assert.equal(loading.phase(pending),'initial');
 runtime.advance(DISCOVERY_SLOW_MS);assert.equal(notices,1);
 loading.finish();
});

class ElementFixture {
 constructor(text='',hidden=false){
  this._text=text;this.textWrites=0;this.hidden=hidden;this.phaseWrites=0;this.listeners=new Map();this.classes=new Set();
  this.isConnected=true;this.disabled=false;this.focusCalls=[];this.open=false;this.descendants=new Set();this.layout=true;
  this.dataset=new Proxy({phase:'initial'},{set:(target,key,value)=>{if(key==='phase')this.phaseWrites++;target[key]=value;return true;}});
  this.classList={toggle:(name,on)=>{if(on)this.classes.add(name);else this.classes.delete(name);}};
  this.scene={identity:'server-supplied-decoration'};
 }
 get textContent(){return this._text;}
 set textContent(value){this.textWrites++;this._text=value;}
 addEventListener(event,callback){const listeners=this.listeners.get(event)??new Set();listeners.add(callback);this.listeners.set(event,listeners);}
 removeEventListener(event,callback){this.listeners.get(event)?.delete(callback);}
 dispatch(event){for(const callback of this.listeners.get(event)??[])callback();}
 click(){this.dispatch('click');}
 getClientRects(){return this.isConnected&&!this.hidden&&this.layout?[{}]:[];}
 contains(node){return node===this||this.descendants.has(node);}
 focus(options){this.focusCalls.push(options);this.ownerDocument.activeElement=this;}
 replaceChildren(){throw Error('STATIC_LOADING_DOM_MUST_NOT_BE_REPLACED');}
}
function elements(){
 const status=new ElementFixture("Loading today's stories.");status.classes.add('sr-only');
 return{
  panel:new ElementFixture(),title:new ElementFixture('Your day, coming into focus.'),
  copy:new ElementFixture("Loading today's stories from connected sources."),
  personalise:new ElementFixture('Personalise'),hint:new ElementFixture('Choose your interests while we load.'),
  retry:new ElementFixture('Try again',true),status,
 };
}
function focusEnvironment(view){
 const body=new ElementFixture(),settings=new ElementFixture(),settingsFallback=new ElementFixture(),menuFallback=new ElementFixture('',true),retryTarget=new ElementFixture();
 const owner={body,activeElement:body};
 for(const element of [...Object.values(view),body,settings,settingsFallback,menuFallback,retryTarget])element.ownerDocument=owner;
 return{owner,settings,settingsFallback,menuFallback,retryTarget};
}

test('initial city and memory rerenders reuse the static composition without restarting its phase',()=>{
 const view=elements(),scene=view.panel.scene;
 for(let index=0;index<4;index++)renderDiscoveryLoading(view,'initial');
 assert.equal(view.panel.scene,scene);assert.equal(view.panel.phaseWrites,0);
 assert.equal(view.title.textWrites,0);assert.equal(view.copy.textWrites,0);assert.equal(view.status.textWrites,0);
 assert.equal(view.panel.hidden,false);assert.equal(view.personalise.hidden,false);assert.equal(view.hint.hidden,false);
 assert.equal(view.retry.hidden,true);assert.equal(view.status.classes.has('sr-only'),true);
});

test('slow state updates once, stays truthful and does not rewrite the decorative DOM',()=>{
 const view=elements(),scene=view.panel.scene;
 renderDiscoveryLoading(view,'slow');renderDiscoveryLoading(view,'slow');
 assert.equal(view.panel.dataset.phase,'slow');assert.equal(view.panel.phaseWrites,1);assert.equal(view.panel.scene,scene);
 assert.equal(view.title.textContent,'Still connecting.');assert.equal(view.title.textWrites,1);
 assert.equal(view.copy.textContent,"Today's stories are taking longer to load. You can choose your interests while this check finishes.");
 assert.equal(view.status.textWrites,1);assert.equal(view.personalise.hidden,false);assert.equal(view.retry.hidden,true);
 assert.doesNotMatch(view.copy.textContent,/\d|%|almost|complete|verified/u);
});

test('error presents an actual retry and successful or empty completion restores the regular status',()=>{
 const view=elements();
 renderDiscoveryLoading(view,'error');
 assert.equal(view.title.textContent,"Let's try that again.");
 assert.equal(view.copy.textContent,"Today's stories could not be loaded. Check your connection or try again.");
 assert.equal(view.retry.hidden,false);assert.equal(view.personalise.hidden,true);assert.equal(view.hint.hidden,true);
 renderDiscoveryLoading(view,'hidden');
 assert.equal(view.panel.hidden,true);assert.equal(view.status.classes.has('sr-only'),false);
 renderDiscoveryLoading(view,'initial');
 assert.equal(view.panel.hidden,false);assert.equal(view.retry.hidden,true);assert.equal(view.personalise.hidden,false);assert.equal(view.hint.hidden,false);
});

test('loading buttons invoke only the existing supplied actions and can be unbound',()=>{
 const view=elements();let settings=0,refreshes=0;
 const focus=focusEnvironment(view);
 const unbind=bindDiscoveryLoadingActions(view,{personalise:()=>{settings++;},retry:()=>{refreshes++;}},focus);
 view.personalise.click();assert.equal(settings,1);assert.equal(refreshes,0);
 renderDiscoveryLoading(view,'error');view.retry.click();assert.equal(refreshes,1);assert.equal(settings,1);
 unbind();view.retry.click();view.personalise.click();assert.equal(refreshes,1);assert.equal(settings,1);
});

test('closing loader-opened settings after timeout or successful acquisition restores a stable control without scrolling',async()=>{
 for(const phase of ['error','hidden']){
  const view=elements(),focus=focusEnvironment(view);
  bindDiscoveryLoadingActions(view,{personalise:()=>{},retry:()=>{}},focus);
  view.personalise.click();renderDiscoveryLoading(view,phase);
  // The browser cannot restore the now-hidden opener and falls back to body.
  focus.owner.activeElement=focus.owner.body;focus.settings.dispatch('close');await Promise.resolve();
  assert.equal(focus.owner.activeElement,focus.settingsFallback);
  assert.deepEqual(focus.settingsFallback.focusCalls,[{preventScroll:true}]);
  // A later dialog opened by another control is not part of this loader interaction.
  focus.owner.activeElement=focus.owner.body;focus.settings.dispatch('close');await Promise.resolve();
  assert.equal(focus.owner.activeElement,focus.owner.body);
  assert.equal(focus.settingsFallback.focusCalls.length,1);
 }
});

test('dialog close preserves a visible opener and explicit form-submit focus destinations',async()=>{
 const view=elements(),focus=focusEnvironment(view);
 bindDiscoveryLoadingActions(view,{personalise:()=>{},retry:()=>{}},focus);
 view.personalise.click();focus.owner.activeElement=view.personalise;focus.settings.dispatch('close');await Promise.resolve();
 assert.equal(focus.owner.activeElement,view.personalise);
 for(const destination of [focus.retryTarget,new ElementFixture('Topic heading')]){
  renderDiscoveryLoading(view,'initial');view.personalise.click();renderDiscoveryLoading(view,'error');
  // close is delivered after the form's synchronous, explicit focus placement.
  focus.settings.dispatch('close');focus.owner.activeElement=destination;await Promise.resolve();
  assert.equal(focus.owner.activeElement,destination);
 }
 assert.equal(focus.settingsFallback.focusCalls.length,0);
});

test('dialog close repairs focus stranded on an unavailable loader control only for loader-origin openings',async()=>{
 const view=elements(),focus=focusEnvironment(view);
 const unbind=bindDiscoveryLoadingActions(view,{personalise:()=>{},retry:()=>{}},focus);
 renderDiscoveryLoading(view,'error');focus.settings.dispatch('close');await Promise.resolve();
 assert.equal(focus.settingsFallback.focusCalls.length,0);
 for(const control of [view.personalise,view.retry]){
  renderDiscoveryLoading(view,'initial');view.personalise.click();renderDiscoveryLoading(view,'hidden');
  focus.owner.activeElement=control;focus.settings.dispatch('close');await Promise.resolve();
  assert.equal(focus.owner.activeElement,focus.settingsFallback);
 }
 renderDiscoveryLoading(view,'initial');view.personalise.click();renderDiscoveryLoading(view,'error');
 unbind();focus.owner.activeElement=focus.owner.body;focus.settings.dispatch('close');await Promise.resolve();
 assert.equal(focus.owner.activeElement,focus.owner.body);
 assert.equal(focus.settingsFallback.focusCalls.length,2);
});

test('successful loading while settings is open restores focus from its closed descendant to the visible header control',async()=>{
 for(const narrow of [false,true]){
  const view=elements(),focus=focusEnvironment(view),closeButton=new ElementFixture('Close');
  closeButton.ownerDocument=focus.owner;focus.settings.descendants.add(closeButton);
  focus.settingsFallback.layout=!narrow;focus.menuFallback.hidden=!narrow;
  bindDiscoveryLoadingActions(view,{personalise:()=>{focus.settings.open=true;},retry:()=>{}},focus);
  view.personalise.click();renderDiscoveryLoading(view,'hidden');
  focus.settings.open=false;focus.owner.activeElement=closeButton;focus.settings.dispatch('close');
  assert.equal(focus.owner.activeElement,closeButton);
  await Promise.resolve();
  const destination=narrow?focus.menuFallback:focus.settingsFallback;
  assert.equal(focus.owner.activeElement,destination);
  assert.deepEqual(destination.focusCalls,[{preventScroll:true}]);
  assert.equal((narrow?focus.settingsFallback:focus.menuFallback).focusCalls.length,0);
 }
});

test('queued dialog focus recovery does not interrupt a reopened dialog or survive binding cleanup',async()=>{
 for(const interruption of ['reopen','unbind']){
  const view=elements(),focus=focusEnvironment(view);
  const unbind=bindDiscoveryLoadingActions(view,{personalise:()=>{},retry:()=>{}},focus);
  view.personalise.click();renderDiscoveryLoading(view,'error');focus.settings.dispatch('close');
  if(interruption==='reopen')focus.settings.open=true;else unbind();
  await Promise.resolve();
  assert.equal(focus.settingsFallback.focusCalls.length,0);assert.equal(focus.menuFallback.focusCalls.length,0);
 }
});

test('retry moves focus to the stable page heading before the existing refresh hides its button',()=>{
 const view=elements(),focus=focusEnvironment(view);let refreshes=0;
 bindDiscoveryLoadingActions(view,{personalise:()=>{},retry:()=>{
  assert.equal(focus.owner.activeElement,focus.retryTarget);
  assert.deepEqual(focus.retryTarget.focusCalls,[{preventScroll:true}]);
  refreshes++;renderDiscoveryLoading(view,'initial');
 }},focus);
 renderDiscoveryLoading(view,'error');focus.owner.activeElement=view.retry;view.retry.click();
 assert.equal(refreshes,1);assert.equal(view.retry.hidden,true);
 assert.equal(focus.owner.activeElement,focus.retryTarget);
});
