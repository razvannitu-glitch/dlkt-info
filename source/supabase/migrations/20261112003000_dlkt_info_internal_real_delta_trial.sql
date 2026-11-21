begin;

create table if not exists dlkt_info_private.internal_delta_jobs (
  id uuid primary key default gen_random_uuid(),
  source_batch_id uuid not null unique references dlkt_info_private.source_claim_batches(id) on delete restrict,
  source_key text not null,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default clock_timestamp(),
  trial_id uuid,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_internal_delta_jobs_source_check check (
    source_key = btrim(source_key) and length(source_key) between 1 and 120
    and source_key ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_internal_delta_jobs_status_check check (
    status in ('pending', 'claimed', 'retry', 'ready', 'empty', 'dead')
  ),
  constraint dlkt_info_internal_delta_jobs_attempt_check check (attempt_count between 0 and 5),
  constraint dlkt_info_internal_delta_jobs_lease_check check (
    (status = 'claimed' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'claimed' and lease_owner is null and lease_expires_at is null)
  ),
  constraint dlkt_info_internal_delta_jobs_worker_check check (
    lease_owner is null or (
      lease_owner = btrim(lease_owner) and length(lease_owner) between 3 and 160
      and lease_owner ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    )
  ),
  constraint dlkt_info_internal_delta_jobs_error_check check (
    last_error_code is null or (
      last_error_code = btrim(last_error_code) and length(last_error_code) between 3 and 120
      and last_error_code ~ '^[A-Z0-9_:-]+$'
    )
  )
);

create table if not exists dlkt_info_private.internal_delta_trials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references dlkt_info_private.internal_delta_jobs(id) on delete restrict,
  source_batch_id uuid not null unique references dlkt_info_private.source_claim_batches(id) on delete restrict,
  pack_id text not null,
  pack_version text not null,
  engine_version text not null,
  product_version text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  generated_at timestamptz not null,
  status text not null,
  payload_hash text not null unique,
  card_count smallint not null,
  pending_count smallint not null,
  approved_count smallint not null default 0,
  rejected_count smallint not null default 0,
  public_cards_created boolean not null default false,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_internal_delta_trials_pack_check check (
    pack_id = btrim(pack_id) and length(pack_id) between 3 and 120
    and pack_id ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_internal_delta_trials_version_check check (
    pack_version = btrim(pack_version) and length(pack_version) between 1 and 60
    and engine_version = btrim(engine_version) and length(engine_version) between 1 and 60
    and product_version = btrim(product_version) and length(product_version) between 1 and 60
  ),
  constraint dlkt_info_internal_delta_trials_window_check check (
    window_start < window_end and generated_at >= window_end - interval '5 minutes'
  ),
  constraint dlkt_info_internal_delta_trials_status_check check (
    status in ('ready_for_review', 'empty', 'approved', 'rejected', 'expired')
  ),
  constraint dlkt_info_internal_delta_trials_hash_check check (dlkt_info_private.is_sha256(payload_hash)),
  constraint dlkt_info_internal_delta_trials_counts_check check (
    card_count between 0 and 12
    and pending_count between 0 and card_count
    and approved_count between 0 and card_count
    and rejected_count between 0 and card_count
    and pending_count + approved_count + rejected_count = card_count
    and ((status = 'empty' and card_count = 0) or status <> 'empty')
  ),
  constraint dlkt_info_internal_delta_trials_publication_check check (public_cards_created = false)
);

alter table dlkt_info_private.internal_delta_jobs
  add constraint dlkt_info_internal_delta_jobs_trial_fk
  foreign key (trial_id) references dlkt_info_private.internal_delta_trials(id) on delete restrict;

create table if not exists dlkt_info_private.internal_delta_trial_cards (
  id uuid primary key default gen_random_uuid(),
  trial_id uuid not null references dlkt_info_private.internal_delta_trials(id) on delete restrict,
  position smallint not null,
  external_card_id text not null,
  delta_id text not null,
  topic_id text not null,
  entity_key text not null,
  entity_type text not null,
  entity_label text not null,
  kind text not null,
  title text not null,
  direct text not null,
  why_it_matters text not null,
  changed_since text not null,
  materiality text not null,
  trust text not null,
  score integer not null,
  blocked_dependencies text[] not null default '{}',
  sources jsonb not null,
  generated_at timestamptz not null,
  expires_at timestamptz,
  review_state text not null default 'pending',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_internal_delta_cards_position_check check (position between 1 and 12),
  constraint dlkt_info_internal_delta_cards_id_check check (
    external_card_id = btrim(external_card_id) and length(external_card_id) between 3 and 160
    and external_card_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    and delta_id = btrim(delta_id) and length(delta_id) between 3 and 160
    and delta_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_internal_delta_cards_topic_check check (
    topic_id = btrim(topic_id) and length(topic_id) between 1 and 100
    and topic_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_internal_delta_cards_entity_check check (
    entity_key = btrim(entity_key) and length(entity_key) between 1 and 180
    and entity_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    and entity_type = btrim(entity_type) and length(entity_type) between 1 and 60
    and entity_type ~ '^[a-z][a-z0-9-]+$'
    and entity_label = btrim(entity_label) and length(entity_label) between 1 and 200
    and entity_label !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_internal_delta_cards_kind_check check (kind in ('new', 'changed', 'resolved', 'conflicted')),
  constraint dlkt_info_internal_delta_cards_text_check check (
    title = btrim(title) and length(title) between 1 and 300 and title !~ '[[:cntrl:]]'
    and direct = btrim(direct) and length(direct) between 1 and 1000 and direct !~ '[[:cntrl:]]'
    and why_it_matters = btrim(why_it_matters) and length(why_it_matters) between 1 and 1000 and why_it_matters !~ '[[:cntrl:]]'
    and changed_since = btrim(changed_since) and length(changed_since) between 1 and 500 and changed_since !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_internal_delta_cards_materiality_check check (materiality in ('low', 'medium', 'high', 'critical')),
  constraint dlkt_info_internal_delta_cards_trust_check check (trust in ('confirmed', 'corroborated', 'single-source', 'conflicting')),
  constraint dlkt_info_internal_delta_cards_score_check check (score between -100000 and 100000),
  constraint dlkt_info_internal_delta_cards_dependencies_check check (
    dlkt_info_private.is_valid_text_set(blocked_dependencies, 100, 160)
  ),
  constraint dlkt_info_internal_delta_cards_sources_check check (
    jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 20
  ),
  constraint dlkt_info_internal_delta_cards_expiry_check check (
    expires_at is null or expires_at > generated_at
  ),
  constraint dlkt_info_internal_delta_cards_review_state_check check (
    review_state in ('pending', 'approved', 'rejected')
  ),
  constraint dlkt_info_internal_delta_cards_review_check check (
    (review_state = 'pending' and reviewed_by is null and reviewed_at is null and review_note is null)
    or (
      review_state in ('approved', 'rejected')
      and reviewed_by is not null and reviewed_at is not null and review_note is not null
      and reviewed_by ~ '^human:[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$'
      and review_note = btrim(review_note) and length(review_note) between 3 and 500
      and review_note !~ '[[:cntrl:]]'
    )
  ),
  unique (trial_id, position),
  unique (trial_id, external_card_id)
);

create table if not exists dlkt_info_private.internal_delta_trial_card_claims (
  card_id uuid not null references dlkt_info_private.internal_delta_trial_cards(id) on delete restrict,
  claim_id uuid not null references dlkt_info_private.claims(id) on delete restrict,
  relationship text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_internal_delta_trial_card_claims_relationship_check check (
    relationship in ('supports', 'contradicts', 'supersedes')
  ),
  primary key (card_id, claim_id, relationship)
);

create table if not exists dlkt_info_private.internal_delta_review_events (
  id bigint generated always as identity primary key,
  trial_id uuid not null references dlkt_info_private.internal_delta_trials(id) on delete restrict,
  card_id uuid references dlkt_info_private.internal_delta_trial_cards(id) on delete restrict,
  event_type text not null,
  actor text not null,
  note text not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_internal_delta_review_events_type_check check (
    event_type in ('trial_created', 'card_approved', 'card_rejected', 'trial_completed')
  ),
  constraint dlkt_info_internal_delta_review_events_actor_check check (
    actor = btrim(actor) and length(actor) between 3 and 160
    and actor ~ '^(worker|human):[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$'
  ),
  constraint dlkt_info_internal_delta_review_events_note_check check (
    note = btrim(note) and length(note) between 3 and 500 and note !~ '[[:cntrl:]]'
  )
);

create index if not exists dlkt_info_internal_delta_jobs_due_idx
  on dlkt_info_private.internal_delta_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'retry');
create index if not exists dlkt_info_internal_delta_trials_status_idx
  on dlkt_info_private.internal_delta_trials (status, created_at desc);
create index if not exists dlkt_info_internal_delta_review_events_trial_idx
  on dlkt_info_private.internal_delta_review_events (trial_id, occurred_at, id);

create trigger dlkt_info_internal_delta_jobs_touch
before update on dlkt_info_private.internal_delta_jobs
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_internal_delta_trials_touch
before update on dlkt_info_private.internal_delta_trials
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_internal_delta_trial_card_claims_immutable
before update or delete on dlkt_info_private.internal_delta_trial_card_claims
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_internal_delta_review_events_immutable
before update or delete on dlkt_info_private.internal_delta_review_events
for each row execute function dlkt_info_private.prevent_mutation();

create or replace function dlkt_info_private.enqueue_internal_delta_job()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, dlkt_info_private
as $$
begin
  if new.baseline = false and new.inserted_claims > 0 then
    insert into dlkt_info_private.internal_delta_jobs (source_batch_id, source_key, next_attempt_at)
    values (new.id, new.source_key, new.observed_at)
    on conflict (source_batch_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger dlkt_info_source_claim_batches_enqueue_internal_delta
  after insert on dlkt_info_private.source_claim_batches
  for each row execute function dlkt_info_private.enqueue_internal_delta_job();

insert into dlkt_info_private.internal_delta_jobs (source_batch_id, source_key, next_attempt_at)
select batch.id, batch.source_key, batch.observed_at
from dlkt_info_private.source_claim_batches batch
where batch.baseline = false and batch.inserted_claims > 0
on conflict (source_batch_id) do nothing;

create or replace function dlkt_info_private.internal_claim_payload(p_claim_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, dlkt_info_private
as $$
  select jsonb_build_object(
    'id', claim.id::text,
    'entity', jsonb_build_object(
      'id', entity.entity_key,
      'type', entity.entity_type,
      'label', entity.canonical_label
    ),
    'topicId', claim.topic_id,
    'kind', claim.kind,
    'predicate', claim.predicate,
    'value', claim.value,
    'materiality', claim.materiality,
    'actionability', claim.actionability::double precision,
    'observedAt', to_char(claim.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'effectiveAt', case when claim.effective_at is null then null else to_char(claim.effective_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'validFrom', to_char(claim.valid_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'validUntil', case when claim.valid_until is null then null else to_char(claim.valid_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'locale', claim.locale,
    'geography', claim.geography,
    'affects', to_jsonb(claim.affects),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'sourceId', registry.source_key,
        'url', evidence.url,
        'title', evidence.title,
        'retrievedAt', to_char(evidence.retrieved_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'publishedAt', case when evidence.published_at is null then null else to_char(evidence.published_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
        'contentHash', evidence.content_hash
      ) order by registry.source_key, evidence.url, evidence.content_hash)
      from dlkt_info_private.claim_evidence evidence
      join dlkt_info_private.source_registry registry on registry.id = evidence.source_revision_id
      where evidence.claim_id = claim.id
    ), '[]'::jsonb)
  )
  from dlkt_info_private.claims claim
  join dlkt_info_private.entities entity on entity.id = claim.entity_id
  where claim.id = p_claim_id
$$;

create or replace function public.dlkt_info_claim_internal_delta_jobs(
  p_worker_id text,
  p_limit integer default 10,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 180
)
returns table (
  job_id uuid,
  source_batch_id uuid,
  source_key text,
  observed_at timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  current_claims jsonb,
  previous_claims jsonb,
  attempt_no integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_job dlkt_info_private.internal_delta_jobs%rowtype;
  v_batch dlkt_info_private.source_claim_batches%rowtype;
  v_previous_observed_at timestamptz;
  v_current jsonb;
  v_previous jsonb;
begin
  perform dlkt_info_private.require_service_role();
  if p_worker_id is null or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
    or length(p_worker_id) not between 3 and 160
    or p_limit not between 1 and 50
    or p_now is null or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CLAIM_INVALID';
  end if;

  update dlkt_info_private.internal_delta_jobs job
  set status = case when job.attempt_count >= 5 then 'dead' else 'retry' end,
      lease_owner = null,
      lease_expires_at = null,
      next_attempt_at = case when job.attempt_count >= 5 then job.next_attempt_at else p_now + interval '5 minutes' end,
      last_error_code = 'LEASE_EXPIRED'
  where job.status = 'claimed' and job.lease_expires_at < p_now;

  for v_job in
    select job.*
    from dlkt_info_private.internal_delta_jobs job
    where job.status in ('pending', 'retry') and job.next_attempt_at <= p_now
    order by job.created_at, job.id
    for update skip locked
    limit p_limit
  loop
    select * into v_batch
    from dlkt_info_private.source_claim_batches batch
    where batch.id = v_job.source_batch_id;
    if not found or v_batch.baseline or v_batch.inserted_claims <= 0 then
      update dlkt_info_private.internal_delta_jobs
      set status = 'dead', last_error_code = 'SOURCE_BATCH_INVALID', lease_owner = null, lease_expires_at = null
      where id = v_job.id;
      continue;
    end if;

    update dlkt_info_private.internal_delta_jobs
    set status = 'claimed',
        attempt_count = attempt_count + 1,
        lease_owner = p_worker_id,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        last_error_code = null
    where id = v_job.id
    returning * into v_job;

    select max(previous_batch.observed_at) into v_previous_observed_at
    from dlkt_info_private.source_claim_batches previous_batch
    where previous_batch.source_key = v_batch.source_key
      and previous_batch.checkpoint_version < v_batch.checkpoint_version;

    select coalesce(jsonb_agg(dlkt_info_private.internal_claim_payload(item.claim_id) order by item.claim_id), '[]'::jsonb)
    into v_current
    from dlkt_info_private.source_claim_batch_items item
    where item.batch_id = v_batch.id and item.change_kind in ('new', 'changed');

    select coalesce(jsonb_agg(dlkt_info_private.internal_claim_payload(claim.supersedes_claim_id) order by claim.supersedes_claim_id), '[]'::jsonb)
    into v_previous
    from dlkt_info_private.source_claim_batch_items item
    join dlkt_info_private.claims claim on claim.id = item.claim_id
    where item.batch_id = v_batch.id
      and item.change_kind = 'changed'
      and claim.supersedes_claim_id is not null;

    job_id := v_job.id;
    source_batch_id := v_batch.id;
    source_key := v_batch.source_key;
    observed_at := v_batch.observed_at;
    window_start := coalesce(v_previous_observed_at, v_batch.observed_at - interval '1 day');
    window_end := v_batch.observed_at;
    current_claims := v_current;
    previous_claims := v_previous;
    attempt_no := v_job.attempt_count;
    lease_expires_at := v_job.lease_expires_at;
    return next;
  end loop;
end;
$$;

create or replace function public.dlkt_info_complete_internal_delta_trial(
  p_job_id uuid,
  p_worker_id text,
  p_pack_id text,
  p_pack_version text,
  p_engine_version text,
  p_product_version text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_payload_hash text,
  p_cards jsonb,
  p_card_claims jsonb,
  p_now timestamptz default clock_timestamp()
)
returns table (
  trial_id uuid,
  status text,
  card_count smallint,
  pending_count smallint,
  approved_count smallint,
  rejected_count smallint,
  public_cards_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_job dlkt_info_private.internal_delta_jobs%rowtype;
  v_trial dlkt_info_private.internal_delta_trials%rowtype;
  v_card jsonb;
  v_link jsonb;
  v_source jsonb;
  v_card_id uuid;
  v_claim_id uuid;
  v_claim_entity_key text;
  v_card_keys text[];
  v_link_keys text[];
  v_source_keys text[];
  v_expected_card_keys constant text[] := array[
    'blocked_dependencies','changed_since','created_at','delta_id','direct','entity_key','entity_label',
    'entity_type','expires_at','external_card_id','kind','materiality','position','score','sources',
    'title','topic_id','trust','why_it_matters'
  ];
  v_expected_link_keys constant text[] := array['claim_id','external_card_id','relationship'];
  v_expected_source_keys constant text[] := array['authority','retrievedAt','sourceId','title','url'];
  v_card_total integer;
  v_link_total integer;
begin
  perform dlkt_info_private.require_service_role();
  if p_job_id is null or p_worker_id is null
    or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$' or length(p_worker_id) not between 3 and 160
    or p_pack_id is null or p_pack_id !~ '^[a-z0-9][a-z0-9._:-]+$' or length(p_pack_id) > 120
    or p_pack_version is null or length(p_pack_version) not between 1 and 60
    or p_engine_version is null or length(p_engine_version) not between 1 and 60
    or p_product_version is null or length(p_product_version) not between 1 and 60
    or p_window_start is null or p_window_end is null or p_window_start >= p_window_end
    or p_window_end > p_now + interval '5 minutes'
    or p_payload_hash is null or p_payload_hash !~ '^[a-f0-9]{64}$'
    or p_cards is null or jsonb_typeof(p_cards) <> 'array' or jsonb_array_length(p_cards) > 12
    or p_card_claims is null or jsonb_typeof(p_card_claims) <> 'array' or jsonb_array_length(p_card_claims) > 120
    or p_now is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_COMPLETE_INVALID';
  end if;

  select * into v_job
  from dlkt_info_private.internal_delta_jobs job
  where job.id = p_job_id
  for update;
  if not found or v_job.status <> 'claimed' or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_expires_at < p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_INTERNAL_DELTA_LEASE_INVALID';
  end if;

  v_card_total := jsonb_array_length(p_cards);
  v_link_total := jsonb_array_length(p_card_claims);
  if (v_card_total = 0 and v_link_total <> 0) or (v_card_total > 0 and v_link_total = 0) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_LINKS_INVALID';
  end if;

  insert into dlkt_info_private.internal_delta_trials (
    job_id, source_batch_id, pack_id, pack_version, engine_version, product_version,
    window_start, window_end, generated_at, status, payload_hash, card_count, pending_count
  ) values (
    v_job.id, v_job.source_batch_id, p_pack_id, p_pack_version, p_engine_version, p_product_version,
    p_window_start, p_window_end, p_now,
    case when v_card_total = 0 then 'empty' else 'ready_for_review' end,
    p_payload_hash, v_card_total, v_card_total
  ) returning * into v_trial;

  for v_card in select value from jsonb_array_elements(p_cards)
  loop
    select array_agg(key order by key) into v_card_keys from jsonb_object_keys(v_card) key;
    if v_card_keys is distinct from v_expected_card_keys
      or jsonb_typeof(v_card -> 'position') <> 'number'
      or (v_card ->> 'position')::integer not between 1 and 12
      or coalesce(v_card ->> 'external_card_id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$'
      or coalesce(v_card ->> 'delta_id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$'
      or coalesce(v_card ->> 'topic_id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99}$'
      or coalesce(v_card ->> 'entity_key', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,179}$'
      or coalesce(v_card ->> 'entity_type', '') !~ '^[a-z][a-z0-9-]{0,59}$'
      or length(coalesce(v_card ->> 'entity_label', '')) not between 1 and 200
      or coalesce(v_card ->> 'kind', '') not in ('new', 'changed', 'resolved', 'conflicted')
      or length(coalesce(v_card ->> 'title', '')) not between 1 and 300
      or length(coalesce(v_card ->> 'direct', '')) not between 1 and 1000
      or length(coalesce(v_card ->> 'why_it_matters', '')) not between 1 and 1000
      or length(coalesce(v_card ->> 'changed_since', '')) not between 1 and 500
      or coalesce(v_card ->> 'materiality', '') not in ('low', 'medium', 'high', 'critical')
      or coalesce(v_card ->> 'trust', '') not in ('confirmed', 'corroborated', 'single-source', 'conflicting')
      or jsonb_typeof(v_card -> 'score') <> 'number'
      or (v_card ->> 'score')::integer not between -100000 and 100000
      or jsonb_typeof(v_card -> 'blocked_dependencies') <> 'array'
      or jsonb_array_length(v_card -> 'blocked_dependencies') > 100
      or jsonb_typeof(v_card -> 'sources') <> 'array'
      or jsonb_array_length(v_card -> 'sources') not between 1 and 20
      or (v_card ->> 'created_at')::timestamptz > p_now + interval '5 minutes'
      or (v_card -> 'expires_at' <> 'null'::jsonb and (v_card ->> 'expires_at')::timestamptz <= (v_card ->> 'created_at')::timestamptz) then
      raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CARD_INVALID';
    end if;

    for v_source in select value from jsonb_array_elements(v_card -> 'sources')
    loop
      select array_agg(key order by key) into v_source_keys from jsonb_object_keys(v_source) key;
      if v_source_keys is distinct from v_expected_source_keys
        or coalesce(v_source ->> 'sourceId', '') !~ '^[a-z0-9][a-z0-9._:-]{0,119}$'
        or length(coalesce(v_source ->> 'title', '')) not between 1 and 300
        or coalesce(v_source ->> 'title', '') ~ '[[:cntrl:]]'
        or length(coalesce(v_source ->> 'url', '')) not between 10 and 1800
        or coalesce(v_source ->> 'url', '') !~ '^https://'
        or coalesce(v_source ->> 'authority', '') not in ('official', 'primary', 'reputable-secondary', 'community', 'unknown')
        or length(coalesce(v_source ->> 'retrievedAt', '')) not between 20 and 40
        or (v_source ->> 'retrievedAt')::timestamptz > p_now + interval '5 minutes'
        or not exists (
          select 1
          from dlkt_info_private.source_registry registry
          cross join lateral jsonb_array_elements(registry.path_rules) rule
          where registry.source_key = v_source ->> 'sourceId'
            and registry.status = 'active' and registry.valid_until is null
            and registry.review_expires_at > p_now
            and registry.authority = v_source ->> 'authority'
            and left(v_source ->> 'url', length(registry.origin || coalesce(rule ->> 'pathnamePrefix', '')))
              = registry.origin || coalesce(rule ->> 'pathnamePrefix', '')
            and (
              (
                coalesce(jsonb_array_length(rule -> 'allowedQueryKeys'), 0) = 0
                and position('?' in (v_source ->> 'url')) = 0
              )
              or (
                rule -> 'allowedQueryKeys' = '["uri"]'::jsonb
                and rule -> 'requiredQueryKeys' = '["uri"]'::jsonb
                and (v_source ->> 'url') ~ '\?uri=[A-Za-z0-9%()./_:-]+$'
                and position('&' in (v_source ->> 'url')) = 0
                and position('#' in (v_source ->> 'url')) = 0
              )
            )
        ) then
        raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_SOURCE_INVALID';
      end if;
    end loop;

    insert into dlkt_info_private.internal_delta_trial_cards (
      trial_id, position, external_card_id, delta_id, topic_id, entity_key, entity_type, entity_label,
      kind, title, direct, why_it_matters, changed_since, materiality, trust, score,
      blocked_dependencies, sources, generated_at, expires_at
    ) values (
      v_trial.id,
      (v_card ->> 'position')::smallint,
      v_card ->> 'external_card_id',
      v_card ->> 'delta_id',
      v_card ->> 'topic_id',
      v_card ->> 'entity_key',
      v_card ->> 'entity_type',
      v_card ->> 'entity_label',
      v_card ->> 'kind',
      v_card ->> 'title',
      v_card ->> 'direct',
      v_card ->> 'why_it_matters',
      v_card ->> 'changed_since',
      v_card ->> 'materiality',
      v_card ->> 'trust',
      (v_card ->> 'score')::integer,
      array(select jsonb_array_elements_text(v_card -> 'blocked_dependencies')),
      v_card -> 'sources',
      (v_card ->> 'created_at')::timestamptz,
      case when v_card -> 'expires_at' = 'null'::jsonb then null else (v_card ->> 'expires_at')::timestamptz end
    ) returning id into v_card_id;
  end loop;

  for v_link in select value from jsonb_array_elements(p_card_claims)
  loop
    select array_agg(key order by key) into v_link_keys from jsonb_object_keys(v_link) key;
    if v_link_keys is distinct from v_expected_link_keys
      or coalesce(v_link ->> 'external_card_id', '') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]{2,159}$'
      or coalesce(v_link ->> 'claim_id', '') !~ '^[a-f0-9-]{36}$'
      or coalesce(v_link ->> 'relationship', '') not in ('supports', 'contradicts', 'supersedes') then
      raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CARD_LINK_INVALID';
    end if;

    select card.id into v_card_id
    from dlkt_info_private.internal_delta_trial_cards card
    where card.trial_id = v_trial.id and card.external_card_id = v_link ->> 'external_card_id';
    if not found then
      raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CARD_LINK_INVALID';
    end if;

    v_claim_id := (v_link ->> 'claim_id')::uuid;
    if not exists (
      select 1
      from dlkt_info_private.source_claim_batch_items item
      join dlkt_info_private.claims current_claim on current_claim.id = item.claim_id
      where item.batch_id = v_job.source_batch_id
        and (current_claim.id = v_claim_id or current_claim.supersedes_claim_id = v_claim_id)
    ) then
      raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CLAIM_SCOPE_INVALID';
    end if;

    select entity.entity_key into v_claim_entity_key
    from dlkt_info_private.claims claim
    join dlkt_info_private.entities entity on entity.id = claim.entity_id
    where claim.id = v_claim_id;
    if v_claim_entity_key is null or not exists (
      select 1 from dlkt_info_private.internal_delta_trial_cards card
      where card.id = v_card_id and card.entity_key = v_claim_entity_key
    ) then
      raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_ENTITY_SCOPE_INVALID';
    end if;

    insert into dlkt_info_private.internal_delta_trial_card_claims (card_id, claim_id, relationship)
    values (v_card_id, v_claim_id, v_link ->> 'relationship');
  end loop;

  if exists (
    select 1
    from dlkt_info_private.internal_delta_trial_cards card
    cross join lateral jsonb_array_elements(card.sources) source
    where card.trial_id = v_trial.id
      and not exists (
        select 1
        from dlkt_info_private.internal_delta_trial_card_claims link
        join dlkt_info_private.claim_evidence evidence on evidence.claim_id = link.claim_id
        join dlkt_info_private.source_registry registry on registry.id = evidence.source_revision_id
        where link.card_id = card.id
          and registry.source_key = source ->> 'sourceId'
          and evidence.url = source ->> 'url'
      )
  ) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_SOURCE_UNSUPPORTED';
  end if;

  if exists (
    select 1
    from dlkt_info_private.internal_delta_trial_cards card
    where card.trial_id = v_trial.id
      and not exists (
        select 1 from dlkt_info_private.internal_delta_trial_card_claims link where link.card_id = card.id
      )
  ) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_CARD_UNSUPPORTED';
  end if;

  insert into dlkt_info_private.internal_delta_review_events (
    trial_id, card_id, event_type, actor, note, occurred_at
  ) values (
    v_trial.id, null, 'trial_created', p_worker_id,
    case when v_card_total = 0 then 'Internal trial completed with no eligible delta.' else 'Internal trial awaits explicit human review.' end,
    p_now
  );

  update dlkt_info_private.internal_delta_jobs
  set status = case when v_card_total = 0 then 'empty' else 'ready' end,
      lease_owner = null,
      lease_expires_at = null,
      trial_id = v_trial.id,
      last_error_code = null
  where id = v_job.id;

  trial_id := v_trial.id;
  status := v_trial.status;
  card_count := v_trial.card_count;
  pending_count := v_trial.pending_count;
  approved_count := v_trial.approved_count;
  rejected_count := v_trial.rejected_count;
  public_cards_created := false;
  return next;
end;
$$;

create or replace function public.dlkt_info_fail_internal_delta_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_at timestamptz,
  p_now timestamptz default clock_timestamp()
)
returns table (
  job_id uuid,
  status text,
  attempt_count integer,
  next_attempt_at timestamptz,
  terminal boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_job dlkt_info_private.internal_delta_jobs%rowtype;
  v_terminal boolean;
begin
  perform dlkt_info_private.require_service_role();
  if p_job_id is null or p_worker_id is null
    or p_worker_id !~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$' or length(p_worker_id) not between 3 and 160
    or p_error_code is null or p_error_code !~ '^[A-Z0-9_:-]+$' or length(p_error_code) not between 3 and 120
    or p_retry_at is null or p_retry_at < p_now or p_retry_at > p_now + interval '24 hours'
    or p_now is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_FAILURE_INVALID';
  end if;

  select * into v_job
  from dlkt_info_private.internal_delta_jobs job
  where job.id = p_job_id
  for update;
  if not found or v_job.status <> 'claimed' or v_job.lease_owner is distinct from p_worker_id
    or v_job.lease_expires_at < p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_INTERNAL_DELTA_LEASE_INVALID';
  end if;

  v_terminal := v_job.attempt_count >= 5;
  update dlkt_info_private.internal_delta_jobs
  set status = case when v_terminal then 'dead' else 'retry' end,
      lease_owner = null,
      lease_expires_at = null,
      next_attempt_at = case when v_terminal then next_attempt_at else p_retry_at end,
      last_error_code = p_error_code
  where id = v_job.id
  returning * into v_job;

  job_id := v_job.id;
  status := v_job.status;
  attempt_count := v_job.attempt_count;
  next_attempt_at := v_job.next_attempt_at;
  terminal := v_terminal;
  return next;
end;
$$;

create or replace function public.dlkt_info_review_internal_delta_card(
  p_card_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text,
  p_now timestamptz default clock_timestamp()
)
returns table (
  trial_id uuid,
  trial_status text,
  card_id uuid,
  card_review_state text,
  pending_count smallint,
  approved_count smallint,
  rejected_count smallint,
  public_cards_created boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_card dlkt_info_private.internal_delta_trial_cards%rowtype;
  v_trial dlkt_info_private.internal_delta_trials%rowtype;
  v_pending integer;
  v_approved integer;
  v_rejected integer;
  v_status text;
begin
  perform dlkt_info_private.require_service_role();
  if p_card_id is null or p_decision is null or p_decision not in ('approved', 'rejected')
    or p_reviewer is null or p_reviewer !~ '^human:[a-zA-Z0-9][a-zA-Z0-9._:-]{2,120}$'
    or p_note is null or p_note <> btrim(p_note) or length(p_note) not between 3 and 500 or p_note ~ '[[:cntrl:]]'
    or p_now is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_DELTA_REVIEW_INVALID';
  end if;

  select * into v_card
  from dlkt_info_private.internal_delta_trial_cards card
  where card.id = p_card_id
  for update;
  if not found or v_card.review_state <> 'pending' then
    raise exception using errcode = '55000', message = 'DLKT_INFO_INTERNAL_DELTA_CARD_NOT_PENDING';
  end if;

  select * into v_trial
  from dlkt_info_private.internal_delta_trials trial
  where trial.id = v_card.trial_id
  for update;
  if not found or v_trial.status <> 'ready_for_review' or v_trial.public_cards_created then
    raise exception using errcode = '55000', message = 'DLKT_INFO_INTERNAL_DELTA_TRIAL_NOT_REVIEWABLE';
  end if;

  update dlkt_info_private.internal_delta_trial_cards
  set review_state = p_decision,
      reviewed_by = p_reviewer,
      reviewed_at = p_now,
      review_note = p_note
  where id = v_card.id
  returning * into v_card;

  insert into dlkt_info_private.internal_delta_review_events (
    trial_id, card_id, event_type, actor, note, occurred_at
  ) values (
    v_trial.id, v_card.id,
    case when p_decision = 'approved' then 'card_approved' else 'card_rejected' end,
    p_reviewer, p_note, p_now
  );

  select
    count(*) filter (where review_state = 'pending'),
    count(*) filter (where review_state = 'approved'),
    count(*) filter (where review_state = 'rejected')
  into v_pending, v_approved, v_rejected
  from dlkt_info_private.internal_delta_trial_cards
  where internal_delta_trial_cards.trial_id = v_trial.id;

  v_status := case
    when v_pending > 0 then 'ready_for_review'
    when v_approved > 0 then 'approved'
    else 'rejected'
  end;

  update dlkt_info_private.internal_delta_trials
  set status = v_status,
      pending_count = v_pending,
      approved_count = v_approved,
      rejected_count = v_rejected
  where id = v_trial.id
  returning * into v_trial;

  if v_pending = 0 then
    insert into dlkt_info_private.internal_delta_review_events (
      trial_id, card_id, event_type, actor, note, occurred_at
    ) values (
      v_trial.id, null, 'trial_completed', p_reviewer,
      case when v_approved > 0 then 'Internal review completed with approved candidates; publication remains blocked.' else 'Internal review completed with no approved candidates.' end,
      p_now
    );
  end if;

  trial_id := v_trial.id;
  trial_status := v_trial.status;
  card_id := v_card.id;
  card_review_state := v_card.review_state;
  pending_count := v_trial.pending_count;
  approved_count := v_trial.approved_count;
  rejected_count := v_trial.rejected_count;
  public_cards_created := false;
  return next;
end;
$$;


create or replace function public.dlkt_info_read_internal_delta_review_queue(
  p_limit integer default 20
)
returns table (
  card_id uuid,
  trial_id uuid,
  source_key text,
  generated_at timestamptz,
  card_position smallint,
  external_card_id text,
  delta_id text,
  topic_id text,
  entity_key text,
  entity_type text,
  entity_label text,
  kind text,
  title text,
  direct text,
  why_it_matters text,
  changed_since text,
  materiality text,
  trust text,
  score integer,
  blocked_dependencies text[],
  sources jsonb,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
begin
  perform dlkt_info_private.require_service_role();
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_INTERNAL_REVIEW_QUEUE_LIMIT_INVALID';
  end if;
  return query
  select
    card.id, trial.id, job.source_key, trial.generated_at, card.position,
    card.external_card_id, card.delta_id, card.topic_id, card.entity_key, card.entity_type,
    card.entity_label, card.kind, card.title, card.direct, card.why_it_matters,
    card.changed_since, card.materiality, card.trust, card.score,
    card.blocked_dependencies, card.sources, card.expires_at
  from dlkt_info_private.internal_delta_trial_cards card
  join dlkt_info_private.internal_delta_trials trial on trial.id = card.trial_id
  join dlkt_info_private.internal_delta_jobs job on job.id = trial.job_id
  where card.review_state = 'pending'
    and trial.status = 'ready_for_review'
    and trial.public_cards_created = false
  order by trial.generated_at, trial.id, card.position
  limit p_limit;
end;
$$;

alter table dlkt_info_private.internal_delta_jobs enable row level security;
alter table dlkt_info_private.internal_delta_trials enable row level security;
alter table dlkt_info_private.internal_delta_trial_cards enable row level security;
alter table dlkt_info_private.internal_delta_trial_card_claims enable row level security;
alter table dlkt_info_private.internal_delta_review_events enable row level security;

revoke all on dlkt_info_private.internal_delta_jobs from public, anon, authenticated;
revoke all on dlkt_info_private.internal_delta_trials from public, anon, authenticated;
revoke all on dlkt_info_private.internal_delta_trial_cards from public, anon, authenticated;
revoke all on dlkt_info_private.internal_delta_trial_card_claims from public, anon, authenticated;
revoke all on dlkt_info_private.internal_delta_review_events from public, anon, authenticated;

revoke all on function dlkt_info_private.enqueue_internal_delta_job() from public, anon, authenticated;
revoke all on function dlkt_info_private.internal_claim_payload(uuid) from public, anon, authenticated;
revoke all on function public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_read_internal_delta_review_queue(integer) from public, anon, authenticated;

revoke all on dlkt_info_private.internal_delta_jobs from service_role;
revoke all on dlkt_info_private.internal_delta_trials from service_role;
revoke all on dlkt_info_private.internal_delta_trial_cards from service_role;
revoke all on dlkt_info_private.internal_delta_trial_card_claims from service_role;
revoke all on dlkt_info_private.internal_delta_review_events from service_role;
revoke all on sequence dlkt_info_private.internal_delta_review_events_id_seq from service_role;

grant execute on function public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamptz, integer) to service_role;
grant execute on function public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamptz, timestamptz, text, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.dlkt_info_read_internal_delta_review_queue(integer) to service_role;

commit;
