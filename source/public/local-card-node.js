import { localCardLabel } from './local-contracts.js';
import { localReading, localReadingPreview, localCardCategory } from './local-presentation.js';
import { localEventCalendar } from './local-event-calendar.js';
import { weatherMotionNode } from './glance-weather-motion.js';
import { contextPhotoNode } from './card-photo-browser.js';
import { getLocale } from './i18n-browser.js';
const romanianKinds = { forecast: 'Vreme', transport: 'Transport', 'transport-notice': 'Transport', 'utility-notice': 'Termoficare si apa calda', event: 'Eveniment', 'municipal-news': 'Administratie', 'local-news': 'Stiri locale' };
const node = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
const format = (time, zone, locale = 'en') => new Intl.DateTimeFormat(locale === 'ro' ? 'ro-RO' : 'en-GB', { timeZone: zone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time));
/** Shared local-card presentation: homepage and city view retain identical provenance. */
export function localCardNode(card, c, now = Date.now(), options = {}) {
    const locale = getLocale(), ro = locale === 'ro', reading = localReading(card, c, now, locale), a = node('article', '', 'info-card local-card');
    a.dataset.localId = card.id;
    if (card.kind === 'forecast')
        a.dataset.weatherRevision = JSON.stringify([card.checkedAt, card.sourceUpdatedAt, card.weatherSymbols ?? null]);
    if (card.news) {
        a.dataset.newsSourceId = card.news.sourceId;
        a.dataset.newsTopic = card.news.topic;
        a.dataset.publishedAt = card.news.publishedAt;
    }
    // Only the homepage utility presentation is condensed. Original local reports
    // and the dedicated city view keep their full reading layout.
    const compact = options.compact === true && card.kind !== 'local-news';
    if (compact) {
        a.classList.add('local-utility');
        a.dataset.localKind = card.kind;
    }
    const head = node('header');
    head.append(node('span', ro ? romanianKinds[card.kind] : localCardLabel(card), 'card-topic'), node('span', c.name, 'card-index'));
    const body = node('div', '', 'card-content');
    body.append(node('h3', reading.title));
    const expanded = compact ? node('div', '', 'local-reading-content') : body;
    if (card.kind === 'forecast')
        body.append(weatherMotionNode(card, now));
    const preview = compact ? (localReadingPreview(card, c, locale) ?? reading.paragraphs[0] ?? null) : null;
    if (preview)
        body.append(node('p', preview, 'card-context local-summary'));
    for (const p of reading.paragraphs)
        if (!compact || p !== preview)
            expanded.append(node('p', p, 'card-context'));
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
    const details = node('details', '', compact ? 'evidence local-reading' : 'evidence');
    const scope = ro && card.kind === 'forecast' ? 'Prognoza pentru centrul orasului, nu masuratori sau avertizari oficiale. Valorile prognozate se pot schimba.'
        : ro && card.kind === 'utility-notice' && c.id === '683506' ? 'Sinteza din evidenta oficiala CMTEB. Nu confirma ca imobilul tau este afectat. Orele de remediere sunt estimative.' : card.boundary;
    details.append(node('summary', compact ? (ro ? 'Detalii si sursa' : 'Details and source') : (ro ? 'Sursa si acoperire' : 'Source and coverage')));
    if (compact)
        details.append(expanded);
    details.append(node('p', (ro ? 'Sursa verificata: ' : 'Source checked ') + format(card.checkedAt, c.timezone, locale), 'card-boundary'), node('p', scope, 'card-boundary'), node('p', ro ? (card.kind === 'forecast' ? 'Prognoza valabila pana la ' + format(card.validTo, c.timezone, locale) + '.' : 'Verificarea sursei expira la ' + format(card.validTo, c.timezone, locale) + '. Nu este ora incheierii evenimentului.') : (card.kind === 'forecast' ? `Forecast period ends ${format(card.validTo, c.timezone)}.` : `Source check expires ${format(card.validTo, c.timezone)}. This is not the event end time.`), 'card-boundary'));
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
    const source = node('a', ro ? (card.news ? 'Citeste articolul integral' : 'Deschide sursa oficiala') : (card.news ? 'Read the full report' : 'Open official source'), 'source-link');
    source.href = card.sourceUrl;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    body.append(source);
    if (localEventCalendar(card, c, now)) {
        const calendar = node('button', ro ? 'Adauga in calendar' : 'Add to calendar', 'text-button');
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
    const category = localCardCategory(card);
    a.dataset.editorialCategory = category;
    a.append(head);
    const photo = contextPhotoNode({ title: reading.title, sourceUrl: card.sourceUrl, editorialCategory: category }, now, card.kind === 'local-news' && card.news ? { id: card.news.id, revision: card.news.documentHash, cityId: c.id } : undefined);
    if (photo)
        a.append(photo);
    a.append(body, details);
    return a;
}
