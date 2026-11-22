import {parseDocument,DomUtils} from 'htmlparser2';
import {publisherForNewsUrl} from '../iceo/news-sources.js';
import {newsSourceForUrl} from '../local/news-policy.js';

export interface PhotoArticle {
 readonly id:string; readonly revision:string; readonly sourceUrl:string; readonly title:string;
 readonly publisher:string; readonly publishedAt:string; readonly validUntil:number;
}
export interface ArticlePhotoMetadata {
 readonly articleUrl:string; readonly imageUrl:string; readonly basis:'article-jsonld'|'article-opengraph';
 readonly alt:string; readonly credit:string|null; readonly caption:string|null;
 readonly expectedDimensions?:{readonly width:number;readonly height:number};
}
export const PHOTO_HTML_LIMIT=1_048_576;
const object=(value:unknown):value is Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clean=(value:unknown,limit=500):string|null=>typeof value==='string'&&value.length<=limit&&!/[\u0000-\u001f\u007f<>]/u.test(value)?value.replace(/\s+/gu,' ').trim()||null:null;
const normalize=(value:string):string=>value.normalize('NFKC').toLowerCase().replace(/[‘’]/gu,"'").replace(/[“”]/gu,'"').replace(/\s+/gu,' ').trim();
function url(value:unknown,base?:string):URL|null {
 if(typeof value!=='string'||value.length>3000||/[\u0000-\u0020\u007f<>\\]/u.test(value))return null;
 try{const parsed=base?new URL(value,base):new URL(value);
  return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port?parsed:null;
 }catch{return null;}
}
export function photoPublisher(articleUrl:string):string|null {
 const parsed=url(articleUrl);if(!parsed||parsed.hash||parsed.href!==articleUrl||parsed.pathname==='/')return null;
 const local=newsSourceForUrl(articleUrl);if(local)return local.id;
 const reviewed=publisherForNewsUrl(articleUrl);if(reviewed)return Object.hasOwn(ASSET_PATHS,reviewed.id)?reviewed.id:null;
 if(['www.nasa.gov','science.nasa.gov'].includes(parsed.hostname))return'nasa';
 return null;
}
const ASSET_PATHS:Readonly<Record<string,Readonly<Record<string,readonly string[]>>>>=Object.freeze({
 'bucharest-b365':{'b365.ro':['/wp-content/uploads/']},
 'bucharest-buletin':{'buletin.de':['/bucuresti/wp-content/uploads/','/wp-content/uploads/']},
 // Exact article metadata and same-origin upload path verified by primary probe45051739949.
 'hotnews':{'hotnews.ro':['/wp-content/uploads/']},
 'digi24':{'s.iw.ro':['/gateway/g/']},
 'guardian':{'i.guim.co.uk':['/img/media/'],'media.guim.co.uk':['/']},
 'bbc':{'ichef.bbci.co.uk':['/news/','/ace/','/images/ic/'],'ichef.bbci.co.uk.edgesuite.net':['/news/']},
 'the-hindu':{'th-i.thgim.com':['/public/','/incoming/'],'www.thehindu.com':['/incoming/','/news/','/sport/']},
 'france24':{'s.france24.com':['/media/display/']},
 'dw':{'static.dw.com':['/image/']},
 'global-voices':{'globalvoices.org':['/wp-content/uploads/'],'www.globalvoices.org':['/wp-content/uploads/']},
 'nasa':{'www.nasa.gov':['/wp-content/uploads/'],'science.nasa.gov':['/wp-content/uploads/'],'images-assets.nasa.gov':['/image/']},
});
/** Only publisher-owned, reviewed raster paths. Never accept an arbitrary proxy URL. */
export function articleImageUrl(value:unknown,articleUrl:string):string|null {
 const article=url(articleUrl),publisher=photoPublisher(articleUrl);if(!article||!publisher)return null;
 const candidate=url(value,articleUrl),paths=candidate?ASSET_PATHS[publisher]?.[candidate.hostname]:undefined;
 if(!candidate||candidate.hash||!paths?.some(path=>candidate.pathname.startsWith(path)))return null;
 let pathname:string;try{pathname=decodeURIComponent(candidate.pathname);}catch{return null;}
 if(/[\\\u0000-\u0020\u007f]/u.test(pathname)||/(?:^|\/)\.\.?(?:\/|$)/u.test(pathname)
  ||/(?:^|[/_.-])(?:logo|favicon|placeholder|default-image|default-share|tracking-pixel)(?:[/_.-]|$)/iu.test(pathname))return null;
 if(!/\.(?:jpe?g|png|webp)(?:\/|$)/iu.test(pathname)&&!['guardian','bbc','dw','france24'].includes(publisher))return null;
 for(const [key,item] of candidate.searchParams){
  if(/url|src|source|redirect|proxy|host|callback/iu.test(key)||/^https?:/iu.test(item)||item.length>512)return null;
 }
 return candidate.href;
}
const samePage=(value:unknown,articleUrl:string):boolean=>{
 const parsed=url(value,articleUrl);if(!parsed)return false;parsed.hash='';return parsed.href===articleUrl;
};
const matchesTitle=(value:unknown,article:PhotoArticle):boolean=>{
 const headline=clean(value,600);if(headline===null)return false;
 const suffix=new RegExp('\\s+[–—|:-]\\s+'+article.publisher.replace(/[.*+?^{}$()|[\]\\]/gu,'\\$&')+'\\s*$','iu');
 return normalize(headline.replace(suffix,''))===normalize(article.title.replace(suffix,''));
};

