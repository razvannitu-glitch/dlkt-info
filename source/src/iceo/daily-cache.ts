import { createHash, randomUUID } from 'node:crypto';
import { getCache } from '@vercel/functions';
import { validCard } from './card-validation.js';
import { DAILY_EDITION_POLICY, selectContextualToday } from './contextual-today.js';
import type { EvidenceCard, IceoSnapshot, SourceHealth, Topic } from './contracts.js';
import {publicEditorialCollection,type EditorialCollection} from './editorial-engine.js';
import {createNewsCorpusStore,type NewsCorpusStore} from './news-corpus-store.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORIES_VERSION,type PublicEditorialCategory} from './editorial-categories.js';
import {NEWS_DISCOVERY_INDEXES} from './news-sources.js';
import { ICEO_SOURCES } from './registry.js';
import { safeLink } from './source-links.js';
import { PUBLIC_TOPICS } from './topics.js';
import {CONTINUOUS_REFRESH_INTERVAL_MS,CONTINUOUS_REFRESH_DEADLINE_MS,createRefreshLedger,publicSnapshotDigest,validSharedEnvelope,validRefreshTrigger,
  type RefreshLedger,type RefreshTrigger,type RefreshFailure,type SharedSnapshotEnvelope} from './refresh-ledger.js';

export const DAILY_CACHE_SLOT_MS = 15 * 60_000;
export const DAILY_CACHE_IO_TIMEOUT_MS = 1_000;
const MAX_BYTES = 1_048_576;
const CACHE_VERSION = 'iceo-public-cache-2';
const PROJECT = 'prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P';
const REGISTRY_REVISION = createHash('sha256').update(JSON.stringify({sources:ICEO_SOURCES,indexes:NEWS_DISCOVERY_INDEXES,classification:EDITORIAL_CATEGORIES_VERSION})).digest('hex').slice(0, 16);
export const DAILY_CACHE_NAMESPACE = `${PROJECT}:iceo-daily-v1:${REGISTRY_REVISION}`;

/** Public source metadata only. This interface never accepts account or request data. */
export interface DailyCacheStore {
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface DailyRefreshReceipt {
  readonly version: 'iceo-daily-refresh-1';
  readonly slot: string;
  readonly acquisition: 'shared-cache' | 'source-check' | 'retained-cache';
  readonly sourceCheckedAt: string;
  readonly editionDate: string;
  readonly editionTimezone: 'UTC';
  readonly window: 'last-24-hours';
  readonly selectedCount: number;
  readonly minimum: number;
  readonly target: number;
  readonly maximum: number;
  readonly minimumMet: boolean;
  readonly categoryCount: number;
  readonly categories: readonly PublicEditorialCategory[];
  readonly missingCategories: readonly PublicEditorialCategory[];
  readonly completeCoverage: boolean;
  readonly availableSources: number;
  readonly totalSources: number;
  readonly snapshotState: IceoSnapshot['state'];
  readonly snapshotDigest: string;
  readonly sharedCacheReadback: true;
}

interface CacheEntry {
  readonly version: typeof CACHE_VERSION;
  readonly slot: string;
  readonly snapshot: IceoSnapshot;
}
interface Acquisition {
  readonly snapshot: IceoSnapshot;
  readonly slot: number;
  readonly acquisition: DailyRefreshReceipt['acquisition'];
  readonly stored: boolean;
}

async function cacheIO<T>(operation:()=>Promise<T>):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('DAILY_CACHE_IO_TIMEOUT')),DAILY_CACHE_IO_TIMEOUT_MS);
  })]);}finally{if(timer)clearTimeout(timer);}
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, maximum = 4_000): value is string =>
  typeof value === 'string' && value.length <= maximum;
const stamp = (value: unknown): value is string => text(value, 40) && Number.isFinite(Date.parse(value));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const topic = (value: unknown): value is Topic => (PUBLIC_TOPICS as readonly unknown[]).includes(value);

