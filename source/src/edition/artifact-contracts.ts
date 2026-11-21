import type {Edition} from './contracts.js';
import type {SourceInsight} from '../iceo/insight-contracts.js';
import {validInsight} from '../iceo/insight-contracts.js';
import {validCard} from '../iceo/card-validation.js';
import {validSettings} from '../iceo/device-memory.js';
export const ARTIFACT_VERSION='dlkt-info-edition-artifact-1' as const;
export interface EditionArtifact {
  readonly version:typeof ARTIFACT_VERSION;
  readonly edition:Edition;
  readonly insights:readonly SourceInsight[];
  readonly digest:string;
}
const obj=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const instant=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/u.test(v)&&Number.isFinite(Date.parse(v));
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
/** Untrusted persisted/transported artifacts must be checked before rendering or sending. */
export function validArtifact(v:unknown):v is EditionArtifact {
  if(!obj(v)||v.version!==ARTIFACT_VERSION||!hash(v.digest)||!obj(v.edition)||!Array.isArray(v.insights))return false;
  const e=v.edition;
  if(e.version!=='dlkt-info-edition-1'||e.kind!=='current-source-selection'||!hash(e.id)||!instant(e.generatedAt)||!instant(e.sourceCheckAt)
    ||!['ready','partial','empty','unavailable'].includes(String(e.state))||e.persisted!==false||e.delivered!==false
    ||!validSettings(e.settings)||e.settings.mode!=='briefing'||e.settings.topics.length===0
    ||!Array.isArray(e.cards)||e.cards.length>5000||e.cards.length>e.settings.budget||!e.cards.every(validCard)
    ||new Set(e.cards.map(c=>c.id)).size!==e.cards.length||e.cards.length!==v.insights.length
    ||!count(e.availableGroups)||e.availableGroups<e.cards.length||!count(e.excludedNotices)||!count(e.excludedStale)
    ||!Array.isArray(e.sourceChecks)||e.sourceChecks.length>100||!e.sourceChecks.every(s=>obj(s)&&typeof s.id==='string'&&s.id.length<=80&&['verified','partial','stale','unavailable'].includes(String(s.state))&&(s.verifiedAt===null||instant(s.verifiedAt))))return false;
  if((e.state==='unavailable'||e.state==='empty')&&e.cards.length!==0)return false;
  if(e.state==='ready'&&e.cards.length===0)return false;
  const cards=e.cards,generatedAt=e.generatedAt;
  return v.insights.every((item,index)=>{
    const card=cards[index];
    if(!card||!validInsight(item,card))return false;
    if(item.points.reduce((n,p)=>n+p.text.length,0)>2000)return false;
    return Date.parse(item.checkedAt)<=Date.parse(generatedAt)+300_000
      &&(item.state!=='ready'||Date.parse(item.checkedAt)>=Date.parse(generatedAt)-3_600_000);
  });
}
/** This is the exact body covered by the transport fingerprint, not a digital signature. */
export function artifactBody(a:EditionArtifact):string {
  return JSON.stringify({version:a.version,edition:a.edition,insights:a.insights});
}
export async function verifyBrowserArtifact(value:unknown):Promise<EditionArtifact|null> {
  if(!validArtifact(value))return null;
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(artifactBody(value))))).map(b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==value.digest)return null;
  for(const insight of value.insights)for(const p of insight.points){
    const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p.text)))).map(b=>b.toString(16).padStart(2,'0')).join('');
    if(actual!==p.hash)return null;
  }
  return value;
}
