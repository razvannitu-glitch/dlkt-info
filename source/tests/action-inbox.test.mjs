import assert from 'node:assert/strict';
import test from 'node:test';

const candidates = () => [
  { id: 'demo-tech-pricing', label: 'API pricing', entityId: 'demo-ai-platform', topicId: 'technology', kind: 'changed', materiality: 'high', claimStateHash: '0123456789abcdef0123456789abcdef' },
  { id: 'demo-grant-window', label: 'Funding window', entityId: 'demo-fund', topicId: 'opportunities', kind: 'new', materiality: 'high', claimStateHash: 'abcdef0123456789abcdef0123456789' },
  { id: 'demo-market-entry', label: 'Competitor move', entityId: 'demo-competitor', topicId: 'business', kind: 'new', materiality: 'high', claimStateHash: '11111111111111112222222222222222' },
  { id: 'demo-route', label: 'Direct route', entityId: 'demo-airline', topicId: 'travel', kind: 'new', materiality: 'medium', claimStateHash: '33333333333333334444444444444444' },
  { id: 'demo-supply', label: 'Component status', entityId: 'demo-component', topicId: 'supply', kind: 'changed', materiality: 'high', claimStateHash: '55555555555555556666666666666666' },
];
const action = (candidateId, type, scheduledFor = null) => ({
  id: `action:${type}:${candidateId}`, candidateId, type, status: 'active',
  createdAt: '2026-11-12T08:00:00.000Z', scheduledFor, reason: `User selected ${type}.`,
});
const observations = () => [
  { candidateId: 'demo-tech-pricing', currentClaimStateHash: '9999999999999999aaaaaaaaaaaaaaaa', observedAt: '2026-11-12T09:00:00.000Z', materialDelta: true, conflictActive: false },
  { candidateId: 'demo-grant-window', currentClaimStateHash: 'abcdef0123456789abcdef0123456789', observedAt: '2026-11-12T09:00:00.000Z', materialDelta: false, conflictActive: false },
  { candidateId: 'demo-market-entry', currentClaimStateHash: '77777777777777778888888888888888', observedAt: '2026-11-12T09:00:00.000Z', materialDelta: true, conflictActive: false },
  { candidateId: 'demo-route', currentClaimStateHash: 'bbbbbbbbbbbbbbbbcccccccccccccccc', observedAt: '2026-11-12T09:00:00.000Z', materialDelta: true, conflictActive: false },
  { candidateId: 'demo-supply', currentClaimStateHash: '55555555555555556666666666666666', observedAt: '2026-11-12T09:00:00.000Z', materialDelta: false, conflictActive: true },
];

test('action inbox projects finite due, scheduled, waiting, reopened and muted states', async () => {
  const { projectActionInbox } = await import('../.build/src/inbox/index.js');
  const projection = projectActionInbox(candidates(), [
    action('demo-tech-pricing', 'watch-change'),
    action('demo-tech-pricing', 'compare-next'),
    action('demo-grant-window', 'remind-next-briefing', '2026-11-13T08:00:00.000Z'),
    action('demo-market-entry', 'mark-resolved'),
    action('demo-route', 'ignore-pattern'),
    action('demo-supply', 'watch-change'),
  ], observations(), '2026-11-12T10:00:00.000Z');

  assert.equal(projection.totalCount, 6);
  assert.equal(projection.dueNowCount, 3);
  assert.equal(projection.scheduledCount, 1);
  assert.equal(projection.waitingCount, 1);
  assert.equal(projection.resolvedCount, 0);
  assert.equal(projection.mutedCount, 1);
  assert.equal(projection.suppressedMaterialDeltaCount, 1);
  assert.equal(projection.items.find((item) => item.state === 'muted')?.materialDelta, true);
  assert.equal(projection.nextScheduledAt, '2026-11-13T08:00:00.000Z');
  assert.deepEqual(projection.items.map((item) => item.state), ['due-now', 'due-now', 'due-now', 'scheduled', 'waiting-for-delta', 'muted']);
  assert.equal(Object.isFrozen(projection), true);
  assert.equal(Object.isFrozen(projection.items), true);
});

test('attention resolution reopens only for a new material delta and never rewrites facts', async () => {
  const { projectActionInbox } = await import('../.build/src/inbox/index.js');
  const stable = observations().map((item) => item.candidateId === 'demo-market-entry'
    ? { ...item, currentClaimStateHash: '11111111111111112222222222222222', materialDelta: false }
    : item);
  const projection = projectActionInbox(candidates(), [action('demo-market-entry', 'mark-resolved')], stable, '2026-11-12T10:00:00.000Z');
  assert.equal(projection.items[0].state, 'attention-resolved');
  assert.equal(projection.items[0].automaticExecution, false);
  assert.equal(projection.items[0].factualStateChanged, false);
});

test('due reminder is explicit and does not execute automatically', async () => {
  const { projectActionInbox } = await import('../.build/src/inbox/index.js');
  const projection = projectActionInbox(candidates(), [
    action('demo-grant-window', 'remind-next-briefing', '2026-11-12T09:00:00.000Z'),
  ], observations(), '2026-11-12T10:00:00.000Z');
  assert.equal(projection.items[0].state, 'due-now');
  assert.match(projection.items[0].reason, /reminder is due now/u);
  assert.equal(projection.automaticExecution, false);
});

test('action inbox rejects incomplete observations and invalid reminder schedules', async () => {
  const { projectActionInbox } = await import('../.build/src/inbox/index.js');
  assert.throws(() => projectActionInbox(candidates(), [], observations().slice(1), '2026-11-12T10:00:00.000Z'), /ACTION_INBOX_INPUT_INVALID|ACTION_OBSERVATION_MISSING/u);
  assert.throws(() => projectActionInbox(candidates(), [action('demo-grant-window', 'remind-next-briefing')], observations(), '2026-11-12T10:00:00.000Z'), /ACTION_REMINDER_SCHEDULE_INVALID/u);
  const duplicate = [...observations().slice(0, -1), observations()[0]];
  assert.throws(() => projectActionInbox(candidates(), [], duplicate, '2026-11-12T10:00:00.000Z'), /ACTION_OBSERVATION_DUPLICATE/u);
});

test('action inbox ordering is deterministic', async () => {
  const { projectActionInbox } = await import('../.build/src/inbox/index.js');
  const input = [
    action('demo-route', 'ignore-pattern'),
    action('demo-tech-pricing', 'compare-next'),
    action('demo-tech-pricing', 'watch-change'),
  ];
  const first = projectActionInbox(candidates(), input, observations(), '2026-11-12T10:00:00.000Z');
  const second = projectActionInbox(candidates(), [...input].reverse(), [...observations()].reverse(), '2026-11-12T10:00:00.000Z');
  assert.deepEqual(first.items, second.items);
});
