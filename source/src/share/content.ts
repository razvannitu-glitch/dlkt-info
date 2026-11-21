import type {EvidenceCard} from '../iceo/contracts.js';

/** A complete publisher excerpt; never trim off a condition to make a social preview fit. */
export function publisherExcerpt(card: EvidenceCard): string | null {
  const excerpt = card.summary;
  if (!excerpt) return null;
  const comparable = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim().replace(/[.!?\u2026]+$/u, '');
  return comparable(excerpt) === comparable(card.title) ? null : excerpt;
}

export function publicShareDescription(card: EvidenceCard, fallback: string): string {
  const excerpt = publisherExcerpt(card);
  const deadline = card.kind === 'procurement-notice' && card.deadline
    ? `Listed closing date: ${card.deadline}. Confirm the procedure status, exact time and eligibility in the source.`
    : '';
  return [excerpt ?? fallback, deadline].filter(Boolean).join(' ');
}
