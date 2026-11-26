-- DISPOSABLE POSTGRESQL LAB ONLY. Not a production migration.
-- Synthetic identity and fixed evidence projection; no publication permission.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_owner nologin noinherit;
create role dlkt_history_worker nologin noinherit;
create role dlkt_history_reader nologin noinherit;
create role dlkt_history_reaper nologin noinherit;
create role dlkt_history_attestor nologin noinherit;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema dlkt_history_lab authorization dlkt_history_owner;
revoke all on schema dlkt_history_lab from public, anon, authenticated, service_role;
grant usage on schema dlkt_history_lab to dlkt_history_worker, dlkt_history_reader, dlkt_history_reaper, dlkt_history_attestor;
set local role dlkt_history_owner;

create table dlkt_history_lab.candidates (
  card_id text not null check (card_id ~ '^lab-[a-z0-9][a-z0-9-]{0,62}$'),
  revision integer not null check (revision > 0),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  source_url text not null check (source_url ~ '^https://example[.]invalid/source/[a-z0-9-]{1,63}$'),
  policy_url text not null check (policy_url ~ '^https://example[.]invalid/policy/[a-z0-9-]{1,63}$'),
  tip integer not null default 0 check (tip between 0 and 256),
  primary key (card_id,revision,digest)
);

create table dlkt_history_lab.attempts (
  attempt_id uuid primary key,
  card_id text not null,
  revision integer not null,
  digest text not null,
  sequence_no integer not null check (sequence_no between 1 and 256),
  started_at timestamptz not null check (isfinite(started_at)),
  unique (card_id,revision,digest,sequence_no),
  foreign key (card_id,revision,digest) references dlkt_history_lab.candidates
);

