import {DAILY_TOPIC_FRESHNESS_MS,validTopicSnapshot} from '../daily/contracts.js';
import {parseSaved,type SavedCard} from './device-memory.js';
import {sourceMatchesCardTopic} from './source-relevance.js';
import {classifyNotice,normalizeFocus} from './reader.js';
import type {EvidenceCard,IceoSnapshot,SourceHealth} from './contracts.js';

export type SavedUpdateState='changed'|'unchanged'|'not-comparable'|'not-in-current-feed'|'unavailable';
export interface SavedFactChange {readonly field:'deadline'|'version'|'notice-type';readonly label:string;readonly before:string;readonly after:string}
export interface SavedWordingChange {readonly before:string;readonly after:string}
export interface SavedUpdate {
 readonly saved:SavedCard;readonly state:SavedUpdateState;readonly current:EvidenceCard|null;
 readonly changes:readonly SavedFactChange[];readonly wording:SavedWordingChange|null;
 readonly checkedAt:string|null;readonly partial:boolean;readonly note:string;
}
export interface SavedUpdates {
 readonly state:'empty'|'complete'|'partial'|'unavailable';readonly items:readonly SavedUpdate[];
 readonly materialCount:number;readonly wordingCount:number;readonly checkedCount:number;
 readonly unavailableCount:number;readonly missingCount:number;readonly notComparableCount:number;
}
const SKEW=300_000;
const normalized=(value:string):string=>value.normalize('NFC').replace(/\s+/gu,' ').trim();
function excerpt(card:EvidenceCard):string|null {
 const text=card.summary===undefined?'':normalized(card.summary);
 return text&&text!==normalized(card.title)?card.summary??null:null;
}
function usable(source:SourceHealth,card:EvidenceCard,now:number):boolean {
 const verified=Date.parse(source.verifiedAt??''),observed=Date.parse(card.observedAt),checked=Date.parse(source.checkedAt);
 return sourceMatchesCardTopic(source,card)&&(source.state==='verified'||source.state==='partial')&&source.error===null
  &&Number.isFinite(verified)&&Number.isFinite(checked)&&verified<=now+SKEW&&checked<=now+SKEW&&checked>=verified
  &&now-verified<=DAILY_TOPIC_FRESHNESS_MS&&observed<=now+SKEW;
}
function base(saved:SavedCard,state:SavedUpdateState,note:string):SavedUpdate {
 return{saved,state,current:null,changes:[],wording:null,checkedAt:null,partial:false,note};
}
/** Reuse the reader's explicit notice vocabulary; elapsed time is never a source revision. */
function noticeType(card:EvidenceCard,now:number):string|null {
 if(card.kind!=='procurement-notice')return null;
 const state=classifyNotice(card,now);
 if(state==='cancelled')return 'Cancellation notice';
 if(state==='awarded')return 'Contract award notice';
 return /^contract\s+notice\b/u.test(normalizeFocus(card.title))?'Contract notice':null;
}
/** Compare the same source record, never a title match or a new article about the same subject. */
function compare(saved:SavedCard,snapshot:IceoSnapshot,now:number):SavedUpdate {
 if(Date.parse(saved.savedAt)>now+SKEW||Date.parse(saved.card.observedAt)>now+SKEW)return base(saved,'unavailable','The saved check is ahead of the browser clock. Its original copy is retained.');
 const old=saved.card,current=snapshot.cards.find(card=>card.id===saved.id);
 const sourceIds=new Set(old.sourceIds);
 if(!current){
  const sources=snapshot.sources.filter(source=>sourceIds.has(source.id));
  if(sources.length!==sourceIds.size||!sources.length||sources.some(source=>!usable(source,old,now))||!sources.some(source=>Date.parse(source.verifiedAt??'')>=Date.parse(old.observedAt)))return base(saved,'unavailable','A current check of the saved source is unavailable. This is not confirmation that nothing changed.');
  const checkedAt=sources.reduce((earliest,source)=>source.verifiedAt!==null&&source.verifiedAt<earliest?source.verifiedAt:earliest,sources[0]?.verifiedAt??'');
  const partial=sources.some(source=>source.state==='partial'||source.rejected>0);
  return{...base(saved,'not-in-current-feed',partial?'This item is absent from an incomplete source check. Its status is unknown.':'This item is not in the current source feed. It may have rolled out of the feed; this does not establish cancellation, withdrawal or resolution.'),checkedAt,partial};
 }
 if(current.identity!==old.identity||current.kind!==old.kind||current.sourceUrl!==old.sourceUrl||!current.sourceIds.some(id=>sourceIds.has(id)))return base(saved,'unavailable','The current record cannot be matched safely to this saved source. The original copy is retained.');
 const sources=snapshot.sources.filter(source=>sourceIds.has(source.id)&&current.sourceIds.includes(source.id));
 // Reconciled duplicates carry the freshest contributing observation, not every source's timestamp.
 const supporting=sources.filter(source=>usable(source,current,now)&&Date.parse(source.verifiedAt??'')>=Date.parse(current.observedAt));
 if(current.sourceState==='stale'||Date.parse(current.observedAt)<Date.parse(old.observedAt)||!supporting.length)return base(saved,'unavailable','A fresh, comparable source check is unavailable. The saved copy has not been replaced.');
 const changes:SavedFactChange[]=[];
 const fields=current.kind==='procurement-notice'?(['deadline'] as const):current.kind==='software-release'?(['version'] as const):[];
 let comparedFacts=0,missingFacts=false;
 for(const field of fields){
  const before=old[field],after=current[field];
  if(before!==null&&after!==null){
   comparedFacts++;
   const same=field==='deadline'?Date.parse(before)===Date.parse(after):normalized(before)===normalized(after);
   if(!same)changes.push({field,label:field==='deadline'?'Listed closing date':'Listed version',before,after});
  }else if(before!==after)missingFacts=true;
 }
 const beforeType=noticeType(old,now),afterType=noticeType(current,now);
 if(beforeType!==null&&afterType!==null){comparedFacts++;if(beforeType!==afterType)changes.push({field:'notice-type',label:'Procedure notice type',before:beforeType,after:afterType});}
 const before=excerpt(old),after=excerpt(current);
 const wording=before!==null&&after!==null&&normalized(before)!==normalized(after)?{before,after}:null;
 const canCompare=comparedFacts>0||before!==null&&after!==null;
 const partial=sources.some(source=>!usable(source,current,now)||source.state==='partial'||source.rejected>0)||missingFacts||(before===null)!==(after===null);
 const state:SavedUpdateState=changes.length||wording?'changed':canCompare?'unchanged':'not-comparable';
 const note=state==='not-comparable'?'This listing has no supported detail present in both copies to compare. Open the source for its current terms.':partial?'Available details were compared. Some details or source records are missing; this is not a complete no-change result.':'Compared the details available in both source listings. Article text and unlisted conditions are not checked.';
 return{saved,state,current,changes,wording,checkedAt:supporting.reduce((earliest,source)=>source.verifiedAt!==null&&source.verifiedAt<earliest?source.verifiedAt:earliest,supporting[0]?.verifiedAt??''),partial,note};
}
/** Browser-only projection. It never writes the saved baseline or sends saved identities to a server. */
export function selectSavedUpdates(saved:readonly SavedCard[],snapshot:IceoSnapshot|null,now:number,currentAvailable:boolean):SavedUpdates {
 const valid=saved.flatMap(value=>{const card=parseSaved(value);return card?[card]:[];});
 const ready=Number.isFinite(now)&&currentAvailable&&snapshot!==null&&validTopicSnapshot(snapshot,now)&&snapshot.state!=='unavailable';
 const items=valid.map(card=>ready&&snapshot?compare(card,snapshot,now):base(card,'unavailable','A current source check is unavailable. Your saved copy is kept intact; this is not a no-change result.'));
 const materialCount=items.filter(item=>item.changes.length>0).length,wordingCount=items.filter(item=>item.wording!==null).length;
 const unavailableCount=items.filter(item=>item.state==='unavailable').length,missingCount=items.filter(item=>item.state==='not-in-current-feed').length,notComparableCount=items.filter(item=>item.state==='not-comparable').length;
 const checkedCount=items.filter(item=>item.current!==null).length;
 return{state:!items.length?'empty':unavailableCount===items.length?'unavailable':unavailableCount||missingCount||notComparableCount||items.some(item=>item.partial)||valid.length!==saved.length?'partial':'complete',items,materialCount,wordingCount,checkedCount,unavailableCount,missingCount,notComparableCount};
}
/** Expire visible comparison evidence even when its card is outside today's public selection. */
export function nextSavedUpdateDelay(saved:readonly SavedCard[],snapshot:IceoSnapshot|null,now:number):number|null {
 if(!snapshot||!Number.isFinite(now)||!saved.length)return null;
 const ids=new Set(saved.flatMap(item=>item.card.sourceIds));
 const boundaries=[Date.parse(snapshot.generatedAt)+DAILY_TOPIC_FRESHNESS_MS+1,...snapshot.sources.filter(source=>ids.has(source.id)).map(source=>Date.parse(source.verifiedAt??'')+DAILY_TOPIC_FRESHNESS_MS+1)].filter(at=>Number.isFinite(at)&&at>now);
 return boundaries.length?Math.max(1,Math.min(...boundaries)-now):null;
}

