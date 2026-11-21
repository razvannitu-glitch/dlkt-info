import type { AtomicClaim, ClaimDelta, InfoPack, NarrativeProjection } from '../../core/contracts.js';
import { EU_OFFICIAL_PACK_ID, EU_OFFICIAL_PACK_VERSION } from './contracts.js';

const claims = (delta: ClaimDelta): readonly AtomicClaim[] => delta.current?.claims ?? delta.previous?.claims ?? [];
const preferred = (delta: ClaimDelta): AtomicClaim => {
  const state = delta.current ?? delta.previous;
  if (!state) throw new Error('EU_PACK_DELTA_EMPTY');
  const id = state.selectedClaimId ?? state.reviewPriorityClaimId;
  const claim = state.claims.find((entry) => entry.id === id) ?? state.claims[0];
  if (!claim) throw new Error('EU_PACK_CLAIM_MISSING');
  return claim;
};
const field = (claim: AtomicClaim, prefix: string): string | null => {
  if (!Array.isArray(claim.value)) return null;
  const value = claim.value.find((entry) => typeof entry === 'string' && entry.startsWith(prefix));
  return typeof value === 'string' ? value.slice(prefix.length) : null;
};
const documentTitle = (claim: AtomicClaim): string =>
  Array.isArray(claim.value) && typeof claim.value[0] === 'string' ? claim.value[0] : claim.entity.label;

export const euOfficialChangePack: InfoPack = Object.freeze({
  id: EU_OFFICIAL_PACK_ID,
  version: EU_OFFICIAL_PACK_VERSION,
  supportedKinds: Object.freeze(['regulation'] as const),
  project(delta: ClaimDelta): NarrativeProjection {
    const claim = preferred(delta);
    const celex = field(claim, 'celex:') ?? 'CELEX document';
    const creator = field(claim, 'creator:') ?? 'European Union institution';
    const title = documentTitle(claim);
    const proposal = claim.predicate === 'official-eu-proposal-listing';
    const sourceLabel = proposal ? 'Commission proposals' : 'Parliament and Council legislation';

    if (delta.kind === 'conflicted') {
      return Object.freeze({
        title: `${celex}: official metadata conflict`,
        direct: `Official evidence contains incompatible metadata for ${title}.`,
        whyItMatters: 'DLKT blocks dependent conclusions until the source conflict is reconciled. The linked EUR-Lex records remain available for inspection.',
        changedSince: 'A contradiction appeared in the official-source evidence.',
      });
    }

    return Object.freeze({
      title: proposal ? `${celex}: new Commission proposal signal` : `${celex}: official EU legal-publication signal`,
      direct: `EUR-Lex's official ${sourceLabel} feed lists ${title}, attributed to ${creator}.`,
      whyItMatters: proposal
        ? 'This is an official proposal-stage signal. It does not establish adoption, entry into force or a legal obligation; verify the linked document before acting.'
        : 'This confirms an official publication signal. Applicability, obligations and effective dates must be checked in the linked legal act before acting.',
      changedSince: delta.kind === 'new'
        ? 'This CELEX document was not present in the previous retained checkpoint.'
        : 'The official feed metadata changed since the previous retained checkpoint.',
    });
  },
});

export const euOfficialClaimCount = (delta: ClaimDelta): number => claims(delta).length;
