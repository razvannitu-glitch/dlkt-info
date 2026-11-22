import {displayPhotoFor,contextPhotoFor,editorialPhotoFor,type ReviewedPhoto,type ContextPhotoInput} from './catalog.js';
import type {ContextPhoto} from './context-photos.js';
import type {EditorialPhoto} from './editorial-photos.js';
import type {EvidenceCard} from '../iceo/contracts.js';
import {translate as tr} from '../i18n/browser.js';
import type {MessageKey} from '../i18n/locale.js';

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
 const p=contextPhotoFor(card,now)??editorialPhotoFor(card,now);return p?renderPhotoNode(p):null;
}
function renderPhotoNode(p:ReviewedPhoto|ContextPhoto|EditorialPhoto):HTMLElement {
 const figure=document.createElement('figure');figure.className=`card-photo${p.fit==='contain'?' photo-contain':''}`;figure.dataset.photoId=p.key;
 figure.dataset.photoKind='kind' in p?p.kind:'source';
 const frame=document.createElement('div');frame.className='card-photo-frame';
 const image=document.createElement('img');image.src=p.path;image.alt=p.alt;image.lang='en';image.translate=false;image.width=p.width;image.height=p.height;image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';image.dataset.reviewedPhoto=p.key;frame.append(image);
 const badge=document.createElement('span');badge.className='card-photo-label';const label=photoLabel(p);badge.textContent=tr(label.key,label.year===undefined?undefined:{year:label.year});badge.dataset.i18n=label.key;if(label.year!==undefined)badge.dataset.i18nYear=label.year;frame.append(badge);
 const caption=document.createElement('figcaption');caption.className='card-photo-caption';
 const credit=document.createElement('span');credit.className='card-photo-credit';const creditLabel=document.createElement('span');creditLabel.dataset.i18n='photoCreditLabel';creditLabel.textContent=tr('photoCreditLabel');credit.append(creditLabel,document.createTextNode(' '),photoLink(p.credit,p.creditUrl),document.createTextNode(' · '),photoLink(p.license,p.licenseUrl));
 const details=document.createElement('details');details.className='photo-details';
 const summary=document.createElement('summary');summary.dataset.i18n='photoDetailsLabel';summary.textContent=tr('photoDetailsLabel');
 const description=document.createElement('p');description.lang='en';description.translate=false;description.textContent=`${p.caption} ${p.changeNote}`;
 details.append(summary,description);caption.append(credit);
 if('kind' in p){const note=document.createElement('p');note.className='card-photo-note';const key=p.kind==='editorial'?'photoEditorialNote':'photoContextNote';note.dataset.i18n=key;note.textContent=tr(key);caption.append(note);}
 caption.append(details);
 figure.append(frame,caption);watchCardPhotos(figure);return figure;
}

function photoLink(label:string,url:string):HTMLAnchorElement {
 const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener noreferrer';return link;
}

function photoLabel(p:ReviewedPhoto|ContextPhoto|EditorialPhoto):{readonly key:MessageKey;readonly year?:string} {
 if('kind' in p)return{key:p.kind==='editorial'?'photoEditorialLabel':'photoContextLabel'};
 // Only expose an archival year already stated explicitly in the reviewed caption.
 const year=/\(((?:19|20)\d{2})\)/u.exec(p.caption)?.[1];
 if(year&&Number(year)<Number(p.articleDate.slice(0,4)))return{key:'photoArchiveLabel',year};
 return{key:/source photo collage/iu.test(p.caption)?'photoCollageLabel':'photoSourceLabel'};
}
