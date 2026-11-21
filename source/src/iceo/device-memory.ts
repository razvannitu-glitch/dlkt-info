import {PUBLIC_TOPICS} from './topics.js';
import {DAILY_KEY,parseDaily,type DailyState,type DailyDraft} from '../daily/contracts.js';
import {captureCheckpoint,parseCheckpoint,type ComparisonCheckpoint} from './comparison.js';
import type {IceoSnapshot} from './contracts.js';
import type {EvidenceCard,Topic} from './contracts.js';
import type {ReaderSettings} from './reader.js';
import {validCard,copyCard} from './card-validation.js';
export {copyCard} from './card-validation.js';

export const MEMORY_DATABASE='dlkt-info-device-memory-v1';
export interface SavedFocus {readonly version:1;readonly savedAt:string;readonly settings:ReaderSettings}
export interface SavedCard {readonly version:1;readonly id:string;readonly savedAt:string;readonly card:EvidenceCard}
export interface DeviceSnapshot {readonly focus:SavedFocus|null;readonly cards:readonly SavedCard[];readonly rejected:number}
const TOPICS = PUBLIC_TOPICS;
function object(v:unknown):v is Record<string,unknown>{return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function timestamp(v:unknown):v is string{return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/u.test(v)&&Number.isFinite(Date.parse(v));}
export function validSettings(v:unknown):v is ReaderSettings{
  return object(v)&&Array.isArray(v.topics)&&v.topics.length<=TOPICS.length
    &&v.topics.every(t=>typeof t==='string'&&TOPICS.includes(t as Topic))&&new Set(v.topics).size===v.topics.length
    &&typeof v.query==='string'&&v.query.length<=200&&!/[\u0000-\u001f\u007f]/u.test(v.query)
    &&Number.isSafeInteger(v.budget)&&Number(v.budget)>0&&(v.mode==='briefing'||v.mode==='records');
}
export function parseFocus(value:unknown):SavedFocus|null{
  if(!object(value)||value.version!==1||!timestamp(value.savedAt)||!validSettings(value.settings))return null;
  return {version:1,savedAt:value.savedAt,settings:{topics:[...value.settings.topics],query:value.settings.query,budget:value.settings.budget,mode:value.settings.mode}};
}
/** Retain only documented public fields, never unknown properties, tokens or future internal fields. */
export function parseSaved(value:unknown):SavedCard|null{
  if(!object(value)||value.version!==1||!timestamp(value.savedAt)||!validCard(value.card)||value.id!==value.card.id)return null;
  return {version:1,id:value.card.id,savedAt:value.savedAt,card:copyCard(value.card)};
}
export function memoryError(error:unknown):string{
  if(error instanceof Error&&error.message==='CHECKPOINT_CONCURRENT_UPDATE')return 'Another tab changed the saved source check. Refresh before replacing it.';
  if(error instanceof Error&&/^CHECKPOINT_/.test(error.message))return 'This source check cannot replace the saved baseline. Refresh the page and check source availability; your previous data is unchanged.';
  if(error instanceof Error&&error.name==='QuotaExceededError')return 'Browser storage is full. Nothing was saved. Remove saved cards or free space and retry.';
  return 'Browser storage is unavailable. Nothing new was saved. Reading still works; retry or check your browser privacy settings.';
}
/** IndexedDB transactions serialize writes across tabs; a success is reported only after commit. */
export class DeviceMemory {
  private connection:Promise<IDBDatabase>|null=null;
  constructor(private readonly factory:()=>IDBFactory=()=>indexedDB,private readonly clock:()=>number=Date.now){}
  private open():Promise<IDBDatabase>{
    if(this.connection)return this.connection;
    this.connection=new Promise<IDBDatabase>((resolve,reject)=>{
      let settled=false;
      const timer=setTimeout(()=>{settled=true;reject(new Error('MEMORY_OPEN_TIMEOUT'));},5000);
      try{
        const request=this.factory().open(MEMORY_DATABASE,1);
        request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');if(!db.objectStoreNames.contains('saved'))db.createObjectStore('saved',{keyPath:'id'});};
        request.onsuccess=()=>{clearTimeout(timer);if(settled){request.result.close();return;}settled=true;const db=request.result;db.onversionchange=()=>{db.close();this.connection=null;};resolve(db);};
        request.onerror=()=>{clearTimeout(timer);if(!settled){settled=true;reject(request.error??new Error('MEMORY_OPEN_FAILED'));}};
      }catch(error){clearTimeout(timer);settled=true;reject(error);}
    }).catch((error:unknown)=>{this.connection=null;throw error;});
    return this.connection;
  }
  private async run<T>(stores:string[],mode:IDBTransactionMode,work:(tx:IDBTransaction,result:(v:T)=>void,fail:(error:unknown)=>void)=>void,signal?:AbortSignal):Promise<T>{
    if(signal?.aborted)throw new Error('MEMORY_OPERATION_ABORTED');
    const db=await this.open();
    // Opening IndexedDB may finish after the owning account view has been invalidated.
    if(signal?.aborted)throw new Error('MEMORY_OPERATION_ABORTED');
    return new Promise<T>((resolve,reject)=>{
      let value:T,hasValue=false,customError:unknown,settled=false;
      let tx:IDBTransaction;
      try{tx=db.transaction(stores,mode);}catch(error){this.connection=null;reject(error);return;}
      let timer:ReturnType<typeof setTimeout>|undefined;
      const cleanup=():void=>{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
      const rejectOnce=(error:unknown):void=>{if(settled)return;settled=true;cleanup();reject(error);};
      const fail=(error:unknown):void=>{if(settled)return;customError=error;try{tx.abort();}catch{rejectOnce(error);}};
      const cancel=():void=>fail(new Error('MEMORY_OPERATION_ABORTED'));
      timer=setTimeout(()=>fail(new Error('MEMORY_TRANSACTION_TIMEOUT')),8000);
      tx.oncomplete=()=>{if(settled)return;settled=true;cleanup();if(hasValue)resolve(value);else reject(new Error('MEMORY_RESULT_MISSING'));};
      tx.onabort=()=>rejectOnce(customError??tx.error??new Error('MEMORY_TRANSACTION_ABORTED'));
      tx.onerror=()=>{if(customError===undefined)customError=tx.error;};
      signal?.addEventListener('abort',cancel,{once:true});
      if(signal?.aborted){cancel();return;}
      try{work(tx,v=>{value=v;hasValue=true;},fail);}catch(error){fail(error);}
    });
  }
  async read():Promise<DeviceSnapshot>{
    return this.run(['meta','saved'],'readonly',(tx,result)=>{
      let rawFocus:unknown,rawCards:unknown,done=0;
      const finish=():void=>{if(++done!==2)return;const focus=parseFocus(rawFocus);let rejected=rawFocus!==undefined&&focus===null?1:0;const cards:SavedCard[]=[];
        if(Array.isArray(rawCards))for(const raw of rawCards){const entry=parseSaved(raw);if(entry)cards.push(entry);else rejected++;}
        result({focus,cards:cards.sort((a,b)=>b.savedAt.localeCompare(a.savedAt)||a.id.localeCompare(b.id)),rejected});};
      const focus=tx.objectStore('meta').get('focus');focus.onsuccess=()=>{rawFocus=focus.result as unknown;finish();};
      const saved=tx.objectStore('saved').getAll();saved.onsuccess=()=>{rawCards=saved.result as unknown;finish();};
    });
  }
  async remember(settings:ReaderSettings):Promise<void>{
    if(!validSettings(settings))throw new Error('MEMORY_SETTINGS_INVALID');
    const value:SavedFocus={version:1,savedAt:new Date(this.clock()).toISOString(),settings:{...settings,topics:[...settings.topics]}};
    await this.run<void>(['meta'],'readwrite',(tx,done)=>{tx.objectStore('meta').put(value,'focus');done(undefined);});
  }
  async forgetFocus():Promise<void>{await this.run<void>(['meta'],'readwrite',(tx,done)=>{tx.objectStore('meta').delete('focus');done(undefined);});}
  async save(card:EvidenceCard):Promise<void>{
    const copy=copyCard(card);const value:SavedCard={version:1,id:copy.id,savedAt:new Date(this.clock()).toISOString(),card:copy};
    await this.run<void>(['saved'],'readwrite',(tx,done,fail)=>{const store=tx.objectStore('saved');const prior=store.get(value.id);
      prior.onsuccess=()=>{try{if(!parseSaved(prior.result as unknown))store.put(value);done(undefined);}catch(error){fail(error);}};});
  }
  async remove(id:string):Promise<void>{
    if(!/^[a-f0-9]{24}$/u.test(id))throw new Error('MEMORY_ID_INVALID');
    await this.run<void>(['saved'],'readwrite',(tx,done)=>{tx.objectStore('saved').delete(id);done(undefined);});
  }
  async readCheckpoint():Promise<ComparisonCheckpoint|null>{
    return this.run(['meta'],'readonly',(tx,done,fail)=>{const request=tx.objectStore('meta').get('comparison');
      request.onsuccess=()=>{try{const raw:unknown=request.result;const result=raw===undefined?null:parseCheckpoint(raw);if(raw!==undefined&&!result)throw new Error('CHECKPOINT_INVALID');done(result);}catch(error){fail(error);}};});
  }
  async saveCheckpoint(snapshot:IceoSnapshot,expectedRevision:string|null):Promise<void>{
    const candidate=captureCheckpoint(snapshot,this.clock(),crypto.randomUUID());
    await this.run<void>(['meta'],'readwrite',(tx,done,fail)=>{const store=tx.objectStore('meta');const request=store.get('comparison');
      request.onsuccess=()=>{try{
        const raw:unknown=request.result;const prior=raw===undefined?null:parseCheckpoint(raw);
        if(raw!==undefined&&!prior)throw new Error('CHECKPOINT_INVALID');
        if((prior?.revision??null)!==expectedRevision)throw new Error('CHECKPOINT_CONCURRENT_UPDATE');
        if(prior&&candidate.sources.some(s=>{const old=prior.sources.find(p=>p.id===s.id);return old!==undefined&&Date.parse(s.observedAt)<Date.parse(old.observedAt);}))throw new Error('CHECKPOINT_OLDER_OBSERVATION');
        store.put(candidate,'comparison');done(undefined);
      }catch(error){fail(error);}};});
  }
  async forgetCheckpoint(expectedRevision:string):Promise<void>{
    await this.run<void>(['meta'],'readwrite',(tx,done,fail)=>{const store=tx.objectStore('meta');const request=store.get('comparison');
      request.onsuccess=()=>{try{const prior=parseCheckpoint(request.result as unknown);if(!prior||prior.revision!==expectedRevision)throw new Error('CHECKPOINT_CONCURRENT_UPDATE');store.delete('comparison');done(undefined);}catch(error){fail(error);}};});
  }
  /** Explicit replacement only, called after account-restore confirmation. */
  async restorePersonal(value:{readonly focus:SavedFocus|null;readonly cards:readonly SavedCard[];readonly checkpoint:ComparisonCheckpoint|null},signal?:AbortSignal):Promise<void>{
    const focus=value.focus===null?null:parseFocus(value.focus),checkpoint=value.checkpoint===null?null:parseCheckpoint(value.checkpoint);
    const cards=value.cards.map(parseSaved);
    if((value.focus!==null&&!focus)||(value.checkpoint!==null&&!checkpoint)||cards.some(c=>!c)||new Set(cards.map(c=>c?.id)).size!==cards.length)throw new Error('MEMORY_IMPORT_INVALID');
    await this.run<void>(['meta','saved'],'readwrite',(tx,done)=>{
      const meta=tx.objectStore('meta'),saved=tx.objectStore('saved');
      meta.delete('focus');meta.delete('comparison');saved.clear();
      if(focus)meta.put(focus,'focus');if(checkpoint)meta.put(checkpoint,'comparison');
      for(const card of cards)if(card)saved.put(card);done(undefined);
    },signal);
  }
  async readDaily():Promise<DailyState|null>{
    return this.run(['meta'],'readonly',(tx,done,fail)=>{const r=tx.objectStore('meta').get(DAILY_KEY);r.onsuccess=()=>{const raw:unknown=r.result;const v=raw===undefined?null:parseDaily(raw);if(raw!==undefined&&!v){fail(Error('DAILY_STORAGE_INVALID'));return;}done(v);};});
  }
  async writeDaily(draft:DailyDraft|null,expected:string|null):Promise<DailyState|null>{
    const next=draft===null?null:parseDaily({...draft,revision:crypto.randomUUID()});
    if(draft!==null&&!next)throw Error('DAILY_DATA_INVALID');
    return this.run(['meta'],'readwrite',(tx,done,fail)=>{const store=tx.objectStore('meta'),r=store.get(DAILY_KEY);r.onsuccess=()=>{const raw:unknown=r.result;const prior=raw===undefined?null:parseDaily(raw);if(raw!==undefined&&!prior){fail(Error('DAILY_STORAGE_INVALID'));return;}if((prior?.revision??null)!==expected){fail(Error('DAILY_CONCURRENT_UPDATE'));return;}if(next)store.put(next,DAILY_KEY);else store.delete(DAILY_KEY);done(next);};});
  }
  async clear():Promise<void>{await this.run<void>(['meta','saved'],'readwrite',(tx,done)=>{tx.objectStore('meta').clear();tx.objectStore('saved').clear();done(undefined);});}
}
