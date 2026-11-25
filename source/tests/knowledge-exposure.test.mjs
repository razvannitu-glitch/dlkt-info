import assert from 'node:assert/strict';
import test from 'node:test';
import {observeKnowledgeExposure,KNOWLEDGE_EXPOSURE_MS,KNOWLEDGE_EXPOSURE_FRACTION,KNOWLEDGE_EXPOSURE_LIMIT} from '../.build/src/iceo/knowledge-exposure.js';

function fixture(ids=['venus-rotation']) {
 let now=0,nextTimer=1,focused=true,visible=true,active=true;
 const timers=new Map(),listeners=new Map(),intersections=[],resizes=[],mutations=[],exposed=[];
 const makeNode=id=>({dataset:{newsStreamKey:'knowledge:'+id},isConnected:true,width:300,height:300,visibleArea:90000,cssVisible:true});
 const nodes=ids.map(makeNode);
 const container={querySelectorAll:()=>nodes,contains:node=>nodes.includes(node)&&node.isConnected};
 const environment={
  now:()=>now,foreground:()=>focused&&visible,
  measure:node=>node.cssVisible?{width:node.width,height:node.height,possibleArea:Math.min(node.width,1000)*Math.min(node.height,800),visibleArea:node.visibleArea}:null,
  setTimer:(callback,delay)=>{const id=nextTimer++;timers.set(id,{at:now+delay,callback});return id;},
  clearTimer:id=>timers.delete(id),
  listen:(event,callback)=>{const set=listeners.get(event)??new Set();set.add(callback);listeners.set(event,set);return ()=>set.delete(callback);},
  intersection:callback=>{
   const observer={callback,targets:new Set(),records:[],disconnected:false,
    observe(target){this.targets.add(target);},unobserve(target){this.targets.delete(target);},
    disconnect(){this.targets.clear();this.disconnected=true;},
    takeRecords(){const result=this.records.splice(0);return result;},
   };intersections.push(observer);return observer;
  },
  resize:callback=>{
   const observer={callback,targets:new Set(),disconnected:false,
    observe(target){this.targets.add(target);},disconnect(){this.targets.clear();this.disconnected=true;},
   };resizes.push(observer);return observer;
  },
  mutation:callback=>{
   const observer={callback,disconnected:false,observe(){},disconnect(){this.disconnected=true;}};
   mutations.push(observer);return observer;
  },
 };
 const entry=(node=nodes[0],area=node.visibleArea,time=now)=>({
  target:node,time,isIntersecting:area>0,
  boundingClientRect:{width:node.width,height:node.height},
  intersectionRect:{width:node.width,height:area/node.width},
 });
 const fire=event=>{for(const callback of [...(listeners.get(event)??[])])callback();};
 const advance=milliseconds=>{
  const end=now+milliseconds;let count=0;
  while(true){
   const candidates=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0]);
   if(!candidates.length)break;
   assert.ok(++count<1000,'bounded timer processing');const [id,timer]=candidates[0];timers.delete(id);now=timer.at;timer.callback();
  }
  now=end;
 };
 const bind=(callback=id=>exposed.push(id))=>observeKnowledgeExposure(container,callback,{environment,isActive:()=>active});
 return {environment,container,nodes,makeNode,exposed,timers,listeners,intersections,resizes,mutations,entry,fire,advance,bind,
  emit:(records)=>intersections.at(-1)?.callback(records??[entry()]),
  mutate:()=>mutations.at(-1)?.callback(),
  resize:()=>resizes.at(-1)?.callback(),
  setFocused:value=>{focused=value;},setVisible:value=>{visible=value;},setActive:value=>{active=value;},
 };
}

