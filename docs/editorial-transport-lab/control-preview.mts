import {escapeHtml,renderDashboard} from '../../source/.build/src/admin/render.js';
import type {Analytics} from '../../source/.build/src/admin/analytics.js';
import type {EditorialPilotCategory} from '../../source/.build/src/audience/editorial-pilot.js';
import {readDailyControlLab} from './daily-readback.mts';

const LABELS:Readonly<Record<EditorialPilotCategory,string>>={
 '05000000':'Education','06000000':'Environment','13000000':'Science & technology','15000000':'Sport','17000000':'Weather',
};
const MESSAGE={
 pending:'The fixed reporting window has not been finalized.',
 suppressed:'The complete report has been withheld by the experimental disclosure rules.',
 expired:'The synthetic reporting window has expired.',
 held:'The laboratory has held the result for an integrity check.',
 'invalid-readback':'The report failed verification.',
 'provider-unavailable':'The isolated data source is unavailable.',
} as const;
const format=new Intl.NumberFormat('en-US');
/** Only callable from the disposable fixture. Reuse the canonical Control shell
 * and its existing CSS classes without importing this module into the runtime.
 * Always validate the provider again inside this entry point.
 */
export async function renderEditorialControlPreview(day:string,now:number,call:()=>Promise<unknown>):Promise<string>{
 const data=await readDailyControlLab(day,now,call);
 const warning='<p class="empty"><strong>SYNTHETIC LAB PREVIEW — NOT LIVE ANALYTICS.</strong> Qualified exposures are observed document contributions, not unique readers, actual reading, interest or open rates. Editorial recommendations are disabled.</p>';
 const report=data.status==='sealed-lab'?
 '<p class="empty">UTC reporting day: '+escapeHtml(data.day)+' · Sealed: '+escapeHtml(data.sealedAt)+' · Observed documents only; coverage is not complete.</p><div class="table-wrap"><table><thead><tr><th scope="col">Category</th><th scope="col">Qualified exposures (synthetic)</th></tr></thead><tbody>'+
 data.rows.map(row=>'<tr><th scope="row">'+escapeHtml(LABELS[row.category])+'</th><td>'+format.format(row.qualifiedImpressions)+'</td></tr>').join('')+'</tbody></table></div>':
 '<p class="empty">Unavailable. '+escapeHtml(MESSAGE[data.reason])+' Missing or withheld quantities are not zero.</p>';
 // The surrounding panel is explicitly empty and synthetic. Never call live
 // analytics, load user identity, or combine a fixture with actual metrics.
 const unavailable:Analytics={range:'24h',asOf:'2026-01-01T00:00:00.000Z',profiles:null,newProfiles:null,firstParty:{status:'unavailable'},audienceSince:null,audienceEnabled:false,totals:null,recent:null,daily:null,countries:null,referrers:null,pages:null,devices:null};
 const html=renderDashboard(unavailable),boundary='</main>';
 if(html.split(boundary).length!==2)throw Error('CONTROL_SHELL_BOUNDARY');
 return html.replace(boundary,()=>'<section class="panel" aria-label="Synthetic editorial laboratory"><h2>Editorial Intelligence · lab preview</h2>'+warning+report+'</section>'+boundary);
}
