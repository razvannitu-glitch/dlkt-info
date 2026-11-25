/**
 * A local exposure heuristic, never evidence of reading or comprehension.
 * The caller owns persistence. This module performs no storage or network work.
 */
export const KNOWLEDGE_EXPOSURE_MS=2000 as const;
export const KNOWLEDGE_EXPOSURE_FRACTION=0.5 as const;
export const KNOWLEDGE_EXPOSURE_LIMIT=5000 as const;
const ID=/^[a-z][a-z0-9-]{2,79}$/u;
type ExposureEvent='visibilitychange'|'focus'|'blur'|'resize'|'scroll'|'pagehide';
export interface KnowledgeExposureMeasurement {
 readonly width:number;readonly height:number;readonly possibleArea:number;readonly visibleArea:number;
}
export interface KnowledgeExposureIntersection {
 readonly target:Element;readonly time:number;readonly isIntersecting:boolean;
 readonly intersectionRect:Readonly<{width:number;height:number}>;
 readonly boundingClientRect:Readonly<{width:number;height:number}>;
}
export interface KnowledgeIntersectionObserver {
 observe(target:Element):void;unobserve(target:Element):void;disconnect():void;
 takeRecords():readonly KnowledgeExposureIntersection[];
}
export interface KnowledgeResizeObserver {observe(target:Element):void;disconnect():void}
export interface KnowledgeMutationObserver {observe(target:Element):void;disconnect():void}
export interface KnowledgeExposureEnvironment {
 readonly now:()=>number;
 readonly foreground:()=>boolean;
 readonly measure:(target:HTMLElement)=>KnowledgeExposureMeasurement|null;
 readonly setTimer:(callback:()=>void,delay:number)=>number;
 readonly clearTimer:(handle:number)=>void;
 readonly listen:(event:ExposureEvent,callback:()=>void)=>()=>void;
 readonly intersection:((callback:(entries:readonly KnowledgeExposureIntersection[])=>void)=>KnowledgeIntersectionObserver)|null;
 readonly resize:((callback:()=>void)=>KnowledgeResizeObserver)|null;
 readonly mutation:((callback:()=>void)=>KnowledgeMutationObserver)|null;
}
export interface KnowledgeExposureOptions {
 readonly isActive?:()=>boolean;
 readonly environment?:KnowledgeExposureEnvironment;
}
function browserEnvironment():KnowledgeExposureEnvironment|null {
 if(typeof window==='undefined'||typeof document==='undefined'||typeof IntersectionObserver!=='function'||
  typeof ResizeObserver!=='function'||typeof MutationObserver!=='function')return null;
 return {
  now:()=>performance.now(),
  foreground:()=>document.visibilityState==='visible'&&document.hasFocus(),
  measure:target=>{
   if(!target.isConnected||target.getClientRects().length===0)return null;
   for(let ancestor:HTMLElement|null=target;ancestor;ancestor=ancestor.parentElement){
    const style=getComputedStyle(ancestor);
    if(ancestor.hidden||ancestor.inert||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return null;
   }
   const rect=target.getBoundingClientRect(),viewport=window.visualViewport;
   const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0;
   const width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
   return {width:rect.width,height:rect.height,
    possibleArea:Math.min(rect.width,width)*Math.min(rect.height,height),
    visibleArea:Math.max(0,Math.min(rect.right,left+width)-Math.max(rect.left,left))*
     Math.max(0,Math.min(rect.bottom,top+height)-Math.max(rect.top,top))};
  },
  setTimer:(callback,delay)=>window.setTimeout(callback,delay),
  clearTimer:handle=>window.clearTimeout(handle),
  listen:(event,callback)=>{
   const target=event==='visibilitychange'?document:window;
   target.addEventListener(event,callback,{capture:true,passive:true});
   // Zooming or mobile browser chrome can change the visual viewport independently.
   const visual=event==='resize'||event==='scroll'?window.visualViewport:null;
   visual?.addEventListener(event,callback,{passive:true});
   return ()=>{target.removeEventListener(event,callback,true);visual?.removeEventListener(event,callback);};
  },
  intersection:callback=>new IntersectionObserver(entries=>callback(entries),{threshold:Array.from({length:101},(_,index)=>index/100)}),
  resize:callback=>new ResizeObserver(()=>callback()),
  mutation:callback=>{
   const observer=new MutationObserver(()=>callback());
   return {
    observe:target=>{
     observer.observe(target,{childList:true,subtree:true,attributes:true,attributeFilter:['style','class','hidden','inert','open']});
     // A modal outside the feed can suspend exposure without changing its geometry.
     observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','inert','data-entry-view','data-world-explore']});
    },
    disconnect:()=>observer.disconnect(),
   };
  },
 };
}
interface Observation {
 readonly id:string;readonly node:HTMLElement;
 since:number|null;entry:KnowledgeExposureIntersection|null;lastTime:number;
}
function finitePositive(value:number):boolean{return Number.isFinite(value)&&value>0;}
function qualifies(entry:KnowledgeExposureIntersection|null,measurement:KnowledgeExposureMeasurement|null):boolean {
 if(!entry?.isIntersecting||measurement===null)return false;
 const {width,height,possibleArea,visibleArea}=measurement;
 if(![width,height,possibleArea].every(finitePositive)||!Number.isFinite(visibleArea)||visibleArea<0||
  !finitePositive(entry.intersectionRect.width)||!finitePositive(entry.intersectionRect.height)||
  !finitePositive(entry.boundingClientRect.width)||!finitePositive(entry.boundingClientRect.height))return false;
 if(entry.boundingClientRect.width!==width||entry.boundingClientRect.height!==height)return false;
 const threshold=possibleArea*KNOWLEDGE_EXPOSURE_FRACTION;
 return visibleArea>=threshold&&entry.intersectionRect.width*entry.intersectionRect.height>=threshold;
}

/** Bind to the reconciled feed. Rebinding requires calling the previous stop function. */
export function observeKnowledgeExposure(
 container:HTMLElement,onQualifiedExposure:(id:string)=>void,options:KnowledgeExposureOptions={},
):()=>void {
 const environment=options.environment??browserEnvironment();
 if(!environment?.intersection||!environment.resize||!environment.mutation)return ()=>{};
 const env=environment,createIntersection=environment.intersection,createResize=environment.resize,createMutation=environment.mutation;
 const completed=new Set<string>(),observations=new Map<Element,Observation>(),cleanups:Array<()=>void>=[];
 let stopped=false,generation=0,startedAt=env.now(),timer:number|null=null;
 let intersection:KnowledgeIntersectionObserver|null=null,resize:KnowledgeResizeObserver|null=null,mutation:KnowledgeMutationObserver|null=null;
 const active=():boolean=>{
  try{return !stopped&&env.foreground()&&(options.isActive?.()??true);}catch{return false;}
 };
 const cancelTimer=():void=>{if(timer!==null){env.clearTimer(timer);timer=null;}};
 const resetDwell=():void=>{cancelTimer();for(const state of observations.values())state.since=null;};
 const measure=(state:Observation):KnowledgeExposureMeasurement|null=>{
  if(!container.contains(state.node)||!state.node.isConnected)return null;
  try{return env.measure(state.node);}catch{return null;}
 };
 const schedule=():void=>{
  cancelTimer();if(!active())return;
  let earliest=Infinity;for(const state of observations.values())if(state.since!==null)earliest=Math.min(earliest,state.since+KNOWLEDGE_EXPOSURE_MS);
  if(Number.isFinite(earliest))timer=env.setTimer(confirm,Math.max(1,earliest-env.now()));
 };
 const checkGeometry=():void=>{
  if(!active()){resetDwell();return;}
  const now=env.now();
  for(const state of observations.values()){
   if(qualifies(state.entry,measure(state))){if(state.since===null)state.since=now;}
   else state.since=null;
  }
  schedule();
 };
 const receive=(entries:readonly KnowledgeExposureIntersection[],token:number):void=>{
  if(stopped||token!==generation)return;
  if(!active()){resetDwell();return;}
  const now=env.now();
  for(const entry of [...entries].sort((a,b)=>a.time-b.time)){
   const state=observations.get(entry.target);
   if(!state||!Number.isFinite(entry.time)||entry.time<startedAt||entry.time<state.lastTime||entry.time>now)continue;
   state.lastTime=entry.time;state.entry=entry;
   if(qualifies(entry,measure(state))){if(state.since===null)state.since=now;}
   else state.since=null;
  }
  schedule();
 };
 function confirm():void {
  timer=null;if(!active()){resetDwell();return;}
  // Entries queued before this task must invalidate dwell before it can qualify.
  if(intersection)receive(intersection.takeRecords(),generation);
  cancelTimer();if(!active()){resetDwell();return;}
  const now=env.now();
  for(const state of [...observations.values()]){
   if(stopped)break;
   if(!active()||!qualifies(state.entry,measure(state))){state.since=null;continue;}
   if(state.since===null||now-state.since<KNOWLEDGE_EXPOSURE_MS)continue;
   if(completed.size>=KNOWLEDGE_EXPOSURE_LIMIT){stop();break;}
   completed.add(state.id);observations.delete(state.node);intersection?.unobserve(state.node);
   try{onQualifiedExposure(state.id);}catch{/* A callback failure must not affect the public feed or create repeated exposure. */}
  }
  schedule();
 }
 const restart=():void=>{
  if(stopped)return;
  resetDwell();intersection?.disconnect();intersection=null;
  generation++;startedAt=env.now();
  for(const state of observations.values()){state.entry=null;state.lastTime=startedAt;}
  if(!active())return;
  const token=generation;
  try{intersection=createIntersection(entries=>receive(entries,token));for(const state of observations.values())intersection.observe(state.node);}
  catch{intersection?.disconnect();intersection=null;resetDwell();}
 };
 const bind=():void=>{
  if(stopped)return;
  resetDwell();resize?.disconnect();observations.clear();
  const nodes=[...container.querySelectorAll<HTMLElement>('article[data-news-stream-key^="knowledge:"]')];
  if(nodes.length>KNOWLEDGE_EXPOSURE_LIMIT){intersection?.disconnect();intersection=null;generation++;return;}
  const counts=new Map<string,number>();
  for(const node of nodes){const id=(node.dataset.newsStreamKey??'').slice('knowledge:'.length);if(ID.test(id))counts.set(id,(counts.get(id)??0)+1);}
  for(const node of nodes){
   const id=(node.dataset.newsStreamKey??'').slice('knowledge:'.length);
   if(!ID.test(id)||counts.get(id)!==1||completed.has(id))continue;
   observations.set(node,{id,node,since:null,entry:null,lastTime:env.now()});
  }
  try{resize?.observe(container);for(const state of observations.values())resize?.observe(state.node);}
  catch{observations.clear();}
  restart();
 };
 const stop=():void=>{
  if(stopped)return;stopped=true;generation++;resetDwell();
  intersection?.disconnect();resize?.disconnect();mutation?.disconnect();observations.clear();
  for(const cleanup of cleanups.splice(0))cleanup();
 };
 try{
  resize=createResize(restart);mutation=createMutation(bind);
  for(const event of ['visibilitychange','focus','blur','resize'] as const)cleanups.push(env.listen(event,restart));
  cleanups.push(env.listen('scroll',checkGeometry),env.listen('pagehide',stop));
  mutation.observe(container);bind();
 }catch{stop();}
 return stop;
}