/** Session-only progress, including across outages. An older successful response cannot erase newer evidence. */
export class SnapshotProgress {
 private generatedAt=Number.NEGATIVE_INFINITY;
 private readonly sources=new Map<string,number>();
 private readonly records=new Map<string,number>();
 accept(candidate:IceoSnapshot,now:number):'accepted'|'invalid'|'regressed' {
  if(!Number.isFinite(now)||!validTopicSnapshot(candidate,now))return 'invalid';
  const generated=Date.parse(candidate.generatedAt);
  if(generated<this.generatedAt)return 'regressed';
  const sourceTimes=new Map<string,number>();
  for(const source of candidate.sources){
   if((source.state!=='verified'&&source.state!=='partial')||source.error!==null)continue;
   const observed=Date.parse(source.verifiedAt??'');
   if(!Number.isFinite(observed)||observed>now+SKEW)return 'invalid';
   if(observed<(this.sources.get(source.id)??Number.NEGATIVE_INFINITY))return 'regressed';
   sourceTimes.set(source.id,observed);
  }
  const recordTimes=new Map<string,number>();
  for(const card of candidate.cards){
   if(card.sourceState==='stale')continue;
   const contributions=card.sourceIds.flatMap(id=>{const time=sourceTimes.get(id);return time===undefined?[]:[time];});
   const observed=Date.parse(card.observedAt);
   if(!contributions.length||!Number.isFinite(observed)||observed>now+SKEW||observed>Math.max(...contributions))return 'invalid';
   if(observed<(this.records.get(card.id)??Number.NEGATIVE_INFINITY))return 'regressed';
   recordTimes.set(card.id,observed);
  }
  // Commit progress only after every source and record has passed; a rejected response changes nothing.
  this.generatedAt=generated;
  for(const [id,observed]of sourceTimes)this.sources.set(id,observed);
  for(const [id,observed]of recordTimes){this.records.delete(id);this.records.set(id,observed);}
  // Public feeds are rolling, not an unbounded browser archive. Source watermarks remain retained.
  while(this.records.size>5000){const oldest=this.records.keys().next().value;if(oldest===undefined)break;this.records.delete(oldest);}
  return 'accepted';
 }
}
