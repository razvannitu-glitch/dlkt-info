import assert from 'node:assert/strict';
import test from 'node:test';

const candidates = () => [
  { id: 'demo-tech-pricing', label: 'API pricing', entityId: 'demo-ai-platform', topicId: 'technology', kind: 'changed', materiality: 'high', claimStateHash: '0123456789abcdef0123456789abcdef' },
  { id: 'demo-market-entry', label: 'Competitor move', entityId: 'demo-competitor', topicId: 'business', kind: 'new', materiality: 'high', claimStateHash: 'abcdef0123456789abcdef0123456789' },
];
const action = (candidateId, type) => ({
  id: `action:${type}:${candidateId}`, candidateId, type, status: 'active',
  createdAt: '2026-11-12T08:00:00.000Z', scheduledFor: null, reason: `User selected ${type}.`,
});

test('personal action layer projects explicit actions without mutating facts', async () => {
  const { projectActionControl } = await import('../.build/src/actions/index.js');
  const projection = projectActionControl(candidates(), [
    action('demo-tech-pricing', 'watch-change'),
    action('demo-tech-pricing', 'compare-next'),
    action('demo-market-entry', 'mark-resolved'),
  ]);
  assert.equal(projection.activeActionCount, 3);
  assert.equal(projection.watchedCandidateCount, 1);
  assert.equal(projection.oneTimeActionCount, 1);
  assert.deepEqual(projection.candidates[0].activeActions, ['watch-change', 'compare-next']);
  assert.equal(projection.candidates[0].automaticExecution, false);
  assert.equal(projection.candidates[0].factualStateChanged, false);
  assert.equal(projection.candidates[1].attentionState, 'resolved');
  assert.equal(Object.isFrozen(projection), true);
});

test('ignore is exclusive and cannot silently combine with other actions', async () => {
  const { projectActionControl } = await import('../.build/src/actions/index.js');
  assert.throws(() => projectActionControl(candidates(), [
    action('demo-tech-pricing', 'ignore-pattern'), action('demo-tech-pricing', 'watch-change'),
  ]), /ACTION_IGNORE_EXCLUSIVE/u);
});

test('action query round-trips finite explicit state and rejects unsafe input', async () => {
  const { buildActionSearch, parseActionSearch } = await import('../.build/src/actions/index.js');
  const actions = [action('demo-tech-pricing', 'watch-change'), action('demo-market-entry', 'mark-resolved')];
  const search = buildActionSearch(actions);
  assert.equal(search, '?actions=actions-v1&watch=demo-tech-pricing&resolved=demo-market-entry');
  const parsed = parseActionSearch(`${search}&trust=trust-v1&_vercel_share=preview`);
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.actions.map((item) => [item.candidateId, item.type]), [
    ['demo-tech-pricing', 'watch-change'], ['demo-market-entry', 'mark-resolved'],
  ]);
  for (const invalid of [
    '?actions=wrong&watch=demo-tech-pricing',
    '?actions=actions-v1&watch=demo-tech-pricing&watch=demo-market-entry',
    '?actions=actions-v1&watch=demo-tech-pricing&ignore=demo-tech-pricing',
    '?actions=actions-v1&admin=1',
  ]) assert.equal(parseActionSearch(invalid).state, 'invalid');
});

test('action guards reject malformed candidates and references', async () => {
  const { projectActionControl } = await import('../.build/src/actions/index.js');
  assert.throws(() => projectActionControl([{ ...candidates()[0], claimStateHash: 'bad' }], []), /ACTION_CANDIDATE_INVALID/u);
  assert.throws(() => projectActionControl(candidates(), [action('missing-card', 'watch-change')]), /ACTION_REFERENCE_INVALID/u);
});
