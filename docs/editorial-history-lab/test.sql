\set ON_ERROR_STOP on
-- Fixtures only; no real source identity or permission.
insert into dlkt_history_lab.candidates(card_id,revision,digest,source_url,policy_url)
select 'lab-'||n,1,repeat('a',64),'https://example.invalid/source/'||n,'https://example.invalid/policy/'||n
from unnest(array['main','other','abandon','gap','capacity','clock','race','race-distinct','future-open','clock-order']) as t(n);

set role dlkt_history_worker;
do $$
declare a record; observed timestamptz; f jsonb:=to_jsonb(array_fill(repeat('b',64),array[5])); d text:=repeat('a',64);
begin
  select * into a from dlkt_history_lab.start_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001');
  if (a.sequence_no,a.disposition) is distinct from (1,'created'::text) then raise exception 'start failed'; end if;
  select * into a from dlkt_history_lab.start_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001');
  if (a.sequence_no,a.disposition) is distinct from (1,'replay-open'::text) then raise exception 'lost-start ack replay failed'; end if;
  select * into a from dlkt_history_lab.start_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000002');
  if (a.sequence_no,a.disposition) is distinct from (null::integer,'busy'::text) then raise exception 'second active attempt accepted'; end if;
  begin
    perform dlkt_history_lab.start_attempt('lab-other',1,d,'00000000-0000-4000-8000-000000000001');
    raise exception 'foreign replay accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_ATTEMPT_CONFLICT' then raise; end if;
  end;
  begin
    perform dlkt_history_lab.start_attempt('lab-main',1,repeat('c',64),'00000000-0000-4000-8000-000000000002');
    raise exception 'forged digest accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_CANDIDATE_UNKNOWN' then raise; end if;
  end;
  begin
    perform dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001',
      'observed',null,clock_timestamp(),'["bad"]'::jsonb,repeat('c',64));
    raise exception 'bad evidence accepted';
  exception when check_violation then null; end;
  begin
    perform dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001',
      'observed',null,clock_timestamp()+interval '1 hour',f,repeat('c',64));
    raise exception 'future timestamp accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_CLOCK_OR_SEQUENCE_INVALID' then raise; end if;
  end;
  if dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001',
    'held','source-denied',null,null,null) is distinct from 'recorded' then raise exception 'held terminal failed'; end if;
  if dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001',
    'held','source-denied',null,null,null) is distinct from 'replay' then raise exception 'lost-finish ack replay failed'; end if;
  begin
    perform dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001',
      'failed','transport-failed',null,null,null);
    raise exception 'terminal overwrite accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_RESULT_CONFLICT' then raise; end if;
  end;
  select * into a from dlkt_history_lab.start_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000001');
  if (a.sequence_no,a.disposition) is distinct from (1,'replay-terminal'::text) then raise exception 'terminal start replay failed'; end if;
  perform pg_sleep(0.002);
  select * into a from dlkt_history_lab.start_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000002');
  if (a.sequence_no,a.disposition) is distinct from (2,'created'::text) then raise exception 'second sequence failed'; end if;
  observed:=clock_timestamp();
  if dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000002',
    'observed',null,observed,f,repeat('c',64)) is distinct from 'recorded' then raise exception 'observation failed'; end if;
  if dlkt_history_lab.finish_attempt('lab-main',1,d,'00000000-0000-4000-8000-000000000002',
    'observed',null,observed,f,repeat('c',64)) is distinct from 'replay' then raise exception 'observation replay failed'; end if;
  begin
    perform dlkt_history_lab.read_history('lab-main',1,d);
    raise exception 'worker read function accepted';
  exception when insufficient_privilege then null; end;
  begin
    update dlkt_history_lab.results set reason='policy-changed';
    raise exception 'direct worker mutation accepted';
  exception when insufficient_privilege then null; end;
  perform dlkt_history_lab.start_attempt('lab-abandon',1,d,'00000000-0000-4000-8000-000000000003');
end;
$$;
reset role;