type PhotoDimensions={readonly width:number;readonly height:number};
function oversizedWordPressPreview(first:ArticlePhotoMetadata,article:PhotoArticle,dimensions:PhotoDimensions|undefined,declared:readonly string[]):ArticlePhotoMetadata {
 const publisher=photoPublisher(article.sourceUrl);
 if(!dimensions||!['bucharest-b365','bucharest-buletin'].includes(publisher??'')
  ||dimensions.width<=8000&&dimensions.height<=8000&&dimensions.width*dimensions.height<=24000000)return first;
 const original=new URL(first.imageUrl);
 const parts=/^(.*?)(?:-([1-9]\d{1,4})x([1-9]\d{1,4}))?(\.(?:jpe?g|png|webp))$/u;
 const identity=parts.exec(original.pathname);if(!identity)return first;
 const ratio=dimensions.width/dimensions.height;
 const choices:{url:string;width:number;height:number}[]=[];
 for(const raw of declared.slice(0,20)){
  const href=articleImageUrl(raw,article.sourceUrl);if(!href)continue;
  const candidate=new URL(href),match=parts.exec(candidate.pathname);
  if(candidate.origin!==original.origin||!match||match[1]!==identity[1]||match[4]!==identity[4]||!match[2]||!match[3])continue;
  const width=Number(match[2]),height=Number(match[3]);
  if(width<640||width>1600||height<120||height>2400||Math.abs(width/height-ratio)>ratio*0.02)continue;
  choices.push({url:href,width,height});
 }
 const chosen=choices.sort((a,b)=>Math.abs(a.width-1200)-Math.abs(b.width-1200)||a.width-b.width)[0];
 return chosen?{...first,imageUrl:chosen.url,expectedDimensions:{width:chosen.width,height:chosen.height}}:first;
}

