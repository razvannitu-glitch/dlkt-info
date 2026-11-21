import {Parser} from 'htmlparser2';
import {canonicalNewsUrl,publisherForNewsUrl} from './news-sources.js';
import type {NewsCandidate} from './news-discovery.js';

const PAGES = ['https://apnews.com/','https://www.theguardian.com/international','https://www.pcgamer.com/','https://www.bbc.com/news'] as const;
const MAX_BYTES = 1_048_576;
const SUPPRESSED = new Set(['script','style','template','noscript','nav','header','footer']);
export interface FrontpageHighlights {
  readonly urls: readonly string[];
  readonly checkedAt: string;
  /** At least one reviewed page had a readable main region. */
  readonly available: boolean;
  /** Pages unavailable or inspected only up to the byte limit; maximum four. */
  readonly rejected: number;
}
interface PageResult {readonly urls: readonly string[]; readonly available: boolean; readonly partial: boolean}

function matches(text: string, finalUrl: string, candidates: ReadonlySet<string>): {urls: string[]; main: boolean} {
  const urls: string[] = [], seen = new Set<string>();
  const stack: {main: boolean; suppressed: boolean}[] = [];
  const publisher = publisherForNewsUrl(finalUrl); let main = false, baseSeen = false, documentBase = finalUrl;
  // Do not let an incomplete opening tag at the byte boundary fabricate a URL.
  const lastOpen = text.lastIndexOf('<'), lastClose = text.lastIndexOf('>');
  const complete = lastOpen > lastClose ? text.slice(0,lastOpen) : text;
  const parser = new Parser({
    onopentag(name,attributes,isImplied) {
      if (name === 'base' && attributes.href && !baseSeen && !isImplied) {
        baseSeen = true;
        try { documentBase = new URL(attributes.href,finalUrl).href; }
        catch { documentBase = 'https://invalid.invalid/'; }
      }
      const parent = stack.at(-1);
      const inside = parent?.main === true || name === 'main';
      const suppressed = parent?.suppressed === true || SUPPRESSED.has(name)
        || Object.hasOwn(attributes,'hidden') || attributes['aria-hidden'] === 'true';
      stack.push({main:inside,suppressed});
      if (name === 'main' && !isImplied && !suppressed) main = true;
      if (isImplied || name !== 'a' || !inside || suppressed || urls.length >= 10 || !attributes.href) return;
      try {
        const absolute = new URL(attributes.href,documentBase).href;
        const url = canonicalNewsUrl(absolute);
        if (url && publisherForNewsUrl(url)?.id === publisher?.id && candidates.has(url) && !seen.has(url)) {
          seen.add(url); urls.push(url);
        }
      } catch { /* Non-article navigation has no editorial signal. */ }
    },
    onclosetag() { stack.pop(); },
  },{decodeEntities:true});
  parser.end(complete);
  return {urls,main};
}

