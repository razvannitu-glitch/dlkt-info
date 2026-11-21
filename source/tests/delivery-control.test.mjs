import assert from 'node:assert/strict';
import test from 'node:test';

const candidate = (overrides = {}) => ({
  id: 'candidate:watch:pricing',
  actionId: 'action:watch-change:demo-tech-pricing',
  candidateId: 'demo-tech-pricing',
  entityId: 'demo-ai-platform',
  topicId: 'technology',
  duplicateKey: 'demo-ai-platform:pricing',
  actionType: 'watch-change',
  inboxState: 'due-now',
  materiality: 'high',
  trust: 'confirmed',
  officialEvidence: true,
  conflictActive: false,
  materialDelta: true,
  observedAt: '2026-11-12T13:00:00.000Z',
  dueAt: null,
  ...overrides,
});
const receipt = (overrides = {}) => ({
  id: 'receipt:one', candidateId: 'previous-candidate', duplicateKey: 'previous:change', channel: 'web', deliveredAt: '2026-11-12T11:00:00.000Z', ...overrides,
});

test('delivery control permits only material trusted policy-eligible alerts', async () => {
  const { DEFAULT_DELIVERY_POLICY, projectDeliveryControl } = await import('../.build/src/delivery/index.js');
  const projection = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [candidate()], [], Date.parse('2026-11-12T13:30:00.000Z'));
  assert.equal(projection.notifyNowCount, 1);
  assert.equal(projection.decisions[0].disposition, 'notify-now');
  assert.equal(projection.decisions[0].channel, 'web');
  assert.equal(projection.automaticExecution, false);
  assert.equal(projection.factualStateChanged, false);
  assert.equal(Object.isFrozen(projection), true);
});

test('quiet hours defer alerts and confirmed official bypass is explicit', async () => {
  const { DEFAULT_DELIVERY_POLICY, projectDeliveryControl } = await import('../.build/src/delivery/index.js');
  const now = Date.parse('2026-11-12T21:30:00.000Z');
  const deferred = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [candidate({ observedAt: '2026-11-12T21:20:00.000Z' })], [], now);
  assert.equal(deferred.decisions[0].disposition, 'defer-quiet-hours');
  assert.equal(deferred.decisions[0].quietHoursApplied, true);
  assert.ok(deferred.decisions[0].scheduledFor);
  const bypass = projectDeliveryControl({ ...DEFAULT_DELIVERY_POLICY, quietHoursBypass: 'confirmed-official-high' }, [candidate({ observedAt: '2026-11-12T21:20:00.000Z' })], [], now);
  assert.equal(bypass.decisions[0].disposition, 'notify-now');
});

test('anti-spam collapses duplicates, enforces gap and daily cap', async () => {
  const { DEFAULT_DELIVERY_POLICY, projectDeliveryControl } = await import('../.build/src/delivery/index.js');
  const now = Date.parse('2026-11-12T13:30:00.000Z');
  const duplicate = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [candidate()], [receipt({ candidateId: 'demo-tech-pricing', duplicateKey: 'demo-ai-platform:pricing' })], now);
  assert.equal(duplicate.decisions[0].disposition, 'rate-limited');
  assert.equal(duplicate.decisions[0].antiSpamApplied, true);
  const gap = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [candidate()], [receipt({ deliveredAt: '2026-11-12T12:45:00.000Z' })], now);
  assert.equal(gap.decisions[0].disposition, 'rate-limited');
  assert.equal(gap.decisions[0].scheduledFor, '2026-11-12T14:15:00.000Z');
  const capReceipts = [0, 1, 2].map((index) => receipt({ id: `receipt:${index}`, candidateId: `past:${index}`, duplicateKey: `past:${index}`, deliveredAt: `2026-11-12T${String(8 + index).padStart(2, '0')}:00:00.000Z` }));
  const capped = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [candidate()], capReceipts, now);
  assert.equal(capped.decisions[0].disposition, 'rate-limited');
});

test('conflicts, weak trust, non-official high impact and action modes never become exceptional alerts', async () => {
  const { DEFAULT_DELIVERY_POLICY, projectDeliveryControl } = await import('../.build/src/delivery/index.js');
  const now = Date.parse('2026-11-12T13:30:00.000Z');
  const projection = projectDeliveryControl(DEFAULT_DELIVERY_POLICY, [
    candidate({ id: 'candidate:conflict', candidateId: 'conflict-card', duplicateKey: 'conflict', conflictActive: true, trust: 'conflicting' }),
    candidate({ id: 'candidate:weak', candidateId: 'weak-card', duplicateKey: 'weak', trust: 'corroborated' }),
    candidate({ id: 'candidate:no-official', candidateId: 'unofficial-card', duplicateKey: 'unofficial', officialEvidence: false }),
    candidate({ id: 'candidate:remind', candidateId: 'remind-card', duplicateKey: 'remind', actionType: 'remind-next-briefing', inboxState: 'scheduled', dueAt: '2026-11-13T06:00:00.000Z' }),
    candidate({ id: 'candidate:ignored', candidateId: 'ignore-card', duplicateKey: 'ignore', actionType: 'ignore-pattern', inboxState: 'muted' }),
  ], [], now);
  assert.equal(projection.notifyNowCount, 0);
  assert.deepEqual(projection.decisions.map((decision) => decision.disposition).sort(), ['muted', 'next-briefing', 'next-briefing', 'next-briefing', 'scheduled'].sort());
});


test('projection never stacks simultaneous exceptional alerts', async () => {
  const { DEFAULT_DELIVERY_POLICY, projectDeliveryControl } = await import('../.build/src/delivery/index.js');
  const policy = { ...DEFAULT_DELIVERY_POLICY, actionModes: { ...DEFAULT_DELIVERY_POLICY.actionModes, 'compare-next': 'alert' } };
  const projection = projectDeliveryControl(policy, [
    candidate(),
    candidate({ id: 'candidate:compare:pricing', actionId: 'action:compare-next:demo-tech-pricing', actionType: 'compare-next' }),
    candidate({ id: 'candidate:watch:second', actionId: 'action:watch-change:second', candidateId: 'second', entityId: 'second-entity', duplicateKey: 'second:change' }),
  ], [], Date.parse('2026-11-12T13:30:00.000Z'));
  assert.equal(projection.notifyNowCount, 1);
  assert.equal(projection.rateLimitedCount, 2);
  assert.equal(projection.decisions.filter((decision) => decision.antiSpamApplied).length, 2);
});

test('delivery URL contract round-trips and rejects unknown or contradictory state', async () => {
  const { DEFAULT_DELIVERY_POLICY, buildDeliverySearch, parseDeliverySearch } = await import('../.build/src/delivery/index.js');
  const policy = { ...DEFAULT_DELIVERY_POLICY, dailyAlertCap: 2, minimumGapMinutes: 120, actionModes: { ...DEFAULT_DELIVERY_POLICY.actionModes, 'compare-next': 'alert' } };
  const search = buildDeliverySearch(policy, '?actions=actions-v1&watch=demo-tech-pricing&tz=Europe%2FBucharest');
  const parsed = parseDeliverySearch(search);
  assert.equal(parsed.state, 'valid');
  assert.deepEqual(parsed.policy, policy);
  assert.equal(parseDeliverySearch('?delivery=delivery-v1&cap=0').state, 'invalid');
  assert.equal(parseDeliverySearch('?delivery=delivery-v1&cap=2&cap=3').state, 'invalid');
  assert.equal(parseDeliverySearch('?delivery=delivery-v1&admin=1').state, 'invalid');
  assert.equal(parseDeliverySearch('').state, 'absent');
});
