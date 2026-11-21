import type {EvidenceCard} from '../iceo/contracts.js';
import {cardLink,cardPath,cardImagePath} from './link.js';
export interface ShareElements {readonly button:HTMLButtonElement;readonly fallback:HTMLInputElement;readonly announce:(message:string)=>void}
export interface ShareDestination {readonly label:'Facebook'|'X'|'Threads';readonly href:string}
/** Fixed public destinations receive only the exact public card link, never a briefing or visitor state. */
export function shareDestinations(card:EvidenceCard):readonly ShareDestination[]{
 const url=cardLink(card);
 return [
  {label:'Facebook',href:'https://www.facebook.com/sharer/sharer.php?'+new URLSearchParams({u:url}).toString()},
  {label:'X',href:'https://x.com/intent/tweet?'+new URLSearchParams({url}).toString()},
  {label:'Threads',href:'https://www.threads.com/intent/post?'+new URLSearchParams({text:url}).toString()},
 ];
}
let active:HTMLDialogElement|null=null;
/** Opening prepares only this public edition. Posting and copying still require a separate user action. */
export async function shareCard(card:EvidenceCard,elements:ShareElements):Promise<void>{
 const url=cardLink(card),{button,announce}=elements;
 if(active?.open){active.focus();return;}
 const dialog=document.createElement('dialog');active=dialog;dialog.className='focus-dialog share-dialog';dialog.setAttribute('aria-labelledby','dlkt-share-title');
 const header=document.createElement('div');header.className='dialog-header';
 const title=document.createElement('h2');title.id='dlkt-share-title';title.textContent='Share this card';
 const close=document.createElement('button');close.type='button';close.className='text-button';close.textContent='Close';close.setAttribute('aria-label','Close sharing options');header.append(title,close);
 const name=document.createElement('p');name.className='share-card-title';name.textContent=card.title;
 const note=document.createElement('p');note.className='privacy-note';note.textContent='The link keeps this edition, its source and verification date. You confirm the post in the app.';
 const options=document.createElement('div');options.className='share-options';options.setAttribute('aria-label','Sharing options');
 const links=new Map<HTMLAnchorElement,string>();const buttons:HTMLButtonElement[]=[];let ready=false;
 for(const destination of shareDestinations(card)){
  const link=document.createElement('a');link.className='secondary';link.textContent=destination.label;link.target='_blank';link.rel='noopener noreferrer';links.set(link,destination.href);options.append(link);
 }
 const copy=document.createElement('button');copy.type='button';copy.className='primary';copy.textContent='Copy link';buttons.push(copy);options.append(copy);
 const image=document.createElement('a');image.className='secondary';image.textContent='Download image';image.download='DLKT-card.png';links.set(image,cardImagePath(card));options.append(image);
 const open=document.createElement('a');open.className='secondary';open.textContent='Open card';open.href=cardPath(card);open.target='_blank';open.rel='noopener noreferrer';options.append(open);
 const field=document.createElement('input');field.type='text';field.readOnly=true;field.hidden=true;field.className='share-fallback';field.value=url;field.setAttribute('aria-label','DLKT card link to copy');
 const message=document.createElement('p');message.className='privacy-note';message.setAttribute('role','status');message.setAttribute('aria-live','polite');
 const report=(text:string):void=>{message.textContent=text;announce(text);};
 const showLink=():void=>{field.hidden=false;field.focus();field.select();report('Select and copy this public DLKT card link.');};
 copy.addEventListener('click',()=>{if(!ready)return;copy.disabled=true;void(async()=>{try{if(!navigator.clipboard?.writeText){showLink();return;}await navigator.clipboard.writeText(url);copy.textContent='Link copied';report('Card link copied. Your saved interests and history are not included.');}catch{showLink();}finally{copy.disabled=false;}})();});
 if(typeof navigator.share==='function'){
  const native=document.createElement('button');native.type='button';native.className='secondary';native.textContent='More apps';
  // Invoked directly by this click, so the native share retains its user gesture.
  native.addEventListener('click',()=>{if(!ready)return;native.disabled=true;void navigator.share({title:card.title,url}).then(()=>report('Link handed to your sharing app. Delivery is not confirmed by DLKT.')).catch((error:unknown)=>{if(!(error instanceof DOMException&&error.name==='AbortError'))showLink();}).finally(()=>{native.disabled=false;});});buttons.push(native);options.append(native);
 }
 const setReady=(value:boolean):void=>{ready=value;options.setAttribute('aria-busy',String(!value));for(const control of buttons)control.disabled=!value;for(const[link,href]of links){if(value)link.href=href;else link.removeAttribute('href');link.setAttribute('aria-disabled',String(!value));link.tabIndex=value?0:-1;}};
 const retry=document.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='Retry';retry.hidden=true;
 let controller:AbortController|null=null;
 const prepare=async():Promise<void>=>{
  if(controller)return;controller=new AbortController();const request=controller;const timer=setTimeout(()=>request.abort(),50000);
  setReady(false);retry.hidden=true;report('Preparing the link to this edition...');
  try{
   const response=await fetch('/api/share-archive',{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{'Content-Type':'application/json','X-DLKT-Info-Request':'share-archive'},body:JSON.stringify({id:card.id,revision:card.contentHash}),signal:request.signal});
   if(!response.ok||!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type')??''))throw Error('SHARE_PREPARE_FAILED');
   const text=await response.text();if(text.length>512)throw Error('SHARE_PREPARE_INVALID');
   const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('SHARE_PREPARE_INVALID');
   const result=value as Record<string,unknown>;if(result.state!=='preserved'||result.path!==cardPath(card))throw Error('SHARE_PREPARE_INVALID');
   if(dialog.isConnected){setReady(true);report('Link ready. This edition will remain readable after it leaves the daily selection.');}
  }catch{if(dialog.isConnected){retry.hidden=false;report('This edition could not be preserved. Retry, or refresh DLKT before sharing.');}}
  finally{clearTimeout(timer);if(controller===request)controller=null;}
 };
 retry.addEventListener('click',()=>{void prepare();});
 close.addEventListener('click',()=>dialog.close());
 dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)dialog.close();});
 dialog.addEventListener('close',()=>{controller?.abort();if(active===dialog)active=null;dialog.remove();if(button.isConnected)button.focus();},{once:true});
 dialog.append(header,name,note,options,field,message,retry);document.body.append(dialog);dialog.showModal();close.focus();await prepare();
}
export function addCardSharing(container:HTMLElement,card:EvidenceCard,announce:(message:string)=>void):void{
 const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent='Share card';button.dataset.shareCard='true';button.setAttribute('aria-label','Share this DLKT card');
 const input=document.createElement('input');input.type='text';input.readOnly=true;input.hidden=true;input.className='share-fallback';input.setAttribute('aria-label','DLKT card link to copy');
 button.addEventListener('click',()=>{void shareCard(card,{button,fallback:input,announce});});
 container.append(button,input);
}
