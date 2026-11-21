import type {IncomingMessage,ServerResponse} from 'node:http';
import {sameOrigin,noQuery,bodyJson,respond,type Environment} from '../src/account/http.js';
import {isObject} from '../src/account/contracts.js';
import {validSettings} from '../src/iceo/device-memory.js';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import type {IceoSnapshot} from '../src/iceo/contracts.js';
import {composeEdition} from '../src/edition/compose.js';
import {prepareArtifact} from '../src/edition/artifact.js';
import {artifactText} from '../src/edition/render.js';
import type {SourceInsight} from '../src/iceo/insight-contracts.js';
import type {EvidenceCard} from '../src/iceo/contracts.js';
export async function handleEdition(req:IncomingMessage,res:ServerResponse,deps:{load?:()=>Promise<IceoSnapshot>;environment?:Environment;now?:()=>number;readInsight?:(card:EvidenceCard)=>Promise<SourceInsight>}={}):Promise<void>{
 if(req.method!=='POST'){respond(res,405,{error:'METHOD_NOT_ALLOWED'});return;}
 if(!noQuery(req)){respond(res,400,{error:'QUERY_NOT_ALLOWED'});return;}
 if(!sameOrigin(req,'edition-v1',deps.environment??process.env)){respond(res,403,{error:'ORIGIN_REJECTED'});return;}
 try{
  const started=performance.now();
  const body=await bodyJson(req,8192);if(!isObject(body)||Object.keys(body).join(',')!=='settings'||!validSettings(body.settings))throw Error('EDITION_SETTINGS_INVALID');
  const edition=composeEdition(await (deps.load??(publicIceoSnapshot))(),body.settings,(deps.now??Date.now)());
  const artifact=await prepareArtifact(edition,{...(deps.readInsight?{read:deps.readInsight}:{}),budgetMs:Math.max(1,Math.min(8000,Math.floor(18000-(performance.now()-started))))});
  const output={edition,text:artifactText(artifact),artifact};if(Buffer.byteLength(JSON.stringify(output),'utf8')>2_097_152)throw Error('EDITION_TOO_LARGE');respond(res,200,output);
 }catch(error){const message=error instanceof Error?error.message:'';const code=message==='BODY_TOO_LARGE'||message==='EDITION_TOO_LARGE'?413:message==='CONTENT_TYPE_REQUIRED'?415:error instanceof SyntaxError||message==='EDITION_SETTINGS_INVALID'||message==='BODY_EMPTY'?400:503;respond(res,code,{error:code===503?'EDITION_UNAVAILABLE':message||'EDITION_SETTINGS_INVALID'});}
}
export default handleEdition;
