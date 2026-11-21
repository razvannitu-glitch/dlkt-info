import type {IncomingMessage,ServerResponse} from 'node:http';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import type {IceoSnapshot} from '../src/iceo/contracts.js';
import {PublicCardError} from '../src/share/current-card.js';
import type {ArchiveStore} from '../src/share/archive.js';
import {createArchiveStore} from '../src/share/archive-rest.js';
import {resolveShare} from '../src/share/resolve.js';
import {parseCardImageReference} from '../src/share/link.js';
import {cardImageService,type CardImageService} from '../src/share/image.js';
export async function handleCardImage(req:IncomingMessage,res:ServerResponse,load:()=>Promise<IceoSnapshot>=publicIceoSnapshot,images:Pick<CardImageService,'read'>=cardImageService,clock:()=>number=Date.now,archive:ArchiveStore|null=createArchiveStore(process.env)):Promise<void>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('X-Robots-Tag','noindex');
 const fail=(status:number,code:string):void=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');if(status===503)res.setHeader('Retry-After','10');res.end(req.method==='HEAD'?'':JSON.stringify({error:code}));};
 if(req.method!=='GET'&&req.method!=='HEAD'){res.setHeader('Allow','GET, HEAD');fail(405,'METHOD_NOT_ALLOWED');return;}
 const ref=parseCardImageReference(req.url??'');if(!ref||!ref.revision){fail(400,'IMAGE_REFERENCE_INVALID');return;}
 try{
  const resolution=await resolveShare(ref,load,archive,clock,true),resolved=resolution.current;
  // This is only a rendering/cache deadline. The PNG retains the original source-check date.
  const renderUntil=resolution.archived?clock()+60000:resolved.validUntil;
  const bytes=req.method==='HEAD'?null:await images.read(resolved.card,renderUntil);
  const ttl=Math.min(60,Math.floor((renderUntil-clock())/1000));if(ttl<1)throw Error('PREVIEW_EXPIRED');
  res.statusCode=200;res.setHeader('Content-Type','image/png');res.setHeader('Cache-Control',`public, max-age=${ttl}, s-maxage=${ttl}, no-transform`);if(bytes)res.setHeader('Content-Length',bytes.length);res.end(bytes?Buffer.from(bytes):undefined);
 }catch(error){fail(error instanceof PublicCardError?error.status:503,error instanceof PublicCardError?error.message:'CARD_IMAGE_UNAVAILABLE');}
}
export default handleCardImage;
