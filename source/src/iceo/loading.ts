export type DiscoveryLoadingPhase='initial'|'slow'|'error'|'hidden';
export const DISCOVERY_SLOW_MS=8_000;
export interface DiscoveryLoadingState {
 readonly pending:boolean;
 readonly unavailable:boolean;
 readonly firstCount:number;
 readonly moreCount:number;
}

/** Loading is presentation of the real request; existing eligible reports always remain usable. */
export function discoveryLoadingPhase(state:DiscoveryLoadingState,startedAt:number|null,now:number):DiscoveryLoadingPhase {
 if(state.firstCount+state.moreCount>0)return 'hidden';
 if(state.pending)return startedAt!==null&&now-startedAt>=DISCOVERY_SLOW_MS?'slow':'initial';
 return state.unavailable?'error':'hidden';
}

type Timer=ReturnType<typeof setTimeout>;
export interface DiscoveryLoadingClock {
 readonly now:()=>number;
 readonly schedule:(callback:()=>void,delay:number)=>Timer;
 readonly cancel:(timer:Timer)=>void;
}
const browserClock:DiscoveryLoadingClock={
 now:()=>performance.now(),
 schedule:(callback,delay)=>setTimeout(callback,delay),
 cancel:timer=>clearTimeout(timer),
};

/** One finite waiting notification per request; this never fetches, retries or delays a result. */
export class DiscoveryLoading {
 private startedAt:number|null=null;
 private timer:Timer|undefined;
 private generation=0;
 constructor(private readonly onSlow:()=>void,private readonly clock:DiscoveryLoadingClock=browserClock){}
 begin():void {
  if(this.startedAt!==null)return;
  this.startedAt=this.clock.now();
  const generation=++this.generation;
  this.timer=this.clock.schedule(()=>{
   if(this.startedAt===null||generation!==this.generation)return;
   this.timer=undefined;this.onSlow();
  },DISCOVERY_SLOW_MS);
 }
 finish():void {
  this.generation++;
  if(this.timer!==undefined)this.clock.cancel(this.timer);
  this.timer=undefined;this.startedAt=null;
 }
 phase(state:DiscoveryLoadingState):DiscoveryLoadingPhase {
  return discoveryLoadingPhase(state,this.startedAt,this.clock.now());
 }
}

export interface DiscoveryLoadingElements {
 readonly panel:HTMLElement;
 readonly title:HTMLElement;
 readonly copy:HTMLElement;
 readonly personalise:HTMLButtonElement;
 readonly hint:HTMLElement;
 readonly retry:HTMLButtonElement;
 readonly status:HTMLElement;
}
const copy:Readonly<Record<Exclude<DiscoveryLoadingPhase,'hidden'>,{readonly title:string;readonly description:string;readonly announcement:string}>>={
 initial:{
  title:'Your day, coming into focus.',
  description:"Loading today's stories from connected sources.",
  announcement:"Loading today's stories.",
 },
 slow:{
  title:'Still connecting.',
  description:"Today's stories are taking longer to load. You can choose your interests while this check finishes.",
  announcement:"Today's stories are taking longer to load. You can choose your interests while this check finishes.",
 },
 error:{
  title:"Let's try that again.",
  description:"Today's stories could not be loaded. Check your connection or try again.",
  announcement:"Today's stories could not be loaded. Try again when you are ready.",
 },
};
function setText(node:HTMLElement,text:string):void {if(node.textContent!==text)node.textContent=text;}
/** Reuse the server-supplied composition so unrelated city renders never restart its motion. */
export function renderDiscoveryLoading(elements:DiscoveryLoadingElements,phase:DiscoveryLoadingPhase):void {
 if(elements.panel.dataset.phase!==phase)elements.panel.dataset.phase=phase;
 const hidden=phase==='hidden';
 if(elements.panel.hidden!==hidden)elements.panel.hidden=hidden;
 elements.status.classList.toggle('sr-only',!hidden);
 if(hidden)return;
 const content=copy[phase];
 setText(elements.title,content.title);setText(elements.copy,content.description);
 setText(elements.status,content.announcement);
 elements.retry.hidden=phase!=='error';
 elements.personalise.hidden=phase==='error';
 elements.hint.hidden=phase==='error';
}

export interface DiscoveryLoadingFocus {
 readonly settings:HTMLDialogElement;
 readonly settingsFallback:HTMLElement;
 readonly menuFallback:HTMLElement;
 readonly retryTarget:HTMLElement;
}
/** Call existing actions and keep focus usable when their transient loading controls disappear. */
export function bindDiscoveryLoadingActions(elements:DiscoveryLoadingElements,actions:{readonly personalise:()=>void;readonly retry:()=>void},focus:DiscoveryLoadingFocus):()=>void {
 let settingsFromLoading=false,disposed=false;
 const visible=(element:HTMLElement):boolean=>element.isConnected&&!element.hidden&&element.getClientRects().length>0;
 const available=(button:HTMLButtonElement):boolean=>visible(button)&&!button.disabled&&!elements.panel.hidden;
 const personalise=():void=>{settingsFromLoading=true;actions.personalise();};
 const retry=():void=>{focus.retryTarget.focus({preventScroll:true});actions.retry();};
 const settingsClosed=():void=>{
  if(!settingsFromLoading)return;
  settingsFromLoading=false;
  // Match the header's native-dialog handling: let close and explicit submit focus settle first.
  queueMicrotask(()=>{
   if(disposed||focus.settings.open||available(elements.personalise))return;
   const owner=elements.panel.ownerDocument,active=owner.activeElement;
   const hiddenControl=active===elements.personalise&&!available(elements.personalise)||active===elements.retry&&!available(elements.retry);
   if(active===owner.body||hiddenControl||focus.settings.contains(active)){
    const destination=visible(focus.settingsFallback)?focus.settingsFallback:focus.menuFallback;
    if(visible(destination))destination.focus({preventScroll:true});
   }
  });
 };
 elements.personalise.addEventListener('click',personalise);
 elements.retry.addEventListener('click',retry);
 focus.settings.addEventListener('close',settingsClosed);
 return()=>{
  disposed=true;
  elements.personalise.removeEventListener('click',personalise);
  elements.retry.removeEventListener('click',retry);
  focus.settings.removeEventListener('close',settingsClosed);
 };
}
