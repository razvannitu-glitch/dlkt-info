import { cardGuide } from './card-guide.js';
/** Condense ordinary reading copy without hiding a status that changes its meaning. */
export function editorialCardPresentation(view, savedCopy = false) {
    const card = view.card, publication = card.kind === 'publication';
    const headline = publication ? card.title : view.heading;
    const kind = publication ? (card.summary ? 'From the publisher' : '') : view.label;
    const kindLabel = [savedCopy ? 'Saved copy' : '', kind, card.sourceState === 'stale' ? 'Older source check' : ''].filter(Boolean).join(' · ');
    const criticalSource = publication && card.sourceIds.some(id => ['govuk-products', 'ncsc-news', 'fda-news'].includes(id));
    const guide = criticalSource ? cardGuide(card) : null;
    return Object.freeze({
        headline, kindLabel,
        visibleContext: publication ? card.summary ?? null : view.context,
        detailContext: publication && card.summary === undefined ? view.context : null,
        safetyNote: guide ? `${guide.scope}. ${guide.nextStep}` : null,
        originalTitleInDetails: view.shortened && headline !== card.title,
    });
}
/** "Checked" refers to source acquisition, never to an assertion that a story is true. */
export function compactEditionStatus(input) {
    if (input.state === 'unavailable')
        return 'Stories could not be checked. Refresh to try again.';
    if (input.state === 'pending' && input.count + input.continuation === 0)
        return 'Loading today’s stories…';
    if (input.state === 'empty')
        return 'No current stories match this selection. Coverage is incomplete.';
    const count = input.count ? `${input.count} ${input.count === 1 ? 'story' : 'stories'}` : `${input.continuation} current ${input.continuation === 1 ? 'story' : 'stories'} below`;
    const parts = [count];
    if (input.checkedTime)
        parts.push(`Checked ${input.checkedTime}`);
    if (input.refreshFailed)
        parts.push('Refresh unavailable — showing the previous check');
    else if (input.refreshing)
        parts.push('Checking for updates…');
    if (input.partial)
        parts.push('Partial coverage');
    if (input.updates)
        parts.push(`${input.updates} ${input.updates === 1 ? 'update' : 'updates'} available`);
    return parts.join(' · ');
}
