begin;

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
    'version', 'dlkt-info-persistence-1',
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
    'rule', case when v_rule.id is null then null else jsonb_build_object(
      'topics', to_jsonb(v_rule.include_topics),
      'entities', to_jsonb(v_rule.include_entities),
      'minMateriality', v_rule.min_materiality,
      'onlyActionable', v_rule.only_actionable
    ) end
  );
end;
$$;

drop function if exists public.dlkt_info_save_companion_configuration(
  uuid, text[], text, time without time zone, smallint, text, boolean
);

create function public.dlkt_info_save_companion_configuration(
  p_briefing_id uuid,
  p_topics text[],
  p_entities text[],
  p_timezone text,
  p_delivery_local_time time without time zone,
  p_max_cards smallint,
  p_min_materiality text,
  p_only_actionable boolean
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

  if not dlkt_info_private.is_valid_text_set(p_entities, 8, 80)
     or exists (select 1 from unnest(p_entities) as entity where position('|' in entity) > 0) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_ENTITIES_INVALID';
  end if;

  select count(distinct lower(entity))::integer into v_entity_count from unnest(p_entities) as entity;
  if v_entity_count <> cardinality(p_entities) then
    raise exception using errcode = '22023', message = 'DLKT_INFO_COMPANION_ENTITIES_INVALID';
  end if;

  if not dlkt_info_private.is_valid_timezone(p_timezone)
     or p_delivery_local_time is null
     or p_max_cards not between 1 and 12
     or p_min_materiality not in ('low', 'medium', 'high', 'critical')
     or p_only_actionable is null then
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
      owner_id, name, timezone, delivery_local_time, weekdays, max_cards, status
    ) values (
      v_user_id, 'Personal Briefing', p_timezone, p_delivery_local_time,
      array[1,2,3,4,5,6,7]::smallint[], p_max_cards, 'active'
    ) returning id into v_briefing_id;
  else
    update public.dlkt_info_briefings
    set name = 'Personal Briefing',
        timezone = p_timezone,
        delivery_local_time = p_delivery_local_time,
        weekdays = array[1,2,3,4,5,6,7]::smallint[],
        max_cards = p_max_cards,
        status = 'active'
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
revoke all on function public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, smallint, text, boolean) from public, anon;
grant execute on function public.dlkt_info_read_companion_configuration() to authenticated, service_role;
grant execute on function public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, smallint, text, boolean) to authenticated, service_role;

comment on function public.dlkt_info_read_companion_configuration() is
  'Returns the authenticated user personal companion configuration, including explicit tracked entities, without exposing another owner.';
comment on function public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, smallint, text, boolean) is
  'Atomically creates or updates the authenticated user finite personal briefing, explicit tracked entities and canonical interest rule.';

commit;
