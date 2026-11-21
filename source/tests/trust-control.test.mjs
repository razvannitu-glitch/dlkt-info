import assert from 'node:assert/strict';
import test from 'node:test';

const candidates = Object.freeze([
  Object.freeze({ id: 'confirmed', trust: 'confirmed', materiality: 'high', evidenceAgeHours: 2,
    sources: Object.freeze([{ authority: 'official' }, { authority: 'primary' }]) }),
  Object.freeze({ id: 'single', trust: 'single-source', materiality: 'medium', evidenceAgeHours: 4,
    sources: Object.freeze([{ authority: 'primary' }]) }),
  Object.freeze({ id: 'conflict', trust: 'conflicting', materiality: 'high', evidenceAgeHours: 5,
    sources: Object.freeze([{ authority: 'official' }, { authority: 'reputable-secondary' }]) }),
  Object.freeze({ id: 'old', trust: 'corroborated', materiality: 'medium', evidenceAgeHours: 90,
    sources: Object.freeze([{ authority: 'primary' }, { authority: 'reputable-secondary' }]) }),
]);

const balanced = () => ({
  minimumTrust: 'corroborated', conflictPolicy: 'exclude', authorityRequirement: 'primary',
  minimumSources: 2, maximumEvidenceAgeHours: 72, requireOfficialForHighImpact: true,
});

test('trust control default policy is explicit, frozen and finite', async () => {
  const { defaultTrustPolicy, trustControlContract, defaultTrustProjection } = await import('../.build/src/trust/index.js');
  assert.deepEqual(defaultTrustPolicy, balanced());
  assert.equal(Object.isFrozen(defaultTrustPolicy), true);
  assert.deepEqual(trustControlContract, {
    version: 'dlkt-info-trust-control-1', route: '/trust', mode: 'synthetic-session-preview', marker: 'trust-v1',
    browserStorage: false, persistenceEnabled: false, hiddenTrustRulesAllowed: false,
    automaticTruthSelection: false, policyIsUserVisible: true, maximumCandidates: 12,
  });
  const projection = defaultTrustProjection(candidates);
  assert.deepEqual(projection.includedIds, ['confirmed']);
  assert.deepEqual(projection.excludedIds, ['single', 'conflict', 'old']);
});

test('trust policy separates unresolved conflict visibility from factual selection', async () => {
  const { projectTrustPolicy } = await import('../.build/src/trust/index.js');
  const projection = projectTrustPolicy(candidates, {
    ...balanced(), conflictPolicy: 'include-warning', authorityRequirement: 'reputable-secondary',
    minimumTrust: 'single-source', minimumSources: 1, requireOfficialForHighImpact: false,
    maximumEvidenceAgeHours: 168,
  });
  assert.deepEqual(projection.includedIds, ['confirmed', 'single', 'conflict', 'old']);
  const conflict = projection.decisions.find((decision) => decision.candidateId === 'conflict');
  assert.equal(conflict.included, true);
  assert.match(conflict.warnings[0], /contradiction remains visible/u);
});

test('high-impact policy requires official evidence without rewriting trust', async () => {
  const { evaluateTrustCandidate } = await import('../.build/src/trust/index.js');
  const decision = evaluateTrustCandidate({ id: 'high', trust: 'corroborated', materiality: 'high', evidenceAgeHours: 1,
    sources: [{ authority: 'primary' }, { authority: 'reputable-secondary' }] }, balanced());
  assert.equal(decision.included, false);
  assert.match(decision.blockingReasons.join(' '), /official source/u);
});

test('trust URL contract round-trips exactly and rejects unsafe state', async () => {
  const { buildTrustPolicySearch, parseTrustPolicySearch } = await import('../.build/src/trust/index.js');
  const search = buildTrustPolicySearch(balanced());
  assert.equal(search, '?trust=trust-v1&level=corroborated&conflicts=exclude&authority=primary&sources=2&age=72&officialHigh=1');
  assert.deepEqual(parseTrustPolicySearch(`${search}&bridge=companion-v1&_vercel_share=preview`), { state: 'valid', policy: balanced() });
  for (const unsafe of [
    '?trust=trust-v1&level=corroborated&conflicts=exclude&authority=primary&sources=2&age=72',
    `${search}&admin=1`,
    `${search}&level=confirmed`,
    '?trust=wrong&level=corroborated&conflicts=exclude&authority=primary&sources=2&age=72&officialHigh=1',
  ]) assert.equal(parseTrustPolicySearch(unsafe).state, 'invalid');
  assert.deepEqual(parseTrustPolicySearch('?bridge=companion-v1'), { state: 'absent', policy: null });
});

test('trust guards reject over-broad policies and malformed candidates', async () => {
  const { parseTrustPolicy, projectTrustPolicy } = await import('../.build/src/trust/index.js');
  assert.throws(() => parseTrustPolicy({ ...balanced(), hidden: true }), /TRUST_POLICY_INVALID/u);
  assert.throws(() => parseTrustPolicy({ ...balanced(), minimumSources: 3 }), /TRUST_POLICY_INVALID/u);
  assert.throws(() => projectTrustPolicy(Array.from({ length: 13 }, (_, index) => ({ ...candidates[0], id: String(index) })), balanced()), /TRUST_CANDIDATES_INVALID/u);
});
