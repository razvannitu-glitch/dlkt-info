import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Environment} from '../account/http.js';
import {bodyJson,noQuery,respond,sameOrigin} from '../account/http.js';
import {AUDIENCE_TTL_SECONDS,issueAudienceToken,readAudienceToken,parseAudienceEvent,approximateGeography} from './contracts.js';
import type {AudienceStore} from './storage.js';

const COOKIE='__Host-dlkt_audience';
const MARKER='audience-v1';
type Action='status'|'enable'|'withdraw'|'event';
export interface AudienceGatewayDependencies {
 readonly environment:Environment;
 readonly store:AudienceStore;
 readonly secret:string;
 readonly now?:()=>number;
 /** Must be backed by a deployment-wide abuse control, not a local-memory counter. */
 readonly permit:(request:IncomingMessage,action:Action)=>Promise<boolean>;
 /** Explicitly verified by the deployment integration; defaults to false. */
 readonly trustedMetadata?:boolean;
}
function readCookie(header:string|undefined):string|null{
 if(!header||header.length>16_384)return null;
 const matches=header.split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
 if(matches.length!==1)return null;
 return matches[0]?.slice(COOKIE.length+1)??null;
}
function cookie(token:string,maxAge:number):string{return COOKIE+'='+token+'; Path=/; Max-Age='+String(maxAge)+'; Secure; HttpOnly; SameSite=Lax';}
function validSecret(secret:string):boolean{return /^[A-Za-z0-9_-]{43}$/u.test(secret)&&Buffer.from(secret,'base64url').toString('base64url')===secret;}
/** Deliberately unmounted. Consent UI, retention, verified ingress and shared abuse control are release prerequisites. */
export async function handleAudienceGateway(req:IncomingMessage,res:ServerResponse,deps:AudienceGatewayDependencies):Promise<void>{
 const env=deps.environment;
 const enabled=env.DLKT_INFO_AUDIENCE_COLLECT_ENABLED==='1'&&env.DLKT_INFO_AUDIENCE_RETENTION_READY==='1'&&env.DLKT_INFO_AUDIENCE_CONSENT_READY==='1';
 if(req.method!=='POST'){res.setHeader('Allow','POST');respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(!noQuery(req)||!sameOrigin(req,MARKER,env)){respond(res,403,{error:'REQUEST_REJECTED'});return;}
 if(!validSecret(deps.secret)){respond(res,503,{error:'AUDIENCE_UNAVAILABLE'});return;}
 const now=Math.floor((deps.now??Date.now)()/1000);
 const browser=readAudienceToken(readCookie(req.headers.cookie),deps.secret,now);
 const privacySignal=req.headers['sec-gpc']==='1'||req.headers.dnt==='1';
 let input:unknown;
 try{input=await bodyJson(req,1024);}catch{respond(res,400,{error:'INVALID_INPUT'});return;}
 if(!input||typeof input!=='object'||Array.isArray(input)){respond(res,400,{error:'INVALID_INPUT'});return;}
 const v=input as Record<string,unknown>;
 const action=v.action;
 if(action!=='status'&&action!=='enable'&&action!=='withdraw'&&action!=='event'){respond(res,400,{error:'INVALID_INPUT'});return;}
 if(Object.keys(v).sort().join(',')!==(action==='event'?'action,event':'action')){respond(res,400,{error:'INVALID_INPUT'});return;}
 if(action==='status'){respond(res,200,{available:enabled&&!privacySignal,hasToken:browser!==null});return;}
 if(action!=='withdraw'&&(!enabled||privacySignal)){respond(res,403,{error:'MEASUREMENT_DISABLED'});return;}
 if(action==='event'&&browser===null){respond(res,401,{error:'OPT_IN_REQUIRED'});return;}
 const event=action==='event'?parseAudienceEvent(v.event):null;
 if(action==='event'&&!event){respond(res,400,{error:'INVALID_EVENT'});return;}
 try{
  if(!await deps.permit(req,action)){respond(res,429,{error:'RATE_LIMITED'});return;}
  if(action==='enable'){
   if(!browser)res.setHeader('Set-Cookie',cookie(issueAudienceToken(deps.secret,now),AUDIENCE_TTL_SECONDS));
   respond(res,200,{enabled:true});return;
  }
  if(action==='withdraw'){
   if(browser)await deps.store.forget(browser);
   res.setHeader('Set-Cookie',cookie('',0));respond(res,200,{enabled:false});return;
  }
  if(!browser||!event){respond(res,401,{error:'OPT_IN_REQUIRED'});return;}
  const result=await deps.store.record(browser,event,approximateGeography(req.headers,deps.trustedMetadata===true));
  if(result==='revoked'){res.setHeader('Set-Cookie',cookie('',0));respond(res,401,{error:'OPT_IN_REQUIRED'});return;}
  if(result==='throttled'){respond(res,429,{error:'RATE_LIMITED'});return;}
  respond(res,200,{result});
 }catch{respond(res,503,{error:'AUDIENCE_UNAVAILABLE'});}
}
