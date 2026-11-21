import {getLocale,translate as tr,translatedCategory,countryLabel,languageLabel} from '../i18n/browser.js';
import {localeUrl} from '../i18n/locale.js';
import {object,validCity,type City} from '../local/contracts.js';
import {PUBLIC_EDITORIAL_CATEGORIES,type PublicEditorialCategory} from '../iceo/editorial-categories.js';
import {sourceLanguage} from '../iceo/news-sources.js';
import {editionCardSignature} from '../iceo/live-edition.js';
import type {IceoSnapshot} from '../iceo/contracts.js';
import type {ReadingCard} from '../iceo/reader.js';
import {parseExploreState,exploreUrl,selectExploreCity,selectExploreCountry,selectExploreCategory,type ExploreState} from './state.js';
import {selectExploreCards} from './selection.js';

interface ExploreOptions {
 readonly snapshot:()=>IceoSnapshot|null;
 readonly loading:()=>boolean;
 readonly failed:()=>boolean;
 readonly card:(view:ReadingCard,index:number,total:number)=>HTMLElement;
 readonly reconcile:(target:HTMLElement,next:HTMLElement)=>void;
 readonly refresh:()=>void;
 readonly saved:()=>void;
}
export interface ExploreController {update():void;}
interface PlaceResult {readonly city:City;readonly aliases:readonly string[];}
interface Country {readonly code:string;readonly name:string;}
const PAGE_SIZE=20;
function element<T extends HTMLElement>(id:string):T {
 const node=document.getElementById(id);if(!node)throw Error('EXPLORE_ELEMENT_MISSING');return node as T;
}
function node<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text=''):HTMLElementTagNameMap[K]{
 const value=document.createElement(tag);value.className=className;value.textContent=text;return value;
}
async function json(url:string,signal:AbortSignal):Promise<unknown>{
 const response=await fetch(url,{credentials:'omit',headers:{Accept:'application/json'},signal});
 if(!response.ok)throw Error('EXPLORE_LOOKUP_UNAVAILABLE');
 const raw=await response.text();if(raw.length>150000)throw Error('EXPLORE_LOOKUP_TOO_LARGE');return JSON.parse(raw) as unknown;
}
function validAliases(value:unknown):value is readonly string[]{return Array.isArray(value)&&value.length<=32&&value.every(item=>typeof item==='string'&&item.length>=2&&item.length<=100&&!/[\u0000-\u001f\u007f<>]/u.test(item));}
function validCountry(value:unknown):value is Country{return object(value)&&typeof value.code==='string'&&/^[A-Z]{2}$/u.test(value.code)&&typeof value.name==='string'&&value.name.length>0&&value.name.length<=100;}

