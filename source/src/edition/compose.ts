import {cardGuide} from '../iceo/card-guide.js';
import {createHash} from 'node:crypto';
import {selectReadingCards,type ReaderSettings} from '../iceo/reader.js';
import {validSettings} from '../iceo/device-memory.js';
import {copyCard} from '../iceo/card-validation.js';
import {sourceMatchesCardTopic,sourceRelevantToTopics,sourcesCoverTopic} from '../iceo/source-relevance.js';
import type {IceoSnapshot} from '../iceo/contracts.js';
import {EDITION_VERSION,type Edition} from './contracts.js';
/** The edition contains only server-collected records. Saved browser copies never become evidence. */
export function composeEdition(snapshot:IceoSnapshot,settings:ReaderSettings,now:number):Edition{
 if(!Number.isFinite(now)||!validSettings(settings)||settings.mode!=='briefing'||!settings.topics.length)throw Error('EDITION_SETTINGS_INVALID');
 if(snapshot.version!=='iceo-primary-mesh-1'||snapshot.product!=='dlkt-info'||!["current-official-records","current-source-records"].includes(String(snapshot.mode))||!Number.isFinite(Date.parse(snapshot.generatedAt))||Date.parse(snapshot.generatedAt)>now+300_000)throw Error('EDITION_SOURCE_INVALID');
 const health=snapshot.sources.filter(s=>sourceRelevantToTopics(s,settings.topics,snapshot.cards));
 const fresh=new Set(health.filter(s=>['verified','partial'].includes(s.state)&&!s.error&&s.verifiedAt!==null&&Date.parse(s.verifiedAt)<=now+300_000&&Date.parse(s.verifiedAt)>=now-3_600_000).map(s=>s.id));
 const records=snapshot.cards.filter(c=>settings.topics.includes(c.topic)&&health.some(s=>fresh.has(s.id)&&sourceMatchesCardTopic(s,c))).map(copyCard);
 if(new Set(records.map(c=>c.id)).size!==records.length)throw Error('EDITION_DUPLICATE_ID');
 const selection=selectReadingCards(records,settings,now);
 const complete=health.length>0&&settings.topics.every(topic=>sourcesCoverTopic(health,topic,snapshot.cards))&&health.every(s=>fresh.has(s.id)&&s.state==='verified'&&s.rejected===0);
 const state=fresh.size===0?'unavailable':!complete?'partial':selection.cards.length?'ready':'empty';
 const body={version:EDITION_VERSION,generatedAt:new Date(now).toISOString(),sourceCheckAt:snapshot.generatedAt,state,kind:'current-source-selection' as const,
  settings:{topics:[...settings.topics],query:settings.query,budget:settings.budget,mode:'briefing' as const},
  cards:selection.cards.map(c=>copyCard(c.card)),sourceChecks:health.map(s=>({id:s.id,state:s.state,verifiedAt:s.verifiedAt})),
  availableGroups:selection.availableGroups,excludedNotices:selection.excludedNotices,excludedStale:selection.excludedStale+snapshot.cards.filter(c=>settings.topics.includes(c.topic)&&!c.sourceIds.some(id=>fresh.has(id))).length,delivered:false as const,persisted:false as const};
 return Object.freeze({...body,id:createHash('sha256').update(JSON.stringify(body)).digest('hex')}) as Edition;
}
export function editionText(e:Edition):string{
 const lines=['DLKT',`Edition prepared: ${e.generatedAt}`,`Source check: ${e.sourceCheckAt}`,`Coverage: ${e.state}`,`Selected topics: ${e.settings.topics.join(', ')}`,`Focus: ${e.settings.query||'No phrase filter'}`,'A current-source selection, not a statement that everything below is new.',''];
 for(const [index,c] of e.cards.entries()){const guide=cardGuide(c);lines.push(`${index+1}. ${c.title}`,c.publisher,...(c.byline?[c.byline,`Original: ${c.sourceUrl}`,`License: ${c.licenseUrl}`]:[]),`${c.dateLabel}: ${c.date}`,`Source checked: ${c.observedAt}`,c.sourceUrl,`Scope: ${guide.scope}`,`Next step: ${guide.nextStep}`,c.boundary,'');}
 if(!e.cards.length)lines.push(e.state==='unavailable'?'Source verification unavailable.':'No eligible records in this selection.');
 lines.push('Prepared on request. No scheduled delivery has been activated.',`Edition ID: ${e.id}`);return lines.join('\n');
}
