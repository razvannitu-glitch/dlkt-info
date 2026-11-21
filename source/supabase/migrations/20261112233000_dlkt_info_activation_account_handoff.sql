begin;

drop function if exists public.dlkt_info_claim_due_briefings(text, integer, timestamptz, integer);
drop function if exists public.dlkt_info_claim_queued_runs(text, integer, timestamptz, integer);
drop function if exists public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamptz);
drop function if exists public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, smallint, text, boolean);
drop function if exists public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean);

create or replace function dlkt_info_private.is_valid_text_collection(
  p_values text[],
  p_max_length integer default 160,
  p_max_total_length integer default 131072
)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_values is not null
    and coalesce((select sum(length(value)) from unnest(p_values) as value), 0) <= p_max_total_length
    and not exists (
      select 1 from unnest(p_values) as value
      where value is null
         or value <> btrim(value)
         or length(value) < 1
         or length(value) > p_max_length
         or value ~ '[[:cntrl:]]'
    )
    and cardinality(p_values) = (select count(distinct value) from unnest(p_values) as value);
$$;

alter table public.dlkt_info_briefings drop constraint if exists dlkt_info_briefings_card_limit_check;
alter table public.dlkt_info_briefings alter column max_cards type integer using max_cards::integer;
alter table public.dlkt_info_briefings add constraint dlkt_info_briefings_card_budget_check check (max_cards > 0);

alter table public.dlkt_info_briefings
  add column if not exists minimum_trust text not null default 'corroborated',
  add column if not exists conflict_policy text not null default 'exclude',
  add column if not exists authority_requirement text not null default 'primary',
  add column if not exists minimum_sources integer not null default 2,
  add column if not exists maximum_evidence_age_hours integer not null default 72,
  add column if not exists require_official_for_high_impact boolean not null default true;

alter table public.dlkt_info_briefings
  add constraint dlkt_info_briefings_minimum_trust_check check (minimum_trust in ('confirmed','corroborated','single-source')),
  add constraint dlkt_info_briefings_conflict_policy_check check (conflict_policy in ('exclude','include-warning')),
  add constraint dlkt_info_briefings_authority_requirement_check check (authority_requirement in ('official','primary','reputable-secondary','community')),
  add constraint dlkt_info_briefings_minimum_sources_check check (minimum_sources in (1,2)),
  add constraint dlkt_info_briefings_evidence_age_check check (maximum_evidence_age_hours in (24,72,168));

alter table public.dlkt_info_interest_rules drop constraint if exists dlkt_info_interest_rules_include_entities_check;
alter table public.dlkt_info_interest_rules add constraint dlkt_info_interest_rules_include_entities_check
  check (dlkt_info_private.is_valid_text_collection(include_entities,160,131072));

alter table public.dlkt_info_briefing_runs drop constraint if exists dlkt_info_briefing_runs_counts_check;
alter table public.dlkt_info_briefing_runs
  alter column card_count type integer using card_count::integer,
  alter column contested_count type integer using contested_count::integer,
  alter column omitted_count type integer using omitted_count::integer;
alter table public.dlkt_info_briefing_runs add constraint dlkt_info_briefing_runs_counts_check
  check (card_count >= 0 and contested_count >= 0 and omitted_count >= 0);

alter table public.dlkt_info_briefing_cards drop constraint if exists dlkt_info_briefing_cards_position_check;
alter table public.dlkt_info_briefing_cards alter column position type integer using position::integer;
alter table public.dlkt_info_briefing_cards add constraint dlkt_info_briefing_cards_position_check check (position > 0);

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
      or new.minimum_trust is distinct from old.minimum_trust
      or new.conflict_policy is distinct from old.conflict_policy
      or new.authority_requirement is distinct from old.authority_requirement
      or new.minimum_sources is distinct from old.minimum_sources
      or new.maximum_evidence_age_hours is distinct from old.maximum_evidence_age_hours
      or new.require_official_for_high_impact is distinct from old.require_official_for_high_impact
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
  max_cards integer
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
  max_cards integer
)
language plpgsql
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_run public.dlkt_info_briefing_runs%rowtype;
  v_max_cards integer;
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
  card_count integer,
  contested_count integer,
  omitted_count integer,
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
  v_max_cards integer;
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

  select briefing.max_cards into v_max_cards
  from public.dlkt_info_briefings briefing
  where briefing.id = v_run.briefing_id;

  if v_max_cards is null or v_max_cards < 1 then
    raise exception using errcode = '55000', message = 'DLKT_INFO_BRIEFING_BUDGET_INVALID';
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
  if jsonb_typeof(v_cards) <> 'array' or jsonb_array_length(v_cards) > v_max_cards then
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


