import {displayPhotoFor,contextPhotoFor,type ReviewedPhoto,type ContextPhotoInput} from './catalog.js';
import type {ContextPhoto} from './context-photos.js';
import type {EvidenceCard} from '../iceo/contracts.js';

const watched=new WeakSet<HTMLImageElement>();
/** Cover parser-time errors as well as failures after lazy loading; retain all text/actions. */
export function watchCardPhotos(root:ParentNode):void {
 for(const image of root.querySelectorAll<HTMLImageElement>('img[data-reviewed-photo]')){
  if(watched.has(image))continue;watched.add(image);
  const remove=():void=>{
   const figure=image.closest<HTMLElement>('.card-photo');if(!figure)return;
   figure.dataset.photoFailed='true';
   if(figure.querySelector('.card-photo-headline')){
    retainHeadlineWithoutImage(figure);return;
   }
   // Legacy/shared figures contain only photographic material, never the article title.
   figure.hidden=true;figure.remove();
  };
  image.addEventListener('error',remove,{once:true});
  queueMicrotask(()=>{if(image.complete&&image.naturalWidth===0)remove();});
 }
}

function retainHeadlineWithoutImage(figure:HTMLElement):void {
 figure.hidden=false;figure.classList.add('photo-unavailable');
 const frame=figure.querySelector<HTMLElement>('.card-photo-frame');if(frame)frame.hidden=true;
 const badge=figure.querySelector<HTMLElement>('.card-photo-label');if(badge)badge.hidden=true;
}

/** Relocate the existing heading/header without recreating their links, IDs or listeners. */
export function integratePhotoHeadline(figure:HTMLElement,heading:HTMLElement,header?:HTMLElement):void {
 const frame=figure.querySelector<HTMLElement>('.card-photo-frame');if(!frame)return;
 let visual=figure.querySelector<HTMLElement>('.card-photo-visual');
 if(!visual){visual=document.createElement('div');visual.className='card-photo-visual';frame.before(visual);visual.append(frame);}
 if(header){header.classList.add('card-photo-overline');visual.prepend(header);}
 let headline=visual.querySelector<HTMLElement>('.card-photo-headline');
 if(!headline){headline=document.createElement('div');headline.className='card-photo-headline';visual.append(headline);}
 headline.append(heading);
 figure.classList.add('photo-editorial');
 // A layout hint only: the complete text remains in the same heading at every width.
 figure.classList.toggle('photo-title-long',(heading.textContent??'').trim().length>96);
 if(figure.dataset.photoFailed==='true')retainHeadlineWithoutImage(figure);
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
 const badge=document.createElement('span');badge.className='card-photo-label';badge.textContent=photoLabel(p);frame.append(badge);
 const caption=document.createElement('figcaption');caption.className='card-photo-caption';
 const credit=document.createElement('span');credit.className='card-photo-credit';credit.append(document.createTextNode('Photo: '),photoLink(p.credit,p.creditUrl),document.createTextNode(' · '),photoLink(p.license,p.licenseUrl));
 const details=document.createElement('details');details.className='photo-details';
 const summary=document.createElement('summary');summary.textContent='About this image';
 const description=document.createElement('p');description.textContent=`${p.caption} ${p.changeNote}`;
 details.append(summary,description);caption.append(credit,details);
 figure.append(frame,caption);watchCardPhotos(figure);return figure;
}

function photoLink(label:string,url:string):HTMLAnchorElement {
 const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;
}

function photoLabel(p:ReviewedPhoto|ContextPhoto):string {
 if('kind' in p)return 'Context image';
 // Only expose an archival year already stated explicitly in the reviewed caption.
 const year=/\(((?:19|20)\d{2})\)/u.exec(p.caption)?.[1];
 if(year&&Number(year)<Number(p.articleDate.slice(0,4)))return `Archive photo · ${year}`;
 return /source photo collage/iu.test(p.caption)?'Source collage':'Source photo';
}
