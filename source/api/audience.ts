import type {IncomingMessage,ServerResponse} from 'node:http';
import type {Environment} from '../src/account/http.js';
import {respond} from '../src/account/http.js';
import {handleAudienceGateway} from '../src/audience/gateway.js';
import {audienceStorageConfig,SupabaseAudienceStore} from '../src/audience/storage.js';
export async function handleAudience(req:IncomingMessage,res:ServerResponse,deps:{environment?:Environment;fetch?:typeof fetch}={}):Promise<void>{
 const env=deps.environment??process.env;
 // Keep this route enabled during a collection shutdown so withdrawal remains possible.
 if(env.DLKT_INFO_AUDIENCE_ROUTE_ENABLED!=='1'){respond(res,404,{error:'NOT_FOUND'});return;}
 const config=audienceStorageConfig(env),secret=env.DLKT_INFO_AUDIENCE_TOKEN_SECRET;
 if(!config||!secret){respond(res,503,{error:'AUDIENCE_UNAVAILABLE'});return;}
 const edgeReady=env.DLKT_INFO_AUDIENCE_EDGE_GATE_READY==='1';
 const environment=edgeReady?env:{...env,DLKT_INFO_AUDIENCE_COLLECT_ENABLED:'0'};
 const store=new SupabaseAudienceStore(config,deps.fetch??fetch);
 await handleAudienceGateway(req,res,{
  environment,store,secret,
  available:()=>store.operationalReady(),
  permit:async(_req,action)=>action==='withdraw'||(edgeReady&&await store.admit(action==='enable'?'enable':'event')),
  // Geography is accepted only from the verified canonical production ingress.
  trustedMetadata:env.DLKT_INFO_AUDIENCE_TRUSTED_INGRESS==='1'&&env.VERCEL==='1'&&env.VERCEL_ENV==='production'&&req.headers.host==='www.dlkt.ee'
 });
}
export default handleAudience;
