import type {NewsCategoryId} from '../iceo/news-taxonomy.js';

/**
 * Production-candidate reader metric, not an activated collector. The caller must
 * supply independent, confirmed editorial consent. No automatic mount, persistence,
 * network transport, account or audience dependency. Never count source intent as reading.
 */
export const SOURCE_INTENT_VERSION='dlkt-qualified-source-intent-1' as const;
export const SOURCE_INTENT_PURPOSE='editorial-source-intent' as const;
// Proposed notice and category scope require independent approval before real use.
export const SOURCE_INTENT_NOTICE='dlkt-editorial-intent-pilot-1' as const;
export const SOURCE_INTENT_CATEGORIES=Object.freeze(['05000000','06000000','13000000','15000000','17000000'] as const satisfies readonly NewsCategoryId[]);
type Category=typeof SOURCE_INTENT_CATEGORIES[number];
const categories:ReadonlySet<string>=new Set(SOURCE_INTENT_CATEGORIES);
const ARTICLE=/^[a-f0-9]{24}$/u,STORY=/^story:[a-f0-9]{64}$/u;
export const INTENT_DWELL_MS=1000,INTENT_DOCUMENT_LIMIT=500;
const MAX_SAMPLE_GAP_MS=250,GRANT_MS=15*60*1000;
type Phase='collecting'|'held'|'stopped';
interface Identity {readonly article:string;readonly key:string;readonly category:Category}
interface FrameCard extends Identity {readonly visible:boolean}
interface Entry extends Identity {since:number|null;exposed:boolean;intent:boolean;present:boolean}
export interface SourceIntentSnapshot {
 readonly version:typeof SOURCE_INTENT_VERSION;
 readonly status:Phase;
 readonly coverage:'observed-document-only';
 readonly rows:readonly {readonly category:Category;readonly qualifiedImpressions:number;readonly sourceIntents:number}[];
}
interface Permit {
 readonly state:'confirmed';readonly purpose:typeof SOURCE_INTENT_PURPOSE;readonly noticeVersion:typeof SOURCE_INTENT_NOTICE;
 readonly pilotEligible:true;readonly revision:number;readonly issuedAt:number;readonly expiresAt:number;
}
function object(v:unknown):Record<string,unknown>|null{return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}
function category(v:unknown):v is Category{return typeof v==='string'&&categories.has(v);}
function validIdentity(v:Identity):boolean{return typeof v.article==='string'&&ARTICLE.test(v.article)&&category(v.category)
 &&typeof v.key==='string'&&(v.key==='article:'+v.article||STORY.test(v.key));}
function same(a:Identity,b:Identity):boolean{return a.article===b.article&&a.key===b.key&&a.category===b.category;}
function int(v:unknown):v is number{return typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;}
export function readSourceIntentPermit(raw:unknown,now:number):Permit|null{
 const v=object(raw);
 if(!v||Object.keys(v).sort().join(',')!=='expiresAt,issuedAt,noticeVersion,pilotEligible,purpose,revision,state'
 ||v.state!=='confirmed'||v.purpose!==SOURCE_INTENT_PURPOSE||v.noticeVersion!==SOURCE_INTENT_NOTICE||v.pilotEligible!==true
 ||!int(v.revision)||v.revision===0||!int(now)||!int(v.issuedAt)||!int(v.expiresAt)||v.issuedAt>now||v.expiresAt<=now
 ||v.expiresAt-v.issuedAt>GRANT_MS)return null;
 return {state:'confirmed',purpose:SOURCE_INTENT_PURPOSE,noticeVersion:SOURCE_INTENT_NOTICE,pilotEligible:true,revision:v.revision,issuedAt:v.issuedAt,expiresAt:v.expiresAt};
}
/** In-memory cohort only, with bounded logical-key/article binding. A change in
 * grouping, primary identity or category holds the whole document rather than
 * guessing a new denominator. No per-card identity leaves this class. */
