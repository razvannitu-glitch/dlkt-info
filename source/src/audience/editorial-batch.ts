import {NEWS_TAXONOMY_VERSION} from '../iceo/news-taxonomy.js';
import {EDITORIAL_PILOT_CATEGORIES,type EditorialPilotCategory} from './editorial-pilot.js';
import {EDITORIAL_DOCUMENT_LIMIT,type EditorialExposureSnapshot} from './editorial-exposure.js';

/** Synthetic, exposure-only wire contract. Never claims complete daily coverage. */
export const EDITORIAL_BATCH_VERSION='dlkt-editorial-exposure-batch-lab-1' as const;
export const EDITORIAL_BATCH_SCOPE='public-home-global-news-opt-in-lab' as const;
export const EDITORIAL_BATCH_BYTES=2048;
export const EDITORIAL_DAY_MS=86_400_000;
export interface EditorialExposureRow {
 readonly category:EditorialPilotCategory;readonly qualifiedImpressions:number;
}
export interface EditorialExposureBatch {
 readonly version:typeof EDITORIAL_BATCH_VERSION;
 readonly scope:typeof EDITORIAL_BATCH_SCOPE;
 readonly taxonomyVersion:typeof NEWS_TAXONOMY_VERSION;
 readonly day:string;
 readonly coverage:'document-only';
 readonly rows:readonly EditorialExposureRow[];
}
function record(value:unknown):Record<string,unknown>|null{
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;
}
function exact(value:Record<string,unknown>,keys:string):boolean{return Object.keys(value).sort().join(',')===keys;}
export function editorialDayStart(value:unknown):number|null{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))return null;
 const n=Date.parse(value+'T00:00:00.000Z');
 return Number.isSafeInteger(n)&&n>=0&&new Date(n).toISOString().slice(0,10)===value?n:null;
}
function count(value:unknown):value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=EDITORIAL_DOCUMENT_LIMIT;}
function readRows(value:unknown):EditorialExposureRow[]|null{
 if(!Array.isArray(value)||value.length!==EDITORIAL_PILOT_CATEGORIES.length)return null;
 const rows:EditorialExposureRow[]=[];let total=0;
 for(const [index,category] of EDITORIAL_PILOT_CATEGORIES.entries()){
  const raw:unknown=value[index],row=record(raw);
  if(!row||!exact(row,'category,qualifiedImpressions')||row.category!==category||!count(row.qualifiedImpressions))return null;
  total+=row.qualifiedImpressions;rows.push({category,qualifiedImpressions:row.qualifiedImpressions});
 }
 // Empty documents produce no submission. A single batch is bounded across all cells.
 return total>0&&total<=EDITORIAL_DOCUMENT_LIMIT?rows:null;
}
function batch(day:string,rows:readonly EditorialExposureRow[]):EditorialExposureBatch{
 return {version:EDITORIAL_BATCH_VERSION,scope:EDITORIAL_BATCH_SCOPE,taxonomyVersion:NEWS_TAXONOMY_VERSION,day,coverage:'document-only',rows};
}
/** No identifiers, event times, numerator, URL, locale, geo, or free text in this envelope. */
export function encodeEditorialExposureBatch(snapshot:EditorialExposureSnapshot,day:string):Uint8Array|null{
 if(snapshot.status!=='observing-lab'||snapshot.productionActivationAllowed!==false||snapshot.automationAllowed!==false||editorialDayStart(day)===null)return null;
 const rows=readRows(snapshot.rows);if(!rows)return null;
 return new TextEncoder().encode(JSON.stringify(batch(day,rows)));
}
/** Canonical compact JSON bytes only. Exact reconstruction also rejects duplicate JSON
 * keys, alternative numeric representations, extra whitespace and reordered fields. */
export function parseEditorialExposureBatch(bytes:unknown):EditorialExposureBatch|null{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||bytes.byteLength>EDITORIAL_BATCH_BYTES)return null;
 try{
  const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
  const decoded:unknown=JSON.parse(text),value=record(decoded);
  if(!value||!exact(value,'coverage,day,rows,scope,taxonomyVersion,version')
   ||value.version!==EDITORIAL_BATCH_VERSION||value.scope!==EDITORIAL_BATCH_SCOPE||value.taxonomyVersion!==NEWS_TAXONOMY_VERSION
   ||value.coverage!=='document-only'||typeof value.day!=='string'||editorialDayStart(value.day)===null)return null;
  const rows=readRows(value.rows);if(!rows)return null;
  const result=batch(value.day,rows);
  return JSON.stringify(result)===text?result:null;
 }catch{return null;}
}
