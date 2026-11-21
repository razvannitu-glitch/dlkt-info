begin;

insert into dlkt_info_private.source_registry (
  source_key, revision, name, origin, authority, role, languages, path_rules,
  automated_access, factual_extraction, commercial_summaries, attribution_required,
  terms_url, reviewed_at, review_expires_at, note,
  min_interval_seconds, max_requests_per_day, timeout_ms, max_bytes,
  status, valid_from
) values
(
  'eu-eurlex-commission-proposals', 1,
  'EUR-Lex — Commission proposals and related documents',
  'https://eur-lex.europa.eu', 'official', 'regulator', array['en'],
  '[{"pathnamePrefix":"/legal-content/AUTO/","claimKinds":["regulation"],"allowedQueryKeys":["uri"],"requiredQueryKeys":["uri"]}]'::jsonb,
  'permitted', 'permitted', 'attribution-required', true,
  'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html',
  '2026-11-11T00:00:00Z', '2027-02-09T00:00:00Z',
  'Official EUR-Lex proposal feed. Re-use requires source attribution; proposal-stage publication does not establish adoption or legal effect.',
  1800, 48, 8000, 500000, 'active', '2026-11-11T00:00:00Z'
),
(
  'eu-eurlex-legislation', 1,
  'EUR-Lex — Parliament and Council legislation',
  'https://eur-lex.europa.eu', 'official', 'regulator', array['en'],
  '[{"pathnamePrefix":"/legal-content/AUTO/","claimKinds":["regulation"],"allowedQueryKeys":["uri"],"requiredQueryKeys":["uri"]}]'::jsonb,
  'permitted', 'permitted', 'attribution-required', true,
  'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html',
  '2026-11-11T00:00:00Z', '2027-02-09T00:00:00Z',
  'Official EUR-Lex legislation feed. Re-use requires source attribution; applicability and effective dates must be verified in the linked act.',
  1800, 48, 8000, 500000, 'active', '2026-11-11T00:00:00Z'
)
on conflict (source_key, revision) do nothing;

