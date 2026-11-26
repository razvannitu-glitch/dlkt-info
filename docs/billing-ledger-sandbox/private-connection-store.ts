// Isolated adapter candidate, not instantiated by any deployed endpoint.
import {isRecord,isUuid} from '../../source/src/data/guards.js';
import {isAccessToken} from '../../source/src/identity/guards.js';
import type {ResolvedIdentitySession} from '../../source/src/identity/contracts.js';
import {verifiedSessionHash} from '../../source/src/connections/crypto.js';
import type {ConnectionStore,StoredConnection,PendingAuthorization} from '../../source/src/connections/types.js';
import {isWalletProviderId,type WalletProviderId} from '../../source/src/wallet/providers.js';

/** The implementation must use a dedicated TLS database connection with the
 * machine-only vault role, bounded statement deadline and parameter binding.
 * No browser, PostgREST, generic service key, or dynamic SQL is permitted.
 * This lab does not provision the connection or its credentials.
 */
export interface VaultQuery {
  query(sql:string,params:readonly (string|null)[]):Promise<unknown>;
}
const invalid=():never=>{throw Error('CONNECTION_UPSTREAM_INVALID');};
const badSession=():never=>{throw Error('CONNECTION_SESSION_INVALID');};
const conflict=():never=>{throw Error('CONNECTION_CONFLICT');};
const hash=(x:unknown):x is string=>typeof x==='string'&&/^[A-Za-z0-9_-]{43}$/u.test(x);
const revision=(x:unknown):x is string=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(x);
const sealed=(x:unknown,max:number):x is string=>typeof x==='string'&&x.length>=44&&x.length<=max&&/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/u.test(x);
const label=(x:unknown):x is string=>typeof x==='string'&&x.length>=1&&x.length<=200&&!/[\p{Cc}\p{Cf}]/u.test(x);
function instant(x:unknown):string{
  if(x instanceof Date&&Number.isFinite(x.getTime()))return x.toISOString();
  if(typeof x!=='string'||x.length>40||!/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d(?::?\d\d)?)$/u.test(x)||!Number.isFinite(Date.parse(x)))return invalid();
  return new Date(x).toISOString();
}
const optionalInstant=(x:unknown):string|null=>x===null?null:instant(x);
function connection(x:unknown,owner:string):StoredConnection{
  if(!isRecord(x)||x.ownerId!==owner||!isUuid(x.id)||!isWalletProviderId(x.providerId)||!label(x.accountLabel)
    ||(x.status!=='connected'&&x.status!=='reconnect-required')||!sealed(x.sealedGrant,65536)||!revision(x.revision))return invalid();
  const connectedAt=instant(x.connectedAt),lastSyncAt=optionalInstant(x.lastSyncAt),operationExpiresAt=optionalInstant(x.operationExpiresAt);
  if(lastSyncAt!==null&&Date.parse(lastSyncAt)<Date.parse(connectedAt))return invalid();
  return Object.freeze({id:x.id,ownerId:owner,providerId:x.providerId,accountLabel:x.accountLabel,status:x.status,sealedGrant:x.sealedGrant,
    connectedAt,lastSyncAt,operationExpiresAt,revision:x.revision});
}
function connectionRow(x:unknown,owner:string):StoredConnection{
  if(!isRecord(x))return invalid();
  return connection({id:x.connection_id,ownerId:x.owner_id,providerId:x.provider_id,accountLabel:x.account_label,
    status:x.status,sealedGrant:x.sealed_grant,connectedAt:x.connected_at,lastSyncAt:x.last_sync_at,
    operationExpiresAt:x.operation_expires_at,revision:x.revision},owner);
}
function pending(x:unknown,owner:string,sessionHash:string):PendingAuthorization{
  if(!isRecord(x)||x.ownerId!==owner||x.sessionHash!==sessionHash||!hash(x.stateHash)||!isWalletProviderId(x.providerId)||!sealed(x.sealedVerifier,4096))return invalid();
  return Object.freeze({ownerId:owner,providerId:x.providerId,sessionHash,stateHash:x.stateHash,sealedVerifier:x.sealedVerifier,expiresAt:instant(x.expiresAt)});
}
const SQL=Object.freeze({
 list:'SELECT * FROM dlkt_info_connection_vault.list_connections($1::uuid,$2::uuid)',
 read:'SELECT * FROM dlkt_info_connection_vault.read_connection($1::uuid,$2::uuid,$3::text)',
 save:'SELECT dlkt_info_connection_vault.save_connection($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::uuid,$12::uuid) AS ok',
 remove:'SELECT dlkt_info_connection_vault.remove_connection($1::uuid,$2::uuid,$3::text,$4::uuid) AS ok',
 put:'SELECT dlkt_info_connection_vault.put_authorization($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::timestamptz) AS ok',
 consume:'SELECT * FROM dlkt_info_connection_vault.consume_authorization($1::uuid,$2::uuid,$3::text,$4::text,$5::text)'
});
function readSession(session:ResolvedIdentitySession,callbackProvider:WalletProviderId|null,clock:()=>number){
  try{
    const now=clock();
    if(!Number.isFinite(now)||now<0||!isUuid(session.user.id)||!isAccessToken(session.accessToken)||(callbackProvider!==null&&!isWalletProviderId(callbackProvider)))return badSession();
    const payload:unknown=JSON.parse(Buffer.from(session.accessToken.split('.')[1]??'','base64url').toString('utf8'));
    if(!isRecord(payload)||payload.sub!==session.user.id||payload.role!=='authenticated'||!isUuid(payload.session_id)
      ||payload.is_anonymous===true||typeof payload.exp!=='number'||!Number.isSafeInteger(payload.exp)||payload.exp<=Math.floor(now/1000))return badSession();
    return Object.freeze({owner:session.user.id,session:payload.session_id,sessionHash:verifiedSessionHash(session.accessToken,session.user.id),expires:payload.exp});
  }catch{return badSession();}
}
/** Constructor accepts only the result of the existing provider-verified
 * resolveIdentitySession call. JWT decoding here is NOT signature verification.
 * The database independently confirms the current auth.sessions row. */
