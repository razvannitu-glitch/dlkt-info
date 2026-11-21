import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('activation-account handoff exposes one exact secure contract', async () => {
  const { activationAccountHandoffContract } = await import('../.build/src/handoff/index.js');
  assert.deepEqual(activationAccountHandoffContract, {
    version: 'dlkt-info-activation-account-handoff-1',
    sourceRoute: '/start',
    destinationRoute: '/companion',
    identityMethod: 'email-otp',
    sessionBoundary: 'http-only-cookie',
    persistenceAdapter: 'dlkt-info-persistence-2',
    persistenceMode: 'dedicated-runtime-gate',
    exactContractSave: true,
    crossDeviceRestore: true,
    explicitUrlWins: true,
    entityCapacity: 'payload-bounded',
    cardBudget: 'user-defined-positive-integer',
    browserStorage: false,
    automaticExecution: false,
    factualStateMutation: false,
  });
  assert.equal(Object.isFrozen(activationAccountHandoffContract), true);
});

test('activation saves exact visible preferences through same-origin OTP without browser storage', () => {
  const start = readFileSync('public/start.js', 'utf8');
  const shell = readFileSync('public/companion-shell.js', 'utf8');
  for (const fragment of [
    "fetch('/api/auth'", "fetch('/api/persistence'", "credentials: 'same-origin'",
    "'X-DLKT-Info-Request': 'identity-v1'", "'X-DLKT-Info-Request': 'persistence-v1'",
    'savedProjectionMatches', 'persistAndOpen', 'verifyIdentityCode', 'window.location.assign(companionUrl())',
  ]) assert.match(start, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  for (const fragment of [
    "privateJson('/api/auth', 'identity-v1')", "privateJson('/api/persistence', 'persistence-v1')",
    'savedCompanion', 'hydrateSavedCompanion', "state.queryState !== 'default'",
  ]) assert.match(shell, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(`${start}\n${shell}`, /localStorage|sessionStorage|indexedDB|document\.cookie|Authorization|access_token|refresh_token/iu);
});

test('forward migration removes fixed product ceilings and persists the complete trust policy', () => {
  const migration = readFileSync('supabase/migrations/20261112233000_dlkt_info_activation_account_handoff.sql', 'utf8');
  for (const fragment of [
    'dlkt_info_briefings_card_budget_check check (max_cards > 0)',
    'is_valid_text_collection(include_entities,160,131072)',
    'minimum_trust', 'conflict_policy', 'authority_requirement', 'minimum_sources',
    'maximum_evidence_age_hours', 'require_official_for_high_impact',
    'jsonb_array_length(v_cards) > v_max_cards',
    "'version', 'dlkt-info-persistence-2'",
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
  assert.doesNotMatch(migration, /p_max_cards not between 1 and 12|is_valid_text_set\(p_entities, 8|max_cards between 1 and 12/u);
});
