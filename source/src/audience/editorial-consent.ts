/**
 * Disconnected editorial consent state machine. No browser APIs, persistence,
 * network transport or production authorization. A local revision only
 * correlates synthetic commands; it is not a token or a cross-tab/server lease.
 */
export const EDITORIAL_CONSENT_PURPOSE='editorial-interactions' as const;
export const EDITORIAL_NOTICE_VERSION='dlkt-editorial-notice-lab-1' as const;
export type EditorialConsentPhase='off'|'grant-pending'|'granted'|'withdrawal-pending'|'denied';
type Operation='grant'|'withdraw';
export interface EditorialConsentCommand {
 readonly purpose:typeof EDITORIAL_CONSENT_PURPOSE;
 readonly noticeVersion:typeof EDITORIAL_NOTICE_VERSION;
 readonly operation:Operation;
 readonly revision:bigint;
}
export interface EditorialConsentSnapshot {
 readonly phase:EditorialConsentPhase;
 readonly revision:bigint;
 readonly wouldPermitInLab:boolean;
 readonly productionActivationAllowed:false;
}
function record(value:unknown):Record<string,unknown>|null{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function keys(value:Record<string,unknown>,expected:string):boolean{
 return Object.keys(value).sort().join(',')===expected;
}
function openGate(value:unknown):boolean{
 const data=record(value);
 return !!data&&keys(data,'doNotTrack,globalPrivacyControl,noticeVersion,operationalReady')
  &&data.operationalReady===true&&data.globalPrivacyControl===false&&data.doNotTrack===false
  &&data.noticeVersion===EDITORIAL_NOTICE_VERSION;
}
function explicitChoice(value:unknown):boolean{
 const data=record(value);
 return !!data&&keys(data,'choice,noticeVersion,purpose')
  &&data.choice==='allow'&&data.purpose===EDITORIAL_CONSENT_PURPOSE
  &&data.noticeVersion===EDITORIAL_NOTICE_VERSION;
}
function matchesReceipt(value:unknown,operation:Operation,revision:bigint):boolean{
 const data=record(value);
 return !!data&&keys(data,'noticeVersion,operation,purpose,result,revision')
  &&data.purpose===EDITORIAL_CONSENT_PURPOSE&&data.noticeVersion===EDITORIAL_NOTICE_VERSION
  &&data.operation===operation&&data.revision===revision
  &&data.result===(operation==='grant'?'granted':'withdrawn');
}

/**
 * A synthetic coordinator must acknowledge an explicit purpose-specific
 * request. In production, a separate trusted coordinator must authenticate
 * and serialize grant/revoke operations, fence in-flight ingestion and
 * confirm cleanup. These local transitions do not establish those guarantees.
 */
export class EditorialConsentLab {
 #phase:EditorialConsentPhase='off';
 #revision=0n;
 #gate=false;

 snapshot():EditorialConsentSnapshot{
  return {phase:this.#phase,revision:this.#revision,
   wouldPermitInLab:this.#gate&&this.#phase==='granted',productionActivationAllowed:false};
 }
 #command(operation:Operation):EditorialConsentCommand{
  return {purpose:EDITORIAL_CONSENT_PURPOSE,noticeVersion:EDITORIAL_NOTICE_VERSION,
   operation,revision:this.#revision};
 }
 #beginWithdrawal():EditorialConsentCommand{
  this.#revision+=1n;
  this.#phase='withdrawal-pending';
  return this.#command('withdraw');
 }
 /** Unknown privacy state, changed notice or lost readiness closes the gate.
  * Reopening it never resurrects a grant or authorizes automatic retry. */
 observeContext(context:unknown):EditorialConsentCommand|null{
  this.#gate=openGate(context);
  if(!this.#gate&&(this.#phase==='grant-pending'||this.#phase==='granted'))return this.#beginWithdrawal();
  return null;
 }
 /** Only an explicit editorial choice, not general audience consent, can start a grant. */
 requestGrant(choice:unknown):EditorialConsentCommand|null{
  if(!this.#gate||!explicitChoice(choice)||(this.#phase!=='off'&&this.#phase!=='denied'))return null;
  this.#revision+=1n;
  this.#phase='grant-pending';
  return this.#command('grant');
 }
 /** Caller must supply the synthetic coordinator receipt, never a UI choice. */
 acknowledge(receipt:unknown):boolean{
  if(this.#phase==='grant-pending'&&this.#gate&&matchesReceipt(receipt,'grant',this.#revision)){
   this.#phase='granted';return true;
  }
  if(this.#phase==='withdrawal-pending'&&matchesReceipt(receipt,'withdraw',this.#revision)){
   this.#phase='denied';return true;
  }
  return false;
 }
 /** Timeout, lost response or invalid receipt for the active grant attempt:
  * a server might already have accepted it, so cleanup must be confirmed. */
 grantUncertain(revision:bigint):EditorialConsentCommand|null{
  return this.#phase==='grant-pending'&&revision===this.#revision?this.#beginWithdrawal():null;
 }
 /** Stop synchronously. A failed cleanup stays pending; retry is idempotent.
  * With no requested grant there is no remote operation in this lab. */
 requestWithdrawal():EditorialConsentCommand|null{
  if(this.#phase==='withdrawal-pending')return this.#command('withdraw');
  if(this.#phase==='grant-pending'||this.#phase==='granted')return this.#beginWithdrawal();
  this.#phase='denied';return null;
 }
}