export class PrivateConnectionVaultStore implements ConnectionStore{
  readonly #owner:string;
  readonly #session:string;
  readonly #sessionHash:string;
  readonly #expires:number;
  readonly #db:VaultQuery;
  readonly #callbackProvider:WalletProviderId|null;
  readonly #clock:()=>number;
  constructor(session:ResolvedIdentitySession,db:VaultQuery,callbackProvider:WalletProviderId|null=null,clock:()=>number=Date.now){
    const identity=readSession(session,callbackProvider,clock);
    this.#owner=identity.owner;this.#session=identity.session;
    this.#sessionHash=identity.sessionHash;this.#expires=identity.expires;
    this.#db=db;this.#callbackProvider=callbackProvider;this.#clock=clock;
  }
  #ensureSession():void{
    const now=this.#clock();
    if(!Number.isFinite(now)||now<0||Math.floor(now/1000)>=this.#expires)badSession();
  }
  async #call(key:keyof typeof SQL,values:readonly (string|null)[],max:number):Promise<readonly unknown[]>{
    this.#ensureSession();
    let rows:unknown;
    try{rows=await this.#db.query(SQL[key],[this.#owner,this.#session,...values]);}
    catch(error){
      if(isRecord(error)&&error.code==='28000')return badSession();
      throw Error('CONNECTION_UPSTREAM_UNAVAILABLE');
    }
    this.#ensureSession();
    if(!Array.isArray(rows)||rows.length>max)return invalid();
    return rows;
  }
  async #write(key:'save'|'remove'|'put',args:readonly (string|null)[]):Promise<void>{
    const rows=await this.#call(key,args,1),row=rows[0];
    if(rows.length!==1||!isRecord(row)||typeof row.ok!=='boolean')return invalid();
    if(!row.ok)conflict();
  }
  async list():Promise<readonly StoredConnection[]>{
    const rows=(await this.#call('list',[],4)).map(x=>connectionRow(x,this.#owner));
    if(new Set(rows.map(x=>x.providerId)).size!==rows.length)return invalid();
    return Object.freeze(rows);
  }
  async read(providerId:WalletProviderId):Promise<StoredConnection|null>{
    if(!isWalletProviderId(providerId))return invalid();
    const rows=await this.#call('read',[providerId],1);
    if(rows.length===0)return null;
    const row=connectionRow(rows[0],this.#owner);
    return row.providerId===providerId?row:invalid();
  }
  async save(value:StoredConnection,expectedRevision:string|null):Promise<void>{
    const v=connection(value,this.#owner);
    if(expectedRevision!==null&&(!revision(expectedRevision)||v.revision===expectedRevision))return invalid();
    await this.#write('save',[v.providerId,v.id,v.accountLabel,v.status,v.sealedGrant,v.connectedAt,v.lastSyncAt,v.operationExpiresAt,v.revision,expectedRevision]);
  }
  async remove(providerId:WalletProviderId,expectedRevision:string):Promise<void>{
    if(!isWalletProviderId(providerId)||!revision(expectedRevision))return invalid();
    await this.#write('remove',[providerId,expectedRevision]);
  }
  async createAuthorization(value:PendingAuthorization):Promise<void>{
    const v=pending(value,this.#owner,this.#sessionHash);
    const remaining=Date.parse(v.expiresAt)-this.#clock();
    if(remaining<=0||remaining>600000)return invalid();
    await this.#write('put',[v.providerId,v.stateHash,v.sessionHash,v.sealedVerifier,v.expiresAt]);
  }
  async consumeAuthorization(stateHash:string):Promise<PendingAuthorization|null>{
    if(!hash(stateHash)||!this.#callbackProvider)return invalid();
    const rows=await this.#call('consume',[this.#callbackProvider,stateHash,this.#sessionHash],1);
    if(!rows.length)return null;
    const x=rows[0];if(!isRecord(x)||x.session_id!==this.#session)return invalid();
    const v=pending({ownerId:x.owner_id,providerId:x.provider_id,stateHash:x.state_hash,sessionHash:x.session_hash,
      sealedVerifier:x.sealed_verifier,expiresAt:x.expires_at},this.#owner,this.#sessionHash);
    if(v.providerId!==this.#callbackProvider||v.stateHash!==stateHash||Date.parse(v.expiresAt)<=this.#clock())return invalid();
    return v;
  }
}
