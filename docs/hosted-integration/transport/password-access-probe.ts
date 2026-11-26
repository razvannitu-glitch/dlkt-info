// One-shot, read-only hosted probe. No application privileges or credential logging.
import postgres from 'postgres';
import {checkServerIdentity} from 'node:tls';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {INTEGRATION_REF,resolveIntegrationRoute,reject} from './integration-route.js';
import {validProbeIdentity} from './temporary-access-probe.js';
function record(value:unknown):value is Record<string,unknown>{
 return typeof value==='object'&&value!==null&&!Array.isArray(value);
}
export function preparePasswordProbe(input:unknown){
 if(!record(input)||typeof input.password!=='string'||input.password.length<12||
 Buffer.byteLength(input.password,'utf8')>256||/[\p{Cc}\p{Cf}]/u.test(input.password))return reject();
 const route=resolveIntegrationRoute('session-pooler',input.projectRef,'probe',input.ca);
 return {route,password:input.password};
}
export async function runPasswordProbe(input:unknown):Promise<void>{
 const {route,password}=preparePasswordProbe(input);
 const db=postgres({host:route.host,port:route.port,user:route.user,database:'postgres',password,
  ssl:{ca:route.ca,minVersion:'TLSv1.2',rejectUnauthorized:true,servername:route.host,
   checkServerIdentity:(_host:string,cert:Parameters<typeof checkServerIdentity>[1])=>checkServerIdentity(route.host,cert)},
  connection:{application_name:'dlkt-integration-readonly-probe'},
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
  if(process.env.DLKT_HOSTED_PASSWORD_PROBE_APPROVED!=='1')throw new Error('HOSTED_PROBE_NOT_APPROVED');
  const ca=await readFile(new URL('../prod-ca-2021.crt',import.meta.url),'utf8');
  await runPasswordProbe({projectRef:INTEGRATION_REF,ca,password:process.env.DLKT_INTEGRATION_PROBE_PASSWORD});
  console.log('DLKT_HOSTED_PASSWORD_PROBE_OK');
 }catch{console.error('DLKT_HOSTED_PASSWORD_PROBE_FAILED');process.exitCode=1;}
}
