import {PUBLIC_TOPICS} from '../iceo/topics.js';
import type {EvidenceCard,Topic} from '../iceo/contracts.js';
import {validCard} from '../iceo/card-validation.js';
import {validKnowledgeCard,type KnowledgeCard,type KnowledgeLanguage} from '../iceo/knowledge.js';
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
/** Separate editorial identity, never an EvidenceCard ID or content hash. */
export interface KnowledgeCardReference {readonly id:string;readonly revision:number;readonly language:KnowledgeLanguage}
const KNOWLEDGE_SHARE_ID=/^dlkt-elsewhere-[a-z0-9][a-z0-9-]{0,64}$/u;
function validKnowledgeShareLanguage(value:unknown):value is KnowledgeLanguage {
 return value==='en'||value==='ro'||value==='it';
}
export function knowledgeShareEligible(card:unknown):card is KnowledgeCard {
 return validKnowledgeCard(card)&&KNOWLEDGE_SHARE_ID.test(card.id)&&card.format==='elsewhere'&&card.distribution==='cross-border'&&card.geography!==undefined;
}
export function knowledgeReferencePath(reference:KnowledgeCardReference):string {
 if(!KNOWLEDGE_SHARE_ID.test(reference.id)||!Number.isSafeInteger(reference.revision)||reference.revision<1||!validKnowledgeShareLanguage(reference.language))throw Error('KNOWLEDGE_SHARE_REFERENCE_INVALID');
 return '/card/'+reference.id+'?v='+String(reference.revision)+'&lang='+reference.language;
}
export function knowledgeCardLink(card:KnowledgeCard,language:KnowledgeLanguage):string {
 if(!knowledgeShareEligible(card))throw Error('KNOWLEDGE_SHARE_CARD_INVALID');
 return PUBLIC_ORIGIN+knowledgeReferencePath({id:card.id,revision:card.revision,language});
}
/** Accept only the canonical direct route or its existing Vercel rewrite. */
export function parseKnowledgeCardReference(raw:string):KnowledgeCardReference|null {
 if(typeof raw!=='string'||raw.length>512||/[^!-~]|[%#\\+]/u.test(raw))return null;
 const parts=raw.split('?');if(parts.length!==2)return null;
 const [path,query]=parts;if(path===undefined||query===undefined)return null;
 const direct=/^\/card\/(dlkt-elsewhere-[a-z0-9][a-z0-9-]{0,64})$/u.exec(path);
 if(!direct&&path!=='/api/card')return null;
 const allowed=direct?['v','lang']:['id','v','lang'];
 const pairs=query.split('&');if(pairs.length!==allowed.length||pairs.some(pair=>!/^(?:id|v|lang)=[a-z0-9-]+$/u.test(pair)))return null;
 const params=new URLSearchParams(query);
 if([...params.keys()].some(key=>!allowed.includes(key))||allowed.some(key=>params.getAll(key).length!==1))return null;
 const id=direct?.[1]??params.get('id'),version=params.get('v'),language=params.get('lang');
 if(typeof id!=='string'||!KNOWLEDGE_SHARE_ID.test(id)||version===null||!/^[1-9]\d{0,15}$/u.test(version)||!validKnowledgeShareLanguage(language))return null;
 const revision=Number(version);if(!Number.isSafeInteger(revision)||String(revision)!==version)return null;
 return {id,revision,language};
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
