-- DRAFT ONLY. Generate the actual timestamped migration through the Supabase CLI.
-- No credential is embedded. An operator must separately insert the SHA256 of a
-- random 32-byte-or-longer base64url writer key into the private singleton table.
-- No row means writing is disabled. Never grant readers access to that hash.
-- Add these exact objects/ACLs to the existing readiness attestation before rollout.
begin;
create schema if not exists dlkt_info_private;

-- JSONB sorts object keys. Reconstruct precisely the JSON.stringify(cardContent)
-- field order rather than hashing JSONB's differently spaced serialization.
create function dlkt_info_private.share_archive_content(p_card jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare result text; countries text;
begin
  result := '{"identity":' || to_json(p_card->>'identity')::text
    || ',"title":' || to_json(p_card->>'title')::text
    || ',"sourceUrl":' || to_json(p_card->>'sourceUrl')::text
    || ',"date":' || to_json(p_card->>'date')::text
    || ',"dateLabel":' || to_json(p_card->>'dateLabel')::text
    || ',"publisher":' || to_json(p_card->>'publisher')::text
    || ',"deadline":' || coalesce(to_json(p_card->>'deadline')::text, 'null')
    || ',"version":' || coalesce(to_json(p_card->>'version')::text, 'null');
  if p_card ? 'summary' then result := result || ',"summary":' || to_json(p_card->>'summary')::text; end if;
  if p_card ? 'byline' then result := result || ',"byline":' || to_json(p_card->>'byline')::text || ',"licenseUrl":' || to_json(p_card->>'licenseUrl')::text; end if;
  if p_card ? 'context' then
    select coalesce(string_agg('{"code":' || to_json(country->>'code')::text || ',"name":' || to_json(country->>'name')::text || '}', ',' order by ordinal), '')
      into countries from jsonb_array_elements(p_card->'context'->'countries') with ordinality as entry(country, ordinal);
    result := result || ',"context":{"countries":[' || countries || '],"basis":' || to_json(p_card->'context'->>'basis')::text
      || ',"label":' || to_json(p_card->'context'->>'label')::text || ',"boundary":' || to_json(p_card->'context'->>'boundary')::text || '}';
  end if;
  return result || '}';
end $$;

create function dlkt_info_private.valid_share_archive_card(p_card jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare item record; source_id text; rule jsonb; source_count integer; country jsonb; stamp timestamptz;
  -- Reviewed registry snapshot. A source addition requires an explicit migration.
  sources constant jsonb := '{
    "eu-law":["EU Publications Office","^https://eur-lex[.]europa[.]eu/legal-content/EN/TXT/","legal-document",null],
    "ecb-news":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","publication",null],
    "ecb-statistics":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","publication",null],
    "ecb-procurement":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","procurement-notice",null],
    "nextjs":["Vercel / Next.js maintainers","^https://github[.]com/vercel/next[.]js/releases/tag/","software-release",null],
    "nodejs":["Node.js maintainers","^https://github[.]com/nodejs/node/releases/tag/","software-release",null],
    "nasa-news":["NASA","^https://(www|science)[.]nasa[.]gov/","publication",null],
    "usgs-news":["U.S. Geological Survey","^https://www[.]usgs[.]gov/news/national-news-release/","publication",null],
    "fda-news":["U.S. Food and Drug Administration","^https://www[.]fda[.]gov/news-events/press-announcements/","publication",null],
    "govuk-news":["UK Government","^https://www[.]gov[.]uk/government/","publication",null],
    "gv-world":["Global Voices","^https://globalvoices[.]org/20","publication","https://creativecommons.org/licenses/by/3.0/"],
    "gv-culture":["Global Voices","^https://globalvoices[.]org/20","publication","https://creativecommons.org/licenses/by/3.0/"],
    "eff-digital":["Electronic Frontier Foundation","^https://www[.]eff[.]org/deeplinks/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "govuk-products":["UK Government","^https://www[.]gov[.]uk/product-safety-alerts-reports-recalls/","publication",null],
    "ncsc-news":["UK National Cyber Security Centre","^https://www[.]ncsc[.]gov[.]uk/news/","publication",null],
    "sanews":["SAnews","^https://www[.]sanews[.]gov[.]za/(south-africa|features)/","publication",null],
    "ec-press":["European Commission","^https://ec[.]europa[.]eu/commission/presscorner/detail/en/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "eu-council":["Council of the European Union","^https://www[.]consilium[.]europa[.]eu/en/press/","publication",null],
    "cbs-news":["Statistics Netherlands (CBS)","^https://www[.]cbs[.]nl/en-gb/news/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "scidev-news":["SciDev.Net","^https://www[.]scidev[.]net/global/","publication","https://creativecommons.org/licenses/by/3.0/"],
    "360-news":["360info","^https://360info[.]org/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "noaa-news":["NOAA","^https://www[.]noaa[.]gov/(news|stories)/","publication",null],
    "nist-news":["NIST","^https://www[.]nist[.]gov/news-events/news/","publication",null],
    "nsf-news":["U.S. National Science Foundation","^https://www[.]nsf[.]gov/news/","publication",null],
    "fed-news":["Federal Reserve Board","^https://www[.]federalreserve[.]gov/newsevents/pressreleases/","publication",null],
    "ftc-consumer":["U.S. Federal Trade Commission","^https://consumer[.]ftc[.]gov/consumer-alerts/","publication",null],
    "fda-food":["U.S. Food and Drug Administration","^https://www[.]fda[.]gov/safety/recalls-market-withdrawals-safety-alerts/","publication",null],
    "govuk-travel":["UK Government","^https://www[.]gov[.]uk/foreign-travel-advice/","publication",null],
    "beehive-news":["New Zealand Government","^https://www[.]beehive[.]govt[.]nz/(release|speech)/","publication",null]
  }'::jsonb;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 32768
    or not (p_card ?& array['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState'])
    or exists(select 1 from jsonb_object_keys(p_card) as k where k <> all(array['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState','summary','byline','licenseUrl','context'])) then return false; end if;
  for item in select * from (values ('id',24),('identity',3000),('title',4000),('topic',40),('kind',30),('sourceUrl',3000),('publisher',300),('date',100),('dateLabel',20),('observedAt',100),('contentHash',64),('boundary',4000),('attribution',4000),('sourceState',10)) as limits(field,maximum) loop
    if jsonb_typeof(p_card->item.field) <> 'string' or length(p_card->>item.field) not between 1 and item.maximum
      or (p_card->>item.field) ~ '[[:cntrl:]]' then return false; end if;
  end loop;
  if (p_card->>'id') !~ '^[a-f0-9]{24}$' or (p_card->>'contentHash') !~ '^[a-f0-9]{64}$'
    or (p_card->>'sourceState') not in ('verified','partial')
    or (p_card->>'topic') not in ('technology','business','regulation','opportunities','science','environment','health','public-affairs','world','digital-life','culture','money','space','weather','energy','work-education','housing','travel','food','sport')
    or (p_card->>'dateLabel') not in ('Published','Document date','Updated')
    or (p_card->>'sourceUrl') ~ '[[:space:]#\\]' then return false; end if;
  for item in select * from (values ('summary',1000),('byline',600),('licenseUrl',100)) as limits(field,maximum) loop
    if p_card ? item.field and (jsonb_typeof(p_card->item.field) <> 'string' or length(p_card->>item.field) not between 1 and item.maximum or (p_card->>item.field) ~ '[[:cntrl:]]') then return false; end if;
  end loop;
  if (p_card ? 'byline') <> (p_card ? 'licenseUrl') or (p_card ? 'licenseUrl' and p_card->>'licenseUrl' not in ('https://creativecommons.org/licenses/by/3.0/','https://creativecommons.org/licenses/by/4.0/')) then return false; end if;
  if jsonb_typeof(p_card->'version') not in ('null','string') or coalesce(length(p_card->>'version'),0) > 100
    or jsonb_typeof(p_card->'deadline') not in ('null','string') then return false; end if;
  for item in select * from (values ('date'),('observedAt'),('deadline')) as dates(field) loop
    if p_card->item.field <> 'null'::jsonb then
      if (p_card->>item.field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2}))?$' then return false; end if;
      stamp := (p_card->>item.field)::timestamptz;
      if not isfinite(stamp) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(p_card->'sourceIds') <> 'array' or jsonb_array_length(p_card->'sourceIds') not between 1 and 8 then return false; end if;
  select count(distinct value) into source_count from jsonb_array_elements_text(p_card->'sourceIds');
  if source_count <> jsonb_array_length(p_card->'sourceIds') then return false; end if;
  for source_id in select value from jsonb_array_elements_text(p_card->'sourceIds') loop
    rule := sources->source_id;
    if rule is null or p_card->>'publisher' <> rule->>0 or p_card->>'kind' <> rule->>2 or (p_card->>'sourceUrl') !~ (rule->>1)
      or (rule->>3 is not null and (p_card->>'licenseUrl' is distinct from rule->>3)) then return false; end if;
    if source_id = 'eu-law' then
      if (p_card->>'identity') !~ '^celex:[0-9A-Z][0-9]{4}[A-Z0-9()/_-]{3,60}$' or p_card->>'sourceUrl' <> 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:' || replace(substr(p_card->>'identity',7), '/', '%2F') then return false; end if;
    elsif p_card->>'identity' <> p_card->>'sourceUrl' then return false;
    elsif source_id in ('nextjs','nodejs') then
      if p_card->>'version' is null or (p_card->>'version') !~ '^v?[0-9]+[.][0-9]+[.][0-9]+$'
        or p_card->>'sourceUrl' <> ('https://github.com/' || (case when source_id='nextjs' then 'vercel/next.js' else 'nodejs/node' end) || '/releases/tag/' || (p_card->>'version')) then return false; end if;
    elsif source_id not in ('ecb-news','ecb-statistics','ecb-procurement') and position('?' in p_card->>'sourceUrl') > 0 then return false;
    end if;
  end loop;
  if p_card ? 'context' then
    if jsonb_typeof(p_card->'context') <> 'object' or not ((p_card->'context') ?& array['countries','basis','label','boundary'])
      or (select count(*) from jsonb_object_keys(p_card->'context')) <> 4
      or jsonb_typeof(p_card->'context'->'countries') <> 'array' or jsonb_array_length(p_card->'context'->'countries') > 8
      or p_card->'context'->>'basis' not in ('publisher-category','publisher-scope','unspecified') then return false; end if;
    for item in select * from (values ('basis',40),('label',400),('boundary',4000)) as limits(field,maximum) loop
      if jsonb_typeof(p_card->'context'->item.field) <> 'string' or length(p_card->'context'->>item.field) not between 1 and item.maximum then return false; end if;
    end loop;
    for country in select value from jsonb_array_elements(p_card->'context'->'countries') loop
      if jsonb_typeof(country) <> 'object' or not (country ?& array['code','name']) or (select count(*) from jsonb_object_keys(country)) <> 2
        or jsonb_typeof(country->'code') <> 'string' or (country->>'code') !~ '^[A-Z]{2}$'
        or jsonb_typeof(country->'name') <> 'string' or length(country->>'name') not between 1 and 100 then return false; end if;
    end loop;
  end if;
  return p_card->>'id' = substr(encode(sha256(convert_to(to_json(p_card->>'identity')::text,'UTF8')),'hex'),1,24)
    and p_card->>'contentHash' = encode(sha256(convert_to(dlkt_info_private.share_archive_content(p_card),'UTF8')),'hex');
exception when others then return false;
end $$;

create table dlkt_info_private.share_archive_writer (
  singleton boolean primary key default true check (singleton),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$')
);
alter table dlkt_info_private.share_archive_writer enable row level security;
revoke all on dlkt_info_private.share_archive_writer from public, anon, authenticated, service_role;

create table public.dlkt_info_shared_cards (
  id text not null check (id ~ '^[a-f0-9]{24}$'),
  revision text not null check (revision ~ '^[a-f0-9]{64}$'),
  card jsonb not null check (dlkt_info_private.valid_share_archive_card(card)),
  captured_at timestamptz not null,
  source_check_expires_at timestamptz not null,
  partial boolean not null,
  primary key (id, revision),
  check (id = card->>'id' and revision = card->>'contentHash'),
  check (isfinite(captured_at) and isfinite(source_check_expires_at) and source_check_expires_at > captured_at
    and (card->>'observedAt')::timestamptz between captured_at - interval '1 hour' and captured_at + interval '5 minutes'
    and source_check_expires_at <= (card->>'observedAt')::timestamptz + interval '1 hour'
    and source_check_expires_at <= captured_at + interval '65 minutes')
);
create index dlkt_info_shared_cards_latest on public.dlkt_info_shared_cards (id, captured_at desc, revision desc);
alter table public.dlkt_info_shared_cards enable row level security;
revoke all on public.dlkt_info_shared_cards from public, anon, authenticated, service_role;
grant select on public.dlkt_info_shared_cards to anon, authenticated, service_role;
create policy dlkt_info_shared_cards_public_read on public.dlkt_info_shared_cards for select to anon, authenticated, service_role using (true);

create function dlkt_info_private.prevent_share_archive_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception using errcode='55000', message='SHARE_ARCHIVE_IMMUTABLE'; end $$;
create trigger dlkt_info_shared_cards_immutable before update or delete on public.dlkt_info_shared_cards
  for each row execute function dlkt_info_private.prevent_share_archive_mutation();
create trigger dlkt_info_shared_cards_no_truncate before truncate on public.dlkt_info_shared_cards
  for each statement execute function dlkt_info_private.prevent_share_archive_mutation();

create function public.dlkt_info_capture_shared_card(p_card jsonb, p_captured_at timestamptz, p_source_check_expires_at timestamptz, p_partial boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare supplied text; expected text; stored public.dlkt_info_shared_cards%rowtype;
begin
  begin supplied := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-dlkt-share-write','');
  exception when others then raise exception using errcode='42501', message='SHARE_ARCHIVE_WRITE_DENIED'; end;
  select key_hash into expected from dlkt_info_private.share_archive_writer where singleton;
  if supplied !~ '^[A-Za-z0-9_-]{43,128}$' or expected is null or encode(sha256(convert_to(supplied,'UTF8')),'hex') <> expected then
    raise exception using errcode='42501', message='SHARE_ARCHIVE_WRITE_DENIED';
  end if;
  if not dlkt_info_private.valid_share_archive_card(p_card) or p_partial is null
    or p_captured_at is null or not isfinite(p_captured_at) or p_source_check_expires_at is null or not isfinite(p_source_check_expires_at)
    or p_captured_at not between clock_timestamp() - interval '5 minutes' and clock_timestamp() + interval '5 minutes'
    or p_source_check_expires_at <= p_captured_at then
    raise exception using errcode='22023', message='SHARE_ARCHIVE_INVALID';
  end if;
  insert into public.dlkt_info_shared_cards(id,revision,card,captured_at,source_check_expires_at,partial)
    values(p_card->>'id',p_card->>'contentHash',p_card,p_captured_at,p_source_check_expires_at,p_partial)
    on conflict (id,revision) do nothing;
  select * into strict stored from public.dlkt_info_shared_cards where id=p_card->>'id' and revision=p_card->>'contentHash';
  return to_jsonb(stored);
end $$;

revoke all on function dlkt_info_private.share_archive_content(jsonb) from public, anon, authenticated, service_role;
revoke all on function dlkt_info_private.valid_share_archive_card(jsonb) from public, anon, authenticated, service_role;
revoke all on function dlkt_info_private.prevent_share_archive_mutation() from public, anon, authenticated, service_role;
revoke all on function public.dlkt_info_capture_shared_card(jsonb,timestamptz,timestamptz,boolean) from public, anon, authenticated, service_role;
grant execute on function public.dlkt_info_capture_shared_card(jsonb,timestamptz,timestamptz,boolean) to anon, authenticated, service_role;
comment on table public.dlkt_info_shared_cards is 'Immutable public source metadata captured after a server-owned source check. Historical evidence, never a current re-verification or private user content.';
comment on table dlkt_info_private.share_archive_writer is 'Private SHA256 of the purpose-bound writer header. No readable credential, public grant or provisioning RPC.';

-- Readiness extension copied from 20261119142617_dlkt_info_public_acl_attestation.
-- Delta: exact new object/function/role allowlist entries; pg_trigger enumeration
-- (including TRUNCATE); archive-only exact grants/policy/trigger/search_path checks;
-- new manifest fingerprint and CLI revision. No original ACL denial is relaxed.
create or replace function public.dlkt_info_read_database_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_required_relations text[] := array[
    'dlkt_info_private.briefing_card_claims',
    'dlkt_info_private.claim_evidence',
    'dlkt_info_private.claims',
    'dlkt_info_private.delivery_endpoint_secrets',
    'dlkt_info_private.delivery_outbox',
    'dlkt_info_private.entities',
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'dlkt_info_private.source_acquisition_events',
    'dlkt_info_private.source_acquisition_state',
    'dlkt_info_private.source_claim_batch_items',
    'dlkt_info_private.source_claim_batches',
    'dlkt_info_private.source_registry',
    'dlkt_info_private.system_identity',
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory',
    'dlkt_info_private.share_archive_writer',
    'public.dlkt_info_shared_cards'
  ]::text[];
  v_private_relations text[] := array[
    'dlkt_info_private.briefing_card_claims',
    'dlkt_info_private.claim_evidence',
    'dlkt_info_private.claims',
    'dlkt_info_private.delivery_endpoint_secrets',
    'dlkt_info_private.delivery_outbox',
    'dlkt_info_private.entities',
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'dlkt_info_private.source_acquisition_events',
    'dlkt_info_private.source_acquisition_state',
    'dlkt_info_private.source_claim_batch_items',
    'dlkt_info_private.source_claim_batches',
    'dlkt_info_private.source_registry',
    'dlkt_info_private.system_identity',
    'dlkt_info_private.share_archive_writer'
  ]::text[];
  v_required_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()',
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_public_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_private_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()'
  ]::text[];
  v_required_rls text[] := array[
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory',
    'dlkt_info_private.share_archive_writer',
    'public.dlkt_info_shared_cards'
  ]::text[];
  v_required_policies text[] := array[
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_events.dlkt_info_briefing_events_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_delete_own:DELETE:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_insert_own:INSERT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_update_own:UPDATE:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_delete_own:DELETE:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_insert_own:INSERT:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_select_own:SELECT:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_update_own:UPDATE:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_delete_own:DELETE:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_insert_own:INSERT:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_select_own:SELECT:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_update_own:UPDATE:authenticated',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_select_own:SELECT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_delete_own:DELETE:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_insert_own:INSERT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_select_own:SELECT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_update_own:UPDATE:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_insert_own:INSERT:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_select_own:SELECT:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_update_own:UPDATE:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_delete_own:DELETE:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_insert_own:INSERT:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_select_own:SELECT:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_update_own:UPDATE:authenticated',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_public_read:SELECT:anon,authenticated,service_role'
  ]::text[];
  v_required_triggers text[] := array[
    'auth.users.on_auth_user_created_dlkt_info',
    'dlkt_info_private.briefing_card_claims.dlkt_info_card_claims_append_only',
    'dlkt_info_private.claim_evidence.dlkt_info_claim_evidence_append_only',
    'dlkt_info_private.claims.dlkt_info_claims_append_only',
    'dlkt_info_private.delivery_endpoint_secrets.dlkt_info_delivery_endpoint_secrets_touch',
    'dlkt_info_private.entities.dlkt_info_entities_touch',
    'dlkt_info_private.internal_delta_jobs.dlkt_info_internal_delta_jobs_touch',
    'dlkt_info_private.internal_delta_review_events.dlkt_info_internal_delta_review_events_immutable',
    'dlkt_info_private.internal_delta_trial_card_claims.dlkt_info_internal_delta_trial_card_claims_immutable',
    'dlkt_info_private.internal_delta_trials.dlkt_info_internal_delta_trials_touch',
    'dlkt_info_private.source_acquisition_events.dlkt_info_source_acquisition_events_immutable',
    'dlkt_info_private.source_acquisition_state.dlkt_info_source_acquisition_state_touch',
    'dlkt_info_private.source_claim_batch_items.dlkt_info_source_claim_batch_items_immutable',
    'dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_enqueue_internal_delta',
    'dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_immutable',
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_append_only',
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_owner',
    'public.dlkt_info_briefing_events.dlkt_info_briefing_events_append_only',
    'public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_owner',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_touch',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_validate',
    'public.dlkt_info_briefings.dlkt_info_briefings_default_web_target',
    'public.dlkt_info_briefings.dlkt_info_briefings_protect_system_fields',
    'public.dlkt_info_briefings.dlkt_info_briefings_schedule',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_protect_system_fields',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_touch',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_append_only',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_owner',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_touch',
    'public.dlkt_info_profiles.dlkt_info_profiles_protect_system_fields',
    'public.dlkt_info_profiles.dlkt_info_profiles_touch',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_touch',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_immutable',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_no_truncate'
  ]::text[];
  v_public_anon_functions text[] := array[
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_public_authenticated_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_public_service_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_private_authenticated_functions text[] := array[
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)'
  ]::text[];
  v_private_service_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()'
  ]::text[];
  v_public_definer_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)'
  ]::text[];
  v_public_invoker_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)'
  ]::text[];
  v_private_definer_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.validate_briefing_target()'
  ]::text[];
  v_private_invoker_functions text[] := array[
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()'
  ]::text[];
  -- Manifest v3 uses effective privileges (including inherited/PUBLIC grants).
  -- MAINTAIN was introduced in PostgreSQL 17; never ask older servers about it.
  v_table_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[]
    || case when current_setting('server_version_num')::integer >= 170000 then array['MAINTAIN']::text[] else array[]::text[] end;
  v_column_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[];
  v_sequence_privileges text[] := array['USAGE', 'SELECT', 'UPDATE']::text[];
  v_public_relations text[] := array[
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory'
  ]::text[];
  v_public_authenticated_tables jsonb := '{"public.dlkt_info_briefing_cards":["SELECT"],"public.dlkt_info_briefing_events":["SELECT"],"public.dlkt_info_briefing_runs":["SELECT"],"public.dlkt_info_briefing_targets":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_briefings":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_delivery_endpoints":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_delivery_receipts":["SELECT"],"public.dlkt_info_interest_rules":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_profiles":["SELECT","INSERT","UPDATE"],"public.dlkt_info_user_memory":["SELECT","INSERT","UPDATE","DELETE"]}'::jsonb;
  v_event_sequence oid;
  v_public_data_permissions_ok boolean := false;
  v_instance_id uuid;
  v_relations_present integer := 0;
  v_relations_total integer := 0;
  v_functions_present integer := 0;
  v_functions_total integer := 0;
  v_rls_present integer := 0;
  v_rls_total integer := 0;
  v_policies_present integer := 0;
  v_policies_total integer := 0;
  v_triggers_present integer := 0;
  v_triggers_total integer := 0;
  v_identity_ok boolean := false;
  v_relations_ok boolean := false;
  v_functions_ok boolean := false;
  v_rls_ok boolean := false;
  v_policies_ok boolean := false;
  v_triggers_ok boolean := false;
  v_private_schema_ok boolean := false;
  v_private_tables_ok boolean := false;
  v_public_rpc_permissions_ok boolean := false;
  v_private_function_permissions_ok boolean := false;
  v_security_definer_ok boolean := false;
  v_search_path_ok boolean := false;
  v_no_unexpected_objects boolean := false;
  v_ready boolean := false;
  v_activation_receipt text;
