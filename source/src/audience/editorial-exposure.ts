import {EDITORIAL_PILOT_CATEGORIES,isEditorialPilotCategory,type EditorialPilotCategory} from './editorial-pilot.js';

/** Offline exposure heuristic. No storage, network, identifiers in output or production authority. */
export const EDITORIAL_EXPOSURE_MS=1000;
export const EDITORIAL_EXPOSURE_FRACTION=0.5;
export const EDITORIAL_SAMPLE_MS=100;
export const EDITORIAL_MAX_SAMPLE_GAP_MS=250;
export const EDITORIAL_DOCUMENT_LIMIT=500;
const ARTICLE=/^[a-f0-9]{24}$/u;
const KEY=/^(?:article:[a-f0-9]{24}|story:[a-f0-9]{64})$/u;
type Status='observing-lab'|'held'|'stopped';
interface Candidate {
 readonly key:string;readonly category:EditorialPilotCategory;readonly qualified:boolean;
}
interface Dwell {readonly category:EditorialPilotCategory;readonly since:number}
export interface EditorialExposureSnapshot {
 readonly status:Status;
 readonly rows:readonly {readonly category:EditorialPilotCategory;readonly qualifiedImpressions:number}[];
 readonly productionActivationAllowed:false;
 readonly automationAllowed:false;
}

/** One synthetic document. Repeated renders/returns to the same logical card never increment twice.
 * Local deduplication keys are ephemeral and never returned, persisted or transmitted.
 * A sampled frame cannot prove actual attention or reading. */
