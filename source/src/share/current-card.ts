import {createHash} from 'node:crypto';
import {cardContent} from '../iceo/card-validation.js';
import {validTopicSnapshot,DAILY_TOPIC_FRESHNESS_MS} from '../daily/contracts.js';
import type {EvidenceCard,IceoSnapshot} from '../iceo/contracts.js';
import type {CardReference} from './link.js';
export class PublicCardError extends Error {constructor(readonly status:404|410|503,message:string){super(message);}}
export interface CurrentCard {readonly card:EvidenceCard;readonly validUntil:number;readonly partial:boolean}
const digest=(v:unknown):string=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
/** Both HTML and PNG can only resolve the same source-checked public metadata. */
export function currentCard(snapshot:IceoSnapshot,ref:CardReference,now:number,exactRevision=false):CurrentCard {
 if(!Number.isFinite(now)||!validTopicSnapshot(snapshot,now)||snapshot.state==='unavailable')throw new PublicCardError(503,'CARD_SNAPSHOT_UNAVAILABLE');
 const matches=snapshot.cards.filter(c=>c.id===ref.id);
 if(matches.length!==1)throw new PublicCardError(snapshot.state==='ready'&&matches.length===0?404:503,'CARD_NOT_FOUND');
 const card=matches[0];if(!card)throw new PublicCardError(503,'CARD_MISSING');
 if(digest(card.identity).slice(0,24)!==card.id||digest(cardContent(card))!==card.contentHash)throw new PublicCardError(503,'CARD_IDENTITY_MISMATCH');
 if(exactRevision&&ref.revision!==card.contentHash)throw new PublicCardError(410,'CARD_REVISION_CHANGED');
 const sources=snapshot.sources.filter(s=>card.sourceIds.includes(s.id));
 if(card.sourceState==='stale'||sources.length!==card.sourceIds.length||!sources.length||sources.some(s=>!['verified','partial'].includes(s.state)||s.error!==null||s.verifiedAt===null||Date.parse(s.verifiedAt)>now+300000||Date.parse(s.verifiedAt)<now-DAILY_TOPIC_FRESHNESS_MS))throw new PublicCardError(503,'CARD_NOT_CURRENT');
 const validUntil=Math.min(Date.parse(card.observedAt)+DAILY_TOPIC_FRESHNESS_MS,...sources.map(s=>Date.parse(s.verifiedAt??'')+DAILY_TOPIC_FRESHNESS_MS));
 if(!Number.isFinite(validUntil)||validUntil<=now)throw new PublicCardError(503,'CARD_EXPIRED');
 return {card,validUntil,partial:sources.some(s=>s.state==='partial')};
}
