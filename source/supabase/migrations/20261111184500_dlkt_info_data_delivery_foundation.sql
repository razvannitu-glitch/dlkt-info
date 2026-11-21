begin;

create schema if not exists dlkt_info_private;
comment on schema dlkt_info_private is 'Server-only data and orchestration state for the independent DLKT Info product.';
revoke all on schema dlkt_info_private from public, anon, authenticated;
grant usage on schema dlkt_info_private to service_role;

create or replace function dlkt_info_private.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = pg_catalog
as $$
  select p_timezone is not null
    and length(p_timezone) between 1 and 64
    and exists (select 1 from pg_timezone_names where name = p_timezone);
$$;

create or replace function dlkt_info_private.is_valid_iso_weekdays(p_weekdays smallint[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_weekdays is not null
    and cardinality(p_weekdays) between 1 and 7
    and not exists (select 1 from unnest(p_weekdays) as day where day < 1 or day > 7)
    and cardinality(p_weekdays) = (select count(distinct day) from unnest(p_weekdays) as day);
$$;

create or replace function dlkt_info_private.is_valid_text_set(
  p_values text[],
  p_max_items integer default 100,
  p_max_length integer default 160
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_values is not null
    and cardinality(p_values) between 0 and p_max_items
    and not exists (
      select 1
      from unnest(p_values) as value
      where value is null
         or value <> btrim(value)
         or length(value) < 1
         or length(value) > p_max_length
         or value ~ '[[:cntrl:]]'
    )
    and cardinality(p_values) = (select count(distinct value) from unnest(p_values) as value);
$$;

create or replace function dlkt_info_private.is_valid_channels(p_channels text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_channels is not null
    and cardinality(p_channels) between 1 and 3
    and not exists (
      select 1 from unnest(p_channels) as channel
      where channel not in ('web', 'email', 'push')
    )
    and cardinality(p_channels) = (select count(distinct channel) from unnest(p_channels) as channel);
$$;

create or replace function dlkt_info_private.is_sha256(p_value text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_value is not null and p_value ~ '^[a-f0-9]{64}$';
$$;

create or replace function dlkt_info_private.clean_error_detail(p_value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_value is null then null
    else left(regexp_replace(p_value, '[[:cntrl:]]', ' ', 'g'), 500)
  end;
$$;

create or replace function public.dlkt_info_next_delivery_at(
  p_timezone text,
  p_local_time time without time zone,
  p_weekdays smallint[],
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_day date;
  v_candidate timestamptz;
  v_offset integer;
begin
  if not dlkt_info_private.is_valid_timezone(p_timezone)
     or p_local_time is null
     or not dlkt_info_private.is_valid_iso_weekdays(p_weekdays)
     or p_after is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_SCHEDULE_INVALID';
  end if;

  for v_offset in 0..8 loop
    v_day := ((p_after at time zone p_timezone)::date + v_offset);
    if extract(isodow from v_day)::smallint = any (p_weekdays) then
      v_candidate := (v_day + p_local_time) at time zone p_timezone;
      if v_candidate > p_after then
        return v_candidate;
      end if;
    end if;
  end loop;

  raise exception using errcode = '22023', message = 'DLKT_INFO_SCHEDULE_UNRESOLVED';
end;
$$;

create table if not exists public.dlkt_info_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  locale text not null default 'en',
  timezone text not null default 'UTC',
  plan text not null default 'free',
  onboarding_state text not null default 'new',
  data_region text not null default 'eu-central-1',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_profiles_display_name_check check (
    display_name is null or (display_name = btrim(display_name) and length(display_name) between 1 and 100 and display_name !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_profiles_locale_check check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  constraint dlkt_info_profiles_timezone_check check (dlkt_info_private.is_valid_timezone(timezone)),
  constraint dlkt_info_profiles_plan_check check (plan in ('free', 'pro', 'business', 'internal')),
  constraint dlkt_info_profiles_onboarding_check check (onboarding_state in ('new', 'configured', 'active', 'paused')),
  constraint dlkt_info_profiles_region_check check (data_region = 'eu-central-1')
);

create table if not exists public.dlkt_info_briefings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  timezone text not null default 'UTC',
  delivery_local_time time without time zone not null default time '08:00',
  weekdays smallint[] not null default array[1,2,3,4,5,6,7]::smallint[],
  max_cards smallint not null default 5,
  status text not null default 'draft',
  version bigint not null default 1,
  next_delivery_at timestamptz,
  last_scheduled_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_briefings_name_check check (
    name = btrim(name) and length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_briefings_timezone_check check (dlkt_info_private.is_valid_timezone(timezone)),
  constraint dlkt_info_briefings_weekdays_check check (dlkt_info_private.is_valid_iso_weekdays(weekdays)),
  constraint dlkt_info_briefings_card_limit_check check (max_cards between 1 and 12),
  constraint dlkt_info_briefings_status_check check (status in ('draft', 'active', 'paused', 'archived')),
  constraint dlkt_info_briefings_version_check check (version > 0),
  constraint dlkt_info_briefings_schedule_state_check check (
    (status = 'active' and next_delivery_at is not null) or status <> 'active'
  )
);

create unique index if not exists dlkt_info_briefings_owner_name_active_uidx
  on public.dlkt_info_briefings (owner_id, lower(name))
  where status <> 'archived';
create index if not exists dlkt_info_briefings_due_idx
  on public.dlkt_info_briefings (next_delivery_at, id)
  where status = 'active';

create table if not exists public.dlkt_info_interest_rules (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.dlkt_info_briefings(id) on delete cascade,
  name text not null,
  include_topics text[] not null default '{}',
  exclude_topics text[] not null default '{}',
  include_entities text[] not null default '{}',
  exclude_entities text[] not null default '{}',
  include_geographies text[] not null default '{}',
  languages text[] not null default array['en']::text[],
  min_materiality text not null default 'low',
  weight numeric(6,3) not null default 1,
  only_actionable boolean not null default false,
  is_enabled boolean not null default true,
  position smallint not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_interest_rules_name_check check (
    name = btrim(name) and length(name) between 1 and 80 and name !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_interest_rules_include_topics_check check (dlkt_info_private.is_valid_text_set(include_topics, 100, 100)),
  constraint dlkt_info_interest_rules_exclude_topics_check check (dlkt_info_private.is_valid_text_set(exclude_topics, 100, 100)),
  constraint dlkt_info_interest_rules_include_entities_check check (dlkt_info_private.is_valid_text_set(include_entities, 200, 160)),
  constraint dlkt_info_interest_rules_exclude_entities_check check (dlkt_info_private.is_valid_text_set(exclude_entities, 200, 160)),
  constraint dlkt_info_interest_rules_geographies_check check (dlkt_info_private.is_valid_text_set(include_geographies, 100, 100)),
  constraint dlkt_info_interest_rules_languages_check check (
    dlkt_info_private.is_valid_text_set(languages, 20, 12)
    and cardinality(languages) > 0
  ),
  constraint dlkt_info_interest_rules_materiality_check check (min_materiality in ('low', 'medium', 'high', 'critical')),
  constraint dlkt_info_interest_rules_weight_check check (weight between 0 and 20),
  constraint dlkt_info_interest_rules_position_check check (position between 1 and 100)
);

create unique index if not exists dlkt_info_interest_rules_position_uidx
  on public.dlkt_info_interest_rules (briefing_id, position);

create table if not exists public.dlkt_info_delivery_endpoints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  label text not null,
  destination_hash text not null,
  state text not null default 'pending',
  verified_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_delivery_endpoints_channel_check check (channel in ('email', 'push')),
  constraint dlkt_info_delivery_endpoints_label_check check (
    label = btrim(label) and length(label) between 1 and 80 and label !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_delivery_endpoints_hash_check check (dlkt_info_private.is_sha256(destination_hash)),
  constraint dlkt_info_delivery_endpoints_state_check check (state in ('pending', 'verified', 'disabled', 'revoked')),
  constraint dlkt_info_delivery_endpoints_verified_check check (
    (state = 'verified' and verified_at is not null) or state <> 'verified'
  )
);

create unique index if not exists dlkt_info_delivery_endpoints_identity_uidx
  on public.dlkt_info_delivery_endpoints (owner_id, channel, destination_hash);

create table if not exists dlkt_info_private.delivery_endpoint_secrets (
  endpoint_id uuid constraint dlkt_info_delivery_endpoint_secrets_pkey primary key references public.dlkt_info_delivery_endpoints(id) on delete cascade,
  secret_ref text not null,
  secret_version integer not null default 1,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_delivery_endpoint_secrets_ref_check check (
    secret_ref = btrim(secret_ref) and length(secret_ref) between 3 and 255
    and secret_ref ~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$'
  ),
  constraint dlkt_info_delivery_endpoint_secrets_version_check check (secret_version > 0)
);

create table if not exists public.dlkt_info_briefing_targets (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.dlkt_info_briefings(id) on delete cascade,
  channel text not null,
  endpoint_id uuid references public.dlkt_info_delivery_endpoints(id) on delete cascade,
  is_enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_briefing_targets_channel_check check (channel in ('web', 'email', 'push')),
  constraint dlkt_info_briefing_targets_endpoint_check check (
    (channel = 'web' and endpoint_id is null)
    or (channel in ('email', 'push') and endpoint_id is not null)
  )
);

create unique index if not exists dlkt_info_briefing_targets_identity_uidx
  on public.dlkt_info_briefing_targets (
    briefing_id,
    channel,
    coalesce(endpoint_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create table if not exists public.dlkt_info_user_memory (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  memory_key text not null,
  memory_type text not null,
  state jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_user_memory_key_check check (
    memory_key = btrim(memory_key) and length(memory_key) between 1 and 180
    and memory_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_user_memory_type_check check (
    memory_type in ('followed-entity', 'pinned-topic', 'dismissed-card', 'preference', 'reading-state')
  ),
  constraint dlkt_info_user_memory_state_check check (jsonb_typeof(state) = 'object')
);

create unique index if not exists dlkt_info_user_memory_identity_uidx
  on public.dlkt_info_user_memory (owner_id, memory_key);
create index if not exists dlkt_info_user_memory_expiry_idx
  on public.dlkt_info_user_memory (expires_at)
  where expires_at is not null;

create table if not exists dlkt_info_private.source_registry (
  id uuid primary key default gen_random_uuid(),
  source_key text not null,
  revision integer not null,
  supersedes_id uuid references dlkt_info_private.source_registry(id),
  name text not null,
  origin text not null,
  authority text not null,
  role text not null,
  languages text[] not null,
  path_rules jsonb not null,
  automated_access text not null,
  factual_extraction text not null,
  commercial_summaries text not null,
  attribution_required boolean not null,
  terms_url text,
  reviewed_at timestamptz not null,
  review_expires_at timestamptz not null,
  note text not null,
  min_interval_seconds integer not null,
  max_requests_per_day integer not null,
  timeout_ms integer not null,
  max_bytes integer not null,
  status text not null default 'active',
  valid_from timestamptz not null default clock_timestamp(),
  valid_until timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_source_key_check check (
    source_key = btrim(source_key) and length(source_key) between 1 and 120
    and source_key ~ '^[a-z0-9][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_source_revision_check check (revision > 0),
  constraint dlkt_info_source_name_check check (name = btrim(name) and length(name) between 1 and 160 and name !~ '[[:cntrl:]]'),
  constraint dlkt_info_source_origin_check check (
    origin = btrim(origin) and length(origin) between 10 and 300
    and origin ~ '^https://[A-Za-z0-9.-]+$'
  ),
  constraint dlkt_info_source_authority_check check (authority in ('official', 'primary', 'reputable-secondary', 'community', 'unknown')),
  constraint dlkt_info_source_role_check check (role in ('regulator', 'government', 'company', 'publisher', 'public-data', 'community', 'social')),
  constraint dlkt_info_source_languages_check check (dlkt_info_private.is_valid_text_set(languages, 30, 12) and cardinality(languages) > 0),
  constraint dlkt_info_source_path_rules_check check (jsonb_typeof(path_rules) = 'array' and jsonb_array_length(path_rules) between 1 and 100),
  constraint dlkt_info_source_rights_check check (
    automated_access in ('permitted', 'attribution-required', 'permission-required', 'subscription-required', 'blocked', 'unreviewed')
    and factual_extraction in ('permitted', 'attribution-required', 'permission-required', 'subscription-required', 'blocked', 'unreviewed')
    and commercial_summaries in ('permitted', 'attribution-required', 'permission-required', 'subscription-required', 'blocked', 'unreviewed')
  ),
  constraint dlkt_info_source_terms_url_check check (
    terms_url is null or (terms_url = btrim(terms_url) and length(terms_url) <= 1800 and terms_url ~ '^https://')
  ),
  constraint dlkt_info_source_review_window_check check (review_expires_at > reviewed_at),
  constraint dlkt_info_source_note_check check (note = btrim(note) and length(note) between 1 and 1000 and note !~ '[[:cntrl:]]'),
  constraint dlkt_info_source_limits_check check (
    min_interval_seconds between 1 and 86400
    and max_requests_per_day between 1 and 100000
    and timeout_ms between 100 and 60000
    and max_bytes between 1024 and 104857600
  ),
  constraint dlkt_info_source_status_check check (status in ('active', 'blocked', 'retired')),
  constraint dlkt_info_source_validity_check check (valid_until is null or valid_until > valid_from),
  unique (source_key, revision)
);

create unique index if not exists dlkt_info_source_registry_current_uidx
  on dlkt_info_private.source_registry (source_key)
  where status = 'active' and valid_until is null;

create table if not exists dlkt_info_private.entities (
  id uuid primary key default gen_random_uuid(),
  entity_key text not null unique,
  entity_type text not null,
  canonical_label text not null,
  aliases text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_entities_key_check check (
    entity_key = btrim(entity_key) and length(entity_key) between 1 and 180
    and entity_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_entities_type_check check (
    entity_type = btrim(entity_type) and length(entity_type) between 1 and 60
    and entity_type ~ '^[a-z][a-z0-9-]+$'
  ),
  constraint dlkt_info_entities_label_check check (
    canonical_label = btrim(canonical_label) and length(canonical_label) between 1 and 200
    and canonical_label !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_entities_aliases_check check (dlkt_info_private.is_valid_text_set(aliases, 100, 200)),
  constraint dlkt_info_entities_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists dlkt_info_private.claims (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references dlkt_info_private.entities(id),
  topic_id text not null,
  kind text not null,
  predicate text not null,
  value jsonb not null,
  materiality text not null,
  actionability numeric(5,4) not null,
  observed_at timestamptz not null,
  effective_at timestamptz,
  valid_from timestamptz not null,
  valid_until timestamptz,
  locale text not null,
  geography text,
  affects text[] not null default '{}',
  fingerprint text not null,
  supersedes_claim_id uuid references dlkt_info_private.claims(id),
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_claims_topic_check check (
    topic_id = btrim(topic_id) and length(topic_id) between 1 and 100
    and topic_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_claims_kind_check check (kind in ('event', 'state', 'change', 'forecast', 'availability', 'price', 'regulation', 'release', 'opportunity')),
  constraint dlkt_info_claims_predicate_check check (predicate = btrim(predicate) and length(predicate) between 1 and 180 and predicate !~ '[[:cntrl:]]'),
  constraint dlkt_info_claims_value_check check (jsonb_typeof(value) in ('string', 'number', 'boolean', 'null', 'array')),
  constraint dlkt_info_claims_materiality_check check (materiality in ('low', 'medium', 'high', 'critical')),
  constraint dlkt_info_claims_actionability_check check (actionability between 0 and 1),
  constraint dlkt_info_claims_time_check check (
    observed_at <= clock_timestamp() + interval '5 minutes'
    and (valid_until is null or valid_until > valid_from)
  ),
  constraint dlkt_info_claims_locale_check check (locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'),
  constraint dlkt_info_claims_geography_check check (
    geography is null or (geography = btrim(geography) and length(geography) between 1 and 120 and geography !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_claims_affects_check check (dlkt_info_private.is_valid_text_set(affects, 100, 160)),
  constraint dlkt_info_claims_fingerprint_check check (dlkt_info_private.is_sha256(fingerprint)),
  unique (fingerprint)
);

create index if not exists dlkt_info_claims_current_idx
  on dlkt_info_private.claims (topic_id, entity_id, predicate, valid_from desc)
  where valid_until is null;

create table if not exists dlkt_info_private.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references dlkt_info_private.claims(id) on delete restrict,
  source_revision_id uuid not null references dlkt_info_private.source_registry(id) on delete restrict,
  url text not null,
  title text not null,
  retrieved_at timestamptz not null,
  published_at timestamptz,
  content_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_claim_evidence_url_check check (
    url = btrim(url) and length(url) between 10 and 1800 and url ~ '^https://'
    and url !~ '[[:space:]@#]'
  ),
  constraint dlkt_info_claim_evidence_title_check check (title = btrim(title) and length(title) between 1 and 300 and title !~ '[[:cntrl:]]'),
  constraint dlkt_info_claim_evidence_time_check check (
    retrieved_at <= clock_timestamp() + interval '5 minutes'
    and (published_at is null or published_at <= retrieved_at + interval '5 minutes')
  ),
  constraint dlkt_info_claim_evidence_hash_check check (dlkt_info_private.is_sha256(content_hash)),
  unique (claim_id, source_revision_id, url, content_hash)
);

create table if not exists public.dlkt_info_briefing_runs (
  id uuid primary key default gen_random_uuid(),
  briefing_id uuid not null references public.dlkt_info_briefings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  scheduled_for timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  generated_at timestamptz,
  status text not null default 'queued',
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  engine_version text,
  product_version text,
  idempotency_key text not null,
  payload_hash text,
  card_count smallint not null default 0,
  contested_count smallint not null default 0,
  omitted_count smallint not null default 0,
  error_code text,
  error_detail text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_briefing_runs_window_check check (window_start < window_end and window_end = scheduled_for),
  constraint dlkt_info_briefing_runs_status_check check (status in ('queued', 'claimed', 'generating', 'ready', 'empty', 'failed', 'cancelled')),
  constraint dlkt_info_briefing_runs_lease_check check (
    (status in ('claimed', 'generating') and lease_owner is not null and lease_until is not null)
    or status not in ('claimed', 'generating')
  ),
  constraint dlkt_info_briefing_runs_attempt_check check (attempt_count between 0 and 10),
  constraint dlkt_info_briefing_runs_idempotency_check check (dlkt_info_private.is_sha256(idempotency_key)),
  constraint dlkt_info_briefing_runs_payload_hash_check check (payload_hash is null or dlkt_info_private.is_sha256(payload_hash)),
  constraint dlkt_info_briefing_runs_counts_check check (
    card_count between 0 and 12 and contested_count between 0 and 12 and omitted_count between 0 and 32767
  ),
  constraint dlkt_info_briefing_runs_error_code_check check (
    error_code is null or (error_code = btrim(error_code) and length(error_code) between 1 and 80 and error_code ~ '^[A-Z0-9_:-]+$')
  ),
  constraint dlkt_info_briefing_runs_error_detail_check check (error_detail is null or length(error_detail) <= 500),
  unique (briefing_id, scheduled_for),
  unique (idempotency_key)
);

create index if not exists dlkt_info_briefing_runs_owner_idx
  on public.dlkt_info_briefing_runs (owner_id, scheduled_for desc);
create index if not exists dlkt_info_briefing_runs_lease_idx
  on public.dlkt_info_briefing_runs (lease_until)
  where status in ('claimed', 'generating');

create table if not exists public.dlkt_info_briefing_cards (
  id uuid primary key default gen_random_uuid(),
  external_card_id text not null,
  run_id uuid not null references public.dlkt_info_briefing_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  position smallint not null,
  delta_id text not null,
  topic_id text not null,
  entity_key text not null,
  kind text not null,
  title text not null,
  direct text not null,
  why_it_matters text not null,
  changed_since text not null,
  materiality text not null,
  trust text not null,
  score numeric(12,3) not null,
  blocked_dependencies text[] not null default '{}',
  sources jsonb not null,
  created_at timestamptz not null,
  expires_at timestamptz,
  constraint dlkt_info_briefing_cards_external_id_check check (
    external_card_id = btrim(external_card_id) and length(external_card_id) between 1 and 160
    and external_card_id ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]+$'
  ),
  constraint dlkt_info_briefing_cards_position_check check (position between 1 and 12),
  constraint dlkt_info_briefing_cards_delta_check check (delta_id = btrim(delta_id) and length(delta_id) between 1 and 160),
  constraint dlkt_info_briefing_cards_topic_check check (topic_id = btrim(topic_id) and length(topic_id) between 1 and 100),
  constraint dlkt_info_briefing_cards_entity_check check (entity_key = btrim(entity_key) and length(entity_key) between 1 and 180),
  constraint dlkt_info_briefing_cards_kind_check check (kind in ('new', 'changed', 'resolved', 'conflicted')),
  constraint dlkt_info_briefing_cards_text_check check (
    title = btrim(title) and length(title) between 1 and 300 and title !~ '[[:cntrl:]]'
    and direct = btrim(direct) and length(direct) between 1 and 1000 and direct !~ '[[:cntrl:]]'
    and why_it_matters = btrim(why_it_matters) and length(why_it_matters) between 1 and 1000 and why_it_matters !~ '[[:cntrl:]]'
    and changed_since = btrim(changed_since) and length(changed_since) between 1 and 500 and changed_since !~ '[[:cntrl:]]'
  ),
  constraint dlkt_info_briefing_cards_materiality_check check (materiality in ('low', 'medium', 'high', 'critical')),
  constraint dlkt_info_briefing_cards_trust_check check (trust in ('confirmed', 'corroborated', 'single-source', 'conflicting')),
  constraint dlkt_info_briefing_cards_score_check check (score between -100000 and 100000),
  constraint dlkt_info_briefing_cards_dependencies_check check (dlkt_info_private.is_valid_text_set(blocked_dependencies, 100, 160)),
  constraint dlkt_info_briefing_cards_sources_check check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) between 1 and 20),
  constraint dlkt_info_briefing_cards_expiry_check check (expires_at is null or expires_at > created_at),
  unique (run_id, position),
  unique (run_id, external_card_id)
);

create table if not exists dlkt_info_private.briefing_card_claims (
  card_id uuid not null references public.dlkt_info_briefing_cards(id) on delete cascade,
  claim_id uuid not null references dlkt_info_private.claims(id) on delete restrict,
  relationship text not null default 'supports',
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_briefing_card_claims_relationship_check check (relationship in ('supports', 'contradicts', 'supersedes')),
  primary key (card_id, claim_id, relationship)
);

create table if not exists dlkt_info_private.delivery_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.dlkt_info_briefing_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  channel text not null,
  endpoint_id uuid not null references public.dlkt_info_delivery_endpoints(id) on delete restrict,
  idempotency_key text not null unique,
  payload_hash text not null,
  status text not null default 'pending',
  available_at timestamptz not null default clock_timestamp(),
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_delivery_outbox_channel_check check (channel in ('email', 'push')),
  constraint dlkt_info_delivery_outbox_hashes_check check (
    dlkt_info_private.is_sha256(idempotency_key) and dlkt_info_private.is_sha256(payload_hash)
  ),
  constraint dlkt_info_delivery_outbox_status_check check (status in ('pending', 'claimed', 'retry', 'delivered', 'dead', 'cancelled')),
  constraint dlkt_info_delivery_outbox_lease_check check (
    (status = 'claimed' and lease_owner is not null and lease_until is not null)
    or status <> 'claimed'
  ),
  constraint dlkt_info_delivery_outbox_attempt_check check (
    attempt_count between 0 and 20 and max_attempts between 1 and 20 and attempt_count <= max_attempts
  ),
  constraint dlkt_info_delivery_outbox_error_check check (
    last_error_code is null or (last_error_code = btrim(last_error_code) and length(last_error_code) between 1 and 80 and last_error_code ~ '^[A-Z0-9_:-]+$')
  ),
  unique (run_id, channel, endpoint_id)
);

create index if not exists dlkt_info_delivery_outbox_due_idx
  on dlkt_info_private.delivery_outbox (available_at, id)
  where status in ('pending', 'retry');
create index if not exists dlkt_info_delivery_outbox_lease_idx
  on dlkt_info_private.delivery_outbox (lease_until)
  where status = 'claimed';

create table if not exists public.dlkt_info_delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references dlkt_info_private.delivery_outbox(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  attempt_no integer not null,
  channel text not null,
  status text not null,
  provider_message_id text,
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  attempted_at timestamptz not null default clock_timestamp(),
  delivered_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint dlkt_info_delivery_receipts_attempt_check check (attempt_no between 1 and 20),
  constraint dlkt_info_delivery_receipts_channel_check check (channel in ('email', 'push')),
  constraint dlkt_info_delivery_receipts_status_check check (status in ('delivered', 'failed', 'dead')),
  constraint dlkt_info_delivery_receipts_provider_check check (
    provider_message_id is null or (provider_message_id = btrim(provider_message_id) and length(provider_message_id) between 1 and 255 and provider_message_id !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_delivery_receipts_error_check check (
    error_code is null or (error_code = btrim(error_code) and length(error_code) between 1 and 80 and error_code ~ '^[A-Z0-9_:-]+$')
  ),
  constraint dlkt_info_delivery_receipts_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint dlkt_info_delivery_receipts_delivered_check check (
    (status = 'delivered' and delivered_at is not null and error_code is null)
    or (status <> 'delivered' and delivered_at is null)
  ),
  unique (outbox_id, attempt_no)
);

create index if not exists dlkt_info_delivery_receipts_owner_idx
  on public.dlkt_info_delivery_receipts (owner_id, attempted_at desc);

create table if not exists public.dlkt_info_briefing_events (
  id bigint generated always as identity primary key,
  run_id uuid references public.dlkt_info_briefing_runs(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  event_at timestamptz not null default clock_timestamp(),
  actor_type text not null,
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  constraint dlkt_info_briefing_events_type_check check (
    event_type = btrim(event_type) and length(event_type) between 1 and 100
    and event_type ~ '^[a-z][a-z0-9._:-]+$'
  ),
  constraint dlkt_info_briefing_events_actor_check check (actor_type in ('user', 'worker', 'system', 'provider')),
  constraint dlkt_info_briefing_events_actor_id_check check (
    actor_id is null or (actor_id = btrim(actor_id) and length(actor_id) between 1 and 160 and actor_id !~ '[[:cntrl:]]')
  ),
  constraint dlkt_info_briefing_events_payload_check check (jsonb_typeof(payload) = 'object'),
  constraint dlkt_info_briefing_events_hash_check check (dlkt_info_private.is_sha256(payload_hash))
);

create index if not exists dlkt_info_briefing_events_owner_idx
  on public.dlkt_info_briefing_events (owner_id, event_at desc);

create or replace function dlkt_info_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function dlkt_info_private.prevent_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception using errcode = '55000', message = 'DLKT_INFO_APPEND_ONLY';
end;
$$;

create or replace function dlkt_info_private.hash_text(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select encode(sha256(convert_to(p_value, 'UTF8')), 'hex');
$$;

create or replace function dlkt_info_private.append_event(
  p_run_id uuid,
  p_owner_id uuid,
  p_event_type text,
  p_actor_type text,
  p_actor_id text,
  p_payload jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_id bigint;
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
begin
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'DLKT_INFO_EVENT_PAYLOAD_INVALID';
  end if;

  insert into public.dlkt_info_briefing_events (
    run_id, owner_id, event_type, actor_type, actor_id, payload, payload_hash
  ) values (
    p_run_id,
    p_owner_id,
    p_event_type,
    p_actor_type,
    p_actor_id,
    v_payload,
    dlkt_info_private.hash_text(v_payload::text)
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function dlkt_info_private.require_service_role()
returns void
language plpgsql
stable
set search_path = pg_catalog, auth
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'DLKT_INFO_SERVICE_ROLE_REQUIRED';
  end if;
end;
$$;

create or replace function dlkt_info_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_name text;
  v_locale text;
  v_timezone text;
begin
  v_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), '');
  if v_name is not null and (length(v_name) > 100 or v_name ~ '[[:cntrl:]]') then
    v_name := null;
  end if;

  v_locale := coalesce(nullif(new.raw_user_meta_data ->> 'locale', ''), 'en');
  if v_locale !~ '^[a-z]{2,3}(-[A-Z]{2})?$' then
    v_locale := 'en';
  end if;

  v_timezone := coalesce(nullif(new.raw_user_meta_data ->> 'timezone', ''), 'UTC');
  if not dlkt_info_private.is_valid_timezone(v_timezone) then
    v_timezone := 'UTC';
  end if;

  insert into public.dlkt_info_profiles (id, display_name, locale, timezone)
  values (new.id, v_name, v_locale, v_timezone)
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function dlkt_info_private.protect_profile_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, auth
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.plan <> 'free' or new.onboarding_state <> 'new' or new.data_region <> 'eu-central-1' then
        raise exception using errcode = '42501', message = 'DLKT_INFO_PROFILE_SYSTEM_FIELDS_FORBIDDEN';
      end if;
    elsif new.id <> old.id
       or new.plan <> old.plan
       or new.onboarding_state <> old.onboarding_state
       or new.data_region <> old.data_region then
      raise exception using errcode = '42501', message = 'DLKT_INFO_PROFILE_SYSTEM_FIELDS_FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

create or replace function dlkt_info_private.protect_briefing_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, auth
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then
      new.version := 1;
      new.next_delivery_at := null;
      new.last_scheduled_at := null;
    elsif new.id <> old.id
       or new.owner_id <> old.owner_id
       or new.version <> old.version
       or new.next_delivery_at is distinct from old.next_delivery_at
       or new.last_scheduled_at is distinct from old.last_scheduled_at then
      raise exception using errcode = '42501', message = 'DLKT_INFO_BRIEFING_SYSTEM_FIELDS_FORBIDDEN';
    end if;
  end if;
  return new;
end;
$$;

create or replace function dlkt_info_private.protect_endpoint_system_fields()
returns trigger
language plpgsql
set search_path = pg_catalog, auth
as $$
begin
  if coalesce(auth.role(), '') = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.state <> 'pending' or new.verified_at is not null then
        raise exception using errcode = '42501', message = 'DLKT_INFO_ENDPOINT_SYSTEM_FIELDS_FORBIDDEN';
      end if;
    else
      if new.id <> old.id
         or new.owner_id <> old.owner_id
         or new.channel <> old.channel
         or new.destination_hash <> old.destination_hash
         or new.verified_at is distinct from old.verified_at
         or new.state not in (old.state, 'disabled', 'revoked') then
        raise exception using errcode = '42501', message = 'DLKT_INFO_ENDPOINT_SYSTEM_FIELDS_FORBIDDEN';
      end if;
    end if;
  end if;
  return new;
end;
$$;

create or replace function dlkt_info_private.set_briefing_schedule()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_changed := new.name is distinct from old.name
      or new.timezone is distinct from old.timezone
      or new.delivery_local_time is distinct from old.delivery_local_time
      or new.weekdays is distinct from old.weekdays
      or new.max_cards is distinct from old.max_cards
      or new.status is distinct from old.status;
    if v_changed then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;

  if new.status = 'active' then
    if tg_op = 'INSERT'
       or new.next_delivery_at is null
       or new.status is distinct from old.status
       or new.timezone is distinct from old.timezone
       or new.delivery_local_time is distinct from old.delivery_local_time
       or new.weekdays is distinct from old.weekdays then
      new.next_delivery_at := public.dlkt_info_next_delivery_at(
        new.timezone,
        new.delivery_local_time,
        new.weekdays,
        clock_timestamp()
      );
    end if;
  else
    new.next_delivery_at := null;
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create or replace function dlkt_info_private.ensure_default_web_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
begin
  insert into public.dlkt_info_briefing_targets (briefing_id, channel, endpoint_id, is_enabled)
  values (new.id, 'web', null, true)
  on conflict do nothing;
  return new;
end;
$$;

create or replace function dlkt_info_private.validate_briefing_target()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_owner_id uuid;
  v_endpoint_owner uuid;
  v_endpoint_channel text;
begin
  select owner_id into v_owner_id
  from public.dlkt_info_briefings
  where id = new.briefing_id;

  if v_owner_id is null then
    raise exception using errcode = '23503', message = 'DLKT_INFO_BRIEFING_NOT_FOUND';
  end if;

  if new.channel = 'web' then
    if new.endpoint_id is not null then
      raise exception using errcode = '23514', message = 'DLKT_INFO_WEB_ENDPOINT_FORBIDDEN';
    end if;
    return new;
  end if;

  select owner_id, channel into v_endpoint_owner, v_endpoint_channel
  from public.dlkt_info_delivery_endpoints
  where id = new.endpoint_id;

  if v_endpoint_owner is null
     or v_endpoint_owner <> v_owner_id
     or v_endpoint_channel <> new.channel then
    raise exception using errcode = '23514', message = 'DLKT_INFO_TARGET_ENDPOINT_MISMATCH';
  end if;

  return new;
end;
$$;

create or replace function dlkt_info_private.set_run_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from public.dlkt_info_briefings
  where id = new.briefing_id;

  if v_owner_id is null then
    raise exception using errcode = '23503', message = 'DLKT_INFO_BRIEFING_NOT_FOUND';
  end if;

  if tg_op = 'UPDATE' and (new.briefing_id <> old.briefing_id or new.owner_id <> old.owner_id) then
    raise exception using errcode = '55000', message = 'DLKT_INFO_RUN_IDENTITY_IMMUTABLE';
  end if;

  new.owner_id := v_owner_id;
  new.updated_at := clock_timestamp();
  new.error_detail := dlkt_info_private.clean_error_detail(new.error_detail);
  return new;
end;
$$;

create or replace function dlkt_info_private.set_card_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id
  from public.dlkt_info_briefing_runs
  where id = new.run_id;

  if v_owner_id is null then
    raise exception using errcode = '23503', message = 'DLKT_INFO_RUN_NOT_FOUND';
  end if;

  new.owner_id := v_owner_id;
  return new;
end;
$$;

create or replace function dlkt_info_private.set_receipt_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private
as $$
declare
  v_owner_id uuid;
  v_channel text;
begin
  select owner_id, channel into v_owner_id, v_channel
  from dlkt_info_private.delivery_outbox
  where id = new.outbox_id;

  if v_owner_id is null then
    raise exception using errcode = '23503', message = 'DLKT_INFO_OUTBOX_NOT_FOUND';
  end if;

  new.owner_id := v_owner_id;
  new.channel := v_channel;
  return new;
end;
$$;

create trigger dlkt_info_profiles_protect_system_fields
before insert or update on public.dlkt_info_profiles
for each row execute function dlkt_info_private.protect_profile_system_fields();

create trigger dlkt_info_profiles_touch
before update on public.dlkt_info_profiles
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_briefings_protect_system_fields
before insert or update on public.dlkt_info_briefings
for each row execute function dlkt_info_private.protect_briefing_system_fields();

create trigger dlkt_info_briefings_schedule
before insert or update on public.dlkt_info_briefings
for each row execute function dlkt_info_private.set_briefing_schedule();

create trigger dlkt_info_briefings_default_web_target
after insert on public.dlkt_info_briefings
for each row execute function dlkt_info_private.ensure_default_web_target();

create trigger dlkt_info_interest_rules_touch
before update on public.dlkt_info_interest_rules
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_delivery_endpoints_protect_system_fields
before insert or update on public.dlkt_info_delivery_endpoints
for each row execute function dlkt_info_private.protect_endpoint_system_fields();

create trigger dlkt_info_delivery_endpoints_touch
before update on public.dlkt_info_delivery_endpoints
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_briefing_targets_validate
before insert or update on public.dlkt_info_briefing_targets
for each row execute function dlkt_info_private.validate_briefing_target();

create trigger dlkt_info_briefing_targets_touch
before update on public.dlkt_info_briefing_targets
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_user_memory_touch
before update on public.dlkt_info_user_memory
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_delivery_endpoint_secrets_touch
before update on dlkt_info_private.delivery_endpoint_secrets
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_entities_touch
before update on dlkt_info_private.entities
for each row execute function dlkt_info_private.touch_updated_at();

create trigger dlkt_info_briefing_runs_owner
before insert or update on public.dlkt_info_briefing_runs
for each row execute function dlkt_info_private.set_run_owner();

create trigger dlkt_info_briefing_cards_owner
before insert on public.dlkt_info_briefing_cards
for each row execute function dlkt_info_private.set_card_owner();

create trigger dlkt_info_delivery_receipts_owner
before insert on public.dlkt_info_delivery_receipts
for each row execute function dlkt_info_private.set_receipt_owner();

create trigger dlkt_info_claims_append_only
before update or delete on dlkt_info_private.claims
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_claim_evidence_append_only
before update or delete on dlkt_info_private.claim_evidence
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_briefing_cards_append_only
before update or delete on public.dlkt_info_briefing_cards
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_card_claims_append_only
before update or delete on dlkt_info_private.briefing_card_claims
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_delivery_receipts_append_only
before update or delete on public.dlkt_info_delivery_receipts
for each row execute function dlkt_info_private.prevent_mutation();

create trigger dlkt_info_briefing_events_append_only
before update or delete on public.dlkt_info_briefing_events
for each row execute function dlkt_info_private.prevent_mutation();

drop trigger if exists on_auth_user_created_dlkt_info on auth.users;
create trigger on_auth_user_created_dlkt_info
after insert on auth.users
for each row execute function dlkt_info_private.handle_new_user();

alter table public.dlkt_info_profiles enable row level security;
alter table public.dlkt_info_profiles force row level security;
alter table public.dlkt_info_briefings enable row level security;
alter table public.dlkt_info_briefings force row level security;
alter table public.dlkt_info_interest_rules enable row level security;
alter table public.dlkt_info_interest_rules force row level security;
alter table public.dlkt_info_delivery_endpoints enable row level security;
alter table public.dlkt_info_delivery_endpoints force row level security;
alter table public.dlkt_info_briefing_targets enable row level security;
alter table public.dlkt_info_briefing_targets force row level security;
alter table public.dlkt_info_user_memory enable row level security;
alter table public.dlkt_info_user_memory force row level security;
alter table public.dlkt_info_briefing_runs enable row level security;
alter table public.dlkt_info_briefing_runs force row level security;
alter table public.dlkt_info_briefing_cards enable row level security;
alter table public.dlkt_info_briefing_cards force row level security;
alter table public.dlkt_info_delivery_receipts enable row level security;
alter table public.dlkt_info_delivery_receipts force row level security;
alter table public.dlkt_info_briefing_events enable row level security;
alter table public.dlkt_info_briefing_events force row level security;

create policy dlkt_info_profiles_select_own
on public.dlkt_info_profiles for select
to authenticated
using (id = auth.uid());

create policy dlkt_info_profiles_insert_own
on public.dlkt_info_profiles for insert
to authenticated
with check (id = auth.uid());

create policy dlkt_info_profiles_update_own
on public.dlkt_info_profiles for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy dlkt_info_briefings_select_own
on public.dlkt_info_briefings for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_briefings_insert_own
on public.dlkt_info_briefings for insert
to authenticated
with check (owner_id = auth.uid());

create policy dlkt_info_briefings_update_own
on public.dlkt_info_briefings for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy dlkt_info_briefings_delete_own
on public.dlkt_info_briefings for delete
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_interest_rules_select_own
on public.dlkt_info_interest_rules for select
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_interest_rules_insert_own
on public.dlkt_info_interest_rules for insert
to authenticated
with check (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_interest_rules_update_own
on public.dlkt_info_interest_rules for update
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_interest_rules_delete_own
on public.dlkt_info_interest_rules for delete
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_delivery_endpoints_select_own
on public.dlkt_info_delivery_endpoints for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_delivery_endpoints_insert_own
on public.dlkt_info_delivery_endpoints for insert
to authenticated
with check (owner_id = auth.uid());

create policy dlkt_info_delivery_endpoints_update_own
on public.dlkt_info_delivery_endpoints for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy dlkt_info_delivery_endpoints_delete_own
on public.dlkt_info_delivery_endpoints for delete
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_briefing_targets_select_own
on public.dlkt_info_briefing_targets for select
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_briefing_targets_insert_own
on public.dlkt_info_briefing_targets for insert
to authenticated
with check (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_briefing_targets_update_own
on public.dlkt_info_briefing_targets for update
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
))
with check (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_briefing_targets_delete_own
on public.dlkt_info_briefing_targets for delete
to authenticated
using (exists (
  select 1 from public.dlkt_info_briefings briefing
  where briefing.id = briefing_id and briefing.owner_id = auth.uid()
));

create policy dlkt_info_user_memory_select_own
on public.dlkt_info_user_memory for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_user_memory_insert_own
on public.dlkt_info_user_memory for insert
to authenticated
with check (owner_id = auth.uid());

create policy dlkt_info_user_memory_update_own
on public.dlkt_info_user_memory for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy dlkt_info_user_memory_delete_own
on public.dlkt_info_user_memory for delete
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_briefing_runs_select_own
on public.dlkt_info_briefing_runs for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_briefing_cards_select_own
on public.dlkt_info_briefing_cards for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_delivery_receipts_select_own
on public.dlkt_info_delivery_receipts for select
to authenticated
using (owner_id = auth.uid());

create policy dlkt_info_briefing_events_select_own
on public.dlkt_info_briefing_events for select
to authenticated
using (owner_id = auth.uid());

create or replace function public.dlkt_info_claim_due_briefings(
  p_worker_id text,
  p_limit integer default 20,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 120
)
returns table (
  run_id uuid,
  briefing_id uuid,
  owner_id uuid,
  scheduled_for timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  attempt_no integer,
  max_cards smallint
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_briefing public.dlkt_info_briefings%rowtype;
  v_run public.dlkt_info_briefing_runs%rowtype;
  v_inserted boolean;
begin
  perform dlkt_info_private.require_service_role();
  if p_worker_id is null or p_worker_id <> btrim(p_worker_id) or length(p_worker_id) not between 3 and 160
     or p_worker_id ~ '[[:cntrl:]]'
     or p_limit not between 1 and 100
     or p_lease_seconds not between 30 and 900
     or p_now is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_CLAIM_INPUT_INVALID';
  end if;

  for v_briefing in
    select briefing.*
    from public.dlkt_info_briefings briefing
    where briefing.status = 'active'
      and briefing.next_delivery_at <= p_now
    order by briefing.next_delivery_at, briefing.id
    for update skip locked
    limit p_limit
  loop
    v_inserted := true;
    insert into public.dlkt_info_briefing_runs (
      briefing_id,
      owner_id,
      scheduled_for,
      window_start,
      window_end,
      status,
      lease_owner,
      lease_until,
      attempt_count,
      idempotency_key
    ) values (
      v_briefing.id,
      v_briefing.owner_id,
      v_briefing.next_delivery_at,
      v_briefing.next_delivery_at - interval '24 hours',
      v_briefing.next_delivery_at,
      'claimed',
      p_worker_id,
      p_now + make_interval(secs => p_lease_seconds),
      1,
      dlkt_info_private.hash_text(v_briefing.id::text || '|' || v_briefing.next_delivery_at::text)
    )
    on conflict do nothing
    returning * into v_run;

    if not found then
      v_inserted := false;
      select * into v_run
      from public.dlkt_info_briefing_runs existing
      where existing.briefing_id = v_briefing.id
        and existing.scheduled_for = v_briefing.next_delivery_at
      for update;

      if v_run.status = 'queued' and v_run.attempt_count < 5 then
        update public.dlkt_info_briefing_runs
        set status = 'claimed',
            lease_owner = p_worker_id,
            lease_until = p_now + make_interval(secs => p_lease_seconds),
            attempt_count = attempt_count + 1,
            error_code = null,
            error_detail = null
        where id = v_run.id
        returning * into v_run;
        v_inserted := true;
      end if;
    end if;

    update public.dlkt_info_briefings
    set last_scheduled_at = v_briefing.next_delivery_at,
        next_delivery_at = public.dlkt_info_next_delivery_at(
          v_briefing.timezone,
          v_briefing.delivery_local_time,
          v_briefing.weekdays,
          v_briefing.next_delivery_at + interval '1 second'
        )
    where id = v_briefing.id;

    if v_inserted then
      perform dlkt_info_private.append_event(
        v_run.id,
        v_run.owner_id,
        'run.claimed',
        'worker',
        p_worker_id,
        jsonb_build_object('scheduledFor', v_run.scheduled_for, 'attempt', v_run.attempt_count)
      );

      run_id := v_run.id;
      briefing_id := v_run.briefing_id;
      owner_id := v_run.owner_id;
      scheduled_for := v_run.scheduled_for;
      window_start := v_run.window_start;
      window_end := v_run.window_end;
      attempt_no := v_run.attempt_count;
      max_cards := v_briefing.max_cards;
      return next;
    end if;
  end loop;
end;
$$;

create or replace function public.dlkt_info_claim_queued_runs(
  p_worker_id text,
  p_limit integer default 20,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 120
)
returns table (
  run_id uuid,
  briefing_id uuid,
  owner_id uuid,
  scheduled_for timestamptz,
  window_start timestamptz,
  window_end timestamptz,
  attempt_no integer,
  max_cards smallint
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_run public.dlkt_info_briefing_runs%rowtype;
  v_max_cards smallint;
begin
  perform dlkt_info_private.require_service_role();
  if p_worker_id is null or p_worker_id <> btrim(p_worker_id) or length(p_worker_id) not between 3 and 160
     or p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_CLAIM_INPUT_INVALID';
  end if;

  for v_run in
    select run.*
    from public.dlkt_info_briefing_runs run
    where run.status = 'queued' and run.attempt_count < 5
    order by run.scheduled_for, run.id
    for update skip locked
    limit p_limit
  loop
    update public.dlkt_info_briefing_runs
    set status = 'claimed',
        lease_owner = p_worker_id,
        lease_until = p_now + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1,
        error_code = null,
        error_detail = null
    where id = v_run.id
    returning * into v_run;

    select briefing.max_cards into v_max_cards
    from public.dlkt_info_briefings briefing
    where briefing.id = v_run.briefing_id;

    perform dlkt_info_private.append_event(
      v_run.id,
      v_run.owner_id,
      'run.reclaimed',
      'worker',
      p_worker_id,
      jsonb_build_object('attempt', v_run.attempt_count)
    );

    run_id := v_run.id;
    briefing_id := v_run.briefing_id;
    owner_id := v_run.owner_id;
    scheduled_for := v_run.scheduled_for;
    window_start := v_run.window_start;
    window_end := v_run.window_end;
    attempt_no := v_run.attempt_count;
    max_cards := v_max_cards;
    return next;
  end loop;
end;
$$;

create or replace function public.dlkt_info_finalize_run(
  p_run_id uuid,
  p_worker_id text,
  p_briefing jsonb,
  p_engine_version text,
  p_product_version text,
  p_payload_hash text,
  p_now timestamptz default clock_timestamp()
)
returns table (
  run_id uuid,
  status text,
  card_count smallint,
  contested_count smallint,
  omitted_count smallint,
  outbox_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_run public.dlkt_info_briefing_runs%rowtype;
  v_cards jsonb;
  v_card jsonb;
  v_sources jsonb;
  v_position integer := 0;
  v_card_count integer := 0;
  v_contested integer := 0;
  v_omitted integer := 0;
  v_outbox integer := 0;
  v_target record;
begin
  perform dlkt_info_private.require_service_role();
  if p_run_id is null
     or p_worker_id is null or p_worker_id <> btrim(p_worker_id) or length(p_worker_id) not between 3 and 160
     or p_engine_version is null or length(p_engine_version) not between 1 and 40
     or p_product_version is null or length(p_product_version) not between 1 and 40
     or not dlkt_info_private.is_sha256(p_payload_hash)
     or jsonb_typeof(p_briefing) <> 'object' then
    raise exception using errcode = '22023', message = 'DLKT_INFO_FINALIZE_INPUT_INVALID';
  end if;

  select * into v_run
  from public.dlkt_info_briefing_runs run
  where run.id = p_run_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'DLKT_INFO_RUN_NOT_FOUND';
  end if;

  if v_run.status in ('ready', 'empty') then
    if v_run.payload_hash = p_payload_hash then
      return query
      select v_run.id, v_run.status, v_run.card_count, v_run.contested_count, v_run.omitted_count, 0;
      return;
    end if;
    raise exception using errcode = '55000', message = 'DLKT_INFO_RUN_ALREADY_FINALIZED';
  end if;

  if v_run.status not in ('claimed', 'generating')
     or v_run.lease_owner <> p_worker_id
     or v_run.lease_until <= p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_RUN_LEASE_INVALID';
  end if;

  if p_briefing ->> 'definitionId' <> v_run.briefing_id::text then
    raise exception using errcode = '22023', message = 'DLKT_INFO_DEFINITION_MISMATCH';
  end if;

  v_cards := p_briefing -> 'cards';
  if jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) > 12 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_CARDS_INVALID';
  end if;

  if exists (select 1 from public.dlkt_info_briefing_cards card where card.run_id = v_run.id) then
    raise exception using errcode = '55000', message = 'DLKT_INFO_RUN_CARDS_EXIST';
  end if;

  for v_card in select value from jsonb_array_elements(v_cards)
  loop
    v_position := v_position + 1;
    v_sources := v_card -> 'sources';
    if jsonb_typeof(v_card) <> 'object'
       or jsonb_typeof(v_card -> 'entity') <> 'object'
       or jsonb_typeof(v_sources) <> 'array'
       or jsonb_array_length(v_sources) < 1
       or jsonb_array_length(v_sources) > 20
       or jsonb_typeof(coalesce(v_card -> 'blockedDependencies', '[]'::jsonb)) <> 'array' then
      raise exception using errcode = '22023', message = 'DLKT_INFO_CARD_INVALID';
    end if;

    insert into public.dlkt_info_briefing_cards (
      external_card_id,
      run_id,
      owner_id,
      position,
      delta_id,
      topic_id,
      entity_key,
      kind,
      title,
      direct,
      why_it_matters,
      changed_since,
      materiality,
      trust,
      score,
      blocked_dependencies,
      sources,
      created_at,
      expires_at
    ) values (
      v_card ->> 'id',
      v_run.id,
      v_run.owner_id,
      v_position,
      v_card ->> 'deltaId',
      v_card ->> 'topicId',
      v_card #>> '{entity,id}',
      v_card ->> 'kind',
      v_card ->> 'title',
      v_card ->> 'direct',
      v_card ->> 'whyItMatters',
      v_card ->> 'changedSince',
      v_card ->> 'materiality',
      v_card ->> 'trust',
      (v_card ->> 'score')::numeric,
      array(select jsonb_array_elements_text(coalesce(v_card -> 'blockedDependencies', '[]'::jsonb))),
      v_sources,
      coalesce(nullif(v_card ->> 'createdAt', '')::timestamptz, p_now),
      nullif(v_card ->> 'expiresAt', '')::timestamptz
    );
  end loop;

  v_card_count := jsonb_array_length(v_cards);
  select count(*) into v_contested
  from jsonb_array_elements(v_cards) as card
  where card ->> 'trust' = 'conflicting';

  v_omitted := greatest(0, coalesce((p_briefing ->> 'omittedByLimit')::integer, 0));

  update public.dlkt_info_briefing_runs
  set status = case when v_card_count = 0 then 'empty' else 'ready' end,
      generated_at = p_now,
      lease_owner = null,
      lease_until = null,
      engine_version = p_engine_version,
      product_version = p_product_version,
      payload_hash = p_payload_hash,
      card_count = v_card_count,
      contested_count = v_contested,
      omitted_count = v_omitted,
      error_code = null,
      error_detail = null
  where id = v_run.id
  returning * into v_run;

  for v_target in
    select target.channel, target.endpoint_id
    from public.dlkt_info_briefing_targets target
    join public.dlkt_info_delivery_endpoints endpoint
      on endpoint.id = target.endpoint_id
     and endpoint.owner_id = v_run.owner_id
     and endpoint.channel = target.channel
     and endpoint.state = 'verified'
    where target.briefing_id = v_run.briefing_id
      and target.is_enabled
      and target.channel in ('email', 'push')
  loop
    insert into dlkt_info_private.delivery_outbox (
      run_id,
      owner_id,
      channel,
      endpoint_id,
      idempotency_key,
      payload_hash,
      available_at
    ) values (
      v_run.id,
      v_run.owner_id,
      v_target.channel,
      v_target.endpoint_id,
      dlkt_info_private.hash_text(v_run.id::text || '|' || v_target.channel || '|' || v_target.endpoint_id::text),
      p_payload_hash,
      p_now
    )
    on conflict do nothing;
    if found then
      v_outbox := v_outbox + 1;
    end if;
  end loop;

  perform dlkt_info_private.append_event(
    v_run.id,
    v_run.owner_id,
    'run.finalized',
    'worker',
    p_worker_id,
    jsonb_build_object(
      'status', v_run.status,
      'cards', v_run.card_count,
      'contested', v_run.contested_count,
      'omitted', v_run.omitted_count,
      'outbox', v_outbox,
      'engineVersion', p_engine_version,
      'productVersion', p_product_version
    )
  );

  run_id := v_run.id;
  status := v_run.status;
  card_count := v_run.card_count;
  contested_count := v_run.contested_count;
  omitted_count := v_run.omitted_count;
  outbox_count := v_outbox;
  return next;
end;
$$;

create or replace function public.dlkt_info_verify_delivery_endpoint(
  p_endpoint_id uuid,
  p_secret_ref text,
  p_now timestamptz default clock_timestamp()
)
returns table (
  endpoint_id uuid,
  state text,
  verified_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_endpoint public.dlkt_info_delivery_endpoints%rowtype;
begin
  perform dlkt_info_private.require_service_role();
  if p_endpoint_id is null
     or p_secret_ref is null
     or p_secret_ref <> btrim(p_secret_ref)
     or length(p_secret_ref) not between 3 and 255
     or p_secret_ref !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]+$' then
    raise exception using errcode = '22023', message = 'DLKT_INFO_ENDPOINT_VERIFICATION_INVALID';
  end if;

  select * into v_endpoint
  from public.dlkt_info_delivery_endpoints endpoint
  where endpoint.id = p_endpoint_id
  for update;

  if not found or v_endpoint.state = 'revoked' then
    raise exception using errcode = '55000', message = 'DLKT_INFO_ENDPOINT_NOT_VERIFIABLE';
  end if;

  insert into dlkt_info_private.delivery_endpoint_secrets (endpoint_id, secret_ref, secret_version)
  values (v_endpoint.id, p_secret_ref, 1)
  on conflict on constraint dlkt_info_delivery_endpoint_secrets_pkey do update
    set secret_ref = excluded.secret_ref,
        secret_version = dlkt_info_private.delivery_endpoint_secrets.secret_version + 1;

  update public.dlkt_info_delivery_endpoints
  set state = 'verified', verified_at = p_now
  where id = v_endpoint.id
  returning * into v_endpoint;

  endpoint_id := v_endpoint.id;
  state := v_endpoint.state;
  verified_at := v_endpoint.verified_at;
  return next;
end;
$$;

create or replace function public.dlkt_info_claim_delivery_jobs(
  p_worker_id text,
  p_limit integer default 50,
  p_now timestamptz default clock_timestamp(),
  p_lease_seconds integer default 120
)
returns table (
  job_id uuid,
  run_id uuid,
  owner_id uuid,
  channel text,
  endpoint_id uuid,
  secret_ref text,
  destination_hash text,
  attempt_no integer,
  payload_hash text
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_job dlkt_info_private.delivery_outbox%rowtype;
  v_endpoint public.dlkt_info_delivery_endpoints%rowtype;
  v_secret_ref text;
begin
  perform dlkt_info_private.require_service_role();
  if p_worker_id is null or p_worker_id <> btrim(p_worker_id) or length(p_worker_id) not between 3 and 160
     or p_limit not between 1 and 200 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_DELIVERY_CLAIM_INVALID';
  end if;

  for v_job in
    select outbox.*
    from dlkt_info_private.delivery_outbox outbox
    join public.dlkt_info_delivery_endpoints endpoint
      on endpoint.id = outbox.endpoint_id
     and endpoint.state = 'verified'
    join dlkt_info_private.delivery_endpoint_secrets secret
      on secret.endpoint_id = endpoint.id
    where outbox.status in ('pending', 'retry')
      and outbox.available_at <= p_now
      and outbox.attempt_count < outbox.max_attempts
    order by outbox.available_at, outbox.id
    for update of outbox skip locked
    limit p_limit
  loop
    update dlkt_info_private.delivery_outbox
    set status = 'claimed',
        lease_owner = p_worker_id,
        lease_until = p_now + make_interval(secs => p_lease_seconds),
        attempt_count = attempt_count + 1
    where id = v_job.id
    returning * into v_job;

    select * into v_endpoint
    from public.dlkt_info_delivery_endpoints endpoint
    where endpoint.id = v_job.endpoint_id;

    select secret.secret_ref into v_secret_ref
    from dlkt_info_private.delivery_endpoint_secrets secret
    where secret.endpoint_id = v_job.endpoint_id;

    perform dlkt_info_private.append_event(
      v_job.run_id,
      v_job.owner_id,
      'delivery.claimed',
      'worker',
      p_worker_id,
      jsonb_build_object('jobId', v_job.id, 'channel', v_job.channel, 'attempt', v_job.attempt_count)
    );

    job_id := v_job.id;
    run_id := v_job.run_id;
    owner_id := v_job.owner_id;
    channel := v_job.channel;
    endpoint_id := v_job.endpoint_id;
    secret_ref := v_secret_ref;
    destination_hash := v_endpoint.destination_hash;
    attempt_no := v_job.attempt_count;
    payload_hash := v_job.payload_hash;
    return next;
  end loop;
end;
$$;

create or replace function public.dlkt_info_record_delivery_attempt(
  p_job_id uuid,
  p_worker_id text,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error_code text default null,
  p_retry_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb,
  p_now timestamptz default clock_timestamp()
)
returns table (
  job_id uuid,
  status text,
  attempt_no integer,
  terminal boolean
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_job dlkt_info_private.delivery_outbox%rowtype;
  v_receipt_status text;
  v_terminal boolean;
begin
  perform dlkt_info_private.require_service_role();
  if p_job_id is null
     or p_worker_id is null or p_worker_id <> btrim(p_worker_id) or length(p_worker_id) not between 3 and 160
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'DLKT_INFO_DELIVERY_RESULT_INVALID';
  end if;

  select * into v_job
  from dlkt_info_private.delivery_outbox outbox
  where outbox.id = p_job_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'DLKT_INFO_DELIVERY_JOB_NOT_FOUND';
  end if;

  if v_job.status in ('delivered', 'dead', 'cancelled') then
    job_id := v_job.id;
    status := v_job.status;
    attempt_no := v_job.attempt_count;
    terminal := true;
    return next;
    return;
  end if;

  if v_job.status <> 'claimed'
     or v_job.lease_owner <> p_worker_id
     or v_job.lease_until <= p_now then
    raise exception using errcode = '55000', message = 'DLKT_INFO_DELIVERY_LEASE_INVALID';
  end if;

  if p_succeeded then
    if p_provider_message_id is null or btrim(p_provider_message_id) = '' or p_error_code is not null then
      raise exception using errcode = '22023', message = 'DLKT_INFO_DELIVERY_SUCCESS_INVALID';
    end if;
    v_receipt_status := 'delivered';
    v_terminal := true;
  else
    if p_error_code is null or p_error_code !~ '^[A-Z0-9_:-]{1,80}$' then
      raise exception using errcode = '22023', message = 'DLKT_INFO_DELIVERY_ERROR_INVALID';
    end if;
    v_terminal := v_job.attempt_count >= v_job.max_attempts;
    if not v_terminal and (p_retry_at is null or p_retry_at <= p_now or p_retry_at > p_now + interval '7 days') then
      raise exception using errcode = '22023', message = 'DLKT_INFO_DELIVERY_RETRY_INVALID';
    end if;
    v_receipt_status := case when v_terminal then 'dead' else 'failed' end;
  end if;

  insert into public.dlkt_info_delivery_receipts (
    outbox_id,
    owner_id,
    attempt_no,
    channel,
    status,
    provider_message_id,
    error_code,
    metadata,
    attempted_at,
    delivered_at
  ) values (
    v_job.id,
    v_job.owner_id,
    v_job.attempt_count,
    v_job.channel,
    v_receipt_status,
    p_provider_message_id,
    p_error_code,
    coalesce(p_metadata, '{}'::jsonb),
    p_now,
    case when p_succeeded then p_now else null end
  )
  on conflict do nothing;

  update dlkt_info_private.delivery_outbox
  set status = case
        when p_succeeded then 'delivered'
        when v_terminal then 'dead'
        else 'retry'
      end,
      available_at = case when not p_succeeded and not v_terminal then p_retry_at else available_at end,
      lease_owner = null,
      lease_until = null,
      last_error_code = p_error_code
  where id = v_job.id
  returning * into v_job;

  perform dlkt_info_private.append_event(
    v_job.run_id,
    v_job.owner_id,
    case when p_succeeded then 'delivery.delivered' when v_terminal then 'delivery.dead' else 'delivery.retry' end,
    'provider',
    null,
    jsonb_build_object(
      'jobId', v_job.id,
      'channel', v_job.channel,
      'attempt', v_job.attempt_count,
      'status', v_job.status,
      'errorCode', p_error_code
    )
  );

  job_id := v_job.id;
  status := v_job.status;
  attempt_no := v_job.attempt_count;
  terminal := v_job.status in ('delivered', 'dead', 'cancelled');
  return next;
end;
$$;

create or replace function public.dlkt_info_recover_expired_leases(
  p_now timestamptz default clock_timestamp()
)
returns table (
  recovered_runs integer,
  failed_runs integer,
  retried_deliveries integer,
  dead_deliveries integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_recovered_runs integer := 0;
  v_failed_runs integer := 0;
  v_retried_deliveries integer := 0;
  v_dead_deliveries integer := 0;
begin
  perform dlkt_info_private.require_service_role();

  with updated as (
    update public.dlkt_info_briefing_runs
    set status = case when attempt_count >= 5 then 'failed' else 'queued' end,
        lease_owner = null,
        lease_until = null,
        error_code = case when attempt_count >= 5 then 'LEASE_EXHAUSTED' else 'LEASE_EXPIRED' end,
        error_detail = null
    where status in ('claimed', 'generating')
      and lease_until <= p_now
    returning status
  )
  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'failed')
  into v_recovered_runs, v_failed_runs
  from updated;

  with updated as (
    update dlkt_info_private.delivery_outbox
    set status = case when attempt_count >= max_attempts then 'dead' else 'retry' end,
        available_at = case when attempt_count >= max_attempts then available_at else p_now end,
        lease_owner = null,
        lease_until = null,
        last_error_code = 'LEASE_EXPIRED'
    where status = 'claimed'
      and lease_until <= p_now
    returning status
  )
  select count(*) filter (where status = 'retry'), count(*) filter (where status = 'dead')
  into v_retried_deliveries, v_dead_deliveries
  from updated;

  recovered_runs := v_recovered_runs;
  failed_runs := v_failed_runs;
  retried_deliveries := v_retried_deliveries;
  dead_deliveries := v_dead_deliveries;
  return next;
end;
$$;

revoke all on all tables in schema dlkt_info_private from public, anon, authenticated;
revoke all on all sequences in schema dlkt_info_private from public, anon, authenticated;
revoke all on all functions in schema dlkt_info_private from public, anon, authenticated;

-- Public tables use these deterministic validators in CHECK constraints.
-- Authenticated receives no private-table privileges and can execute only this
-- narrow, side-effect-free validation surface.
grant usage on schema dlkt_info_private to authenticated;
grant execute on function dlkt_info_private.is_valid_timezone(text) to authenticated;
grant execute on function dlkt_info_private.is_valid_iso_weekdays(smallint[]) to authenticated;
grant execute on function dlkt_info_private.is_valid_text_set(text[], integer, integer) to authenticated;
grant execute on function dlkt_info_private.is_valid_channels(text[]) to authenticated;
grant execute on function dlkt_info_private.is_sha256(text) to authenticated;

grant usage on schema dlkt_info_private to service_role;
grant select, insert, update, delete on all tables in schema dlkt_info_private to service_role;
grant usage, select on all sequences in schema dlkt_info_private to service_role;
grant execute on all functions in schema dlkt_info_private to service_role;

revoke all on public.dlkt_info_profiles from anon;
revoke all on public.dlkt_info_briefings from anon;
revoke all on public.dlkt_info_interest_rules from anon;
revoke all on public.dlkt_info_delivery_endpoints from anon;
revoke all on public.dlkt_info_briefing_targets from anon;
revoke all on public.dlkt_info_user_memory from anon;
revoke all on public.dlkt_info_briefing_runs from anon;
revoke all on public.dlkt_info_briefing_cards from anon;
revoke all on public.dlkt_info_delivery_receipts from anon;
revoke all on public.dlkt_info_briefing_events from anon;

grant select, insert, update on public.dlkt_info_profiles to authenticated;
grant select, insert, update, delete on public.dlkt_info_briefings to authenticated;
grant select, insert, update, delete on public.dlkt_info_interest_rules to authenticated;
grant select, insert, update, delete on public.dlkt_info_delivery_endpoints to authenticated;
grant select, insert, update, delete on public.dlkt_info_briefing_targets to authenticated;
grant select, insert, update, delete on public.dlkt_info_user_memory to authenticated;
grant select on public.dlkt_info_briefing_runs to authenticated;
grant select on public.dlkt_info_briefing_cards to authenticated;
grant select on public.dlkt_info_delivery_receipts to authenticated;
grant select on public.dlkt_info_briefing_events to authenticated;

grant all on public.dlkt_info_profiles to service_role;
grant all on public.dlkt_info_briefings to service_role;
grant all on public.dlkt_info_interest_rules to service_role;
grant all on public.dlkt_info_delivery_endpoints to service_role;
grant all on public.dlkt_info_briefing_targets to service_role;
grant all on public.dlkt_info_user_memory to service_role;
grant all on public.dlkt_info_briefing_runs to service_role;
grant all on public.dlkt_info_briefing_cards to service_role;
grant all on public.dlkt_info_delivery_receipts to service_role;
grant all on public.dlkt_info_briefing_events to service_role;
grant usage, select on sequence public.dlkt_info_briefing_events_id_seq to service_role;

revoke all on function public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamptz) from public, anon;
grant execute on function public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamptz) to authenticated, service_role;

revoke all on function public.dlkt_info_claim_due_briefings(text, integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_claim_queued_runs(text, integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_claim_delivery_jobs(text, integer, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamptz, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.dlkt_info_recover_expired_leases(timestamptz) from public, anon, authenticated;

grant execute on function public.dlkt_info_claim_due_briefings(text, integer, timestamptz, integer) to service_role;
grant execute on function public.dlkt_info_claim_queued_runs(text, integer, timestamptz, integer) to service_role;
grant execute on function public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamptz) to service_role;
grant execute on function public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamptz) to service_role;
grant execute on function public.dlkt_info_claim_delivery_jobs(text, integer, timestamptz, integer) to service_role;
grant execute on function public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamptz, jsonb, timestamptz) to service_role;
grant execute on function public.dlkt_info_recover_expired_leases(timestamptz) to service_role;

comment on table public.dlkt_info_delivery_endpoints is 'Stores only destination hashes and external secret references; raw addresses and push tokens are not stored here.';
comment on table dlkt_info_private.claims is 'Immutable atomic factual claims. Corrections are new claims linked through supersedes_claim_id.';
comment on table dlkt_info_private.claim_evidence is 'Immutable provenance records tied to an exact version of the source registry.';
comment on table dlkt_info_private.delivery_outbox is 'Transactional, idempotent delivery queue. Browser roles have no access.';
comment on function public.dlkt_info_claim_due_briefings(text, integer, timestamptz, integer) is 'Atomically creates or reclaims due briefing runs and advances schedules.';
comment on function public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamptz) is 'Idempotently persists a finite briefing and enqueues verified non-web delivery targets.';

commit;
