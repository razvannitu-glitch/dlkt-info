import {createHash,randomBytes} from 'node:crypto';
import {EditorialConsentLab,EDITORIAL_CONSENT_PURPOSE,EDITORIAL_NOTICE_VERSION} from './editorial-consent.js';
import {EDITORIAL_PILOT_CATEGORIES,type EditorialPilotCategory} from './editorial-pilot.js';
import {EDITORIAL_DAY_MS,editorialDayStart,parseEditorialExposureBatch,type EditorialExposureRow} from './editorial-batch.js';

/** Single-process synthetic reference, not a production authorization/store.
 * No external I/O. Synchronous transitions model one atomic transaction only.
 * Temporary grant-linked vectors are potentially pseudonymous, not anonymous.
 */
export const EDITORIAL_LAB_GRANT_MS=15*60*1000;
export const EDITORIAL_LAB_GRANT_LIMIT=256;
export const EDITORIAL_LAB_ACCEPT_LIMIT=128;
const TOKEN_PREFIX='edlab1.';
const TOKEN=/^edlab1\.[A-Za-z0-9_-]{43}$/u;
type ClosedReason='revoked'|'expired';
interface Contribution {readonly digest:string;readonly rows:readonly EditorialExposureRow[]}
interface ActiveGrant {
 readonly state:'active';readonly consent:EditorialConsentLab;readonly revision:bigint;
 readonly expiresAt:number;contribution:Contribution|null;
}
type Grant=ActiveGrant|{readonly state:'closed';readonly reason:ClosedReason};
export type EditorialWriteResult='accepted'|'duplicate'|'conflicting-replay'|'invalid-batch'|'unknown-grant'|'revoked'|'expired'|'capacity'|'held';
export type EditorialWithdrawResult='withdrawn'|'expired'|'unknown-grant';
export interface EditorialLabGrant {
 readonly token:string;readonly expiresAt:number;
 readonly purpose:typeof EDITORIAL_CONSENT_PURPOSE;readonly noticeVersion:typeof EDITORIAL_NOTICE_VERSION;
 readonly productionActivationAllowed:false;
}
export interface EditorialPendingSnapshot {
 readonly status:'pending-only'|'outside-window'|'held';
 readonly day:string;readonly coverage:'unsealed';
 readonly pendingContributions:number;readonly acceptedInLifetime:number;
 readonly rows:readonly EditorialExposureRow[];
 readonly productionActivationAllowed:false;readonly automationAllowed:false;
}
function hash(domain:string,value:string|Uint8Array):string{return createHash('sha256').update(domain).update('\0').update(value).digest('hex');}
function tokenDigest(value:unknown):string|null{
 if(typeof value!=='string'||!TOKEN.test(value))return null;
 const raw=value.slice(TOKEN_PREFIX.length);
 if(Buffer.from(raw,'base64url').toString('base64url')!==raw)return null;
 return hash('dlkt-editorial-lab-grant-v1',value);
}
function revision(value:EditorialConsentLab):bigint|null{
 try{
  if(!(value instanceof EditorialConsentLab))return null;
  const state=EditorialConsentLab.prototype.snapshot.call(value);
  return state.phase==='granted'&&state.wouldPermitInLab===true&&state.productionActivationAllowed===false&&state.revision>0n?state.revision:null;
 }catch{return null;}
}
export class EditorialTransportLab {
 readonly #start:number;
 readonly #end:number;
 #last:number|null=null;
 #held=false;
 #accepted=0;
 #grants=new Map<string,Grant>();
 #issued=new WeakMap<EditorialConsentLab,bigint>();
 constructor(private readonly day:string,private readonly clock:()=>number=Date.now){
  const start=editorialDayStart(day);if(start===null)throw Error('EDITORIAL_LAB_DAY_INVALID');
  this.#start=start;this.#end=start+EDITORIAL_DAY_MS;
 }
 #refresh():number|null{
  if(this.#held)return null;
  let now:number;
  try{now=this.clock();}catch{now=NaN;}
  if(!Number.isSafeInteger(now)||now<0||(this.#last!==null&&now<this.#last)){
   this.#held=true;this.#grants.clear();return null;
  }
  this.#last=now;
  for(const [key,grant] of this.#grants){
   if(grant.state!=='active')continue;
   if(now>=grant.expiresAt)this.#grants.set(key,{state:'closed',reason:'expired'});
   else if(revision(grant.consent)!==grant.revision)this.#grants.set(key,{state:'closed',reason:'revoked'});
  }
  return now;
 }
 /** Internal synthetic coordinator only. No issuance endpoint or client-provided receipt. */
 issue(consent:EditorialConsentLab):EditorialLabGrant|null{
  const now=this.#refresh(),rev=revision(consent);
  if(now===null||now<this.#start||now>=this.#end||rev===null||this.#issued.get(consent)===rev||this.#grants.size>=EDITORIAL_LAB_GRANT_LIMIT)return null;
  const token=TOKEN_PREFIX+randomBytes(32).toString('base64url'),key=tokenDigest(token);
  if(key===null||this.#grants.has(key))return null;
  const expiresAt=Math.min(now+EDITORIAL_LAB_GRANT_MS,this.#end);
  this.#grants.set(key,{state:'active',consent,revision:rev,expiresAt,contribution:null});
  this.#issued.set(consent,rev);
  return {token,expiresAt,purpose:EDITORIAL_CONSENT_PURPOSE,noticeVersion:EDITORIAL_NOTICE_VERSION,productionActivationAllowed:false};
 }
 ingest(token:unknown,bytes:unknown):EditorialWriteResult{
  const now=this.#refresh();if(now===null)return 'held';
  const key=tokenDigest(token);if(key===null)return 'unknown-grant';
  const grant=this.#grants.get(key);if(!grant)return 'unknown-grant';
  if(grant.state==='closed')return grant.reason;
  const value=parseEditorialExposureBatch(bytes);
  if(!value||!(bytes instanceof Uint8Array)||value.day!==this.day||now<this.#start||now>=this.#end)return 'invalid-batch';
  const digest=hash('dlkt-editorial-lab-batch-v1',bytes);
  if(grant.contribution)return grant.contribution.digest===digest?'duplicate':'conflicting-replay';
  if(this.#accepted>=EDITORIAL_LAB_ACCEPT_LIMIT)return 'capacity';
  // No await between grant/revision/expiry check and the sole contribution write.
  grant.contribution={digest,rows:value.rows};this.#accepted++;
  return 'accepted';
 }
 /** Revocation must remain possible without a valid clock or collection readiness.
  * Only a known token can confirm the local laboratory's cleanup. */
 withdraw(token:unknown):EditorialWithdrawResult{
  const key=tokenDigest(token);if(key===null)return 'unknown-grant';
  const grant=this.#grants.get(key);if(!grant)return 'unknown-grant';
  if(grant.state==='closed')return grant.reason==='expired'?'expired':'withdrawn';
  this.#grants.set(key,{state:'closed',reason:'revoked'});
  return 'withdrawn';
 }
 inspect():EditorialPendingSnapshot{
  const now=this.#refresh();
  const status=now===null?'held':now<this.#start||now>=this.#end?'outside-window':'pending-only';
  const sums=new Map<EditorialPilotCategory,number>();let pendingContributions=0;
  if(status==='pending-only'){
   for(const grant of this.#grants.values()){
    if(grant.state!=='active'||!grant.contribution)continue;
    pendingContributions++;
    for(const row of grant.contribution.rows)sums.set(row.category,(sums.get(row.category)??0)+row.qualifiedImpressions);
   }
  }
  return {status,day:this.day,coverage:'unsealed',pendingContributions,acceptedInLifetime:this.#accepted,
   rows:status==='pending-only'?EDITORIAL_PILOT_CATEGORIES.map(category=>({category,qualifiedImpressions:sums.get(category)??0})):[],
   productionActivationAllowed:false,automationAllowed:false};
 }
}