set role dlkt_history_reader;
do $$
declare h jsonb; d text:=repeat('a',64);
begin
  h:=dlkt_history_lab.read_history('lab-main',1,d);
  if h->>'state' is distinct from 'terminal-hold-present'
    or h->>'tip' is distinct from '2'
    or jsonb_array_length(h->'attempts') is distinct from 2
    or h #>> '{attempts,0,outcome}' is distinct from 'held'
    or h #>> '{attempts,1,outcome}' is distinct from 'observed'
    or h->'activationAllowed' is distinct from 'false'::jsonb then raise exception 'history omitted terminal failure'; end if;
  h:=dlkt_history_lab.read_history('lab-other',1,d);
  if h->>'state' is distinct from 'empty' or h->>'tip' is distinct from '0'
    or jsonb_array_length(h->'attempts') is distinct from 0 then raise exception 'empty history misclassified'; end if;
  h:=dlkt_history_lab.read_history('lab-abandon',1,d);
  if h->>'state' is distinct from 'open' or h #>> '{attempts,0,outcome}' is distinct from 'open'
    then raise exception 'open start omitted'; end if;
  begin
    perform dlkt_history_lab.start_attempt('lab-other',1,d,'00000000-0000-4000-8000-000000000004');
    raise exception 'reader write accepted';
  exception when insufficient_privilege then null; end;
end;
$$;
reset role;

set role dlkt_history_reaper;
do $$
begin
  begin
    perform dlkt_history_lab.abandon_attempt('lab-abandon',1,repeat('a',64),'00000000-0000-4000-8000-000000000003');
    raise exception 'premature abandonment accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_NOT_ABANDONABLE' then raise; end if;
  end;
end;
$$;
reset role;
-- Admin-only synthetic aging to exercise timeout without waiting five minutes.
update dlkt_history_lab.attempts set started_at=clock_timestamp()-interval '6 minutes'
where attempt_id='00000000-0000-4000-8000-000000000003';
-- Even before the reaper commits a result, the expired worker is fenced.
set role dlkt_history_worker;
do $
declare a record; d text:=repeat('a',64);
begin
  begin
    perform dlkt_history_lab.finish_attempt('lab-abandon',1,d,'00000000-0000-4000-8000-000000000003',
      'observed',null,clock_timestamp(),to_jsonb(array_fill(repeat('b',64),array[5])),repeat('c',64));
    raise exception 'expired worker success accepted';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_ATTEMPT_EXPIRED' then raise; end if;
  end;
  select * into a from dlkt_history_lab.start_attempt('lab-abandon',1,d,'00000000-0000-4000-8000-000000000009');
  if (a.sequence_no,a.disposition) is distinct from (null::integer,'busy'::text)
    then raise exception 'expired unresolved start bypassed'; end if;
end;
$;
reset role;
set role dlkt_history_reader;
do $
declare h jsonb;
begin
  h:=dlkt_history_lab.read_history('lab-abandon',1,repeat('a',64));
  if h->>'state' is distinct from 'expired-open'
    or h #>> '{attempts,0,outcome}' is distinct from 'open'
    then raise exception 'expired unresolved start not exposed'; end if;
end;
$;
reset role;
set role dlkt_history_reaper;
do $$
begin
  if dlkt_history_lab.abandon_attempt('lab-abandon',1,repeat('a',64),'00000000-0000-4000-8000-000000000003')
     is distinct from 'recorded' then raise exception 'abandon failed'; end if;
  if dlkt_history_lab.abandon_attempt('lab-abandon',1,repeat('a',64),'00000000-0000-4000-8000-000000000003')
     is distinct from 'already-terminal' then raise exception 'abandon replay failed'; end if;
end;
$$;
reset role;
set role dlkt_history_worker;
do $$
begin
  begin
    perform dlkt_history_lab.finish_attempt('lab-abandon',1,repeat('a',64),'00000000-0000-4000-8000-000000000003',
      'failed','transport-failed',null,null,null);
    raise exception 'late result overwrote abandonment';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_RESULT_CONFLICT' then raise; end if;
  end;
end;
$$;
reset role;

-- Simulate missing sequence and clock regression with trusted admin fault injection.
update dlkt_history_lab.candidates set tip=2 where card_id='lab-gap';
update dlkt_history_lab.candidates set tip=1 where card_id='lab-clock';
insert into dlkt_history_lab.attempts values('00000000-0000-4000-8000-000000000005','lab-clock',1,repeat('a',64),1,clock_timestamp());
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason)
values('00000000-0000-4000-8000-000000000005',clock_timestamp()+interval '1 hour','failed','clock-invalid');
-- A future open attempt and tied adjacent boundaries are both integrity failures.
update dlkt_history_lab.candidates set tip=1 where card_id='lab-future-open';
insert into dlkt_history_lab.attempts values('00000000-0000-4000-8000-000000000010','lab-future-open',1,repeat('a',64),1,clock_timestamp()+interval '1 hour');
update dlkt_history_lab.candidates set tip=2 where card_id='lab-clock-order';
insert into dlkt_history_lab.attempts values
  ('00000000-0000-4000-8000-000000000011','lab-clock-order',1,repeat('a',64),1,'2026-01-01T00:00:00Z'::timestamptz),
  ('00000000-0000-4000-8000-000000000012','lab-clock-order',1,repeat('a',64),2,'2026-01-01T00:00:01Z'::timestamptz);
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason) values
  ('00000000-0000-4000-8000-000000000011','2026-01-01T00:00:01Z'::timestamptz,'failed','clock-invalid'),
  ('00000000-0000-4000-8000-000000000012','2026-01-01T00:00:02Z'::timestamptz,'failed','clock-invalid');