create table if not exists dlkt_info_private.source_acquisition_state (
  source_key text primary key,
  checkpoint_version integer not null default 0,
  checkpoint jsonb,
  body_hash text,
  etag text,
  last_modified text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_eligible_at timestamptz,
  attempt_day date,
  attempts_today integer not null default 0,
  total_attempts bigint not null default 0,
  active_attempt_id uuid,
  lease_owner text,
  lease_expires_at timestamptz,
  consecutive_failures integer not null default 0,
  last_error_code text,
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_acquisition_source_key_check check (
    source_key = btrim(source_key) and length(source_key) between 1 and 120
    and source_key ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_acquisition_checkpoint_version_check check (checkpoint_version >= 0),
  constraint dlkt_info_acquisition_checkpoint_check check (
    (checkpoint_version = 0 and checkpoint is null and body_hash is null)
    or (checkpoint_version > 0 and jsonb_typeof(checkpoint) = 'object'
      and octet_length(checkpoint::text) between 2 and 2000000
      and body_hash ~ '^[a-f0-9]{64}$')
  ),
  constraint dlkt_info_acquisition_etag_check check (
    etag is null or (etag = btrim(etag) and length(etag) between 1 and 512 and etag !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_acquisition_last_modified_check check (
    last_modified is null or (last_modified = btrim(last_modified) and length(last_modified) between 1 and 512 and last_modified !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_acquisition_attempts_check check (attempts_today between 0 and 10000 and total_attempts >= 0),
  constraint dlkt_info_acquisition_lease_check check (
    (active_attempt_id is null and lease_owner is null and lease_expires_at is null)
    or (active_attempt_id is not null and lease_owner is not null and lease_expires_at is not null
      and lease_owner = btrim(lease_owner) and length(lease_owner) between 3 and 160
      and lease_owner ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$')
  ),
  constraint dlkt_info_acquisition_failures_check check (consecutive_failures between 0 and 1000000),
  constraint dlkt_info_acquisition_error_check check (
    last_error_code is null or (last_error_code = btrim(last_error_code)
      and length(last_error_code) between 3 and 120 and last_error_code ~ '^[A-Z0-9_:-]+$')
  )
);

create index if not exists dlkt_info_source_acquisition_due_idx
  on dlkt_info_private.source_acquisition_state (next_eligible_at, lease_expires_at);

create table if not exists dlkt_info_private.source_acquisition_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  attempt_id uuid,
  worker_id text not null,
  event_type text not null,
  attempt_no bigint not null,
  checkpoint_version integer not null,
  body_hash text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_acquisition_event_source_check check (
    source_key = btrim(source_key) and length(source_key) between 1 and 120
    and source_key ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_acquisition_event_worker_check check (
    worker_id = btrim(worker_id) and length(worker_id) between 3 and 160
    and worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_acquisition_event_type_check check (
    event_type in ('reserved', 'modified', 'not_modified', 'failed', 'lease_recovered')
  ),
  constraint dlkt_info_acquisition_event_attempt_check check (attempt_no >= 0 and checkpoint_version >= 0),
  constraint dlkt_info_acquisition_event_hash_check check (body_hash is null or body_hash ~ '^[a-f0-9]{64}$'),
  constraint dlkt_info_acquisition_event_error_check check (
    error_code is null or (error_code = btrim(error_code)
      and length(error_code) between 3 and 120 and error_code ~ '^[A-Z0-9_:-]+$')
  ),
  constraint dlkt_info_acquisition_event_metadata_check check (
    jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 20000
  )
);

create index if not exists dlkt_info_source_acquisition_events_source_idx
  on dlkt_info_private.source_acquisition_events (source_key, occurred_at desc);

create trigger dlkt_info_source_acquisition_state_touch
before update on dlkt_info_private.source_acquisition_state
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_source_acquisition_events_immutable
before update or delete on dlkt_info_private.source_acquisition_events
for each row execute function dlkt_info_private.prevent_mutation();

create or replace function public.dlkt_info_reserve_source_acquisition(
  p_source_key text,
  p_worker_id text,
  p_now timestamptz,
  p_lease_seconds integer default 120
)
returns table (
  allowed boolean,
  reason text,
  attempt_id uuid,
  source_key text,
  attempt_no bigint,
  checkpoint_version integer,
  checkpoint jsonb,
  body_hash text,
  etag text,
  last_modified text,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_source dlkt_info_private.source_registry%rowtype;
  v_state dlkt_info_private.source_acquisition_state%rowtype;
  v_day date;
  v_attempt_id uuid;
  v_expired_attempt uuid;
begin
  perform dlkt_info_private.require_service_role();
  if p_source_key is null or p_source_key !~ '^[a-z0-9][a-z0-9._:-]+$'
    or length(p_source_key) > 120
    or p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    or length(p_worker_id) not between 3 and 160
    or p_now is null or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_ACQUISITION_INPUT_INVALID';
  end if;

  select * into v_source
  from dlkt_info_private.source_registry registry
  where registry.source_key = p_source_key and registry.status = 'active' and registry.valid_until is null
  order by registry.revision desc
  limit 1;
  if not found then
    return query select false, 'source-unavailable', null::uuid, p_source_key, 0::bigint,
      0, null::jsonb, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  if v_source.review_expires_at <= p_now then
    return query select false, 'registry-expired', null::uuid, p_source_key, 0::bigint,
      0, null::jsonb, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;

  v_day := (p_now at time zone 'UTC')::date;
  insert into dlkt_info_private.source_acquisition_state (source_key, attempt_day)
  values (p_source_key, v_day)
  on conflict on constraint source_acquisition_state_pkey do nothing;

  select * into v_state
  from dlkt_info_private.source_acquisition_state
  where source_acquisition_state.source_key = p_source_key
  for update;

  if v_state.attempt_day is distinct from v_day then
    update dlkt_info_private.source_acquisition_state
    set attempt_day = v_day, attempts_today = 0
    where source_acquisition_state.source_key = p_source_key
    returning * into v_state;
  end if;

  if v_state.active_attempt_id is not null and v_state.lease_expires_at > p_now then
    return query select false, 'leased', null::uuid, p_source_key, v_state.total_attempts,
      v_state.checkpoint_version, v_state.checkpoint, v_state.body_hash, v_state.etag,
      v_state.last_modified, v_state.lease_expires_at;
    return;
  end if;

  if v_state.active_attempt_id is not null then
    v_expired_attempt := v_state.active_attempt_id;
    insert into dlkt_info_private.source_acquisition_events (
      source_key, attempt_id, worker_id, event_type, attempt_no, checkpoint_version,
      body_hash, error_code, metadata, occurred_at
    ) values (
      p_source_key, v_expired_attempt, coalesce(v_state.lease_owner, p_worker_id), 'lease_recovered',
      v_state.total_attempts, v_state.checkpoint_version, v_state.body_hash, 'LEASE_EXPIRED',
      jsonb_build_object('recovered_by', p_worker_id), p_now
    );
    update dlkt_info_private.source_acquisition_state
    set active_attempt_id = null, lease_owner = null, lease_expires_at = null,
      consecutive_failures = source_acquisition_state.consecutive_failures + 1, last_error_code = 'LEASE_EXPIRED'
    where source_acquisition_state.source_key = p_source_key
    returning * into v_state;
  end if;

  if v_state.next_eligible_at is not null and v_state.next_eligible_at > p_now then
    return query select false, 'interval', null::uuid, p_source_key, v_state.total_attempts,
      v_state.checkpoint_version, v_state.checkpoint, v_state.body_hash, v_state.etag,
      v_state.last_modified, null::timestamptz;
    return;
  end if;
  if v_state.attempts_today >= v_source.max_requests_per_day then
    return query select false, 'daily-limit', null::uuid, p_source_key, v_state.total_attempts,
      v_state.checkpoint_version, v_state.checkpoint, v_state.body_hash, v_state.etag,
      v_state.last_modified, null::timestamptz;
    return;
  end if;

  v_attempt_id := gen_random_uuid();
  update dlkt_info_private.source_acquisition_state
  set attempts_today = attempts_today + 1,
    total_attempts = total_attempts + 1,
    last_attempt_at = p_now,
    next_eligible_at = p_now + make_interval(secs => v_source.min_interval_seconds),
    active_attempt_id = v_attempt_id,
    lease_owner = p_worker_id,
    lease_expires_at = p_now + make_interval(secs => p_lease_seconds)
  where source_acquisition_state.source_key = p_source_key
  returning * into v_state;

  insert into dlkt_info_private.source_acquisition_events (
    source_key, attempt_id, worker_id, event_type, attempt_no, checkpoint_version,
    body_hash, metadata, occurred_at
  ) values (
    p_source_key, v_attempt_id, p_worker_id, 'reserved', v_state.total_attempts,
    v_state.checkpoint_version, v_state.body_hash,
    jsonb_build_object('lease_expires_at', v_state.lease_expires_at), p_now
  );

  return query select true, 'reserved', v_attempt_id, p_source_key, v_state.total_attempts,
    v_state.checkpoint_version, v_state.checkpoint, v_state.body_hash, v_state.etag,
    v_state.last_modified, v_state.lease_expires_at;
end;
$$;

create or replace function public.dlkt_info_complete_source_acquisition(
  p_source_key text,
  p_attempt_id uuid,
  p_worker_id text,
  p_outcome text,
  p_checkpoint_version integer default null,
  p_checkpoint jsonb default null,
  p_body_hash text default null,
  p_etag text default null,
  p_last_modified text default null,
  p_error_code text default null,
  p_now timestamptz default clock_timestamp()
)
returns table (
  source_key text,
  checkpoint_version integer,
  checkpoint jsonb,
  body_hash text,
  etag text,
  last_modified text,
  last_success_at timestamptz,
  consecutive_failures integer,
  next_eligible_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_state dlkt_info_private.source_acquisition_state%rowtype;
  v_event_type text;
begin
  perform dlkt_info_private.require_service_role();
  if p_source_key is null or p_attempt_id is null or p_worker_id is null or p_now is null
    or p_outcome not in ('modified', 'not_modified', 'failed')
    or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$' or length(p_worker_id) not between 3 and 160
    or (p_etag is not null and (p_etag <> btrim(p_etag) or length(p_etag) not between 1 and 512 or p_etag ~ '[[:cntrl:]]'))
    or (p_last_modified is not null and (p_last_modified <> btrim(p_last_modified) or length(p_last_modified) not between 1 and 512 or p_last_modified ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_ACQUISITION_COMPLETION_INVALID';
  end if;

  select * into v_state
  from dlkt_info_private.source_acquisition_state
  where source_acquisition_state.source_key = p_source_key
  for update;
  if not found or v_state.active_attempt_id is distinct from p_attempt_id
    or v_state.lease_owner is distinct from p_worker_id or v_state.lease_expires_at < p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_ACQUISITION_LEASE_INVALID';
  end if;

  if p_outcome = 'modified' then
    if p_checkpoint_version is null or p_checkpoint_version <= v_state.checkpoint_version
      or p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
      or octet_length(p_checkpoint::text) not between 2 and 2000000
      or p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$'
      or p_error_code is not null then
      raise exception using errcode = '22023', message = 'DLKT_INFO_ACQUISITION_CHECKPOINT_INVALID';
    end if;
    update dlkt_info_private.source_acquisition_state
    set checkpoint_version = p_checkpoint_version,
      checkpoint = p_checkpoint,
      body_hash = p_body_hash,
      etag = p_etag,
      last_modified = p_last_modified,
      last_success_at = p_now,
      active_attempt_id = null,
      lease_owner = null,
      lease_expires_at = null,
      consecutive_failures = 0,
      last_error_code = null
    where source_acquisition_state.source_key = p_source_key
    returning * into v_state;
    v_event_type := 'modified';
  elsif p_outcome = 'not_modified' then
    if v_state.checkpoint_version = 0 or v_state.checkpoint is null or p_error_code is not null then
      raise exception using errcode = '22023', message = 'DLKT_INFO_ACQUISITION_BASELINE_REQUIRED';
    end if;
    update dlkt_info_private.source_acquisition_state
    set etag = coalesce(p_etag, source_acquisition_state.etag),
      last_modified = coalesce(p_last_modified, source_acquisition_state.last_modified),
      last_success_at = p_now,
      active_attempt_id = null,
      lease_owner = null,
      lease_expires_at = null,
      consecutive_failures = 0,
      last_error_code = null
    where source_acquisition_state.source_key = p_source_key
    returning * into v_state;
    v_event_type := 'not_modified';
  else
    if p_error_code is null or p_error_code <> btrim(p_error_code)
      or length(p_error_code) not between 3 and 120 or p_error_code !~ '^[A-Z0-9_:-]+$'
      or p_checkpoint is not null or p_checkpoint_version is not null or p_body_hash is not null then
      raise exception using errcode = '22023', message = 'DLKT_INFO_ACQUISITION_ERROR_INVALID';
    end if;
    update dlkt_info_private.source_acquisition_state
    set active_attempt_id = null,
      lease_owner = null,
      lease_expires_at = null,
      consecutive_failures = source_acquisition_state.consecutive_failures + 1,
      last_error_code = p_error_code
    where source_acquisition_state.source_key = p_source_key
    returning * into v_state;
    v_event_type := 'failed';
  end if;

  insert into dlkt_info_private.source_acquisition_events (
    source_key, attempt_id, worker_id, event_type, attempt_no, checkpoint_version,
    body_hash, error_code, metadata, occurred_at
  ) values (
    p_source_key, p_attempt_id, p_worker_id, v_event_type, v_state.total_attempts,
    v_state.checkpoint_version, v_state.body_hash,
    case when v_event_type = 'failed' then p_error_code else null end,
    jsonb_build_object('etag_present', v_state.etag is not null, 'last_modified_present', v_state.last_modified is not null),
    p_now
  );

  return query select v_state.source_key, v_state.checkpoint_version, v_state.checkpoint,
    v_state.body_hash, v_state.etag, v_state.last_modified, v_state.last_success_at,
    v_state.consecutive_failures, v_state.next_eligible_at;
end;
$$;

create or replace function public.dlkt_info_read_source_acquisition(p_source_key text)
returns table (
  source_key text,
  checkpoint_version integer,
  checkpoint jsonb,
  body_hash text,
  etag text,
  last_modified text,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_eligible_at timestamptz,
  attempts_today integer,
  total_attempts bigint,
  consecutive_failures integer,
  last_error_code text
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public, dlkt_info_private
as $$
begin
  perform dlkt_info_private.require_service_role();
  return query
  select state.source_key, state.checkpoint_version, state.checkpoint, state.body_hash,
    state.etag, state.last_modified, state.last_attempt_at, state.last_success_at,
    state.next_eligible_at, state.attempts_today, state.total_attempts,
    state.consecutive_failures, state.last_error_code
  from dlkt_info_private.source_acquisition_state state
  where state.source_key = p_source_key;
end;
$$;

revoke all on table dlkt_info_private.source_acquisition_state from public, anon, authenticated;
revoke all on table dlkt_info_private.source_acquisition_events from public, anon, authenticated;
revoke all on function public.dlkt_info_reserve_source_acquisition(text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_read_source_acquisition(text) from public, anon, authenticated;
grant execute on function public.dlkt_info_reserve_source_acquisition(text, text, timestamptz, integer) to service_role;
grant execute on function public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamptz) to service_role;
grant execute on function public.dlkt_info_read_source_acquisition(text) to service_role;

commit;