create function dlkt_history_lab.valid_fingerprints(p_value jsonb)
returns boolean language sql immutable security invoker set search_path=pg_catalog as $$
  select case when jsonb_typeof(p_value)='array' then
    jsonb_array_length(p_value)=5 and not exists (
      select 1 from jsonb_array_elements(p_value) as e(v)
      where jsonb_typeof(e.v)<>'string' or (e.v #>> '{}') !~ '^[0-9a-f]{64}$'
    )
  else false end;
$$;

-- Match the existing dlkt-knowledge-observation-v1 JSON.stringify contract
-- for the laboratory's restricted ASCII identity, URLs, and hex fingerprints.
-- This digest binds the projection; it is not a signature or source authentication.
create function dlkt_history_lab.observation_digest(
  p_card text,p_revision integer,p_digest text,p_source text,p_policy text,
  p_observed timestamptz,p_fingerprints jsonb
) returns text language plpgsql stable strict security invoker set search_path=pg_catalog as $$
declare stamp text; hashes text; payload text;
begin
  if p_card !~ '^lab-[a-z0-9][a-z0-9-]{0,62}$' or p_revision<=0
     or p_digest !~ '^[0-9a-f]{64}$'
     or p_source !~ '^https://example[.]invalid/source/[a-z0-9-]{1,63}$'
     or p_policy !~ '^https://example[.]invalid/policy/[a-z0-9-]{1,63}$'
     or not isfinite(p_observed)
     or p_observed<'1970-01-01T00:00:00Z'::timestamptz
     or p_observed>='10000-01-01T00:00:00Z'::timestamptz
     or p_observed<>date_trunc('milliseconds',p_observed)
     or not dlkt_history_lab.valid_fingerprints(p_fingerprints) then
    return null;
  end if;
  stamp:=to_char(p_observed at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select string_agg(to_json(e.v #>> '{}')::text,',' order by e.ord)
    into hashes from jsonb_array_elements(p_fingerprints) with ordinality as e(v,ord);
  payload:=format('["dlkt-knowledge-observation-v1",%s,%s,%s,%s,%s,%s,[%s]]',
    to_json(p_card),p_revision,to_json(p_digest),to_json(p_source),to_json(p_policy),to_json(stamp),hashes);
  return encode(sha256(convert_to(payload,'UTF8')),'hex');
end;
$$;

create table dlkt_history_lab.results (
  attempt_id uuid primary key references dlkt_history_lab.attempts,
  finished_at timestamptz not null check (isfinite(finished_at)),
  outcome text not null check (outcome in ('observed','held','failed','abandoned')),
  reason text,
  observed_at timestamptz,
  fingerprints jsonb,
  evidence_digest text,
  check (
    (outcome='observed' and reason is null and observed_at is not null
      and isfinite(observed_at) and observed_at<=finished_at
      and fingerprints is not null and dlkt_history_lab.valid_fingerprints(fingerprints)
      and evidence_digest is not null and evidence_digest ~ '^[0-9a-f]{64}$')
    or
    (outcome<>'observed' and reason is not null
      and ((outcome='held' and reason in ('source-denied','policy-changed','incomplete-evidence'))
        or (outcome='failed' and reason in ('transport-failed','invalid-receipt','clock-invalid'))
        or (outcome='abandoned' and reason='start-timeout'))
      and observed_at is null and fingerprints is null and evidence_digest is null)
  )
);

-- A positive observation requires an exact attestation from a distinct
-- database role. This is a synthetic trust-boundary experiment, not a
-- statement that any real source has been observed or independently reviewed.
create table dlkt_history_lab.observation_attestations (
  attempt_id uuid primary key references dlkt_history_lab.attempts,
  evidence_digest text not null check (evidence_digest ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null check (isfinite(observed_at)),
  attested_at timestamptz not null check (isfinite(attested_at) and attested_at>=observed_at)
);

-- No direct table grants. The non-login schema owner is the SECURITY DEFINER
-- role; worker/reader/reaper/attestor calls are restricted to the functions.
alter table dlkt_history_lab.candidates enable row level security;
alter table dlkt_history_lab.attempts enable row level security;
alter table dlkt_history_lab.results enable row level security;
alter table dlkt_history_lab.observation_attestations enable row level security;

-- Caller holds a candidate lock. All attempts, including unresolved starts,
-- contribute to the contiguous prefix. No hash claims to authenticate it.
create function dlkt_history_lab.history_state(p_card text,p_revision integer,p_digest text,p_tip integer)
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare n bigint; max_seq integer; open_n bigint; open_seq integer; bad_clock boolean;
        open_started timestamptz; checked_at timestamptz:=clock_timestamp();
begin
  select count(*),coalesce(max(a.sequence_no),0),
    count(*) filter (where r.attempt_id is null),
    max(a.sequence_no) filter (where r.attempt_id is null),
    max(a.started_at) filter (where r.attempt_id is null),
    coalesce(bool_or(a.started_at>checked_at or r.finished_at>checked_at
      or r.finished_at<a.started_at or r.observed_at<a.started_at),false)
  into n,max_seq,open_n,open_seq,open_started,bad_clock
  from dlkt_history_lab.attempts a
  left join dlkt_history_lab.results r using (attempt_id)
  where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest);
  if n<>p_tip or max_seq<>p_tip or open_n>1
     or (open_n=1 and open_seq<>p_tip) or bad_clock then
    return 'integrity-held';
  end if;
  if exists (
    select 1 from dlkt_history_lab.attempts a
    join dlkt_history_lab.attempts b on
      (a.card_id,a.revision,a.digest)=(b.card_id,b.revision,b.digest)
      and b.sequence_no=a.sequence_no+1
    left join dlkt_history_lab.results r on r.attempt_id=a.attempt_id
    where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest)
      and (r.attempt_id is null or b.started_at<=r.finished_at)
  ) then return 'integrity-held'; end if;
  -- Attestations are bound to their attempt and cannot be carried forward.
  -- An attested but failed/abandoned attempt remains a hold, never a success.
  if exists (
    select 1 from dlkt_history_lab.attempts a
    join dlkt_history_lab.observation_attestations o using (attempt_id)
    left join dlkt_history_lab.results r using (attempt_id)
    where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest)
      and (o.observed_at<a.started_at or o.attested_at>checked_at
        or o.attested_at>=a.started_at+interval '5 minutes'
        or (r.attempt_id is not null and o.attested_at>r.finished_at))
  ) then return 'integrity-held'; end if;
  -- Recompute every stored positive binding, including historical attempts.
  -- Never treat a digest supplied by the worker as authoritative by itself.
  if exists (
    select 1 from dlkt_history_lab.attempts a
    join dlkt_history_lab.results r using (attempt_id)
    join dlkt_history_lab.candidates c on (a.card_id,a.revision,a.digest)=(c.card_id,c.revision,c.digest)
    left join dlkt_history_lab.observation_attestations o on o.attempt_id=a.attempt_id
    where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest)
      and r.outcome='observed'
      and (r.evidence_digest is distinct from dlkt_history_lab.observation_digest(
        c.card_id,c.revision,c.digest,c.source_url,c.policy_url,r.observed_at,r.fingerprints)
        or o.attempt_id is null or o.evidence_digest is distinct from r.evidence_digest
        or o.observed_at is distinct from r.observed_at)
  ) then return 'integrity-held'; end if;
  if open_n=1 then
    if checked_at>=open_started+interval '5 minutes' then return 'expired-open'; end if;
    return 'open';
  end if;
  if p_tip=0 then return 'empty'; end if;
  if p_tip>=256 then return 'capacity-held'; end if;
  if exists (
    select 1 from dlkt_history_lab.attempts a join dlkt_history_lab.results r using (attempt_id)
    where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest) and r.outcome<>'observed'
  ) then return 'terminal-hold-present'; end if;
  return 'complete-observation-prefix';
