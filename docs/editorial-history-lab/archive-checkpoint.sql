-- DISPOSABLE LAB ONLY. Sealed metadata checkpoint; no deletion, restore,
-- epoch rollover, new approval or continuation past the existing capacity.
\set ON_ERROR_STOP on
begin;
create role dlkt_history_archiver nologin noinherit;
grant usage on schema dlkt_history_lab to dlkt_history_archiver;
set local role dlkt_history_owner;

create table dlkt_history_lab.archive_checkpoints (
  checkpoint_id uuid not null unique,
  card_id text not null check(card_id ~ '^lab-'),
  revision integer not null,
  digest text not null,
  sealed_at timestamptz not null check(isfinite(sealed_at)),
  sealed_by name not null,
  payload text not null check(octet_length(payload) between 1 and 1048576),
  payload_sha256 text not null check(payload_sha256 ~ '^[0-9a-f]{64}$'),
  primary key(card_id,revision,digest),
  foreign key(card_id,revision,digest) references dlkt_history_lab.candidates
);
alter table dlkt_history_lab.archive_checkpoints enable row level security;

-- Caller holds the candidate lock. Capture every row of the complete closed
-- prefix, not merely the positive outcomes or latest scope review.
-- The format is PostgreSQL-17 JSONB text in UTF-8/UTC. This is a versioned
-- database-local integrity binding, not a portable signature or independent
-- proof against a privileged administrator rewriting both copies.
create function dlkt_history_lab.archive_payload(
  p_card text,p_revision integer,p_digest text
) returns text language plpgsql security invoker
set search_path=pg_catalog set timezone='UTC' as $$
declare c dlkt_history_lab.candidates%rowtype;
        history jsonb; reviews jsonb; heads jsonb; payload text; ts timestamptz;
begin
  if p_card is null or p_card !~ '^lab-' then raise exception 'LAB_ARCHIVE_SYNTHETIC_ONLY'; end if;
  select * into c from dlkt_history_lab.candidates k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for share;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  ts:=clock_timestamp();
  if c.tip<>256 or dlkt_history_lab.history_state(p_card,p_revision,p_digest,c.tip)<>'capacity-held'
    then raise exception 'LAB_ARCHIVE_CLOSED_CAPACITY_REQUIRED'; end if;
  if not dlkt_history_lab.scope_review_integrity(p_card,p_revision,p_digest,ts)
    then raise exception 'LAB_ARCHIVE_REVIEW_INTEGRITY_HELD'; end if;
  select jsonb_agg(jsonb_build_object('attempt',to_jsonb(a),'result',to_jsonb(r),'attestation',to_jsonb(o))
    order by a.sequence_no) into history
    from dlkt_history_lab.attempts a
    join dlkt_history_lab.results r using(attempt_id)
    left join dlkt_history_lab.observation_attestations o on o.attempt_id=a.attempt_id
    where (a.card_id,a.revision,a.digest)=(p_card,p_revision,p_digest);
  if history is null or jsonb_array_length(history)<>c.tip then
    raise exception 'LAB_ARCHIVE_HISTORY_INCOMPLETE'; end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.scope collate "C",s.review_no),'[]'::jsonb) into reviews
    from dlkt_history_lab.scope_reviews s where (s.card_id,s.revision,s.digest)=(p_card,p_revision,p_digest);
  select coalesce(jsonb_agg(to_jsonb(h) order by h.scope collate "C"),'[]'::jsonb) into heads
    from dlkt_history_lab.scope_review_heads h where (h.card_id,h.revision,h.digest)=(p_card,p_revision,p_digest);
  payload:=jsonb_build_object(
    'kind','dlkt-synthetic-archive-pg17-v1',
    'candidate',to_jsonb(c),'attempts',history,'scopeReviewHeads',heads,'scopeReviews',reviews,
    'activationAllowed',false,'approvalReusable',false,'rolloverAllowed',false)::text;
  if octet_length(payload)>1048576 then raise exception 'LAB_ARCHIVE_SIZE_HELD'; end if;
  return payload;
end;
$$;

-- Caller already holds the candidate lock. Both first seal and replay
-- use the same chronology guard as verified archive readback.
create function dlkt_history_lab.archive_seal_time_valid(
  p_card text,p_revision integer,p_digest text,p_sealed timestamptz,p_now timestamptz
) returns boolean language sql stable strict security invoker
set search_path=pg_catalog set timezone='UTC' as $$
  select coalesce(
    p_sealed<=p_now
    and p_sealed>=(select max(r.finished_at) from dlkt_history_lab.results r
      join dlkt_history_lab.attempts t using(attempt_id)
      where (t.card_id,t.revision,t.digest)=(p_card,p_revision,p_digest))
    and p_sealed>=coalesce((select max(s.reviewed_at) from dlkt_history_lab.scope_reviews s
      where (s.card_id,s.revision,s.digest)=(p_card,p_revision,p_digest)),p_sealed),false);
$$;

