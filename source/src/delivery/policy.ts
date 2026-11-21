import type { ActionType } from '../actions/contracts.js';
import type { CardTrust, Materiality } from '../core/contracts.js';
import {
  DELIVERY_CONTROL_ROUTE,
  DELIVERY_CONTROL_VERSION,
  type DeliveryCandidate,
  type DeliveryDecision,
  type DeliveryDisposition,
  type DeliveryPolicy,
  type DeliveryProjection,
  type DeliveryReceipt,
} from './contracts.js';

const ID = /^[a-z0-9][a-z0-9:._-]{1,127}$/u;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ACTION_TYPES: readonly ActionType[] = Object.freeze([
  'watch-change', 'remind-next-briefing', 'compare-next', 'mark-resolved', 'ignore-pattern',
]);
const TRUST_RANK: Readonly<Record<CardTrust, number>> = Object.freeze({ 'single-source': 0, conflicting: 0, corroborated: 1, confirmed: 2 });
const MATERIALITY_RANK: Readonly<Record<Materiality, number>> = Object.freeze({ low: 0, medium: 1, high: 2, critical: 3 });
const DISPOSITION_ORDER: Readonly<Record<DeliveryDisposition, number>> = Object.freeze({
  'notify-now': 0,
  'defer-quiet-hours': 1,
  'rate-limited': 2,
  'next-briefing': 3,
  scheduled: 4,
  waiting: 5,
  'attention-resolved': 6,
  muted: 7,
  'blocked-conflict': 8,
  'suppressed-policy': 9,
});
const formatters = new Map<string, Intl.DateTimeFormat>();

function assertTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(0); } catch { throw new Error('DELIVERY_TIMEZONE_INVALID'); }
}

function localMinute(timestamp: number, timezone: string): number {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timezone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('DELIVERY_LOCAL_TIME_INVALID');
  return hour * 60 + minute;
}

