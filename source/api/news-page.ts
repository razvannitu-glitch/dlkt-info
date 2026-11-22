import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {createNewsPageService,parseNewsPageRequest,parseNewsSourcesRequest,NewsPageError,type NewsPageReader} from '../src/iceo/news-page.js';
import {validNewsPage,validNewsStorySourcesPage,NEWS_MAX_RESPONSE_BYTES} from '../src/iceo/news-page-contracts.js';
import {findCity} from '../src/local/cities.js';

let singleton:NewsPageReader|null|undefined;
function publicReader():NewsPageReader|null {return singleton??=createNewsPageService(process.env);}
/** Public reads consult the committed corpus only. Acquisition remains inside the authenticated refresh job. */
export async function handleNewsPage(request:IncomingMessage,response:ServerResponse,reader?:NewsPageReader|null,clock:()=>number=Date.now):Promise<void> {
 response.setHeader('Content-Type','application/json; charset=utf-8');response.setHeader('X-Content-Type-Options','nosniff');
 response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');
 const send=(status:number,value:unknown):void=>{response.statusCode=status;response.end(request.method==='HEAD'?'':JSON.stringify(value));};
 if(!['GET','HEAD'].includes(request.method??'')){response.setHeader('Allow','GET, HEAD');send(405,{error:'METHOD_NOT_ALLOWED'});return;}
 try{
  const sourcesCursor=parseNewsSourcesRequest(request.url??''),query=sourcesCursor===null?parseNewsPageRequest(request.url??''):null;
  const source=reader===undefined?publicReader():reader;
  if(!source)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  const page=sourcesCursor===null?await source.read(query!):await source.readSources(sourcesCursor);
  const city=page.cityId===null?undefined:findCity(page.cityId)??undefined,checkedAt=clock();
  if(!(sourcesCursor===null?validNewsPage(page,checkedAt,city):validNewsStorySourcesPage(page,checkedAt,city)))throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  const body=JSON.stringify(page);
  if(Buffer.byteLength(body,'utf8')>NEWS_MAX_RESPONSE_BYTES)throw new NewsPageError('NEWS_CORPUS_UNAVAILABLE');
  const now=clock(),remaining=Date.parse(page.expiresAt)-now;
  if(remaining<=0)throw new NewsPageError('NEWS_EDITION_EXPIRED');
  response.setHeader('X-DLKT-News-Epoch',page.epoch);response.setHeader('X-DLKT-News-Revision',String(page.revision));
  response.setHeader('X-DLKT-News-Expires-At',page.expiresAt);
  const headers=request.headers??{},ttl=Math.min(10,Math.floor(remaining/1000));
  // This route is public and never personalizes from credentials. Cache only
  // anonymous initial editions; no stale serving, source pages or cursor pages.
  if(sourcesCursor===null&&query?.cursor===null&&headers.authorization===undefined&&headers.cookie===undefined&&ttl>=1){
   response.setHeader('Cache-Control','public, max-age=0, s-maxage='+ttl+', must-revalidate');
   const etag='"'+createHash('sha256').update(body,'utf8').digest('hex')+'"';response.setHeader('ETag',etag);
   const condition=headers['if-none-match'],values=(Array.isArray(condition)?condition.join(','):condition??'').split(',').map(value=>value.trim());
   // The read and validity checks above always precede conditional responses.
   if(values.some(value=>value===etag||value==='W/'+etag||value==='*')){response.statusCode=304;response.end();return;}
  }
  response.statusCode=200;response.end(request.method==='HEAD'?'':body);
 }catch(error){
  const code=error instanceof NewsPageError?error.code:'NEWS_CORPUS_UNAVAILABLE';
  const status=code==='NEWS_EDITION_EXPIRED'?410:code==='NEWS_CORPUS_UNAVAILABLE'?503:400;
  response.setHeader('Cache-Control','no-store');
  if(status===503)response.setHeader('Retry-After','30');send(status,{error:code});
 }
}
export default handleNewsPage;