create function dlkt_history_lab.seal_lab_checkpoint(
  p_card text,p_revision integer,p_digest text,p_checkpoint uuid
) returns text language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' as $$
declare c dlkt_history_lab.candidates%rowtype;
        prior dlkt_history_lab.archive_checkpoints%rowtype;
        payload text; checksum text; ts timestamptz;
begin
  if p_checkpoint is null then raise exception 'LAB_ARCHIVE_ID_REQUIRED'; end if;
  if p_card is null or p_card !~ '^lab-' then raise exception 'LAB_ARCHIVE_SYNTHETIC_ONLY'; end if;
  select * into c from dlkt_history_lab.candidates k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for update;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  payload:=dlkt_history_lab.archive_payload(p_card,p_revision,p_digest);
  checksum:=encode(sha256(convert_to(payload,'UTF8')),'hex');
  ts:=clock_timestamp();
  if not dlkt_history_lab.archive_seal_time_valid(p_card,p_revision,p_digest,ts,ts)
    then raise exception 'LAB_ARCHIVE_INTEGRITY_HELD'; end if;
  select * into prior from dlkt_history_lab.archive_checkpoints k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  if found then
    if prior.payload is distinct from payload or prior.payload_sha256 is distinct from checksum
      or not dlkt_history_lab.archive_seal_time_valid(p_card,p_revision,p_digest,prior.sealed_at,ts)
      then raise exception 'LAB_ARCHIVE_INTEGRITY_HELD'; end if;
    if prior.checkpoint_id<>p_checkpoint or prior.sealed_by<>session_user::name
      then raise exception 'LAB_ARCHIVE_REPLAY_CONFLICT'; end if;
    return 'replay';
  end if;
  begin
    insert into dlkt_history_lab.archive_checkpoints values(p_checkpoint,p_card,p_revision,p_digest,
      ts,session_user::name,payload,checksum);
  exception when unique_violation then raise exception 'LAB_ARCHIVE_REPLAY_CONFLICT'; end;
  return 'sealed';
end;
$$;

-- Recompute from the still-retained authoritative lab rows under the lock.
-- Missing/different current data, digest mismatch or clock regression returns
-- no archive bytes, never a successful restore or approval.
create function dlkt_history_lab.read_lab_checkpoint(p_card text,p_revision integer,p_digest text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog set timezone='UTC' as $$
declare c dlkt_history_lab.candidates%rowtype; a dlkt_history_lab.archive_checkpoints%rowtype;
        payload text; valid boolean:=false; ts timestamptz;
        boundary jsonb:=jsonb_build_object('kind','synthetic-checkpoint-not-authority',
          'activationAllowed',false,'approvalReusable',false,'rolloverAllowed',false);
begin
  select * into c from dlkt_history_lab.candidates k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest) for share;
  if not found then raise exception 'HISTORY_CANDIDATE_UNKNOWN'; end if;
  select * into a from dlkt_history_lab.archive_checkpoints k
    where (k.card_id,k.revision,k.digest)=(p_card,p_revision,p_digest);
  if not found then return boundary||jsonb_build_object('state','no-checkpoint','checkpoint',null); end if;
  begin
    payload:=dlkt_history_lab.archive_payload(p_card,p_revision,p_digest);
    ts:=clock_timestamp();
    valid:=a.payload=payload and a.payload_sha256=encode(sha256(convert_to(payload,'UTF8')),'hex')
      and dlkt_history_lab.archive_seal_time_valid(p_card,p_revision,p_digest,a.sealed_at,ts);
  exception when raise_exception then valid:=false;
  end;
  if valid is distinct from true then
    return boundary||jsonb_build_object('state','integrity-held','checkpoint',null);
  end if;
  return boundary||jsonb_build_object('state','sealed-verified','checkpoint',jsonb_build_object(
    'checkpointId',a.checkpoint_id,'sealedAt',a.sealed_at,'sealedBy',a.sealed_by,
    'payloadSha256',a.payload_sha256,'payload',a.payload));
end;
$$;

revoke all on dlkt_history_lab.archive_checkpoints
  from public,anon,authenticated,service_role,dlkt_history_worker,dlkt_history_attestor,
  dlkt_history_reader,dlkt_history_reaper,dlkt_history_reviewer,dlkt_history_archiver;
revoke execute on function dlkt_history_lab.archive_payload(text,integer,text),
  dlkt_history_lab.archive_seal_time_valid(text,integer,text,timestamptz,timestamptz),
  dlkt_history_lab.seal_lab_checkpoint(text,integer,text,uuid),
  dlkt_history_lab.read_lab_checkpoint(text,integer,text)
  from public,anon,authenticated,service_role,dlkt_history_worker,dlkt_history_attestor,
  dlkt_history_reader,dlkt_history_reaper,dlkt_history_reviewer,dlkt_history_archiver;
grant execute on function dlkt_history_lab.seal_lab_checkpoint(text,integer,text,uuid) to dlkt_history_archiver;
grant execute on function dlkt_history_lab.read_lab_checkpoint(text,integer,text) to dlkt_history_reader;
commit;
