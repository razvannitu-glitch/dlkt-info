import {createHash} from 'node:crypto';
import {assertArtifact} from '../edition/artifact.js';
import {artifactHtml,artifactText} from '../edition/render.js';
import type {EditionArtifact} from '../edition/artifact-contracts.js';
const hash=(s:string):string=>createHash('sha256').update(s).digest('hex');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const EMAIL=/^[A-Za-z0-9.!#$%&'*+\/=^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/u;
export interface EmailMessage {
  readonly from:string;readonly to:readonly string[];readonly subject:string;readonly text:string;readonly html:string;
  readonly headers:Readonly<Record<string,string>>;
}
export interface EmailEnvelope {
  readonly version:'dlkt-info-email-envelope-1';readonly ownerId:string;readonly scheduleId:string;readonly localDate:string;
  readonly consentRevision:string;readonly endpointRevision:string;readonly artifactDigest:string;
  readonly idempotencyKey:string;readonly payloadHash:string;readonly message:EmailMessage;
}
/** Call only with a server-verified destination and consent. This function does not send. */
export function buildEmailEnvelope(artifact:EditionArtifact,input:{ownerId:string;scheduleId:string;localDate:string;consentRevision:string;endpointRevision:string;from:string;to:string;unsubscribeUrl:string;allowPartial:boolean}):EmailEnvelope {
  assertArtifact(artifact);
  if(!UUID.test(input.ownerId)||!UUID.test(input.scheduleId)||!UUID.test(input.consentRevision)||!UUID.test(input.endpointRevision)
    ||!/^\d{4}-\d{2}-\d{2}$/u.test(input.localDate)||!Number.isFinite(Date.parse(`${input.localDate}T00:00:00Z`))
    ||new Date(`${input.localDate}T00:00:00Z`).toISOString().slice(0,10)!==input.localDate)throw Error('DISPATCH_IDENTITY_INVALID');
  for(const address of[input.from,input.to])if(address.length>254||!EMAIL.test(address)||/[\r\n]/u.test(address))throw Error('DISPATCH_ADDRESS_INVALID');
  if(!/@(?:[a-z0-9-]+\.)*dlkt\.ee$/iu.test(input.from))throw Error('DISPATCH_SENDER_INVALID');
  const u=new URL(input.unsubscribeUrl);
  if(u.origin!=='https://www.dlkt.ee'||u.username||u.password||u.port||u.search||u.hash||!/^\/unsubscribe\/[A-Za-z0-9_-]{32,200}$/u.test(u.pathname))throw Error('DISPATCH_UNSUBSCRIBE_INVALID');
  if(artifact.edition.state==='unavailable'||!artifact.edition.cards.length)throw Error('DISPATCH_EDITION_UNAVAILABLE');
  if(artifact.edition.state==='partial'&&!input.allowPartial)throw Error('DISPATCH_PARTIAL_NOT_ALLOWED');
  const message:EmailMessage={from:input.from,to:[input.to],subject:`DLKT · ${input.localDate}`,
    text:artifactText(artifact,'email')+`\n\nStop this briefing: ${u.href}`,
    html:artifactHtml(artifact,'email').replace('</footer>',`<p><a href="${u.href}" rel="noopener noreferrer">Stop this briefing</a></p></footer>`),
    headers:{'List-Unsubscribe':`<${u.href}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
  const result:EmailEnvelope={version:'dlkt-info-email-envelope-1',ownerId:input.ownerId,scheduleId:input.scheduleId,localDate:input.localDate,
    consentRevision:input.consentRevision,endpointRevision:input.endpointRevision,artifactDigest:artifact.digest,
    idempotencyKey:`dlkt-edition/${hash(`${input.scheduleId}|${input.localDate}`)}`,payloadHash:hash(JSON.stringify(message)),message};
  Object.freeze(message.to);Object.freeze(message.headers);Object.freeze(message);return Object.freeze(result);
}
export interface DispatchAttempt {
  readonly state:'queued'|'retry'|'accepted'|'delivered'|'cancelled'|'failed'|'manual-review';
  /** Must be committed durably before the first network call, never reset on retries. */
  readonly firstAttemptAt:string;readonly attempt:number;
}
export interface DispatchAuthorization {readonly active:boolean;readonly ownerId:string;readonly consentRevision:string;readonly endpointRevision:string}
export interface DispatchGate {readonly enabled:boolean;readonly dedicatedDatabaseVerified:boolean;readonly durableLeaseVerified:boolean;readonly senderVerified:boolean;readonly unsubscribeVerified:boolean}
export type DispatchResult=
  | {readonly state:'accepted';readonly providerId:string;readonly delivered:false}
  | {readonly state:'retry';readonly code:string;readonly retryAt:string;readonly ambiguous:boolean}
  | {readonly state:'failed'|'manual-review'|'cancelled'|'disabled'|'skipped';readonly code:string};
/** The provider's idempotency window is finite. Ambiguous older attempts need reconciliation. */
export function authorizeAttempt(envelope:EmailEnvelope,attempt:DispatchAttempt,authorization:DispatchAuthorization,gate:DispatchGate,now:number):DispatchResult|null {
  if(!gate.enabled||!gate.dedicatedDatabaseVerified||!gate.durableLeaseVerified||!gate.senderVerified||!gate.unsubscribeVerified)return{state:'disabled',code:'DELIVERY_NOT_ACTIVATED'};
  if(envelope.version!=='dlkt-info-email-envelope-1'||envelope.payloadHash!==hash(JSON.stringify(envelope.message))
    ||envelope.idempotencyKey!==`dlkt-edition/${hash(`${envelope.scheduleId}|${envelope.localDate}`)}`)return{state:'failed',code:'ENVELOPE_INTEGRITY_FAILED'};
  if(!authorization.active||authorization.ownerId!==envelope.ownerId||authorization.consentRevision!==envelope.consentRevision||authorization.endpointRevision!==envelope.endpointRevision)return{state:'cancelled',code:'CONSENT_CHANGED'};
  if(!['queued','retry'].includes(attempt.state))return{state:'skipped',code:'JOB_NOT_SENDABLE'};
  const first=Date.parse(attempt.firstAttemptAt);
  if(!Number.isFinite(now)||!Number.isFinite(first)||first>now||!Number.isSafeInteger(attempt.attempt)||attempt.attempt<1)return{state:'failed',code:'ATTEMPT_INVALID'};
  if(now-first>=23*3_600_000||attempt.attempt>8)return{state:'manual-review',code:'RETRY_SAFETY_WINDOW_EXHAUSTED'};
  return null;
}
export class ResendEditionTransport {
  constructor(private readonly apiKey:string,private readonly request:typeof fetch=fetch){}
  async send(envelope:EmailEnvelope,attempt:DispatchAttempt,authorization:DispatchAuthorization,gate:DispatchGate,now:number):Promise<DispatchResult>{
    const blocked=authorizeAttempt(envelope,attempt,authorization,gate,now);if(blocked)return blocked;
    if(!/^re_[A-Za-z0-9_-]{16,200}$/u.test(this.apiKey))return{state:'disabled',code:'EMAIL_PROVIDER_NOT_CONFIGURED'};
    const retry=(code:string,ambiguous:boolean,seconds=60):DispatchResult=>{
      const retryAt=now+Math.max(seconds,Math.min(3600,30*2**Math.min(attempt.attempt,7)))*1000;
      return retryAt-Date.parse(attempt.firstAttemptAt)>=23*3_600_000?{state:'manual-review',code:'RETRY_SAFETY_WINDOW_EXHAUSTED'}:{state:'retry',code,retryAt:new Date(retryAt).toISOString(),ambiguous};
    };
    try{
      const r=await this.request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json','Idempotency-Key':envelope.idempotencyKey},body:JSON.stringify(envelope.message),redirect:'error',cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(10_000)});
      if(r.status===429||r.status===408||r.status>=500){
        const hint=r.headers.get('retry-after');const seconds=hint&&/^\d+$/u.test(hint)?Number(hint):hint?Math.ceil((Date.parse(hint)-now)/1000):60;
        await r.body?.cancel();return retry(`PROVIDER_HTTP_${r.status}`,r.status!==429,Number.isFinite(seconds)?seconds:60);
      }
      if(r.status===409){await r.body?.cancel();return{state:'manual-review',code:'PROVIDER_IDEMPOTENCY_CONFLICT'};}
      if(!r.ok){await r.body?.cancel();return{state:'failed',code:`PROVIDER_HTTP_${r.status}`};}
      if(!/^application\/json(?:\s*;|$)/iu.test(r.headers.get('content-type')??'')){await r.body?.cancel();return retry('PROVIDER_RECEIPT_INVALID',true);}
      const reader=r.body?.getReader();if(!reader)return retry('PROVIDER_RECEIPT_INVALID',true);
      const parts:Uint8Array[]=[];let size=0;
      try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16_384){await reader.cancel();return retry('PROVIDER_RECEIPT_INVALID',true);}parts.push(chunk.value);}}finally{reader.releaseLock();}
      const value:unknown=JSON.parse(Buffer.concat(parts).toString('utf8'));
      if(value===null||typeof value!=='object'||!('id'in value)||typeof value.id!=='string'||!UUID.test(value.id))return retry('PROVIDER_RECEIPT_INVALID',true);
      return{state:'accepted',providerId:value.id,delivered:false};
    }catch{return retry('PROVIDER_RESULT_UNKNOWN',true);}
  }
}
