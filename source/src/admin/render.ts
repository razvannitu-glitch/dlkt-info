import {RANGES,type Analytics,type Row} from './analytics.js';
const number=new Intl.NumberFormat('en-US');
const fmt=(n:number|null|undefined)=>n===null||n===undefined?'—':number.format(n);
export function escapeHtml(s:string):string{
 return s.replace(/[&<>"']/gu,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]??c));
}
function shell(content:string,title:string):string{
 return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+escapeHtml(title)+' · DLKT</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/admin.css"></head><body><header><a href="/"><img src="/kate-head.png" alt="" width="34" height="34"><strong>DLKT</strong></a><span>CONTROL</span><a class="exit" href="/account">Account</a></header><main>'+content+'</main></body></html>';
}
export function renderUnavailable(message:string,signIn=false):string{
 return shell('<section class="notice"><h1>'+escapeHtml(message)+'</h1>'+(signIn?'<p><a href="/account">Sign in to your account</a></p>':'')+'</section>','Control');
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
export function renderDashboard(a:Analytics):string{
 const filters=RANGES.map(r=>'<a href="/admin?range='+r+'"'+(r===a.range?' aria-current="page"':'')+'>'+(r==='all'?'All time':r)+'</a>').join('');
 const status=!a.audienceEnabled?'Audience measurement not configured':a.totals===null?'Audience source unavailable':'Audience measurement connected';
 return shell('<div class="top"><div><p class="eyebrow">PRIVATE ADMINISTRATION</p><h1>Overview<span>.</span></h1><p class="sub">'+escapeHtml(status)+'</p></div><div><nav aria-label="Time range">'+filters+'</nav><a class="refresh" href="/admin?range='+a.range+'">Refresh</a></div></div><div class="grid metrics">'+
 card('Unique visitors',a.totals?.visitors,'Selected period · provider estimate')+
 card('Pageviews',a.totals?.pageviews,'Selected period')+
 card('Recent visitors',a.recent?.visitors,'Last 30 minutes · not concurrent users')+
 card('Reader profiles',a.profiles,'All-time · Supabase profiles, not visitor count')+
 card('New profiles',a.newProfiles,'Created in selected period')+
 card('Online now',null,'Concurrent sessions not measured')+
 '</div><div class="grid panels">'+table('Traffic by day',a.daily,true)+table('Countries',a.countries)+table('Traffic sources',a.referrers)+table('Most viewed pages',a.pages)+table('Devices',a.devices)+'<section class="panel"><h2>Cities &amp; other metrics</h2><p class="empty">City-level data, session counts, returning visitors, editorial card interactions and revenue are not currently available from a verified source.</p></section></div><footer>Updated '+escapeHtml(a.asOf)+' · UTC. '+(a.audienceSince?'Audience query starts '+escapeHtml(a.audienceSince)+'. Provider retention may limit coverage. ':'')+'Unique visitors are provider estimates; breakdowns are not necessarily additive. A dash means unavailable, not zero.</footer>','Control');
}
