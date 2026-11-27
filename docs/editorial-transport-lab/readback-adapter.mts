import {parseEditorialExposureBatch,editorialDayStart,type EditorialExposureBatch} from '../../source/.build/src/audience/editorial-batch.js';
import {EDITORIAL_DOCUMENT_LIMIT} from '../../source/.build/src/audience/editorial-exposure.js';
import {EDITORIAL_LAB_ACCEPT_LIMIT,type EditorialWriteResult,type EditorialWithdrawResult} from '../../source/.build/src/audience/editorial-transport.js';

const DB='editorial_transport_test';
const DIGEST=/^[a-f0-9]{64}$/u;
type Command=
 |{readonly kind:'ingest';readonly digest:string;readonly batch:EditorialExposureBatch}
 |{readonly kind:'withdraw';readonly digest:string}
 |{readonly kind:'inspect'};
/** Trusted laboratory connection boundary only. The wrapper must execute the
 * selected fixed operation and identity projection in one authenticated DB call.
 * The shape of a receipt is not independent proof of a transport's honesty. */
export type LabCall=(command:Command)=>Promise<unknown>;
type WriteOutcome=EditorialWriteResult|'indeterminate';
type WithdrawOutcome=EditorialWithdrawResult|'indeterminate';
type Reason='unsealed'|'held'|'outside-window'|'invalid-readback'|'provider-unavailable';
export interface ControlBoundary {
 readonly status:'unavailable';readonly reason:Reason;
 readonly productionActivationAllowed:false;readonly automationAllowed:false;
}
function object(v:unknown):Record<string,unknown>|null{
 return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
}
function exact(v:Record<string,unknown>,keys:string):boolean{return Object.keys(v).sort().join(',')===keys;}
function receipt(value:unknown,role:'dlkt_et_writer'|'dlkt_et_observer'):unknown{
 const v=object(value);
 if(!v||!exact(v,'currentUser,database,result,sessionUser')||v.database!==DB||v.sessionUser!==role||v.currentUser!==role)throw Error('LAB_RECEIPT_INVALID');
 return v.result;
}
const writes:ReadonlySet<string>=new Set(['accepted','duplicate','conflicting-replay','invalid-batch','unknown-grant','revoked','expired','capacity','held']);
const withdrawals:ReadonlySet<string>=new Set(['withdrawn','expired','unknown-grant']);
function validDigest(value:unknown):value is string{return typeof value==='string'&&DIGEST.test(value);}
function count(value:unknown,max:number):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;}
function unavailable(reason:Reason):ControlBoundary{return {status:'unavailable',reason,productionActivationAllowed:false,automationAllowed:false};}
/** Validate the inspector's *unsealed* diagnostic, never return its quantities.
 * The accepted-grant count is not a count of persons, devices or readers. */
function readback(value:unknown,day:string):ControlBoundary{
 const v=object(value);
 if(!v||!exact(v,'acceptedInLifetime,automationAllowed,counts,coverage,day,pendingContributions,productionActivationAllowed,status')
  ||v.day!==day||v.coverage!=='unsealed'||v.productionActivationAllowed!==false||v.automationAllowed!==false
  ||!count(v.acceptedInLifetime,EDITORIAL_LAB_ACCEPT_LIMIT)||!count(v.pendingContributions,v.acceptedInLifetime)
  ||!Array.isArray(v.counts))return unavailable('invalid-readback');
 if(v.status==='held'||v.status==='outside-window'){
  return v.pendingContributions===0&&v.counts.length===0?unavailable(v.status):unavailable('invalid-readback');
 }
 if(v.status!=='pending-only'||v.counts.length!==5)return unavailable('invalid-readback');
 const max=v.pendingContributions*EDITORIAL_DOCUMENT_LIMIT;
 let total=0;
 for(const raw of v.counts as unknown[]){
  if(!count(raw,max))return unavailable('invalid-readback');
  total+=raw;
 }
 if(total<v.pendingContributions||total>max)return unavailable('invalid-readback');
 return unavailable('unsealed');
}
/** Disconnected adapter: pre-issued synthetic digest only, no grant issuance,
 * cookies, account access, network configuration or public route. */
export function createEditorialReadbackLab(day:string,call:LabCall){
 if(editorialDayStart(day)===null)throw Error('LAB_DAY_INVALID');
 return {
  async submit(digest:unknown,bytes:unknown):Promise<WriteOutcome>{
   if(!validDigest(digest))return 'unknown-grant';
   const batch=parseEditorialExposureBatch(bytes);
   if(!batch||batch.day!==day)return 'invalid-batch';
   try{
    const v=receipt(await call({kind:'ingest',digest,batch}),'dlkt_et_writer');
    return typeof v==='string'&&writes.has(v)?v as EditorialWriteResult:'indeterminate';
   }catch{return 'indeterminate';}
  },
  async withdraw(digest:unknown):Promise<WithdrawOutcome>{
   if(!validDigest(digest))return 'unknown-grant';
   try{
    const v=receipt(await call({kind:'withdraw',digest}),'dlkt_et_writer');
    return typeof v==='string'&&withdrawals.has(v)?v as EditorialWithdrawResult:'indeterminate';
   }catch{return 'indeterminate';}
  },
  async controlBoundary():Promise<ControlBoundary>{
   let value:unknown;
   try{value=await call({kind:'inspect'});}catch{return unavailable('provider-unavailable');}
   try{return readback(receipt(value,'dlkt_et_observer'),day);}catch{return unavailable('invalid-readback');}
  },
 };
}
