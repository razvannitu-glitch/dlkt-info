import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {ArchiveError, archiveRecordFromRow, captureArchiveRecord, validArchiveCard} from '../.build/src/share/archive.js';
import {createArchiveStore} from '../.build/src/share/archive-rest.js';

const now=Date.parse('2026-11-20T12:00:00.000Z');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function card(changes={}) {
  const identity='https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html';
  const value={id:hash(identity).slice(0,24),identity,title:'Publisher statement: “clear” source / €5',topic:'business',kind:'publication',
    sourceUrl:identity,publisher:'European Central Bank',sourceIds:['ecb-news'],date:'2026-11-20T09:00:00.000Z',dateLabel:'Published',
    observedAt:new Date(now-1000).toISOString(),contentHash:'',boundary:'Official publication listing.',deadline:null,version:null,
    attribution:'Source: European Central Bank.',sourceState:'verified',...changes};
  value.contentHash=hash(cardContent(value));return value;
}
const current=(value=card())=>({card:value,validUntil:now+300_000,partial:false});
const row=(value=card(),extra={})=>({id:value.id,revision:value.contentHash,card:value,captured_at:new Date(now).toISOString(),source_check_expires_at:new Date(now+300_000).toISOString(),partial:false,...extra});
const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'abcdefghijklmnopqrst',DLKT_INFO_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_abcdefghijklmnopqrstuvwx',DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'x'.repeat(43)};
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});

test('archive captures public source metadata and preserves historical check dates',()=>{
  const captured=captureArchiveRecord(current(),now);
  assert.equal(captured.version,'dlkt-share-archive-1');assert.equal(captured.capturedAt,new Date(now).toISOString());
  assert.equal(captured.sourceCheckExpiresAt,new Date(now+300_000).toISOString());
  assert.deepEqual(archiveRecordFromRow(row()),captured);
  assert.notEqual(captured.card,current().card);
});

test('strict public card integrity rejects forged revisions, extra private fields and foreign source substitutions',()=>{
  assert.equal(validArchiveCard(card()),true);
  for(const value of [card({userId:'private-user'}),card({sourceIds:['unknown']}),card({publisher:'Another publisher'}),
    card({sourceIds:['nasa-news']}),card({sourceIds:[]}),card({sourceIds:['ecb-news','ecb-news']}),card({sourceState:'stale'}),
    card({sourceUrl:'https://www.ecb.europa.eu.evil.example/article'}),card({sourceUrl:'https://www.ecb.europa.eu/path#secret'}),
    {...card(),id:'0'.repeat(24)},{...card(),contentHash:'0'.repeat(64)},card({summary:'x'.repeat(1001)})]) assert.equal(validArchiveCard(value),false);
});

test('capture rejects expired checks, future observations and invalid check windows',()=>{
  for(const value of [{...current(),validUntil:now},current(card({observedAt:new Date(now+300_001).toISOString()})),
    current(card({observedAt:new Date(now-3_600_001).toISOString()})),{...current(),validUntil:now+3_600_000},
    {...current(),partial:'false'}]) assert.throws(()=>captureArchiveRecord(value,now),ArchiveError);
  assert.throws(()=>captureArchiveRecord(current(),Number.NaN),ArchiveError);
});

test('REST reads exact revisions or latest history without sending the writer secret',async()=>{
  const calls=[];const store=createArchiveStore(environment,async(input,init)=>{calls.push({url:new URL(input),init});return json([row()]);});
  assert.ok(store?.writable);const value=card();
  assert.equal((await store.read(value.id,value.contentHash)).card.contentHash,value.contentHash);
  await store.read(value.id,null);
  assert.equal(calls[0].url.searchParams.get('revision'),`eq.${value.contentHash}`);
  assert.equal(calls[1].url.searchParams.get('revision'),null);
  assert.equal(calls[1].url.searchParams.get('order'),'captured_at.desc,revision.desc');
  for(const {url,init} of calls){assert.equal(url.origin,'https://abcdefghijklmnopqrst.supabase.co');assert.equal(init.headers['x-dlkt-share-write'],undefined);assert.equal(init.redirect,'error');}
});

test('REST capture posts only the strict public record and returns the original immutable record',async()=>{
  let sent;const store=createArchiveStore(environment,async(input,init)=>{sent={url:new URL(input),init};return json(row());});
  const result=await store.capture(current(),now+1000);
  assert.equal(result.capturedAt,new Date(now).toISOString());
  assert.equal(sent.url.pathname,'/rest/v1/rpc/dlkt_info_capture_shared_card');
  assert.equal(sent.init.headers['x-dlkt-share-write'],environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY);
  assert.deepEqual(Object.keys(JSON.parse(sent.init.body)).sort(),['p_captured_at','p_card','p_partial','p_source_check_expires_at']);
});

test('missing configuration disables archive; missing writer key keeps public reads available',async()=>{
  assert.equal(createArchiveStore({}),null);
  assert.equal(createArchiveStore({...environment,DLKT_INFO_SUPABASE_URL:'https://evil.example'}),null);
  const store=createArchiveStore({...environment,DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:undefined},async()=>json([]));
  assert.equal(store.writable,false);assert.equal(await store.read(card().id,null),null);
  await assert.rejects(store.capture(current(),now),{code:'SHARE_ARCHIVE_UNAVAILABLE'});
});

test('storage failure, oversized responses and returned integrity mismatches never masquerade as a missing card',async()=>{
  const variants=[()=>new Response('unavailable',{status:503}),()=>json([row(card({title:'Changed revision'}))]),
    ()=>json([row(card(),{private_payload:'bad'})]),()=>json([row(card(),{source_check_expires_at:new Date(now).toISOString()})]),
    ()=>json([row(),row()]),()=>json({error:'not an array'}),()=>new Response('x'.repeat(65_537),{headers:{'content-type':'application/json'}})];
  for(const reply of variants){const store=createArchiveStore(environment,async()=>reply());await assert.rejects(store.read(card().id,card().contentHash),ArchiveError);}
  let calls=0;const store=createArchiveStore(environment,async()=>{calls++;return json([]);});
  await assert.rejects(store.read('bad?or=id.eq.any',null),{code:'SHARE_ARCHIVE_INVALID'});assert.equal(calls,0);
});
