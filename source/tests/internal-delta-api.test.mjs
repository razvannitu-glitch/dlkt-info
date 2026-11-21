import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const CRON = 'cron_secret_value_0123456789abcdef';
const REVIEW = 'review_secret_value_0123456789abcdef';
const JOB_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '55555555-5555-4555-8555-555555555555';
const ENV = Object.freeze({
  DLKT_INFO_SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst',
  DLKT_INFO_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'p'.repeat(32)}`,
  DLKT_INFO_DATA_FOUNDATION_READY: '1', DLKT_INFO_AUTH_ENABLED: '0', DLKT_INFO_REAL_DATA_ENABLED: '1',
  DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '1', DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  DLKT_INFO_SUPABASE_SECRET_KEY: `sb_secret_${'s'.repeat(32)}`, CRON_SECRET: CRON,
  DLKT_INFO_INTERNAL_TRIAL_ENABLED: '1', DLKT_INFO_INTERNAL_REVIEW_ENABLED: '1',
  DLKT_INFO_INTERNAL_REVIEW_SECRET: REVIEW, DLKT_INFO_INTERNAL_REVIEWER_ID: 'human:razvan.internal',
});

const claim = (id, title, hash, observedAt) => ({
  id, entity: { id: 'eu-document:52026PC0001', type: 'eu-proposal', label: '52026PC0001' }, topicId: 'regulation',
  kind: 'regulation', predicate: 'official-eu-proposal-listing',
  value: [title, 'creator:European Commission', 'celex:52026PC0001', 'feed:commission-proposals'],
  materiality: 'low', actionability: 0.25, observedAt, effectiveAt: null, validFrom: observedAt,
  validUntil: '2026-12-20T20:00:00.000Z', locale: 'en', geography: 'European Union',
  affects: ['regulatory-monitoring'], evidence: [{ sourceId: 'eu-eurlex-commission-proposals',
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001', title, retrievedAt: observedAt,
    publishedAt: null, contentHash: hash }],
});

const REVIEW_QUEUE_ROW = Object.freeze({
  card_id: CARD_ID,
  trial_id: '66666666-6666-4666-8666-666666666666',
  source_key: 'eu-eurlex-commission-proposals',
  generated_at: '2026-11-11T20:00:00.000Z',
  card_position: 1,
  external_card_id: 'abcdef1234567890abcdef12',
  delta_id: '1234567890abcdef12345678',
  topic_id: 'regulation',
  entity_key: 'eu-document:52026PC0001',
  entity_type: 'eu-proposal',
  entity_label: '52026PC0001',
  kind: 'changed',
  title: '52026PC0001: official metadata changed',
  direct: 'The official listing changed.',
  why_it_matters: 'The linked document requires review.',
  changed_since: 'Official metadata changed since the previous checkpoint.',
  materiality: 'low',
  trust: 'confirmed',
  score: 47,
  blocked_dependencies: [],
  sources: [{ sourceId: 'eu-eurlex-commission-proposals', title: 'EUR-Lex source',
    url: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX%3A52026PC0001', authority: 'official',
    retrievedAt: '2026-11-11T20:00:00.000Z' }],
  expires_at: '2026-12-20T20:00:00.000Z',
});

const JOB = { job_id: JOB_ID, source_batch_id: BATCH_ID, source_key: 'eu-eurlex-commission-proposals',
  observed_at: '2026-11-11T20:00:00.000Z', window_start: '2026-11-11T19:00:00.000Z',
  window_end: '2026-11-11T20:00:00.000Z', attempt_no: 1, lease_expires_at: '2026-11-11T20:03:00.000Z',
  previous_claims: [claim('33333333-3333-4333-8333-333333333333', 'Before', 'a'.repeat(64), '2026-11-11T19:00:00.000Z')],
  current_claims: [claim('44444444-4444-4444-8444-444444444444', 'After', 'b'.repeat(64), '2026-11-11T20:00:00.000Z')] };

function response() { const headers = new Map(); let body=''; return { value: { statusCode:0,
  setHeader(name,value){headers.set(String(name).toLowerCase(),String(value));}, end(value=''){body=String(value);} },
  headers, text:()=>body, json:()=>JSON.parse(body) }; }
function request({ method='GET', authorization=`Bearer ${CRON}`, body=null, contentType='application/json' }={}) {
  const stream=Readable.from(body===null?[]:[JSON.stringify(body)]); stream.method=method;
  stream.headers={authorization,'content-type':contentType}; return stream;
}

const trialTransport = ({ failure=false }={}) => { const calls=[]; return { calls, value:{ call:async(name,parameters)=>{
  calls.push({name,parameters});
  if(name==='dlkt_info_claim_internal_delta_jobs') return [failure?{...JOB,observed_at:'2026-11-11T18:00:00.000Z',window_start:'2026-11-11T17:00:00.000Z',window_end:'2026-11-11T18:00:00.000Z'}:JOB];
  if(name==='dlkt_info_complete_internal_delta_trial') return [{trial_id:'66666666-6666-4666-8666-666666666666',status:'ready_for_review',card_count:1,pending_count:1,approved_count:0,rejected_count:0,public_cards_created:false}];
  if(name==='dlkt_info_fail_internal_delta_job') return [{job_id:JOB_ID,status:'retry',attempt_count:1,next_attempt_at:'2026-11-11T20:05:00.000Z',terminal:false}];
  throw Error(`UNEXPECTED:${name}`);
}}}; };

test('scheduled trial route creates one private review candidate and exposes only counts', async()=>{
  const {handleInternalDeltaTrial}=await import('../.build/api/internal-delta-trial.js'); const rpc=trialTransport(); const res=response();
  await handleInternalDeltaTrial(request(),res.value,{environment:ENV,transport:rpc.value,now:()=>NOW}); const body=res.json();
  assert.equal(res.value.statusCode,200); assert.equal(res.headers.get('cache-control'),'private, no-store');
  assert.deepEqual(body,{ok:true,version:'dlkt-info-internal-delta-trial-1',processed:1,readyForReview:1,empty:0,failed:0,candidateCards:1,publicCardsCreated:false});
  assert.doesNotMatch(res.text(),/52026PC0001|Before|After|sb_secret_|review_secret/u);
  assert.deepEqual(rpc.calls.map(call=>call.name),['dlkt_info_claim_internal_delta_jobs','dlkt_info_complete_internal_delta_trial']);
});

test('trial route fails closed before RPC and records bounded per-job failures', async()=>{
  const {handleInternalDeltaTrial}=await import('../.build/api/internal-delta-trial.js');
  let touched=0; const unavailable=response(); await handleInternalDeltaTrial(request(),unavailable.value,{environment:{},transport:{call:async()=>{touched++;}},now:()=>NOW});
  assert.equal(unavailable.value.statusCode,503); assert.equal(touched,0);
  const unauthorized=response(); await handleInternalDeltaTrial(request({authorization:'Bearer wrong'}),unauthorized.value,{environment:ENV,transport:{call:async()=>{touched++;}},now:()=>NOW});
  assert.equal(unauthorized.value.statusCode,401); assert.equal(touched,0);
  const rpc=trialTransport({failure:true}); const failed=response(); await handleInternalDeltaTrial(request(),failed.value,{environment:ENV,transport:rpc.value,now:()=>NOW});
  assert.equal(failed.value.statusCode,207); assert.equal(failed.json().failed,1); assert.equal(failed.json().publicCardsCreated,false);
  assert.deepEqual(rpc.calls.map(call=>call.name),['dlkt_info_claim_internal_delta_jobs','dlkt_info_fail_internal_delta_job']);
});

test('review route requires its own secret and returns no card content',async()=>{
  const {handleInternalDeltaReview}=await import('../.build/api/internal-delta-review.js'); const calls=[];
  const transport={call:async(name,parameters)=>{calls.push({name,parameters});
    if(name==='dlkt_info_read_internal_delta_review_queue') return [REVIEW_QUEUE_ROW];
    if(name==='dlkt_info_review_internal_delta_card') return [{trial_id:'66666666-6666-4666-8666-666666666666',trial_status:'approved',card_id:CARD_ID,card_review_state:'approved',pending_count:0,approved_count:1,rejected_count:0,public_cards_created:false}];
    throw Error(`UNEXPECTED:${name}`);
  }};
  const queue=response(); await handleInternalDeltaReview(request({method:'GET',authorization:`Bearer ${REVIEW}`}),queue.value,{environment:ENV,transport,now:()=>NOW});
  assert.equal(queue.value.statusCode,200); assert.equal(queue.json().count,1); assert.equal(queue.json().candidates[0].cardId,CARD_ID);
  assert.equal(queue.json().publicCardsEnabled,false); assert.doesNotMatch(queue.text(),/review_secret|sb_secret_/u);
  const res=response(); await handleInternalDeltaReview(request({method:'POST',authorization:`Bearer ${REVIEW}`,body:{cardId:CARD_ID,decision:'approved',note:'Verified against the linked official document.'}}),res.value,{environment:ENV,transport,now:()=>NOW});
  assert.equal(res.value.statusCode,200); assert.deepEqual(res.json(),{ok:true,trialStatus:'approved',cardReviewState:'approved',pending:0,approved:1,rejected:0,publicCardsCreated:false});
  assert.equal(calls[1].parameters.p_reviewer,'human:razvan.internal'); assert.doesNotMatch(res.text(),/cardId|52026PC|review_secret/u);
  const unauthorized=response(); await handleInternalDeltaReview(request({method:'POST',authorization:'Bearer wrong',body:{cardId:CARD_ID,decision:'approved',note:'Valid note'}}),unauthorized.value,{environment:ENV,transport,now:()=>NOW});
  assert.equal(unauthorized.value.statusCode,401);
  const invalid=response(); await handleInternalDeltaReview(request({method:'POST',authorization:`Bearer ${REVIEW}`,body:{cardId:CARD_ID,decision:'publish',note:'Valid note'}}),invalid.value,{environment:ENV,transport,now:()=>NOW});
  assert.equal(invalid.value.statusCode,400);
});

test('internal delta health advertises human review and zero automatic publication',async()=>{
  const original={...process.env}; try { for(const key of Object.keys(process.env)) delete process.env[key];
    const {default:health}=await import('../.build/api/internal-delta-health.js'); const res=response(); health({method:'GET'},res.value);
    const body=res.json(); assert.equal(res.value.statusCode,200); assert.equal(body.version,'dlkt-info-internal-delta-trial-1');
    assert.equal(body.humanReviewRequired,true); assert.equal(body.publicationAutomatic,false); assert.equal(body.publicCardsEnabled,false);
    assert.equal(body.status,'installed-not-activated'); assert.equal(body.blocker,'DEDICATED_SUPABASE_PROJECT_REQUIRED');
  } finally { for(const key of Object.keys(process.env)) delete process.env[key]; Object.assign(process.env,original); }
});