export class QualifiedExposureLab {
 #status:Status='observing-lab';
 #last:number|null=null;
 #pending=new Map<string,Dwell>();
 #completed=new Map<string,EditorialPilotCategory>();
 invalidate():void{this.#pending.clear();}
 hold():void{this.#status='held';this.#pending.clear();this.#completed.clear();}
 stop():void{this.#status='stopped';this.#pending.clear();this.#completed.clear();}
 frame(time:number,candidates:readonly Candidate[]):void{
  if(this.#status!=='observing-lab')return;
  if(!Number.isFinite(time)||time<0||(this.#last!==null&&time<this.#last)||!Array.isArray(candidates)||candidates.length>EDITORIAL_DOCUMENT_LIMIT){this.hold();return;}
  if(this.#last!==null&&time-this.#last>EDITORIAL_MAX_SAMPLE_GAP_MS)this.invalidate();
  this.#last=time;
  const seen=new Set<string>(),next=new Map<string,Dwell>();
  for(const candidate of candidates){
   if(!candidate||typeof candidate.key!=='string'||!KEY.test(candidate.key)||!isEditorialPilotCategory(candidate.category)||typeof candidate.qualified!=='boolean'||seen.has(candidate.key)){this.hold();return;}
   seen.add(candidate.key);
   const completed=this.#completed.get(candidate.key);
   if(completed!==undefined){
    if(completed!==candidate.category){this.hold();return;}
    continue;
   }
   if(!candidate.qualified)continue;
   const prior=this.#pending.get(candidate.key);
   const since=prior?.category===candidate.category?prior.since:time;
   if(time-since>=EDITORIAL_EXPOSURE_MS){
    if(this.#completed.size>=EDITORIAL_DOCUMENT_LIMIT){this.hold();return;}
    this.#completed.set(candidate.key,candidate.category);
   }else next.set(candidate.key,{category:candidate.category,since});
  }
  this.#pending=next;
 }
 snapshot():EditorialExposureSnapshot{
  const counts=new Map<EditorialPilotCategory,number>();
  for(const category of this.#completed.values())counts.set(category,(counts.get(category)??0)+1);
  return {status:this.#status,rows:this.#status==='observing-lab'?EDITORIAL_PILOT_CATEGORIES.map(category=>({category,qualifiedImpressions:counts.get(category)??0})):[],
   productionActivationAllowed:false,automationAllowed:false};
 }
}

interface Card {readonly node:HTMLElement;readonly key:string;readonly category:EditorialPilotCategory}
export interface EditorialExposureObserverLab {
 snapshot():EditorialExposureSnapshot;stop():void;
}
const SELECTOR='article.info-card.editorial-card[data-edition-part="stream"][data-card-id][data-news-stream-key][data-news-category]';
function card(node:HTMLElement):Card|null{
 const id=node.dataset.cardId,category=node.dataset.newsCategory,story=node.dataset.storyKey;
 if(!id||!ARTICLE.test(id)||node.dataset.newsStreamKey!=='article:'+id||!isEditorialPilotCategory(category)||node.hasAttribute('data-knowledge-id')||node.hasAttribute('data-home-local-id'))return null;
 if(story!==undefined&&!/^story:[a-f0-9]{64}$/u.test(story))return null;
 return {node,key:story??'article:'+id,category};
}
function qualifies(node:HTMLElement,entry:IntersectionObserverEntry|undefined):boolean{
 if(!entry?.isIntersecting||entry.intersectionRatio<EDITORIAL_EXPOSURE_FRACTION||!node.isConnected||node.getClientRects().length===0)return false;
 for(let ancestor:HTMLElement|null=node;ancestor;ancestor=ancestor.parentElement){
  const style=getComputedStyle(ancestor);
  if(ancestor.hidden||ancestor.inert||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return false;
 }
 const rect=node.getBoundingClientRect(),area=rect.width*rect.height,viewport=window.visualViewport;
 if(!Number.isFinite(area)||area<=0||Math.abs(entry.boundingClientRect.width-rect.width)>0.1||Math.abs(entry.boundingClientRect.height-rect.height)>0.1)return false;
 const left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??window.innerWidth,height=viewport?.height??window.innerHeight;
 const visible=Math.max(0,Math.min(rect.right,left+width)-Math.max(rect.left,left))*Math.max(0,Math.min(rect.bottom,top+height)-Math.max(rect.top,top));
 const threshold=area*EDITORIAL_EXPOSURE_FRACTION;
 return visible>=threshold&&entry.intersectionRect.width*entry.intersectionRect.height>=threshold;
}

/** Only an isolated synthetic consent coordinator may mount this laboratory observer.
 * Never included in the shipped reader. The caller must stop on withdrawal; permission is
 * additionally checked on every sample/snapshot. No actual on-site open action exists yet. */
export function observeEditorialExposureLab(container:HTMLElement,permitted:()=>boolean):EditorialExposureObserverLab{
 const counter=new QualifiedExposureLab();
 let stopped=false,timer:number|null=null,observer:IntersectionObserver|null=null,resize:ResizeObserver|null=null,mutation:MutationObserver|null=null;
 let cards:Card[]=[];
 const entries=new Map<Element,IntersectionObserverEntry>(),cleanups:Array<()=>void>=[];
 const allowed=():boolean=>{try{return permitted()===true;}catch{return false;}};
 const foreground=():boolean=>container.isConnected&&document.visibilityState==='visible'&&document.hasFocus()&&document.body.dataset.entryView==='start'&&!document.body.dataset.worldExplore&&!document.querySelector('dialog[open]');
 const cleanup=():void=>{
  if(stopped)return;
  stopped=true;
  if(timer!==null)window.clearInterval(timer);
  observer?.disconnect();resize?.disconnect();mutation?.disconnect();cards=[];entries.clear();
  for(const release of cleanups.splice(0))release();
 };
 const stop=():void=>{counter.stop();cleanup();};
 const hold=():void=>{counter.hold();cleanup();};
 const snapshot=():EditorialExposureSnapshot=>{if(!stopped&&!allowed())stop();return counter.snapshot();};
 if(typeof window==='undefined'||typeof document==='undefined'||container.id!=='discovery-cards'||!allowed()
 ||typeof IntersectionObserver!=='function'||typeof ResizeObserver!=='function'||typeof MutationObserver!=='function'){
  stop();return {snapshot,stop};
 }
 const receive=(values:readonly IntersectionObserverEntry[]):void=>{
  for(const entry of values){
   const previous=entries.get(entry.target);
   if(previous&&entry.time<previous.time)continue;
   entries.set(entry.target,entry);
   if(!entry.isIntersecting||entry.intersectionRatio<EDITORIAL_EXPOSURE_FRACTION)counter.invalidate();
  }
 };
 const sync=():void=>{
  if(stopped)return;
  if(!allowed()){stop();return;}
  counter.invalidate();observer?.disconnect();observer=null;resize?.disconnect();entries.clear();cards=[];
  try{
   for(const node of container.querySelectorAll<HTMLElement>(SELECTOR)){
    const candidate=card(node);if(candidate)cards.push(candidate);
    if(cards.length>EDITORIAL_DOCUMENT_LIMIT){hold();return;}
   }
   const io=new IntersectionObserver(values=>{if(!stopped&&observer===io)receive(values);},{threshold:[0,EDITORIAL_EXPOSURE_FRACTION,1]});
   observer=io;resize?.observe(container);
   for(const item of cards){io.observe(item.node);resize?.observe(item.node);}
  }catch{hold();}
 };
 const sample=():void=>{
  if(stopped)return;
  if(!allowed()){stop();return;}
  if(!container.isConnected){stop();return;}
  if(!foreground()){counter.invalidate();return;}
  try{
   if(observer)receive(observer.takeRecords());
   const candidates:Candidate[]=[];
   for(const item of cards){
    const current=card(item.node);
    if(!container.contains(item.node)||!current||current.key!==item.key||current.category!==item.category){sync();return;}
    candidates.push({key:item.key,category:item.category,qualified:qualifies(item.node,entries.get(item.node))});
   }
   counter.frame(performance.now(),candidates);
   if(counter.snapshot().status==='held')cleanup();
  }catch{hold();}
 };
 const listen=(target:EventTarget,event:string,fn:()=>void):void=>{
  target.addEventListener(event,fn,{capture:true,passive:true});
  cleanups.push(()=>target.removeEventListener(event,fn,true));
 };
 try{
  resize=new ResizeObserver(()=>counter.invalidate());
  mutation=new MutationObserver(sync);
  mutation.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','inert','open','data-entry-view','data-world-explore','data-edition-part','data-card-id','data-news-stream-key','data-news-category','data-story-key','data-knowledge-id','data-home-local-id']});
  for(const event of ['focus','blur','resize','scroll'])listen(window,event,()=>counter.invalidate());
  listen(document,'visibilitychange',()=>counter.invalidate());
  listen(window,'pagehide',stop);
  if(window.visualViewport){listen(window.visualViewport,'scroll',()=>counter.invalidate());listen(window.visualViewport,'resize',()=>counter.invalidate());}
  sync();if(!stopped)timer=window.setInterval(sample,EDITORIAL_SAMPLE_MS);
 }catch{hold();}
 return {snapshot,stop};
}
