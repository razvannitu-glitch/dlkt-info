import {randomUUID} from 'node:crypto';
import {isUuid} from '../data/guards.js';
import {isAccessToken} from '../identity/guards.js';
import type {ReadyPersistenceConfiguration} from '../persistence/contracts.js';
import {ACCOUNT_VERSION,ACCOUNT_MEMORY_KEY,ACCOUNT_MAX_BYTES,isObject,isRevision,parseAccountValue,parseAccountState,type AccountValue,type AccountState} from './contracts.js';
import {boundedJson} from './http.js';
/** Uses only the authenticated user's token. RLS remains active for every operation. */
export class AccountStore{
 constructor(private readonly config:ReadyPersistenceConfiguration,private readonly userId:string,private readonly token:string,private readonly request:typeof fetch=fetch,private readonly clock:()=>number=Date.now){if(!isUuid(userId)||!isAccessToken(token))throw Error('ACCOUNT_SESSION_INVALID');}
 private url(revision?:string):string{
  const u=new URL('/rest/v1/dlkt_info_user_memory',this.config.url);u.searchParams.set('select','owner_id,memory_key,memory_type,state');u.searchParams.set('owner_id',`eq.${this.userId}`);u.searchParams.set('memory_key',`eq.${ACCOUNT_MEMORY_KEY}`);u.searchParams.set('memory_type','eq.preference');
  if(revision!==undefined){if(!isRevision(revision))throw Error('ACCOUNT_REVISION_INVALID');u.searchParams.set('state->>revision',`eq.${revision}`);}return u.href;
 }
 private async call(method:string,url:string,data?:unknown):Promise<readonly AccountState[]>{
  const r=await this.request(url,{method,headers:{Accept:'application/json','Content-Type':'application/json',apikey:this.config.publishableKey,Authorization:`Bearer ${this.token}`,Prefer:'return=representation'},...(data===undefined?{}:{body:JSON.stringify(data)}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});
  if(!r.ok){await r.body?.cancel();throw Error(r.status===409?'ACCOUNT_CONFLICT':r.status===401?'ACCOUNT_SESSION_INVALID':r.status===403?'ACCOUNT_FORBIDDEN':'ACCOUNT_UPSTREAM_UNAVAILABLE');}
  const rows=await boundedJson(r,ACCOUNT_MAX_BYTES+65_536);
  if(!Array.isArray(rows)||rows.length>1)throw Error('ACCOUNT_UPSTREAM_INVALID');
  return rows.map((row:unknown)=>{if(!isObject(row)||row.owner_id!==this.userId||row.memory_key!==ACCOUNT_MEMORY_KEY||row.memory_type!=='preference')throw Error('ACCOUNT_OWNER_MISMATCH');return parseAccountState(row.state);});
 }
 async read():Promise<AccountState|null>{const rows=await this.call('GET',this.url());return rows[0]??null;}
 async save(value:AccountValue,expectedRevision:string|null):Promise<AccountState>{
  const canonical=parseAccountValue(value);if(expectedRevision!==null&&!isRevision(expectedRevision))throw Error('ACCOUNT_REVISION_INVALID');
  const state:AccountState={version:ACCOUNT_VERSION,revision:randomUUID(),updatedAt:new Date(this.clock()).toISOString(),value:canonical};
  const insert={owner_id:this.userId,memory_key:ACCOUNT_MEMORY_KEY,memory_type:'preference',state};
  const rows=await this.call(expectedRevision===null?'POST':'PATCH',this.url(expectedRevision??undefined),expectedRevision===null?insert:{state});
  if(!rows[0])throw Error('ACCOUNT_CONFLICT');
  if(JSON.stringify(rows[0])!==JSON.stringify(state))throw Error('ACCOUNT_WRITE_NOT_CONFIRMED');
  return rows[0];
 }
 async remove(expectedRevision:string):Promise<void>{const rows=await this.call('DELETE',this.url(expectedRevision));if(rows.length!==1)throw Error('ACCOUNT_CONFLICT');}
}