async function inspectPage(fetcher: typeof fetch, homepage: string, candidates: ReadonlySet<string>, duration: number): Promise<PageResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const original = publisherForNewsUrl(homepage);
  const run = async (): Promise<PageResult> => {
    let current = homepage;
    for (let redirects=0; redirects<=2; redirects++) {
      if (controller.signal.aborted) throw Error('FRONTPAGE_TIMEOUT');
      const response = await fetcher(current,{method:'GET',credentials:'omit',redirect:'manual',cache:'no-store',signal:controller.signal,
        headers:{Accept:'text/html, application/xhtml+xml','User-Agent':'DLKT-Info-ICEO/1.0 (+https://www.dlkt.ee)'}});
      if (response.redirected) { await response.body?.cancel(); throw Error('FRONTPAGE_UNEXPECTED_REDIRECT'); }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location'); await response.body?.cancel();
        if (!location || redirects === 2) throw Error('FRONTPAGE_REDIRECT_REJECTED');
        const next = new URL(location,current);
        if (publisherForNewsUrl(next.href)?.id !== original?.id) throw Error('FRONTPAGE_REDIRECT_REJECTED');
        next.hash=''; current=next.href; continue;
      }
      const type = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
      if (!response.ok || !['text/html','application/xhtml+xml'].includes(type ?? '')) {
        await response.body?.cancel(); throw Error('FRONTPAGE_UNAVAILABLE');
      }
      const declared = response.headers.get('content-length');
      if (declared !== null && !/^\d+$/u.test(declared)) { await response.body?.cancel(); throw Error('FRONTPAGE_LENGTH_INVALID'); }
      const reader = response.body?.getReader(); if (!reader) throw Error('FRONTPAGE_EMPTY');
      const parts: Uint8Array[]=[]; let size=0, partial=declared !== null && Number(declared)>MAX_BYTES;
      const cancel=():void=>{void reader.cancel().catch(()=>undefined);};
      controller.signal.addEventListener('abort',cancel,{once:true});
      try {
        for (;;) {
          const part=await reader.read(); if (part.done) break;
          const remaining=MAX_BYTES-size;
          parts.push(part.value.subarray(0,remaining)); size+=Math.min(part.value.byteLength,remaining);
          if (size>=MAX_BYTES) {partial=true;await reader.cancel();break;}
        }
      } finally {controller.signal.removeEventListener('abort',cancel);reader.releaseLock();}
      if (controller.signal.aborted || size===0) throw Error('FRONTPAGE_UNAVAILABLE');
      // Streaming decode drops only an incomplete UTF-8 tail at the byte boundary.
      const decoder=new TextDecoder('utf-8',{fatal:true});
      const text=decoder.decode(Buffer.concat(parts),{stream:partial});
      const found=matches(text,current,candidates);
      return {urls:found.urls,available:found.main,partial:partial||!found.main};
    }
    throw Error('FRONTPAGE_REDIRECT_REJECTED');
  };
  try {
    return await Promise.race([run(),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>{controller.abort();reject(Error('FRONTPAGE_TIMEOUT'));},duration);
    })]);
  } finally {if(timer)clearTimeout(timer);controller.abort();}
}

/** deadlineMs is a remaining duration, capped at 2.5 seconds for the four parallel requests.
 * Only exact candidate links in a reviewed publisher's main region are retained.
 * This proves homepage selection at checkedAt, not popularity or independent confirmation.
 */
export async function collectFrontpageHighlights(fetcher: typeof fetch,candidates: readonly NewsCandidate[],now: number,deadlineMs=2500): Promise<FrontpageHighlights> {
  if (!Number.isFinite(now) || !Number.isFinite(new Date(now).getTime())) throw Error('FRONTPAGE_CLOCK_INVALID');
  const checkedAt=new Date(now).toISOString();
  const duration=Number.isFinite(deadlineMs)?Math.max(0,Math.min(2500,Math.floor(deadlineMs))):0;
  if (!duration) return Object.freeze({urls:Object.freeze([]),checkedAt,available:false,rejected:PAGES.length});
  const expected=new Set<string>();
  for (const value of candidates.slice(0,500)) {
    if (typeof value.sourceUrl !== 'string' || typeof value.publisher !== 'string') continue;
    const url=canonicalNewsUrl(value.sourceUrl),publisher=publisherForNewsUrl(value.sourceUrl);
    if (url && url===value.sourceUrl && publisher?.label===value.publisher) expected.add(url);
  }
  if (!expected.size) return Object.freeze({urls:Object.freeze([]),checkedAt,available:false,rejected:0});
  const responses=await Promise.allSettled(PAGES.map(page=>inspectPage(fetcher,page,expected,duration)));
  const urls=new Set<string>(); let available=false,rejected=0;
  for (const response of responses) {
    if (response.status==='rejected') {rejected++;continue;}
    available ||= response.value.available;
    if (response.value.partial) rejected++;
    if (response.value.available) for (const url of response.value.urls) urls.add(url);
  }
  return Object.freeze({urls:Object.freeze([...urls]),checkedAt,available,rejected});
}
