-- DISPOSABLE LAB ONLY. Synthetic decisions are never editorial approval.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_reviewer nologin noinherit;
grant usage on schema dlkt_history_lab to dlkt_history_reviewer;
set local role dlkt_history_owner;

create table dlkt_history_lab.scope_review_heads (
  card_id text not null,
  revision integer not null,
  digest text not null,
  scope text not null check (scope in ('feed','standalone')),
  tip integer not null check (tip between 1 and 256),
  primary key(card_id,revision,digest,scope),
  foreign key(card_id,revision,digest) references dlkt_history_lab.candidates
);
create table dlkt_history_lab.scope_reviews (
  review_id uuid primary key,
  card_id text not null,
  revision integer not null,
  digest text not null,
  scope text not null,
  review_no integer not null check(review_no between 1 and 256),
  attempt_id uuid not null references dlkt_history_lab.attempts,
  verdict text not null check(verdict in ('lab-held','lab-permitted')),
  evidence_digest text check(evidence_digest ~ '^[0-9a-f]{64}$'),
  reviewed_at timestamptz not null check(isfinite(reviewed_at)),
  expires_at timestamptz,
  reviewer_principal name not null,
  unique(card_id,revision,digest,scope,review_no),
  foreign key(card_id,revision,digest,scope) references dlkt_history_lab.scope_review_heads,
  check((verdict='lab-held' and expires_at is null) or
        (verdict='lab-permitted' and evidence_digest is not null and expires_at is not null
          and isfinite(expires_at) and expires_at>reviewed_at))
);
alter table dlkt_history_lab.scope_review_heads enable row level security;
alter table dlkt_history_lab.scope_reviews enable row level security;

-- Caller holds the candidate lock. Review records must bind the exact
-- terminal evidence that was the current tip at the actual review time.
create function dlkt_history_lab.scope_review_integrity(
  p_card text,p_revision integer,p_digest text,p_now timestamptz
) returns boolean language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if exists (
    select 1 from dlkt_history_lab.scope_review_heads h
    left join dlkt_history_lab.scope_reviews s using(card_id,revision,digest,scope)
    where (h.card_id,h.revision,h.digest)=(p_card,p_revision,p_digest)
    group by h.scope,h.tip having count(s.review_id)<>h.tip or coalesce(max(s.review_no),0)<>h.tip
  ) then return false; end if;
  if exists (
    select 1 from dlkt_history_lab.scope_reviews s
    left join dlkt_history_lab.attempts a on a.attempt_id=s.attempt_id
    left join dlkt_history_lab.results r on r.attempt_id=s.attempt_id
    left join dlkt_history_lab.attempts nxt
      on (nxt.card_id,nxt.revision,nxt.digest,nxt.sequence_no)=(a.card_id,a.revision,a.digest,a.sequence_no+1)
    where (s.card_id,s.revision,s.digest)=(p_card,p_revision,p_digest)
      and (s.card_id !~ '^lab-' or a.attempt_id is null or r.attempt_id is null
        or (a.card_id,a.revision,a.digest) is distinct from (s.card_id,s.revision,s.digest)
        or s.evidence_digest is distinct from r.evidence_digest
        or s.reviewed_at<r.finished_at or s.reviewed_at>p_now
        or (nxt.attempt_id is not null and nxt.started_at<=s.reviewed_at)
        or (s.verdict='lab-permitted' and (
          r.outcome<>'observed' or r.observed_at is null or s.reviewed_at>=r.observed_at+interval '24 hours'
          or s.expires_at>r.observed_at+interval '24 hours')))
  ) then return false; end if;
  if exists (
    select 1 from dlkt_history_lab.scope_reviews s
    join dlkt_history_lab.scope_reviews prev
      on (prev.card_id,prev.revision,prev.digest,prev.scope,prev.review_no)
       =(s.card_id,s.revision,s.digest,s.scope,s.review_no-1)
    join dlkt_history_lab.attempts a on a.attempt_id=s.attempt_id
    join dlkt_history_lab.attempts b on b.attempt_id=prev.attempt_id
    where (s.card_id,s.revision,s.digest)=(p_card,p_revision,p_digest)
      and (s.reviewed_at<=prev.reviewed_at or a.sequence_no<b.sequence_no
        or (a.sequence_no=b.sequence_no and s.verdict='lab-permitted'))
  ) then return false; end if;
  return true;