end;
$$;

-- A caller may perform a probe only after a committed 'created' reply.
-- A lost reply is NOT permission to run on replay-open. Reaper closes it.
create function dlkt_history_lab.start_attempt(
  p_card text,p_revision integer,p_digest text,p_attempt uuid
) returns table(sequence_no integer,disposition text)
language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype;
        a dlkt_history_lab.attempts%rowtype;
        state text; ts timestamptz; prev_end timestamptz;
begin
  if p_attempt is null then raise exception 'HISTORY_ATTEMPT_REQUIRED'; end if;
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  state:=dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip);
  if state='integrity-held' then raise exception 'HISTORY_INTEGRITY_HELD'; end if;
  select * into a from dlkt_history_lab.attempts k where k.attempt_id=p_attempt;
  if found then
    if (a.card_id,a.revision,a.digest) is distinct from (p_card,p_revision,p_digest) then
      raise exception 'HISTORY_ATTEMPT_CONFLICT';
    end if;
    return query select a.sequence_no,case when exists (
      select 1 from dlkt_history_lab.results r where r.attempt_id=p_attempt
    ) then 'replay-terminal' else 'replay-open' end;
    return;
  end if;
  if state in ('open','expired-open') then return query select null::integer,'busy'::text; return; end if;
  if state='capacity-held' then return query select null::integer,'capacity-held'::text; return; end if;
  ts:=clock_timestamp();
  select r.finished_at into prev_end from dlkt_history_lab.attempts k
  join dlkt_history_lab.results r using (attempt_id)
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) and k.sequence_no=c.tip;
  if prev_end is not null and ts<=prev_end then raise exception 'HISTORY_CLOCK_INVALID'; end if;
  begin
    insert into dlkt_history_lab.attempts values(p_attempt,p_card,p_revision,p_digest,c.tip+1,ts);
  exception when unique_violation then
    raise exception 'HISTORY_ATTEMPT_CONFLICT';
  end;
  update dlkt_history_lab.candidates k set tip=c.tip+1
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  return query select c.tip+1,'created'::text;
end;
$$;

