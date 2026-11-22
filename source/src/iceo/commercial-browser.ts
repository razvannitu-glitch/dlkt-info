import {COMMERCIAL_COPY,commercialAreaFromSearch,commercialLanguage,commercialRequestUrl,prepareCommercialRequest,validCommercialArea,type CommercialArea} from './commercial.js';
function element<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string):HTMLElementTagNameMap[K]{
 const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;
}
export function commercialCardNode(area:CommercialArea,language:string):HTMLElement {
 if(!validCommercialArea(area))throw Error('COMMERCIAL_AREA_INVALID');
 const copy=COMMERCIAL_COPY[commercialLanguage(language)],node=element('article','info-card commercial-invitation');
 node.id='local-commercial-invitation';node.dataset.commercial='invitation';node.dataset.liveSignature=JSON.stringify([area,commercialLanguage(language)]);
 const label=element('p','commercial-label',copy.label),place=element('p','commercial-area',area.city+' · '+area.country);
 const heading=element('h3','',copy.title);heading.id='local-commercial-title';node.setAttribute('aria-labelledby',heading.id);
 const content=element('div','commercial-content');content.append(label,place,heading,element('p','commercial-copy',copy.body+' '+area.city+'.'));
 const action=element('a','commercial-action',copy.action);action.href=commercialRequestUrl(area,language);
 content.append(action,element('p','commercial-note',copy.note));node.append(content);return node;
}
export function setupCommercialRequest():void {
 const host=document.getElementById('commercial-form');if(!host)return;
 const query=new URLSearchParams(window.location.search),language=commercialLanguage(query.getAll('lang').length===1?query.get('lang'):'en'),copy=COMMERCIAL_COPY[language];
 const section=document.getElementById('advertise');if(section)section.lang=language;
 section?.querySelectorAll<HTMLElement>('[data-commercial-copy]').forEach(node=>{
  const key=node.dataset.commercialCopy;if(key&&Object.hasOwn(copy,key))node.textContent=copy[key as keyof typeof copy];
 });
 const required=<T extends HTMLElement>(id:string):T=>{const node=document.getElementById(id);if(!node)throw Error('COMMERCIAL_ELEMENT_MISSING');return node as T;};
 const fields={business:required<HTMLInputElement>('commercial-business'),city:required<HTMLInputElement>('commercial-city'),country:required<HTMLInputElement>('commercial-country'),offer:required<HTMLInputElement>('commercial-offer'),destination:required<HTMLInputElement>('commercial-destination'),validUntil:required<HTMLInputElement>('commercial-valid-until')};
 const area=commercialAreaFromSearch(window.location.search);if(area){fields.city.value=area.city;fields.country.value=area.country;}
 const panel=required<HTMLElement>('commercial-request'),text=required<HTMLTextAreaElement>('commercial-request-text'),email=required<HTMLAnchorElement>('commercial-email'),feedback=required<HTMLElement>('commercial-feedback'),copyStatus=required<HTMLElement>('commercial-copy-status');
 const invalidate=():void=>{panel.hidden=true;text.value='';email.removeAttribute('href');feedback.textContent='';copyStatus.textContent='';};
 host.addEventListener('input',invalidate);
 required<HTMLButtonElement>('commercial-prepare').addEventListener('click',()=>{
  for(const input of Object.values(fields))if(!input.reportValidity())return;
  const value=Object.fromEntries(Object.entries(fields).map(([key,input])=>[key,input.value.trim()]));
  const request=prepareCommercialRequest(value);if(!request){feedback.textContent=copy.invalid;return;}
  text.value=request.body;email.href=request.mailto;panel.hidden=false;feedback.textContent=copy.ready;text.focus();
 });
 required<HTMLButtonElement>('commercial-copy').addEventListener('click',()=>{
  if(panel.hidden||!text.value)return;
  void(async()=>{try{if(!navigator.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');await navigator.clipboard.writeText(text.value);copyStatus.textContent=copy.copied;}catch{text.focus();text.select();copyStatus.textContent=copy.copyFailed;}})();
 });
}