end;
$$;

-- An independently authenticated fixture reviewer may append a synthetic
-- verdict, not a real approval. A held verdict can supersede an earlier
-- permitted verdict on the same baseline; permission cannot be renewed
-- on that same attempt. An exact replay never changes dates or scope.
create function dlkt_history_lab.record_lab_review(
  p_card text,p_revision integer,p_digest text,p_attempt uuid,p_review uuid,
  p_scope text,p_verdict text,p_evidence text,p_expires timestamptz
) returns text language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype;
        a dlkt_history_lab.attempts%rowtype;
        r dlkt_history_lab.results%rowtype;
        prior dlkt_history_lab.scope_reviews%rowtype;
        n integer; previous_sequence integer; ts timestamptz; state text;
begin
  if p_card is null or p_card !~ '^lab-' then raise exception 'LAB_REVIEW_SYNTHETIC_ONLY'; end if;
  if p_review is null or p_attempt is null or p_scope is null or p_scope not in ('feed','standalone')
    or p_verdict is null or p_verdict not in ('lab-held','lab-permitted') then
    raise exception 'LAB_REVIEW_ARGUMENT_INVALID';
  end if;
  select * into c from dlkt_history_lab.candidates k
  where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  ts:=clock_timestamp();
  state:=dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip);
  if state='integrity-held' or not dlkt_history_lab.scope_review_integrity(p_card,p_revision,p_digest,ts)
    then raise exception 'LAB_REVIEW_INTEGRITY_HELD'; end if;
  select * into prior from dlkt_history_lab.scope_reviews s where s.review_id=p_review;
  if found then
    if (prior.card_id,prior.revision,prior.digest,prior.attempt_id,prior.scope,prior.verdict,prior.evidence_digest,prior.expires_at,prior.reviewer_principal)
      is distinct from (p_card,p_revision,p_digest,p_attempt,p_scope,p_verdict,p_evidence,p_expires,session_user::name)
      then raise exception 'LAB_REVIEW_REPLAY_CONFLICT'; end if;
    return 'replay';
  end if;
  if state not in ('complete-observation-prefix','terminal-hold-present')
    then raise exception 'LAB_REVIEW_HISTORY_NOT_READY'; end if;
  select * into a from dlkt_history_lab.attempts k
  where k.attempt_id=p_attempt and (k.card_id,k.revision,k.digest,k.sequence_no)=(p_card,p_revision,p_digest,c.tip);
  if not found then raise exception 'LAB_REVIEW_BASELINE_NOT_TIP'; end if;
  select * into r from dlkt_history_lab.results k where k.attempt_id=p_attempt;
  if not found or p_evidence is distinct from r.evidence_digest or ts<r.finished_at
    then raise exception 'LAB_REVIEW_EVIDENCE_INVALID'; end if;
  if p_verdict='lab-permitted' then
    if r.outcome<>'observed' or r.observed_at is null or ts>=r.observed_at+interval '24 hours'
      or p_expires is null or not isfinite(p_expires) or p_expires<=ts
      or p_expires>r.observed_at+interval '24 hours' then raise exception 'LAB_REVIEW_WINDOW_INVALID'; end if;
  elsif p_expires is not null then raise exception 'LAB_REVIEW_WINDOW_INVALID';
  end if;
  select h.tip into n from dlkt_history_lab.scope_review_heads h
    where (h.card_id,h.revision,h.digest,h.scope)=(p_card,p_revision,p_digest,p_scope);
  n:=coalesce(n,0);
  if n>=256 then raise exception 'LAB_REVIEW_CAPACITY_HELD'; end if;
  if n>0 then
    select * into prior from dlkt_history_lab.scope_reviews s
      where (s.card_id,s.revision,s.digest,s.scope,s.review_no)=(p_card,p_revision,p_digest,p_scope,n);
    select k.sequence_no into previous_sequence from dlkt_history_lab.attempts k where k.attempt_id=prior.attempt_id;
    if previous_sequence is null or previous_sequence>a.sequence_no or ts<=prior.reviewed_at
      then raise exception 'LAB_REVIEW_INTEGRITY_HELD'; end if;
    if p_verdict='lab-permitted' and previous_sequence=a.sequence_no
      then raise exception 'LAB_REVIEW_NEW_OBSERVATION_REQUIRED'; end if;
    if p_verdict='lab-held' and previous_sequence=a.sequence_no and prior.verdict='lab-held'
      then raise exception 'LAB_REVIEW_ALREADY_HELD'; end if;
  end if;
  insert into dlkt_history_lab.scope_review_heads values(p_card,p_revision,p_digest,p_scope,n+1)
    on conflict(card_id,revision,digest,scope) do update set tip=excluded.tip;
  insert into dlkt_history_lab.scope_reviews values(p_review,p_card,p_revision,p_digest,p_scope,n+1,p_attempt,
    p_verdict,p_evidence,ts,p_expires,session_user::name);
  return 'recorded';
