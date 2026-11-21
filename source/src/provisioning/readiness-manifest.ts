export const DATABASE_READINESS_VERSION = 'dlkt-info-database-readiness-2' as const;
export const SCHEMA_MANIFEST_VERSION = 'dlkt-info-schema-manifest-6' as const;
export const DATABASE_READINESS_RPC = 'dlkt_info_read_database_readiness' as const;
export const DATABASE_READINESS_MIGRATION = '20261121080311_dlkt_info_continuous_refresh' as const;
// SHA-256 of UTF-8 serializeSchemaManifest(); object/array order is part of this versioned contract.
export const EXPECTED_SCHEMA_FINGERPRINT = '481dee0bc8f4c8807fff49856c8aebf399ae637ffbde42a9e3d61ea9340bf240' as const;
export const EXPECTED_SCHEMA_COUNTS = Object.freeze({
  "relations": 32,
  "functions": 58,
  "publicFunctions": 27,
  "privateFunctions": 31,
  "rls": 20,
  "policies": 29,
  "triggers": 34
} as const);
export const EXPECTED_SCHEMA_MANIFEST = Object.freeze({
  "relations": [
    "dlkt_info_private.briefing_card_claims",
    "dlkt_info_private.claim_evidence",
    "dlkt_info_private.claims",
    "dlkt_info_private.delivery_endpoint_secrets",
    "dlkt_info_private.delivery_outbox",
    "dlkt_info_private.entities",
    "dlkt_info_private.internal_delta_jobs",
    "dlkt_info_private.internal_delta_review_events",
    "dlkt_info_private.internal_delta_trial_card_claims",
    "dlkt_info_private.internal_delta_trial_cards",
    "dlkt_info_private.internal_delta_trials",
    "dlkt_info_private.source_acquisition_events",
    "dlkt_info_private.source_acquisition_state",
    "dlkt_info_private.source_claim_batch_items",
    "dlkt_info_private.source_claim_batches",
    "dlkt_info_private.source_registry",
    "dlkt_info_private.system_identity",
    "public.dlkt_info_briefing_cards",
    "public.dlkt_info_briefing_events",
    "public.dlkt_info_briefing_runs",
    "public.dlkt_info_briefing_targets",
    "public.dlkt_info_briefings",
    "public.dlkt_info_delivery_endpoints",
    "public.dlkt_info_delivery_receipts",
    "public.dlkt_info_interest_rules",
    "public.dlkt_info_profiles",
    "public.dlkt_info_user_memory",
    "dlkt_info_private.share_archive_writer",
    "public.dlkt_info_shared_cards",
    "public.dlkt_info_news_candidates",
    "dlkt_info_private.public_refresh_state",
    "dlkt_info_private.public_refresh_runs"
  ],
  "functions": [
    "dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)",
    "dlkt_info_private.clean_error_detail(text)",
    "dlkt_info_private.enqueue_internal_delta_job()",
    "dlkt_info_private.ensure_default_web_target()",
    "dlkt_info_private.handle_new_user()",
    "dlkt_info_private.hash_text(text)",
    "dlkt_info_private.internal_claim_payload(uuid)",
    "dlkt_info_private.is_sha256(text)",
    "dlkt_info_private.is_valid_channels(text[])",
    "dlkt_info_private.is_valid_iso_weekdays(smallint[])",
    "dlkt_info_private.is_valid_text_collection(text[], integer, integer)",
    "dlkt_info_private.is_valid_text_set(text[], integer, integer)",
    "dlkt_info_private.is_valid_timezone(text)",
    "dlkt_info_private.prevent_mutation()",
    "dlkt_info_private.protect_briefing_system_fields()",
    "dlkt_info_private.protect_endpoint_system_fields()",
    "dlkt_info_private.protect_profile_system_fields()",
    "dlkt_info_private.require_service_role()",
    "dlkt_info_private.set_briefing_schedule()",
    "dlkt_info_private.set_card_owner()",
    "dlkt_info_private.set_receipt_owner()",
    "dlkt_info_private.set_run_owner()",
    "dlkt_info_private.touch_updated_at()",
    "dlkt_info_private.validate_briefing_target()",
    "public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)",
    "public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)",
    "public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)",
    "public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)",
    "public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)",
    "public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)",
    "public.dlkt_info_read_companion_configuration()",
    "public.dlkt_info_read_database_readiness()",
    "public.dlkt_info_read_internal_delta_review_queue(integer)",
    "public.dlkt_info_read_source_acquisition(text)",
    "public.dlkt_info_read_system_identity()",
    "public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)",
    "public.dlkt_info_recover_expired_leases(timestamp with time zone)",
    "public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)",
    "public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)",
    "public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)",
    "public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)",
    "dlkt_info_private.share_archive_content(jsonb)",
    "dlkt_info_private.valid_share_archive_card(jsonb)",
    "dlkt_info_private.prevent_share_archive_mutation()",
    "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
    "dlkt_info_private.valid_news_candidate_publisher(text, text)",
    "dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)",
    "public.dlkt_info_upsert_news_candidates(jsonb)",
    "dlkt_info_private.require_public_refresh_writer()",
    "dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)",
    "public.dlkt_info_read_public_snapshot()",
    "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
    "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
    "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
  ],
  "publicFunctions": [
    "public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)",
    "public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)",
    "public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)",
    "public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)",
    "public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)",
    "public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)",
    "public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)",
    "public.dlkt_info_read_companion_configuration()",
    "public.dlkt_info_read_database_readiness()",
    "public.dlkt_info_read_internal_delta_review_queue(integer)",
    "public.dlkt_info_read_source_acquisition(text)",
    "public.dlkt_info_read_system_identity()",
    "public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)",
    "public.dlkt_info_recover_expired_leases(timestamp with time zone)",
    "public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)",
    "public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)",
    "public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)",
    "public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)",
    "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
    "public.dlkt_info_upsert_news_candidates(jsonb)",
    "public.dlkt_info_read_public_snapshot()",
    "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
    "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
    "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
  ],
  "privateFunctions": [
    "dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)",
    "dlkt_info_private.clean_error_detail(text)",
    "dlkt_info_private.enqueue_internal_delta_job()",
    "dlkt_info_private.ensure_default_web_target()",
    "dlkt_info_private.handle_new_user()",
    "dlkt_info_private.hash_text(text)",
    "dlkt_info_private.internal_claim_payload(uuid)",
    "dlkt_info_private.is_sha256(text)",
    "dlkt_info_private.is_valid_channels(text[])",
    "dlkt_info_private.is_valid_iso_weekdays(smallint[])",
    "dlkt_info_private.is_valid_text_collection(text[], integer, integer)",
    "dlkt_info_private.is_valid_text_set(text[], integer, integer)",
    "dlkt_info_private.is_valid_timezone(text)",
    "dlkt_info_private.prevent_mutation()",
    "dlkt_info_private.protect_briefing_system_fields()",
    "dlkt_info_private.protect_endpoint_system_fields()",
    "dlkt_info_private.protect_profile_system_fields()",
    "dlkt_info_private.require_service_role()",
    "dlkt_info_private.set_briefing_schedule()",
    "dlkt_info_private.set_card_owner()",
    "dlkt_info_private.set_receipt_owner()",
    "dlkt_info_private.set_run_owner()",
    "dlkt_info_private.touch_updated_at()",
    "dlkt_info_private.validate_briefing_target()",
    "dlkt_info_private.share_archive_content(jsonb)",
    "dlkt_info_private.valid_share_archive_card(jsonb)",
    "dlkt_info_private.prevent_share_archive_mutation()",
    "dlkt_info_private.valid_news_candidate_publisher(text, text)",
    "dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)",
    "dlkt_info_private.require_public_refresh_writer()",
    "dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)"
  ],
  "rls": [
    "dlkt_info_private.internal_delta_jobs",
    "dlkt_info_private.internal_delta_review_events",
    "dlkt_info_private.internal_delta_trial_card_claims",
    "dlkt_info_private.internal_delta_trial_cards",
    "dlkt_info_private.internal_delta_trials",
    "public.dlkt_info_briefing_cards",
    "public.dlkt_info_briefing_events",
    "public.dlkt_info_briefing_runs",
    "public.dlkt_info_briefing_targets",
    "public.dlkt_info_briefings",
    "public.dlkt_info_delivery_endpoints",
    "public.dlkt_info_delivery_receipts",
    "public.dlkt_info_interest_rules",
    "public.dlkt_info_profiles",
    "public.dlkt_info_user_memory",
    "dlkt_info_private.share_archive_writer",
    "public.dlkt_info_shared_cards",
    "public.dlkt_info_news_candidates",
    "dlkt_info_private.public_refresh_state",
    "dlkt_info_private.public_refresh_runs"
  ],
  "policies": [
    "public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_select_own:SELECT:authenticated",
    "public.dlkt_info_briefing_events.dlkt_info_briefing_events_select_own:SELECT:authenticated",
    "public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_select_own:SELECT:authenticated",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_delete_own:DELETE:authenticated",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_insert_own:INSERT:authenticated",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_select_own:SELECT:authenticated",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_update_own:UPDATE:authenticated",
    "public.dlkt_info_briefings.dlkt_info_briefings_delete_own:DELETE:authenticated",
    "public.dlkt_info_briefings.dlkt_info_briefings_insert_own:INSERT:authenticated",
    "public.dlkt_info_briefings.dlkt_info_briefings_select_own:SELECT:authenticated",
    "public.dlkt_info_briefings.dlkt_info_briefings_update_own:UPDATE:authenticated",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_delete_own:DELETE:authenticated",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_insert_own:INSERT:authenticated",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_select_own:SELECT:authenticated",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_update_own:UPDATE:authenticated",
    "public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_select_own:SELECT:authenticated",
    "public.dlkt_info_interest_rules.dlkt_info_interest_rules_delete_own:DELETE:authenticated",
    "public.dlkt_info_interest_rules.dlkt_info_interest_rules_insert_own:INSERT:authenticated",
    "public.dlkt_info_interest_rules.dlkt_info_interest_rules_select_own:SELECT:authenticated",
    "public.dlkt_info_interest_rules.dlkt_info_interest_rules_update_own:UPDATE:authenticated",
    "public.dlkt_info_profiles.dlkt_info_profiles_insert_own:INSERT:authenticated",
    "public.dlkt_info_profiles.dlkt_info_profiles_select_own:SELECT:authenticated",
    "public.dlkt_info_profiles.dlkt_info_profiles_update_own:UPDATE:authenticated",
    "public.dlkt_info_user_memory.dlkt_info_user_memory_delete_own:DELETE:authenticated",
    "public.dlkt_info_user_memory.dlkt_info_user_memory_insert_own:INSERT:authenticated",
    "public.dlkt_info_user_memory.dlkt_info_user_memory_select_own:SELECT:authenticated",
    "public.dlkt_info_user_memory.dlkt_info_user_memory_update_own:UPDATE:authenticated",
    "public.dlkt_info_shared_cards.dlkt_info_shared_cards_public_read:SELECT:anon,authenticated,service_role",
    "public.dlkt_info_news_candidates.dlkt_info_news_candidates_public_read:SELECT:anon,authenticated,service_role"
  ],
  "triggers": [
    "auth.users.on_auth_user_created_dlkt_info",
    "dlkt_info_private.briefing_card_claims.dlkt_info_card_claims_append_only",
    "dlkt_info_private.claim_evidence.dlkt_info_claim_evidence_append_only",
    "dlkt_info_private.claims.dlkt_info_claims_append_only",
    "dlkt_info_private.delivery_endpoint_secrets.dlkt_info_delivery_endpoint_secrets_touch",
    "dlkt_info_private.entities.dlkt_info_entities_touch",
    "dlkt_info_private.internal_delta_jobs.dlkt_info_internal_delta_jobs_touch",
    "dlkt_info_private.internal_delta_review_events.dlkt_info_internal_delta_review_events_immutable",
    "dlkt_info_private.internal_delta_trial_card_claims.dlkt_info_internal_delta_trial_card_claims_immutable",
    "dlkt_info_private.internal_delta_trials.dlkt_info_internal_delta_trials_touch",
    "dlkt_info_private.source_acquisition_events.dlkt_info_source_acquisition_events_immutable",
    "dlkt_info_private.source_acquisition_state.dlkt_info_source_acquisition_state_touch",
    "dlkt_info_private.source_claim_batch_items.dlkt_info_source_claim_batch_items_immutable",
    "dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_enqueue_internal_delta",
    "dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_immutable",
    "public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_append_only",
    "public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_owner",
    "public.dlkt_info_briefing_events.dlkt_info_briefing_events_append_only",
    "public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_owner",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_touch",
    "public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_validate",
    "public.dlkt_info_briefings.dlkt_info_briefings_default_web_target",
    "public.dlkt_info_briefings.dlkt_info_briefings_protect_system_fields",
    "public.dlkt_info_briefings.dlkt_info_briefings_schedule",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_protect_system_fields",
    "public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_touch",
    "public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_append_only",
    "public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_owner",
    "public.dlkt_info_interest_rules.dlkt_info_interest_rules_touch",
    "public.dlkt_info_profiles.dlkt_info_profiles_protect_system_fields",
    "public.dlkt_info_profiles.dlkt_info_profiles_touch",
    "public.dlkt_info_user_memory.dlkt_info_user_memory_touch",
    "public.dlkt_info_shared_cards.dlkt_info_shared_cards_immutable",
    "public.dlkt_info_shared_cards.dlkt_info_shared_cards_no_truncate"
  ],
  "permissions": {
    "publicAnon": [
      "public.dlkt_info_read_database_readiness()",
      "public.dlkt_info_read_system_identity()",
      "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
      "public.dlkt_info_upsert_news_candidates(jsonb)",
      "public.dlkt_info_read_public_snapshot()",
      "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
      "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
      "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
    ],
    "publicAuthenticated": [
      "public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)",
      "public.dlkt_info_read_companion_configuration()",
      "public.dlkt_info_read_database_readiness()",
      "public.dlkt_info_read_system_identity()",
      "public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)",
      "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
      "public.dlkt_info_upsert_news_candidates(jsonb)",
      "public.dlkt_info_read_public_snapshot()",
      "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
      "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
      "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
    ],
    "publicService": [
      "public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)",
      "public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)",
      "public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)",
      "public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)",
      "public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)",
      "public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)",
      "public.dlkt_info_read_companion_configuration()",
      "public.dlkt_info_read_database_readiness()",
      "public.dlkt_info_read_internal_delta_review_queue(integer)",
      "public.dlkt_info_read_source_acquisition(text)",
      "public.dlkt_info_read_system_identity()",
      "public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)",
      "public.dlkt_info_recover_expired_leases(timestamp with time zone)",
      "public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)",
      "public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)",
      "public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)",
      "public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)",
      "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
      "public.dlkt_info_upsert_news_candidates(jsonb)",
      "public.dlkt_info_read_public_snapshot()",
      "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
      "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
      "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
    ],
    "privateAnon": [],
    "privateAuthenticated": [
      "dlkt_info_private.is_sha256(text)",
      "dlkt_info_private.is_valid_channels(text[])",
      "dlkt_info_private.is_valid_iso_weekdays(smallint[])",
      "dlkt_info_private.is_valid_text_collection(text[], integer, integer)",
      "dlkt_info_private.is_valid_text_set(text[], integer, integer)",
      "dlkt_info_private.is_valid_timezone(text)"
    ],
    "privateService": [
      "dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)",
      "dlkt_info_private.clean_error_detail(text)",
      "dlkt_info_private.enqueue_internal_delta_job()",
      "dlkt_info_private.ensure_default_web_target()",
      "dlkt_info_private.handle_new_user()",
      "dlkt_info_private.hash_text(text)",
      "dlkt_info_private.internal_claim_payload(uuid)",
      "dlkt_info_private.is_sha256(text)",
      "dlkt_info_private.is_valid_channels(text[])",
      "dlkt_info_private.is_valid_iso_weekdays(smallint[])",
      "dlkt_info_private.is_valid_text_collection(text[], integer, integer)",
      "dlkt_info_private.is_valid_text_set(text[], integer, integer)",
      "dlkt_info_private.is_valid_timezone(text)",
      "dlkt_info_private.prevent_mutation()",
      "dlkt_info_private.protect_briefing_system_fields()",
      "dlkt_info_private.protect_endpoint_system_fields()",
      "dlkt_info_private.protect_profile_system_fields()",
      "dlkt_info_private.require_service_role()",
      "dlkt_info_private.set_briefing_schedule()",
      "dlkt_info_private.set_card_owner()",
      "dlkt_info_private.set_receipt_owner()",
      "dlkt_info_private.set_run_owner()",
      "dlkt_info_private.touch_updated_at()",
      "dlkt_info_private.validate_briefing_target()"
    ],
    "publicDefiner": [
      "public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)",
      "public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)",
      "public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)",
      "public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)",
      "public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)",
      "public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)",
      "public.dlkt_info_read_companion_configuration()",
      "public.dlkt_info_read_database_readiness()",
      "public.dlkt_info_read_internal_delta_review_queue(integer)",
      "public.dlkt_info_read_source_acquisition(text)",
      "public.dlkt_info_read_system_identity()",
      "public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)",
      "public.dlkt_info_recover_expired_leases(timestamp with time zone)",
      "public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)",
      "public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)",
      "public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)",
      "public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)",
      "public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)",
      "public.dlkt_info_upsert_news_candidates(jsonb)",
      "public.dlkt_info_read_public_snapshot()",
      "public.dlkt_info_claim_public_refresh(uuid, jsonb)",
      "public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)",
      "public.dlkt_info_fail_public_refresh(uuid, bigint, text)"
    ],
    "publicInvoker": [
      "public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)"
    ],
    "privateDefiner": [
      "dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)",
      "dlkt_info_private.enqueue_internal_delta_job()",
      "dlkt_info_private.ensure_default_web_target()",
      "dlkt_info_private.handle_new_user()",
      "dlkt_info_private.set_briefing_schedule()",
      "dlkt_info_private.set_card_owner()",
      "dlkt_info_private.set_receipt_owner()",
      "dlkt_info_private.set_run_owner()",
      "dlkt_info_private.validate_briefing_target()"
    ],
    "privateInvoker": [
      "dlkt_info_private.clean_error_detail(text)",
      "dlkt_info_private.hash_text(text)",
      "dlkt_info_private.internal_claim_payload(uuid)",
      "dlkt_info_private.is_sha256(text)",
      "dlkt_info_private.is_valid_channels(text[])",
      "dlkt_info_private.is_valid_iso_weekdays(smallint[])",
      "dlkt_info_private.is_valid_text_collection(text[], integer, integer)",
      "dlkt_info_private.is_valid_text_set(text[], integer, integer)",
      "dlkt_info_private.is_valid_timezone(text)",
      "dlkt_info_private.prevent_mutation()",
      "dlkt_info_private.protect_briefing_system_fields()",
      "dlkt_info_private.protect_endpoint_system_fields()",
      "dlkt_info_private.protect_profile_system_fields()",
      "dlkt_info_private.require_service_role()",
      "dlkt_info_private.touch_updated_at()",
      "dlkt_info_private.share_archive_content(jsonb)",
      "dlkt_info_private.valid_share_archive_card(jsonb)",
      "dlkt_info_private.prevent_share_archive_mutation()",
      "dlkt_info_private.valid_news_candidate_publisher(text, text)",
      "dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)",
      "dlkt_info_private.require_public_refresh_writer()",
      "dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)"
    ]
  },
  "schemaUsage": {
    "anon": false,
    "authenticated": true,
    "service": true
  },
  "dataPrivileges": {
    "table": [
      "SELECT",
      "INSERT",
      "UPDATE",
      "DELETE",
      "TRUNCATE",
      "REFERENCES",
      "TRIGGER"
    ],
    "tableSincePostgres17": [
      "MAINTAIN"
    ],
    "column": [
      "SELECT",
      "INSERT",
      "UPDATE",
      "REFERENCES"
    ],
    "sequence": [
      "USAGE",
      "SELECT",
      "UPDATE"
    ]
  },
  "publicDataPermissions": {
    "restrictedRoles": [
      "PUBLIC",
      "anon",
      "authenticated"
    ],
    "public": [],
    "anon": [],
    "authenticatedTables": {
      "public.dlkt_info_briefing_cards": [
        "SELECT"
      ],
      "public.dlkt_info_briefing_events": [
        "SELECT"
      ],
      "public.dlkt_info_briefing_runs": [
        "SELECT"
      ],
      "public.dlkt_info_briefing_targets": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE"
      ],
      "public.dlkt_info_briefings": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE"
      ],
      "public.dlkt_info_delivery_endpoints": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE"
      ],
      "public.dlkt_info_delivery_receipts": [
        "SELECT"
      ],
      "public.dlkt_info_interest_rules": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE"
      ],
      "public.dlkt_info_profiles": [
        "SELECT",
        "INSERT",
        "UPDATE"
      ],
      "public.dlkt_info_user_memory": [
        "SELECT",
        "INSERT",
        "UPDATE",
        "DELETE"
      ]
    },
    "restrictedRoleGrantOptions": [],
    "restrictedRoleExplicitColumnAcls": [],
    "eventSequence": {
      "relation": "public.dlkt_info_briefing_events_id_seq",
      "public": [],
      "anon": [],
      "authenticated": []
    },
    "serviceRole": {
      "requiredTablePrivileges": "ALL",
      "requiredEventSequencePrivileges": [
        "USAGE",
        "SELECT"
      ],
      "additionalAdministrativePrivileges": "preserved",
      "grantOptions": "preserved"
    }
  },
  "privateDataPermissions": {
    "relations": [
      "dlkt_info_private.briefing_card_claims",
      "dlkt_info_private.claim_evidence",
      "dlkt_info_private.claims",
      "dlkt_info_private.delivery_endpoint_secrets",
      "dlkt_info_private.delivery_outbox",
      "dlkt_info_private.entities",
      "dlkt_info_private.internal_delta_jobs",
      "dlkt_info_private.internal_delta_review_events",
      "dlkt_info_private.internal_delta_trial_card_claims",
      "dlkt_info_private.internal_delta_trial_cards",
      "dlkt_info_private.internal_delta_trials",
      "dlkt_info_private.source_acquisition_events",
      "dlkt_info_private.source_acquisition_state",
      "dlkt_info_private.source_claim_batch_items",
      "dlkt_info_private.source_claim_batches",
      "dlkt_info_private.source_registry",
      "dlkt_info_private.system_identity",
      "dlkt_info_private.share_archive_writer"
    ],
    "restrictedRoles": [
      "PUBLIC",
      "anon",
      "authenticated"
    ],
    "tablePrivileges": [],
    "columnPrivileges": [],
    "grantOptions": [],
    "explicitColumnAcls": [],
    "serviceRole": "existing administrative privileges are outside this denial check"
  },
  "shareArchivePermissions": {
    "publicRelation": "public.dlkt_info_shared_cards",
    "privateWriterRelation": "dlkt_info_private.share_archive_writer",
    "public": [],
    "tableRoles": {
      "anon": [
        "SELECT"
      ],
      "authenticated": [
        "SELECT"
      ],
      "service_role": [
        "SELECT"
      ]
    },
    "grantOptions": [],
    "explicitColumnAcls": [],
    "writerTableRoles": {
      "anon": [],
      "authenticated": [],
      "service_role": []
    },
    "writerColumnPrivileges": [],
    "writerGrantOptions": [],
    "policy": {
      "command": "SELECT",
      "roles": [
        "anon",
        "authenticated",
        "service_role"
      ],
      "using": "true",
      "withCheck": null
    },
    "immutableTriggers": {
      "dlkt_info_shared_cards_immutable": [
        "UPDATE",
        "DELETE"
      ],
      "dlkt_info_shared_cards_no_truncate": [
        "TRUNCATE"
      ]
    },
    "fixedFunctionSearchPath": "",
    "writerAuthentication": "SHA256 of x-dlkt-share-write compared with private singleton"
  },
  "newsCandidatePermissions": {
    "relation": "public.dlkt_info_news_candidates",
    "public": [],
    "tableRoles": {
      "anon": [
        "SELECT"
      ],
      "authenticated": [
        "SELECT"
      ],
      "service_role": [
        "SELECT"
      ]
    },
    "grantOptions": [],
    "explicitColumnAcls": [],
    "policy": {
      "command": "SELECT",
      "roles": [
        "anon",
        "authenticated",
        "service_role"
      ],
      "using": "true",
      "withCheck": null
    },
    "fixedFunctionSearchPath": "",
    "writerAuthentication": "SHA256 of x-dlkt-share-write compared with existing private singleton",
    "maximumInput": 500,
    "maximumRows": 5000,
    "retentionHours": 48,
    "indexDateIsPublicationDate": false
  },
  "newsPublisherOrigins": [
    {
      "label": "Reuters",
      "origins": [
        "https://www.reuters.com",
        "https://reuters.com"
      ]
    },
    {
      "label": "Associated Press",
      "origins": [
        "https://apnews.com",
        "https://www.apnews.com"
      ]
    },
    {
      "label": "BBC",
      "origins": [
        "https://www.bbc.com",
        "https://bbc.com",
        "https://www.bbc.co.uk",
        "https://bbc.co.uk"
      ]
    },
    {
      "label": "The Guardian",
      "origins": [
        "https://www.theguardian.com",
        "https://theguardian.com"
      ]
    },
    {
      "label": "Financial Times",
      "origins": [
        "https://www.ft.com",
        "https://ft.com"
      ]
    },
    {
      "label": "CNBC",
      "origins": [
        "https://www.cnbc.com",
        "https://cnbc.com"
      ]
    },
    {
      "label": "France 24",
      "origins": [
        "https://www.france24.com",
        "https://france24.com"
      ]
    },
    {
      "label": "DW",
      "origins": [
        "https://www.dw.com",
        "https://dw.com",
        "https://amp.dw.com"
      ]
    },
    {
      "label": "Al Jazeera",
      "origins": [
        "https://www.aljazeera.com",
        "https://aljazeera.com"
      ]
    },
    {
      "label": "NPR",
      "origins": [
        "https://www.npr.org",
        "https://npr.org"
      ]
    },
    {
      "label": "RTE",
      "origins": [
        "https://www.rte.ie",
        "https://rte.ie"
      ]
    },
    {
      "label": "CNN",
      "origins": [
        "https://www.cnn.com",
        "https://cnn.com",
        "https://edition.cnn.com"
      ]
    },
    {
      "label": "ABC Australia",
      "origins": [
        "https://www.abc.net.au",
        "https://abc.net.au"
      ]
    },
    {
      "label": "CBC",
      "origins": [
        "https://www.cbc.ca",
        "https://cbc.ca"
      ]
    },
    {
      "label": "Euronews",
      "origins": [
        "https://www.euronews.com",
        "https://euronews.com"
      ]
    },
    {
      "label": "POLITICO",
      "origins": [
        "https://www.politico.com",
        "https://politico.com",
        "https://www.politico.eu",
        "https://politico.eu"
      ]
    },
    {
      "label": "Bloomberg",
      "origins": [
        "https://www.bloomberg.com",
        "https://bloomberg.com"
      ]
    },
    {
      "label": "Business Insider",
      "origins": [
        "https://www.businessinsider.com",
        "https://businessinsider.com"
      ]
    },
    {
      "label": "Fortune",
      "origins": [
        "https://fortune.com",
        "https://www.fortune.com"
      ]
    },
    {
      "label": "TechCrunch",
      "origins": [
        "https://techcrunch.com",
        "https://www.techcrunch.com"
      ]
    },
    {
      "label": "The Verge",
      "origins": [
        "https://www.theverge.com",
        "https://theverge.com"
      ]
    },
    {
      "label": "Ars Technica",
      "origins": [
        "https://arstechnica.com",
        "https://www.arstechnica.com"
      ]
    },
    {
      "label": "WIRED",
      "origins": [
        "https://www.wired.com",
        "https://wired.com"
      ]
    },
    {
      "label": "Engadget",
      "origins": [
        "https://www.engadget.com",
        "https://engadget.com"
      ]
    },
    {
      "label": "NVIDIA",
      "origins": [
        "https://blogs.nvidia.com",
        "https://nvidianews.nvidia.com"
      ]
    },
    {
      "label": "Anthropic",
      "origins": [
        "https://www.anthropic.com",
        "https://anthropic.com"
      ]
    },
    {
      "label": "Rockstar Games",
      "origins": [
        "https://www.rockstargames.com",
        "https://rockstargames.com"
      ]
    },
    {
      "label": "PlayStation",
      "origins": [
        "https://blog.playstation.com"
      ]
    },
    {
      "label": "IGN",
      "origins": [
        "https://www.ign.com",
        "https://ign.com"
      ]
    },
    {
      "label": "PC Gamer",
      "origins": [
        "https://www.pcgamer.com",
        "https://pcgamer.com"
      ]
    },
    {
      "label": "Eurogamer",
      "origins": [
        "https://www.eurogamer.net",
        "https://eurogamer.net"
      ]
    },
    {
      "label": "GameSpot",
      "origins": [
        "https://www.gamespot.com",
        "https://gamespot.com"
      ]
    },
    {
      "label": "Variety",
      "origins": [
        "https://variety.com",
        "https://www.variety.com"
      ]
    },
    {
      "label": "Billboard",
      "origins": [
        "https://www.billboard.com",
        "https://billboard.com"
      ]
    },
    {
      "label": "The Hollywood Reporter",
      "origins": [
        "https://www.hollywoodreporter.com",
        "https://hollywoodreporter.com"
      ]
    },
    {
      "label": "Deadline",
      "origins": [
        "https://deadline.com",
        "https://www.deadline.com"
      ]
    },
    {
      "label": "ESPN",
      "origins": [
        "https://www.espn.com",
        "https://espn.com",
        "https://global.espn.com",
        "https://africa.espn.com"
      ]
    },
    {
      "label": "Sky Sports",
      "origins": [
        "https://www.skysports.com",
        "https://skysports.com"
      ]
    },
    {
      "label": "Olympics",
      "origins": [
        "https://www.olympics.com",
        "https://olympics.com"
      ]
    },
    {
      "label": "Parents",
      "origins": [
        "https://www.parents.com",
        "https://parents.com"
      ]
    },
    {
      "label": "Education Week",
      "origins": [
        "https://www.edweek.org",
        "https://edweek.org"
      ]
    },
    {
      "label": "Nature",
      "origins": [
        "https://www.nature.com",
        "https://nature.com"
      ]
    },
    {
      "label": "Science",
      "origins": [
        "https://www.science.org",
        "https://science.org"
      ]
    },
    {
      "label": "Live Science",
      "origins": [
        "https://www.livescience.com",
        "https://livescience.com"
      ]
    },
    {
      "label": "Scientific American",
      "origins": [
        "https://www.scientificamerican.com",
        "https://scientificamerican.com"
      ]
    },
    {
      "label": "Space.com",
      "origins": [
        "https://www.space.com",
        "https://space.com"
      ]
    },
    {
      "label": "National Geographic",
      "origins": [
        "https://www.nationalgeographic.com",
        "https://nationalgeographic.com"
      ]
    },
    {
      "label": "New Scientist",
      "origins": [
        "https://www.newscientist.com",
        "https://newscientist.com"
      ]
    },
    {
      "label": "Travel + Leisure",
      "origins": [
        "https://www.travelandleisure.com",
        "https://travelandleisure.com"
      ]
    },
    {
      "label": "Skift",
      "origins": [
        "https://skift.com",
        "https://www.skift.com"
      ]
    },
    {
      "label": "Lonely Planet",
      "origins": [
        "https://www.lonelyplanet.com",
        "https://lonelyplanet.com"
      ]
    },
    {
      "label": "Conde Nast Traveler",
      "origins": [
        "https://www.cntraveler.com",
        "https://cntraveler.com"
      ]
    },
    {
      "label": "Good Housekeeping",
      "origins": [
        "https://www.goodhousekeeping.com",
        "https://goodhousekeeping.com"
      ]
    },
    {
      "label": "Consumer Reports",
      "origins": [
        "https://www.consumerreports.org",
        "https://consumerreports.org"
      ]
    },
    {
      "label": "Which?",
      "origins": [
        "https://www.which.co.uk",
        "https://which.co.uk"
      ]
    },
    {
      "label": "Food & Wine",
      "origins": [
        "https://www.foodandwine.com",
        "https://foodandwine.com"
      ]
    },
    {
      "label": "Food Safety News",
      "origins": [
        "https://www.foodsafetynews.com",
        "https://foodsafetynews.com"
      ]
    },
    {
      "label": "Architectural Digest",
      "origins": [
        "https://www.architecturaldigest.com",
        "https://architecturaldigest.com"
      ]
    },
    {
      "label": "Dezeen",
      "origins": [
        "https://www.dezeen.com",
        "https://dezeen.com"
      ]
    },
    {
      "label": "The Weather Channel",
      "origins": [
        "https://weather.com",
        "https://www.weather.com"
      ]
    },
    {
      "label": "AccuWeather",
      "origins": [
        "https://www.accuweather.com",
        "https://accuweather.com"
      ]
    },
    {
      "label": "Carbon Brief",
      "origins": [
        "https://www.carbonbrief.org",
        "https://carbonbrief.org"
      ]
    },
    {
      "label": "Global Voices",
      "origins": [
        "https://globalvoices.org",
        "https://www.globalvoices.org"
      ]
    },
    {
      "label": "360info",
      "origins": [
        "https://360info.org",
        "https://www.360info.org"
      ]
    },
    {
      "label": "South China Morning Post",
      "origins": [
        "https://www.scmp.com",
        "https://scmp.com"
      ]
    },
    {
      "label": "The Hindu",
      "origins": [
        "https://www.thehindu.com",
        "https://thehindu.com"
      ]
    },
    {
      "label": "The Japan Times",
      "origins": [
        "https://www.japantimes.co.jp",
        "https://japantimes.co.jp"
      ]
    },
    {
      "label": "CNA",
      "origins": [
        "https://www.channelnewsasia.com",
        "https://channelnewsasia.com"
      ]
    },
    {
      "label": "The Straits Times",
      "origins": [
        "https://www.straitstimes.com",
        "https://straitstimes.com"
      ]
    },
    {
      "label": "The New York Times",
      "origins": [
        "https://www.nytimes.com",
        "https://nytimes.com"
      ]
    }
  ],
  "publicEditorialTopics": {
    "world": "world",
    "business": "business",
    "technology": "technology",
    "money": "money",
    "health": "health",
    "sport": "sport",
    "gaming": "culture",
    "culture": "culture",
    "shopping": "money",
    "travel": "travel",
    "work": "work-education",
    "education": "work-education",
    "family": "public-affairs",
    "science": "science",
    "environment": "environment",
    "public-affairs": "public-affairs",
    "digital-life": "digital-life",
    "food": "food",
    "housing": "housing",
    "weather": "weather"
  },
  "newsFeaturedSource": {
    "id": "editorial-frontpage",
    "publisherIds": [
      "ap",
      "guardian",
      "pcgamer",
      "bbc"
    ],
    "requiresPairedCategory": true,
    "signal": "observed matching link within publisher homepage main content"
  },
  "newsCanonicalUrl": {
    "trackingKeysCaseInsensitive": true,
    "encodedParameterNames": false,
    "dotSegments": false,
    "articleIdentityParametersPreserved": true
  },
  "continuousRefreshPermissions": {
    "relations": [
      "dlkt_info_private.public_refresh_state",
      "dlkt_info_private.public_refresh_runs"
    ],
    "tableRoles": {
      "PUBLIC": [],
      "anon": [],
      "authenticated": [],
      "service_role": []
    },
    "policies": [],
    "explicitColumnAcls": [],
    "fixedFunctionSearchPath": "",
    "writerAuthentication": "SHA256 of x-dlkt-share-write compared with existing private singleton",
    "slotSeconds": 120,
    "leaseSeconds": 90,
    "maximumSnapshotBytes": 1048576,
    "maximumCards": 5000,
    "maximumSources": 100,
    "maximumHistory": 720,
    "historyRetentionDays": 7,
    "backoffSeconds": [
      30,
      60,
      120,
      300
    ],
    "fencing": true,
    "atomicSnapshotAndReceipt": true,
    "publicReadExcludes": [
      "worker_id",
      "lease_token",
      "fence",
      "trigger",
      "key_hash"
    ],
    "digest": "Authenticated writer SHA256; canonical sorted JSON verified again by the server reader",
    "catalogue": {
      "candidateCategoryNullable": true,
      "nonNullCandidateCategories": [
        "world",
        "business",
        "technology",
        "money",
        "health",
        "sport",
        "gaming",
        "culture",
        "shopping",
        "travel",
        "work",
        "education",
        "family",
        "science",
        "environment",
        "public-affairs",
        "digital-life",
        "food",
        "housing",
        "weather"
      ],
      "unclassifiedSource": "news-unclassified",
      "unclassifiedTopic": "other",
      "coverageTopics": [
        "technology",
        "business",
        "regulation",
        "opportunities",
        "science",
        "environment",
        "health",
        "public-affairs",
        "world",
        "digital-life",
        "culture",
        "money",
        "space",
        "weather",
        "energy",
        "work-education",
        "housing",
        "travel",
        "food",
        "sport",
        "other"
      ],
      "sourceRegistry": {
        "eu-law": {
          "label": "EU legal documents",
          "publisher": "EU Publications Office",
          "topic": "regulation",
          "termsUrl": "https://eur-lex.europa.eu/content/legal-notice/legal-notice.html"
        },
        "ecb-news": {
          "label": "ECB publications",
          "publisher": "European Central Bank",
          "topic": "business",
          "termsUrl": "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"
        },
        "ecb-statistics": {
          "label": "ECB statistics",
          "publisher": "European Central Bank",
          "topic": "business",
          "termsUrl": "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"
        },
        "ecb-procurement": {
          "label": "ECB procurement notices",
          "publisher": "European Central Bank",
          "topic": "opportunities",
          "termsUrl": "https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"
        },
        "nextjs": {
          "label": "Next.js releases",
          "publisher": "Vercel / Next.js maintainers",
          "topic": "technology",
          "termsUrl": "https://github.com/vercel/next.js/blob/canary/license.md"
        },
        "nodejs": {
          "label": "Node.js releases",
          "publisher": "Node.js maintainers",
          "topic": "technology",
          "termsUrl": "https://github.com/nodejs/node/blob/main/LICENSE"
        },
        "nasa-news": {
          "label": "NASA science and missions",
          "publisher": "NASA",
          "topic": "science",
          "termsUrl": "https://www.nasa.gov/nasa-brand-center/"
        },
        "usgs-news": {
          "label": "USGS Earth science",
          "publisher": "U.S. Geological Survey",
          "topic": "environment",
          "termsUrl": "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"
        },
        "fda-news": {
          "label": "US FDA announcements",
          "publisher": "U.S. Food and Drug Administration",
          "topic": "health",
          "termsUrl": "https://www.fda.gov/about-fda/about-website/website-policies"
        },
        "govuk-news": {
          "label": "UK public announcements",
          "publisher": "UK Government",
          "topic": "public-affairs",
          "termsUrl": "https://www.gov.uk/help/terms-conditions"
        },
        "gv-world": {
          "label": "Global Voices world perspectives",
          "publisher": "Global Voices",
          "topic": "world",
          "termsUrl": "https://globalvoices.org/about/global-voices-attribution-policy/"
        },
        "gv-culture": {
          "label": "Global Voices arts and culture",
          "publisher": "Global Voices",
          "topic": "culture",
          "termsUrl": "https://globalvoices.org/about/global-voices-attribution-policy/"
        },
        "eff-digital": {
          "label": "EFF digital life and rights",
          "publisher": "Electronic Frontier Foundation",
          "topic": "digital-life",
          "termsUrl": "https://www.eff.org/copyright"
        },
        "govuk-products": {
          "label": "UK product safety alerts and recalls",
          "publisher": "UK Government",
          "topic": "public-affairs",
          "termsUrl": "https://www.gov.uk/help/terms-conditions"
        },
        "ncsc-news": {
          "label": "NCSC cyber security news",
          "publisher": "UK National Cyber Security Centre",
          "topic": "digital-life",
          "termsUrl": "https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions"
        },
        "sanews": {
          "label": "SAnews South African news",
          "publisher": "SAnews",
          "topic": "world",
          "termsUrl": "https://www.sanews.gov.za/content/user-policy"
        },
        "ec-press": {
          "label": "European Commission press releases",
          "publisher": "European Commission",
          "topic": "public-affairs",
          "termsUrl": "https://commission.europa.eu/legal-notice_en"
        },
        "eu-council": {
          "label": "Council of the EU press releases",
          "publisher": "Council of the European Union",
          "topic": "regulation",
          "termsUrl": "https://www.consilium.europa.eu/en/about-site/copyright/"
        },
        "cbs-news": {
          "label": "Statistics Netherlands news",
          "publisher": "Statistics Netherlands (CBS)",
          "topic": "business",
          "termsUrl": "https://www.cbs.nl/en-gb/about-us/website/copyright"
        },
        "scidev-news": {
          "label": "SciDev.Net science and development",
          "publisher": "SciDev.Net",
          "topic": "science",
          "termsUrl": "https://www.scidev.net/global/content/policies.html"
        },
        "360-news": {
          "label": "360info research perspectives",
          "publisher": "360info",
          "topic": "world",
          "termsUrl": "https://360info.org/how-to-use-our-content/"
        },
        "noaa-news": {
          "label": "NOAA weather and ocean news",
          "publisher": "NOAA",
          "topic": "weather",
          "termsUrl": "https://www.noaa.gov/office-education/outreach-communication/faq"
        },
        "nist-news": {
          "label": "NIST technology and research",
          "publisher": "NIST",
          "topic": "technology",
          "termsUrl": "https://www.nist.gov/copyrights-disclaimers"
        },
        "nsf-news": {
          "label": "NSF science news",
          "publisher": "U.S. National Science Foundation",
          "topic": "science",
          "termsUrl": "https://www.nsf.gov/policies/digital"
        },
        "fed-news": {
          "label": "Federal Reserve Board releases",
          "publisher": "Federal Reserve Board",
          "topic": "business",
          "termsUrl": "https://www.federalreserve.gov/disclaimer.htm"
        },
        "ftc-consumer": {
          "label": "FTC consumer alerts",
          "publisher": "U.S. Federal Trade Commission",
          "topic": "money",
          "termsUrl": "https://www.ftc.gov/policy-notices/website-policy"
        },
        "fda-food": {
          "label": "US FDA food safety recalls",
          "publisher": "U.S. Food and Drug Administration",
          "topic": "food",
          "termsUrl": "https://www.fda.gov/about-fda/about-website/website-policies"
        },
        "govuk-travel": {
          "label": "UK foreign travel advice updates",
          "publisher": "UK Government",
          "topic": "travel",
          "termsUrl": "https://www.gov.uk/help/terms-conditions"
        },
        "beehive-news": {
          "label": "New Zealand Government announcements",
          "publisher": "New Zealand Government",
          "topic": "world",
          "termsUrl": "https://www.beehive.govt.nz/copyright"
        },
        "news-world": {
          "label": "World & geopolitics",
          "publisher": "Reviewed news discovery",
          "topic": "world",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-business": {
          "label": "Business & economy",
          "publisher": "Reviewed news discovery",
          "topic": "business",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-technology": {
          "label": "AI & technology",
          "publisher": "Reviewed news discovery",
          "topic": "technology",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-money": {
          "label": "Money & cost of living",
          "publisher": "Reviewed news discovery",
          "topic": "money",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-health": {
          "label": "Health & wellbeing",
          "publisher": "Reviewed news discovery",
          "topic": "health",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-sport": {
          "label": "Sports & competitions",
          "publisher": "Reviewed news discovery",
          "topic": "sport",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-gaming": {
          "label": "Gaming & esports",
          "publisher": "Reviewed news discovery",
          "topic": "culture",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-culture": {
          "label": "Culture & entertainment",
          "publisher": "Reviewed news discovery",
          "topic": "culture",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-shopping": {
          "label": "Shopping & consumer products",
          "publisher": "Reviewed news discovery",
          "topic": "money",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-travel": {
          "label": "Travel & flights",
          "publisher": "Reviewed news discovery",
          "topic": "travel",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-work": {
          "label": "Work & careers",
          "publisher": "Reviewed news discovery",
          "topic": "work-education",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-education": {
          "label": "Education & learning",
          "publisher": "Reviewed news discovery",
          "topic": "work-education",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-family": {
          "label": "Family & parenting",
          "publisher": "Reviewed news discovery",
          "topic": "public-affairs",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-science": {
          "label": "Science & space",
          "publisher": "Reviewed news discovery",
          "topic": "science",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-environment": {
          "label": "Climate & energy",
          "publisher": "Reviewed news discovery",
          "topic": "environment",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-public-affairs": {
          "label": "Politics & rights",
          "publisher": "Reviewed news discovery",
          "topic": "public-affairs",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-digital-life": {
          "label": "Digital life & security",
          "publisher": "Reviewed news discovery",
          "topic": "digital-life",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-food": {
          "label": "Food & everyday living",
          "publisher": "Reviewed news discovery",
          "topic": "food",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-housing": {
          "label": "Housing & cities",
          "publisher": "Reviewed news discovery",
          "topic": "housing",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-weather": {
          "label": "Weather & major disruptions",
          "publisher": "Reviewed news discovery",
          "topic": "weather",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "news-unclassified": {
          "label": "Other source-checked topics",
          "publisher": "Reviewed news discovery",
          "topic": "other",
          "termsUrl": "https://www.gdeltproject.org/about.html"
        },
        "editorial-frontpage": {
          "label": "Publisher homepage selection",
          "publisher": "Publisher homepage selection",
          "topic": "world",
          "termsUrl": "https://apnews.com/termsofservice"
        }
      },
      "sourceRegistryCount": 51,
      "unclassifiedShares": "Reviewed publisher URL and exact identity; headline-only; optional verified homepage signal"
    }
  }
} as const);
export function serializeSchemaManifest():string{return JSON.stringify({version:SCHEMA_MANIFEST_VERSION,manifest:EXPECTED_SCHEMA_MANIFEST});}
