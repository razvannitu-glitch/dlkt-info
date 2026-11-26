// Server-only integration transport. The production project is NOT configurable here.
import postgres from 'postgres';
import {checkServerIdentity} from 'node:tls';
import {INTEGRATION_REF as REF,RUNTIME_CAPABILITIES as ROLES,resolveIntegrationRoute,type Capability} from './integration-route.js';
export type {Capability} from './integration-route.js';
const identitySQL='SELECT * FROM dlkt_info_runtime.identity()';
type Allowed=Readonly<Record<string,readonly [number,number]>>;
const commands:Readonly<Record<Capability,Allowed>>=Object.freeze({
 vault:Object.freeze({
 'SELECT * FROM dlkt_info_connection_vault.list_connections($1::uuid,$2::uuid)':[2,4],
 'SELECT * FROM dlkt_info_connection_vault.read_connection($1::uuid,$2::uuid,$3::text)':[3,1],
 'SELECT dlkt_info_connection_vault.save_connection($1::uuid,$2::uuid,$3::text,$4::uuid,$5::text,$6::text,$7::text,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::uuid,$12::uuid) AS ok':[12,1],
 'SELECT dlkt_info_connection_vault.remove_connection($1::uuid,$2::uuid,$3::text,$4::uuid) AS ok':[4,1],
 'SELECT dlkt_info_connection_vault.put_authorization($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text,$7::timestamptz) AS ok':[7,1],
 'SELECT * FROM dlkt_info_connection_vault.consume_authorization($1::uuid,$2::uuid,$3::text,$4::text,$5::text)':[5,1]
 } satisfies Allowed),
 checkout:Object.freeze({
 'SELECT * FROM dlkt_info_billing.reserve_checkout($1::text,$2::uuid,$3::text,$4::uuid)':[4,1],
 'SELECT dlkt_info_billing.attach_checkout($1::text,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::bigint) AS ok':[7,1]
 } satisfies Allowed),
 recovery:Object.freeze({
 'SELECT * FROM dlkt_info_billing.read_checkout($1::text,$2::uuid)':[2,1],
 'SELECT dlkt_info_billing.attach_checkout($1::text,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::bigint) AS ok':[7,1],
 'SELECT dlkt_info_billing.finish_checkout($1::text,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::bigint,$8::text,$9::text,$10::text,$11::text) AS ok':[11,1]
 } satisfies Allowed),
 ingress:Object.freeze({'SELECT dlkt_info_billing.ingest_notice($1::text,$2::text,$3::text,$4::text,$5::bigint) AS outcome':[5,1]} satisfies Allowed),
 worker:Object.freeze({
 'SELECT * FROM dlkt_info_billing.claim_notice($1::text)':[1,1],
 'SELECT dlkt_info_billing.route_subscription_notice($1::text,$2::text,$3::integer) AS ok':[3,1],
 'SELECT dlkt_info_billing.fail_notice($1::text,$2::text,$3::integer,$4::text) AS ok':[4,1]
 } satisfies Allowed),
 reconcile:Object.freeze({
 'SELECT * FROM dlkt_info_billing.claim_subscription($1::text)':[1,1],
 'SELECT dlkt_info_billing.record_subscription_observation($1::text,$2::text,$3::bigint,$4::bigint,$5::uuid,$6::text,$7::text,$8::text,$9::text) AS ok':[9,1],
 'SELECT dlkt_info_billing.fail_subscription($1::text,$2::text,$3::bigint,$4::bigint,$5::text) AS ok':[5,1]
 } satisfies Allowed),
 customer:Object.freeze({
 'SELECT account_id,product_id,live_mode FROM dlkt_info_billing.catalog_accounts WHERE account_id=$1::text':[1,1],
 'SELECT account_id,price_id,plan,amount_cents,currency FROM dlkt_info_billing.catalog_prices WHERE account_id=$1::text ORDER BY plan':[1,2],
 'INSERT INTO dlkt_info_billing.customer_bindings(account_id,customer_id,owner_id) VALUES($1::text,$2::text,$3::uuid)':[3,0]
 } satisfies Allowed),
 closure:Object.freeze({
 'SELECT * FROM dlkt_info_account_lifecycle.request_closure($1::uuid,$2::uuid,$3::uuid)':[3,1],
 'SELECT * FROM dlkt_info_account_lifecycle.read_closure($1::uuid,$2::uuid)':[2,1]
 } satisfies Allowed),
 review:Object.freeze({
 'SELECT * FROM dlkt_info_account_lifecycle.inspect_closure($1::uuid)':[1,1],
 'SELECT * FROM dlkt_info_account_lifecycle.read_tasks($1::uuid)':[1,6],
 'SELECT dlkt_info_account_lifecycle.note_blocker($1::uuid,$2::text,$3::bigint,$4::text,$5::text) AS ok':[5,1],
 'SELECT * FROM dlkt_info_account_lifecycle.read_grant_cleanup($1::uuid)':[1,4]
 } satisfies Allowed),
 cleanup:Object.freeze({
 'SELECT dlkt_info_account_lifecycle.prepare_grant_cleanup($1::uuid) AS count':[1,1],
 'SELECT * FROM dlkt_info_account_lifecycle.claim_grant_cleanup($1::uuid)':[1,1],
 'SELECT dlkt_info_account_lifecycle.mark_grant_dispatched($1::uuid,$2::uuid,$3::bigint) AS ok':[3,1],
 'SELECT dlkt_info_account_lifecycle.finish_grant_cleanup($1::uuid,$2::uuid,$3::bigint,$4::text) AS ok':[4,1]
 } satisfies Allowed)
});
function fail():never{throw new Error('INTEGRATION_TRANSPORT_REJECTED');}
const record=(v:unknown):v is Record<string,unknown>=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const get=(v:unknown,k:string):unknown=>record(v)&&Object.hasOwn(v,k)?v[k]:undefined;
function config(raw:unknown){
 const mode=get(raw,'mode'),projectRef=get(raw,'projectRef'),capability=get(raw,'capability'),password=get(raw,'password');
 if(mode!=='integration'||projectRef!==REF||typeof capability!=='string'||!(ROLES as readonly string[]).includes(capability)
 ||typeof password!=='string'||!(/^[A-Za-z0-9_-]{32,256}$/u.test(password)))return fail();
 const route=resolveIntegrationRoute(get(raw,'connectionMethod'),projectRef,capability,get(raw,'ca'));
 return {capability:capability as Capability,role:route.role,password,route};
}
function safeError(e:unknown):Error{
 const code=get(e,'code');
 // Only a bounded SQLSTATE is returned to the adapter, not server detail,
 // query, parameters, hostname, URL, credentials, or original cause.
 const allowed=['28000','55000','23505','23503','23514','22023','42501','57014'];
 if(typeof code==='string'&&allowed.includes(code))return Object.assign(new Error('INTEGRATION_DATABASE_REJECTED'),{code});
 return new Error('INTEGRATION_DATABASE_UNAVAILABLE');
}
function attested(row:unknown,role:string):boolean{
 return get(row,'project_ref')===REF&&get(row,'environment')==='integration'&&get(row,'contract_version')===1
 &&get(row,'login_role')===role&&get(row,'effective_role')===role&&get(row,'encrypted')===true;
}
export class SecureIntegrationTransport{
 readonly #db:ReturnType<typeof postgres>;
 readonly #role:string;
 readonly #capability:Capability;
 #closed=false;
 constructor(input:unknown){
  const c=config(input);this.#role=c.role;this.#capability=c.capability;
  this.#db=postgres({host:c.route.host,port:c.route.port,database:'postgres',user:c.route.user,password:c.password,
   ssl:{ca:c.route.ca,minVersion:'TLSv1.2',rejectUnauthorized:true,servername:c.route.host,checkServerIdentity:(_hostname:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(c.route.host,cert)},
   max:1,max_pipeline:1,prepare:false,fetch_types:false,connect_timeout:5,idle_timeout:10,max_lifetime:60,
   queue_timeout:5,query_timeout:5,cancel_timeout:1,debug:false,onnotice:()=>{},connection:{application_name:'dlkt-integration-'+c.capability}});
 }
 async #execute(command:string|null,params:readonly (string|null)[],maxRows:number):Promise<readonly unknown[]>{
  if(this.#closed||process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return fail();
  try{
   return await this.#db.begin(async tx=>{
    await tx.unsafe("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await tx.unsafe("SET LOCAL statement_timeout = '4s'");
    await tx.unsafe("SET LOCAL lock_timeout = '2s'");
    const rows=await tx.unsafe(identitySQL);
    if(rows.length!==1||!attested(rows[0],this.#role))return fail();
    if(command===null)return Object.freeze([{projectRef:REF,environment:'integration',role:this.#role,encrypted:true,contractVersion:1}]);
    const result=await tx.unsafe(command,[...params]);
    if(result.length>maxRows||Buffer.byteLength(JSON.stringify(result),'utf8')>524288)return fail();
    return Object.freeze(Array.from(result));
   });
  }catch(e){throw safeError(e);}
 }
 async probe():Promise<unknown>{return (await this.#execute(null,[],1))[0];}
 async query(sql:string,params:readonly (string|null)[]):Promise<readonly unknown[]>{
  const allowed=commands[this.#capability];
  if(typeof sql!=='string'||!Object.hasOwn(allowed,sql))return fail();
  const bounds=allowed[sql];if(!bounds||!Array.isArray(params)||params.length!==bounds[0]||params.some(x=>x!==null&&(typeof x!=='string'||x.includes('\u0000')||Buffer.byteLength(x,'utf8')>65536))||Buffer.byteLength(JSON.stringify(params),'utf8')>131072)return fail();
  return await this.#execute(sql,params,bounds[1]);
 }
 async close():Promise<void>{this.#closed=true;try{await this.#db.end({timeout:1});}catch{throw new Error('INTEGRATION_DATABASE_UNAVAILABLE');}}
}