const HEALTH_KEYS = ['id', 'label', 'publisher', 'topic', 'state', 'checkedAt', 'verifiedAt', 'count', 'rejected', 'error', 'retryAt', 'scope', 'termsUrl', 'windowed'];
const CARD_REQUIRED = ['id', 'identity', 'title', 'topic', 'kind', 'sourceUrl', 'publisher', 'sourceIds', 'date', 'dateLabel', 'observedAt', 'contentHash', 'boundary', 'deadline', 'version', 'attribution', 'sourceState'];
const CARD_OPTIONAL = ['summary', 'byline', 'licenseUrl', 'context', 'articleSubject'];
const SNAPSHOT_KEYS = ['version', 'product', 'productVersion', 'mode', 'generatedAt', 'state', 'sources', 'cards', 'conflictCount', 'duplicateCount', 'deltaAvailable', 'scheduledDelivery', 'accountPersistence', 'coverage'];

function validHealth(value: unknown): value is SourceHealth {
  return object(value) && exactKeys(value, HEALTH_KEYS)
    && text(value.id, 80) && text(value.label, 300) && text(value.publisher, 300) && topic(value.topic)
    && ['verified', 'partial', 'stale', 'unavailable'].includes(String(value.state))
    && stamp(value.checkedAt) && (value.verifiedAt === null || stamp(value.verifiedAt))
    && integer(value.count) && integer(value.rejected)
    && (value.error === null || text(value.error, 300)) && (value.retryAt === null || stamp(value.retryAt))
    && text(value.scope) && safeLink(value.termsUrl) !== null && value.windowed === true;
}

function publicCard(value: unknown): value is EvidenceCard {
  return object(value) && CARD_REQUIRED.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => CARD_REQUIRED.includes(key) || CARD_OPTIONAL.includes(key))
    && validCard(value);
}

/** Reject unknown fields before a shared cache can become a public data surface. */
export function validDailySnapshot(value: unknown, now: number): value is IceoSnapshot {
  if (!Number.isFinite(now) || !object(value) || !exactKeys(value, SNAPSHOT_KEYS)
    || value.version !== 'iceo-primary-mesh-1' || value.product !== 'dlkt-info'
    || !text(value.productVersion, 40) || !['current-official-records','current-source-records'].includes(String(value.mode))
    || !stamp(value.generatedAt) || Date.parse(value.generatedAt) > now + 300_000
    || now - Date.parse(value.generatedAt) >= 3_600_000
    || !['ready', 'partial', 'unavailable'].includes(String(value.state))
    || value.deltaAvailable !== false || value.scheduledDelivery !== false || value.accountPersistence !== false
    || !integer(value.conflictCount) || !integer(value.duplicateCount)
    || !Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > 100 || !value.sources.every(validHealth)
    || !Array.isArray(value.cards) || value.cards.length > 5_000 || !value.cards.every(publicCard)
    || !Array.isArray(value.coverage) || !value.coverage.every(topic) || new Set(value.coverage).size !== value.coverage.length) return false;
  const sourceIds = new Set(value.sources.map(source => source.id));
  if (sourceIds.size !== value.sources.length || new Set(value.cards.map(card => card.id)).size !== value.cards.length
    || value.cards.some(card => card.sourceIds.length === 0 || card.sourceIds.some(id => !sourceIds.has(id)))) return false;
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_BYTES; } catch { return false; }
}

const slotStamp = (slot: number): string => new Date(slot * DAILY_CACHE_SLOT_MS).toISOString();
const keyFor = (slot: number): string => `slot:${slotStamp(slot)}`;
const digest = (snapshot: IceoSnapshot): string => createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

function validEntry(value: unknown, slot: number, now: number): value is CacheEntry {
  return object(value) && exactKeys(value, ['version', 'slot', 'snapshot'])
    && value.version === CACHE_VERSION && value.slot === slotStamp(slot)
    && validDailySnapshot(value.snapshot, now) && value.snapshot.state !== 'unavailable'
    && Date.parse(value.snapshot.generatedAt) >= slot * DAILY_CACHE_SLOT_MS
    && Date.parse(value.snapshot.generatedAt) < (slot + 1) * DAILY_CACHE_SLOT_MS;
}

/**
 * One public catalog per quarter-hour key. Keys never contain visitor preferences.
 * Separate keys prevent an earlier slot from replacing a newer slot. Runtime
 * Cache has no compare-and-swap: concurrent cold workers can repeat acquisition.
 * In-process calls coalesce; repeat completed calls read the existing result.
 * This is an evictable shared cache, not a durable publication archive.
 */
