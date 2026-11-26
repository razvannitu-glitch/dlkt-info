import {publisherForNewsUrl} from '../iceo/news-sources.js';
import {newsSourceForUrl} from '../local/news-policy.js';

export interface ArticlePhotoReference {
 readonly id:string;
 readonly revision:string;
 readonly cityId?:string;
}
const PATH='/api/article-photo';
const ORIGIN='https://www.dlkt.ee';
const globalId=/^[a-f0-9]{24}$/u;
const revision=/^[a-f0-9]{64}$/u;
const cityId=/^[1-9]\d{0,11}$/u;
const localId=/^local-news:([1-9]\d{0,11}):[a-z0-9]+(?:-[a-z0-9]+)*:[a-f0-9]{24}$/u;

function validReference(value:unknown):value is ArticlePhotoReference {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const item=value as Record<string,unknown>,keys=Reflect.ownKeys(item);
 if(keys.some(key=>key!=='id'&&key!=='revision'&&key!=='cityId')||!Object.hasOwn(item,'id')||!Object.hasOwn(item,'revision')
  ||typeof item.id!=='string'||item.id.length>100||typeof item.revision!=='string'||!revision.test(item.revision))return false;
 if(!Object.hasOwn(item,'cityId'))return keys.length===2&&globalId.test(item.id);
 if(keys.length!==3||typeof item.cityId!=='string'||!cityId.test(item.cityId))return false;
 return localId.exec(item.id)?.[1]===item.cityId
  ||item.cityId==='683506'&&/^bucharest:arcub:[a-f0-9]{24}$/u.test(item.id);
}

/** A public record ID and exact evidence revision only; never a remotely supplied image/article URL. */
export function articlePhotoPath(ref:ArticlePhotoReference):string {
 if(!validReference(ref))throw Error('ARTICLE_PHOTO_REFERENCE_INVALID');
 const query=new URLSearchParams({id:ref.id,v:ref.revision});
 if(ref.cityId!==undefined)query.set('city',ref.cityId);
 return PATH+'?'+query.toString();
}

/** Strict relative route or canonical public URL. Reject aliases, duplicate fields and normalized paths. */
export function parseArticlePhotoReference(input:URL|string):ArticlePhotoReference|null {
 const raw=input instanceof URL?input.href:input;
 if(typeof raw!=='string'||raw.length>512||/[\\\u0000-\u0020\u007f#]/u.test(raw))return null;
 const route=raw.startsWith(ORIGIN+'/')?raw.slice(ORIGIN.length):raw;
 if(!route.startsWith(PATH+'?')||route.startsWith('//')||route.split('?')[0]!==PATH)return null;
 try{
  const url=new URL(route,ORIGIN);
  if(url.origin!==ORIGIN||url.pathname!==PATH||url.hash||url.username||url.password||url.port)return null;
  if(url.search.slice(1).split('&').some(field=>field.split('=')[0]?.includes('%')))return null;
  const params=url.searchParams;
  if([...params.keys()].some(key=>!['id','v','city'].includes(key))
   ||params.getAll('id').length!==1||params.getAll('v').length!==1||params.getAll('city').length>1)return null;
  const ref={id:params.get('id'),revision:params.get('v'),...(params.has('city')?{cityId:params.get('city')}:{})};
  return validReference(ref)?Object.freeze(ref):null;
 }catch{return null;}
}

/** The same reviewed photo eligibility policy is used by browser and server. */
export function parseArticlePhotoUrl(value:unknown,base?:string):URL|null {
 if(typeof value!=='string'||value.length>3000||/[\u0000-\u0020\u007f<>\\]/u.test(value))return null;
 try{const parsed=base?new URL(value,base):new URL(value);
  return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port?parsed:null;
 }catch{return null;}
}
export function photoPublisher(articleUrl:string):string|null {
 const parsed=parseArticlePhotoUrl(articleUrl);if(!parsed||parsed.hash||parsed.href!==articleUrl||parsed.pathname==='/')return null;
 if(parsed.origin==='https://arcub.ro'&&!parsed.search&&/^\/eveniment\/[a-z0-9-]+$/u.test(parsed.pathname))return'bucharest-arcub';
 const local=newsSourceForUrl(articleUrl);if(local)return local.id;
 const reviewed=publisherForNewsUrl(articleUrl);if(reviewed)return Object.hasOwn(ASSET_PATHS,reviewed.id)?reviewed.id:null;
 if(['www.nasa.gov','science.nasa.gov'].includes(parsed.hostname))return'nasa';
 return null;
}
const ASSET_PATHS:Readonly<Record<string,Readonly<Record<string,readonly string[]>>>>=Object.freeze({
 // ARCUB original page-header images, observed in probe45726653109; generic social metadata is excluded below.
 'bucharest-arcub':{'arcub.ro':['/img/']},
 'bucharest-b365':{'b365.ro':['/wp-content/uploads/']},
 'bucharest-buletin':{'buletin.de':['/bucuresti/wp-content/uploads/','/wp-content/uploads/']},
 // Exact article metadata and same-origin upload path verified by primary probe45051739949.
 'hotnews':{'hotnews.ro':['/wp-content/uploads/']},
 'digi24':{'s.iw.ro':['/gateway/g/']},
 // Primary metadata receipt45070034177: both originals bind this exact publisher CDN upload path.
 'repubblica':{'www.repstatic.it':['/content/nazionale/img/']},
 'guardian':{'i.guim.co.uk':['/img/media/'],'media.guim.co.uk':['/']},
 'bbc':{'ichef.bbci.co.uk':['/news/','/ace/','/images/ic/'],'ichef.bbci.co.uk.edgesuite.net':['/news/']},
 'the-hindu':{'th-i.thgim.com':['/public/','/incoming/'],'www.thehindu.com':['/incoming/','/news/','/sport/']},
 'france24':{'s.france24.com':['/media/display/']},
 'dw':{'static.dw.com':['/image/']},
 'global-voices':{'globalvoices.org':['/wp-content/uploads/'],'www.globalvoices.org':['/wp-content/uploads/']},
 'nasa':{'www.nasa.gov':['/wp-content/uploads/'],'science.nasa.gov':['/wp-content/uploads/'],'images-assets.nasa.gov':['/image/']},
});
export function articlePhotoAssetPaths(publisher:string,hostname:string):readonly string[]|undefined {
 return ASSET_PATHS[publisher]?.[hostname];
}
