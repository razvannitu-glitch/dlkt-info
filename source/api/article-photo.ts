import type {IncomingMessage,ServerResponse} from 'node:http';
import {createHash} from 'node:crypto';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import type {IceoSnapshot} from '../src/iceo/contracts.js';
import {validCard} from '../src/iceo/card-validation.js';
import {validArchiveCard} from '../src/share/archive.js';
import {validNewsGlobalCard} from '../src/iceo/news-page-contracts.js';
import {createNewsCorpusStore,type NewsCorpusStore} from '../src/iceo/news-corpus-store.js';
import {findCity} from '../src/local/cities.js';
import {currentLocalSnapshot,type City} from '../src/local/contracts.js';
import {localPublicationService,type LocalPublications} from '../src/local/publications.js';
import {localCardPhotoReference} from '../src/local/photo-reference.js';
import {arcubPhotoRevision} from '../src/local/arcub.js';
import {localNewsService} from '../src/local/news-service.js';
import {validLocalNewsArticle,type CityNewsSnapshot} from '../src/local/news-policy.js';
import {parseArticlePhotoReference,type ArticlePhotoReference} from '../src/media/article-photo-reference.js';
import {photoPublisher,type PhotoArticle} from '../src/media/article-photo-source.js';
import {articlePhotoService,type ArticlePhotoResult} from '../src/media/article-photo-service.js';