export class DailySnapshotCache {
  private readonly inflight = new Map<number, Promise<Acquisition>>();

  constructor(
    private readonly store: DailyCacheStore,
    private readonly load: () => Promise<IceoSnapshot>,
    private readonly clock: () => number = Date.now,
  ) {}

  async snapshot(): Promise<IceoSnapshot> { return (await this.acquire()).snapshot; }

  async refresh(): Promise<DailyRefreshReceipt> {
    const result = await this.acquire();
    if (result.acquisition === 'retained-cache') throw new Error('DAILY_REFRESH_RETAINED_OLD_CHECK');
    if (result.snapshot.state === 'unavailable') throw new Error('DAILY_SOURCES_UNAVAILABLE');
    if (!result.stored) throw new Error('DAILY_CACHE_READBACK_FAILED');
    const now = this.clock(), selection = selectContextualToday(result.snapshot.cards, {countryCode: null, preferredTopics: []}, now);
    const categories = selection.daily?.selectedCategories ?? [];
    return Object.freeze({
      version: 'iceo-daily-refresh-1', slot: slotStamp(result.slot), acquisition: result.acquisition,
      sourceCheckedAt: result.snapshot.generatedAt, editionDate: new Date(now).toISOString().slice(0, 10),
      editionTimezone: 'UTC', window: 'last-24-hours', selectedCount: selection.first.length,
      minimum: DAILY_EDITION_POLICY.minimum, target: DAILY_EDITION_POLICY.target, maximum: DAILY_EDITION_POLICY.maximum,
      minimumMet: selection.first.length >= DAILY_EDITION_POLICY.minimum,
      categoryCount: categories.length, categories,
      missingCategories: PUBLIC_EDITORIAL_CATEGORIES.filter(value => !categories.includes(value)),
      completeCoverage: categories.length === PUBLIC_EDITORIAL_CATEGORIES.length,
      availableSources: result.snapshot.sources.filter(source => source.state !== 'unavailable').length,
      totalSources: result.snapshot.sources.length, snapshotState: result.snapshot.state,
      snapshotDigest: digest(result.snapshot), sharedCacheReadback: true,
    });
  }

  private async acquire(): Promise<Acquisition> {
    const now = this.clock();
    if (!Number.isFinite(now) || now < 0) throw new Error('DAILY_CLOCK_INVALID');
    const slot = Math.floor(now / DAILY_CACHE_SLOT_MS), current = this.inflight.get(slot);
    if (current) return current;
    const pending = this.loadSlot(slot);
    this.inflight.set(slot, pending);
    try { return await pending; } finally { this.inflight.delete(slot); }
  }

  private async loadSlot(slot: number): Promise<Acquisition> {
    const key = keyFor(slot);
    try {
      const cached = await cacheIO(()=>this.store.read(key));
      if (validEntry(cached, slot, this.clock())) return {snapshot: cached.snapshot, slot, acquisition: 'shared-cache', stored: true};
    } catch { /* Public reading can recover through the independently bounded source loader. */ }
    let snapshot:IceoSnapshot;
    try { snapshot = await this.load(); }
    catch (error) { const retained=await this.retained(slot); if(retained)return retained; throw error; }
    if (!validDailySnapshot(snapshot, this.clock())) throw new Error('DAILY_SNAPSHOT_INVALID');
    // Failure observations remain truthful, but never replace a usable cached catalog.
    if (snapshot.state === 'unavailable') return (await this.retained(slot)) ?? {snapshot, slot, acquisition: 'source-check', stored: false};
    const entry: CacheEntry = {version: CACHE_VERSION, slot: slotStamp(slot), snapshot};
    try {
      await cacheIO(()=>this.store.write(key, entry, 3_600));
      const readback = await cacheIO(()=>this.store.read(key));
      if (validEntry(readback, slot, this.clock()) && digest(readback.snapshot) === digest(snapshot)) {
        return {snapshot: readback.snapshot, slot, acquisition: 'source-check', stored: true};
      }
    } catch { /* A fresh public result can still be served; the job receipt must fail. */ }
    return {snapshot, slot, acquisition: 'source-check', stored: false};
  }

