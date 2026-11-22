import { cardGuide } from './card-guide.js';
import { TOPIC_LABELS } from './topics.js';
import { safeLink } from './card-validation.js';
import { validArtifact } from './edition-artifact.js';
const esc = (s) => s.replace(/[&<>"']/gu, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? ''));
const topicLabels = TOPIC_LABELS;
function relatedLabel(edition, primaryId) {
    return edition.storyGroups?.find(group => group.primaryId === primaryId)?.basis === 'software-versions' ? 'Other listed software versions' : 'Other original listings for this story; reports may differ and are not independent confirmations';
}
function relatedText(edition, primaryId) {
    const group = edition.storyGroups?.find(item => item.primaryId === primaryId);
    if (group === undefined)
        return [];
    return [relatedLabel(edition, primaryId) + ':', ...group.related.flatMap(card => [
            card.title, card.publisher, `Original: ${card.sourceUrl}`, ...(card.byline ? [card.byline, `License: ${card.licenseUrl}`] : []),
            `${card.dateLabel}: ${card.date}`, `Source checked: ${card.observedAt}`,
            ...(card.summary === undefined ? [] : ['Publisher excerpt from the source feed:', card.summary]), card.attribution, card.boundary, '',
        ])];
}
function relatedHtml(edition, primaryId) {
    const group = edition.storyGroups?.find(item => item.primaryId === primaryId);
    if (group === undefined)
        return '';
    const items = group.related.map(card => `<li><h3 dir="auto">${esc(card.title)}</h3><p><a href="${esc(safeLink(card.sourceUrl) ?? 'https://www.dlkt.ee/')}" rel="noopener noreferrer">Original: ${esc(card.publisher)}</a></p>${card.byline && card.licenseUrl ? `<p>${esc(card.byline)} · <a href="${esc(card.licenseUrl)}" rel="noopener noreferrer">Source license</a></p>` : ''}<p class="meta">${esc(card.dateLabel)}: ${esc(card.date)} · Source checked: ${esc(card.observedAt)}</p>${card.summary === undefined ? '' : `<p>Publisher excerpt from the source feed:</p><p dir="auto">${esc(card.summary)}</p>`}<p class="meta">${esc(card.attribution)}</p><p class="meta">${esc(card.boundary)}</p></li>`).join('');
    return `<details><summary>${esc(relatedLabel(edition, primaryId))}</summary><ul>${items}</ul></details>`;
}
export function artifactText(a, context = 'download') {
    if (!validArtifact(a))
        throw Error('EDITION_ARTIFACT_INVALID');
    const e = a.edition;
    const lines = ['DLKT', `Edition prepared: ${e.generatedAt}`, `Source check: ${e.sourceCheckAt}`, `Coverage: ${e.state}`, `Selected topics: ${e.settings.topics.map(t => topicLabels[t]).join(', ')}`, `Focus: ${e.settings.query || 'No phrase filter'}`,
        'A dated source selection, not a statement that everything below is new.', ''];
    e.cards.forEach((c, index) => {
        const i = a.insights[index];
        if (!i)
            return;
        lines.push(`${index + 1}. ${c.title}`, ...(c.byline ? [c.byline, c.licenseUrl ?? ''] : []), c.publisher, `${c.dateLabel}: ${c.date}`, `Source checked: ${c.observedAt}`, c.sourceUrl);
        if (c.summary !== undefined)
            lines.push('Publisher excerpt from the source feed:', c.summary, c.attribution, `Source terms: ${i.termsUrl}`);
        if (i.state === 'ready') {
            lines.push('Selected publisher passages (not a full-document summary):', i.introduction, ...i.points.map(p => `“${p.text}”`), `Content checked: ${i.checkedAt}`, i.attribution, `Source terms: ${i.termsUrl}`, i.nextStep);
        }
        else
            lines.push(i.state === 'unsupported' ? 'Listing only: this document format is not supported for content extraction.' : 'Listing only: the source content could not be verified during preparation.');
        const guide = cardGuide(c);
        lines.push(`Scope: ${guide.scope}`, `Next step: ${guide.nextStep}`, c.boundary, '', ...relatedText(e, c.id));
    });
    if (!e.cards.length)
        lines.push(e.state === 'unavailable' ? 'Source verification unavailable.' : 'No eligible records in this selection.');
    lines.push('Saved copies do not update. Check original sources for the latest status.', context === 'download' ? 'Prepared on request. No scheduled delivery has been activated.' : 'Your requested dated briefing edition.', `Edition ID: ${e.id}`, `Artifact SHA-256: ${a.digest}`);
    return lines.join('\n');
}
/** Self-contained reading copy: no scripts, trackers, fonts, images or external styles. */
export function artifactHtml(a, context = 'download') {
    if (!validArtifact(a))
        throw Error('EDITION_ARTIFACT_INVALID');
    const e = a.edition;
    const articles = e.cards.map((c, index) => {
        const i = a.insights[index];
        if (!i)
            throw Error('EDITION_ARTIFACT_INVALID');
        const guide = cardGuide(c);
        const excerpt = i.state === 'ready' ? `<p>${esc(i.introduction)}</p>${i.points.map(p => `<blockquote>${esc(p.text)}</blockquote>`).join('')}<p class="meta">Content checked: ${esc(i.checkedAt)}. Selected passages, not a full summary.</p><p>${esc(i.nextStep)}</p><details><summary>Evidence and attribution</summary><p>${esc(i.attribution)}</p><p><a href="${esc(i.termsUrl)}" rel="noopener noreferrer">Source terms</a></p><p class="fingerprint">Document SHA-256: ${esc(i.documentHash ?? '')}</p></details>`
            : `<p>Listing only. ${i.state === 'unsupported' ? 'This document format is not supported for extraction.' : 'The document content could not be verified during preparation.'}</p>`;
        return `<article><p class="tag">${index + 1} / ${e.cards.length} · ${esc(topicLabels[c.topic] ?? c.topic)}</p><h2>${esc(c.title)}</h2>${c.byline && c.licenseUrl ? `<p class="meta">${esc(c.byline)} · <a href="${esc(c.licenseUrl)}" rel="noopener noreferrer">Source license</a> · <a href="${esc(c.sourceUrl)}" rel="noopener noreferrer">Original: ${esc(c.publisher)}</a></p>` : ''}<p class="meta">${esc(c.publisher)} · ${esc(c.dateLabel)}: ${esc(c.date)}</p>${c.summary !== undefined ? `<p class="meta">Publisher excerpt from the source feed:</p><p>${esc(c.summary)}</p><p class="meta">${esc(c.attribution)}</p><p><a href="${esc(i.termsUrl)}" rel="noopener noreferrer">Source terms</a></p>` : ''}<div class="card-guide"><p><strong>Scope: </strong>${esc(guide.scope)}</p><p><strong>Next step: </strong>${esc(guide.nextStep)}</p></div>${excerpt}<p><a href="${esc(safeLink(c.sourceUrl) ?? 'https://www.dlkt.ee/')}" rel="noopener noreferrer">Read original source</a></p><p class="meta">Source checked: ${esc(c.observedAt)}</p><details><summary>Context and limits</summary><p>${esc(c.boundary)}</p></details>${relatedHtml(e, c.id)}</article>`;
    }).join('');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>DLKT — ${esc(e.generatedAt.slice(0, 10))}</title><style>:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#ffffff;color:#000000;font:16px/1.6 Arial,Helvetica,sans-serif}main{max-width:840px;margin:auto;padding:32px 20px}header{border-bottom:4px solid #f66061;padding-bottom:24px}h1{font-size:36px;line-height:1.15;margin:0 0 16px}h1 span{color:#f66061}h2{font-size:24px;line-height:1.3;overflow-wrap:anywhere}article{padding:28px 0;border-bottom:1px solid #000000;break-inside:avoid}.tag{font-weight:700}.meta{font-size:14px}blockquote{margin:16px 0;border-left:4px solid #f66061;padding:8px 16px}a{color:inherit;text-underline-offset:4px}summary{cursor:pointer;font-weight:700;padding:10px 0}.fingerprint{font-size:12px;overflow-wrap:anywhere}footer{padding:28px 0}@media print{main{padding:0}details{display:block}h1{font-size:28px}a{overflow-wrap:anywhere}}</style></head><body><main><header><h1>DLKT</h1><p>Your dated reading copy.</p><p>Prepared: ${esc(e.generatedAt)}<br>Source check: ${esc(e.sourceCheckAt)}<br>Coverage: ${esc(e.state)}</p><p>Topics: ${esc(e.settings.topics.map(t => topicLabels[t]).join(', '))}<br>Focus: ${esc(e.settings.query || 'No phrase filter')}</p><p>This file includes your chosen focus. Share it only with intended recipients.</p></header>${articles || '<p>No eligible source records in this edition.</p>'}<footer><p>Saved copies do not update. Sources can change after preparation. This is not a full-document summary or personalised advice.</p><p>${context === 'download' ? 'Preparing this copy does not send an email or activate automatic delivery.' : 'Your requested dated briefing edition.'}</p><p><a href="https://www.dlkt.ee/" rel="noopener noreferrer">Return to DLKT</a></p><p class="fingerprint">Edition: ${esc(e.id)}<br>Artifact SHA-256: ${esc(a.digest)}</p></footer></main></body></html>`;
}
