-- DISPOSABLE CI ONLY. Age fixed synthetic starts without a real five-minute wait.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_ci_reaper login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password 'lab-reaper-local-only';
grant dlkt_history_reaper to dlkt_history_ci_reaper;
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url,tip)
select 'lab-adapter-recovery-'||n,1,repeat('a',64),
  'https://example.invalid/source/adapter-recovery-'||n,'https://example.invalid/policy/adapter-recovery-'||n,1
from unnest(array['plain','attested','lost','before','bad-read','race','fresh','cap']) n;
update dlkt_history_lab.candidates set tip=256 where card_id='lab-adapter-recovery-cap';
insert into dlkt_history_lab.attempts
select md5(c.card_id||':'||n)::uuid,c.card_id,c.revision,c.digest,n,
  case when c.card_id='lab-adapter-recovery-cap' then '2026-01-01T00:00:00Z'::timestamptz+n*interval '10 minutes'
       when c.card_id='lab-adapter-recovery-fresh' then clock_timestamp()
       else '2026-01-01T00:00:00Z'::timestamptz end
from dlkt_history_lab.candidates c cross join lateral generate_series(1,c.tip) n
where c.card_id like 'lab-adapter-recovery-%';
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason)
select attempt_id,started_at+interval '1 minute','failed','transport-failed'
from dlkt_history_lab.attempts where card_id='lab-adapter-recovery-cap' and sequence_no<256;
insert into dlkt_history_lab.observation_attestations
select a.attempt_id,dlkt_history_lab.observation_digest(a.card_id,a.revision,a.digest,c.source_url,c.policy_url,
  a.started_at+interval '1 second',f),a.started_at+interval '1 second',a.started_at+interval '2 seconds'
from dlkt_history_lab.attempts a join dlkt_history_lab.candidates c using(card_id,revision,digest)
cross join (select to_jsonb(array[repeat('b',64),repeat('c',64),repeat('d',64),repeat('e',64),repeat('f',64)]) f) fixture
where a.card_id='lab-adapter-recovery-attested';
commit;
