import {createHash} from 'node:crypto';
import {readPersistenceConfiguration} from '../persistence/config.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import type {IceoSnapshot} from './contracts.js';

export const CONTINUOUS_REFRESH_INTERVAL_MS = 120_000;
export const CONTINUOUS_REFRESH_DEADLINE_MS = 45_000;
export const REFRESH_LEDGER_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 1_150_000;
const WRITER_KEY = /^[A-Za-z0-9_-]{43,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const HASH = /^[a-f0-9]{64}$/u;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value,key));
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/u.test(value) && value.length <= 40 && Number.isFinite(Date.parse(value));
const nullableTime = (value: unknown): value is string | null => value === null || timestamp(value);

export type RefreshTrigger = {readonly kind: 'manual'} | {
  readonly kind: 'scheduled'; readonly executionId: string; readonly scheduleName: 'iceo-daily-top';
  readonly scheduledAt: string; readonly namespace: 'default'; readonly expression: '*/2 * * * *';
};
export interface SharedSnapshotEnvelope {
  readonly version: 'iceo-shared-snapshot-1'; readonly snapshot: unknown | null; readonly digest: string | null;
  readonly revision: number; readonly refreshedAt: string | null; readonly lastAttemptAt: string | null;
  readonly lastScheduledAttemptAt: string | null; readonly lastScheduledSuccessAt: string | null;
  readonly status: 'empty' | 'ready' | 'refreshing' | 'backoff'; readonly retryAt: string | null;
}
export interface RefreshClaim {
  readonly version: 'iceo-refresh-claim-1'; readonly state: 'claimed' | 'busy' | 'complete' | 'backoff';
  readonly slot: number; readonly fence: number; readonly leaseToken: string | null;
  readonly leaseExpiresAt: string | null; readonly retryAt: string | null;
}
export type RefreshFailure = 'collector-unavailable' | 'invalid-snapshot' | 'publish-unavailable' | 'timeout';
export interface RefreshLedger {
  readonly writable: boolean;
  read(): Promise<SharedSnapshotEnvelope>;
  claim(workerId: string, trigger: RefreshTrigger): Promise<RefreshClaim>;
  publish(claim: RefreshClaim, snapshot: IceoSnapshot, digest: string): Promise<SharedSnapshotEnvelope>;
  fail(claim: RefreshClaim, error: RefreshFailure): Promise<{readonly recorded: boolean; readonly retryAt: string | null}>;
}