export interface ArticlePhotoDependencies {
 readonly global:()=>Promise<IceoSnapshot>;
 readonly local:(city:City)=>Promise<CityNewsSnapshot>;
 readonly photos:{read(article:PhotoArticle):Promise<ArticlePhotoResult|null>};
 readonly clock:()=>number;
 readonly corpus?:Pick<NewsCorpusStore,'lookup'>;
 readonly official?:(city:City)=>Promise<LocalPublications>;
}
const corpusStore=createNewsCorpusStore(process.env);
const dependencies:ArticlePhotoDependencies={...(corpusStore?{corpus:corpusStore}:{}),global:publicIceoSnapshot,local:city=>localNewsService.snapshot(city),official:city=>localPublicationService.snapshot(city),photos:articlePhotoService,clock:Date.now};
/** Resolve server-side from a current, validated listing. No remote URL is accepted by this endpoint. */
export async function resolvePhotoArticle(reference:ArticlePhotoReference,services:ArticlePhotoDependencies):Promise<PhotoArticle|null>{
 if(reference.id.startsWith('bucharest:arcub:')){
  if(reference.cityId!=='683506'||!services.official)return null;
  const city=findCity(reference.cityId);if(!city)return null;
  const listing=await services.official(city),now=services.clock();
  const card=listing.cards.find(value=>value.id===reference.id);
  if(!card||!card.context||card.id!=='bucharest:arcub:'+createHash('sha256').update(card.sourceUrl).digest('hex').slice(0,24)
   ||!localCardPhotoReference(card,city.id,now))return null;
  const semantic=arcubPhotoRevision(card,city.id);
  if(!semantic||card.photoRevision!==undefined&&card.photoRevision!==semantic
   ||reference.revision!==semantic&&reference.revision!==card.context.documentHash)return null;
  // Legacy clients may use only the exact current raw hash; no historical revision is accepted.
  // This projection retains the source check times; it does not stamp a new successful check.
  const snapshot={version:'dlkt-local-1',city,checkedAt:card.checkedAt,state:'partial',weatherState:'unavailable',transportState:'not-covered',
   cards:[card],coverage:listing.coverage.filter(value=>value.domain==='events')};
  if(!currentLocalSnapshot(snapshot,city,now)||photoPublisher(card.sourceUrl)!=='bucharest-arcub')return null;
  return{id:card.id,revision:card.context.documentHash,sourceUrl:card.sourceUrl,title:card.title,publisher:card.publisher,
   publishedAt:'',documentKind:'local-event',validUntil:Date.parse(card.validTo)};
 }
 if(services.corpus){
  try{
   const item=await services.corpus.lookup(reference),now=services.clock();
   if(item?.kind==='global'&&reference.cityId===undefined&&item.card.id===reference.id&&item.card.contentHash===reference.revision
    &&validArchiveCard(item.card)&&validNewsGlobalCard(item.card,now)&&photoPublisher(item.card.sourceUrl)){
    const article=item.card;
    return {id:article.id,revision:article.contentHash,sourceUrl:article.sourceUrl,title:article.title,publisher:article.publisher,publishedAt:article.date,
     validUntil:Math.min(now+300000,Date.parse(article.observedAt)+3600000,Date.parse(article.date)+86400000)};
   }
   if(item?.kind==='local'&&reference.cityId!==undefined){
    const city=findCity(reference.cityId),article=item.card.news;
    if(city&&article&&article.id===reference.id&&article.documentHash===reference.revision&&validLocalNewsArticle(article,city,now)&&photoPublisher(article.url))
     return {id:article.id,revision:article.documentHash,sourceUrl:article.url,title:article.title,publisher:article.publisher,publishedAt:article.publishedAt,validUntil:Date.parse(article.validUntil)};
   }
  }catch{/* Existing current snapshot resolution remains available. */}
 }
 if(reference.cityId!==undefined){
  const city=findCity(reference.cityId);if(!city)return null;
  const snapshot=await services.local(city),completed=services.clock();
  const article=snapshot.articles.find(value=>value.id===reference.id&&value.documentHash===reference.revision);
  if(!article||!validLocalNewsArticle(article,city,completed)||!photoPublisher(article.url))return null;
  return{id:article.id,revision:article.documentHash,sourceUrl:article.url,title:article.title,publisher:article.publisher,publishedAt:article.publishedAt,validUntil:Date.parse(article.validUntil)};
 }
 const snapshot=await services.global(),completed=services.clock(),generated=Date.parse(snapshot.generatedAt);
 if(snapshot.state==='unavailable'||!Number.isFinite(generated)||generated>completed+300000||generated<=completed-3600000)return null;
 const article=snapshot.cards.find(value=>value.id===reference.id&&value.contentHash===reference.revision);
 if(!article||article.kind!=='publication'||!validCard(article)||!photoPublisher(article.sourceUrl))return null;
 return{id:article.id,revision:article.contentHash,sourceUrl:article.sourceUrl,title:article.title,publisher:article.publisher,publishedAt:article.date,validUntil:Math.min(completed+300000,generated+3600000)};
}
export async function handleArticlePhoto(req:IncomingMessage,res:ServerResponse,services:ArticlePhotoDependencies=dependencies):Promise<void>{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 const error=(status:number):void=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(req.method==='HEAD'?'':JSON.stringify({error:status===400?'INVALID_PHOTO_REFERENCE':status===405?'METHOD_NOT_ALLOWED':'ARTICLE_PHOTO_UNAVAILABLE'}));};
 if(!['GET','HEAD'].includes(req.method??'')){res.setHeader('Allow','GET, HEAD');error(405);return;}
 const reference=parseArticlePhotoReference(req.url??'');if(!reference){error(400);return;}
 try{
  const article=await resolvePhotoArticle(reference,services);if(!article){error(404);return;}
  const photo=await services.photos.read(article);
  if(!photo||photo.until<=services.clock()||photo.metadata.articleUrl!==article.sourceUrl){res.setHeader('Cache-Control','public, max-age=0, s-maxage=30');error(404);return;}
  const etag='"'+photo.sha256+'"',age=Math.max(0,Math.min(60,Math.floor((photo.until-services.clock())/1000)));
  res.setHeader('Content-Type',photo.mime);res.setHeader('ETag',etag);res.setHeader('Cache-Control','public, max-age=0, s-maxage='+age+', must-revalidate');
  res.setHeader('X-DLKT-Photo-Basis',photo.metadata.basis);res.setHeader('X-DLKT-Photo-SHA256',photo.sha256);
  res.setHeader('Link','<'+article.sourceUrl+'>; rel="canonical"');
  if(req.headers['if-none-match']===etag){res.statusCode=304;res.end();return;}
  res.setHeader('Content-Length',String(photo.bytes.byteLength));res.statusCode=200;res.end(req.method==='HEAD'?undefined:photo.bytes);
 }catch{res.setHeader('Retry-After','30');error(503);}
}
export default handleArticlePhoto;
