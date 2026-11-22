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
 return localId.exec(item.id)?.[1]===item.cityId;
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
