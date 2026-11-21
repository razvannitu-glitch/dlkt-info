import {PUBLIC_TOPICS} from '../iceo/topics.js';
import type {EvidenceCard,Topic} from '../iceo/contracts.js';
import {validCard} from '../iceo/card-validation.js';
export const PUBLIC_ORIGIN='https://www.dlkt.ee' as const;
export const SHARE_TOPICS=PUBLIC_TOPICS;
export interface CardReference {readonly id:string;readonly revision:string|null}
/** Only public document identity and metadata revision enter a link. Never a profile or text query. */
export function cardPath(card:EvidenceCard):string {
  if(!validCard(card))throw Error('SHARE_CARD_INVALID');
  return `/card/${card.id}?v=${card.contentHash}`;
}
export function cardLink(card:EvidenceCard):string{return PUBLIC_ORIGIN+cardPath(card);}
export function parseCardReference(raw:string):CardReference|null {
  if(raw.length>512||!raw.startsWith('/')||raw.startsWith('//')||/[\\\u0000-\u0020\u007f#]/u.test(raw))return null;
  try{
    const u=new URL(raw,PUBLIC_ORIGIN);if(u.pathname!==raw.split('?')[0])return null;const match=/^\/card\/([a-f0-9]{24})$/u.exec(u.pathname);
    if(!match&&u.pathname!=='/api/card')return null;
    if([...u.searchParams.keys()].some(k=>k!=='id'&&k!=='v')||u.searchParams.getAll('id').length>1||u.searchParams.getAll('v').length>1)return null;
    const id=match?.[1]??u.searchParams.get('id');const passed=u.searchParams.get('id');
    if(!id||!/^[a-f0-9]{24}$/u.test(id)||passed!==null&&passed!==id)return null;
    const revision=u.searchParams.get('v');if(revision!==null&&!/^[a-f0-9]{64}$/u.test(revision))return null;
    return{id,revision};
  }catch{return null;}
}
export function sharedTopic(hash:string):Topic|null {
  const value=/^#briefing-topic=([a-z-]+)$/u.exec(hash)?.[1];
  return SHARE_TOPICS.includes(value as Topic)?value as Topic:null;
}

export function cardImagePath(card:EvidenceCard):string {if(!validCard(card))throw Error('SHARE_CARD_INVALID');return `/api/card-image?id=${card.id}&v=${card.contentHash}`;}
export function cardImageLink(card:EvidenceCard):string{return PUBLIC_ORIGIN+cardImagePath(card);}
export function parseCardImageReference(raw:string):CardReference|null {
 if(!raw.startsWith('/api/card-image?'))return null;return parseCardReference('/api/card'+raw.slice('/api/card-image'.length));
}
