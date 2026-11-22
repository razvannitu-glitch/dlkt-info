import {readPersistenceConfiguration} from '../persistence/config.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import {validateNewsCandidate, type NewsCandidate} from './news-discovery.js';

/** Match the existing table capacity without changing the500-row RPC contract. */
export const NEWS_CANDIDATE_STORE_LIMIT = 5000;
export const NEWS_CANDIDATE_BATCH_LIMIT = 500;
const WINDOW_MS = 86_400_000;
const FUTURE_MS = 300_000;
const MAX_BYTES = 2_097_152;
const PAGE_LIMIT = NEWS_CANDIDATE_BATCH_LIMIT;
const WRITER_KEY = /^[A-Za-z0-9_-]{43,128}$/u;
const FIELDS = ['category', 'indexedAt', 'publisher', 'sourceUrl', 'title'];
const ROW_FIELDS = ['category', 'indexed_at', 'publisher', 'source_url', 'title'];
const SELECT = 'source_url,title,publisher,indexed_at,category';

export class NewsCandidateStoreError extends Error {
  constructor(readonly code: 'NEWS_CANDIDATE_INVALID' | 'NEWS_CANDIDATE_STORE_UNAVAILABLE') {
    super(code); this.name = 'NewsCandidateStoreError';
  }
}
export interface NewsCandidateReadResult {
  readonly candidates: readonly NewsCandidate[];
  /** Invalid or conflicting rows were isolated; this is not complete discovery coverage. */
  readonly rejected: number;
  /** A bounded page failed or the finite table capacity was reached; earlier valid pages remain usable. */
  readonly partial?: true;
}
export interface NewsCandidateStore {
  readonly writable: boolean;
  read(now: number): Promise<NewsCandidateReadResult>;
  write(candidates: readonly NewsCandidate[], now: number): Promise<number>;
}
function exactObject(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === fields.join('\0');
}
function validNow(now: number): boolean {
  return Number.isFinite(now) && Number.isFinite(new Date(now - WINDOW_MS).getTime())
    && Number.isFinite(new Date(now + FUTURE_MS).getTime());
}
function candidate(value: unknown, now: number): NewsCandidate | null {
  if (!exactObject(value, FIELDS)) return null;
  const accepted = validateNewsCandidate(value, now);
  if (!accepted) return null;
  // Own the projection, including its date representation: never retain caller extras.
  return Object.freeze({sourceUrl: accepted.sourceUrl, title: accepted.title, publisher: accepted.publisher,
    indexedAt: new Date(accepted.indexedAt).toISOString(), category: accepted.category});
}
function row(value: unknown, now: number): NewsCandidate | null {
  if (!exactObject(value, ROW_FIELDS)) return null;
  return candidate({sourceUrl: value.source_url, title: value.title, publisher: value.publisher,
    indexedAt: value.indexed_at, category: value.category}, now);
}
function signature(value: NewsCandidate): string {
  return JSON.stringify([value.sourceUrl, value.title, value.publisher, value.indexedAt, value.category]);
}
interface RequestBudget {readonly deadline: number; remainingBytes: number}
async function boundedJson(response: Response, budget: RequestBudget, signal: AbortSignal): Promise<unknown> {
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    await response.body?.cancel(); throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > budget.remainingBytes)) {
    await response.body?.cancel(); throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
  const parts: Uint8Array[] = [];
  const abort = (): void => {void reader.cancel().catch(() => undefined);};
  signal.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      if (signal.aborted) throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
      const next = await reader.read(); if (next.done) break;
      budget.remainingBytes -= next.value.byteLength;
      if (budget.remainingBytes < 0) { await reader.cancel(); throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE'); }
      parts.push(next.value);
    }
    if (signal.aborted) throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } finally { signal.removeEventListener('abort', abort); reader.releaseLock(); }
}

/** Server-only optional cache. Callers must isolate failures from fresh discovery.
 * A cached candidate is never an EvidenceCard: recheck the original publication date.
 */