  /** Reuse only an unexpired original check; a failed job never receives a fresh receipt. */
  private async retained(slot:number):Promise<Acquisition|null>{
    for(let offset=1;offset<=4;offset++){
      const prior=slot-offset;
      try{const value=await cacheIO(()=>this.store.read(keyFor(prior)));if(validEntry(value,prior,this.clock()))return {snapshot:value.snapshot,slot:prior,acquisition:'retained-cache',stored:true};}
      catch{/* Another recent slot can still be usable. */}
    }
    return null;
  }
}

class VercelDailyCacheStore implements DailyCacheStore {
  private readonly cache = getCache({namespace: DAILY_CACHE_NAMESPACE});
  async read(key: string): Promise<unknown> { return this.cache.get(key); }
  async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.cache.set(key, value, {ttl: ttlSeconds, tags: [`${PROJECT}:iceo-daily`], name: 'DLKT INFO public daily catalog'});
  }
}

export const CONTINUOUS_PUBLIC_CACHE_MS = 10_000;
export interface PublicIceoRead {
  readonly snapshot: IceoSnapshot;
  readonly collection: Omit<SharedSnapshotEnvelope,'snapshot'|'digest'|'version'>;
}
export interface ContinuousRefreshReceipt {
  readonly version: 'iceo-continuous-refresh-1';
  readonly state: 'published'|'busy'|'complete'|'backoff'; readonly trigger: RefreshTrigger['kind']; readonly slot: string;
  readonly revision: number; readonly sourceCheckedAt: string|null; readonly refreshedAt: string|null;
  readonly lastScheduledAttemptAt: string|null; readonly lastScheduledSuccessAt: string|null; readonly retryAt: string|null;
  readonly persistedReadback: boolean; readonly snapshotDigest: string|null;
  readonly selectedCount: number; readonly minimum: number; readonly target: number; readonly maximum: number; readonly minimumMet: boolean;
  readonly categoryCount: number; readonly categories: readonly PublicEditorialCategory[];
  readonly missingCategories: readonly PublicEditorialCategory[]; readonly completeCoverage: boolean;
  readonly availableSources: number; readonly totalSources: number;
}
interface ContinuousReadEntry {readonly version:'iceo-continuous-read-1';readonly readAt:number;readonly envelope:SharedSnapshotEnvelope}

/** Durable singleton lease controls collection. Public reads never invoke the collector. */
export class ContinuousSnapshotService {
  private pendingRead: Promise<PublicIceoRead>|undefined;
  private memory: {readonly at:number;readonly result:PublicIceoRead}|undefined;
  constructor(private readonly ledger:RefreshLedger,private readonly collect:(signal:AbortSignal,previousSnapshot?:IceoSnapshot)=>Promise<IceoSnapshot|EditorialCollection>,
    private readonly cache:DailyCacheStore|null=null,private readonly clock:()=>number=Date.now,
    private readonly deadlineMs:number=CONTINUOUS_REFRESH_DEADLINE_MS,private readonly corpusStore:NewsCorpusStore|null=null){}

