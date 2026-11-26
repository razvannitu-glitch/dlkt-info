import {createHash} from 'node:crypto';
import {localeFromPreference,type Locale} from '../i18n/locale.js';
import {findCity} from '../local/cities.js';
import {validArchiveCard} from '../share/archive.js';
import type {NewsArticleReference,NewsCorpusStore} from './news-corpus-store.js';
import {newsOriginalLanguage,validNewsEpochId,validNewsPageItem} from './news-page-contracts.js';

export const NEWS_TRANSLATION_VERSION='dlkt-news-translation-1' as const;

export interface NewsTranslationFields {
 readonly title:string;
 readonly summary?:string;
}
export interface NewsTranslationOriginal {
 readonly kind:'global'|'local';
 readonly id:string;
 readonly identity:string;
 readonly revision:string;
 readonly fieldsHash:string;
}
export interface ResolvedNewsTranslation {
 readonly version:typeof NEWS_TRANSLATION_VERSION;
 readonly key:string;
 readonly original:NewsTranslationOriginal;
 readonly sourceLanguage:string|null;
 readonly targetLocale:Locale;
 readonly translatorVersion:string;
 /** Exact public publisher fields only. Never send the complete original or account data. */
 readonly fields:NewsTranslationFields;
}
export interface NewsTranslationProjection {
 readonly version:typeof NEWS_TRANSLATION_VERSION;
 readonly key:string;
 readonly original:NewsTranslationOriginal;
 readonly sourceLanguage:string|null;
 readonly targetLocale:Locale;
 readonly translatorVersion:string;
 /** Untrusted plain text. Future presentation must use textContent, never markup evaluation. */
 readonly translated:NewsTranslationFields;
}
interface TranslationRequest {
 readonly reference:NewsArticleReference;
 readonly epoch:string;
 readonly targetLocale:Locale;
 readonly translatorVersion:string;
}
type SourceReader=Pick<NewsCorpusStore,'lookup'>;
interface ResolutionAuthority {
 readonly store:SourceReader;
 readonly request:TranslationRequest;
 readonly clock:()=>number;
}
const issued=new WeakMap<ResolvedNewsTranslation,ResolutionAuthority>();
const HASH=/^[a-f0-9]{64}$/u;
const VERSION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u;
const ORIGINAL_KEYS=['kind','id','identity','revision','fieldsHash'] as const;
const PROJECTION_KEYS=['version','key','original','sourceLanguage','targetLocale','translatorVersion','translated'] as const;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:readonly string[]):boolean=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const text=(value:unknown,max:number):value is string=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

export class NewsTranslationError extends Error {
 constructor(readonly code:'NEWS_TRANSLATION_REQUEST_INVALID'|'NEWS_TRANSLATION_SOURCE_UNAVAILABLE'){
  super(code);this.name='NewsTranslationError';
 }
}
function validReference(value:unknown):value is NewsArticleReference {
 if(!object(value)||!exact(value,value.cityId===undefined?['id','revision']:['id','revision','cityId'])
  ||typeof value.id!=='string'||typeof value.revision!=='string'||!HASH.test(value.revision))return false;
 if(value.cityId===undefined)return /^[a-f0-9]{24}$/u.test(value.id);
 if(typeof value.cityId!=='string')return false;
 const city=findCity(value.cityId);
 return city!==null&&new RegExp('^local-news:'+city.id+':[a-z0-9-]{1,80}:[a-f0-9]{24}$','u').test(value.id);
}
function requestCopy(value:unknown):TranslationRequest {
 if(!object(value)||!exact(value,['reference','epoch','targetLocale','translatorVersion'])
  ||!validReference(value.reference)||!validNewsEpochId(value.epoch)||localeFromPreference(value.targetLocale)===null
  ||typeof value.translatorVersion!=='string'||!VERSION.test(value.translatorVersion))throw new NewsTranslationError('NEWS_TRANSLATION_REQUEST_INVALID');
 const reference=value.reference;
 return Object.freeze({
  reference:Object.freeze({id:reference.id,revision:reference.revision,...(reference.cityId===undefined?{}:{cityId:reference.cityId})}),
  epoch:value.epoch,targetLocale:value.targetLocale as Locale,translatorVersion:value.translatorVersion,
 });
}
function unavailable():never {throw new NewsTranslationError('NEWS_TRANSLATION_SOURCE_UNAVAILABLE');}