-- Only the separately authenticated attestor role can record this exact
-- positive-evidence attestation. The worker cannot invoke or modify it.
-- An existing identical attestation is idempotent, not a new authorization.
create function dlkt_history_lab.attest_observation(
  p_card text,p_revision integer,p_digest text,p_attempt uuid,
  p_observed timestamptz,p_fingerprints jsonb,p_evidence text
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype;
        a dlkt_history_lab.attempts%rowtype;
        o dlkt_history_lab.observation_attestations%rowtype;
        expected_digest text; ts timestamptz;
begin
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  if dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip)='integrity-held' then
    raise exception 'HISTORY_INTEGRITY_HELD';
  end if;
  select * into a from dlkt_history_lab.attempts k where k.attempt_id=p_attempt
    and (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  if not found then raise exception 'HISTORY_ATTEMPT_UNKNOWN'; end if;
  expected_digest:=dlkt_history_lab.observation_digest(c.card_id,c.revision,c.digest,
    c.source_url,c.policy_url,p_observed,p_fingerprints);
  if expected_digest is null or p_evidence is distinct from expected_digest then
    raise exception using errcode='23514', message='HISTORY_EVIDENCE_BINDING_INVALID';
  end if;
  select * into o from dlkt_history_lab.observation_attestations k where k.attempt_id=p_attempt;
  if found then
    if (o.evidence_digest,o.observed_at) is distinct from (p_evidence,p_observed) then
      raise exception 'HISTORY_ATTESTATION_CONFLICT';
    end if;
    return 'replay';
  end if;
  if exists(select 1 from dlkt_history_lab.results r where r.attempt_id=p_attempt) then
    raise exception 'HISTORY_ATTEMPT_TERMINAL';
  end if;
  ts:=clock_timestamp();
  if a.sequence_no<>c.tip or ts<a.started_at or p_observed<a.started_at or p_observed>ts then
    raise exception 'HISTORY_CLOCK_OR_SEQUENCE_INVALID';
  end if;
  if ts>=a.started_at+interval '5 minutes' then raise exception 'HISTORY_ATTEMPT_EXPIRED'; end if;
  insert into dlkt_history_lab.observation_attestations values(p_attempt,p_evidence,p_observed,ts);
  return 'attested';
end;
$$;

create function dlkt_history_lab.finish_attempt(
  p_card text,p_revision integer,p_digest text,p_attempt uuid,
  p_outcome text,p_reason text,p_observed timestamptz,p_fingerprints jsonb,p_evidence text
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype;
        a dlkt_history_lab.attempts%rowtype;
        r dlkt_history_lab.results%rowtype; ts timestamptz; expected_digest text;
begin
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  if dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip)='integrity-held' then
    raise exception 'HISTORY_INTEGRITY_HELD';
  end if;
  select * into a from dlkt_history_lab.attempts k where k.attempt_id=p_attempt
  and (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  if not found then raise exception 'HISTORY_ATTEMPT_UNKNOWN'; end if;
  if p_outcome is null or p_outcome not in ('observed','held','failed') then
    raise exception 'HISTORY_RESULT_INVALID';
  end if;
  select * into r from dlkt_history_lab.results k where k.attempt_id=p_attempt;
  if found then
    if (r.outcome,r.reason,r.observed_at,r.fingerprints,r.evidence_digest)
       is distinct from (p_outcome,p_reason,p_observed,p_fingerprints,p_evidence) then
      raise exception 'HISTORY_RESULT_CONFLICT';
    end if;
    return 'replay';
  end if;
  ts:=clock_timestamp();
  if a.sequence_no<>c.tip or ts<a.started_at
     or (p_observed is not null and (not isfinite(p_observed) or p_observed<a.started_at or p_observed>ts)) then
    raise exception 'HISTORY_CLOCK_OR_SEQUENCE_INVALID';
  end if;
  -- A delayed worker must not convert an expired open attempt to a success,
  -- even if the separate reaper has not yet acquired the candidate lock.
  if ts>=a.started_at+interval '5 minutes' then raise exception 'HISTORY_ATTEMPT_EXPIRED'; end if;
  if p_outcome='observed' then
    expected_digest:=dlkt_history_lab.observation_digest(c.card_id,c.revision,c.digest,c.source_url,c.policy_url,p_observed,p_fingerprints);
    if expected_digest is null or p_evidence is distinct from expected_digest then
      raise exception using errcode='23514', message='HISTORY_EVIDENCE_BINDING_INVALID';
    end if;
    if not exists (
      select 1 from dlkt_history_lab.observation_attestations o
      where o.attempt_id=p_attempt and o.evidence_digest=p_evidence
        and o.observed_at=p_observed and o.attested_at<=ts
    ) then raise exception using errcode='23514', message='HISTORY_ATTESTATION_REQUIRED'; end if;
  end if;
  insert into dlkt_history_lab.results values(p_attempt,ts,p_outcome,p_reason,p_observed,p_fingerprints,p_evidence);
  return 'recorded';
end;
$$;

create function dlkt_history_lab.abandon_attempt(
  p_card text,p_revision integer,p_digest text,p_attempt uuid
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype;
        a dlkt_history_lab.attempts%rowtype; ts timestamptz;
begin
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  if dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip)='integrity-held' then
    raise exception 'HISTORY_INTEGRITY_HELD';
  end if;
  select * into a from dlkt_history_lab.attempts k where k.attempt_id=p_attempt
  and (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  if not found then raise exception 'HISTORY_ATTEMPT_UNKNOWN'; end if;
  if exists(select 1 from dlkt_history_lab.results r where r.attempt_id=p_attempt) then return 'already-terminal'; end if;
  ts:=clock_timestamp();
  if a.sequence_no<>c.tip or ts<a.started_at+interval '5 minutes' then raise exception 'HISTORY_NOT_ABANDONABLE'; end if;
  insert into dlkt_history_lab.results(attempt_id,finished_at,outcome,reason)
    values(p_attempt,ts,'abandoned','start-timeout');
  return 'recorded';
end;
$$;

-- Bounded consistent snapshot: never omit held/failed/open observations.
-- This is storage state, not semantic evidence or review approval.
create function dlkt_history_lab.read_history(p_card text,p_revision integer,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype; entries jsonb; state text;
begin
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for share;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  state:=dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip);
  select coalesce(jsonb_agg(jsonb_build_object(
    'sequence',a.sequence_no,'attemptId',a.attempt_id,'startedAt',a.started_at,
    'finishedAt',r.finished_at,'outcome',coalesce(r.outcome,'open'),'reason',r.reason,
    'observedAt',r.observed_at,'fingerprints',r.fingerprints,'evidenceDigest',r.evidence_digest,
    'attestedAt',o.attested_at
  ) order by a.sequence_no),'[]'::jsonb) into entries
  from dlkt_history_lab.attempts a left join dlkt_history_lab.results r using(attempt_id)
  left join dlkt_history_lab.observation_attestations o on o.attempt_id=a.attempt_id
  where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest);
  return jsonb_build_object('cardId',c.card_id,'revision',c.revision,'digest',c.digest,
    'sourceUrl',c.source_url,'policyUrl',c.policy_url,'tip',c.tip,'state',state,
    'attempts',entries,'activationAllowed',false);
end;
$$;

revoke all on all tables in schema dlkt_history_lab from public,anon,authenticated,service_role,
  dlkt_history_worker,dlkt_history_reader,dlkt_history_reaper,dlkt_history_attestor;
revoke execute on all functions in schema dlkt_history_lab from public,anon,authenticated,service_role,
  dlkt_history_worker,dlkt_history_reader,dlkt_history_reaper,dlkt_history_attestor;
grant execute on function dlkt_history_lab.start_attempt(text,integer,text,uuid),
  dlkt_history_lab.finish_attempt(text,integer,text,uuid,text,text,timestamptz,jsonb,text)
  to dlkt_history_worker;
grant execute on function dlkt_history_lab.abandon_attempt(text,integer,text,uuid) to dlkt_history_reaper;
grant execute on function dlkt_history_lab.read_history(text,integer,text) to dlkt_history_reader;
grant execute on function dlkt_history_lab.attest_observation(text,integer,text,uuid,timestamptz,jsonb,text)
  to dlkt_history_attestor;
commit;