  async snapshot():Promise<IceoSnapshot>{return (await this.read()).snapshot;}
  async read():Promise<PublicIceoRead>{
    const now=this.clock();
    if(this.memory&&now>=this.memory.at&&now-this.memory.at<CONTINUOUS_PUBLIC_CACHE_MS&&validDailySnapshot(this.memory.result.snapshot,now))return this.memory.result;
    if(this.pendingRead)return this.pendingRead;
    const pending=this.readShared();this.pendingRead=pending;
    try{return await pending;}finally{if(this.pendingRead===pending)this.pendingRead=undefined;}
  }
  private key():string{return `continuous-read:${Math.floor(this.clock()/CONTINUOUS_PUBLIC_CACHE_MS)}`;}
  private publicView(value:unknown):PublicIceoRead{
    const now=this.clock();
    if(!validSharedEnvelope(value)||!validDailySnapshot(value.snapshot,now)||value.snapshot.state==='unavailable'
      ||publicSnapshotDigest(value.snapshot)!==value.digest||value.refreshedAt===null
      ||Date.parse(value.refreshedAt)>now+60_000||Date.parse(value.refreshedAt)<Date.parse(value.snapshot.generatedAt)-300_000
      ||[value.lastAttemptAt,value.lastScheduledAttemptAt,value.lastScheduledSuccessAt].some(at=>at!==null&&Date.parse(at)>now+60_000))throw new Error('CONTINUOUS_SNAPSHOT_UNAVAILABLE');
    const {snapshot,digest:_digest,version:_version,...collection}=value;
    return Object.freeze({snapshot,collection:Object.freeze(collection)});
  }
  private remember(result:PublicIceoRead):PublicIceoRead{
    if(!this.memory||this.memory.result.collection.revision<=result.collection.revision)this.memory={at:this.clock(),result};
    return this.memory.result;
  }
  private async readShared():Promise<PublicIceoRead>{
    const key=this.key(),now=this.clock();
    if(this.cache)try{
      const value=await cacheIO(()=>this.cache!.read(key));
      if(object(value)&&exactKeys(value,['version','readAt','envelope'])&&value.version==='iceo-continuous-read-1'
        &&typeof value.readAt==='number'&&value.readAt<=now&&now-value.readAt<CONTINUOUS_PUBLIC_CACHE_MS)
        return this.remember(this.publicView(value.envelope));
    }catch{/* Cache eviction or outage never turns a reader into a source worker. */}
    const envelope=await this.ledger.read(),result=this.publicView(envelope);
    if(this.cache){const entry:ContinuousReadEntry={version:'iceo-continuous-read-1',readAt:this.clock(),envelope};
      try{await cacheIO(()=>this.cache!.write(key,entry,10));}catch{/* The durable read already succeeded. */}}
    return this.remember(result);
  }
  async refresh(trigger:RefreshTrigger={kind:'manual'}):Promise<ContinuousRefreshReceipt>{
    if(!this.ledger.writable||!validRefreshTrigger(trigger,this.clock()))throw new Error('CONTINUOUS_REFRESH_UNAVAILABLE');
    const claim=await this.ledger.claim(randomUUID(),trigger);
    if(claim.state!=='claimed')return this.receipt(claim.state,trigger,claim.slot,await this.ledger.read(),false,claim.retryAt);
    const started=this.clock(),expires=Date.parse(claim.leaseExpiresAt??'');
    const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
    let failure:RefreshFailure='collector-unavailable';
    try{
      if(!Number.isFinite(expires)||expires<=started)throw new Error('CONTINUOUS_LEASE_EXPIRED');
      const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{failure='timeout';const error=new Error('CONTINUOUS_REFRESH_TIMEOUT');reject(error);controller.abort(error);},Math.max(1,Math.min(this.deadlineMs,expires-started-3_000)));});
      const acquire=async():Promise<IceoSnapshot|EditorialCollection>=>{
        let previous:IceoSnapshot|undefined;
        try{const prior=await this.ledger.read();if(validSharedEnvelope(prior)&&validDailySnapshot(prior.snapshot,this.clock())&&publicSnapshotDigest(prior.snapshot)===prior.digest)previous=prior.snapshot;}
        catch{/* An unavailable prior catalog must not block fresh source collection. */}
        controller.signal.throwIfAborted();return this.collect(controller.signal,previous);
      };
      const collected=await Promise.race([acquire(),timeout]);clearTimeout(timer);controller.abort();
      const collection='snapshot' in collected?collected:null,snapshot=collection?collection.snapshot:collected as IceoSnapshot;
      failure='invalid-snapshot';
      if(!validDailySnapshot(snapshot,this.clock())||snapshot.state==='unavailable'
        ||Date.parse(snapshot.generatedAt)<started-5_000||Date.parse(snapshot.generatedAt)>this.clock()+5_000
        ||!snapshot.sources.some(source=>(source.state==='verified'||source.state==='partial')&&source.verifiedAt!==null&&Date.parse(source.verifiedAt)>=started-5_000))throw new Error('CONTINUOUS_SNAPSHOT_INVALID');
      const snapshotDigest=publicSnapshotDigest(snapshot);failure='publish-unavailable';
      if(collection&&!this.corpusStore)throw new Error('CONTINUOUS_CORPUS_NOT_CONFIGURED');
      const staged=collection?await this.corpusStore!.stage(claim,collection.corpus,collection.diagnostics):null;
      const published=await this.ledger.publish(claim,snapshot,snapshotDigest);
      const confirmed=await this.ledger.read();
      this.publicView(published);const result=this.publicView(confirmed);
      if(published.digest!==snapshotDigest||confirmed.revision<published.revision
        ||confirmed.revision===published.revision&&confirmed.digest!==snapshotDigest)throw new Error('CONTINUOUS_READBACK_FAILED');
      if(staged){
        const corpus=await this.corpusStore!.read(staged.epoch);
        if(!corpus||corpus.epoch!==staged.epoch||corpus.digest!==staged.digest||corpus.revision!==published.revision||corpus.generatedAt!==snapshot.generatedAt)throw new Error('CONTINUOUS_CORPUS_READBACK_FAILED');
      }
      this.memory=undefined;this.remember(result);
      // SQL owns the snapshot and receipt. Runtime cache writes never decide scheduler success.
      return this.receipt('published',trigger,claim.slot,published,true,published.retryAt);
    }catch(error){
      try{await this.ledger.fail(claim,failure);}catch{/* Lease expiry remains the durable recovery path when persistence is unavailable. */}
      throw error;
    }finally{clearTimeout(timer);controller.abort();}
  }
  private receipt(state:ContinuousRefreshReceipt['state'],trigger:RefreshTrigger,slot:number,envelope:SharedSnapshotEnvelope,readback:boolean,retryAt:string|null):ContinuousRefreshReceipt{
    if(!validSharedEnvelope(envelope))throw new Error('CONTINUOUS_RECEIPT_INVALID');
    const snapshot=validDailySnapshot(envelope.snapshot,this.clock())&&envelope.snapshot.state!=='unavailable'?envelope.snapshot:null;
    const selected=snapshot?selectContextualToday(snapshot.cards,{countryCode:null,preferredTopics:[]},this.clock()):null;
    const categories=selected?.daily?.selectedCategories??[],count=selected?.first.length??0;
    return Object.freeze({version:'iceo-continuous-refresh-1',state,trigger:trigger.kind,slot:new Date(slot*CONTINUOUS_REFRESH_INTERVAL_MS).toISOString(),
      revision:envelope.revision,sourceCheckedAt:snapshot?.generatedAt??null,refreshedAt:envelope.refreshedAt,
      lastScheduledAttemptAt:envelope.lastScheduledAttemptAt,lastScheduledSuccessAt:envelope.lastScheduledSuccessAt,retryAt,
      persistedReadback:readback,snapshotDigest:envelope.digest,selectedCount:count,
      minimum:DAILY_EDITION_POLICY.minimum,target:DAILY_EDITION_POLICY.target,maximum:DAILY_EDITION_POLICY.maximum,minimumMet:count>=DAILY_EDITION_POLICY.minimum,
      categoryCount:categories.length,categories,missingCategories:PUBLIC_EDITORIAL_CATEGORIES.filter(category=>!categories.includes(category)),
      completeCoverage:categories.length===PUBLIC_EDITORIAL_CATEGORIES.length,
      availableSources:snapshot?.sources.filter(source=>source.state!=='unavailable').length??0,totalSources:snapshot?.sources.length??0});
  }
}

let shared:ContinuousSnapshotService|undefined;
function service():ContinuousSnapshotService{
  if(shared)return shared;
  const ledger=createRefreshLedger(process.env);if(!ledger)throw new Error('CONTINUOUS_STORE_NOT_CONFIGURED');
  const corpusStore=createNewsCorpusStore(process.env);if(!corpusStore)throw new Error('CONTINUOUS_CORPUS_NOT_CONFIGURED');
  shared=new ContinuousSnapshotService(ledger,publicEditorialCollection,new VercelDailyCacheStore(),Date.now,CONTINUOUS_REFRESH_DEADLINE_MS,corpusStore);return shared;
}
export const publicIceoRead=():Promise<PublicIceoRead>=>service().read();
export const publicIceoSnapshot=():Promise<IceoSnapshot>=>service().snapshot();
export const refreshPublicIceoSnapshot=(trigger:RefreshTrigger={kind:'manual'}):Promise<ContinuousRefreshReceipt>=>service().refresh(trigger);
