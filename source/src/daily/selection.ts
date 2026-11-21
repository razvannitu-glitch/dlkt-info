import {validLocalNewsArticle} from '../local/news-policy.js';
import {rankContextualCards} from '../iceo/contextual.js';
import {TOPIC_DESCRIPTIONS} from '../iceo/topics.js';
import {sourceMatchesCardTopic,sourceRelevantToTopics,sourcesCoverTopic} from '../iceo/source-relevance.js';
import type {EvidenceCard,IceoSnapshot} from '../iceo/contracts.js';
import {metadataChanges,type MetadataChange} from '../iceo/comparison.js';
import {selectReadingCards,type ReadingCard} from '../iceo/reader.js';
import {localEventEligible,type LocalSnapshot,type LocalCard} from '../local/contracts.js';
import {localCoverageReading} from '../local/presentation.js';
import {compareLocal} from '../local/memory.js';
import {DAILY_TOPIC_FRESHNESS_MS,profileKey,localDay,validProfile,type DailyProfile,type DailyEdition,type DailyFeedback} from './contracts.js';
export interface DailyItem {readonly id:string;readonly signature:string;readonly topic:ReadingCard|null;readonly local:LocalCard|null;readonly reason:string;readonly change:'first'|'different'|'same'|'added'|'available';readonly changes:readonly MetadataChange[]}
export interface DailySelection {readonly edition:DailyEdition;readonly items:readonly DailyItem[];readonly hidden:number;readonly topicCount:number;readonly localChanges:readonly string[];readonly notes:readonly string[];readonly previousAt:string|null}
export function topicSignature(c:EvidenceCard):string{return JSON.stringify([c.identity,c.title,c.date,c.dateLabel,c.deadline,c.version,c.sourceUrl,c.publisher,...(c.summary!==undefined?[c.summary]:[]),...(c.byline!==undefined?[c.byline,c.licenseUrl]:[]),...(c.context!==undefined?[JSON.stringify(c.context)]:[])]);}
export function localSignature(c:LocalCard):string{return JSON.stringify([c.id,c.title,c.text,c.validFrom,c.facts]);}
export function isHidden(item:Pick<DailyItem,'id'|'signature'>,feedback:readonly DailyFeedback[],now:number,zone:string):boolean{return feedback.some(f=>f.id===item.id&&f.signature===item.signature&&f.action==='not-today'&&f.day===localDay(now,zone)&&f.timezone===zone);}
const labels=TOPIC_DESCRIPTIONS;
export function selectDaily(p:DailyProfile,topic:IceoSnapshot|null,local:LocalSnapshot|null,previous:DailyEdition|null,feedback:readonly DailyFeedback[],now:number):DailySelection {
 if(!validProfile(p)||!Number.isFinite(now))throw Error('DAILY_PROFILE_INVALID');
 const key=profileKey(p),prior=previous?.profileKey===key&&Date.parse(previous.generatedAt)<=now+300000?previous:null;const notes:string[]=[];
 const sourceRecords=[...(topic?.cards??[]),...(prior?.comparison??prior?.records??[])];
 const sources=topic?.sources.filter(s=>sourceRelevantToTopics(s,p.topics,sourceRecords))??[];
 const usable=sources.filter(s=>(s.state==='verified'||s.state==='partial')&&s.error===null&&s.verifiedAt!==null&&Date.parse(s.verifiedAt)<=now+300000&&Date.parse(s.verifiedAt)>=now-DAILY_TOPIC_FRESHNESS_MS);
 const topicState:DailyEdition['topicState']=!p.topics.length?'not-selected':!topic||topic.state==='unavailable'||!usable.length?'unavailable':p.topics.some(t=>!sourcesCoverTopic(sources,t,sourceRecords))||usable.length!==sources.length||sources.some(s=>s.state==='partial'||s.rejected>0)?'partial':'ready';
 let identityConflict=false;
 const records=topicState==='unavailable'?[]:(topic?.cards??[]).filter(c=>p.topics.includes(c.topic)&&c.sourceState!=='stale'&&usable.some(s=>sourceMatchesCardTopic(s,c)));
 const localValid=local?.city.id===p.cityId?local:null;
 const localCards=(localValid?.cards??[]).filter(c=>Date.parse(c.validTo)>now&&localEventEligible(c,now)&&(c.kind!=='local-news'||Boolean(localValid&&validLocalNewsArticle(c.news,localValid.city,now))));
 const localReady=localValid?.state==='ready'&&localValid.weatherState==='ready'&&(localValid.city.id!=='2643743'||localValid.transportState==='ready')&&localCards.length===localValid.cards.length;
 if(p.cityId&&(!localReady))notes.push('Some local checks are expired or unavailable. Refresh before relying on them; this is not an all-clear.');
 if(topicState==='partial'||topicState==='unavailable')notes.push('Some selected sources could not be checked completely. Available cards remain readable; the previous complete edition is kept.');
 if(localValid&&(localValid.coverage||localValid.newsSources))notes.push(...localCoverageReading(localValid,now).map(item=>item.text));
 else if(localValid?.transportState==='not-covered')notes.push('This city currently has a city-centre forecast only. Local events and other services are not connected.');
 const localItems:DailyItem[]=localCards.map(c=>({id:'local:'+c.id,signature:localSignature(c),topic:null,local:c,reason:c.context?.why??`For ${localValid?.city.name??''}, the city you selected.`,change:prior?.local?'same':'first',changes:[]}));
 const previousRecords=prior?.comparison??prior?.records??[];
 const old=new Map(previousRecords.map(c=>[c.id,c]));
 const included=new Set(prior?.records.map(c=>c.id)??[]);
 const safeRecords=records.filter(c=>{const before=old.get(c.id);if(before&&before.identity!==c.identity){identityConflict=true;return false;}return true;});
 if(identityConflict)notes.push('A conflicting document identity was excluded. The previous complete edition is kept.');
 const chosen=selectReadingCards(safeRecords,{topics:p.topics,query:p.query,budget:Math.max(1,records.length),mode:'briefing'},now);
 const contextual=rankContextualCards(safeRecords,{countryCode:localValid?.city.countryCode??null,topics:p.topics,query:p.query,budget:Math.max(1,records.length),publicationWindowMs:null},now);
 let topicItems:DailyItem[]=contextual.map(v=>{const before=old.get(v.card.id);const sameIdentity=before?.identity===v.card.identity;const changes=before&&sameIdentity?metadataChanges(before,v.card):[];return {id:'topic:'+v.card.id,signature:topicSignature(v.card),topic:v,local:null,reason:(p.query?`Matches “${p.query}” in the ${labels[v.card.topic]} source you selected.`:`From ${labels[v.card.topic]}, selected by you.`)+' '+v.reason,change:!prior?'first':before&&sameIdentity?changes.length?'different':included.has(v.card.id)?'same':'available':prior.comparison!==undefined?'added':'available',changes};});
 // A reduced reading budget is not evidence that an old document is new.
 // Hold the prior selected cards stable unless actual changes or newly indexed matches appear.
 const priority={different:0,added:1,first:2,same:2,available:2};
 topicItems.sort((a,b)=>priority[a.change]-priority[b.change]||Number(included.has(b.topic?.card.id??''))-Number(included.has(a.topic?.card.id??'')));
 const comparison=chosen.cards.map(v=>v.card);
 const hidden=topicItems.filter(i=>isHidden(i,feedback,now,p.timezone)).length;
 topicItems=topicItems.filter(i=>!isHidden(i,feedback,now,p.timezone)).slice(0,p.budget);
 const edition:DailyEdition={generatedAt:new Date(now).toISOString(),profileKey:key,topicState,local:localValid,records:topicItems.flatMap(i=>i.topic?[i.topic.card]:[]),comparison,complete:!identityConflict&&(topicState==='ready'||topicState==='not-selected')&&(!p.cityId||localReady)};
 if(prior&&topicState!=='unavailable'&&p.topics.length&&topicItems.length>0&&topicItems.every(i=>i.change==='same'||i.change==='available'))notes.push('No listing differences in these comparable cards. Older publications are not new merely because you opened today’s edition.');
 return{edition,items:[...localItems,...topicItems],hidden,topicCount:topicItems.length,localChanges:prior?.local&&localValid?compareLocal(prior.local,localValid):[],notes,previousAt:prior?.generatedAt??null};
}
