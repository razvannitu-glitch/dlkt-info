import type { AtomicClaim, ClaimDelta, ClaimKind, ClaimValue, InfoPack, NarrativeProjection } from './contracts.js';

const formatValue = (value: ClaimValue): string => {
  if (value === null) return 'not specified';
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
};

const claimsFor = (delta: ClaimDelta): readonly AtomicClaim[] => delta.current?.claims ?? delta.previous?.claims ?? [];
const preferred = (delta: ClaimDelta): AtomicClaim | null => {
  const state = delta.current ?? delta.previous;
  if (!state) return null;
  const claimId = state.selectedClaimId ?? state.reviewPriorityClaimId;
  return state.claims.find((claim) => claim.id === claimId) ?? state.claims[0] ?? null;
};

const GENERIC_KINDS = Object.freeze(['event', 'state', 'change', 'forecast', 'availability', 'price', 'regulation', 'release', 'opportunity'] as const satisfies readonly ClaimKind[]);

export const genericInfoPack: InfoPack = Object.freeze({
  id: 'generic-signals',
  version: '1.0.0',
  supportedKinds: GENERIC_KINDS,
  project(delta: ClaimDelta): NarrativeProjection {
    const claim = preferred(delta);
    if (!claim) throw new Error('DELTA_WITHOUT_CLAIM');
    const entity = claim.entity.label;
    const affects = [...new Set(claimsFor(delta).flatMap((item) => item.affects))];
    const dependencies = delta.current?.blockedDependencies ?? [];

    if (delta.kind === 'conflicted') {
      const values = [...new Set((delta.current?.claims ?? []).map((item) => formatValue(item.value)))];
      return Object.freeze({
        title: `${entity}: sources disagree`,
        direct: `Current evidence reports incompatible values for ${claim.predicate}: ${values.join(' / ')}.`,
        whyItMatters: dependencies.length > 0
          ? `Conclusions depending on ${dependencies.join(', ')} remain blocked until the contradiction is resolved.`
          : 'The conflict must be resolved before a definitive conclusion is shown.',
        changedSince: 'A contradiction appeared since the previous briefing.',
      });
    }

    if (delta.kind === 'resolved') {
      return Object.freeze({
        title: `${entity}: previous signal is no longer current`,
        direct: `The previous claim about ${claim.predicate} is no longer active in the current evidence window.`,
        whyItMatters: affects.length > 0 ? `Any conclusion depending on ${affects.join(', ')} must be recalculated.` : 'The earlier reading should no longer be treated as current.',
        changedSince: 'The previous claim expired or was withdrawn.',
      });
    }

    if (delta.kind === 'changed') {
      const before = delta.previous?.claims.find((item) => item.id === (delta.previous?.selectedClaimId ?? delta.previous?.reviewPriorityClaimId)) ?? delta.previous?.claims[0] ?? null;
      return Object.freeze({
        title: `${entity}: material update`,
        direct: `${claim.predicate} changed from ${before ? formatValue(before.value) : 'not established'} to ${formatValue(claim.value)}.`,
        whyItMatters: affects.length > 0 ? `This can affect ${affects.join(', ')}.` : 'The current reading differs from the previous briefing.',
        changedSince: 'Updated since the previous briefing.',
      });
    }

    return Object.freeze({
      title: `${entity}: new verified information`,
      direct: `${claim.predicate}: ${formatValue(claim.value)}.`,
      whyItMatters: affects.length > 0 ? `This can affect ${affects.join(', ')}.` : 'This is new in the current briefing window.',
      changedSince: 'New since the previous briefing.',
    });
  },
});