const articleTypes=new Set(['NewsArticle','Article','ReportageNewsArticle','AnalysisNewsArticle','BlogPosting','TechArticle','ScholarlyArticle','LiveBlogPosting']);
/** Read only explicitly article-bound metadata; recommendations and site logos are not candidates. */
export function readArticlePhoto(html:string,article:PhotoArticle,finalUrl=article.sourceUrl):ArticlePhotoMetadata|null {
 if(Buffer.byteLength(html)>PHOTO_HTML_LIMIT||!photoPublisher(article.sourceUrl)||finalUrl!==article.sourceUrl)return null;
 const document=parseDocument(html,{decodeEntities:true,withStartIndices:true,withEndIndices:true});
 const complete=(node:{readonly startIndex:number|null;readonly endIndex:number|null},script=false):boolean=>{
  if(node.startIndex===null||node.endIndex===null)return false;
  const raw=html.slice(node.startIndex,node.endIndex+1);return script?/<\/script\s*>$/iu.test(raw):raw.endsWith('>');
 };
 const metas=DomUtils.getElementsByTagName('meta',document,true).filter(node=>complete(node));
 const canonical=DomUtils.getElementsByTagName('link',document,true).filter(node=>complete(node)&&(node.attribs.rel??'').toLowerCase().split(/\s+/u).includes('canonical'));
 const fields=new Map<string,string[]>();
 for(const meta of metas){const key=(meta.attribs.property??meta.attribs.name??'').toLowerCase(),value=meta.attribs.content;if(value){const values=fields.get(key)??[];values.push(value);fields.set(key,values);}}
 const bindings=[...canonical.map(node=>node.attribs.href),...(fields.get('og:url')??[])];
 if(bindings.some(value=>!samePage(value,article.sourceUrl)))return null;
 const expectedDate=Date.parse(article.publishedAt);
 if((fields.get('article:published_time')??[]).some(value=>!Number.isFinite(Date.parse(value))||Number.isFinite(expectedDate)&&Math.abs(Date.parse(value)-expectedDate)>86400000))return null;
 const documents:unknown[]=[],imageObjects=new Map<string,Record<string,unknown>>(),conflictingImages=new Set<string>();let indexed=0;
 const imageId=(value:unknown):string|null=>{const parsed=url(value,article.sourceUrl);return parsed&&samePage(parsed.href,article.sourceUrl)&&parsed.hash?parsed.href:null;};
 const indexImages=(value:unknown,depth=0):void=>{
  if(depth>8||++indexed>500)return;
  if(Array.isArray(value)){for(const child of value.slice(0,100))indexImages(child,depth+1);return;}
  if(!object(value))return;
  const types=Array.isArray(value['@type'])?value['@type']:[value['@type']],id=imageId(value['@id']);
  if(id&&types.includes('ImageObject')){
   if(imageObjects.has(id))conflictingImages.add(id);else imageObjects.set(id,value);
  }
  if(value['@graph']!==undefined)indexImages(value['@graph'],depth+1);
  if(value.mainEntity!==undefined)indexImages(value.mainEntity,depth+1);
 };
 for(const script of DomUtils.getElementsByTagName('script',document,true).slice(0,150)){
  if((script.attribs.type??'').toLowerCase()!=='application/ld+json'||!complete(script,true))continue;
  const raw=DomUtils.textContent(script);if(raw.length>200000)continue;
  try{const value:unknown=JSON.parse(raw);documents.push(value);indexImages(value);}catch{/* A separate complete block may remain usable. */}
 }
 const images:ArticlePhotoMetadata[]=[],dimensions=new Map<string,PhotoDimensions>();let nodes=0;
 const inspect=(value:unknown,depth=0):void=>{
  if(depth>8||++nodes>250)return;
  if(Array.isArray(value)){for(const child of value.slice(0,100))inspect(child,depth+1);return;}
  if(!object(value))return;
  const types=Array.isArray(value['@type'])?value['@type']:[value['@type']];
  if(types.some(type=>typeof type==='string'&&articleTypes.has(type))){
   const entity=value.mainEntityOfPage;
   const declared=[value.url,value['@id'],typeof entity==='string'?entity:undefined,object(entity)?entity['@id']:undefined,object(entity)?entity.url:undefined].filter(item=>item!==undefined);
   if(declared.length>0&&declared.every(item=>samePage(item,article.sourceUrl))
    &&(matchesTitle(value.headline??value.name,article)||matchesTitle(value.alternativeHeadline,article))){
    const published=typeof value.datePublished==='string'?Date.parse(value.datePublished):NaN;
    const expected=Date.parse(article.publishedAt);
    if(Number.isFinite(published)&&Number.isFinite(expected)&&Math.abs(published-expected)>86400000)return;
    const entries=Array.isArray(value.image)?value.image.slice(0,6):[value.image];
    for(const entry of entries){
     const id=object(entry)?imageId(entry['@id']):typeof entry==='string'?imageId(entry):null;
     const image=id&&!conflictingImages.has(id)?imageObjects.get(id)??entry:entry;
     const candidate=typeof image==='string'?image:object(image)?image.contentUrl??image.url:undefined;
     const imageUrl=articleImageUrl(candidate,article.sourceUrl);if(!imageUrl)continue;
     const caption=object(image)?clean(image.caption):null;
     const author=object(image)?image.creator??image.author:undefined;
     const credit=object(image)?clean(image.creditText,200)??clean(typeof author==='string'?author:object(author)?author.name:undefined,200):null;
     if(object(image)&&typeof image.width==='number'&&typeof image.height==='number'
      &&Number.isSafeInteger(image.width)&&Number.isSafeInteger(image.height)&&image.width>0&&image.height>0)
      dimensions.set(imageUrl,{width:image.width,height:image.height});
     images.push({articleUrl:article.sourceUrl,imageUrl,basis:'article-jsonld',alt:caption??'',credit,caption});
    }
   }
  }
  if(value['@graph']!==undefined)inspect(value['@graph'],depth+1);
  if(value.mainEntity!==undefined)inspect(value.mainEntity,depth+1);
 };
 for(const value of documents)inspect(value);
 if(images.length){
  const first=images[0];if(!first)return null;
  const initial=new URL(first.imageUrl),identity=/^\/img\/media\/([^/]+)\//u.exec(initial.pathname)?.[1];
  if(initial.hostname==='i.guim.co.uk'&&identity){
   const score=(item:ArticlePhotoMetadata):number=>{const candidate=new URL(item.imageUrl);return([...candidate.searchParams.keys()].some(key=>key.startsWith('overlay'))?100:0)+(candidate.searchParams.has('height')?2:0)+(candidate.searchParams.get('fit')==='max'?0:1);};
   return images.filter(item=>{const candidate=new URL(item.imageUrl);return candidate.hostname===initial.hostname&&/^\/img\/media\/([^/]+)\//u.exec(candidate.pathname)?.[1]===identity;}).sort((a,b)=>score(a)-score(b))[0]??first;
  }
  return oversizedWordPressPreview(first,article,dimensions.get(first.imageUrl),[
   ...images.slice(1).map(item=>item.imageUrl),...(fields.get('og:image:secure_url')??[]),...(fields.get('og:image')??[]),
  ]);
 }
 // A public OG image is publisher-selected preview metadata, never a CC licence or an event-date claim.
 if(bindings.length===0||!(fields.get('og:title')??[]).some(title=>matchesTitle(title,article)))return null;
 if(!(fields.get('og:type')??[]).includes('article')&&!(fields.get('article:published_time')??[]).length)return null;
 for(const raw of [...(fields.get('og:image:secure_url')??[]),...(fields.get('og:image')??[])]){
  const imageUrl=articleImageUrl(raw,article.sourceUrl);if(!imageUrl)continue;
  return{articleUrl:article.sourceUrl,imageUrl,basis:'article-opengraph',alt:clean(fields.get('og:image:alt')?.[0])??'',credit:null,caption:null};
 }
 return null;
}
