import {safeLocale} from './reader.js';
import {insightSupported,validInsight,type SourceInsight} from './insight-contracts.js';
import type {EvidenceCard} from './contracts.js';
const entries=new Map<string,{until:number;value:SourceInsight}>();
const observed=new Set<Element>();
const waiting=new WeakMap<Element,()=>Promise<void>>();
const queue:Array<()=>Promise<void>>=[];let active=0;
const observe=typeof IntersectionObserver==='function'?new IntersectionObserver(items=>{
  for(const item of items){if(!item.isIntersecting)continue;observe?.unobserve(item.target);observed.delete(item.target);const job=waiting.get(item.target);if(job){waiting.delete(item.target);queue.push(job);drain();}}
},{rootMargin:'80px'}):null;
function drain():void{while(active<2&&queue.length){const work=queue.shift();if(!work)break;active++;void work().finally(()=>{active--;drain();});}}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,text:string,className=''):HTMLElementTagNameMap[K]{const e=document.createElement(tag);e.textContent=text;e.className=className;return e;}
function render(host:HTMLElement,card:EvidenceCard,result:SourceInsight):void{
  host.replaceChildren();host.dataset.insightState=result.state;
  if(result.state!=='ready'){host.append(node('p','Source text is not available for this card. The original listing and link remain below.','insight-note'));return;}
  host.append(node('h4',card.kind==='software-release'?'From the release notes':'From the publication'));

  const point=result.points[0];if(!point)return;
  host.append(node('blockquote',point.text,'insight-excerpt'));
  const details=node('details','');details.append(node('summary',result.points.length>1?'More from this source':'Source evidence'));
  details.append(node('p',result.introduction,'insight-intro'));
  for(const p of result.points.slice(1))details.append(node('blockquote',p.text,'insight-excerpt'));
  details.append(node('p',`${result.points.length} selected passage${result.points.length===1?'':'s'} from ${result.availablePoints} eligible publisher highlights. Not a full-document summary.`,'insight-note'));
  details.append(node('p',result.nextStep,'insight-next'));
  const checked=new Intl.DateTimeFormat(safeLocale(navigator.language||'en-GB'),{dateStyle:'medium',timeStyle:'short'}).format(new Date(result.checkedAt));
  details.append(node('p',`Source content checked: ${checked}. ${result.attribution}`,'insight-note'));
  for(const p of result.points){const link=node('a',`${p.section} · passage ${p.index+1}`);link.href=card.sourceUrl+'#:~:text='+encodeURIComponent(p.text);link.target='_blank';link.rel='noopener noreferrer';details.append(link);}
  const fingerprint=node('code',result.documentHash??'','insight-hash');details.append(node('p','Document fingerprint','insight-note'),fingerprint);
  const rights=node('a','Source terms');rights.href=result.termsUrl;rights.target='_blank';rights.rel='noopener noreferrer';details.append(rights);
  host.append(details);
}
/** Fetch only a visible supported card; filters never leave the page. */
export function pruneInsights():void{for(const target of observed){if(!target.isConnected){observe?.unobserve(target);waiting.delete(target);observed.delete(target);}}}
export function attachInsight(article:HTMLElement,card:EvidenceCard,automatic=true,latestCard:()=>EvidenceCard=()=>card):void{
  if(!insightSupported(card))return;
  const context=article.querySelector('.card-reading');if(!context)return;
  const host=node('section','','card-insight');host.setAttribute('aria-label','Key points from the source');host.dataset.insightState='pending';
  const button=node('button','Read key points','insight-load');button.type='button';host.append(button);context.append(host);
  let started=false;
  const load=async():Promise<void>=>{
    if(started||!host.isConnected)return;started=true;button.disabled=true;button.textContent='Reading source…';host.setAttribute('aria-busy','true');
    try{
      const current=latestCard();if(current.id!==card.id||current.sourceUrl!==card.sourceUrl||!insightSupported(current))throw new Error('INSIGHT_CARD_CHANGED');
      const key=current.id+':'+current.contentHash;const cached=entries.get(key);let value:SourceInsight;
      if(cached&&cached.until>Date.now())value=cached.value;
      else {
        const response=await fetch(`/api/insight?id=${current.id}&hash=${current.contentHash}`,{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});
        if(!response.ok)throw new Error('INSIGHT_UNAVAILABLE');const data:unknown=await response.json();
        if(!validInsight(data,current))throw new Error('INSIGHT_INVALID');value=data;
        if(entries.size>=256){const first=entries.keys().next().value;if(first)entries.delete(first);}
        entries.set(key,{until:Date.now()+(value.state==='ready'?900000:60000),value});
      }
      if(host.isConnected)render(host,current,value);
    }catch{
      if(host.isConnected){host.dataset.insightState='unavailable';host.replaceChildren(node('p','Source text could not be checked. Read the original source below.','insight-note'));}
    }finally{host.setAttribute('aria-busy','false');}
  };
  button.addEventListener('click',()=>{observe?.unobserve(host);waiting.delete(host);queue.push(load);drain();});
  if(observe&&automatic){waiting.set(host,load);observed.add(host);observe.observe(host);}
}