/** A separate public reading context. No city events, device writes or private queries. */
export function setupExplore(options:ExploreOptions):ExploreController {
 const section=element<HTMLElement>('world-explore'),title=element<HTMLElement>('world-title');
 const launch=element<HTMLButtonElement>('world-open'),navigation=element<HTMLButtonElement>('world-nav');
 const query=element<HTMLInputElement>('world-city-query'),search=element<HTMLFormElement>('world-search');
 const matches=element<HTMLElement>('world-city-results'),searchStatus=element<HTMLElement>('world-search-status');
 const countries=element<HTMLSelectElement>('world-country'),categories=element<HTMLSelectElement>('world-category');
 const grid=element<HTMLElement>('world-cards'),status=element<HTMLElement>('world-status');
 const placeTitle=element<HTMLElement>('world-place-title'),placeDate=element<HTMLElement>('world-place-date');
 const empty=element<HTMLElement>('world-empty'),emptyTitle=element<HTMLElement>('world-empty-title'),emptyCopy=element<HTMLElement>('world-empty-copy');
 const moreWrap=element<HTMLElement>('world-more-wrap'),more=element<HTMLButtonElement>('world-more');
 const countryView=element<HTMLButtonElement>('world-country-view'),resetCategory=element<HTMLButtonElement>('world-reset-category');
 const refresh=element<HTMLButtonElement>('world-refresh'),coverage=element<HTMLElement>('world-coverage-copy');
 const copyStatus=element<HTMLElement>('world-copy-status'),copyFallback=element<HTMLInputElement>('world-copy-fallback');
 let state=parseExploreState(window.location.href),city:City|null=null,aliases:readonly string[]=[];
 let countryList:readonly Country[]=[],countryPending=false,placePending=false,placeFailed=false;
 let placeTicket=0,searchTicket=0,pageSize=PAGE_SIZE,composing=false;
 let placeAbort:AbortController|null=null,searchAbort:AbortController|null=null;
 let searchTimer:ReturnType<typeof setTimeout>|undefined,expiryTimer:ReturnType<typeof setTimeout>|undefined;
 let lastSelectionKey='',returnFocus:HTMLElement|null=null;
 const placeCache=new Map<string,PlaceResult>();
 function localizeControls():void {
  const allCategories=node('option','',tr('allCategories'));allCategories.value='';categories.replaceChildren(allCategories);
  for(const category of PUBLIC_EDITORIAL_CATEGORIES){const option=node('option','',translatedCategory(category));option.value=category;categories.append(option);}
  const allCountries=node('option','',tr('allCountries'));allCountries.value='';countries.replaceChildren(allCountries);
  for(const item of countryList){const option=node('option','',countryLabel(item.code,item.name));option.value=item.code;countries.append(option);}
  categories.value=state.category??'';countries.value=state.countryCode??city?.countryCode??'';
 }
 localizeControls();

 function cancelSearch():void {++searchTicket;searchAbort?.abort();searchAbort=null;clearTimeout(searchTimer);matches.replaceChildren();matches.hidden=true;query.setAttribute('aria-expanded','false');}
 function countryName(code:string|null):string{return code?countryLabel(code,countryList.find(value=>value.code===code)?.name??code):tr('aroundWorld');}
 function close(updateUrl=true,restoreFocus=true):void {
  if(!state.active)return;state={...state,active:false};++placeTicket;placeAbort?.abort();placePending=false;cancelSearch();clearTimeout(expiryTimer);
  section.hidden=true;delete document.body.dataset.worldExplore;navigation.setAttribute('aria-expanded','false');navigation.removeAttribute('aria-current');
  if(document.body.dataset.entryView==='start')element<HTMLButtonElement>('entry-today').setAttribute('aria-current','page');
  document.dispatchEvent(new CustomEvent('dlkt:explore-view'));
  if(updateUrl)history.pushState(null,'',exploreUrl(window.location.href,state));
  if(restoreFocus){const focus=returnFocus?.isConnected?returnFocus:launch;focus.focus({preventScroll:true});}
 }
 function present():void {
  section.hidden=!state.active;navigation.setAttribute('aria-expanded',String(state.active));
  if(!state.active){delete document.body.dataset.worldExplore;navigation.removeAttribute('aria-current');return;}
  document.body.dataset.worldExplore='active';navigation.setAttribute('aria-current','page');element<HTMLButtonElement>('entry-today').removeAttribute('aria-current');element<HTMLButtonElement>('entry-saved').removeAttribute('aria-current');
  document.dispatchEvent(new CustomEvent('dlkt:explore-view'));
  countries.value=state.countryCode??city?.countryCode??'';categories.value=state.category??'';
  element<HTMLButtonElement>('world-everywhere').setAttribute('aria-pressed',String(!state.cityId&&!state.countryCode));
  section.querySelectorAll<HTMLButtonElement>('[data-world-city]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.worldCity===state.cityId)));
  update();
 }
 function write(next:ExploreState,focus=false):void {
  if(!state.active){returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:launch;}
  const oldCity=state.cityId;state=next;pageSize=PAGE_SIZE;lastSelectionKey='';copyStatus.textContent='';copyFallback.hidden=true;cancelSearch();searchStatus.textContent='';
  history.pushState(null,'',exploreUrl(window.location.href,state));
  if(oldCity!==state.cityId||state.cityId&&!city)void resolvePlace();else present();
  if(!state.cityId){city=null;aliases=[];query.value='';placePending=false;placeFailed=false;present();}
  if(focus){title.focus({preventScroll:true});section.scrollIntoView({block:'start'});}
 }
 async function loadCountries():Promise<void>{
  if(countryList.length||countryPending)return;countryPending=true;
  try{
   const data=await json('/api/places?countries=1',AbortSignal.timeout(12000));
   if(!object(data)||!Array.isArray(data.countries)||data.countries.length>300||!data.countries.every(validCountry))throw Error('EXPLORE_COUNTRIES_INVALID');
   countryList=data.countries;localizeControls();countries.disabled=false;present();
  }catch{countries.disabled=true;countries.title=tr('countriesError');}
  finally{countryPending=false;}
 }
 async function resolvePlace():Promise<void>{
  const id=state.cityId,ticket=++placeTicket;placeAbort?.abort();placeAbort=null;city=null;aliases=[];placeFailed=false;placePending=id!==null;
  present();if(!id)return;
  const cached=placeCache.get(id);if(cached){city=cached.city;aliases=cached.aliases;state={...state,countryCode:city.countryCode};history.replaceState(null,'',exploreUrl(window.location.href,state));placePending=false;query.value=city.name;present();return;}
  const controller=new AbortController();placeAbort=controller;
  try{
   const data=await json('/api/places?id='+encodeURIComponent(id),AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]));
   if(!object(data)||!Array.isArray(data.cities)||data.cities.length!==1||!validCity(data.cities[0])||data.cities[0].id!==id||!validAliases(data.cityAliases))throw Error('EXPLORE_CITY_INVALID');
   if(ticket!==placeTicket||state.cityId!==id||!state.active)return;
   const result={city:data.cities[0],aliases:data.cityAliases};placeCache.set(id,result);city=result.city;aliases=result.aliases;state={...state,countryCode:city.countryCode};history.replaceState(null,'',exploreUrl(window.location.href,state));query.value=city.name;
  }catch(error){if(ticket!==placeTicket||controller.signal.aborted)return;placeFailed=true;}
  finally{if(ticket===placeTicket){placePending=false;present();}}
 }
 async function lookup():Promise<void>{
  const text=query.value.trim();cancelSearch();if(!text){searchStatus.textContent=tr('lookupHint');return;}
  const ticket=searchTicket;searchAbort=new AbortController();const controller=searchAbort;searchStatus.textContent=tr('lookupLoading');
  try{
   const data=await json('/api/places?q='+encodeURIComponent(text),AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]));
   if(ticket!==searchTicket||!state.active)return;
   if(!object(data)||!Array.isArray(data.cities)||data.cities.length>8||!data.cities.every(validCity))throw Error('EXPLORE_CITIES_INVALID');
   for(const place of data.cities){
    const item=node('li',''),button=node('button','');button.type='button';button.append(node('strong','',place.name),node('span','',[place.region,countryLabel(place.countryCode,place.country)].filter(Boolean).join(' · ')));
    button.addEventListener('click',()=>write(selectExploreCity(state,place),true));item.append(button);matches.append(item);
   }
   matches.hidden=data.cities.length===0;query.setAttribute('aria-expanded',String(!matches.hidden));searchStatus.textContent=data.cities.length?tr('lookupChoose'):tr('lookupEmpty');
  }catch(error){if(ticket!==searchTicket||controller.signal.aborted)return;searchStatus.textContent=tr('lookupError');}
 }
 function update():void {
  clearTimeout(expiryTimer);if(!state.active)return;
  const snapshot=options.snapshot(),loading=options.loading(),now=Date.now();
  refresh.disabled=loading||placePending;grid.setAttribute('aria-busy',String(loading||placePending));
  const name=city?`${city.name}, ${countryName(city.countryCode)}`:state.cityId?tr('openingPlace'):countryName(state.countryCode);
  placeTitle.textContent=name;
  placeDate.textContent=new Intl.DateTimeFormat(getLocale(),{weekday:'short',day:'numeric',month:'long',year:'numeric',timeZone:city?.timezone??'UTC'}).format(now)+(city?' · '+city.timezone.replaceAll('_',' '):' · UTC');
  countryView.hidden=!city;countryView.textContent=city?tr('exploreCountry',{country:countryName(city.countryCode)}):tr('viewCountry');resetCategory.hidden=state.category===null;
  if(placePending||placeFailed||!snapshot||snapshot.state==='unavailable'){
   grid.replaceChildren();moreWrap.hidden=true;empty.hidden=false;
   emptyTitle.textContent=placePending?tr('openingPlace'):placeFailed?tr('placeError'):loading?tr('loadingStories'):tr('storiesUnavailable');
   emptyCopy.textContent=placePending?tr('homeUnchanged'):placeFailed?tr('chooseAgain'):tr('refreshHint');
   status.textContent=placePending?tr('lookupLoading'):placeFailed?tr('placeError'):loading?tr('checkingSources'):tr('storiesUnavailable');
   coverage.textContent=tr('coveragePending');lastSelectionKey='';return;
  }
  const selection=selectExploreCards(snapshot.cards,{city,countryCode:state.countryCode,category:state.category,cityAliases:aliases},now);
  const visible=selection.cards.slice(0,pageSize);
  const checked=new Intl.DateTimeFormat(getLocale(),{hour:'2-digit',minute:'2-digit',timeZone:city?.timezone??'UTC'}).format(new Date(snapshot.generatedAt));
  status.textContent=[tr('matchingStories',{count:selection.matchedCount}),tr('last24Hours'),tr('checkedAt',{time:checked+(city?'':' UTC')}),snapshot.state==='partial'?tr('partialCoverage'):'',loading?tr('checkingUpdates'):options.failed()?tr('refreshUnavailable'):''].filter(Boolean).join(' · ');
  coverage.textContent=tr('coverage',{total:selection.eligibleCount,local:selection.local.length,national:selection.national.length});
  const key=JSON.stringify([getLocale(),state.cityId,state.countryCode,state.category,pageSize,visible.map(item=>[editionCardSignature(item.card),item.explore.scope,item.explore.label])]);
  if(key!==lastSelectionKey){
   const host=document.createElement('div');let previousScope='';
   visible.forEach((item,index)=>{
    if(item.explore.scope!==previousScope&&item.explore.scope!=='world'){
     const heading=node('div','discovery-section-label');heading.id='world-scope-'+item.explore.scope;
     heading.append(node('h3','',item.explore.scope==='city'?tr('mentioning',{city:city?.name??tr('city')}):tr('countryContext',{country:countryName(state.countryCode??city?.countryCode??null)})));host.append(heading);previousScope=item.explore.scope;
    }
    const article=options.card(item,index,selection.matchedCount);article.dataset.exploreScope=item.explore.scope;
    const language=sourceLanguage(item.card),editionLanguage=language?languageLabel(language):null;
    const placeLabel=item.explore.scope==='city'?tr('mentioning',{city:city?.name??tr('city')}):item.explore.scope==='country'?tr('countryContext',{country:countryName(state.countryCode??city?.countryCode??null)}):'';
    const label=[placeLabel,editionLanguage?tr('sourceLanguage',{language:editionLanguage}):''].filter(Boolean).join(' · ');
    article.dataset.liveSignature=JSON.stringify([getLocale(),editionCardSignature(item.card),item.explore.scope,item.explore.label,language]);
    if(label)article.querySelector('.card-content')?.prepend(node('p','world-card-place',label));
    if(item.explore.scope!=='world'){const evidence=node('p','world-place-evidence',item.explore.label);evidence.lang='en';evidence.dir='ltr';article.querySelector('.evidence')?.append(evidence);}
    host.append(article);
   });
   const anchor=[...grid.querySelectorAll<HTMLElement>('article')].find(article=>{const r=article.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight;});
   const top=anchor?.getBoundingClientRect().top;options.reconcile(grid,host);
   if(anchor?.isConnected&&top!==undefined){const offset=anchor.getBoundingClientRect().top-top;if(Math.abs(offset)>1)window.scrollBy(0,offset);}
   lastSelectionKey=key;options.saved();
  }
  empty.hidden=visible.length>0;emptyTitle.textContent=city?tr('noMatches',{place:city.name}):state.countryCode?tr('noMatches',{place:countryName(state.countryCode)}):tr('noCategoryMatches');
  emptyCopy.textContent=tr('noMatchesHint');
  moreWrap.hidden=visible.length>=selection.matchedCount;more.textContent=tr('showMore',{count:Math.min(PAGE_SIZE,selection.matchedCount-visible.length),remaining:selection.matchedCount-visible.length});
  if(document.visibilityState==='visible')expiryTimer=setTimeout(update,60000);
 }
 function open():void {write({...state,active:true},true);void loadCountries();}
 launch.addEventListener('click',open);navigation.addEventListener('click',open);
 element<HTMLButtonElement>('world-back').addEventListener('click',()=>close());
 element<HTMLButtonElement>('world-everywhere').addEventListener('click',()=>write(selectExploreCountry(state,null)));
 element<HTMLButtonElement>('world-reset-place').addEventListener('click',()=>write(selectExploreCountry(state,null),true));
 resetCategory.addEventListener('click',()=>write(selectExploreCategory(state,null)));
 countryView.addEventListener('click',()=>{if(city)write(selectExploreCountry(state,city.countryCode),true);});
 section.querySelectorAll<HTMLButtonElement>('[data-world-city]').forEach(button=>button.addEventListener('click',()=>{
  const id=button.dataset.worldCity;if(!id||!/^\d{1,12}$/u.test(id))return;write({...state,active:true,cityId:id,countryCode:null},true);
 }));
 countries.addEventListener('change',()=>write(selectExploreCountry(state,countries.value||null)));
 categories.addEventListener('change',()=>write(selectExploreCategory(state,(categories.value||null) as PublicEditorialCategory|null)));
 search.addEventListener('submit',event=>{event.preventDefault();if(!composing)void lookup();});
 query.addEventListener('input',()=>{cancelSearch();searchStatus.textContent='';if(!composing&&query.value.trim().length>=2)searchTimer=setTimeout(()=>{void lookup();},250);});
 query.addEventListener('compositionstart',()=>{composing=true;cancelSearch();});query.addEventListener('compositionend',()=>{composing=false;void lookup();});
 query.addEventListener('keydown',event=>{if(event.key==='Escape'){cancelSearch();searchStatus.textContent='';}if(event.key==='ArrowDown'&&!matches.hidden){event.preventDefault();matches.querySelector<HTMLButtonElement>('button')?.focus();}});
 matches.addEventListener('keydown',event=>{const buttons=[...matches.querySelectorAll<HTMLButtonElement>('button')],index=buttons.findIndex(button=>button===document.activeElement);if(event.key==='Escape'){cancelSearch();query.focus();}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const next=event.key==='ArrowDown'?index+1:index-1;if(next<0)query.focus();else buttons[Math.min(next,buttons.length-1)]?.focus();}});
 more.addEventListener('click',()=>{const before=pageSize;pageSize+=PAGE_SIZE;update();const item=grid.querySelectorAll<HTMLElement>('article')[before];const heading=item?.querySelector<HTMLElement>('h3');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}});
 refresh.addEventListener('click',()=>{if(placeFailed)void resolvePlace();else options.refresh();void loadCountries();});
 element<HTMLButtonElement>('world-copy').addEventListener('click',()=>{void(async()=>{
  const url=localeUrl(exploreUrl(new URL('/',window.location.origin),state),getLocale());copyFallback.hidden=true;
  try{if(!navigator.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');await navigator.clipboard.writeText(url);copyStatus.textContent=tr('linkCopied');}
  catch{copyFallback.value=url;copyFallback.hidden=false;copyFallback.focus();copyFallback.select();copyStatus.textContent=tr('copyLinkFallback');}
 })();});
 window.addEventListener('popstate',()=>{cancelSearch();searchStatus.textContent='';copyStatus.textContent='';copyFallback.hidden=true;const next=parseExploreState(window.location.href);if(!next.active){close(false);state=next;present();return;}state=next;pageSize=PAGE_SIZE;lastSelectionKey='';void resolvePlace();void loadCountries();});
 for(const id of ['entry-today','entry-return','entry-saved','entry-show-city'])element<HTMLButtonElement>(id).addEventListener('click',()=>close(true,false));
 document.addEventListener('dlkt:reader-selected',event=>{if(event instanceof CustomEvent&&object(event.detail)&&event.detail.restored===true)return;close(true,false);});
 document.addEventListener('dlkt:city-selected',event=>{if(!(event instanceof CustomEvent)||!object(event.detail)||event.detail.restored===true||event.detail.estimated===true)return;close(true,false);});
 document.addEventListener('dlkt:daily-selected',event=>{if(event instanceof CustomEvent&&object(event.detail)&&event.detail.restored===true)return;close(true,false);});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')update();else clearTimeout(expiryTimer);});
 document.addEventListener('dlkt:language-changed',()=>{cancelSearch();searchStatus.textContent='';copyStatus.textContent='';copyFallback.hidden=true;lastSelectionKey='';localizeControls();present();});
 if(state.active){void resolvePlace();void loadCountries();}else present();
 return Object.freeze({update});
}