begin
  select instance_id into v_instance_id
  from dlkt_info_private.system_identity
  where singleton
  limit 1;

  select
    count(*) = 1
      and bool_and(product_id = 'dlkt-info')
      and bool_and(engine_id = 'dlkt-info-inphocore-engine-orchestra')
      and bool_and(data_foundation_version = 'dlkt-info-data-1')
      and bool_and(persistence_version = 'dlkt-info-persistence-2')
      and bool_and(schema_revision = '20261113115256_dlkt_info_provisioning_identity_guard')
      and bool_and(data_region = 'eu-central-1')
      and bool_and(dedicated)
      and bool_and(not automatic_execution)
      and bool_and(not public_cards_enabled)
  into v_identity_ok
  from dlkt_info_private.system_identity;

  select count(*) into v_relations_present
  from unnest(v_required_relations) as required(relation_name)
  where to_regclass(required.relation_name) is not null;

  select count(*) into v_relations_total
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and (n.nspname = 'dlkt_info_private' or (n.nspname = 'public' and c.relname like 'dlkt_info_%'));

  v_relations_ok := v_relations_present = cardinality(v_required_relations);

  select count(*) into v_functions_present
  from unnest(v_required_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select count(*) into v_functions_total
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'public' and p.proname like 'dlkt_info_%')
     or n.nspname = 'dlkt_info_private';

  v_functions_ok := v_functions_present = cardinality(v_required_functions);

  select count(*) into v_rls_present
  from unnest(v_required_rls) as required(relation_name)
  join pg_class c on c.oid = to_regclass(required.relation_name)
  where c.relrowsecurity;

  select count(*) into v_rls_total
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and c.relrowsecurity
    and (n.nspname = 'dlkt_info_private' or (n.nspname = 'public' and c.relname like 'dlkt_info_%'));

  v_rls_ok := v_rls_present = cardinality(v_required_rls);

  select count(*) into v_policies_present
  from unnest(v_required_policies) as required(policy_signature)
  where exists (
    select 1 from pg_policies p
    where format('%s.%s.%s:%s:%s', p.schemaname, p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ',')) = required.policy_signature
  );

  select count(*) into v_policies_total
  from pg_policies p
  where p.schemaname in ('public', 'dlkt_info_private')
    and (p.schemaname = 'dlkt_info_private' or p.tablename like 'dlkt_info_%');

  v_policies_ok := v_policies_present = cardinality(v_required_policies);

  -- pg_trigger preserves the original non-internal trigger scope and also sees
  -- statement TRUNCATE triggers, which information_schema.triggers omits.
  select count(*) into v_triggers_present
  from unnest(v_required_triggers) as required(trigger_signature)
  where exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgenabled in ('O','A')
      and format('%s.%s.%s', n.nspname, c.relname, t.tgname) = required.trigger_signature
  );

  select count(*) into v_triggers_total
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and (
    (n.nspname in ('public','dlkt_info_private') and (n.nspname='dlkt_info_private' or c.relname like 'dlkt_info_%'))
    or (n.nspname='auth' and c.relname='users' and t.tgname='on_auth_user_created_dlkt_info')
  );

  v_triggers_ok := v_triggers_present = cardinality(v_required_triggers);

  v_private_schema_ok :=
    not has_schema_privilege('anon', 'dlkt_info_private', 'USAGE')
    and has_schema_privilege('authenticated', 'dlkt_info_private', 'USAGE')
    and has_schema_privilege('service_role', 'dlkt_info_private', 'USAGE');

  -- The private table boundary has the same deny-all semantics for untrusted
  -- roles as before, now including every table/column privilege and grant option.
  select coalesce(bool_and(coalesce(
    not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
  , false)), false) into v_private_tables_ok
  from unnest(v_private_relations) as required(relation_name)
  cross join unnest(v_table_privileges) as privilege(name);

  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(coalesce(
      not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    , false))
    from unnest(v_private_relations) as required(relation_name)
    cross join unnest(v_column_privileges) as privilege(name)
  ), false);

  -- The authenticated table operations are an exact set, never merely required
  -- minimums. anon has none; PUBLIC grants are included by privilege inquiry.
  -- All table privileges remain required for the trusted service_role, but its
  -- additional administrative/grant-option privileges are intentionally retained.
  select coalesce(bool_and(coalesce(
    not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
      = ((v_public_authenticated_tables -> required.relation_name) ? privilege.name)
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and has_table_privilege('service_role', to_regclass(required.relation_name), privilege.name)
  , false)), false) into v_public_data_permissions_ok
  from unnest(v_public_relations) as required(relation_name)
  cross join unnest(v_table_privileges) as privilege(name);

  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(coalesce(
      not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
      and has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
        = ((v_public_authenticated_tables -> required.relation_name) ? privilege.name)
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    , false))
    from unnest(v_public_relations) as required(relation_name)
    cross join unnest(v_column_privileges) as privilege(name)
  ), false);

  -- Reject even redundant explicit column grants available to the untrusted
  -- roles, directly or through inherited roles. Table-level grants above are
  -- the sole intended source of their column privileges.
  v_public_data_permissions_ok := v_public_data_permissions_ok and not exists (
    select 1
    from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl) > 0 then a.attacl end) as acl
    where a.attrelid = any(array(select to_regclass(r) from unnest(v_public_relations) as r))
      and a.attnum > 0 and not a.attisdropped
      and case when acl.grantee = 0 then true else
        pg_has_role('anon', acl.grantee, 'USAGE') or pg_has_role('authenticated', acl.grantee, 'USAGE')
      end
  );
  v_private_tables_ok := v_private_tables_ok and not exists (
    select 1
    from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl) > 0 then a.attacl end) as acl
    where a.attrelid = any(array(select to_regclass(r) from unnest(v_private_relations) as r))
      and a.attnum > 0 and not a.attisdropped
      and case when acl.grantee = 0 then true else
        pg_has_role('anon', acl.grantee, 'USAGE') or pg_has_role('authenticated', acl.grantee, 'USAGE')
      end
  );

  select c.oid into v_event_sequence
  from pg_class c
  where c.oid = to_regclass('public.dlkt_info_briefing_events_id_seq') and c.relkind = 'S';

  v_public_data_permissions_ok := v_public_data_permissions_ok
    and v_event_sequence is not null
    and coalesce((
      select bool_and(coalesce(
        not has_sequence_privilege('anon', v_event_sequence, privilege.name)
        and not has_sequence_privilege('anon', v_event_sequence, privilege.name || ' WITH GRANT OPTION')
        and not has_sequence_privilege('authenticated', v_event_sequence, privilege.name)
        and not has_sequence_privilege('authenticated', v_event_sequence, privilege.name || ' WITH GRANT OPTION')
      , false))
      from unnest(v_sequence_privileges) as privilege(name)
    ), false)
    and coalesce(has_sequence_privilege('service_role', v_event_sequence, 'USAGE'), false)
    and coalesce(has_sequence_privilege('service_role', v_event_sequence, 'SELECT'), false);

  select coalesce(bool_and(
    has_function_privilege('service_role', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_service_functions))
    and has_function_privilege('anon', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_anon_functions))
    and has_function_privilege('authenticated', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_authenticated_functions))
  ), false) into v_public_rpc_permissions_ok
  from unnest(v_public_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select coalesce(bool_and(
    not has_function_privilege('anon', to_regprocedure(required.function_signature), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_private_authenticated_functions))
    and has_function_privilege('service_role', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_private_service_functions))
  ), false) into v_private_function_permissions_ok
  from unnest(v_private_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select coalesce(bool_and(
    p.prosecdef = (required.function_signature = any(v_public_definer_functions))
    and (p.prosecdef or required.function_signature = any(v_public_invoker_functions))
  ), false) into v_security_definer_ok
  from unnest(v_public_functions) as required(function_signature)
  join pg_proc p on p.oid = to_regprocedure(required.function_signature);

  v_security_definer_ok := v_security_definer_ok and coalesce((
    select bool_and(
      p.prosecdef = (required.function_signature = any(v_private_definer_functions))
      and (p.prosecdef or required.function_signature = any(v_private_invoker_functions))
    )
    from unnest(v_private_functions) as required(function_signature)
    join pg_proc p on p.oid = to_regprocedure(required.function_signature)
  ), false);

  select coalesce(bool_and(exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as config(value) where config.value like 'search_path=%'
  )), false) into v_search_path_ok
  from unnest(v_required_functions) as required(function_signature)
  join pg_proc p on p.oid = to_regprocedure(required.function_signature);

  -- Archive-only additions. The ten existing public table ACLs and all existing
  -- private-data checks above remain unchanged; this is a separate exact public
  -- copy table and a secret hash table with stricter service-role restrictions.
  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(
      has_table_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name) = (privilege.name='SELECT')
      and not has_table_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(
      has_any_column_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name) = (privilege.name='SELECT')
      and not has_any_column_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false);
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(
      not has_table_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name)
      and not has_table_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(
      not has_any_column_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name)
      and not has_any_column_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false);
  v_public_data_permissions_ok := v_public_data_permissions_ok and not exists (
    select 1 from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='public.dlkt_info_shared_cards'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else
        pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  ) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid='public.dlkt_info_shared_cards'::regclass and acl.grantee=0
  );
  v_private_tables_ok := v_private_tables_ok and not exists (
    select 1 from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='dlkt_info_private.share_archive_writer'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else
        pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_policies_ok := v_policies_ok and exists (
    select 1 from pg_policy p where p.polrelid='public.dlkt_info_shared_cards'::regclass
      and p.polname='dlkt_info_shared_cards_public_read' and p.polcmd='r' and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null
  );
  v_triggers_ok := v_triggers_ok and exists (
    select 1 from pg_trigger t where t.tgrelid='public.dlkt_info_shared_cards'::regclass
      and t.tgname='dlkt_info_shared_cards_immutable' and t.tgtype=27 and t.tgenabled in ('O','A')
      and t.tgfoid='dlkt_info_private.prevent_share_archive_mutation()'::regprocedure
  ) and exists (
    select 1 from pg_trigger t where t.tgrelid='public.dlkt_info_shared_cards'::regclass
      and t.tgname='dlkt_info_shared_cards_no_truncate' and t.tgtype=34 and t.tgenabled in ('O','A')
      and t.tgfoid='dlkt_info_private.prevent_share_archive_mutation()'::regprocedure
  );
  v_search_path_ok := v_search_path_ok and coalesce((
    select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid = any(array[
      'dlkt_info_private.share_archive_content(jsonb)'::regprocedure,
      'dlkt_info_private.valid_share_archive_card(jsonb)'::regprocedure,
      'dlkt_info_private.prevent_share_archive_mutation()'::regprocedure,
      'public.dlkt_info_capture_shared_card(jsonb,timestamptz,timestamptz,boolean)'::regprocedure
    ])
  ),false);

  v_no_unexpected_objects :=
    v_relations_total = cardinality(v_required_relations)
    and v_functions_total = cardinality(v_required_functions)
    and v_rls_total = cardinality(v_required_rls)
    and v_policies_total = cardinality(v_required_policies)
    and v_triggers_total = cardinality(v_required_triggers);

  v_ready :=
    v_identity_ok
    and v_relations_ok
    and v_functions_ok
    and v_rls_ok
    and v_policies_ok
    and v_triggers_ok
    and v_private_schema_ok
    and v_private_tables_ok
    and v_public_data_permissions_ok
    and v_public_rpc_permissions_ok
    and v_private_function_permissions_ok
    and v_security_definer_ok
    and v_search_path_ok
    and v_no_unexpected_objects;

  if v_ready then
    v_activation_receipt := encode(sha256(convert_to(
      v_instance_id::text || ':' || '2046fac81fee84aba2c66b69a3e9141286598a17eab8456d7f8a309dc9cf368b' || ':' || '20261120184745_dlkt_info_public_share_archive',
      'UTF8'
    )), 'hex');
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-database-readiness-2',
    'instanceId', v_instance_id,
    'schemaRevision', '20261120184745_dlkt_info_public_share_archive',
    'schemaFingerprint', '2046fac81fee84aba2c66b69a3e9141286598a17eab8456d7f8a309dc9cf368b',
    'activationReceipt', v_activation_receipt,
    'ready', v_ready,
    'counts', jsonb_build_object(
      'relationsExpected', cardinality(v_required_relations),
      'relationsPresent', v_relations_present,
      'relationsTotal', v_relations_total,
      'functionsExpected', cardinality(v_required_functions),
      'functionsPresent', v_functions_present,
      'functionsTotal', v_functions_total,
      'rlsExpected', cardinality(v_required_rls),
      'rlsPresent', v_rls_present,
      'rlsTotal', v_rls_total,
      'policiesExpected', cardinality(v_required_policies),
      'policiesPresent', v_policies_present,
      'policiesTotal', v_policies_total,
      'triggersExpected', cardinality(v_required_triggers),
      'triggersPresent', v_triggers_present,
      'triggersTotal', v_triggers_total
    ),
    'checks', jsonb_build_object(
      'identity', v_identity_ok,
      'relations', v_relations_ok,
      'functions', v_functions_ok,
      'rls', v_rls_ok,
      'policies', v_policies_ok,
      'triggers', v_triggers_ok,
      'privateSchema', v_private_schema_ok,
      'privateTables', v_private_tables_ok,
      'publicDataPermissions', v_public_data_permissions_ok,
      'publicRpcPermissions', v_public_rpc_permissions_ok,
      'privateFunctionPermissions', v_private_function_permissions_ok,
      'securityDefiner', v_security_definer_ok,
      'searchPath', v_search_path_ok,
      'noUnexpectedObjects', v_no_unexpected_objects
    ),
    'automaticExecution', false,
    'publicCardsEnabled', false
  );
end;
$$;

revoke all on function public.dlkt_info_read_database_readiness() from public, anon, authenticated;
grant execute on function public.dlkt_info_read_database_readiness() to anon, authenticated, service_role;

comment on function public.dlkt_info_read_database_readiness() is
  'Readiness v2 / schema manifest v4: bounded non-secret attestation including exact existing table ACLs and narrowly authorized immutable public archive objects. Service-role administrative rights are preserved. No activation receipt is returned after detected schema or ACL drift.';

commit;
