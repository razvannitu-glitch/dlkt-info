import { localCardLabel } from './local-contracts.js';
import { localReading } from './local-presentation.js';
import { localEventCalendar } from './local-event-calendar.js';
import { weatherMotionNode } from './glance-weather-motion.js';
import { contextPhotoNode } from './card-photo-browser.js';
const node = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
const format = (time, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time));
/** Shared local-card presentation: homepage and city view retain identical provenance. */
export function localCardNode(card, c, now = Date.now()) {
    const reading = localReading(card, c, now), a = node('article', '', 'info-card local-card');
    a.dataset.localId = card.id;
    if (card.kind === 'forecast')
        a.dataset.weatherRevision = JSON.stringify([card.checkedAt, card.sourceUpdatedAt, card.weatherSymbols ?? null]);
    if (card.news) {
        a.dataset.newsSourceId = card.news.sourceId;
        a.dataset.newsTopic = card.news.topic;
        a.dataset.publishedAt = card.news.publishedAt;
    }
    const head = node('header');
    head.append(node('span', localCardLabel(card), 'card-topic'), node('span', c.name, 'card-index'));
    const body = node('div', '', 'card-content');
    body.append(node('h3', reading.title));
    if (card.kind === 'forecast')
        body.append(weatherMotionNode(card, now));
    for (const p of reading.paragraphs)
        body.append(node('p', p, 'card-context'));
    if (reading.period)
        body.append(node('p', reading.period, 'card-date'));
    if (reading.nextStep)
        body.append(node('p', reading.nextStep, 'card-context'));
    const credit = node('p', (card.news?.byline ? card.news.byline + ' · ' : '') + card.publisher, 'card-boundary');
    if (card.news?.licenseUrl) {
        const license = node('a', 'CC BY 4.0');
        license.href = card.news.licenseUrl;
        license.target = '_blank';
        license.rel = 'noopener noreferrer';
        credit.append(document.createTextNode(' · '), license);
    }
    body.append(credit);
    const details = node('details', '', 'evidence');
    details.append(node('summary', 'Source and coverage'), node('p', `Source checked ${format(card.checkedAt, c.timezone)}`, 'card-boundary'), node('p', card.boundary, 'card-boundary'), node('p', card.kind === 'forecast' ? `Forecast period ends ${format(card.validTo, c.timezone)}.` : `Source check expires ${format(card.validTo, c.timezone)}. This is not the event end time.`, 'card-boundary'));
    if (card.sourceUpdatedAt)
        details.append(node('p', `${card.kind === 'forecast' ? 'Forecast issued' : 'Source updated'} ${format(card.sourceUpdatedAt, c.timezone)}`, 'card-date'));
    if (card.context) {
        details.append(node('p', card.context.when, 'card-boundary'), node('p', card.context.why, 'card-boundary'), node('p', card.context.action, 'card-boundary'));
        const evidence = node('a', 'Checked evidence document', 'source-link');
        evidence.href = card.context.documentUrl;
        evidence.target = '_blank';
        evidence.rel = 'noopener noreferrer';
        details.append(evidence, node('p', `Evidence SHA-256: ${card.context.documentHash}`, 'card-boundary'));
    }
    for (const fact of card.facts)
        details.append(node('p', fact, 'card-boundary'));
    if (card.news)
        details.append(node('p', card.news.attribution, 'card-boundary'));
    const source = node('a', card.news ? 'Read the full report' : 'Open official source', 'source-link');
    source.href = card.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    body.append(source);
    if (localEventCalendar(card, c, now)) {
        const calendar = node('button', 'Add to calendar', 'text-button');
        calendar.type = 'button';
        calendar.dataset.calendarEvent = card.id;
        const feedback = node('p', '', 'card-boundary');
        feedback.hidden = true;
        feedback.setAttribute('role', 'status');
        calendar.addEventListener('click', () => {
            const file = localEventCalendar(card, c, Date.now());
            feedback.hidden = false;
            if (!file) {
                calendar.disabled = true;
                feedback.textContent = 'Event details need a fresh check. Refresh local information or open the official source.';
                return;
            }
            let address = null;
            try {
                address = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
                const download = node('a');
                download.href = address;
                download.download = file.filename;
                download.hidden = true;
                document.body.append(download);
                try {
                    download.click();
                }
                finally {
                    download.remove();
                }
                feedback.textContent = 'Calendar file prepared. Open it in your calendar to add the event. Confirm the current schedule and admission with the organiser.';
            }
            catch {
                feedback.textContent = 'The calendar file could not be prepared. Open the official source for the event details.';
            }
            finally {
                if (address !== null) {
                    const resource = address;
                    setTimeout(() => URL.revokeObjectURL(resource), 1000);
                }
            }
        });
        body.append(calendar, feedback);
    }
    if (card.kind === 'forecast') {
        const license = node('a', 'MET Norway · CC BY 4.0');
        license.href = 'https://creativecommons.org/licenses/by/4.0/';
        license.target = '_blank';
        license.rel = 'noopener noreferrer';
        details.append(license);
    }
    a.append(head);
    if (card.kind !== 'forecast') {
        const topic = card.kind === 'event' ? 'culture' : card.kind === 'transport' || card.kind === 'transport-notice' ? 'travel' : card.kind === 'utility-notice' ? 'housing' : undefined;
        const photo = contextPhotoNode({ title: card.title, ...(topic ? { topic } : {}) }, now);
        if (photo)
            a.append(photo);
    }
    a.append(body, details);
    return a;
}
