import {PUBLIC_TOPICS} from './topics.js';
import type {EvidenceCard,IceoSnapshot,SourceHealth,Topic} from './contracts.js';
import {cardContent,copyCard,validCard} from './card-validation.js';
import {sourceMatchesCardTopic,sourceRelevantToTopics} from './source-relevance.js';
import {hasEditorialTopics} from './editorial-topics.js';

export const COMPARISON_VERSION='iceo-local-comparison-1' as const;
export const COMPARISON_MAX_AGE_MS=3_600_000;
const SKEW=300_000;
const TOPICS = PUBLIC_TOPICS;
const FIELDS=['title','date','dateLabel','deadline','version','sourceUrl','publisher','summary','byline','licenseUrl'] as const;
export type MetadataField=typeof FIELDS[number]|'context';
export interface SourceStamp {
  readonly id:string;readonly label:string;readonly topic:Topic;readonly scope:string;
  readonly observedAt:string;readonly partial:boolean;readonly recordCount:number;
}
export interface ComparisonCheckpoint {
  readonly version:typeof COMPARISON_VERSION;readonly revision:string;readonly savedAt:string;
  readonly sources:readonly SourceStamp[];readonly records:readonly EvidenceCard[];
  /** Explicit focus retained when a multi-subject source has no matching records later. */
  readonly topics?:readonly Topic[];
}
export interface MetadataChange {readonly field:MetadataField;readonly before:string|null;readonly after:string|null}
export interface ComparedCard {readonly card:EvidenceCard;readonly kind:'not-in-saved-check'|'listing-updated';readonly changes:readonly MetadataChange[]}
export interface ComparisonResult {
  readonly state:'complete'|'partial'|'unavailable';readonly cards:readonly ComparedCard[];
  readonly unchanged:number;readonly comparableSources:number;readonly totalSources:number;
  readonly savedAt:string;readonly oldestObservation:string|null;readonly newestObservation:string|null;
  readonly notes:readonly string[];
}
function object(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function text(v:unknown,max=4000):v is string{return typeof v==='string'&&v.length>0&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);}
function stamp(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
function uuid(v:unknown):v is string{return typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(v);}
function sourceStamp(v:unknown):v is SourceStamp {
  return object(v)&&text(v.id,80)&&/^[a-z0-9-]+$/u.test(v.id)&&text(v.label,300)&&TOPICS.includes(v.topic as Topic)
    &&text(v.scope)&&stamp(v.observedAt)&&typeof v.partial==='boolean'&&Number.isSafeInteger(v.recordCount)&&Number(v.recordCount)>=0&&Number(v.recordCount)<=5000;
}
/** Stored state is untrusted. Copy only documented public fields and reject broken identity sets. */
export function parseCheckpoint(value:unknown):ComparisonCheckpoint|null {
  try{
    if(!object(value)||value.version!==COMPARISON_VERSION||!uuid(value.revision)||!stamp(value.savedAt)
      ||!Array.isArray(value.sources)||value.sources.length===0||value.sources.length>100||!value.sources.every(sourceStamp)
      ||!Array.isArray(value.records)||value.records.length>5000||!value.records.every(validCard))return null;
    const sources=value.sources;const records=value.records;
    if(value.topics!==undefined&&(!Array.isArray(value.topics)||!value.topics.length||value.topics.length>TOPICS.length
      ||value.topics.some(topic=>!TOPICS.includes(topic as Topic))||new Set(value.topics).size!==value.topics.length
      ||records.some(card=>!(value.topics as readonly Topic[]).includes(card.topic))))return null;
    if(new Set(sources.map(s=>s.id)).size!==sources.length||new Set(records.map(c=>c.id)).size!==records.length||new Set(records.map(c=>c.identity)).size!==records.length)return null;
    if(sources.some(s=>Date.parse(s.observedAt)>Date.parse(value.savedAt as string)+SKEW))return null;
    if(records.some(c=>c.sourceState==='stale'||!c.sourceIds.length||c.sourceIds.length>100||new Set(c.sourceIds).size!==c.sourceIds.length
      ||!c.sourceIds.every(id=>sources.some(s=>s.id===id&&sourceMatchesCardTopic(s,c)))
      ||Date.parse(c.observedAt)>Date.parse(value.savedAt as string)+SKEW))return null;
    if(sources.some(s=>s.recordCount!==records.filter(c=>c.sourceIds.includes(s.id)).length))return null;
    const result:ComparisonCheckpoint={version:COMPARISON_VERSION,revision:value.revision,savedAt:value.savedAt,
      sources:sources.map(s=>({id:s.id,label:s.label,topic:s.topic,scope:s.scope,observedAt:s.observedAt,partial:s.partial,recordCount:s.recordCount})),records:records.map(copyCard),
      ...(value.topics!==undefined?{topics:[...value.topics] as Topic[]}: {})};
    return JSON.stringify(result).length<=8_000_000?result:null;
  }catch{return null;}
}
function usable(source:SourceHealth,now:number):boolean {
  return (source.state==='verified'||source.state==='partial')&&source.error===null&&stamp(source.verifiedAt)
    &&Date.parse(source.verifiedAt)<=now+SKEW&&now-Date.parse(source.verifiedAt)<=COMPARISON_MAX_AGE_MS;
}
function structural(snapshot:IceoSnapshot):boolean{
  return snapshot.version==='iceo-primary-mesh-1'&&snapshot.product==='dlkt-info'&&['current-official-records','current-source-records'].includes(String(snapshot.mode))
    &&Array.isArray(snapshot.sources)&&snapshot.sources.length>0&&snapshot.sources.length<=100
    &&new Set(snapshot.sources.map(s=>s.id)).size===snapshot.sources.length
    &&Array.isArray(snapshot.cards)&&snapshot.cards.length<=5000&&snapshot.cards.every(validCard)
    &&new Set(snapshot.cards.map(c=>c.id)).size===snapshot.cards.length&&new Set(snapshot.cards.map(c=>c.identity)).size===snapshot.cards.length
    &&Number.isSafeInteger(snapshot.conflictCount)&&snapshot.conflictCount===0;
}
export function captureCheckpoint(snapshot:IceoSnapshot,now:number,revision:string):ComparisonCheckpoint {
  if(!Number.isFinite(now)||!uuid(revision)||!structural(snapshot)||snapshot.state==='unavailable'
    ||snapshot.sources.some(s=>!usable(s,now)))throw new Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');
  const topics=TOPICS.filter(topic=>snapshot.cards.some(card=>card.topic===topic)
    ||snapshot.coverage.includes(topic)&&snapshot.sources.some(source=>source.topic===topic||hasEditorialTopics(source.id)));
  const result=parseCheckpoint({version:COMPARISON_VERSION,revision,savedAt:new Date(now).toISOString(),topics,
    sources:snapshot.sources.map(s=>({id:s.id,label:s.label,topic:s.topic,scope:s.scope,observedAt:s.verifiedAt,
      partial:s.state==='partial'||s.rejected>0,recordCount:s.count})),records:snapshot.cards});
  if(!result)throw new Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');return result;
}
/** Transport timestamps, hashes and ordering do not by themselves represent a content change. */
export function metadataChanges(before:EvidenceCard,after:EvidenceCard):readonly MetadataChange[]{
  const changes:MetadataChange[]=FIELDS.filter(field=>before[field]!==after[field]).map(field=>({field,before:before[field]??null,after:after[field]??null}));
  // Wire/IndexedDB property order is not a change to publisher context. Reuse the
  // same canonical public fields as card integrity, including country code/name.
  const oldContext=before.context===undefined?null:JSON.stringify(cardContent(before).context),newContext=after.context===undefined?null:JSON.stringify(cardContent(after).context);
  if(oldContext!==newContext)changes.push({field:'context',before:oldContext,after:newContext});
  return changes;
}
export function compareCheckpoint(baseline:ComparisonCheckpoint,snapshot:IceoSnapshot,now:number):ComparisonResult {
  const saved=parseCheckpoint(baseline);if(!saved)throw new Error('CHECKPOINT_INVALID');
  const unavailable=(reason:string):ComparisonResult=>({state:'unavailable',cards:[],unchanged:0,comparableSources:0,totalSources:Math.max(saved.sources.length,snapshot.sources.length),savedAt:saved.savedAt,oldestObservation:null,newestObservation:null,notes:[reason]});
  if(!Number.isFinite(now)||Date.parse(saved.savedAt)>now+SKEW)return unavailable('The browser clock is earlier than the saved check.');
  if(!structural(snapshot)||snapshot.state==='unavailable')return unavailable('The current source snapshot cannot be compared safely.');
  const ids=new Set([...saved.sources.map(s=>s.id),...snapshot.sources.map(s=>s.id)]);
  const comparable=new Map<string,SourceHealth>();const notes:string[]=[];
  for(const id of ids){
    const old=saved.sources.find(s=>s.id===id),current=snapshot.sources.find(s=>s.id===id);
    if(!old||!current){notes.push(`${current?.label??old?.label??id}: not present in both source checks.`);continue;}
    if(!usable(current,now)){notes.push(`${current.label}: no recent successful source check.`);continue;}
    if(old.scope!==current.scope||old.topic!==current.topic){notes.push(`${current.label}: source coverage changed; a new baseline is needed.`);continue;}
    if(Date.parse(current.verifiedAt??'')<Date.parse(old.observedAt)){notes.push(`${current.label}: the current snapshot is older than the saved check.`);continue;}
    if(current.count!==snapshot.cards.filter(c=>c.sourceIds.includes(id)).length){notes.push(`${current.label}: the accepted record count is inconsistent.`);continue;}
    comparable.set(id,current);
    if(old.partial||current.state==='partial'||current.rejected>0)notes.push(`${current.label}: some records were excluded from one of the source checks.`);
  }
  if(comparable.size===0)return {...unavailable('No source has two comparable successful checks.'),notes};
  const previous=new Map(saved.records.map(card=>[card.id,card]));const cards:ComparedCard[]=[];let unchanged=0;
  for(const card of snapshot.cards){
    if(card.sourceState==='stale'||!card.sourceIds.some(id=>comparable.has(id)))continue;
    const old=previous.get(card.id);
    if(old&&old.identity!==card.identity){notes.push('A record identity conflict was excluded.');continue;}
    if(!old){cards.push({card,kind:'not-in-saved-check',changes:[]});continue;}
    const changes=metadataChanges(old,card);
    if(changes.length)cards.push({card,kind:'listing-updated',changes});else unchanged++;
  }
  const observations=[...comparable.values()].map(s=>s.verifiedAt??'').sort();
  return {state:notes.length?'partial':'complete',cards,unchanged,comparableSources:comparable.size,totalSources:ids.size,
    savedAt:saved.savedAt,oldestObservation:observations[0]??null,newestObservation:observations.at(-1)??null,notes};
}

/** Restrict the existing checkpoint mechanism to explicitly chosen topics. No new persistence. */
function assertTopics(topics:readonly Topic[]):void {
 if(!topics.length||new Set(topics).size!==topics.length||topics.some(t=>!TOPICS.includes(t)))throw Error('CHECKPOINT_TOPICS_REQUIRED');
}
export function focusedSnapshot(snapshot:IceoSnapshot,topics:readonly Topic[],previousRecords:readonly EvidenceCard[]=[]):IceoSnapshot {
 assertTopics(topics);if(!structural(snapshot))throw Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');
 const cards=snapshot.cards.filter(c=>topics.includes(c.topic));
 const referenced=[...snapshot.cards,...previousRecords];
 const relevant=snapshot.sources.filter(s=>sourceRelevantToTopics(s,topics,referenced));
 if(relevant.some(s=>s.count!==snapshot.cards.filter(c=>c.sourceIds.includes(s.id)).length))throw Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');
 if(cards.some(c=>!c.sourceIds.length||!c.sourceIds.every(id=>relevant.some(s=>s.id===id&&sourceMatchesCardTopic(s,c)))))throw Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');
 // Counts describe this explicit projection, after the original source counts were verified.
 const sources=relevant.map(s=>({...s,count:cards.filter(c=>c.sourceIds.includes(s.id)).length}));
 const state=snapshot.state==='unavailable'?'unavailable':sources.some(s=>(s.state==='verified'||s.state==='partial')&&s.error===null)?sources.every(s=>s.state==='verified'&&s.error===null&&s.rejected===0)?'ready':'partial':'unavailable';
 return {...snapshot,sources,cards,state,coverage:[...topics]};
}
export function compareFocusedCheckpoint(baseline:ComparisonCheckpoint,snapshot:IceoSnapshot,topics:readonly Topic[],now:number):ComparisonResult {
 assertTopics(topics);const saved=parseCheckpoint(baseline);if(!saved)throw Error('CHECKPOINT_INVALID');
 const records=saved.records.filter(c=>topics.includes(c.topic));
 const selectedBefore=saved.topics??TOPICS.filter(topic=>saved.sources.some(s=>s.topic===topic)||saved.records.some(c=>c.topic===topic));
 const relevant=saved.sources.filter(s=>sourceRelevantToTopics(s,topics,saved.records)
   ||selectedBefore.some(topic=>topics.includes(topic))&&saved.topics?.every(topic=>topics.includes(topic)));
 const sources=relevant.map(s=>({...s,recordCount:records.filter(c=>c.sourceIds.includes(s.id)).length}));
 const unavailable=(reason:string):ComparisonResult=>({state:'unavailable',cards:[],unchanged:0,comparableSources:0,totalSources:Math.max(sources.length,snapshot.sources.filter(s=>sourceRelevantToTopics(s,topics,[...snapshot.cards,...saved.records])).length),savedAt:saved.savedAt,oldestObservation:null,newestObservation:null,notes:[reason]});
 if(topics.some(topic=>!selectedBefore.includes(topic)))return unavailable('No saved source check covers the selected interests. Save a check for these interests first.');
 if(!sources.length)return unavailable('No saved source check covers the selected interests. Save a check for these interests first.');
 try{
  const current=focusedSnapshot(snapshot,topics,saved.records);
  // An empty saved editorial slice still retains its checked source IDs for the same explicit focus.
  const currentIds=new Set(current.sources.map(s=>s.id));
  const retained=snapshot.sources.filter(s=>sources.some(old=>old.id===s.id)&&!currentIds.has(s.id));
  if(retained.some(s=>s.count!==snapshot.cards.filter(c=>c.sourceIds.includes(s.id)).length))return unavailable('The current source snapshot cannot be compared safely.');
  const projected={...current,sources:[...current.sources,...retained.map(s=>({...s,count:current.cards.filter(c=>c.sourceIds.includes(s.id)).length}))]};
  if(snapshot.state!=='unavailable'&&projected.state==='unavailable'&&projected.sources.some(s=>usable(s,now)))projected.state=projected.sources.every(s=>usable(s,now)&&s.state==='verified'&&s.rejected===0)?'ready':'partial';
  return compareCheckpoint({...saved,sources,records,topics:[...topics]},projected,now);
 }catch{return unavailable('The current source snapshot cannot be compared safely.');}
}
