/** Reading guidance describes the connected source, never the visitor's circumstances. */
export function cardGuide(card) {
    const has = (id) => card.sourceIds.includes(id);
    if (card.kind === 'procurement-notice')
        return { scope: 'Procurement notice · status must be checked', nextStep: 'Check the procedure status, deadline and eligibility in the original notice.' };
    if (card.kind === 'legal-document')
        return { scope: 'European Union · legal document', nextStep: 'Check the full text, effective dates and applicable jurisdiction.' };
    if (card.kind === 'software-release')
        return { scope: 'Software · publisher release listing', nextStep: 'Check the release notes and compatibility before updating.' };
    if (has('govuk-products'))
        return { scope: 'United Kingdom · OPSS product safety', nextStep: 'Check the exact product, model, batch, affected country and current instructions in the original notice.' };
    if (has('ncsc-news'))
        return { scope: 'United Kingdom · NCSC cyber security news', nextStep: 'Check the stated audience, affected systems and original guidance; this is not a personal breach check.' };
    if (has('fda-news'))
        return { scope: 'United States · FDA announcement', nextStep: 'Check the original notice and whether its regulatory scope applies in your country.' };
    if (has('govuk-news'))
        return { scope: 'United Kingdom · government communication', nextStep: 'Check the affected area, dates and instructions in the original.' };
    if (has('eff-digital'))
        return { scope: 'Digital rights · EFF advocacy and analysis', nextStep: 'Read the original analysis and check the jurisdiction it discusses.' };
    if (has('gv-culture'))
        return { scope: 'Arts and culture · Global Voices reporting', nextStep: 'Read the original for cultural context; this is not an events calendar.' };
    if (has('gv-world'))
        return { scope: 'World perspectives · Global Voices reporting', nextStep: 'Read the original for the location, context and credited contributors.' };
    if (has('nasa-news'))
        return { scope: 'Science and space · NASA', nextStep: 'Read the original explanation and the evidence it links.' };
    if (has('usgs-news'))
        return { scope: 'Earth science · USGS', nextStep: 'Check the location and findings in the original release.' };
    if (has('ecb-statistics'))
        return { scope: 'Euro area · ECB statistical release', nextStep: 'Check the figures, reference period and definitions in the original.' };
    if (has('ecb-news'))
        return { scope: 'Euro area · ECB publication', nextStep: 'Read the original statement for its scope and supporting figures.' };
    return { scope: 'Publisher listing', nextStep: 'Read the original source for the full context and current status.' };
}
export function cardGuideNode(card) {
    const guide = cardGuide(card), node = document.createElement('div');
    node.className = 'card-guide';
    for (const [label, value] of [['Scope', guide.scope], ['Next step', guide.nextStep]]) {
        const row = document.createElement('p'), name = document.createElement('strong');
        name.textContent = label + ': ';
        row.append(name, document.createTextNode(value ?? ''));
        node.append(row);
    }
    return node;
}
/** Transparent title-based editorial ordering, not a safety, urgency or personal impact score. */
export function dailyUseOrder(card) {
    if (card.kind === 'legal-document' || card.kind === 'software-release')
        return 3;
    const title = card.title.normalize('NFKC').toLocaleLowerCase('en');
    if (/\b(?:recalls?|safety alert|consumer warning|scams?|phishing|service disruption|road closures?|product safety|food safety)\b/u.test(title))
        return 0;
    if (/\b(?:privacy|consumer|online safety|fraud|cost of living|household|how to|what you need to know)\b/u.test(title))
        return 1;
    if (card.sourceIds.includes('ecb-news') && (/\b(?:speech|remarks|interview)\b/u.test(title) || /^[^:]{3,100}:/u.test(title)))
        return 3;
    if (card.sourceIds.includes('fda-news') && /\b(?:approves?|approval|clinical)\b/u.test(title))
        return 3;
    return 2;
}
export function compareDailyUse(a, b) {
    return dailyUseOrder(a) - dailyUseOrder(b) || Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id);
}
export function publicationAge(card, now) {
    const age = now - Date.parse(card.date);
    if (!Number.isFinite(age) || age < 0)
        return '';
    const days = Math.floor(age / 86400000);
    return days === 0 ? 'less than 24h ago' : days === 1 ? '1 day ago' : `${days} days ago`;
}
