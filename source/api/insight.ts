import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import {insightService} from '../src/iceo/insight.js';
import type {IceoSnapshot,EvidenceCard} from '../src/iceo/contracts.js';
import type {SourceInsight} from '../src/iceo/insight-contracts.js';
export async function handleInsight(req:IncomingMessage,res:ServerResponse,load:()=>Promise<IceoSnapshot>=publicIceoSnapshot,explain:(card:EvidenceCard)=>Promise<SourceInsight>=card=>insightService.read(card)):Promise<void>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');
  const send=(status:number,body:unknown):void=>{res.statusCode=status;res.end(req.method==='HEAD'?'':JSON.stringify(body));};
  if(!['GET','HEAD'].includes(req.method??'')){res.setHeader('Allow','GET, HEAD');send(405,{error:'METHOD_NOT_ALLOWED'});return;}
  const url=new URL(req.url??'','https://www.dlkt.ee');const entries=[...url.searchParams];
  const id=url.searchParams.get('id'),hash=url.searchParams.get('hash');
  if(entries.length!==2||url.searchParams.getAll('id').length!==1||url.searchParams.getAll('hash').length!==1||!id||!hash||!/^[a-f0-9]{24}$/u.test(id)||!/^[a-f0-9]{64}$/u.test(hash)){send(400,{error:'INSIGHT_REQUEST_INVALID'});return;}
  try{
    const snapshot=await load();if(snapshot.state==='unavailable'){send(503,{error:'CATALOG_UNAVAILABLE'});return;}
    const card=snapshot.cards.find(c=>c.id===id);
    if(!card){send(404,{error:'CARD_NOT_IN_CURRENT_CATALOG'});return;}
    if(card.contentHash!==hash){send(409,{error:'CARD_CHANGED_REFRESH_REQUIRED'});return;}
    const insight=await explain(card);const body=JSON.stringify(insight);
    const tag=`"${createHash('sha256').update(body).digest('hex')}"`;res.setHeader('ETag',tag);
    if(insight.state==='ready')res.setHeader('Cache-Control','public, max-age=30, s-maxage=300');
    if(insight.state==='unavailable')res.setHeader('Retry-After','60');
    if(req.headers['if-none-match']===tag){res.statusCode=304;res.end();return;}send(200,insight);
  }catch{send(503,{error:'INSIGHT_UNAVAILABLE'});}
}
export default handleInsight;
