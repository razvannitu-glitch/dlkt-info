import type {IncomingMessage,ServerResponse} from 'node:http';
import {handleIdentityRequest} from '../src/identity/http.js';
import {clearIdentityCookies} from '../src/identity/cookies.js';
import {accountReadiness} from '../src/account/readiness.js';
import {sameOrigin,noQuery,respond,type Environment} from '../src/account/http.js';
import type {ProvisioningProjection} from '../src/provisioning/index.js';
export async function handleAccountSession(req:IncomingMessage,res:ServerResponse,deps:{environment?:Environment;fetch?:typeof fetch;provisioning?:ProvisioningProjection}={}):Promise<void>{
 const environment=deps.environment??process.env;
 if(!['GET','POST','PUT','DELETE'].includes(req.method??'')){respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(!noQuery(req)){respond(res,400,{error:'QUERY_NOT_ALLOWED'});return;}
 if(!sameOrigin(req,'identity-v1',environment)){respond(res,403,{error:'ORIGIN_REJECTED'});return;}
 try{
  const state=await accountReadiness(environment,deps.fetch??fetch,deps.provisioning);
  if(!state.enabled){if(req.method==='DELETE')clearIdentityCookies(res);respond(res,req.method==='GET'||req.method==='DELETE'?200:503,{version:'dlkt-info-identity-1',configured:false,enabled:false,authenticated:false,user:null,blocker:'ACCOUNT_NOT_READY'});return;}
  await handleIdentityRequest(req,res,{environment,fetch:deps.fetch??fetch,...(state.provisioning?{provisioning:state.provisioning}:{})});
 }catch{respond(res,503,{error:'ACCOUNT_TEMPORARILY_UNAVAILABLE'});}
}
export default handleAccountSession;
