begin;

-- Normalize only the ten existing public product tables and their event sequence.
-- RLS does not constrain TRUNCATE, REFERENCES, TRIGGER or grant options. Explicit
-- column ACLs are cleared too; inherited excess rights are detected by readiness.
-- CASCADE removes dependent grants derived from the revoked untrusted grants on
-- these same objects. No global/default ACL, role membership or unrelated object
-- is changed. Trusted service_role administrative rights are preserved.
do $public_acl$
declare
  v_relations text[] := array[
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
  v_relation text;
  v_columns text;
begin
  foreach v_relation in array v_relations loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
    into v_columns
    from pg_attribute a
    where a.attrelid = to_regclass(v_relation) and a.attnum > 0 and not a.attisdropped;
    if v_columns is not null then
      execute format('revoke all privileges (%s) on table %s from public, anon, authenticated cascade', v_columns, v_relation);
    end if;
    execute format('revoke all privileges on table %s from public, anon, authenticated cascade', v_relation);
  end loop;
end;
$public_acl$;

revoke all privileges on sequence public.dlkt_info_briefing_events_id_seq from public, anon, authenticated cascade;

grant select on table public.dlkt_info_briefing_cards to authenticated;
grant select on table public.dlkt_info_briefing_events to authenticated;
grant select on table public.dlkt_info_briefing_runs to authenticated;
grant select, insert, update, delete on table public.dlkt_info_briefing_targets to authenticated;
grant select, insert, update, delete on table public.dlkt_info_briefings to authenticated;
grant select, insert, update, delete on table public.dlkt_info_delivery_endpoints to authenticated;
grant select on table public.dlkt_info_delivery_receipts to authenticated;
grant select, insert, update, delete on table public.dlkt_info_interest_rules to authenticated;
grant select, insert, update on table public.dlkt_info_profiles to authenticated;
grant select, insert, update, delete on table public.dlkt_info_user_memory to authenticated;

-- Preserve the established service grants; do not remove additional trusted rights.
grant all privileges on table
  public.dlkt_info_briefing_cards,
  public.dlkt_info_briefing_events,
  public.dlkt_info_briefing_runs,
  public.dlkt_info_briefing_targets,
  public.dlkt_info_briefings,
  public.dlkt_info_delivery_endpoints,
  public.dlkt_info_delivery_receipts,
  public.dlkt_info_interest_rules,
  public.dlkt_info_profiles,
  public.dlkt_info_user_memory
to service_role;
grant usage, select on sequence public.dlkt_info_briefing_events_id_seq to service_role;

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
    'public.dlkt_info_user_memory'
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
    'dlkt_info_private.system_identity'
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
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)'
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
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)'
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
    'dlkt_info_private.validate_briefing_target()'
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
    'public.dlkt_info_user_memory'
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
    'public.dlkt_info_user_memory.dlkt_info_user_memory_update_own:UPDATE:authenticated'
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
    'public.dlkt_info_user_memory.dlkt_info_user_memory_touch'
  ]::text[];
  v_public_anon_functions text[] := array[
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()'
  ]::text[];
  v_public_authenticated_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)'
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
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)'
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
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)'
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
    'dlkt_info_private.touch_updated_at()'
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

  select count(*) into v_triggers_present
  from unnest(v_required_triggers) as required(trigger_signature)
  where exists (
    select 1 from information_schema.triggers t
    where format('%s.%s.%s', t.event_object_schema, t.event_object_table, t.trigger_name) = required.trigger_signature
  );

  select count(*) into v_triggers_total
  from (
    select distinct t.event_object_schema, t.event_object_table, t.trigger_name
    from information_schema.triggers t
    where (t.event_object_schema in ('public', 'dlkt_info_private')
      and (t.event_object_schema = 'dlkt_info_private' or t.event_object_table like 'dlkt_info_%'))
      or (t.event_object_schema = 'auth' and t.event_object_table = 'users' and t.trigger_name = 'on_auth_user_created_dlkt_info')
  ) as relevant_triggers;

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
      v_instance_id::text || ':' || 'a57f050de7d0516ce8f7b45db43098a8086688a06c1fc27efcdd4e0352e21420' || ':' || '20261119142617_dlkt_info_public_acl_attestation',
      'UTF8'
    )), 'hex');
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-database-readiness-2',
    'instanceId', v_instance_id,
    'schemaRevision', '20261119142617_dlkt_info_public_acl_attestation',
    'schemaFingerprint', 'a57f050de7d0516ce8f7b45db43098a8086688a06c1fc27efcdd4e0352e21420',
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
  'Readiness v2 / schema manifest v3: bounded non-secret attestation including exact untrusted public table, column and sequence privileges. Service-role administrative rights are preserved. No activation receipt is returned after detected schema or ACL drift.';

commit;
