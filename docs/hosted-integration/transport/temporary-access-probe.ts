// One-shot read-only hosted proof. Not a deployed app or long-lived credential.
import postgres from 'postgres';
import {checkServerIdentity} from 'node:tls';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {INTEGRATION_REF,resolveIntegrationRoute,reject} from './integration-route.js';
const record=(x:unknown):x is Record<string,unknown>=>typeof x==='object'&&x!==null&&!Array.isArray(x);
export function prepareTemporaryProbe(input:unknown){
 if(!record(input)||typeof input.token!=='string'||!/^sbp_fc[A-Za-z0-9_-]{30,512}$/u.test(input.token))return reject();
 // Prefix proves token family only, NOT project scope or permissions. Operator must verify those.
 const route=resolveIntegrationRoute('session-pooler',input.projectRef,'probe',input.ca);
 return {route,token:input.token};
}
export function validProbeIdentity(row:unknown):boolean{
 return record(row)&&row.project_ref===INTEGRATION_REF&&row.environment==='integration'&&row.contract_version===1&&
 row.login_role==='dlkt_rt_probe'&&row.effective_role==='dlkt_rt_probe'&&row.encrypted===true;
}
export async function runTemporaryAccessProbe(input:unknown):Promise<void>{
 const {route,token}=prepareTemporaryProbe(input);
 const db=postgres({host:route.host,port:route.port,user:route.user,database:'postgres',password:token,
  ssl:{ca:route.ca,minVersion:'TLSv1.2',rejectUnauthorized:true,servername:route.host,
   checkServerIdentity:(_host:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(route.host,cert)},
  connection:{options:'-c jit=true',application_name:'dlkt-integration-readonly-probe'},
  prepare:false,fetch_types:false,max:1,max_pipeline:1,connect_timeout:5,idle_timeout:5,max_lifetime:30,
  query_timeout:5,queue_timeout:5,cancel_timeout:1,debug:false,onnotice:()=>{}});
 try{
  await db.begin(async tx=>{
   await tx.unsafe('SET TRANSACTION READ ONLY');
   await tx.unsafe("SET LOCAL statement_timeout = '4s'");
   const rows=await tx.unsafe('SELECT * FROM dlkt_info_runtime.identity()');
   if(rows.length!==1||!validProbeIdentity(rows[0]))throw new Error('PROBE_IDENTITY_MISMATCH');
  });
 }catch{throw new Error('HOSTED_PROBE_REJECTED');}
 finally{try{await db.end({timeout:1});}catch{throw new Error('HOSTED_PROBE_REJECTED');}}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.DLKT_TEMPORARY_PROBE_APPROVED!=='1')throw new Error('HOSTED_PROBE_NOT_APPROVED');
  const ca=await readFile(new URL('../prod-ca-2021.crt',import.meta.url),'utf8');
  await runTemporaryAccessProbe({projectRef:INTEGRATION_REF,ca,token:process.env.DLKT_INTEGRATION_TEMP_TOKEN});
  console.log('DLKT_HOSTED_READONLY_AUTHENTICATED_PROBE_OK');
 }catch{console.error('DLKT_HOSTED_READONLY_AUTHENTICATED_PROBE_FAILED');process.exitCode=1;}
}
