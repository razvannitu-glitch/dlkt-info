import {displayPhotoFor,contextPhotoFor,type ReviewedPhoto,type ContextPhotoInput} from './catalog.js';
import type {ContextPhoto} from './context-photos.js';
import type {EvidenceCard} from '../iceo/contracts.js';

const watched=new WeakSet<HTMLImageElement>();
/** Cover parser-time errors as well as failures after lazy loading; retain all text/actions. */
export function watchCardPhotos(root:ParentNode):void {
 for(const image of root.querySelectorAll<HTMLImageElement>('img[data-reviewed-photo]')){
  if(watched.has(image))continue;watched.add(image);
  const remove=():void=>{const figure=image.closest<HTMLElement>('.card-photo');if(figure){figure.hidden=true;figure.remove();}};
  image.addEventListener('error',remove,{once:true});
  queueMicrotask(()=>{if(image.complete&&image.naturalWidth===0)remove();});
 }
}
export function photoNode(card:EvidenceCard,now=Date.now()):HTMLElement|null {
 const p=displayPhotoFor(card,now);if(!p)return null;
 return renderPhotoNode(p);
}
/** Local information has presentation metadata, never a fabricated EvidenceCard. */
export function contextPhotoNode(card:ContextPhotoInput,now=Date.now()):HTMLElement|null {
 const p=contextPhotoFor(card,now);return p?renderPhotoNode(p):null;
}
function renderPhotoNode(p:ReviewedPhoto|ContextPhoto):HTMLElement {
 const figure=document.createElement('figure');figure.className=`card-photo${p.fit==='contain'?' photo-contain':''}`;figure.dataset.photoId=p.key;
 figure.dataset.photoKind='kind' in p?'context':'source';
 const frame=document.createElement('div');frame.className='card-photo-frame';
 const image=document.createElement('img');image.src=p.path;image.alt=p.alt;image.width=p.width;image.height=p.height;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.dataset.reviewedPhoto=p.key;frame.append(image);
 const caption=document.createElement('figcaption');caption.append(document.createTextNode(`${p.caption} Image: ${p.credit}. ${p.changeNote} `));
 for(const[index,[label,url]]of ([['Image source',p.creditUrl],[p.license,p.licenseUrl]] as const).entries()){if(index)caption.append(document.createTextNode(' · '));const a=document.createElement('a');a.textContent=label;a.href=url;a.target='_blank';a.rel='noopener noreferrer';caption.append(a);}
 figure.append(frame,caption);watchCardPhotos(figure);return figure;
}
