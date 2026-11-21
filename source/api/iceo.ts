import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { publicIceoRead } from '../src/iceo/daily-cache.js';
import type { IceoSnapshot } from '../src/iceo/contracts.js';
/** Public metadata only. Personal filtering happens in-browser and never enters this cache. */
export async function handleIceo(request:IncomingMessage,response:ServerResponse,load?:()=>Promise<IceoSnapshot>):Promise<void>{
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');
  if(!['GET','HEAD'].includes(request.method??'')){response.setHeader('Allow','GET, HEAD');response.statusCode=405;response.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
  if((request.url??'').includes('?')){response.statusCode=400;response.end(JSON.stringify({error:'QUERY_NOT_ALLOWED'}));return;}
  try{
    const result=load?{snapshot:await load(),collection:null}:await publicIceoRead();
    const snapshot=result.snapshot;const body=JSON.stringify(snapshot);
    if(Buffer.byteLength(body)>1_048_576)throw new Error('SNAPSHOT_TOO_LARGE');
    const etag=`"${createHash('sha256').update(body).digest('hex')}"`;
    response.setHeader('ETag',etag);response.setHeader('X-ICEO-Mode',snapshot.mode);
    response.setHeader('Cache-Control',snapshot.state==='unavailable'?'no-store':'public, max-age=0, s-maxage=10, must-revalidate');
    response.setHeader('X-ICEO-Source-Checked-At',snapshot.generatedAt);
    if(result.collection){
      const collection=result.collection;
      response.setHeader('X-ICEO-Revision',String(collection.revision));
      if(collection.refreshedAt)response.setHeader('X-ICEO-Refreshed-At',collection.refreshedAt);
      if(collection.lastScheduledAttemptAt)response.setHeader('X-ICEO-Last-Scheduled-Attempt-At',collection.lastScheduledAttemptAt);
      if(collection.lastScheduledSuccessAt)response.setHeader('X-ICEO-Last-Scheduled-Success-At',collection.lastScheduledSuccessAt);
      response.setHeader('X-ICEO-Collection-State',collection.status==='ready'&&Date.now()-Date.parse(collection.refreshedAt??'')>240_000?'delayed':collection.status);
    }
    if(snapshot.state==='unavailable')response.setHeader('Retry-After','60');
    if(request.headers['if-none-match']===etag){response.statusCode=304;response.end();return;}
    response.statusCode=200;response.end(request.method==='HEAD'?'':body);
  }catch{response.statusCode=503;response.setHeader('Cache-Control','no-store');response.setHeader('Retry-After','30');response.end(request.method==='HEAD'?'':JSON.stringify({error:'ICEO_TEMPORARILY_UNAVAILABLE'}));}
}
export default handleIceo;
