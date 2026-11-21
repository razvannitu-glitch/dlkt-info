import {iceoEngine} from '../iceo/engine.js';
import {ICEO_SOURCES} from '../iceo/registry.js';
import {GLANCE_VERSION,eligiblePublication,type GlanceSnapshot} from './contracts.js';
import {forexService} from './forex.js';
const SOURCES=new Set(['nasa-news','usgs-news','fda-news','govuk-news']);
/** Shared public evidence; personal choices stay in the browser. */
export async function glanceSnapshot():Promise<GlanceSnapshot>{
 const [forex,results]=await Promise.all([forexService.read(),Promise.all(ICEO_SOURCES.filter(s=>SOURCES.has(s.id)).map(s=>iceoEngine.read(s)))]);
 const now=Date.now();const publications=results.flatMap(result=>result.cards.filter(c=>eligiblePublication(c,now)).slice(0,3));
 return {version:GLANCE_VERSION,generatedAt:new Date(now).toISOString(),forex,publications};
}