export function createNewsCandidateStore(environment: Readonly<Record<string, string | undefined>>,
  fetchImplementation: PersistenceFetch = fetch): NewsCandidateStore | null {
  const configuration = readPersistenceConfiguration(environment);
  if (configuration.state !== 'ready') return null;
  const supplied = environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
  const writerKey = supplied !== undefined && WRITER_KEY.test(supplied) ? supplied : null;
  const base = new URL('/rest/v1/', configuration.url);
  async function request(path: string, init: RequestInit, budget: RequestBudget): Promise<unknown> {
    const remaining = budget.deadline - Date.now();
    if (remaining <= 0 || budget.remainingBytes <= 0) throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {controller.abort(); reject(new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE'));}, remaining);
    });
    try {
      const pending = (async(): Promise<unknown> => {
        const response = await fetchImplementation(new URL(path, base), {...init, signal: controller.signal,
          credentials: 'omit', redirect: 'error', cache: 'no-store'});
        if (controller.signal.aborted) {void response.body?.cancel().catch(() => undefined); throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');}
        return boundedJson(response, budget, controller.signal);
      })();
      return await Promise.race([pending, timedOut]);
    } catch { throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE'); }
    finally { clearTimeout(timeout); controller.abort(); }
  }
  return Object.freeze({
    writable: writerKey !== null,
    async read(now: number): Promise<NewsCandidateReadResult> {
      if (!validNow(now)) throw new NewsCandidateStoreError('NEWS_CANDIDATE_INVALID');
      const budget: RequestBudget = {deadline: Date.now() + 2_500, remainingBytes: MAX_BYTES};
      const query = new URLSearchParams({select: SELECT, order: 'indexed_at.desc,source_url.asc', limit: String(PAGE_LIMIT)});
      query.append('indexed_at', 'gte.'+new Date(now - WINDOW_MS).toISOString());
      query.append('indexed_at', 'lte.'+new Date(now + FUTURE_MS).toISOString());
      const accepted = new Map<string, NewsCandidate | null>(); let rejected = 0, partial = false;
      for(let offset=0;offset<NEWS_CANDIDATE_STORE_LIMIT;offset+=PAGE_LIMIT){
        query.set('offset',String(offset));
        let values:readonly unknown[];
        try{
          const value=await request('dlkt_info_news_candidates?'+query.toString(),{
            method:'GET',headers:{apikey:configuration.publishableKey,Accept:'application/json'},
          },budget);
          if(!Array.isArray(value)||value.length>PAGE_LIMIT)throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
          values=value;
        }catch(error){if(offset===0)throw error;partial=true;break;}
        for(const raw of values){
          const entry=row(raw,now);
          if(!entry){rejected++;continue;}
          const previous=accepted.get(entry.sourceUrl);
          if(previous===undefined)accepted.set(entry.sourceUrl,entry);
          else if(previous===null)rejected++;
          else if(signature(previous)!==signature(entry)){accepted.set(entry.sourceUrl,null);rejected+=2;}
        }
        if(values.length<PAGE_LIMIT)break;
        if(offset+PAGE_LIMIT===NEWS_CANDIDATE_STORE_LIMIT)partial=true;
      }
      return Object.freeze({candidates: Object.freeze([...accepted.values()].filter((entry): entry is NewsCandidate => entry !== null)), rejected,
        ...(partial ? {partial: true as const} : {})});
    },
    async write(candidates: readonly NewsCandidate[], now: number): Promise<number> {
      if (!validNow(now) || !Array.isArray(candidates) || candidates.length > NEWS_CANDIDATE_STORE_LIMIT) throw new NewsCandidateStoreError('NEWS_CANDIDATE_INVALID');
      const accepted = new Map<string, NewsCandidate>();
      for (const raw of candidates) {
        const entry = candidate(raw, now);
        if (!entry) throw new NewsCandidateStoreError('NEWS_CANDIDATE_INVALID');
        const previous = accepted.get(entry.sourceUrl);
        if (previous && signature(previous) !== signature(entry)) throw new NewsCandidateStoreError('NEWS_CANDIDATE_INVALID');
        accepted.set(entry.sourceUrl, entry);
      }
      if (writerKey === null) throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
      if (accepted.size === 0) return 0;
      const rows=[...accepted.values()],bodies:string[]=[];
      let requestBytes=0;
      for(let offset=0;offset<rows.length;offset+=NEWS_CANDIDATE_BATCH_LIMIT){
        const body=JSON.stringify({p_candidates:rows.slice(offset,offset+NEWS_CANDIDATE_BATCH_LIMIT)});
        requestBytes+=Buffer.byteLength(body,'utf8');bodies.push(body);
      }
      // Validate the entire operation before the first write; retain one shared
      // time/byte budget and the purpose-bound500-row RPC on every batch.
      if(requestBytes>MAX_BYTES)throw new NewsCandidateStoreError('NEWS_CANDIDATE_INVALID');
      const budget:RequestBudget={deadline:Date.now()+2_500,remainingBytes:MAX_BYTES};
      let acceptedCount=0;
      for(let index=0;index<bodies.length;index++){
        const value=await request('rpc/dlkt_info_upsert_news_candidates',{method:'POST',
          headers:{apikey:configuration.publishableKey,Accept:'application/json','Content-Type':'application/json','x-dlkt-share-write':writerKey},
          body:bodies[index],
        },budget);
        const size=Math.min(NEWS_CANDIDATE_BATCH_LIMIT,rows.length-index*NEWS_CANDIDATE_BATCH_LIMIT);
        if(!exactObject(value,['accepted'])||!Number.isInteger(value.accepted)||typeof value.accepted!=='number'
          ||value.accepted<0||value.accepted>size)throw new NewsCandidateStoreError('NEWS_CANDIDATE_STORE_UNAVAILABLE');
        acceptedCount+=value.accepted;
      }
      return acceptedCount;
    },
  });
}
