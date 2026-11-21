import type {IncomingMessage,ServerResponse} from 'node:http';
import {findCity} from '../src/local/cities.js';
import {localBriefingService,type LocalBriefingService} from '../src/local/service.js';
/** Canonical public city only. Never accept coordinates, remote URLs or personal settings. */
export async function handleLocal(req:IncomingMessage,res:ServerResponse,service:Pick<LocalBriefingService,'snapshot'>=localBriefingService):Promise<void>{
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET'){res.statusCode=405;res.setHeader('Allow','GET');res.end(JSON.stringify({error:'METHOD_NOT_ALLOWED'}));return;}
 const u=new URL(req.url??'/','https://www.dlkt.ee');const entries=[...u.searchParams.entries()];
 if(entries.length!==1||entries[0]?.[0]!=='city'||!/^\d{1,12}$/u.test(entries[0]?.[1]??'')){res.statusCode=400;res.end(JSON.stringify({error:'CITY_REQUIRED'}));return;}
 const city=findCity(entries[0][1]);if(!city){res.statusCode=404;res.end(JSON.stringify({error:'CITY_NOT_LISTED'}));return;}
 try{const result=await service.snapshot(city);res.setHeader('Cache-Control',result.state==='ready'?'public, max-age=0, s-maxage=60':'public, max-age=0, s-maxage=15');res.statusCode=200;res.end(JSON.stringify(result));}
 catch{res.statusCode=503;res.setHeader('Retry-After','60');res.end(JSON.stringify({error:'LOCAL_TEMPORARILY_UNAVAILABLE'}));}
}
export default handleLocal;
