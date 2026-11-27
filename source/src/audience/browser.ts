/** Optional reader-only audience measurement. No account or reading-history data. */
export const CHOICE_KEY='dlkt-audience-choice-v1';
export type Choice='allow'|'deny'|'withdraw'|'enabling';
export type Source='direct'|'search'|'social'|'referral'|'unknown';
type Action={action:'status'|'enable'|'withdraw'}|{action:'event';event:{kind:'pageview';id:string;source:Source}|{kind:'presence'}};
export interface Reply {status:number;value:unknown}
export interface BrowserDependencies {
 read:()=>Choice|null;write:(value:Choice)=>boolean;request:(action:Action)=>Promise<Reply>;
 visible:()=>boolean;privacy:()=>boolean;now:()=>number;uuid:()=>string;source:()=>Source;
}
type RecordValue=Readonly<Record<string,unknown>>;
function object(value:unknown):RecordValue|null{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:null;}
export function readChoice(value:unknown):Choice|null{return value==='allow'||value==='deny'||value==='withdraw'||value==='enabling'?value:null;}
const SEARCH=['google.com','google.ro','google.co.uk','google.de','google.fr','google.it','google.es','bing.com','duckduckgo.com','search.yahoo.com','search.brave.com','ecosia.org'];
const SOCIAL=['facebook.com','instagram.com','linkedin.com','reddit.com','tiktok.com','x.com','twitter.com','youtube.com','t.co','threads.net'];
export function classifySource(referrer:string,origin:string):Source{
 if(!referrer)return 'direct';
 try{
  const u=new URL(referrer);
  if(!['https:','http:'].includes(u.protocol))return 'unknown';
  if(u.origin===origin)return 'direct';
  const matches=(names:readonly string[])=>names.some(host=>u.hostname===host||u.hostname.endsWith('.'+host));
  return matches(SEARCH)?'search':matches(SOCIAL)?'social':'referral';
 }catch{return 'unknown';}
}
export class AudienceBrowser {
 private busy=false;
 private viewId:string|null=null;
 private viewed=false;
 private stopped=false;
 private inFlight=false;
 private lastInteraction=0;
 private lastEvent=0;
 constructor(private readonly d:BrowserDependencies){}
 private permitted():boolean{return this.d.read()==='allow'&&!this.d.privacy()&&this.d.visible()&&!this.stopped;}
 private async send(action:Action):Promise<Reply>{
  try{return await this.d.request(action);}catch{return {status:0,value:null};}
 }
 async status():Promise<{available:boolean;hasToken:boolean}|null>{
  const r=await this.send({action:'status'}),v=object(r.value);
  return r.status===200&&typeof v?.available==='boolean'&&typeof v.hasToken==='boolean'?{available:v.available,hasToken:v.hasToken}:null;
 }
 /** Consent changes are serialized by the browser's Web Locks API at the UI boundary. */
 async enable():Promise<boolean>{
  if(this.busy||this.d.privacy()||this.d.read()==='withdraw')return false;
  this.busy=true;
  try{
   if(!this.d.write('enabling'))return false;
   const r=await this.send({action:'enable'});
   if(r.status===200&&object(r.value)?.enabled===true&&this.d.read()==='enabling'&&this.d.write('allow')){
    this.stopped=false;return true;
   }
   // A lost response may have installed a cookie. Never treat it as consent.
   this.d.write('withdraw');
   const removed=await this.send({action:'withdraw'});
   if(removed.status===200&&object(removed.value)?.enabled===false)this.d.write('deny');
   return false;
  }finally{this.busy=false;}
 }
 stop():void{this.stopped=true;}
 async withdraw():Promise<boolean>{
  this.stop();this.d.write('withdraw');
  if(this.busy)return false;
  this.busy=true;
  try{
   const r=await this.send({action:'withdraw'});
   if(r.status!==200||object(r.value)?.enabled!==false)return false;
   this.d.write('deny');return true;
  }finally{this.busy=false;}
 }
 interaction():void{if(this.permitted())this.lastInteraction=this.d.now();}
 async pageview():Promise<void>{
  if(!this.permitted()||this.viewed||this.inFlight)return;
  this.inFlight=true;
  try{
   this.viewId??=this.d.uuid();
   const r=await this.send({action:'event',event:{kind:'pageview',id:this.viewId,source:this.d.source()}});
   const result=object(r.value)?.result;
   if(r.status===200&&(result==='accepted'||result==='duplicate')){
    this.viewed=true;this.lastEvent=this.d.now();return;
   }
   // No repeated attempts or automatic renewed consent on a rejected token.
   this.stop();
   if(r.status===401&&this.d.read()==='allow')this.d.write('deny');
  }catch{this.stop();}finally{this.inFlight=false;}
 }
 async presence():Promise<void>{
  const now=this.d.now();
  if(!this.permitted()||!this.viewed||this.inFlight||now-this.lastEvent<120_000||this.lastInteraction<=0||now-this.lastInteraction>120_000)return;
  this.inFlight=true;this.lastEvent=now;
  try{
   const r=await this.send({action:'event',event:{kind:'presence'}});
   if(r.status!==200||object(r.value)?.result!=='accepted'){
    this.stop();
    if(r.status===401&&this.d.read()==='allow')this.d.write('deny');
   }
  }finally{this.inFlight=false;}
 }
}
function mount():void{
 const settings=document.getElementById('audience-choice-status');
 const reader=['/','/index.html','/start','/briefing','/companion','/companion.html'].includes(location.pathname);
 if(!settings&&!reader)return;
 const read=():Choice|null=>{try{return readChoice(localStorage.getItem(CHOICE_KEY));}catch{return null;}};
 const write=(value:Choice):boolean=>{try{localStorage.setItem(CHOICE_KEY,value);return read()===value;}catch{return false;}};
 const nav=navigator as Navigator&{globalPrivacyControl?:boolean;doNotTrack?:string};
 const privacy=()=>nav.globalPrivacyControl===true||nav.doNotTrack==='1';
 const request=async(action:Action):Promise<Reply>=>{
  const response=await fetch('/api/audience',{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json','X-DLKT-Info-Request':'audience-v1'},body:JSON.stringify(action),signal:AbortSignal.timeout(8_000)});
  if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))return {status:response.status,value:null};
  return {status:response.status,value:await response.json() as unknown};
 };
 const client=new AudienceBrowser({read,write,request,visible:()=>document.visibilityState==='visible',privacy,now:Date.now,uuid:()=>crypto.randomUUID(),source:()=>classifySource(document.referrer,location.origin)});
 const withLock=async<T>(operation:()=>Promise<T>):Promise<T>=>{
  // A browser without cross-tab locks may withdraw, but cannot create a new consent token.
  if(!navigator.locks)return operation();
  return navigator.locks.request('dlkt-audience-consent-v1',operation);
 };
 if(settings){
  const allow=document.getElementById('audience-choice-allow'),deny=document.getElementById('audience-choice-deny');
  if(!(allow instanceof HTMLButtonElement)||!(deny instanceof HTMLButtonElement))return;
  let revision=0;
  const refresh=async():Promise<void>=>{
   const current=++revision;const s=await client.status();if(current!==revision)return;
   const choice=read();
   const available=Boolean(s?.available)&&!privacy()&&Boolean(navigator.locks);
   allow.hidden=!available||choice==='allow'||choice==='withdraw'||choice==='enabling';
   deny.hidden=!available&&!s?.hasToken&&choice!=='allow'&&choice!=='withdraw'&&choice!=='enabling';
   if(choice==='withdraw'||choice==='enabling')settings.textContent='Measurement stopped here. Deletion has not been confirmed. Select Do not allow / withdraw to retry.';
   else if(choice==='allow'&&s?.hasToken&&available)settings.textContent='Optional audience measurement is on for this browser.';
   else if(choice==='allow'&&s?.hasToken)settings.textContent='Measurement is currently paused. You can still withdraw and request deletion.';
   else if(choice==='allow'&&s&&!s.hasToken){write('deny');settings.textContent='The previous measurement token has expired. Measurement is off.';allow.hidden=!available;}
   else settings.textContent=available?'Measurement is off unless you choose to allow it.':'Optional audience measurement is not available. No consent is required to read.';
  };
  const change=async(enable:boolean):Promise<void>=>{
   ++revision;allow.disabled=true;deny.disabled=true;
   // Stop every tab before waiting for a shared operation to finish.
   if(!enable){client.stop();write('withdraw');}
   try{
    const success=await withLock(()=>enable?client.enable():client.withdraw());
    if(!success){settings.textContent=enable?'Measurement was not enabled. Try again only if you wish.':'Measurement stopped here, but deletion could not be confirmed. Retry withdrawal.';return;}
    await refresh();
   }catch{settings.textContent='Measurement choice could not be confirmed. No new measurement will be enabled here.';}
   finally{allow.disabled=false;deny.disabled=false;}
  };
  allow.addEventListener('click',()=>{if(navigator.locks)void change(true);});
  deny.addEventListener('click',()=>void change(false));
  window.addEventListener('storage',e=>{if(e.key===CHOICE_KEY)void refresh();});
  void refresh();return;
 }
 // No status probe, consent cookie or event for a reader who has not opted in.
 if(!reader||read()!=='allow'||privacy())return;
 const view=()=>{if(document.visibilityState==='visible')void client.pageview();};
 const interaction=()=>{if(document.hasFocus())client.interaction();};
 const timer=window.setInterval(()=>{if(document.hasFocus())void client.presence();},60_000);
 document.addEventListener('visibilitychange',view);
 for(const name of ['pointerdown','keydown','scroll'] as const)document.addEventListener(name,interaction,{passive:true});
 window.addEventListener('storage',e=>{if(e.key===CHOICE_KEY&&read()!=='allow'){client.stop();clearInterval(timer);}});
 window.addEventListener('pagehide',()=>{client.stop();clearInterval(timer);},{once:true});
 view();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')mount();
