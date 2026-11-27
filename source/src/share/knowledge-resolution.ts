import {createHash} from 'node:crypto';
import {knowledgeEditorialPayload,selectKnowledgeCards,type KnowledgeCard,type KnowledgeLanguage} from '../iceo/knowledge.js';
import {knowledgeShareEligible,type KnowledgeCardReference} from './link.js';

export interface SharedKnowledgeView {
 readonly card:KnowledgeCard;readonly language:KnowledgeLanguage;readonly validUntil:number;readonly digest:string;
}
/** Separate, version-specific permission for standalone public distribution.
 * A committed decision must carry evidence reviewed outside this code path.
 * A source licence, a geographic label or feed eligibility is not this decision.
 */
export interface KnowledgeShareAdmission {
 readonly id:string;readonly revision:number;readonly digest:string;
 readonly reviewedAt:number;readonly expiresAt:number;
}
// Exact standalone decision, separate from feed admission. Evidence and scope:
// tests/evidence/nsw-fuelcheck-admission-20261126.json. Never use fixture or visitor input.
const standaloneAdmissions:readonly KnowledgeShareAdmission[]=Object.freeze([
 Object.freeze({"id":"dlkt-elsewhere-nsw-fuelcheck","revision":1,"digest":"d4c1df98ae87865402292c04c46811d60eee7ed3bde9583f1e16cd243611110e","reviewedAt":1795725223000,"expiresAt":1798317223000}),
]);
function validClock(now:number):boolean {
 return Number.isSafeInteger(now)&&Math.abs(now)<=8_640_000_000_000_000-48*3_600_000;
}
/** Exact committed card and rendered rights metadata; a changed byte requires new review. */
export function knowledgeContentDigest(card:KnowledgeCard):string {
 return createHash('sha256').update(knowledgeEditorialPayload(card),'utf8').digest('hex');
}
/** Pure resolution boundary, independently exercised with synthetic lab decisions. */
export function resolveKnowledgeShareFromCatalogue(reference:KnowledgeCardReference,now:number,catalogue:readonly KnowledgeCard[],admissions:readonly KnowledgeShareAdmission[]):SharedKnowledgeView|null {
 if(!validClock(now))throw Error('KNOWLEDGE_SHARE_CLOCK_INVALID');
 const matching=admissions.filter(item=>item.id===reference.id);
 if(matching.length!==1)return null;
 const admission=matching[0]!;
 if(admission.revision!==reference.revision||admission.digest!==reference.digest||!/^[a-f0-9]{64}$/u.test(admission.digest)||
  !validClock(admission.reviewedAt)||!validClock(admission.expiresAt)||
  admission.reviewedAt>now||admission.expiresAt<=now||admission.expiresAt<=admission.reviewedAt)return null;
 const candidates=catalogue.filter(item=>item.id===reference.id);
 if(candidates.length!==1)return null;
 const card=candidates[0]!;
 if(!knowledgeShareEligible(card)||card.revision!==reference.revision||
  !['en','ro','it'].includes(reference.language)||selectKnowledgeCards([card],'all',now,'shared-knowledge','UTC').length!==1||
  admission.reviewedAt<Date.parse(card.reviewedAt)||admission.digest!==knowledgeContentDigest(card))return null;
 return Object.freeze({card,language:reference.language,digest:admission.digest,validUntil:Math.min(Date.parse(card.reviewBy),admission.expiresAt)});
}
/** The public handler uses only the committed admission registry and catalogue.
 * Lazy loading isolates news requests from an invalid editorial catalogue.
 */
export async function resolveKnowledgeShare(reference:KnowledgeCardReference,now:number):Promise<SharedKnowledgeView|null>{
 if(!validClock(now))throw Error('KNOWLEDGE_SHARE_CLOCK_INVALID');
 if(!standaloneAdmissions.some(item=>item.id===reference.id&&item.revision===reference.revision&&item.digest===reference.digest))return null;
 const {KNOWLEDGE_CARDS}=await import('../iceo/knowledge-catalog.js');
 return resolveKnowledgeShareFromCatalogue(reference,now,KNOWLEDGE_CARDS,standaloneAdmissions);
}
