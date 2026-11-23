/**
 * Public, build-time, read-only view of the existing ICEO source directory.
 * Source status is registration metadata, not proof of availability or reuse rights.
 * There is no network request, active crawler, HTML interpreter or user-supplied URL.
 */
const STATUS = Object.freeze({
 'configured': {heading:'Configured source definitions',note:'An endpoint is registered. Its freshness, rights review and individual requests can still fail.'},
 'origin-reviewed': {heading:'Recognised publisher origins',note:'Publisher identity is reviewed. This does not mean a live feed or permission to republish.'},
 'candidate': {heading:'Discovery candidates',note:'Research only. Not approved for source acquisition or content reuse.'},
});
const escapeHtml=(input)=>String(input).replace(/[&<>"']/gu,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const country=(code)=>code===null?'Scope not specified':code;
export function renderSourceAtlas(entries){
 if(!Array.isArray(entries)||entries.length>5000)throw Error('ATLAS_PUBLIC_INVALID');
 const seen=new Set();
 const grouped={'configured':[],'origin-reviewed':[],'candidate':[]};
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||!Object.hasOwn(grouped,entry.status)||
     typeof entry.id!=='string'||!/^(?:configured|publisher|candidate):[a-z0-9-]+$/u.test(entry.id)||
     seen.has(entry.id)||typeof entry.name!=='string'||entry.name.trim().length<2||entry.name.length>200||
     typeof entry.origin!=='string'||entry.origin.length>600||
     !['configured','origin-index','discovery-only'].includes(entry.acquisition)||
     !['reviewed-until-expiry','source-specific-review-required'].includes(entry.rights))throw Error('ATLAS_PUBLIC_ENTRY_INVALID');
  let u;try{u=new URL(entry.origin);}catch{throw Error('ATLAS_PUBLIC_URL_INVALID');}
  if(u.protocol!=='https:'||u.href!==entry.origin+'/'&&u.href!==entry.origin||u.origin!==entry.origin||
     u.username||u.password||u.port||u.search||u.hash||u.pathname!=='/'||
     /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.)/u.test(u.hostname))throw Error('ATLAS_PUBLIC_URL_INVALID');
  if(entry.status==='candidate'&&(entry.acquisition!=='discovery-only'||entry.rights!=='source-specific-review-required'))throw Error('ATLAS_PUBLIC_CANDIDATE_PROMOTION');
  seen.add(entry.id);
  grouped[entry.status].push(entry);
 }
 const knownUniqueOrigins=new Set(entries.map(entry=>entry.origin)).size;
 const header='<section id="iceo-source-atlas" aria-labelledby="iceo-source-atlas-title"><h2 id="iceo-source-atlas-title">ICEO source universe</h2>'+
  '<p>Inspect the source registrations behind DLKT INFO. These are directory records, not real-time checks, active publisher counts or permission to copy articles. Every source still needs verified freshness, rights and a valid original link before a news card appears.</p>'+
  '<p><strong>'+entries.length+' source records</strong> across '+knownUniqueOrigins+' distinct HTTPS origins in this build. Source origin does not establish event location or neighborhood coverage.</p>';
 const sections=Object.entries(STATUS).map(([status,labels])=>{
  const records=grouped[status];
  const items=[...records].sort((a,b)=>a.name.localeCompare(b.name,'en')).map(entry=>
   '<li><a href="'+escapeHtml(entry.origin)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(entry.name)+'</a> <small>('+escapeHtml(entry.vertical)+', '+escapeHtml(entry.scope)+(entry.countryCode?', '+escapeHtml(country(entry.countryCode)):'')+')</small></li>').join('');
  return '<details><summary>'+escapeHtml(labels.heading)+' ('+records.length+')</summary><p>'+escapeHtml(labels.note)+'</p><ul>'+items+'</ul></details>';
 }).join('');
 return header+sections+'<p>All three groups are intentionally distinct. Candidates are never enabled by being listed here. The figures describe this deployment snapshot, not the number of live stories or sources checked today.</p></section>';
}