/** Database JSONB may reorder object keys. Array order and every public value remain significant. */
export function publicSnapshotDigest(value: unknown): string {
  const canonical = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(canonical);
    if (object(entry)) return Object.fromEntries(Object.keys(entry).sort().map(key => [key,canonical(entry[key])]));
    return entry;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export function validRefreshTrigger(value: unknown, now: number): value is RefreshTrigger {
  if (!object(value)) return false;
  if (value.kind === 'manual') return exact(value,['kind']);
  return value.kind === 'scheduled' && exact(value,['kind','executionId','scheduleName','scheduledAt','namespace','expression'])
    && typeof value.executionId === 'string' && /^[A-Za-z0-9_.:/-]{1,160}$/u.test(value.executionId)
    && value.scheduleName === 'iceo-daily-top' && value.namespace === 'default' && value.expression === '*/2 * * * *'
    && timestamp(value.scheduledAt) && Date.parse(value.scheduledAt) <= now + 60_000 && Date.parse(value.scheduledAt) >= now - 600_000;
}

export function validSharedEnvelope(value: unknown): value is SharedSnapshotEnvelope {
  return object(value) && exact(value,['version','snapshot','digest','revision','refreshedAt','lastAttemptAt','lastScheduledAttemptAt','lastScheduledSuccessAt','status','retryAt'])
    && value.version === 'iceo-shared-snapshot-1' && integer(value.revision)
    && (value.digest === null || typeof value.digest === 'string' && HASH.test(value.digest))
    && nullableTime(value.refreshedAt) && nullableTime(value.lastAttemptAt) && nullableTime(value.lastScheduledAttemptAt)
    && nullableTime(value.lastScheduledSuccessAt) && nullableTime(value.retryAt)
    && ['empty','ready','refreshing','backoff'].includes(String(value.status))
    && (value.status !== 'empty' || value.snapshot === null) && (value.status !== 'ready' || value.snapshot !== null)
    && (value.snapshot === null ? value.digest === null && value.refreshedAt === null && value.revision === 0
      : object(value.snapshot) && value.digest !== null && value.refreshedAt !== null && value.revision > 0);
}
function validClaim(value: unknown): value is RefreshClaim {
  return object(value) && exact(value,['version','state','slot','fence','leaseToken','leaseExpiresAt','retryAt'])
    && value.version === 'iceo-refresh-claim-1' && ['claimed','busy','complete','backoff'].includes(String(value.state))
    && integer(value.slot) && integer(value.fence) && nullableTime(value.leaseExpiresAt) && nullableTime(value.retryAt)
    && (value.state === 'claimed' ? typeof value.leaseToken === 'string' && UUID.test(value.leaseToken) && value.leaseExpiresAt !== null && value.fence > 0 : value.leaseToken === null);
}

export class RefreshLedgerError extends Error {
  constructor(readonly code: 'REFRESH_LEDGER_UNAVAILABLE' | 'REFRESH_LEDGER_INVALID') {super(code);this.name='RefreshLedgerError';}
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    await response.body?.cancel(); throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');
  }
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d+$/u.test(length)||Number(length)>MAX_RESPONSE_BYTES)){await response.body?.cancel();throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');}
  const reader=response.body?.getReader(); if(!reader)throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');
  const parts:Uint8Array[]=[];let bytes=0;
  const abort=():void=>{void reader.cancel().catch(()=>undefined);};signal.addEventListener('abort',abort,{once:true});
  try{
    for(;;){if(signal.aborted)throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');const next=await reader.read();if(next.done)break;
      bytes+=next.value.byteLength;if(bytes>MAX_RESPONSE_BYTES){await reader.cancel();throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');}parts.push(next.value);}
    if(signal.aborted)throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  }finally{signal.removeEventListener('abort',abort);reader.releaseLock();}
}

/** Existing, purpose-bound writer credential only. No user token or service-role key enters these calls. */
export function createRefreshLedger(environment: Readonly<Record<string,string|undefined>>, fetcher: PersistenceFetch=fetch): RefreshLedger | null {
  const configuration=readPersistenceConfiguration(environment);if(configuration.state!=='ready')return null;
  const publishableKey=configuration.publishableKey;
  const supplied=environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
  const writer=typeof supplied==='string'&&WRITER_KEY.test(supplied)?supplied:null;
  const base=new URL('/rest/v1/rpc/',configuration.url);
  async function rpc(name: string, args: Readonly<Record<string,unknown>>, mutation=false): Promise<unknown>{
    if(mutation&&writer===null)throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');
    const body=JSON.stringify(args);if(Buffer.byteLength(body,'utf8')>MAX_RESPONSE_BYTES)throw new RefreshLedgerError('REFRESH_LEDGER_INVALID');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE'));},REFRESH_LEDGER_TIMEOUT_MS);});
    try{
      const pending=(async():Promise<unknown>=>{
        const response=await fetcher(new URL(name,base),{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal,
          headers:{apikey:publishableKey,Accept:'application/json','Content-Type':'application/json',...(mutation?{'x-dlkt-share-write':writer as string}:{})},body});
        if(controller.signal.aborted){void response.body?.cancel().catch(()=>undefined);throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');}
        return responseJson(response,controller.signal);
      })();return await Promise.race([pending,timeout]);
    }catch{throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');}finally{clearTimeout(timer);controller.abort();}
  }
  const envelope=(value:unknown):SharedSnapshotEnvelope=>{if(!validSharedEnvelope(value))throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');return value;};
  const assertedLease=(claim:RefreshClaim):void=>{if(!validClaim(claim)||claim.state!=='claimed')throw new RefreshLedgerError('REFRESH_LEDGER_INVALID');};
  return Object.freeze({
    writable:writer!==null,
    async read(){return envelope(await rpc('dlkt_info_read_public_snapshot',{}));},
    async claim(workerId:string,trigger:RefreshTrigger){
      if(!UUID.test(workerId)||!validRefreshTrigger(trigger,Date.now()))throw new RefreshLedgerError('REFRESH_LEDGER_INVALID');
      const value=await rpc('dlkt_info_claim_public_refresh',{p_worker_id:workerId,p_trigger:trigger},true);
      if(!validClaim(value))throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');return value;
    },
    async publish(claim:RefreshClaim,snapshot:IceoSnapshot,digest:string){
      assertedLease(claim);
      if(!HASH.test(digest)||Buffer.byteLength(JSON.stringify(snapshot),'utf8')>1_048_576||publicSnapshotDigest(snapshot)!==digest)throw new RefreshLedgerError('REFRESH_LEDGER_INVALID');
      return envelope(await rpc('dlkt_info_publish_public_snapshot',{p_lease_token:claim.leaseToken,p_fence:claim.fence,p_snapshot:snapshot,p_digest:digest},true));
    },
    async fail(claim:RefreshClaim,error:RefreshFailure){
      assertedLease(claim);if(!['collector-unavailable','invalid-snapshot','publish-unavailable','timeout'].includes(error))throw new RefreshLedgerError('REFRESH_LEDGER_INVALID');
      const value=await rpc('dlkt_info_fail_public_refresh',{p_lease_token:claim.leaseToken,p_fence:claim.fence,p_error:error},true);
      if(!object(value)||!exact(value,['recorded','retryAt'])||typeof value.recorded!=='boolean'||!nullableTime(value.retryAt))throw new RefreshLedgerError('REFRESH_LEDGER_UNAVAILABLE');
      return {recorded:value.recorded,retryAt:value.retryAt};
    },
  });
}
