import {DEFAULT_PREFERENCES,CURRENCIES,FX_HOME,FX_SOURCE,GLANCE_VERSION,object,validFx,validGlance,validPreferences,type GlancePreferences,type GlanceSnapshot} from './contracts.js';
import {currentLocalCards,forecastRange,quoteCurrency,nextGlanceDelay,localDay} from './presentation.js';
import {currentLocalSnapshot,validCity,type City,type LocalSnapshot,type LocalCard} from '../local/contracts.js';
import {readPreferences,savePreferences,clearPreferences} from './preferences.js';
import {weatherMotionNode,updateWeatherMotion} from './weather-motion.js';
import {getLocale,countryLabel,translate} from '../i18n/browser.js';

const get=<T extends HTMLElement>(id:string):T=>{const n=document.getElementById(id);if(!n)throw Error('GLANCE_ELEMENT_MISSING');return n as T;};
const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''):HTMLElementTagNameMap[K]=>{const n=document.createElement(tag);n.textContent=text;n.className=className;return n;};
export function setupGlance():void {
 const root=get<HTMLElement>('today-glance'),custom=get<HTMLDialogElement>('glance-customize'),detail=get<HTMLDialogElement>('glance-detail'),body=get<HTMLElement>('glance-detail-body'),status=get<HTMLElement>('glance-status'),refresh=get<HTMLButtonElement>('glance-refresh');
 const list=get<HTMLDialogElement>('glance-list'),read=get<HTMLButtonElement>('glance-read');
 let detailReturn:HTMLElement|null=null;
 // No urgency metadata exists in this payload: ordinary headlines never initialize an alert ticker.
 const weatherMotion=weatherMotionNode(null,Date.now(),true);get<HTMLElement>('glance-weather').append(weatherMotion);
 let preferences:GlancePreferences=readPreferences(()=>localStorage),snapshot:GlanceSnapshot|null=null,city:City|null=null,local:LocalSnapshot|null=null,estimatedCity=false,busy=false,localBusy=false,localTicket=0,attempted=false,timer:ReturnType<typeof setTimeout>|undefined,opened:'weather'|'forex'|'notice'|null=null;
 let browserZone='UTC';try{browserZone=Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{/* UTC remains explicit. */}
 const zone=()=>city?.timezone??browserZone;
 const date=(value:string,withTime=false)=>new Intl.DateTimeFormat(getLocale(),{timeZone:zone(),day:'numeric',month:'short',year:'numeric',...(withTime?{hour:'2-digit',minute:'2-digit',timeZoneName:'short'}:{})}).format(new Date(value));
 function link(text:string,url:string):HTMLAnchorElement {const a=node('a',text,'source-link');a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
 function tile(id:string,title:string,note:string):void{get<HTMLElement>(id+'-value').textContent=title;get<HTMLElement>(id+'-note').textContent=note;}
 const quote=()=>preferences.currency==='auto'?quoteCurrency(city?.countryCode):preferences.currency;
 function localDetail(card:LocalCard):void{body.append(node('p',card.text),node('p',`Source checked ${date(card.checkedAt,true)}. Usable until ${date(card.validTo,true)}.`,'privacy-note'),node('p',card.boundary,'privacy-note'));if(card.sourceUpdatedAt)body.append(node('p',`Source issued ${date(card.sourceUpdatedAt,true)}.`,'privacy-note'));if(card.context)body.append(node('p',card.context.when),node('p',card.context.place),node('p',card.context.why));body.append(link(`Open ${card.publisher}`,card.sourceUrl));if(card.kind==='forecast')body.append(node('p','MET Norway · CC BY 4.0. Temperature range and six-hour precipitation are calculated by DLKT from the source forecast.','privacy-note'),link('Source licence','https://creativecommons.org/licenses/by/4.0/'));}
 function renderDetail():void {
  if(!opened)return;const now=Date.now(),cards=currentLocalCards(local,city,now);body.replaceChildren();
  const title=get<HTMLElement>('glance-detail-title');
  if(opened==='weather'){title.textContent=city?`Weather in ${city.name}`:'Your weather';const card=cards.find(c=>c.kind==='forecast');if(card){body.append(weatherMotionNode(card,now));localDetail(card);}else body.append(node('p',city?'No current forecast is available. Refresh to check the connected source.':'Choose a city to see its city-centre forecast.'));}
  if(opened==='forex'){title.textContent='Currency reference';const fx=snapshot?.forex,q=quote();if(fx&&validFx(fx,now)&&fx.rates[q]!==undefined){const n=fx.rates[q],previous=fx.previousRates[q];body.append(node('p',`1 EUR = ${new Intl.NumberFormat('en-GB',{maximumFractionDigits:4}).format(n)} ${q}`),node('p',`Reference date ${date(fx.date)}. Source checked ${date(fx.checkedAt,true)}.`,'privacy-note'));if(previous!==undefined&&fx.previousDate)body.append(node('p',`Change ${((n/previous-1)*100).toFixed(2)}% against the ${date(fx.previousDate)} reference, calculated by DLKT.`));body.append(node('p','ECB reference rates are informational, not live prices or executable exchange quotes. The source data are available free of charge from the ECB.','privacy-note'),link('Open ECB reference rates',FX_HOME),link('Original ECB XML',FX_SOURCE));}else body.append(node('p','The selected reference rate is unavailable or expired. Refresh to check the ECB source.'));}
  if(opened==='notice'){title.textContent='Local heads-up';const card=cards.find(c=>c.kind==='transport-notice');if(card)localDetail(card);else body.append(node('p','This source check has expired. Refresh local sources for the current publisher notices.'));}
 }
 function render():void{
  const now=Date.now(),cards=currentLocalCards(local,city,now),locale=getLocale();
  const calendar=get<HTMLTimeElement>('glance-date');calendar.textContent=new Intl.DateTimeFormat(locale,{timeZone:zone(),weekday:'short',day:'numeric',month:'long',year:'numeric'}).format(now);calendar.dateTime=localDay(now,zone());calendar.title=zone();
  get<HTMLElement>('glance-title').textContent=translate('navToday');
  get<HTMLElement>('glance-city-label').textContent=city?.name??translate('chooseCity');
  get<HTMLButtonElement>('glance-city').setAttribute('aria-label',city?translate('changeCity')+': '+city.name+', '+countryLabel(city.countryCode,city.country):translate('chooseCity'));
  get<HTMLElement>('glance-zone').textContent=city?countryLabel(city.countryCode,city.country)+(estimatedCity?(locale==='ro'?' · aproximativ':locale==='it'?' · approssimativo':' · approximate'):''):'';
  get<HTMLButtonElement>('glance-locate').textContent=locale==='ro'?'Foloseste locatia mea':locale==='it'?'Usa la mia posizione':'Use my location';
  get<HTMLElement>('glance-weather').hidden=!preferences.weather;get<HTMLElement>('glance-forex').hidden=!preferences.forex;
  const forecast=cards.find(c=>c.kind==='forecast'),range=forecast?forecastRange(forecast):null;
  updateWeatherMotion(weatherMotion,forecast??null,now);
  tile('glance-weather',city?range??(localBusy?'Checking forecast…':'Unavailable'):'Choose your city',forecast?`Forecast · ${city?.name} · ${new Intl.DateTimeFormat('en-GB',{timeZone:zone(),hour:'2-digit',minute:'2-digit'}).format(new Date(forecast.validFrom))}–${new Intl.DateTimeFormat('en-GB',{timeZone:zone(),hour:'2-digit',minute:'2-digit'}).format(new Date(forecast.validTo))}`:city?localBusy?'Checking the connected source':'Refresh to check the source':'Local forecast, when connected');
  const fx=snapshot?.forex,q=quote();const n=fx&&validFx(fx,now)?fx.rates[q]:undefined;
  tile('glance-forex',n!==undefined?`1 EUR = ${new Intl.NumberFormat('en-GB',{maximumFractionDigits:4}).format(n)} ${q}`:busy?'Checking ECB…':'Unavailable',n!==undefined&&fx?`ECB reference · ${date(fx.date)}`:'Reference rates · not live quotes');
  const notice=cards.find(c=>c.kind==='transport-notice'),headsup=get<HTMLButtonElement>('glance-headsup');headsup.hidden=!notice;headsup.textContent=notice?`Local heads-up · ${notice.title}`:'';
  const weatherQuick=get<HTMLButtonElement>('glance-weather-quick'),forexQuick=get<HTMLButtonElement>('glance-forex-quick');
  weatherQuick.hidden=!preferences.weather||!forecast||!range;weatherQuick.textContent=(locale==='ro'?'Vreme':locale==='it'?'Meteo':'Weather')+' · '+(range??'');weatherQuick.title=get<HTMLElement>('glance-weather-note').textContent??'';
  forexQuick.hidden=!preferences.forex||n===undefined;forexQuick.textContent=n!==undefined?'ECB · 1 EUR = '+new Intl.NumberFormat(locale,{maximumFractionDigits:4}).format(n)+' '+q:'';forexQuick.title=get<HTMLElement>('glance-forex-note').textContent??'';
  read.textContent=locale==='ro'?'Vreme si curs':locale==='it'?'Meteo e cambi':'Weather & rates';
  get<HTMLElement>('glance-empty').hidden=preferences.weather||preferences.forex;
  refresh.disabled=busy||localBusy;if(detail.open)renderDetail();clearTimeout(timer);if(document.visibilityState==='visible')timer=setTimeout(render,nextGlanceDelay(cards,[],fx??null,now));
 }
 async function load():Promise<void>{
  if(busy)return;busy=true;attempted=true;refresh.disabled=true;status.textContent='Checking the connected sources…';render();
  try{const r=await fetch('/api/glance',{method:'GET',credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('GLANCE_REQUEST_FAILED');const text=await r.text();if(text.length>150000)throw Error('GLANCE_TOO_LARGE');const data:unknown=JSON.parse(text);if(!validGlance(data,Date.now()))throw Error('GLANCE_INVALID');snapshot=data;status.textContent=!data.forex&&preferences.forex?'The currency reference is unavailable. Open details or refresh to try again.':'';}
  catch{snapshot=null;status.textContent='Sources could not be checked. Refresh to try again.';}
  finally{busy=false;render();}
 }
 async function refreshCity():Promise<void>{
  if(!city||localBusy)return;const requested=city,ticket=++localTicket;localBusy=true;render();
  try{const r=await fetch('/api/local?city='+encodeURIComponent(requested.id),{credentials:'omit',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('GLANCE_LOCAL_FAILED');const text=await r.text();if(text.length>150000)throw Error('GLANCE_LOCAL_TOO_LARGE');const value:unknown=JSON.parse(text);if(ticket!==localTicket||city?.id!==requested.id)return;local=currentLocalSnapshot(value,requested,Date.now())?value:null;}
  catch{if(ticket===localTicket&&city?.id===requested.id)local=null;}
  finally{if(ticket===localTicket){localBusy=false;render();}}
 }
 function populate():void{get<HTMLInputElement>('glance-show-weather').checked=preferences.weather;get<HTMLInputElement>('glance-show-forex').checked=preferences.forex;get<HTMLSelectElement>('glance-currency').value=preferences.currency;get<HTMLElement>('glance-save-status').textContent='';}
 function openSignal(kind:'weather'|'forex'|'notice'):void {detailReturn=list.open?read:document.activeElement instanceof HTMLElement?document.activeElement:read;if(list.open)list.close();if(kind==='weather'&&!city){get<HTMLButtonElement>('entry-show-city').click();return;}opened=kind;renderDetail();detail.showModal();}
 const currencies=get<HTMLSelectElement>('glance-currency');currencies.append(new Option('For my city, otherwise USD','auto'));for(const c of CURRENCIES)currencies.append(new Option(`EUR / ${c}`,c));
 get<HTMLButtonElement>('glance-customize-open').addEventListener('click',()=>{if(list.open)list.close();populate();custom.showModal();});custom.addEventListener('close',()=>read.focus());get<HTMLButtonElement>('glance-customize-close').addEventListener('click',()=>custom.close());get<HTMLButtonElement>('glance-detail-close').addEventListener('click',()=>detail.close());detail.addEventListener('close',()=>{opened=null;(detailReturn?.isConnected&&!detailReturn.hidden?detailReturn:read).focus();detailReturn=null;});read.addEventListener('click',()=>list.showModal());get<HTMLButtonElement>('glance-list-close').addEventListener('click',()=>list.close());
 get<HTMLFormElement>('glance-preferences').addEventListener('submit',e=>{e.preventDefault();const next:unknown={version:GLANCE_VERSION,weather:get<HTMLInputElement>('glance-show-weather').checked,forex:get<HTMLInputElement>('glance-show-forex').checked,keyThing:false,currency:currencies.value};if(!validPreferences(next))return;preferences=next;get<HTMLElement>('glance-save-status').textContent=savePreferences(preferences,()=>localStorage)?'Saved in this browser.':'Applied for this visit. Browser storage is unavailable.';render();if(!attempted&&preferences.forex)void load();});
 refresh.addEventListener('click',()=>{void refreshCity();void load();});get<HTMLButtonElement>('glance-city').addEventListener('click',()=>get<HTMLButtonElement>('choose-place').click());
 for(const [id,kind] of [['glance-weather','weather'],['glance-forex','forex'],['glance-weather-quick','weather'],['glance-forex-quick','forex'],['glance-headsup','notice']] as const)get<HTMLButtonElement>(id).addEventListener('click',()=>openSignal(kind));
 document.addEventListener('dlkt:city-selected',event=>{if(event instanceof CustomEvent&&object(event.detail)&&validCity(event.detail.city)){if(event.detail.restored===true&&document.body.dataset.entryView==='daily'&&city)return;++localTicket;localBusy=true;city=event.detail.city;estimatedCity=event.detail.estimated===true;local=null;render();}});
 document.addEventListener('dlkt:local-snapshot',event=>{if(!(event instanceof CustomEvent)||!object(event.detail)||!validCity(event.detail.city))return;const c=event.detail.city;if(city&&city.id!==c.id&&!(event.detail.origin==='daily'&&document.body.dataset.entryView==='daily'))return;++localTicket;localBusy=false;city=c;local=currentLocalSnapshot(event.detail.snapshot,c,Date.now())?event.detail.snapshot:null;render();});
 document.addEventListener('dlkt:daily-cleared',()=>{preferences={...DEFAULT_PREFERENCES};clearPreferences(()=>localStorage);render();});
 document.addEventListener('dlkt:language-changed',render);
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render();else clearTimeout(timer);});window.addEventListener('pageshow',render);
 root.hidden=false;render();if(preferences.forex)void load();
}
if(typeof document!=='undefined')setupGlance();