export class QualifiedSourceIntent {
 #phase:Phase='collecting';
 #last:number|null=null;
 #entries=new Map<string,Entry>();
 #articles=new Map<string,string>();
 invalidate():void{for(const entry of this.#entries.values()){entry.since=null;entry.present=false;}}
 hold():void{this.#phase='held';this.#entries.clear();this.#articles.clear();}
 stop():void{this.#phase='stopped';this.#entries.clear();this.#articles.clear();}
 frame(time:number,cards:readonly FrameCard[]):void{
  if(this.#phase!=='collecting')return;
  if(!Number.isFinite(time)||time<0||(this.#last!==null&&time<this.#last)||!Array.isArray(cards)||cards.length>INTENT_DOCUMENT_LIMIT){this.hold();return;}
  if(this.#last!==null&&time-this.#last>MAX_SAMPLE_GAP_MS)this.invalidate();
  this.#last=time;
  const seen=new Set<string>();
  for(const card of cards){
   if(!card||!validIdentity(card)||typeof card.visible!=='boolean'||seen.has(card.key)){this.hold();return;}
   seen.add(card.key);
   const previousKey=this.#articles.get(card.article);
   if(previousKey!==undefined&&previousKey!==card.key){this.hold();return;}
   let entry=this.#entries.get(card.key);
   if(entry!==undefined&&!same(entry,card)){this.hold();return;}
   if(entry===undefined){
    if(this.#entries.size>=INTENT_DOCUMENT_LIMIT){this.hold();return;}
    entry={article:card.article,key:card.key,category:card.category,since:null,exposed:false,intent:false,present:true};
    this.#entries.set(card.key,entry);this.#articles.set(card.article,card.key);
   }
   entry.present=true;
   if(!card.visible){entry.since=null;continue;}
   if(entry.exposed)continue;
   if(entry.since===null)entry.since=time;
   if(time-entry.since>=INTENT_DWELL_MS){entry.exposed=true;entry.since=null;}
  }
  for(const [key,entry] of this.#entries)if(!seen.has(key)){entry.since=null;entry.present=false;}
 }
 /** The browser adapter, not this reducer, checks event trust and the primary link. */
 activate(identity:Identity):boolean{
  if(this.#phase!=='collecting'||!validIdentity(identity))return false;
  const entry=this.#entries.get(identity.key);
  if(!entry||!same(entry,identity)||!entry.present||!entry.exposed||entry.intent)return false;
  entry.intent=true;return true;
 }
 snapshot():SourceIntentSnapshot{
  const counts=new Map<Category,{qualifiedImpressions:number;sourceIntents:number}>();
  for(const entry of this.#entries.values())if(entry.exposed){
   const row=counts.get(entry.category)??{qualifiedImpressions:0,sourceIntents:0};
   row.qualifiedImpressions++;if(entry.intent)row.sourceIntents++;counts.set(entry.category,row);
  }
  return {version:SOURCE_INTENT_VERSION,status:this.#phase,coverage:'observed-document-only',
   rows:this.#phase==='collecting'?SOURCE_INTENT_CATEGORIES.map(category=>({category,...(counts.get(category)??{qualifiedImpressions:0,sourceIntents:0})})):[]};
 }
}
const CARD='article.info-card.editorial-card[data-edition-part="stream"][data-card-id][data-news-stream-key][data-news-category]';
interface Bound extends Identity {readonly node:HTMLElement}
interface Links {readonly title:HTMLAnchorElement;readonly action:HTMLAnchorElement}
function primaryLinks(node:HTMLElement):Links|null{
 const title=[...node.querySelectorAll<HTMLAnchorElement>('h3 > a.card-title-link')].filter(a=>a.closest('article')===node);
 const action=[...node.querySelectorAll<HTMLAnchorElement>('.card-actions > a.source-link')].filter(a=>a.closest('article')===node);
 const t=title[0],a=action[0];
 if(title.length!==1||action.length!==1||!t||!a||!t.hasAttribute('href')||!a.hasAttribute('href')||t.href!==a.href)return null;
 try{
  const u=new URL(t.href);
  if(u.protocol!=='https:'||u.username||u.password||u.origin===location.origin)return null;
  if([t,a].some(link=>link.target!=='_blank'||!link.relList.contains('noopener')||!link.relList.contains('noreferrer')))return null;
 }catch{return null;}
 return {title:t,action:a};
}
/** Bind only the reader's canonical short stream ID or reviewed story key.
 * continuationItems uses article:<card.identity> as its SINGLE-story presentation
 * fallback. That suffix may be a publisher URL, not a short ID. Never retain it,
 * compare it to a URL, or turn it into the measurement identity. */
export function readerSourceIntentIdentity(article:unknown,stream:unknown,cat:unknown,story:unknown):Identity|null{
 if(typeof article!=='string'||!ARTICLE.test(article)||stream!=='article:'+article||!category(cat))return null;
 if(story===undefined)return {article,key:'article:'+article,category:cat};
 if(typeof story!=='string')return null;
 if(STORY.test(story))return {article,key:story,category:cat};
 // card-validation bounds the canonical card.identity to 3,000 characters.
 if(story.startsWith('article:')&&story.length>8&&story.length<=3008)return {article,key:'article:'+article,category:cat};
 return null;
}
function bindCard(node:HTMLElement,root:HTMLElement):Bound|null{
 if(node.parentElement!==root||!node.matches(CARD)||node.hasAttribute('data-home-local-id')||node.hasAttribute('data-knowledge-id')||!primaryLinks(node))return null;
 const identity=readerSourceIntentIdentity(node.dataset.cardId,node.dataset.newsStreamKey,node.dataset.newsCategory,node.dataset.storyKey);
 return identity?{node,...identity}:null;
}
function qualifies(node:HTMLElement,entry:IntersectionObserverEntry|undefined):boolean{
 if(!entry?.isIntersecting||entry.intersectionRatio<0.5||!node.isConnected||node.getClientRects().length===0)return false;
 for(let current:HTMLElement|null=node;current;current=current.parentElement){
  const style=getComputedStyle(current);
  if(current.hidden||current.inert||style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return false;
 }
 const rect=node.getBoundingClientRect(),area=rect.width*rect.height,view=window.visualViewport;
 if(!Number.isFinite(area)||area<=0||Math.abs(entry.boundingClientRect.width-rect.width)>0.1||Math.abs(entry.boundingClientRect.height-rect.height)>0.1)return false;
 const left=view?.offsetLeft??0,top=view?.offsetTop??0,width=view?.width??innerWidth,height=view?.height??innerHeight;
 const visible=Math.max(0,Math.min(rect.right,left+width)-Math.max(rect.left,left))*Math.max(0,Math.min(rect.bottom,top+height)-Math.max(rect.top,top));
 return visible>=area*0.5&&entry.intersectionRect.width*entry.intersectionRect.height>=area*0.5;
}
export interface SourceIntentController {snapshot():SourceIntentSnapshot;stop():void}
/** Attach to the actual homepage reader after the independently authorized
 * coordinator has granted the document. The coordinator must synchronously
 * call stop on withdrawal; permission is also checked on every sample, action
 * and read. No code imports this entry in the public build yet.
 */
export function startEditorialSourceIntent(readPermission:()=>unknown):SourceIntentController{
 const ledger=new QualifiedSourceIntent();
 let initial:Permit|null=null,lastWall=0,stopped=false,dirty=true,timer:number|null=null;
 let root:HTMLElement|null=null,io:IntersectionObserver|null=null,resize:ResizeObserver|null=null,mutation:MutationObserver|null=null;
 let cards:Bound[]=[];const entries=new Map<Element,IntersectionObserverEntry>(),cleanup:Array<()=>void>=[];
 const cleanupAll=():void=>{
  if(stopped)return;stopped=true;if(timer!==null)window.clearInterval(timer);
  io?.disconnect();resize?.disconnect();mutation?.disconnect();cards=[];entries.clear();
  for(const release of cleanup.splice(0))release();
 };
 const stop=():void=>{ledger.stop();cleanupAll();};
 const hold=():void=>{ledger.hold();cleanupAll();};
 const permitted=():boolean=>{
  try{
   const now=Date.now(),nav=navigator as Navigator&{globalPrivacyControl?:boolean;doNotTrack?:string};
   if(now<lastWall||nav.globalPrivacyControl===true||nav.doNotTrack==='1')return false;
   lastWall=now;const current=readSourceIntentPermit(readPermission(),now);if(!current)return false;
   if(initial===null)initial=current;
   return current.revision===initial.revision&&current.issuedAt===initial.issuedAt&&current.expiresAt===initial.expiresAt;
  }catch{return false;}
 };
 const snapshot=():SourceIntentSnapshot=>{if(!stopped&&!permitted())stop();return ledger.snapshot();};
 if(typeof window==='undefined'||typeof document==='undefined'||!permitted()){
  ledger.stop();return {snapshot:()=>ledger.snapshot(),stop:()=>ledger.stop()};
 }
 const container=document.getElementById('discovery-cards');
 if(location.pathname!=='/'||!(container instanceof HTMLElement)||typeof IntersectionObserver!=='function'||typeof ResizeObserver!=='function'||typeof MutationObserver!=='function'){
  stop();return {snapshot,stop};
 }
 root=container;
 const active=():boolean=>container.isConnected&&document.visibilityState==='visible'&&document.hasFocus()
  &&!(document as Document&{prerendering?:boolean}).prerendering&&document.body.dataset.entryView==='start'
  &&!document.body.dataset.worldExplore&&!document.querySelector('dialog[open]');
 const reset=():void=>ledger.invalidate();
 const changed=():void=>{dirty=true;reset();};
 const receive=(values:readonly IntersectionObserverEntry[]):void=>{
  for(const entry of values){
   const previous=entries.get(entry.target);if(previous&&entry.time<previous.time)continue;
   entries.set(entry.target,entry);if(!entry.isIntersecting||entry.intersectionRatio<0.5)reset();
  }
 };
 const sync=():void=>{
  dirty=false;reset();io?.disconnect();io=null;resize?.disconnect();entries.clear();cards=[];
  for(const node of container.querySelectorAll<HTMLElement>(':scope > '+CARD)){
   const bound=bindCard(node,container);if(bound)cards.push(bound);
   if(cards.length>INTENT_DOCUMENT_LIMIT){hold();return;}
  }
  const observer=new IntersectionObserver(values=>{if(!stopped&&io===observer)receive(values);},{threshold:[0,0.5,1]});
  io=observer;resize?.observe(container);
  for(const card of cards){observer.observe(card.node);resize?.observe(card.node);}
 };
 const drainMutation=():void=>{if(mutation&&mutation.takeRecords().length>0)changed();};
 const sample=():void=>{
  if(stopped)return;if(!permitted()||!container.isConnected){stop();return;}
  try{
   drainMutation();
   if(!active()){reset();return;}
   if(dirty)sync();if(stopped)return;
   if(io)receive(io.takeRecords());
   const next:FrameCard[]=[];
   for(const card of cards){
    // DOM identity is rechecked on binding and activation; pending DOM changes
    // are drained before every frame. Only intersecting candidates need geometry.
    if(card.node.parentElement!==container){changed();return;}
    next.push({article:card.article,key:card.key,category:card.category,visible:qualifies(card.node,entries.get(card.node))});
   }
   ledger.frame(performance.now(),next);
   if(ledger.snapshot().status==='held')cleanupAll();
  }catch{hold();}
 };
 const click=(event:Event):void=>{
  if(stopped)return;if(!permitted()){stop();return;}
  if(!(event instanceof MouseEvent)||!event.isTrusted||event.button!==0||event.defaultPrevented||!active()||!(event.target instanceof Element))return;
  try{
   drainMutation();if(dirty)return;
   const link=event.target.closest('a'),node=link?.closest('article');
   if(!(node instanceof HTMLElement)||!(link instanceof HTMLAnchorElement))return;
   const bound=bindCard(node,container),pair=primaryLinks(node);
   if(!bound||!pair||(link!==pair.title&&link!==pair.action))return;
   if(!cards.some(card=>card.node===node&&same(card,bound)))return;
   // Do not prevent default, open a tab, inspect the destination response or
   // count middle-click/context-menu/prefetch. Only the trusted intent is observed.
   ledger.activate(bound);
  }catch{hold();}
 };
 const listen=(target:EventTarget,name:string,fn:EventListener,capture=false):void=>{
  target.addEventListener(name,fn,{capture,passive:true});cleanup.push(()=>target.removeEventListener(name,fn,capture));
 };
 try{
  resize=new ResizeObserver(reset);mutation=new MutationObserver(changed);
  mutation.observe(container,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','inert','open','href','target','rel','data-edition-part','data-card-id','data-news-stream-key','data-news-category','data-story-key','data-home-local-id','data-knowledge-id']});
  mutation.observe(document.body,{subtree:true,attributes:true,attributeFilter:['open','data-entry-view','data-world-explore']});
  for(const name of ['scroll','resize','focus','blur'])listen(window,name,reset,true);
  listen(document,'visibilitychange',reset);listen(window,'pagehide',stop);
  if(window.visualViewport){listen(window.visualViewport,'scroll',reset);listen(window.visualViewport,'resize',reset);}
  listen(container,'click',click);timer=window.setInterval(sample,100);
 }catch{hold();}
 return {snapshot,stop};
}
