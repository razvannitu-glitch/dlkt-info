import type {IncomingMessage,ServerResponse} from 'node:http';
import {createNewsPageService,parseNewsPageRequest,NewsPageError,type NewsPageReader} from '../src/iceo/news-page.js';

let singleton:NewsPageReader|null|undefined;
function publicReader():NewsPageReader|null {return singleton??=createNewsPageService(process.env);}
/** Public reads consult the committed corpus only. Acquisition remains inside the authenticated refresh job. */
export async function handleNewsPage(request:IncomingMessage,response:ServerResponse,reader?:NewsPageReader|null):Promise<void> {
 response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('X-Content-Type-Options','nosniff');
 response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
 const send=(status:number,value:unknown):void=>{response.statusCode=status;response.end(request.method==='HEAD'?'':JSON.stringify(value));};
 if(!['GET','HEAD'].includes(request.method??'')){response.setHeader('Allow','GET, HEAD');send(405,{error:'METHOD_NOT_ALLOWED'});return;}
 try{
  const query=parseNewsPageRequest(request.url??''),source=reader===undefined?publicReader():reader;
  if(!source)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  const page=await source.read(query),body=JSON.stringify(page);
  if(Buffer.byteLength(body,'utf8')>1048576)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  response.setHeader('X-DLKT-News-Epoch',page.epoch);response.setHeader('X-DLKT-News-Revision',String(page.revision));
  response.setHeader('X-DLKT-News-Expires-At',page.expiresAt);
  response.statusCode=200;response.end(request.method==='HEAD'?'':body);
 }catch(error){
  const code=error instanceof NewsPageError?error.code:'NEWS_CORPUS_UNAVAILABLE';
  const status=code==='NEWS_EDITION_EXPIRED'?410:code==='NEWS_CORPUS_UNAVAILABLE'?503:400;
  if(status===503)response.setHeader('Retry-After','30');send(status,{error:code});
 }
}
export default handleNewsPage;