create or replace function public.dlkt_info_read_companion_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, dlkt_info_private
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile public.dlkt_info_profiles%rowtype;
  v_briefing public.dlkt_info_briefings%rowtype;
  v_rule public.dlkt_info_interest_rules%rowtype;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'DLKT_INFO_AUTH_REQUIRED';
  end if;

  select * into v_profile
  from public.dlkt_info_profiles
  where id = v_user_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'DLKT_INFO_PROFILE_NOT_FOUND';
  end if;

  select * into v_briefing
  from public.dlkt_info_briefings
  where owner_id = v_user_id and status <> 'archived'
  order by case status when 'active' then 0 when 'draft' then 1 else 2 end, updated_at desc, id
  limit 1;

  if v_briefing.id is not null then
    select * into v_rule
    from public.dlkt_info_interest_rules
    where briefing_id = v_briefing.id and is_enabled
    order by position, id
    limit 1;
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-persistence-2',
    'profile', jsonb_build_object(
      'locale', v_profile.locale,
      'timezone', v_profile.timezone,
      'plan', v_profile.plan,
      'onboardingState', v_profile.onboarding_state
    ),
    'briefing', case when v_briefing.id is null then null else jsonb_build_object(
      'id', v_briefing.id,
      'name', v_briefing.name,
      'timezone', v_briefing.timezone,
      'deliveryLocalTime', to_char(v_briefing.delivery_local_time, 'HH24:MI'),
      'weekdays', to_jsonb(v_briefing.weekdays),
      'maxCards', v_briefing.max_cards,
      'status', v_briefing.status,
      'version', v_briefing.version,
      'nextDeliveryAt', v_briefing.next_delivery_at
    ) end,
    'trustPolicy', case when v_briefing.id is null then null else jsonb_build_object(
      'minimumTrust', v_briefing.minimum_trust,
      'conflictPolicy', v_briefing.conflict_policy,
      'authorityRequirement', v_briefing.authority_requirement,
      'minimumSources', v_briefing.minimum_sources,
      'maximumEvidenceAgeHours', v_briefing.maximum_evidence_age_hours,
      'requireOfficialForHighImpact', v_briefing.require_official_for_high_impact
    ) end,
    'rule', case when v_rule.id is null then null else jsonb_build_object(
      'topics', to_jsonb(v_rule.include_topics),
      'entities', to_jsonb(v_rule.include_entities),
      'minMateriality', v_rule.min_materiality,
      'onlyActionable', v_rule.only_actionable
    ) end
  );
end;
$$;