/** Server-only. Existing committed-corpus lookup remains the sole public-source authority. */
async function readResolution(authority:ResolutionAuthority):Promise<ResolvedNewsTranslation|null> {
 const {store,request,clock}=authority;
 let item:Awaited<ReturnType<SourceReader['lookup']>>;
 try{item=await store.lookup(request.reference,request.epoch);}catch{return unavailable();}
 if(item===null)return null;
 const now=clock(),city=request.reference.cityId===undefined?null:findCity(request.reference.cityId);
 if(!Number.isFinite(now)||!validNewsPageItem(item,now,city??undefined)
  ||item.card.id!==request.reference.id)return unavailable();
 let identity:string,revision:string,summary:string|undefined;
 if(item.kind==='global'){
  if(request.reference.cityId!==undefined||!validArchiveCard(item.card))return unavailable();
  identity=item.card.identity;revision=item.card.contentHash;summary=item.card.summary;
 }else{
  if(!city||item.card.news?.cityId!==city.id)return unavailable();
  identity=item.card.sourceUrl;revision=item.card.news.documentHash;summary=item.card.news.summary;
 }
 if(revision!==request.reference.revision||!text(item.card.title,4000)||summary!==undefined&&!text(summary,1000))return unavailable();
 const fields:NewsTranslationFields=Object.freeze({title:item.card.title,...(summary===undefined?{}:{summary})});
 const original:NewsTranslationOriginal=Object.freeze({
  kind:item.kind,id:item.card.id,identity,revision,
  fieldsHash:digest([NEWS_TRANSLATION_VERSION,'public-fields',fields.title,fields.summary??null]),
 });
 const sourceLanguage=newsOriginalLanguage(item);
 const key=digest([NEWS_TRANSLATION_VERSION,original.kind,original.id,original.identity,original.revision,
  original.fieldsHash,sourceLanguage,request.targetLocale,request.translatorVersion]);
 return Object.freeze({version:NEWS_TRANSLATION_VERSION,key,original,sourceLanguage,targetLocale:request.targetLocale,
  translatorVersion:request.translatorVersion,fields});
}

/** No arbitrary input text, provider credential, network adapter or private preference is accepted. */
export async function resolvePublicNewsTranslation(
 store:SourceReader,request:unknown,clock:()=>number=Date.now,
):Promise<ResolvedNewsTranslation|null> {
 const authority:ResolutionAuthority=Object.freeze({store,request:requestCopy(request),clock});
 if(!Number.isFinite(clock()))throw new NewsTranslationError('NEWS_TRANSLATION_REQUEST_INVALID');
 const resolved=await readResolution(authority);
 if(resolved)issued.set(resolved,authority);
 return resolved;
}

function candidateMatches(value:unknown,resolved:ResolvedNewsTranslation):value is NewsTranslationProjection {
 if(!object(value)||!exact(value,PROJECTION_KEYS)||value.version!==NEWS_TRANSLATION_VERSION||value.key!==resolved.key
  ||value.sourceLanguage!==resolved.sourceLanguage||value.targetLocale!==resolved.targetLocale||value.translatorVersion!==resolved.translatorVersion
  ||!object(value.original)||!exact(value.original,ORIGINAL_KEYS)||!object(value.translated))return false;
 const original=value.original,translated=value.translated;
 return ORIGINAL_KEYS.every(key=>original[key]===resolved.original[key])
  &&exact(translated,resolved.fields.summary===undefined?['title']:['title','summary'])
  &&text(translated.title,8000)&&(resolved.fields.summary===undefined||text(translated.summary,4000))
  &&Buffer.byteLength(JSON.stringify(translated),'utf8')<=48000;
}

/**
 * Revalidate current committed-source authority before using a provider/cache projection.
 * Binding to the current browser generation and locale remains the continuation controller's job.
 */
export async function acceptNewsTranslationProjection(
 resolved:ResolvedNewsTranslation,candidate:unknown,
):Promise<NewsTranslationProjection|null> {
 const authority=issued.get(resolved);
 if(!authority||!candidateMatches(candidate,resolved))return null;
 // Copy before awaiting: a mutable adapter/cache result must not change after validation.
 const translated:NewsTranslationFields=Object.freeze({title:candidate.translated.title,
  ...(candidate.translated.summary===undefined?{}:{summary:candidate.translated.summary})});
 let current:ResolvedNewsTranslation|null;
 try{current=await readResolution(authority);}catch{return null;}
 if(!current||current.key!==resolved.key)return null;
 return Object.freeze({version:NEWS_TRANSLATION_VERSION,key:resolved.key,original:resolved.original,
  sourceLanguage:resolved.sourceLanguage,targetLocale:resolved.targetLocale,translatorVersion:resolved.translatorVersion,translated});
}
