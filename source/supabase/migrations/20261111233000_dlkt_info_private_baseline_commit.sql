begin;

create table if not exists dlkt_info_private.source_claim_batches (
  id uuid primary key default gen_random_uuid(),
  source_revision_id uuid not null references dlkt_info_private.source_registry(id),
  source_key text not null,
  attempt_id uuid not null unique,
  worker_id text not null,
  checkpoint_version integer not null,
  baseline boolean not null,
  body_hash text not null,
  observed_at timestamptz not null,
  claim_count integer not null,
  inserted_claims integer not null,
  existing_claims integer not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_source_claim_batches_source_check check (
    source_key = btrim(source_key) and length(source_key) between 1 and 120
    and source_key ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_source_claim_batches_worker_check check (
    worker_id = btrim(worker_id) and length(worker_id) between 3 and 160
    and worker_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_source_claim_batches_version_check check (checkpoint_version > 0),
  constraint dlkt_info_source_claim_batches_hash_check check (dlkt_info_private.is_sha256(body_hash)),
  constraint dlkt_info_source_claim_batches_counts_check check (
    claim_count between 0 and 200
    and inserted_claims between 0 and claim_count
    and existing_claims between 0 and claim_count
    and inserted_claims + existing_claims = claim_count
    and (not baseline or claim_count > 0)
  ),
  unique (source_key, checkpoint_version)
);

alter table dlkt_info_private.claims
  add column if not exists external_key text;

alter table dlkt_info_private.claims
  add constraint dlkt_info_claims_external_key_check check (
    external_key is null or (
      external_key = btrim(external_key)
      and length(external_key) between 3 and 160
      and external_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    )
  ) not valid;

alter table dlkt_info_private.claims
  validate constraint dlkt_info_claims_external_key_check;

create unique index if not exists dlkt_info_claims_external_key_uidx
  on dlkt_info_private.claims (external_key)
  where external_key is not null;

create table if not exists dlkt_info_private.source_claim_batch_items (
  batch_id uuid not null references dlkt_info_private.source_claim_batches(id),
  claim_id uuid not null references dlkt_info_private.claims(id),
  change_kind text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (batch_id, claim_id),
  constraint dlkt_info_source_claim_batch_items_kind_check check (change_kind in ('baseline', 'new', 'changed'))
);

create trigger dlkt_info_source_claim_batches_immutable
before update or delete on dlkt_info_private.source_claim_batches
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_source_claim_batch_items_immutable
before update or delete on dlkt_info_private.source_claim_batch_items
for each row execute function dlkt_info_private.prevent_mutation();

create or replace function public.dlkt_info_commit_source_acquisition(
  p_source_key text,
  p_attempt_id uuid,
  p_worker_id text,
  p_checkpoint_version integer,
  p_checkpoint jsonb,
  p_body_hash text,
  p_etag text,
  p_last_modified text,
  p_baseline boolean,
  p_claims jsonb,
  p_now timestamptz
)
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
  last_error_code text,
  batch_id uuid,
  claim_count integer,
  inserted_claims integer,
  existing_claims integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_state dlkt_info_private.source_acquisition_state%rowtype;
  v_source dlkt_info_private.source_registry%rowtype;
  v_batch_id uuid;
  v_claim jsonb;
  v_evidence jsonb;
  v_entity_id uuid;
  v_claim_id uuid;
  v_existing_claim_id uuid;
  v_supersedes_claim_id uuid;
  v_inserted integer := 0;
  v_existing integer := 0;
  v_claim_count integer;
  v_claim_ids uuid[] := '{}'::uuid[];
  v_change_kinds text[] := '{}'::text[];
  v_keys text[];
  v_evidence_keys text[];
  v_expected_claim_keys constant text[] := array[
    'actionability','affects','change_kind','effective_at','entity_key','entity_label','entity_type',
    'evidence','external_key','fingerprint','geography','kind','locale','materiality','observed_at',
    'predicate','supersedes_external_key','topic_id','valid_from','valid_until','value'
  ];
  v_expected_evidence_keys constant text[] := array[
    'content_hash','published_at','retrieved_at','source_id','title','url'
  ];
begin
  perform dlkt_info_private.require_service_role();
  if p_source_key is null or p_source_key !~ '^[a-z0-9][a-z0-9._:-]+$' or length(p_source_key) > 120
    or p_attempt_id is null or p_worker_id is null
    or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$' or length(p_worker_id) not between 3 and 160
    or p_checkpoint_version is null or p_checkpoint_version < 1
    or p_checkpoint is null or jsonb_typeof(p_checkpoint) <> 'object'
    or octet_length(p_checkpoint::text) not between 2 and 2000000
    or p_body_hash is null or p_body_hash !~ '^[a-f0-9]{64}$'
    or p_baseline is null or p_claims is null or jsonb_typeof(p_claims) <> 'array'
    or jsonb_array_length(p_claims) > 200 or p_now is null
    or (p_etag is not null and (p_etag <> btrim(p_etag) or length(p_etag) not between 1 and 512 or p_etag ~ '[[:cntrl:]]'))
    or (p_last_modified is not null and (p_last_modified <> btrim(p_last_modified) or length(p_last_modified) not between 1 and 512 or p_last_modified ~ '[[:cntrl:]]')) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_COMMIT_INVALID';
  end if;

  select * into v_source
  from dlkt_info_private.source_registry registry
  where registry.source_key = p_source_key and registry.status = 'active' and registry.valid_until is null
  order by registry.revision desc
  limit 1;
  if not found or v_source.review_expires_at <= p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_SOURCE_COMMIT_REGISTRY_INVALID';
  end if;

  select * into v_state
  from dlkt_info_private.source_acquisition_state state
  where state.source_key = p_source_key
  for update;
  if not found or v_state.active_attempt_id is distinct from p_attempt_id
    or v_state.lease_owner is distinct from p_worker_id or v_state.lease_expires_at < p_now
    or p_checkpoint_version <> v_state.checkpoint_version + 1
    or p_baseline <> (v_state.checkpoint_version = 0) then
    raise exception using errcode = '55000', message = 'DLKT_INFO_SOURCE_COMMIT_LEASE_INVALID';
  end if;

  v_claim_count := jsonb_array_length(p_claims);
  if p_baseline and v_claim_count = 0 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_COMMIT_BASELINE_EMPTY';
  end if;

  v_batch_id := gen_random_uuid();

  for v_claim in select value from jsonb_array_elements(p_claims) loop
    if jsonb_typeof(v_claim) <> 'object' then
      raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_CLAIM_INVALID';
    end if;
    select array_agg(key order by key) into v_keys from jsonb_object_keys(v_claim) key;
    if v_keys is distinct from v_expected_claim_keys
      or coalesce(v_claim ->> 'external_key', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$'
      or (v_claim -> 'supersedes_external_key' <> 'null'::jsonb
        and coalesce(v_claim ->> 'supersedes_external_key', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$')
      or coalesce(v_claim ->> 'change_kind', '') not in ('baseline','new','changed')
      or (p_baseline and v_claim ->> 'change_kind' <> 'baseline')
      or (not p_baseline and v_claim ->> 'change_kind' = 'baseline')
      or coalesce(v_claim ->> 'entity_key', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$'
      or coalesce(v_claim ->> 'entity_type', '') !~ '^[a-z][a-z0-9-]{0,59}$'
      or length(coalesce(v_claim ->> 'entity_label', '')) not between 1 and 200
      or coalesce(v_claim ->> 'topic_id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$'
      or coalesce(v_claim ->> 'kind', '') not in ('event','state','change','forecast','availability','price','regulation','release','opportunity')
      or length(coalesce(v_claim ->> 'predicate', '')) not between 1 and 180
      or jsonb_typeof(v_claim -> 'value') not in ('string','number','boolean','null','array')
      or coalesce(v_claim ->> 'materiality', '') not in ('low','medium','high','critical')
      or jsonb_typeof(v_claim -> 'actionability') <> 'number'
      or (v_claim ->> 'actionability')::numeric not between 0 and 1
      or coalesce(v_claim ->> 'locale', '') !~ '^[a-z]{2,3}(-[A-Z]{2})?$'
      or (v_claim -> 'geography' <> 'null'::jsonb and length(coalesce(v_claim ->> 'geography', '')) not between 1 and 120)
      or jsonb_typeof(v_claim -> 'affects') <> 'array' or jsonb_array_length(v_claim -> 'affects') > 32
      or coalesce(v_claim ->> 'fingerprint', '') !~ '^[a-f0-9]{64}$'
      or jsonb_typeof(v_claim -> 'evidence') <> 'array'
      or jsonb_array_length(v_claim -> 'evidence') not between 1 and 12 then
      raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_CLAIM_INVALID';
    end if;
    if exists (
      select 1 from jsonb_array_elements(v_claim -> 'affects') item
      where jsonb_typeof(item) <> 'string' or item #>> '{}' !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$'
    ) then
      raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_CLAIM_AFFECTS_INVALID';
    end if;

    begin
      perform (v_claim ->> 'observed_at')::timestamptz;
      perform (v_claim ->> 'valid_from')::timestamptz;
      if v_claim -> 'effective_at' <> 'null'::jsonb then perform (v_claim ->> 'effective_at')::timestamptz; end if;
      if v_claim -> 'valid_until' <> 'null'::jsonb then perform (v_claim ->> 'valid_until')::timestamptz; end if;
    exception when others then
      raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_CLAIM_TIME_INVALID';
    end;

    v_supersedes_claim_id := null;
    if v_claim -> 'supersedes_external_key' <> 'null'::jsonb then
      select id into v_supersedes_claim_id
      from dlkt_info_private.claims
      where external_key = v_claim ->> 'supersedes_external_key';
      if not found then
        raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_SUPERSEDES_MISSING';
      end if;
    end if;

    insert into dlkt_info_private.entities (entity_key, entity_type, canonical_label)
    values (v_claim ->> 'entity_key', v_claim ->> 'entity_type', v_claim ->> 'entity_label')
    on conflict (entity_key) do nothing;
    select id into v_entity_id from dlkt_info_private.entities where entity_key = v_claim ->> 'entity_key';
    if not found then raise exception using errcode = '55000', message = 'DLKT_INFO_SOURCE_ENTITY_MISSING'; end if;

    v_claim_id := null;
    insert into dlkt_info_private.claims (
      entity_id, topic_id, kind, predicate, value, materiality, actionability,
      observed_at, effective_at, valid_from, valid_until, locale, geography, affects,
      fingerprint, supersedes_claim_id, external_key
    ) values (
      v_entity_id, v_claim ->> 'topic_id', v_claim ->> 'kind', v_claim ->> 'predicate', v_claim -> 'value',
      v_claim ->> 'materiality', (v_claim ->> 'actionability')::numeric,
      (v_claim ->> 'observed_at')::timestamptz,
      case when v_claim -> 'effective_at' = 'null'::jsonb then null else (v_claim ->> 'effective_at')::timestamptz end,
      (v_claim ->> 'valid_from')::timestamptz,
      case when v_claim -> 'valid_until' = 'null'::jsonb then null else (v_claim ->> 'valid_until')::timestamptz end,
      v_claim ->> 'locale',
      case when v_claim -> 'geography' = 'null'::jsonb then null else v_claim ->> 'geography' end,
      array(select item #>> '{}' from jsonb_array_elements(v_claim -> 'affects') item),
      v_claim ->> 'fingerprint', v_supersedes_claim_id, v_claim ->> 'external_key'
    ) on conflict do nothing returning id into v_claim_id;

    if v_claim_id is null then
      select id into v_existing_claim_id
      from dlkt_info_private.claims
      where external_key = v_claim ->> 'external_key'
        and fingerprint = v_claim ->> 'fingerprint';
      if not found then
        raise exception using errcode = '55000', message = 'DLKT_INFO_SOURCE_CLAIM_CONFLICT';
      end if;
      v_claim_id := v_existing_claim_id;
      v_existing := v_existing + 1;
    else
      v_inserted := v_inserted + 1;
      for v_evidence in select value from jsonb_array_elements(v_claim -> 'evidence') loop
        if jsonb_typeof(v_evidence) <> 'object' then
          raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_EVIDENCE_INVALID';
        end if;
        select array_agg(key order by key) into v_evidence_keys from jsonb_object_keys(v_evidence) key;
        if v_evidence_keys is distinct from v_expected_evidence_keys
          or v_evidence ->> 'source_id' <> p_source_key
          or length(coalesce(v_evidence ->> 'url', '')) not between 10 and 1800
          or coalesce(v_evidence ->> 'url', '') !~ '^https://'
          or not exists (
            select 1
            from jsonb_array_elements(v_source.path_rules) rule
            where left(
              v_evidence ->> 'url',
              length(v_source.origin || coalesce(rule ->> 'pathnamePrefix', ''))
            ) = v_source.origin || coalesce(rule ->> 'pathnamePrefix', '')
              and (
                (
                  coalesce(jsonb_array_length(rule -> 'allowedQueryKeys'), 0) = 0
                  and position('?' in (v_evidence ->> 'url')) = 0
                )
                or (
                  rule -> 'allowedQueryKeys' = '["uri"]'::jsonb
                  and rule -> 'requiredQueryKeys' = '["uri"]'::jsonb
                  and (v_evidence ->> 'url') ~ '\?uri=[A-Za-z0-9%()./_:-]+$'
                  and position('&' in (v_evidence ->> 'url')) = 0
                  and position('#' in (v_evidence ->> 'url')) = 0
                )
              )
          )
          or length(coalesce(v_evidence ->> 'title', '')) not between 1 and 300
          or coalesce(v_evidence ->> 'content_hash', '') !~ '^[a-f0-9]{64}$' then
          raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_EVIDENCE_INVALID';
        end if;
        begin
          perform (v_evidence ->> 'retrieved_at')::timestamptz;
          if v_evidence -> 'published_at' <> 'null'::jsonb then perform (v_evidence ->> 'published_at')::timestamptz; end if;
        exception when others then
          raise exception using errcode = '22023', message = 'DLKT_INFO_SOURCE_EVIDENCE_TIME_INVALID';
        end;
        insert into dlkt_info_private.claim_evidence (
          claim_id, source_revision_id, url, title, retrieved_at, published_at, content_hash
        ) values (
          v_claim_id, v_source.id, v_evidence ->> 'url', v_evidence ->> 'title',
          (v_evidence ->> 'retrieved_at')::timestamptz,
          case when v_evidence -> 'published_at' = 'null'::jsonb then null else (v_evidence ->> 'published_at')::timestamptz end,
          v_evidence ->> 'content_hash'
        );
      end loop;
    end if;

    v_claim_ids := array_append(v_claim_ids, v_claim_id);
    v_change_kinds := array_append(v_change_kinds, v_claim ->> 'change_kind');
  end loop;

  insert into dlkt_info_private.source_claim_batches (
    id, source_revision_id, source_key, attempt_id, worker_id, checkpoint_version, baseline,
    body_hash, observed_at, claim_count, inserted_claims, existing_claims
  ) values (
    v_batch_id, v_source.id, p_source_key, p_attempt_id, p_worker_id, p_checkpoint_version, p_baseline,
    p_body_hash, p_now, v_claim_count, v_inserted, v_existing
  );

  insert into dlkt_info_private.source_claim_batch_items (batch_id, claim_id, change_kind)
  select v_batch_id, v_claim_ids[index], v_change_kinds[index]
  from generate_subscripts(v_claim_ids, 1) index;

  perform public.dlkt_info_complete_source_acquisition(
    p_source_key, p_attempt_id, p_worker_id, 'modified', p_checkpoint_version,
    p_checkpoint, p_body_hash, p_etag, p_last_modified, null, p_now
  );

  select * into v_state
  from dlkt_info_private.source_acquisition_state state
  where state.source_key = p_source_key;
  if not found then
    raise exception using errcode = '55000', message = 'DLKT_INFO_SOURCE_COMMIT_STATE_MISSING';
  end if;

  return query select
    v_state.source_key, v_state.checkpoint_version, v_state.checkpoint,
    v_state.body_hash, v_state.etag, v_state.last_modified,
    v_state.last_attempt_at, v_state.last_success_at, v_state.next_eligible_at,
    v_state.attempts_today, v_state.total_attempts, v_state.consecutive_failures,
    v_state.last_error_code, v_batch_id, v_claim_count, v_inserted, v_existing;
end;
$$;

revoke all on dlkt_info_private.source_claim_batches from public, anon, authenticated;
revoke all on dlkt_info_private.source_claim_batch_items from public, anon, authenticated;
grant select, insert on dlkt_info_private.source_claim_batches to service_role;
grant select, insert on dlkt_info_private.source_claim_batch_items to service_role;

revoke all on function public.dlkt_info_commit_source_acquisition(
  text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.dlkt_info_commit_source_acquisition(
  text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamptz
) to service_role;

commit;
