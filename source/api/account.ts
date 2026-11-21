import type {IncomingMessage,ServerResponse} from 'node:http';
import {accountReadiness} from '../src/account/readiness.js';
import {sameOrigin,noQuery,respond,bodyJson,type Environment} from '../src/account/http.js';
import {ACCOUNT_VERSION,ACCOUNT_MAX_BYTES,isObject,isRevision,parseAccountValue} from '../src/account/contracts.js';
import {AccountStore} from '../src/account/store.js';
import {resolveIdentitySession} from '../src/identity/session.js';
import type {ProvisioningProjection} from '../src/provisioning/index.js';
export async function handleAccount(req:IncomingMessage,res:ServerResponse,deps:{environment?:Environment;fetch?:typeof fetch;provisioning?:ProvisioningProjection}={}):Promise<void>{
 const env=deps.environment??process.env;
 if(!['GET','PUT','DELETE'].includes(req.method??'')){respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(!noQuery(req)){respond(res,400,{error:'QUERY_NOT_ALLOWED'});return;}
 if(!sameOrigin(req,'account-v1',env)){respond(res,403,{error:'ORIGIN_REJECTED'});return;}
 try{
  const ready=await accountReadiness(env,deps.fetch??fetch,deps.provisioning);
  if(!ready.enabled||ready.configuration.state!=='ready'){respond(res,req.method==='GET'?200:503,{version:ACCOUNT_VERSION,enabled:false,state:null});return;}
  const session=await resolveIdentitySession(req,res,ready.configuration,deps.fetch??fetch);
  if(!session){respond(res,401,{error:'AUTHENTICATION_REQUIRED'});return;}
  const store=new AccountStore(ready.configuration,session.user.id,session.accessToken,deps.fetch??fetch);
  if(req.method==='GET'){respond(res,200,{version:ACCOUNT_VERSION,enabled:true,state:await store.read()});return;}
  const body=await bodyJson(req,ACCOUNT_MAX_BYTES+1024);
  if(!isObject(body))throw Error('ACCOUNT_INPUT_INVALID');
  if(req.method==='DELETE'){
   if(Object.keys(body).join(',')!=='expectedRevision'||!isRevision(body.expectedRevision))throw Error('ACCOUNT_INPUT_INVALID');
   await store.remove(body.expectedRevision);respond(res,200,{version:ACCOUNT_VERSION,enabled:true,state:null});return;
  }
  if(Object.keys(body).sort().join(',')!=='expectedRevision,value'||(body.expectedRevision!==null&&!isRevision(body.expectedRevision)))throw Error('ACCOUNT_INPUT_INVALID');
  const state=await store.save(parseAccountValue(body.value),body.expectedRevision);respond(res,200,{version:ACCOUNT_VERSION,enabled:true,state});
 }catch(error){const msg=error instanceof Error?error.message:'';const status=msg==='ACCOUNT_CONFLICT'?409:msg==='ACCOUNT_SESSION_INVALID'?401:msg==='ACCOUNT_FORBIDDEN'?403:msg==='CONTENT_TYPE_REQUIRED'?415:msg==='BODY_TOO_LARGE'||msg==='ACCOUNT_VALUE_TOO_LARGE'?413:msg==='ACCOUNT_INPUT_INVALID'||msg==='ACCOUNT_VALUE_INVALID'||error instanceof SyntaxError?400:502;respond(res,status,{error:status===502?'ACCOUNT_UPSTREAM_UNAVAILABLE':msg||'ACCOUNT_INPUT_INVALID'});}
}
export default handleAccount;
