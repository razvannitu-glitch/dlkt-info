import {EDITORIAL_PILOT_CATEGORIES,type EditorialPilotCategory} from '../../source/.build/src/audience/editorial-pilot.js';
import {EDITORIAL_BATCH_SCOPE,editorialDayStart,EDITORIAL_DAY_MS} from '../../source/.build/src/audience/editorial-batch.js';
import {NEWS_TAXONOMY_VERSION} from '../../source/.build/src/iceo/news-taxonomy.js';
import {EDITORIAL_LAB_ACCEPT_LIMIT} from '../../source/.build/src/audience/editorial-transport.js';
import {EDITORIAL_DOCUMENT_LIMIT} from '../../source/.build/src/audience/editorial-exposure.js';

const MINUTE=60_000,MAX_TOTAL=EDITORIAL_LAB_ACCEPT_LIMIT*EDITORIAL_DOCUMENT_LIMIT;
const VERSION='dlkt-editorial-daily-lab-1';
const COVERAGE='observed-documents-only';
type Reason='pending'|'suppressed'|'expired'|'held'|'invalid-readback'|'provider-unavailable';
interface Row {
 readonly category:EditorialPilotCategory;readonly qualifiedImpressions:number;
}
export type DailyControlLab=
 |{readonly status:'unavailable';readonly reason:Reason;readonly productionActivationAllowed:false;readonly automationAllowed:false}
 |{readonly status:'sealed-lab';readonly day:string;readonly sealedAt:string;readonly coverage:typeof COVERAGE;readonly rows:readonly Row[];readonly productionActivationAllowed:false;readonly automationAllowed:false};
function object(value:unknown):Record<string,unknown>|null{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function exact(v:Record<string,unknown>,keys:string):boolean{return Object.keys(v).sort().join(',')===keys;}
function unavailable(reason:Reason):DailyControlLab{return {status:'unavailable',reason,productionActivationAllowed:false,automationAllowed:false};}
function sealTime(value:unknown):number|null{
 // The SQL fixture emits six UTC fractional digits. Parse the millisecond
 // part canonically; preserve the exact timestamp string in the projection.
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value))return null;
 const ms=value.slice(0,23)+'Z',n=Date.parse(ms);
 return Number.isSafeInteger(n)&&new Date(n).toISOString()===ms?n:null;
}
/** Authenticated fixture transport only. No provider or host is configured here.
 * Identity fields and payload must be selected by a single trusted committed
 * statement. An envelope is NOT independent evidence of the provider's honesty.
 * Post-seal contributor support cannot be recomputed after vector deletion.
 */
export async function readDailyControlLab(day:string,now:number,call:()=>Promise<unknown>):Promise<DailyControlLab>{
 const start=editorialDayStart(day);
 if(start===null||!Number.isSafeInteger(now)||now<start)return unavailable('invalid-readback');
 let raw:unknown;try{raw=await call();}catch{return unavailable('provider-unavailable');}
 const envelope=object(raw);
 if(!envelope||!exact(envelope,'currentUser,database,result,sessionUser')||
  envelope.database!=='editorial_transport_test'||envelope.sessionUser!=='dlkt_et_observer'||envelope.currentUser!=='dlkt_et_observer')return unavailable('invalid-readback');
 const v=object(envelope.result);
 if(!v||!exact(v,'automationAllowed,coverage,day,productionActivationAllowed,rows,scope,sealedAt,status,taxonomyVersion,version')||
  v.day!==day||v.version!==VERSION||v.scope!==EDITORIAL_BATCH_SCOPE||v.taxonomyVersion!==NEWS_TAXONOMY_VERSION||
  v.coverage!==COVERAGE||v.productionActivationAllowed!==false||v.automationAllowed!==false||!Array.isArray(v.rows))return unavailable('invalid-readback');
 const end=start+EDITORIAL_DAY_MS;
 if(v.status==='pending'||v.status==='held'||v.status==='expired'){
  if(v.rows.length!==0||v.sealedAt!==null||(v.status==='pending'&&now>=end+20*MINUTE)||(v.status==='expired'&&now<end+20*MINUTE))return unavailable('invalid-readback');
  return unavailable(v.status);
 }
 if(v.status!=='sealed-lab'&&v.status!=='suppressed')return unavailable('invalid-readback');
 const at=sealTime(v.sealedAt);
 if(at===null||at<end+15*MINUTE||at>=end+20*MINUTE||at>now||now>=end+EDITORIAL_DAY_MS)return unavailable('invalid-readback');
 if(v.status==='suppressed')return v.rows.length===0?unavailable('suppressed'):unavailable('invalid-readback');
 if(v.rows.length!==EDITORIAL_PILOT_CATEGORIES.length||typeof v.sealedAt!=='string')return unavailable('invalid-readback');
 const rows:Row[]=[];let total=0;
 for(const [index,category] of EDITORIAL_PILOT_CATEGORIES.entries()){
  const row=object(v.rows[index]);
  if(!row||!exact(row,'category,qualifiedImpressions')||row.category!==category||
   typeof row.qualifiedImpressions!=='number'||!Number.isSafeInteger(row.qualifiedImpressions)||
   row.qualifiedImpressions<100||row.qualifiedImpressions>MAX_TOTAL)return unavailable('invalid-readback');
  total+=row.qualifiedImpressions;rows.push({category,qualifiedImpressions:row.qualifiedImpressions});
 }
 if(total>MAX_TOTAL)return unavailable('invalid-readback');
 return {status:'sealed-lab',day,sealedAt:v.sealedAt,coverage:COVERAGE,rows,productionActivationAllowed:false,automationAllowed:false};
}
