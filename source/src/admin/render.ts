import {RANGES,type Analytics,type Row} from './analytics.js';
import type {AudienceBreakdown,AudienceSnapshot} from '../audience/storage.js';
const number=new Intl.NumberFormat('en-US');
const fmt=(n:number|null|undefined)=>n===null||n===undefined?'—':number.format(n);
const HTML_ENTITIES:Readonly<Record<string,string>>={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
export function escapeHtml(s:string):string{
 return s.replace(/[&<>"']/gu,c=>HTML_ENTITIES[c]??c);
}
function shell(content:string,title:string):string{
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escapeHtml(title)+' · DLKT</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"></head><body><header><a href="/"><img src="/kate-head.png" alt="" width="34" height="34"><strong>DLKT</strong></a><span>CONTROL</span><a class="exit" href="/account">Account</a></header><main>'+content+'</main></body></html>';
}
export function renderUnavailable(message:string,signIn=false):string{
 return shell('<section class="notice"><h1>'+escapeHtml(message)+'</h1>'+(signIn?'<p><a href="/account">Sign in to your account</a></p>':'')+'</section>','Control');
}
export function renderInvalidRange():string{
 return shell('<section class="notice"><h1>Invalid time range</h1><p><a href="/admin">Open Control with the default time range</a></p></section>','Control');
}
function card(label:string,value:number|null|undefined,detail:string):string{
 return '<article class="card"><h2>'+escapeHtml(label)+'</h2><strong class="metric">'+fmt(value)+'</strong><p>'+escapeHtml(detail)+'</p></article>';
}
function table(title:string,rows:Row[]|null,chronological=false):string{
 if(rows===null)return '<section class="panel"><h2>'+escapeHtml(title)+'</h2><p class="empty">Not available from the source.</p></section>';
 if(rows.length===0)return '<section class="panel"><h2>'+escapeHtml(title)+'</h2><p class="empty">No measured activity in this range.</p></section>';
 const items=chronological?rows:rows.slice(0,15);
 const max=Math.max(1,...items.map(r=>r.pageviews));
 return '<section class="panel"><h2>'+escapeHtml(title)+'</h2><div class="table-wrap"><table><thead><tr><th scope="col">'+(chronological?'UTC day':'Name')+'</th><th scope="col">Visitors</th><th scope="col">Views</th></tr></thead><tbody>'+items.map(r=>'<tr><th scope="row">'+escapeHtml(chronological?new Date(r.label).toISOString().slice(0,10):r.label)+'<meter aria-label="Relative pageviews" min="0" max="'+max+'" value="'+r.pageviews+'"></meter></th><td>'+fmt(r.visitors)+'</td><td>'+fmt(r.pageviews)+'</td></tr>').join('')+'</tbody></table></div></section>';
}
function audienceTable(title:string,rows:readonly AudienceBreakdown[]):string{
 if(!rows.length)return '<section class="panel"><h2>'+escapeHtml(title)+'</h2><p class="empty">No reportable activity for this range.</p></section>';
 const max=Math.max(1,...rows.map(r=>r.visitors));
 return '<section class="panel"><h2>'+escapeHtml(title)+'</h2><div class="table-wrap"><table><thead><tr><th scope="col">Name</th><th scope="col">Browsers</th><th scope="col">Sessions</th></tr></thead><tbody>'+rows.slice(0,15).map(r=>'<tr><th scope="row">'+escapeHtml(r.label)+'<meter aria-label="Relative browser count" min="0" max="'+max+'" value="'+r.visitors+'"></meter></th><td>'+fmt(r.visitors)+'</td><td>'+fmt(r.sessions)+'</td></tr>').join('')+'</tbody></table></div></section>';
}
function audienceSeries(s:AudienceSnapshot):string{
 if(!s.series.length)return '<section class="panel"><h2>Traffic over time</h2><p class="empty">No measured activity in this range.</p></section>';
 const max=Math.max(1,...s.series.map(r=>r.pageviews));
 return '<section class="panel"><h2>Traffic over time</h2><div class="table-wrap"><table><thead><tr><th scope="col">UTC '+s.bucket+'</th><th scope="col">Views</th><th scope="col">Session starts</th></tr></thead><tbody>'+s.series.map(r=>'<tr><th scope="row">'+escapeHtml(s.bucket==='hour'?r.timestamp.slice(0,16).replace('T',' '):r.timestamp.slice(0,10))+'<meter aria-label="Relative pageviews" min="0" max="'+max+'" value="'+r.pageviews+'"></meter></th><td>'+fmt(r.pageviews)+'</td><td>'+fmt(r.sessionStarts)+'</td></tr>').join('')+'</tbody></table></div></section>';
}
function firstPartyDashboard(a:Analytics,filters:string):string{
 const ready=a.firstParty.status==='ready'?a.firstParty:null,s=ready?.snapshot;
 const top='<div class="top"><div><p class="eyebrow">PRIVATE ADMINISTRATION</p><h1>Overview<span>.</span></h1><p class="sub">'+(s?'First-party audience · opt-in browsers':'First-party audience unavailable')+'</p></div><div><nav aria-label="Time range">'+filters+'</nav><a class="refresh" href="/admin?range='+a.range+'">Refresh</a></div></div>';
 const metrics='<div class="grid metrics">'+card('Consenting browsers',s?.visitors,'Unique measured browsers · selected period')+card('Pageviews',s?.pageviews,'Measured page entries')+card('Session starts',s?.sessionStarts,'Selected period · 30-minute inactivity timeout')+card('Active in last 5 min',s?.active5m,'Recent measured browsers · not concurrent people')+card('Repeat browsers',s?.repeatBrowsers,'Two or more sessions overlapping the period')+card('Reader profiles',a.profiles,'All-time · separate from audience')+card('New profiles',a.newProfiles,'Created in selected period')+'</div>';
 const panels=s?'<div class="grid panels">'+audienceSeries(s)+audienceTable('Countries',s.countries)+audienceTable('Cities',s.cities)+audienceTable('Traffic sources',s.sources)+'</div>':'<section class="panel"><p class="empty">No verified first-party snapshot is available. Counts are not zero.</p></section>';
 return shell(top+metrics+panels+'<footer>Updated '+escapeHtml(s?.asOf??a.asOf)+' · UTC. '+(ready?'Measured coverage starts '+escapeHtml(ready.coverageSince)+'. Retention: 90 days. Geography is approximate; groups under three browsers are hidden. ':'')+'Audience data is consent-based, not a census of people. Country and city totals may overlap. Editorial interactions and revenue are not measured here.</footer>','Control');
}
export function renderDashboard(a:Analytics):string{
 const filters=RANGES.map(r=>'<a href="/admin?range='+r+'"'+(r===a.range?' aria-current="page"':'')+'>'+(r==='all'?'All time':r)+'</a>').join('');
 if(a.firstParty.status!=='disabled')return firstPartyDashboard(a,filters);
 const status=!a.audienceEnabled?'Audience measurement not configured':a.totals===null?'Audience source unavailable':'Audience measurement connected';
 return shell('<div class="top"><div><p class="eyebrow">PRIVATE ADMINISTRATION</p><h1>Overview<span>.</span></h1><p class="sub">'+escapeHtml(status)+'</p></div><div><nav aria-label="Time range">'+filters+'</nav><a class="refresh" href="/admin?range='+a.range+'">Refresh</a></div></div><div class="grid metrics">'+
 card('Unique visitors',a.totals?.visitors,'Selected period · provider estimate')+
 card('Pageviews',a.totals?.pageviews,'Selected period')+
 card('Recent visitors',a.recent?.visitors,'Last 30 minutes · not concurrent users')+
 card('Reader profiles',a.profiles,'All-time · Supabase profiles, not visitor count')+
 card('New profiles',a.newProfiles,'Created in selected period')+
 card('Online now',null,'Concurrent sessions not measured')+
 '</div><div class="grid panels">'+table('Traffic by day',a.daily,true)+table('Countries',a.countries)+table('Traffic sources',a.referrers)+table('Most viewed pages',a.pages)+table('Devices',a.devices)+'<section class="panel"><h2>Cities &amp; other metrics</h2><p class="empty">City-level data, session counts, returning visitors, editorial card interactions and revenue are not currently available from a verified source.</p></section></div><footer>Updated '+escapeHtml(a.asOf)+' · UTC. '+(a.audienceSince?'Audience query starts '+escapeHtml(a.audienceSince)+'. Provider retention and the 100-row query limit may restrict coverage. ':'')+'Unique visitors are provider estimates; breakdowns are not necessarily additive. A dash means unavailable, not zero.</footer>','Control');
}