end;
$$;

-- One locked snapshot; never assemble approvals from separate stale reads.
-- This exposes durable review metadata only, not a second editorial planner.
create function dlkt_history_lab.read_lab_review_snapshot(p_card text,p_revision integer,p_digest text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare c dlkt_history_lab.candidates%rowtype; history jsonb; scopes jsonb; ts timestamptz; valid boolean;
begin
  select * into c from dlkt_history_lab.candidates k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for share;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  history:=dlkt_history_lab.read_history(p_card,p_revision,p_digest);
  ts:=clock_timestamp();
  valid:=history->>'state'<>'integrity-held' and dlkt_history_lab.scope_review_integrity(p_card,p_revision,p_digest,ts);
  select jsonb_object_agg(x.scope,jsonb_build_object(
    'count',coalesce(h.tip,0),
    'state',case
      when not valid then 'integrity-held'
      when p_card !~ '^lab-' then 'synthetic-only'
      when s.review_id is null then 'no-review'
      when s.verdict='lab-held' then 'held'
      when ts>=s.expires_at then 'expired'
      when a.sequence_no<>c.tip or history->>'state' in ('open','expired-open','capacity-held') then 'new-observation-review-required'
      else 'recorded-not-authority' end,
    'latest',case when valid and s.review_id is not null then jsonb_build_object(
      'reviewId',s.review_id,'scope',s.scope,'verdict',s.verdict,'attemptId',s.attempt_id,
      'sequence',a.sequence_no,'evidenceDigest',s.evidence_digest,'reviewedAt',s.reviewed_at,'expiresAt',s.expires_at,
      'reviewerPrincipal',s.reviewer_principal) else null end
  )) into scopes
  from (values('feed'),('standalone')) x(scope)
  left join dlkt_history_lab.scope_review_heads h
    on (h.card_id,h.revision,h.digest,h.scope)=(p_card,p_revision,p_digest,x.scope)
  left join dlkt_history_lab.scope_reviews s
    on (s.card_id,s.revision,s.digest,s.scope,s.review_no)=(h.card_id,h.revision,h.digest,h.scope,h.tip)
  left join dlkt_history_lab.attempts a on a.attempt_id=s.attempt_id;
  return jsonb_build_object('kind','synthetic-review-snapshot-not-authority','history',history,
    'state',case when valid then 'metadata-only' else 'integrity-held' end,
    'checkedAt',ts,'scopes',scopes,'activationAllowed',false,'approvalReusable',false);
end;
$$;

revoke all on dlkt_history_lab.scope_review_heads,dlkt_history_lab.scope_reviews
  from public,anon,authenticated,service_role,dlkt_history_worker,dlkt_history_attestor,
  dlkt_history_reader,dlkt_history_reaper,dlkt_history_reviewer;
revoke execute on function dlkt_history_lab.scope_review_integrity(text,integer,text,timestamptz),
  dlkt_history_lab.record_lab_review(text,integer,text,uuid,uuid,text,text,text,timestamptz),
  dlkt_history_lab.read_lab_review_snapshot(text,integer,text)
  from public,anon,authenticated,service_role,dlkt_history_worker,dlkt_history_attestor,
  dlkt_history_reader,dlkt_history_reaper,dlkt_history_reviewer;
grant execute on function dlkt_history_lab.record_lab_review(text,integer,text,uuid,uuid,text,text,text,timestamptz)
  to dlkt_history_reviewer;
grant execute on function dlkt_history_lab.read_lab_review_snapshot(text,integer,text) to dlkt_history_reader;
commit;
