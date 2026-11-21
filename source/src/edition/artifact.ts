import {createHash} from 'node:crypto';
import type {EvidenceCard} from '../iceo/contracts.js';
import {emptyInsight,insightService} from '../iceo/insight.js';
import {insightSupported,validInsight,type SourceInsight} from '../iceo/insight-contracts.js';
import {ARTIFACT_VERSION,artifactBody,validArtifact,type EditionArtifact} from './artifact-contracts.js';
import type {Edition} from './contracts.js';
export const digestText=(s:string):string=>createHash('sha256').update(s).digest('hex');
export function assertArtifact(a:unknown):asserts a is EditionArtifact {
  if(!validArtifact(a)||digestText(artifactBody(a))!==a.digest||a.insights.some(i=>i.points.some(p=>digestText(p.text)!==p.hash)))throw Error('EDITION_ARTIFACT_INVALID');
}
function safeInsight(raw:unknown,card:EvidenceCard,prepared:number):SourceInsight {
  if(!validInsight(raw,card)||raw.points.reduce((n,p)=>n+p.text.length,0)>2000
    ||raw.points.some(p=>digestText(p.text)!==p.hash)||Date.parse(raw.checkedAt)>prepared+300_000
    ||(raw.state==='ready'&&Date.parse(raw.checkedAt)<prepared-3_600_000))return emptyInsight(card,prepared,'unavailable','EDITION_EVIDENCE_INVALID');
  return {version:raw.version,cardId:raw.cardId,cardHash:raw.cardHash,state:raw.state,method:raw.method,sourceUrl:raw.sourceUrl,
    checkedAt:raw.checkedAt,documentHash:raw.documentHash,introduction:raw.introduction,
    points:raw.points.map(p=>({text:p.text,section:p.section,index:p.index,hash:p.hash})),availablePoints:raw.availablePoints,
    nextStep:raw.nextStep,attribution:raw.attribution,termsUrl:raw.termsUrl,reason:raw.reason};
}
/** Enrichment has two workers and a total deadline. Every selected card remains present. */
export async function prepareArtifact(edition:Edition,options:{read?:(card:EvidenceCard)=>Promise<SourceInsight>;budgetMs?:number}={}):Promise<EditionArtifact>{
  const e=structuredClone(edition),prepared=Date.parse(e.generatedAt),budgetMs=options.budgetMs??8000;
  if(!Number.isFinite(prepared)||!Number.isInteger(budgetMs)||budgetMs<1||budgetMs>10_000)throw Error('EDITION_ENRICHMENT_CONFIG_INVALID');
  const read=options.read??(card=>insightService.read(card));const deadline=performance.now()+budgetMs;
  const insights=e.cards.map(card=>emptyInsight(card,prepared,insightSupported(card)?'unavailable':'unsupported',insightSupported(card)?'EDITION_ENRICHMENT_DEADLINE':'FORMAT_NOT_REVIEWED'));
  if(!validArtifact({version:ARTIFACT_VERSION,edition:e,insights,digest:'0'.repeat(64)}))throw Error('EDITION_ARTIFACT_INVALID');
  let next=0;
  async function worker():Promise<void>{
    while(next<e.cards.length){
      const index=next++,card=e.cards[index];if(!card||!insightSupported(card))continue;
      const remaining=deadline-performance.now();if(remaining<=0)return;
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        const result=await Promise.race([Promise.resolve().then(()=>read(card)),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),remaining);})]);
        if(result!==null)insights[index]=safeInsight(result,card,prepared);
      }catch{insights[index]=emptyInsight(card,prepared,'unavailable','SOURCE_UNAVAILABLE');}
      finally{if(timer)clearTimeout(timer);}
    }
  }
  await Promise.all([worker(),worker()]);
  const body={version:ARTIFACT_VERSION,edition:e,insights};const artifact={...body,digest:digestText(JSON.stringify(body))};
  assertArtifact(artifact);
  function freeze(value:object):void{Object.freeze(value);for(const child of Object.values(value))if(child!==null&&typeof child==='object'&&!Object.isFrozen(child))freeze(child);}
  freeze(artifact);return artifact;
}
