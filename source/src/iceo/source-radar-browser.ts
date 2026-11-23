/**
 * Read-only source transparency. A catalogued source is not a live feed.
 * This module never accepts new fetch URLs or grants network authority.
 */
export type RadarStatus='configured'|'origin-reviewed'|'candidate';
export type RadarScope='unknown'|'hyperlocal'|'city'|'region'|'country'|'international';
export interface RadarEntry{
 readonly id:string;readonly name:string;readonly origin:string;readonly vertical:string;
 readonly scope:RadarScope;readonly countryCode:string|null;readonly status:RadarStatus;
 readonly acquisition:'configured'|'origin-index'|'discovery-only';
 readonly rights:'reviewed-until-expiry'|'source-specific-review-required';
}
export interface RadarPayload{readonly version:'dlkt-source-radar-1';readonly entries:readonly RadarEntry[]}
export interface RadarFilter{
 readonly query:string;readonly status:RadarStatus|'all';
 readonly scope:RadarScope|'all';readonly vertical:string;
}
const statuses:readonly RadarStatus[]=['configured','origin-reviewed','candidate'];
const scopes:readonly RadarScope[]=['unknown','hyperlocal','city','region','country','international'];
const normalize=(value:string):string=>value.normalize('NFKD').replace(/[\u0300-\u036f]/gu,'').toLowerCase().trim();
const object=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
export function isRadarEntry(value:unknown):value is RadarEntry{
 if(!object(value)||typeof value.id!=='string'||!/^(configured|publisher|candidate):[a-z0-9-]+$/u.test(value.id)||
    typeof value.name!=='string'||value.name.length<2||value.name.length>180||
    typeof value.vertical!=='string'||!/^[a-z][a-z-]{1,40}$/u.test(value.vertical)||
    !scopes.includes(value.scope as RadarScope)||!statuses.includes(value.status as RadarStatus)||
    !(value.countryCode===null||typeof value.countryCode==='string'&&/^[A-Z]{2}$/u.test(value.countryCode))||
    !['configured','origin-index','discovery-only'].includes(String(value.acquisition))||
    !['reviewed-until-expiry','source-specific-review-required'].includes(String(value.rights)))return false;
 if(value.status==='candidate'&&(value.acquisition!=='discovery-only'||value.rights!=='source-specific-review-required'))return false;
 if(value.status==='origin-reviewed'&&value.acquisition!=='origin-index')return false;
 if(value.status==='configured'&&value.acquisition!=='configured')return false;
 try{
  const url=new URL(value.origin as string);
  return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&!url.search&&!url.hash&&
   url.origin===value.origin&&url.hostname.includes('.')&&!/^(?:[0-9.]+|\[[a-f0-9:]+\])$/iu.test(url.hostname)&&
   !/(?:^localhost$|\.localhost$|\.local$|\.internal$|\.test$|\.invalid$|\.example$|\.onion$)/u.test(url.hostname)&&
   !/[<>]/u.test(value.name as string);
 }catch{return false;}
}
export function isRadarPayload(value:unknown):value is RadarPayload{
 if(!object(value)||value.version!=='dlkt-source-radar-1'||!Array.isArray(value.entries)||
    value.entries.length>1000||value.entries.length===0)return false;
 const ids=new Set<string>();
 return value.entries.every(entry=>isRadarEntry(entry)&&!ids.has(entry.id)&&!!ids.add(entry.id));
}
export function selectRadarEntries(entries:readonly RadarEntry[],filter:RadarFilter):readonly RadarEntry[]{
 const q=normalize(filter.query).slice(0,120);
 return entries.filter(entry=>(filter.status==='all'||entry.status===filter.status)&&
  (filter.scope==='all'||entry.scope===filter.scope)&&
  (filter.vertical==='all'||entry.vertical===filter.vertical)&&
  (!q||normalize([entry.name,entry.vertical,entry.origin,entry.countryCode??''].join(' ')).includes(q)));
}
function setupSourceRadar():void{
 const root=document.getElementById('source-radar');
 if(root===null)return;
 const element=<T extends HTMLElement>(id:string):T=>{
  const value=root.querySelector<T>('#'+id);if(!value)throw Error('SOURCE_RADAR_ELEMENT_MISSING');return value;
 };
 const search=element<HTMLInputElement>('source-radar-search');
 const status=element<HTMLSelectElement>('source-radar-status');
 const scope=element<HTMLSelectElement>('source-radar-scope');
 const vertical=element<HTMLSelectElement>('source-radar-sector');
 const list=element<HTMLUListElement>('source-radar-items');
 const summary=element<HTMLElement>('source-radar-summary');
 const count=element<HTMLElement>('source-radar-count');
 const more=element<HTMLButtonElement>('source-radar-more');
 const safeText=(value:string):Text=>document.createTextNode(value);
 const label:Record<RadarStatus,string>={
  configured:'Configured definition', 'origin-reviewed':'Reviewed publisher origin',candidate:'Discovery candidate'
 };
 let entries:readonly RadarEntry[]=[];
 let limit=24;
 const render=():void=>{
  const matches=selectRadarEntries(entries,{query:search.value,status:status.value as RadarFilter['status'],
   scope:scope.value as RadarFilter['scope'],vertical:vertical.value});
  const fragment=document.createDocumentFragment();
  for(const entry of matches.slice(0,limit)){
   const item=document.createElement('li');item.className='source-radar-item';
   const title=document.createElement('a');title.href=entry.origin;title.target='_blank';
   title.rel='noopener noreferrer';title.textContent=entry.name;
   const details=document.createElement('p');
   details.append(safeText(label[entry.status]+' · '+entry.vertical+' · '+entry.scope+
    (entry.countryCode===null?'':' · '+entry.countryCode)));
   item.append(title,details);fragment.append(item);
  }
  list.replaceChildren(fragment);
  count.textContent=String(matches.length)+' matching entries · '+String(Math.min(limit,matches.length))+' displayed';
  more.hidden=matches.length<=limit;
 };
 const reset=():void=>{limit=24;render();};
 for(const control of [search,status,scope,vertical])control.addEventListener(control===search?'input':'change',reset);
 more.addEventListener('click',()=>{limit+=24;render();});
 const load=async():Promise<void>=>{
  try{
   const response=await fetch('/source-radar-data.json',{credentials:'omit',cache:'force-cache',
    signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('SOURCE_RADAR_NETWORK_ERROR');
   const unknown:unknown=await response.json();
   if(!isRadarPayload(unknown))throw Error('SOURCE_RADAR_DATA_INVALID');
   entries=unknown.entries;
   const sectors=[...new Set(entries.map(x=>x.vertical))].sort();
   for(const sector of sectors){
    const option=document.createElement('option');option.value=sector;
    option.textContent=sector.replaceAll('-',' ');vertical.append(option);
   }
   const configured=entries.filter(x=>x.status==='configured').length;
   const reviewed=entries.filter(x=>x.status==='origin-reviewed').length;
   const candidates=entries.filter(x=>x.status==='candidate').length;
   summary.textContent=String(configured)+' configured definitions · '+String(reviewed)+
    ' reviewed publisher origins · '+String(candidates)+' discovery candidates. These counts do not indicate live availability.';
   render();
  }catch{
   summary.textContent='The directory is temporarily unavailable. Verified reader sources remain accessible on the original articles.';
   count.textContent='Source directory unavailable';
   more.hidden=true;
  }
 };
 void load();
}
if(typeof document!=='undefined')setupSourceRadar();
