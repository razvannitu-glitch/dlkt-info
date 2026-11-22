import type {ContextualToday} from './contextual-today.js';
import type {LocalCard} from '../local/contracts.js';
import {NEWS_WINDOW_MS,NEWS_CHECK_MS} from '../local/news-policy.js';

interface ReadingEdition {readonly local:readonly LocalCard[];readonly pending:number;readonly seed:string;readonly expiresAt:number|null}
function localSignature(card:LocalCard):string {
  return JSON.stringify([card.id,card.sourceUrl,card.news?.id,card.news?.documentHash]);
}
function current(card:LocalCard,now:number):boolean {
  const checked=Date.parse(card.checkedAt),published=Date.parse(card.news?.publishedAt??'');
  return card.kind==='local-news'&&card.news!==undefined&&Number.isFinite(checked)&&checked<=now+5000&&now-checked<NEWS_CHECK_MS
    &&Date.parse(card.validTo)>now&&published<=now+NEWS_CHECK_MS&&published>=now-NEWS_WINDOW_MS;
}
/** An ordering seed, not a security digest; only the adopted public edition determines it. */
export function newsEditionSeed(today:ContextualToday,local:readonly LocalCard[],language:string):string {
  const identities=[...today.first,...today.more].flatMap(view=>[view.card,...view.related].map(card=>JSON.stringify([card.identity,card.contentHash])));
  const material=JSON.stringify([language,[...new Set(identities)].sort(),local.map(localSignature).sort()]);
  let hash=2166136261;
  for(let index=0;index<material.length;index++)hash=Math.imul(hash^material.charCodeAt(index),16777619)>>>0;
  return 'news-edition:'+language+':'+hash.toString(16).padStart(8,'0');
}
/** Visible local originals stay fixed between pages, including an initially empty local pool. */
export class NewsReadingState {
  private active=false;
  private context='';
  private local:readonly LocalCard[]=[];
  private seed='news-stream-v1';
  hasVisibleLocal(now:number):boolean {return this.local.some(card=>current(card,now));}
  present(today:ContextualToday,candidates:readonly LocalCard[],context:string,language:string,now:number,apply=false):ReadingEdition {
    const incoming=candidates.filter(card=>current(card,now));
    if(!this.active||this.context!==context||apply){
      this.context=context;this.local=Object.freeze([...incoming]);
      this.seed=newsEditionSeed(today,this.local,language);
      this.active=today.first.length+today.more.length+incoming.length>0;
    }else{
      const checks=new Map(incoming.map(card=>[localSignature(card),card]));
      // Only an identical original can renew its source-check metadata.
      this.local=Object.freeze(this.local.map(card=>checks.get(localSignature(card))??card).filter(card=>current(card,now)));
    }
    const visible=new Map(this.local.map(card=>[card.id,localSignature(card)])),next=new Map(incoming.map(card=>[card.id,localSignature(card)]));
    let pending=0;
    for(const [id,signature] of next)if(visible.get(id)!==signature)pending++;
    for(const id of visible.keys())if(!next.has(id))pending++;
    const expiries=this.local.flatMap(card=>[Date.parse(card.checkedAt)+NEWS_CHECK_MS,Date.parse(card.validTo),Date.parse(card.news?.publishedAt??'')+NEWS_WINDOW_MS+1]).filter(time=>Number.isFinite(time)&&time>now);
    return Object.freeze({local:this.local,pending,seed:this.seed,expiresAt:expiries.length?Math.min(...expiries):null});
  }
}