-- Bounded history: no compaction or deletion. Seed 256 synthetic terminal attempts.
update dlkt_history_lab.candidates set tip=256 where card_id='lab-capacity';
insert into dlkt_history_lab.attempts
select md5('capacity-'||n)::uuid,'lab-capacity',1,repeat('a',64),n,
  '2026-01-01T00:00:00Z'::timestamptz+n*interval '2 seconds'
from generate_series(1,256) as g(n);
insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason)
select attempt_id,started_at+interval '1 second','failed','transport-failed'
from dlkt_history_lab.attempts where card_id='lab-capacity';
set role dlkt_history_worker;
do $$
declare a record; d text:=repeat('a',64);
begin
  begin
    perform dlkt_history_lab.start_attempt('lab-gap',1,d,'00000000-0000-4000-8000-000000000006');
    raise exception 'gap allowed start';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_INTEGRITY_HELD' then raise; end if;
  end;
  begin
    perform dlkt_history_lab.start_attempt('lab-clock',1,d,'00000000-0000-4000-8000-000000000006');
    raise exception 'regressed clock allowed start';
  exception when raise_exception then
    if sqlerrm<>'HISTORY_INTEGRITY_HELD' then raise; end if;
  end;
  select * into a from dlkt_history_lab.start_attempt('lab-capacity',1,d,'00000000-0000-4000-8000-000000000006');
  if (a.sequence_no,a.disposition) is distinct from (null::integer,'capacity-held'::text) then raise exception 'capacity bypass'; end if;
end;
$$;
reset role;
set role dlkt_history_reader;
do $$
declare h jsonb;
begin
  h:=dlkt_history_lab.read_history('lab-gap',1,repeat('a',64));
  if h->>'state' is distinct from 'integrity-held' then raise exception 'missing prefix not held'; end if;
  h:=dlkt_history_lab.read_history('lab-clock',1,repeat('a',64));
  if h->>'state' is distinct from 'integrity-held' then raise exception 'future terminal not held'; end if;
  h:=dlkt_history_lab.read_history('lab-future-open',1,repeat('a',64));
  if h->>'state' is distinct from 'integrity-held' then raise exception 'future start not held'; end if;
  h:=dlkt_history_lab.read_history('lab-clock-order',1,repeat('a',64));
  if h->>'state' is distinct from 'integrity-held' then raise exception 'tied adjacent boundaries not held'; end if;
  h:=dlkt_history_lab.read_history('lab-capacity',1,repeat('a',64));
  if h->>'state' is distinct from 'capacity-held' or jsonb_array_length(h->'attempts') is distinct from 256 then
    raise exception 'capacity history truncated'; end if;
  h:=dlkt_history_lab.read_history('lab-abandon',1,repeat('a',64));
  if h->>'state' is distinct from 'terminal-hold-present' or h #>> '{attempts,0,outcome}' is distinct from 'abandoned' then
    raise exception 'abandoned start omitted'; end if;
end;
$$;
reset role;

-- Test all ordinary application roles, including BYPASSRLS, have no access.
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    execute format('set local role %I',r);
    begin
      perform dlkt_history_lab.read_history('lab-main',1,repeat('a',64));
      raise exception 'application role read accepted: %',r;
    exception when insufficient_privilege then null; end;
    begin
      perform dlkt_history_lab.start_attempt('lab-other',1,repeat('a',64),'00000000-0000-4000-8000-000000000008');
      raise exception 'application role write accepted: %',r;
    exception when insufficient_privilege then null; end;
    execute 'reset role';
  end loop;
end;
$$;
select 'EDITORIAL_HISTORY_LEDGER_SQL_OK';