create function public.dlkt_info_save_companion_configuration(
  p_briefing_id uuid,
  p_topics text[],
  p_entities text[],
  p_timezone text,
  p_delivery_local_time time without time zone,
  p_max_cards integer,
  p_min_materiality text,
  p_only_actionable boolean,
  p_minimum_trust text,
  p_conflict_policy text,
  p_authority_requirement text,
  p_minimum_sources integer,
  p_maximum_evidence_age_hours integer,
  p_require_official_for_high_impact boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public, auth, dlkt_info_private
as $$
declare
  v_user_id uuid := auth.uid();
  v_briefing_id uuid;
  v_topic_count integer;
  v_entity_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'DLKT_INFO_AUTH_REQUIRED';
  end if;

  if p_topics is null or cardinality(p_topics) < 1 or cardinality(p_topics) > 5 then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_TOPICS_INVALID';
  end if;

  select count(distinct topic)::integer into v_topic_count from unnest(p_topics) as topic;
  if v_topic_count <> cardinality(p_topics)
     or exists (
       select 1 from unnest(p_topics) as topic
       where topic not in ('technology', 'business', 'regulation', 'opportunities', 'supply')
     ) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_TOPICS_INVALID';
  end if;

  if not dlkt_info_private.is_valid_text_collection(p_entities, 80, 131072)
     or exists (select 1 from unnest(p_entities) as entity where position('|' in entity) > 0) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_ENTITIES_INVALID';
  end if;

  select count(distinct lower(entity))::integer into v_entity_count from unnest(p_entities) as entity;
  if v_entity_count <> cardinality(p_entities) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_ENTITIES_INVALID';
  end if;

  if not dlkt_info_private.is_valid_timezone(p_timezone)
     or p_delivery_local_time is null
     or p_max_cards is null or p_max_cards < 1
     or p_min_materiality not in ('low', 'medium', 'high', 'critical')
     or p_only_actionable is null
     or p_minimum_trust not in ('confirmed', 'corroborated', 'single-source')
     or p_conflict_policy not in ('exclude', 'include-warning')
     or p_authority_requirement not in ('official', 'primary', 'reputable-secondary', 'community')
     or p_minimum_sources not in (1, 2)
     or p_maximum_evidence_age_hours not in (24, 72, 168)
     or p_require_official_for_high_impact is null then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_CONFIGURATION_INVALID';
  end if;

  insert into public.dlkt_info_profiles (id, timezone)
  values (v_user_id, p_timezone)
  on conflict (id) do update set timezone = excluded.timezone;

  if p_briefing_id is not null then
    select id into v_briefing_id
    from public.dlkt_info_briefings
    where id = p_briefing_id and owner_id = v_user_id and status <> 'archived'
    for update;
    if v_briefing_id is null then
      raise exception using errcode = '42501', message = 'DLKT_INFO_BRIEFING_OWNERSHIP_INVALID';
    end if;
  else
    select id into v_briefing_id
    from public.dlkt_info_briefings
    where owner_id = v_user_id and lower(name) = lower('Personal Briefing') and status <> 'archived'
    order by updated_at desc, id
    limit 1
    for update;
  end if;

  if v_briefing_id is null then
    insert into public.dlkt_info_briefings (
      owner_id, name, timezone, delivery_local_time, weekdays, max_cards, status,
      minimum_trust, conflict_policy, authority_requirement, minimum_sources,
      maximum_evidence_age_hours, require_official_for_high_impact
    ) values (
      v_user_id, 'Personal Briefing', p_timezone, p_delivery_local_time,
      array[1,2,3,4,5,6,7]::smallint[], p_max_cards, 'active',
      p_minimum_trust, p_conflict_policy, p_authority_requirement, p_minimum_sources,
      p_maximum_evidence_age_hours, p_require_official_for_high_impact
    ) returning id into v_briefing_id;
  else
    update public.dlkt_info_briefings
    set name = 'Personal Briefing',
        timezone = p_timezone,
        delivery_local_time = p_delivery_local_time,
        weekdays = array[1,2,3,4,5,6,7]::smallint[],
        max_cards = p_max_cards,
        status = 'active',
        minimum_trust = p_minimum_trust,
        conflict_policy = p_conflict_policy,
        authority_requirement = p_authority_requirement,
        minimum_sources = p_minimum_sources,
        maximum_evidence_age_hours = p_maximum_evidence_age_hours,
        require_official_for_high_impact = p_require_official_for_high_impact
    where id = v_briefing_id and owner_id = v_user_id;
  end if;

  delete from public.dlkt_info_interest_rules
  where briefing_id = v_briefing_id and position <> 1;

  insert into public.dlkt_info_interest_rules (
    briefing_id, name, include_topics, exclude_topics, include_entities,
    exclude_entities, include_geographies, languages, min_materiality,
    weight, only_actionable, is_enabled, position
  ) values (
    v_briefing_id, 'Personal Companion', p_topics, '{}'::text[], p_entities,
    '{}'::text[], '{}'::text[], array['en']::text[], p_min_materiality,
    2, p_only_actionable, true, 1
  )
  on conflict (briefing_id, position) do update
  set name = excluded.name,
      include_topics = excluded.include_topics,
      exclude_topics = excluded.exclude_topics,
      include_entities = excluded.include_entities,
      exclude_entities = excluded.exclude_entities,
      include_geographies = excluded.include_geographies,
      languages = excluded.languages,
      min_materiality = excluded.min_materiality,
      weight = excluded.weight,
      only_actionable = excluded.only_actionable,
      is_enabled = true;

  return public.dlkt_info_read_companion_configuration();
end;
$$;


revoke all on function public.dlkt_info_read_companion_configuration() from public, anon;
revoke all on function public.dlkt_info_save_companion_configuration(uuid,text[],text[],text,time without time zone,integer,text,boolean,text,text,text,integer,integer,boolean) from public, anon;
grant execute on function public.dlkt_info_read_companion_configuration() to authenticated, service_role;
grant execute on function public.dlkt_info_save_companion_configuration(uuid,text[],text[],text,time without time zone,integer,text,boolean,text,text,text,integer,integer,boolean) to authenticated, service_role;

revoke all on function public.dlkt_info_claim_due_briefings(text,integer,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_claim_queued_runs(text,integer,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.dlkt_info_finalize_run(uuid,text,jsonb,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.dlkt_info_claim_due_briefings(text,integer,timestamptz,integer) to service_role;
grant execute on function public.dlkt_info_claim_queued_runs(text,integer,timestamptz,integer) to service_role;
grant execute on function public.dlkt_info_finalize_run(uuid,text,jsonb,text,text,text,timestamptz) to service_role;

comment on function public.dlkt_info_read_companion_configuration() is
  'Returns the authenticated user briefing, explicit entities and complete trust policy without exposing another owner.';
comment on function public.dlkt_info_save_companion_configuration(uuid,text[],text[],text,time without time zone,integer,text,boolean,text,text,text,integer,integer,boolean) is
  'Atomically saves the authenticated user briefing, explicit entities, user-defined finite card budget and complete trust policy.';

commit;
