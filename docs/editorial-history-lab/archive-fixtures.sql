-- Fixed synthetic cap fixtures. Never a source observation or actual review.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_ci_archiver login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-archiver-local-only';
grant dlkt_history_archiver to dlkt_history_ci_archiver;
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url,tip)
select 'lab-adapter-archive-'||n,1,repeat('a',64),
  'https://example.invalid/source/adapter-archive-'||n,'https://example.invalid/policy/adapter-archive-'||n,256
from unnest(array['full','corrupt','live-drift','bad-clock']) n;
insert into dlkt_history_lab.attempts
select md5(c.card_id||':'||n)::uuid,c.card_id,c.revision,c.digest,n,
  '2026-01-01T00:00:00Z'::timestamptz+n*interval '10 minutes'
from dlkt_history_lab.candidates c cross join generate_series(1,256) n
where c.card_id in ('lab-adapter-archive-full','lab-adapter-archive-corrupt','lab-adapter-archive-live-drift','lab-adapter-archive-bad-clock');
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason,observed_at,fingerprints,evidence_digest)
select a.attempt_id,a.started_at+case when a.sequence_no=4 then interval '5 minutes' else interval '1 minute' end,
  case when a.sequence_no=1 then 'observed' when a.sequence_no=2 then 'held' when a.sequence_no=4 then 'abandoned' else 'failed' end,
  case when a.sequence_no=1 then null when a.sequence_no=2 then 'source-denied' when a.sequence_no=4 then 'start-timeout' else 'transport-failed' end,
  case when a.sequence_no=1 then a.started_at+interval '1 second' end,
  case when a.sequence_no=1 then f end,
  case when a.sequence_no=1 then dlkt_history_lab.observation_digest(a.card_id,a.revision,a.digest,c.source_url,c.policy_url,a.started_at+interval '1 second',f) end
from dlkt_history_lab.attempts a join dlkt_history_lab.candidates c using(card_id,revision,digest)
cross join (select to_jsonb(array[repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)]) f) fixture
where a.card_id in ('lab-adapter-archive-full','lab-adapter-archive-corrupt','lab-adapter-archive-live-drift','lab-adapter-archive-bad-clock');
insert into dlkt_history_lab.observation_attestations
select a.attempt_id,dlkt_history_lab.observation_digest(a.card_id,a.revision,a.digest,c.source_url,c.policy_url,
  a.started_at+interval '1 second',f),a.started_at+interval '1 second',a.started_at+interval '2 seconds'
from dlkt_history_lab.attempts a join dlkt_history_lab.candidates c using(card_id,revision,digest)
cross join (select to_jsonb(array[repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)]) f) fixture
where a.card_id in ('lab-adapter-archive-full','lab-adapter-archive-corrupt','lab-adapter-archive-live-drift','lab-adapter-archive-bad-clock')
  and a.sequence_no in (1,4);
insert into dlkt_history_lab.scope_review_heads
select c.card_id,c.revision,c.digest,scope,case when scope='feed' then 2 else 1 end
from dlkt_history_lab.candidates c cross join (values('feed'),('standalone')) s(scope)
where c.card_id in ('lab-adapter-archive-full','lab-adapter-archive-corrupt','lab-adapter-archive-live-drift','lab-adapter-archive-bad-clock');
insert into dlkt_history_lab.scope_reviews
select md5(a.card_id||':'||s.scope||':'||a.sequence_no)::uuid,a.card_id,a.revision,a.digest,s.scope,
  a.sequence_no,a.attempt_id,case when a.sequence_no=1 then 'lab-permitted' else 'lab-held' end,
  r.evidence_digest,a.started_at+interval '2 minutes',
  case when a.sequence_no=1 then a.started_at+interval '1 hour' end,'dlkt_history_ci_reviewer'::name
from dlkt_history_lab.attempts a join dlkt_history_lab.results r using(attempt_id)
cross join (values('feed'),('standalone')) s(scope)
where a.card_id in ('lab-adapter-archive-full','lab-adapter-archive-corrupt','lab-adapter-archive-live-drift','lab-adapter-archive-bad-clock')
  and (a.sequence_no=1 or (a.sequence_no=2 and s.scope='feed'));
-- Admin-only corruption injection. Both checkpoints are initially complete.
select dlkt_history_lab.seal_lab_checkpoint('lab-adapter-archive-corrupt',1,repeat('a',64),
  '40000000-0000-4000-8000-000000000001');
select dlkt_history_lab.seal_lab_checkpoint('lab-adapter-archive-live-drift',1,repeat('a',64),
  '40000000-0000-4000-8000-000000000002');
-- Modify archive bytes and recompute the unkeyed hash; readback still rejects
-- because the complete retained source ledger does not match.
update dlkt_history_lab.archive_checkpoints
set payload=(payload::jsonb||'{"approvalReusable":true}'::jsonb)::text,
    payload_sha256=encode(sha256(convert_to((payload::jsonb||'{"approvalReusable":true}'::jsonb)::text,'UTF8')),'hex')
where card_id='lab-adapter-archive-corrupt';
-- Simulate later drift in retained terminal metadata without changing the
-- sealed archive. A shape-valid history still must not verify against it.
update dlkt_history_lab.results r set reason='invalid-receipt'
from dlkt_history_lab.attempts a
where r.attempt_id=a.attempt_id and a.card_id='lab-adapter-archive-live-drift' and a.sequence_no=3;
-- An internally matching payload cannot legitimate a seal time that
-- predates the archived observations. Replay must reject it as readback does.
select dlkt_history_lab.seal_lab_checkpoint('lab-adapter-archive-bad-clock',1,repeat('a',64),
  '40000000-0000-4000-8000-000000000003');
update dlkt_history_lab.archive_checkpoints set sealed_at='2025-01-01T00:00:00Z'::timestamptz
where card_id='lab-adapter-archive-bad-clock';
commit;
