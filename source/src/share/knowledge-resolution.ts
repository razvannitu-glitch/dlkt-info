import {selectKnowledgeCards,type KnowledgeCard,type KnowledgeLanguage} from '../iceo/knowledge.js';
import {knowledgeShareEligible,type KnowledgeCardReference} from './link.js';

export interface SharedKnowledgeView {
 readonly card:KnowledgeCard;readonly language:KnowledgeLanguage;readonly validUntil:number;
}
/** Resolve only committed editorial content. No caller-supplied content or live I/O.
 * Lazy loading isolates the news route from a failed editorial catalogue import.
 */
export async function resolveKnowledgeShare(reference:KnowledgeCardReference,now:number):Promise<SharedKnowledgeView|null>{
 if(!Number.isSafeInteger(now)||Math.abs(now)>8_640_000_000_000_000-48*3_600_000)throw Error('KNOWLEDGE_SHARE_CLOCK_INVALID');
 const {KNOWLEDGE_CARDS}=await import('../iceo/knowledge-catalog.js');
 const card=KNOWLEDGE_CARDS.find(item=>item.id===reference.id);
 if(!card||!knowledgeShareEligible(card)||card.revision!==reference.revision||
  !['en','ro','it'].includes(reference.language)||selectKnowledgeCards([card],'all',now,'shared-knowledge','UTC').length!==1)return null;
 return Object.freeze({card,language:reference.language,validUntil:Date.parse(card.reviewBy)});
}
