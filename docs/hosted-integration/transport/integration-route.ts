import {X509Certificate} from 'node:crypto';
export const INTEGRATION_REF='hziavqdhsqnihxuuxzhn';
const DIRECT_HOST='db.'+INTEGRATION_REF+'.supabase.co';
const POOLER_HOST='aws-0-eu-central-1.pooler.supabase.com';
const CA_FINGERPRINT='807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa';
export type ConnectionMethod='direct'|'session-pooler';
export const RUNTIME_CAPABILITIES=['vault','checkout','recovery','ingress','worker','reconcile','customer','closure','review','cleanup'] as const;
export type Capability=typeof RUNTIME_CAPABILITIES[number];
export function reject():never{throw new Error('INTEGRATION_TRANSPORT_REJECTED');}
export function resolveIntegrationRoute(method:unknown,project:unknown,capability:unknown,ca:unknown){
 if(project!==INTEGRATION_REF||(method!=='direct'&&method!=='session-pooler')||
 typeof capability!=='string'||(!RUNTIME_CAPABILITIES.some(x=>x===capability)&&capability!=='probe')||
 (capability==='probe'&&method!=='session-pooler')||typeof ca!=='string'||ca.length<200||ca.length>32768||
 !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/u.test(ca)||
 process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')return reject();
 try{
  const cert=new X509Certificate(ca);
  if(!cert.ca||!cert.checkIssued(cert)||!cert.verify(cert.publicKey)||Date.parse(cert.validFrom)>Date.now()||Date.parse(cert.validTo)<=Date.now())return reject();
  if(method==='session-pooler'&&cert.fingerprint256.replaceAll(':','').toLowerCase()!==CA_FINGERPRINT)return reject();
 }catch{return reject();}
 const role='dlkt_rt_'+capability;
 return Object.freeze({method,role,host:method==='direct'?DIRECT_HOST:POOLER_HOST,port:5432,
  user:method==='direct'?role:role+'.'+INTEGRATION_REF,ca});
}