function timeMinute(value: string): number {
  if (!TIME.test(value)) throw new Error('DELIVERY_TIME_INVALID');
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function withinQuietHours(timestamp: number, policy: DeliveryPolicy): boolean {
  if (!policy.quietHoursEnabled) return false;
  const current = localMinute(timestamp, policy.timezone);
  const start = timeMinute(policy.quietStart);
  const end = timeMinute(policy.quietEnd);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

function nextLocalTime(timestamp: number, timezone: string, target: string): string {
  const targetMinute = timeMinute(target);
  const start = Math.floor(timestamp / 60_000) * 60_000 + 60_000;
  const limit = start + 3 * 86_400_000;
  for (let candidate = start; candidate <= limit; candidate += 60_000) {
    if (localMinute(candidate, timezone) === targetMinute) return new Date(candidate).toISOString();
  }
  throw new Error('DELIVERY_NEXT_LOCAL_TIME_NOT_FOUND');
}

export const DEFAULT_DELIVERY_POLICY: DeliveryPolicy = Object.freeze({
  timezone: 'Europe/Bucharest',
  channel: 'web',
  actionModes: Object.freeze({
    'watch-change': 'alert',
    'remind-next-briefing': 'briefing',
    'compare-next': 'briefing',
    'mark-resolved': 'off',
    'ignore-pattern': 'off',
  }),
  quietHoursEnabled: true,
  quietStart: '22:00',
  quietEnd: '07:00',
  dailyAlertCap: 3,
  minimumGapMinutes: 90,
  quietHoursBypass: 'never',
  conflictMode: 'briefing',
  minimumAlertTrust: 'confirmed',
  minimumAlertMateriality: 'high',
  requireOfficialForHighImpact: true,
});

export function assertDeliveryPolicy(policy: DeliveryPolicy): void {
  assertTimezone(policy.timezone);
  if (!['web', 'email', 'push'].includes(policy.channel) || !TIME.test(policy.quietStart) || !TIME.test(policy.quietEnd)
    || !Number.isInteger(policy.dailyAlertCap) || policy.dailyAlertCap < 1 || policy.dailyAlertCap > 12
    || !Number.isInteger(policy.minimumGapMinutes) || policy.minimumGapMinutes < 15 || policy.minimumGapMinutes > 720
    || !['never', 'confirmed-official-high'].includes(policy.quietHoursBypass)
    || !['briefing', 'off'].includes(policy.conflictMode)
    || !['corroborated', 'confirmed'].includes(policy.minimumAlertTrust)
    || !['medium', 'high', 'critical'].includes(policy.minimumAlertMateriality)
    || policy.requireOfficialForHighImpact !== true) throw new Error('DELIVERY_POLICY_INVALID');
  for (const type of ACTION_TYPES) if (!['alert', 'briefing', 'off'].includes(policy.actionModes[type])) throw new Error('DELIVERY_ACTION_MODE_INVALID');
}

function assertCandidate(candidate: DeliveryCandidate): void {
  if (!ID.test(candidate.id) || !ID.test(candidate.actionId) || !ID.test(candidate.candidateId) || !ID.test(candidate.entityId)
    || !ID.test(candidate.topicId) || candidate.duplicateKey.length < 2 || candidate.duplicateKey.length > 160
    || !ACTION_TYPES.includes(candidate.actionType) || !['due-now', 'scheduled', 'waiting-for-delta', 'attention-resolved', 'muted'].includes(candidate.inboxState)
    || !['low', 'medium', 'high', 'critical'].includes(candidate.materiality) || !['confirmed', 'corroborated', 'single-source', 'conflicting'].includes(candidate.trust)
    || !Number.isFinite(Date.parse(candidate.observedAt)) || (candidate.dueAt !== null && !Number.isFinite(Date.parse(candidate.dueAt)))) throw new Error('DELIVERY_CANDIDATE_INVALID');
}

function assertReceipt(receipt: DeliveryReceipt): void {
  if (!ID.test(receipt.id) || !ID.test(receipt.candidateId) || receipt.duplicateKey.length < 2 || receipt.duplicateKey.length > 160
    || !['web', 'email', 'push'].includes(receipt.channel) || !Number.isFinite(Date.parse(receipt.deliveredAt))) throw new Error('DELIVERY_RECEIPT_INVALID');
}

function makeDecision(candidate: DeliveryCandidate, disposition: DeliveryDisposition, reason: string, explanation: readonly string[], options: {
  readonly channel?: DeliveryDecision['channel'];
  readonly scheduledFor?: string | null;
  readonly quietHoursApplied?: boolean;
  readonly antiSpamApplied?: boolean;
} = {}): DeliveryDecision {
  return Object.freeze({
    id: `delivery:${candidate.id}`,
    candidateId: candidate.candidateId,
    disposition,
    channel: options.channel ?? null,
    scheduledFor: options.scheduledFor ?? null,
    reason,
    explanation: Object.freeze([...explanation]),
    quietHoursApplied: options.quietHoursApplied ?? false,
    antiSpamApplied: options.antiSpamApplied ?? false,
    automaticExecution: false,
    factualStateChanged: false,
  });
}

function baseDecision(candidate: DeliveryCandidate, policy: DeliveryPolicy): DeliveryDecision | null {
  if (candidate.inboxState === 'muted') return makeDecision(candidate, 'muted', 'An explicit ignore rule keeps this pattern quiet.', ['The material change remains visible in the muted ledger.', 'No evidence or claim was deleted.']);
  if (candidate.inboxState === 'attention-resolved') return makeDecision(candidate, 'attention-resolved', 'Personal attention remains resolved.', ['The factual claim is unchanged.', 'A future material delta can reopen attention.']);
  if (candidate.inboxState === 'waiting-for-delta') return makeDecision(candidate, 'waiting', 'No new material verified delta exists.', ['The action remains armed.', 'Nothing is delivered until the state changes materially.']);
  if (candidate.inboxState === 'scheduled') return makeDecision(candidate, 'scheduled', 'This one-time reminder belongs to the next finite briefing.', ['It is not promoted to an exceptional alert by default.'], { scheduledFor: candidate.dueAt });
  const mode = policy.actionModes[candidate.actionType];
  if (mode === 'off') return makeDecision(candidate, 'suppressed-policy', 'Delivery is disabled for this action type.', ['The action remains visible in Action Control.', 'No automatic execution occurs.']);
  if (candidate.conflictActive || candidate.trust === 'conflicting') {
    return policy.conflictMode === 'briefing'
      ? makeDecision(candidate, 'next-briefing', 'An unresolved contradiction is kept inside the briefing.', ['The conflict stays visible.', 'No exceptional alert can present one source as truth.'])
      : makeDecision(candidate, 'blocked-conflict', 'Your delivery policy blocks unresolved contradictions.', ['The candidate remains inspectable in Trust and Action Inbox.']);
  }
  if (mode === 'briefing') return makeDecision(candidate, 'next-briefing', 'This action is configured for the next finite briefing.', ['No separate notification is generated.']);
  if (!candidate.materialDelta) return makeDecision(candidate, 'waiting', 'No material delta exists for an exceptional alert.', ['The watch stays active.']);
  if (TRUST_RANK[candidate.trust] < TRUST_RANK[policy.minimumAlertTrust]) return makeDecision(candidate, 'next-briefing', `Trust is below the ${policy.minimumAlertTrust} alert threshold.`, ['The card may still appear in the next briefing.']);
  if (MATERIALITY_RANK[candidate.materiality] < MATERIALITY_RANK[policy.minimumAlertMateriality]) return makeDecision(candidate, 'next-briefing', `Materiality is below the ${policy.minimumAlertMateriality} alert threshold.`, ['The change is retained for the next briefing.']);
  if (['high', 'critical'].includes(candidate.materiality) && policy.requireOfficialForHighImpact && !candidate.officialEvidence) return makeDecision(candidate, 'next-briefing', 'High-impact alerts require official evidence.', ['The candidate remains visible but cannot interrupt the user.']);
  if (policy.channel !== 'web') return makeDecision(candidate, 'suppressed-policy', `${policy.channel} delivery is unavailable in protected staging.`, ['Only the in-product web channel can be projected.', 'No endpoint is contacted.']);
  return null;
}

export function projectDeliveryControl(policy: DeliveryPolicy, candidates: readonly DeliveryCandidate[], receipts: readonly DeliveryReceipt[], now: number): DeliveryProjection {
  assertDeliveryPolicy(policy);
  if (!Number.isFinite(now) || candidates.length < 1 || candidates.length > 24 || receipts.length > 100) throw new Error('DELIVERY_INPUT_INVALID');
  for (const candidate of candidates) assertCandidate(candidate);
  for (const receipt of receipts) assertReceipt(receipt);
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new Error('DELIVERY_CANDIDATE_DUPLICATE');

  const activeReceipts = receipts.filter((receipt) => {
    const deliveredAt = Date.parse(receipt.deliveredAt);
    return deliveredAt <= now && deliveredAt >= now - 86_400_000;
  }).sort((left, right) => Date.parse(right.deliveredAt) - Date.parse(left.deliveredAt));
  const latestReceiptAt = activeReceipts[0] ? Date.parse(activeReceipts[0].deliveredAt) : null;
  let projectedAlerts = 0;
  const projectedDuplicateKeys = new Set<string>();

  const decisions = candidates.map((candidate) => {
    const base = baseDecision(candidate, policy);
    if (base) return base;
    const duplicate = activeReceipts.find((receipt) => receipt.duplicateKey === candidate.duplicateKey);
    if (duplicate || projectedDuplicateKeys.has(candidate.duplicateKey)) return makeDecision(candidate, 'rate-limited', 'The same verified change is already represented inside the 24-hour duplicate window.', ['Duplicate alerts are collapsed.', 'The candidate remains in the Action Inbox.'], { antiSpamApplied: true });
    if (activeReceipts.length + projectedAlerts >= policy.dailyAlertCap) return makeDecision(candidate, 'rate-limited', `The daily exceptional-alert cap of ${policy.dailyAlertCap} is already reached.`, ['The change moves to the next briefing instead of interrupting again.'], { antiSpamApplied: true });
    const gapMs = policy.minimumGapMinutes * 60_000;
    if (latestReceiptAt !== null && now - latestReceiptAt < gapMs) return makeDecision(candidate, 'rate-limited', `The ${policy.minimumGapMinutes}-minute anti-spam gap is still active.`, ['The next eligible alert time is explicit.'], { scheduledFor: new Date(latestReceiptAt + gapMs).toISOString(), antiSpamApplied: true });
    if (projectedAlerts > 0) return makeDecision(candidate, 'rate-limited', `Another exceptional alert already occupies the current ${policy.minimumGapMinutes}-minute window.`, ['The projection never stacks simultaneous interruptions.'], { scheduledFor: new Date(now + gapMs).toISOString(), antiSpamApplied: true });
    const inQuiet = withinQuietHours(now, policy);
    const bypass = policy.quietHoursBypass === 'confirmed-official-high' && candidate.trust === 'confirmed' && candidate.officialEvidence && ['high', 'critical'].includes(candidate.materiality);
    if (inQuiet && !bypass) return makeDecision(candidate, 'defer-quiet-hours', 'Quiet hours prevent an immediate interruption.', ['The candidate remains eligible.', `It can surface after ${policy.quietEnd} in ${policy.timezone}.`], { channel: 'web', scheduledFor: nextLocalTime(now, policy.timezone, policy.quietEnd), quietHoursApplied: true });
    projectedAlerts += 1;
    projectedDuplicateKeys.add(candidate.duplicateKey);
    return makeDecision(candidate, 'notify-now', 'A material, trusted and policy-eligible change can interrupt now.', ['The delivery reason is visible.', 'The user still decides what happens next.'], { channel: 'web' });
  }).sort((left, right) => DISPOSITION_ORDER[left.disposition] - DISPOSITION_ORDER[right.disposition] || left.candidateId.localeCompare(right.candidateId));

  const scheduled = decisions.map((decision) => decision.scheduledFor).filter((value): value is string => value !== null).sort();
  return Object.freeze({
    version: DELIVERY_CONTROL_VERSION,
    route: DELIVERY_CONTROL_ROUTE,
    generatedAt: new Date(now).toISOString(),
    policy: Object.freeze({ ...policy, actionModes: Object.freeze({ ...policy.actionModes }) }),
    decisions: Object.freeze(decisions),
    totalCount: decisions.length,
    notifyNowCount: decisions.filter((decision) => decision.disposition === 'notify-now').length,
    deferredCount: decisions.filter((decision) => decision.disposition === 'defer-quiet-hours').length,
    nextBriefingCount: decisions.filter((decision) => decision.disposition === 'next-briefing').length,
    waitingCount: decisions.filter((decision) => decision.disposition === 'waiting').length,
    quietCount: decisions.filter((decision) => ['muted', 'attention-resolved', 'suppressed-policy', 'blocked-conflict'].includes(decision.disposition)).length,
    rateLimitedCount: decisions.filter((decision) => decision.disposition === 'rate-limited').length,
    nextScheduledAt: scheduled[0] ?? null,
    automaticExecution: false,
    factualStateChanged: false,
  });
}
