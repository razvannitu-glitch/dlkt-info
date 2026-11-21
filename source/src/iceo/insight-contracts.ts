import type { EvidenceCard } from './contracts.js';
export const INSIGHT_VERSION='iceo-source-insight-1' as const;
export interface SourcePoint { readonly text:string; readonly section:string; readonly index:number; readonly hash:string }
export interface SourceInsight {
  readonly version:typeof INSIGHT_VERSION; readonly cardId:string; readonly cardHash:string;
  readonly state:'ready'|'unsupported'|'unavailable'; readonly method:'publisher-excerpts';
  readonly sourceUrl:string; readonly checkedAt:string; readonly documentHash:string|null;
  readonly introduction:string; readonly points:readonly SourcePoint[]; readonly availablePoints:number;
  readonly nextStep:string; readonly attribution:string; readonly termsUrl:string; readonly reason:string|null;
}
/** Only reviewed first-party formats; no destination is supplied by the visitor. */
export function insightSupported(card:EvidenceCard):boolean {
  try {
    const u=new URL(card.sourceUrl);
    if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return false;
    if(card.kind==='software-release' && card.version && /^v?\d+\.\d+\.\d+$/u.test(card.version)){
      const repo=card.sourceIds.includes('nodejs')?'nodejs/node':card.sourceIds.includes('nextjs')?'vercel/next.js':null;
      return repo!==null&&u.hostname==='github.com'&&u.pathname===`/${repo}/releases/tag/${card.version}`;
    }
    return card.kind==='publication' && card.sourceIds.some(id=>id==='ecb-statistics'||id==='ecb-news')
      &&u.hostname==='www.ecb.europa.eu'&&/^\/press\/(?:stats\/|pr\/date\/)[A-Za-z0-9_./~-]+\.en\.html$/u.test(u.pathname);
  }catch{return false;}
}
function obj(x:unknown):x is Record<string,unknown>{return x!==null&&typeof x==='object'&&!Array.isArray(x);}
export function validInsight(value:unknown,card:EvidenceCard):value is SourceInsight {
  if(!obj(value)||value.version!==INSIGHT_VERSION||value.cardId!==card.id||value.cardHash!==card.contentHash
    ||value.sourceUrl!==card.sourceUrl||value.method!=='publisher-excerpts'
    ||!['ready','unsupported','unavailable'].includes(String(value.state))
    ||typeof value.checkedAt!=='string'||!Number.isFinite(Date.parse(value.checkedAt))
    ||typeof value.introduction!=='string'||value.introduction.length>1000
    ||typeof value.nextStep!=='string'||value.nextStep.length>1000
    ||typeof value.attribution!=='string'||value.attribution.length>1000
    ||typeof value.termsUrl!=='string'||!Array.isArray(value.points)||value.points.length>3
    ||!Number.isSafeInteger(value.availablePoints)||Number(value.availablePoints)<value.points.length)return false;
  const allowedTerms=['https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html','https://github.com/nodejs/node/blob/main/LICENSE','https://github.com/vercel/next.js/blob/canary/license.md'];
  allowedTerms.push('https://www.nasa.gov/nasa-brand-center/','https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits','https://www.fda.gov/about-fda/about-website/website-policies','https://www.gov.uk/help/terms-conditions','https://globalvoices.org/about/global-voices-attribution-policy/','https://www.eff.org/copyright','https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions');
  if(!allowedTerms.includes(value.termsUrl))return false;
  if(value.state==='ready'&&(value.points.length===0||typeof value.documentHash!=='string'||!/^[a-f0-9]{64}$/u.test(value.documentHash)))return false;
  if(value.state!=='ready'&&value.points.length!==0)return false;
  return value.points.every(p=>obj(p)&&typeof p.text==='string'&&p.text.length>0&&p.text.length<=1000
    &&typeof p.section==='string'&&p.section.length<=120&&Number.isSafeInteger(p.index)&&Number(p.index)>=0
    &&typeof p.hash==='string'&&/^[a-f0-9]{64}$/u.test(p.hash));
}