test('insertion alone and an offscreen IO record never qualify exposure',()=>{
 const f=fixture();f.nodes[0].visibleArea=0;const stop=f.bind();
 f.advance(10000);assert.deepEqual(f.exposed,[]);assert.equal(f.timers.size,0);
 f.emit();f.advance(10000);assert.deepEqual(f.exposed,[]);assert.equal(f.timers.size,0);stop();
});
test('half of the possible visible area requires exactly two continuous foreground seconds',()=>{
 assert.equal(KNOWLEDGE_EXPOSURE_MS,2000);assert.equal(KNOWLEDGE_EXPOSURE_FRACTION,0.5);
 const f=fixture();const stop=f.bind();f.nodes[0].visibleArea=44999;f.emit();f.advance(3000);
 assert.deepEqual(f.exposed,[]);f.nodes[0].visibleArea=45000;f.emit();f.advance(1999);assert.deepEqual(f.exposed,[]);
 f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);assert.equal(f.timers.size,0);stop();
});
test('a tall card uses viewport-bounded possible area, while a narrow visible sliver is rejected',()=>{
 const f=fixture();f.nodes[0].height=2000;f.nodes[0].visibleArea=119999;const stop=f.bind();f.emit();f.advance(2000);
 assert.deepEqual(f.exposed,[]);f.nodes[0].visibleArea=120000;f.emit();f.advance(2000);
 assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('brief passes do not accumulate across a below-threshold interruption',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1500);
 f.nodes[0].visibleArea=100;f.emit();f.advance(100);f.nodes[0].visibleArea=90000;f.emit();f.advance(1999);
 assert.deepEqual(f.exposed,[]);f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('scroll rechecks the actual geometry even before the next IO delivery',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1500);f.nodes[0].visibleArea=0;f.fire('scroll');
 f.advance(100);f.nodes[0].visibleArea=90000;f.fire('scroll');f.advance(1999);assert.deepEqual(f.exposed,[]);
 f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
for(const event of ['blur','visibilitychange']){
 test(event+' resets dwell and foreground return starts with a fresh observation',()=>{
  const f=fixture();const stop=f.bind();f.emit();f.advance(1000);
  if(event==='blur')f.setFocused(false);else f.setVisible(false);
  f.fire(event);f.advance(3000);assert.deepEqual(f.exposed,[]);assert.equal(f.timers.size,0);
  if(event==='blur')f.setFocused(true);else f.setVisible(true);
  f.fire(event==='blur'?'focus':'visibilitychange');f.emit();f.advance(1999);assert.deepEqual(f.exposed,[]);
  f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
 });
}
test('a brief inactive home feed or open dialog resets dwell through lifecycle mutation',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1200);f.setActive(false);f.mutate();
 f.advance(100);f.setActive(true);f.mutate();f.emit();f.advance(1999);assert.deepEqual(f.exposed,[]);
 f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
for(const reset of ['resize','window-resize','mutation']){
 test(reset+' discards accumulated time and rejects callbacks from the previous observer',()=>{
  const f=fixture();const stop=f.bind();f.emit();const old=f.intersections.at(-1);f.advance(1500);
  if(reset==='resize')f.resize();else if(reset==='window-resize')f.fire('resize');else f.mutate();
  old.callback([f.entry()]);f.advance(1000);assert.deepEqual(f.exposed,[]);
  f.emit();f.advance(1999);assert.deepEqual(f.exposed,[]);f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
 });
}
test('a changed card size invalidates the pending exposure before ResizeObserver delivers',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1900);f.nodes[0].width+=0.25;f.advance(100);
 assert.deepEqual(f.exposed,[]);f.resize();f.emit();f.advance(2000);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('removal and reinsertion require a new dwell and a detached node never qualifies',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1000);const original=f.nodes.shift();original.isConnected=false;f.mutate();
 f.advance(5000);assert.deepEqual(f.exposed,[]);const replacement=f.makeNode('venus-rotation');f.nodes.push(replacement);f.mutate();
 f.emit([f.entry(replacement)]);f.advance(1999);assert.deepEqual(f.exposed,[]);f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('current CSS visibility is checked at expiry, not inferred from old intersection geometry',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1900);f.nodes[0].cssVisible=false;f.advance(100);
 assert.deepEqual(f.exposed,[]);f.nodes[0].cssVisible=true;f.mutate();f.emit();f.advance(2000);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('IO records queued before the timer and out-of-order entry times cannot preserve an interrupted dwell',()=>{
 const f=fixture();const stop=f.bind();f.emit();f.advance(1000);
 f.intersections.at(-1).records.push(f.entry(f.nodes[0],0,1000));f.advance(1000);assert.deepEqual(f.exposed,[]);
 f.emit([f.entry(f.nodes[0],90000,2000),f.entry(f.nodes[0],0,1500)]);f.advance(1999);assert.deepEqual(f.exposed,[]);
 f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('prebinding, future and superseded IO records are ignored',()=>{
 const f=fixture();f.advance(1000);const stop=f.bind();
 f.emit([f.entry(f.nodes[0],90000,999),f.entry(f.nodes[0],90000,1001)]);f.advance(2500);assert.deepEqual(f.exposed,[]);
 f.emit();f.advance(500);f.emit([f.entry(f.nodes[0],0,1000)]);f.advance(1500);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('each ID qualifies once and many simultaneously visible cards share one timer',()=>{
 const f=fixture(['venus-rotation','web-public-domain']);const stop=f.bind();f.emit(f.nodes.map(node=>f.entry(node)));
 assert.equal(f.timers.size,1);f.advance(2000);assert.deepEqual(f.exposed,['venus-rotation','web-public-domain']);
 f.emit(f.nodes.map(node=>f.entry(node)));f.mutate();f.advance(5000);assert.equal(f.exposed.length,2);assert.equal(f.timers.size,0);stop();
});
test('stop, rebind and pagehide prevent stale callbacks and release all observers and listeners',()=>{
 const f=fixture();const stop=f.bind();f.emit();const old=f.intersections.at(-1);f.advance(1000);stop();stop();
 assert.equal(f.timers.size,0);assert.equal([...f.listeners.values()].reduce((n,set)=>n+set.size,0),0);
 assert.equal(old.disconnected,true);assert.equal(f.resizes[0].disconnected,true);assert.equal(f.mutations[0].disconnected,true);
 old.callback([f.entry()]);f.advance(5000);assert.deepEqual(f.exposed,[]);
 const stopAgain=f.bind();f.emit();f.advance(1000);f.fire('pagehide');f.advance(5000);assert.deepEqual(f.exposed,[]);stopAgain();
});
test('a new binding cannot inherit the time accumulated by a stopped binding',()=>{
 const f=fixture();const oldStop=f.bind();f.emit();f.advance(1500);oldStop();
 const stop=f.bind();f.emit();f.advance(1999);assert.deepEqual(f.exposed,[]);f.advance(1);assert.deepEqual(f.exposed,['venus-rotation']);stop();
});
test('missing observers and observer failures fail conservatively without writing history',()=>{
 for(const missing of ['intersection','resize','mutation']){
  const f=fixture();f.environment[missing]=null;const stop=f.bind();f.advance(5000);
  assert.deepEqual(f.exposed,[]);assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);stop();
 }
 const f=fixture();f.environment.intersection=()=>{throw Error('UNAVAILABLE');};const stop=f.bind();
 f.advance(5000);assert.deepEqual(f.exposed,[]);assert.equal(f.timers.size,0);stop();
});
test('invalid, duplicate and excessive card identities do not produce ambiguous exposures',()=>{
 const f=fixture(['venus-rotation','venus-rotation','bad<script>']);const stop=f.bind();f.emit(f.nodes.map(node=>f.entry(node)));
 f.advance(5000);assert.deepEqual(f.exposed,[]);stop();
 const many=fixture(Array.from({length:KNOWLEDGE_EXPOSURE_LIMIT+1},(_,index)=>'fact-'+index));const stopMany=many.bind();
 many.advance(5000);assert.deepEqual(many.exposed,[]);assert.equal(many.timers.size,0);stopMany();
});
test('callback errors do not repeat exposure and a callback can synchronously stop the observer',()=>{
 const f=fixture();let calls=0;const stop=f.bind(()=>{calls++;throw Error('STORAGE_UNAVAILABLE');});f.emit();f.advance(2000);
 f.mutate();f.emit();f.advance(5000);assert.equal(calls,1);stop();
 const g=fixture(['venus-rotation','web-public-domain']);let stopSelf=()=>{};stopSelf=g.bind(id=>{g.exposed.push(id);stopSelf();});
 g.emit(g.nodes.map(node=>g.entry(node)));g.advance(2000);assert.equal(g.exposed.length,1);assert.equal(g.timers.size,0);
});
