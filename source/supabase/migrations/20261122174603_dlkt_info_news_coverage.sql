-- Reviewed national Romanian sources: Digi24 and HotNews.ro.
-- Feed probes: GitHub Actions45050736033, 2026-11-22. Metadata only; no article body or image license grant.
-- Preserves all prior origins, URL validation, writer authentication, grants, RLS and private data.
begin;

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_news_candidate_publisher(p_publisher text, p_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare origins constant jsonb := '{"https://www.reuters.com":"Reuters","https://reuters.com":"Reuters","https://apnews.com":"Associated Press","https://www.apnews.com":"Associated Press","https://www.bbc.com":"BBC","https://bbc.com":"BBC","https://www.bbc.co.uk":"BBC","https://bbc.co.uk":"BBC","https://www.theguardian.com":"The Guardian","https://theguardian.com":"The Guardian","https://www.ft.com":"Financial Times","https://ft.com":"Financial Times","https://www.cnbc.com":"CNBC","https://cnbc.com":"CNBC","https://www.france24.com":"France 24","https://france24.com":"France 24","https://www.dw.com":"DW","https://dw.com":"DW","https://amp.dw.com":"DW","https://www.aljazeera.com":"Al Jazeera","https://aljazeera.com":"Al Jazeera","https://www.npr.org":"NPR","https://npr.org":"NPR","https://www.rte.ie":"RTE","https://rte.ie":"RTE","https://www.cnn.com":"CNN","https://cnn.com":"CNN","https://edition.cnn.com":"CNN","https://www.abc.net.au":"ABC Australia","https://abc.net.au":"ABC Australia","https://www.cbc.ca":"CBC","https://cbc.ca":"CBC","https://www.euronews.com":"Euronews","https://euronews.com":"Euronews","https://www.politico.com":"POLITICO","https://politico.com":"POLITICO","https://www.politico.eu":"POLITICO","https://politico.eu":"POLITICO","https://www.bloomberg.com":"Bloomberg","https://bloomberg.com":"Bloomberg","https://www.businessinsider.com":"Business Insider","https://businessinsider.com":"Business Insider","https://fortune.com":"Fortune","https://www.fortune.com":"Fortune","https://techcrunch.com":"TechCrunch","https://www.techcrunch.com":"TechCrunch","https://www.theverge.com":"The Verge","https://theverge.com":"The Verge","https://arstechnica.com":"Ars Technica","https://www.arstechnica.com":"Ars Technica","https://www.wired.com":"WIRED","https://wired.com":"WIRED","https://www.engadget.com":"Engadget","https://engadget.com":"Engadget","https://blogs.nvidia.com":"NVIDIA","https://nvidianews.nvidia.com":"NVIDIA","https://www.anthropic.com":"Anthropic","https://anthropic.com":"Anthropic","https://www.rockstargames.com":"Rockstar Games","https://rockstargames.com":"Rockstar Games","https://blog.playstation.com":"PlayStation","https://www.ign.com":"IGN","https://ign.com":"IGN","https://www.pcgamer.com":"PC Gamer","https://pcgamer.com":"PC Gamer","https://www.eurogamer.net":"Eurogamer","https://eurogamer.net":"Eurogamer","https://www.gamespot.com":"GameSpot","https://gamespot.com":"GameSpot","https://variety.com":"Variety","https://www.variety.com":"Variety","https://www.billboard.com":"Billboard","https://billboard.com":"Billboard","https://www.hollywoodreporter.com":"The Hollywood Reporter","https://hollywoodreporter.com":"The Hollywood Reporter","https://deadline.com":"Deadline","https://www.deadline.com":"Deadline","https://www.espn.com":"ESPN","https://espn.com":"ESPN","https://global.espn.com":"ESPN","https://africa.espn.com":"ESPN","https://www.skysports.com":"Sky Sports","https://skysports.com":"Sky Sports","https://www.olympics.com":"Olympics","https://olympics.com":"Olympics","https://www.parents.com":"Parents","https://parents.com":"Parents","https://www.edweek.org":"Education Week","https://edweek.org":"Education Week","https://www.nature.com":"Nature","https://nature.com":"Nature","https://www.science.org":"Science","https://science.org":"Science","https://www.livescience.com":"Live Science","https://livescience.com":"Live Science","https://www.scientificamerican.com":"Scientific American","https://scientificamerican.com":"Scientific American","https://www.space.com":"Space.com","https://space.com":"Space.com","https://www.nationalgeographic.com":"National Geographic","https://nationalgeographic.com":"National Geographic","https://www.newscientist.com":"New Scientist","https://newscientist.com":"New Scientist","https://www.travelandleisure.com":"Travel + Leisure","https://travelandleisure.com":"Travel + Leisure","https://skift.com":"Skift","https://www.skift.com":"Skift","https://www.lonelyplanet.com":"Lonely Planet","https://lonelyplanet.com":"Lonely Planet","https://www.cntraveler.com":"Conde Nast Traveler","https://cntraveler.com":"Conde Nast Traveler","https://www.goodhousekeeping.com":"Good Housekeeping","https://goodhousekeeping.com":"Good Housekeeping","https://www.consumerreports.org":"Consumer Reports","https://consumerreports.org":"Consumer Reports","https://www.which.co.uk":"Which?","https://which.co.uk":"Which?","https://www.foodandwine.com":"Food & Wine","https://foodandwine.com":"Food & Wine","https://www.foodsafetynews.com":"Food Safety News","https://foodsafetynews.com":"Food Safety News","https://www.architecturaldigest.com":"Architectural Digest","https://architecturaldigest.com":"Architectural Digest","https://www.dezeen.com":"Dezeen","https://dezeen.com":"Dezeen","https://weather.com":"The Weather Channel","https://www.weather.com":"The Weather Channel","https://www.accuweather.com":"AccuWeather","https://accuweather.com":"AccuWeather","https://www.carbonbrief.org":"Carbon Brief","https://carbonbrief.org":"Carbon Brief","https://globalvoices.org":"Global Voices","https://www.globalvoices.org":"Global Voices","https://360info.org":"360info","https://www.360info.org":"360info","https://www.scmp.com":"South China Morning Post","https://scmp.com":"South China Morning Post","https://www.thehindu.com":"The Hindu","https://thehindu.com":"The Hindu","https://www.japantimes.co.jp":"The Japan Times","https://japantimes.co.jp":"The Japan Times","https://www.channelnewsasia.com":"CNA","https://channelnewsasia.com":"CNA","https://www.straitstimes.com":"The Straits Times","https://straitstimes.com":"The Straits Times","https://www.nytimes.com":"The New York Times","https://nytimes.com":"The New York Times","https://www.digi24.ro":"Digi24","https://hotnews.ro":"HotNews.ro"}'::jsonb; origin text; path text;
begin
  if p_url is null or p_publisher is null or length(p_url) not between 1 and 3000
    or p_url ~ '[[:space:]#<>\\]' then return false; end if;
  origin := substring(p_url from '^(https://[^/?#]+)');
  path := substring(p_url from '^https://[^/?#]+(/[^?#]*)');
  if origin is null or origins->>origin is distinct from p_publisher or path is null or path='/'
    or lower(path) ~ '/(login|signin|sign-in|account|subscribe|search|api)(/|$)'
    or lower(path) ~ '(^|/)([.]|%2e){1,2}(/|$)'
    or lower(p_url) ~ '[?&](utm_[^=&]*|fbclid|gclid|mc_cid|mc_eid)(=|&|$)'
    or p_url ~ '[?&][^=&]*%[^=&]*(=|&|$)' then return false; end if;
  return true;
end $function$
;

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
    'public.dlkt_info_shared_cards',
    'public.dlkt_info_news_candidates',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs'
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
    'dlkt_info_private.share_archive_writer',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs'
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
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'dlkt_info_private.prevent_share_archive_mutation()',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'
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
    'public.dlkt_info_shared_cards',
    'public.dlkt_info_news_candidates',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs'
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
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_public_read:SELECT:anon,authenticated,service_role',
    'public.dlkt_info_news_candidates.dlkt_info_news_candidates_public_read:SELECT:anon,authenticated,service_role'
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
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
  ]::text[];
  v_public_authenticated_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'dlkt_info_private.prevent_share_archive_mutation()',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'
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

  -- Public candidate cache retains strict SELECT-only application roles.
  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(has_table_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name)=(privilege.name='SELECT')
      and not has_table_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(has_any_column_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name)=(privilege.name='SELECT')
      and not has_any_column_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid='public.dlkt_info_news_candidates'::regclass and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='public.dlkt_info_news_candidates'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_policies_ok := v_policies_ok and exists (
    select 1 from pg_policy p where p.polrelid='public.dlkt_info_news_candidates'::regclass
      and p.polname='dlkt_info_news_candidates_public_read' and p.polcmd='r' and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null
  );
  v_search_path_ok := v_search_path_ok and coalesce((
    select bool_and(p.proconfig @> array['search_path=""']::text[]) from pg_proc p
    where p.oid=any(array['dlkt_info_private.valid_news_candidate_publisher(text,text)'::regprocedure,
      'dlkt_info_private.valid_news_candidate(jsonb,timestamptz)'::regprocedure,'public.dlkt_info_upsert_news_candidates(jsonb)'::regprocedure])
  ),false);

  -- Unclassified candidates remain nullable text, with the existing non-null category constraint intact.
  v_public_data_permissions_ok := v_public_data_permissions_ok and exists (
    select 1 from pg_attribute a where a.attrelid='public.dlkt_info_news_candidates'::regclass
      and a.attname='category' and not a.attisdropped and not a.attnotnull and a.atttypid='text'::regtype
  ) and exists (
    select 1 from pg_constraint c where c.conrelid='public.dlkt_info_news_candidates'::regclass
      and c.conname='dlkt_info_news_candidates_category_check' and c.contype='c' and c.convalidated
      and pg_get_expr(c.conbin,c.conrelid)='(category = ANY (ARRAY[''world''::text, ''business''::text, ''technology''::text, ''money''::text, ''health''::text, ''sport''::text, ''gaming''::text, ''culture''::text, ''shopping''::text, ''travel''::text, ''work''::text, ''education''::text, ''family''::text, ''science''::text, ''environment''::text, ''public-affairs''::text, ''digital-life''::text, ''food''::text, ''housing''::text, ''weather''::text]))'
  );
  -- Continuous refresh state and receipts are private even from service-role REST access.
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(not has_table_privilege(role.name,relation.name,privilege.name)
      and not has_table_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.public_refresh_state','dlkt_info_private.public_refresh_runs']) relation(name)
    cross join unnest(v_table_privileges) privilege(name)
  ),false) and coalesce((
    select bool_and(not has_any_column_privilege(role.name,relation.name,privilege.name)
      and not has_any_column_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.public_refresh_state','dlkt_info_private.public_refresh_runs']) relation(name)
    cross join unnest(v_column_privileges) privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass]) and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass]) and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_search_path_ok := v_search_path_ok and coalesce((select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure])),false);
  v_public_rpc_permissions_ok := v_public_rpc_permissions_ok and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
    where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure]) and acl.grantee=0
  ) and coalesce((select bool_and(not has_function_privilege(role.name,p.oid,'EXECUTE WITH GRANT OPTION'))
    from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role(name)
    where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure])),false);

  -- This forward change admits only the two reviewed national Romanian publisher origins.
  v_public_data_permissions_ok := v_public_data_permissions_ok
    and dlkt_info_private.valid_news_candidate_publisher('Digi24','https://www.digi24.ro/stiri/checked-origin')
    and dlkt_info_private.valid_news_candidate_publisher('HotNews.ro','https://hotnews.ro/checked-origin')
    and not dlkt_info_private.valid_news_candidate_publisher('HotNews.ro','https://www.digi24.ro/stiri/checked-origin')
    and not dlkt_info_private.valid_news_candidate_publisher('Digi24','https://www.digi24.ro.attacker.invalid/stiri/checked-origin');

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
      v_instance_id::text || ':' || '453dbf1779705cff24a46781bbdae8871db5d24af5c3b16a1c85d65af4fc19db' || ':' || '20261122174603_dlkt_info_news_coverage',
      'UTF8'
    )), 'hex');
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-database-readiness-2',
    'instanceId', v_instance_id,
    'schemaRevision', '20261122174603_dlkt_info_news_coverage',
    'schemaFingerprint', '453dbf1779705cff24a46781bbdae8871db5d24af5c3b16a1c85d65af4fc19db',
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
  'Readiness v2 / schema manifest v7: bounded non-secret attestation including exact existing table ACLs and narrowly authorized immutable public archive objects. Service-role administrative rights are preserved. No activation receipt is returned after detected schema or ACL drift.';

commit;
