import type {IncomingMessage,ServerResponse} from 'node:http';
import {glanceSnapshot} from '../src/glance/service.js';
import type {GlanceSnapshot} from '../src/glance/contracts.js';
export async function handleGlance(req:IncomingMessage,res:ServerResponse,load:()=>Promise<GlanceSnapshot>=glanceSnapshot):Promise<void>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 if(!['GET','HEAD'].includes(req.method??'')){res.statusCode=405;res.setHeader('Allow','GET, HEAD');res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
 if((req.url??'').includes('?')){res.statusCode=400;res.end(JSON.stringify({error:'QUERY_NOT_ALLOWED'}));return;}
 try{const snapshot=await load(),body=JSON.stringify(snapshot);if(Buffer.byteLength(body)>150000)throw Error('GLANCE_TOO_LARGE');res.setHeader('Cache-Control','public, max-age=0, s-maxage=300');res.statusCode=200;res.end(req.method==='HEAD'?'':body);}
 catch{res.statusCode=503;res.setHeader('Retry-After','60');res.end(req.method==='HEAD'?'':JSON.stringify({error:'GLANCE_UNAVAILABLE'}));}
}
export default handleGlance;
