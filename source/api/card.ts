import {DAILY_TOPIC_FRESHNESS_MS} from '../src/daily/contracts.js';
import {createHash} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import type {EvidenceCard,IceoSnapshot} from '../src/iceo/contracts.js';
import type {SourceInsight} from '../src/iceo/insight-contracts.js';
import {validInsight,insightSupported} from '../src/iceo/insight-contracts.js';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import {insightService} from '../src/iceo/insight.js';
import {PublicCardError} from '../src/share/current-card.js';
import type {ArchiveStore} from '../src/share/archive.js';
import {createArchiveStore} from '../src/share/archive-rest.js';
import {resolveShare} from '../src/share/resolve.js';
import {parseCardReference,parseKnowledgeCardReference} from '../src/share/link.js';
import {resolveKnowledgeShare} from '../src/share/knowledge-resolution.js';
import {renderSharedCard,renderSharedError,renderSharedKnowledgeCard,renderSharedKnowledgeUnavailable} from '../src/share/render.js';
/** Read-only route. References can select an existing public record but cannot supply its content or URL. */
export async function handleCard(req:IncomingMessage,res:ServerResponse,load:()=>Promise<IceoSnapshot>=publicIceoSnapshot,explain:(c:EvidenceCard)=>Promise<SourceInsight>=c=>insightService.read(c),clock:()=>number=Date.now,archive:ArchiveStore|null=createArchiveStore(process.env),resolveKnowledge:typeof resolveKnowledgeShare=resolveKnowledgeShare):Promise<void>{
  res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
  res.setHeader('Content-Security-Policy',"default-src 'none'; manifest-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  const send=(status:number,html:string):void=>{res.statusCode=status;if(status===503)res.setHeader('Retry-After','60');res.end(req.method==='HEAD'?'':html);};
  if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');send(405,renderSharedError(405));return;}
  const raw=req.url??'',knowledgeRef=parseKnowledgeCardReference(raw);
  if(knowledgeRef!==null){
    try{
      const started=clock(),view=await resolveKnowledge(knowledgeRef,started);
      if(view===null){send(404,renderSharedKnowledgeUnavailable(knowledgeRef.language));return;}
      const html=renderSharedKnowledgeCard(view),completed=clock();
      if(!Number.isSafeInteger(completed)||completed<started)throw Error('KNOWLEDGE_SHARE_CLOCK_INVALID');
      if(completed>=view.validUntil){send(404,renderSharedKnowledgeUnavailable(knowledgeRef.language));return;}
      if(Buffer.byteLength(html)>100000)throw Error('CARD_PAGE_TOO_LARGE');
      send(200,html);
    }catch{send(503,renderSharedError(503));}
    return;
  }
  const ref=parseCardReference(raw);if(!ref){send(400,renderSharedError(400));return;}
  try{
    const resolution=await resolveShare(ref,load,archive,clock);const resolved=resolution.current;const {card,validUntil}=resolved;
    let insight:SourceInsight|null=null;
    if(!resolution.archived&&insightSupported(card))try{const candidate=await explain(card),at=clock();if(validInsight(candidate,card)&&Date.parse(candidate.checkedAt)<=at+300000&&Date.parse(candidate.checkedAt)>=at-DAILY_TOPIC_FRESHNESS_MS&&candidate.points.every(p=>createHash('sha256').update(p.text).digest('hex')===p.hash))insight=candidate;}catch{/* A missing excerpt cannot turn into invented content. */}
    if(!resolution.archived&&clock()>=validUntil)throw Error('CARD_EXPIRED');
    const html=renderSharedCard({card,insight,now:clock(),validUntil,changed:ref.revision!==null&&ref.revision!==card.contentHash,partial:resolved.partial,archive:resolution.archived?{capturedAt:resolution.archived.capturedAt,reason:resolution.reason??'shared-edition'}:null});
    if(Buffer.byteLength(html)>100000)throw Error('CARD_PAGE_TOO_LARGE');send(200,html);
  }catch(error){const status=error instanceof PublicCardError?error.status:503;send(status,renderSharedError(status));}
}
export default handleCard;
