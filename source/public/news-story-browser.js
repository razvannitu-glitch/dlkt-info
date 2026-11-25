import { validNewsPage, validNewsStorySourcesPage, newsOriginalLanguage, NEWS_SOURCE_PAGE_SIZE } from './news-page-contracts.js';
import { fetchNewsStorySources, NewsStorySourcesError } from './news-continuation.js';
import { resolveLocale, t } from './i18n-locale.js';
import { pressReviewCitation } from './source-links.js';
const CONTEXT_FIELDS = ['epoch', 'revision', 'generatedAt', 'startedAt', 'expiresAt', 'language', 'cityId', 'countryCode', 'period', 'filter'];
function original(item) {
    return item.kind === 'global' ? { kind: 'global', card: item.card } : { kind: 'local', card: item.card };
}
function contextOf(page) {
    return Object.freeze({ epoch: page.epoch, revision: page.revision, generatedAt: page.generatedAt, startedAt: page.startedAt, expiresAt: page.expiresAt,
        language: page.language, cityId: page.cityId, countryCode: page.countryCode, period: page.period, filter: page.filter, sourceScope: page.sourceScope ?? 'edition',
        day: page.day === null ? null : Object.freeze({ ...page.day }) });
}
function sameContext(expected, page) {
    if ((expected.sourceScope ?? 'edition') !== (page.sourceScope ?? 'edition') || CONTEXT_FIELDS.some(key => expected[key] !== page[key]))
        return false;
    const a = expected.day, b = page.day;
    return a === null ? b === null : b !== null && a.date === b.date && a.timeZone === b.timeZone && a.start === b.start && a.end === b.end;
}
function distinct(sources) {
    const ids = new Set(), identities = new Set(), urls = new Set();
    for (const source of sources) {
        const identity = source.kind === 'global' ? source.card.identity : source.card.sourceUrl;
        if (ids.has(source.card.id) || identities.has(identity) || urls.has(source.card.sourceUrl))
            return false;
        ids.add(source.card.id);
        identities.add(identity);
        urls.add(source.card.sourceUrl);
    }
    return true;
}
/** Validate one visible group against the fixed edition; the stream's current batch/cursor is unrelated. */
export function createNewsStorySourcesState(item, page, now = Date.now(), city) {
    if (!item.story || page.cityId !== null && city === undefined)
        return null;
    // The main-feed page may be a later batch. This one-item validation projection keeps
    // every edition count/context guard without revalidating twenty other cards per panel.
    if (!validNewsPage({ ...page, items: [item], nextCursor: null }, now, city))
        return null;
    return Object.freeze({ context: contextOf(page), storyKey: item.story.key, sourceTotal: item.story.sourceTotal,
        sources: Object.freeze([original(item), ...item.story.related]), nextCursor: item.story.nextSourcesCursor, usedCursors: Object.freeze([]) });
}
/** All-or-nothing append: a rejected response cannot change the retained original reports or cursor. */
export function appendNewsStorySources(state, value, now = Date.now(), city) {
    if (state.nextCursor === null || Date.parse(state.context.expiresAt) <= now || !validNewsStorySourcesPage(value, now, city)
        || !sameContext(state.context, value) || value.storyKey !== state.storyKey || value.sourceTotal !== state.sourceTotal
        || value.offset !== state.sources.length || value.nextCursor !== null && (value.nextCursor === state.nextCursor || state.usedCursors.includes(value.nextCursor)))
        return null;
    const sources = Object.freeze([...state.sources, ...value.sources]);
    if (!distinct(sources) || sources.length > state.sourceTotal || (value.nextCursor === null) !== (sources.length === state.sourceTotal))
        return null;
    return Object.freeze({ ...state, sources, nextCursor: value.nextCursor, usedCursors: Object.freeze([...state.usedCursors, state.nextCursor]) });
}
function publishedAt(source) {
    return source.kind === 'global' ? source.card.date : source.card.news.publishedAt;
}
function sourceNode(source, locale, timeZone) {
    const row = document.createElement('li'), meta = document.createElement('p'), publisher = document.createElement('strong'), date = document.createElement('time'), link = document.createElement('a');
    meta.className = 'news-story-source-meta';
    publisher.textContent = source.card.publisher;
    publisher.dir = 'auto';
    const citation = pressReviewCitation(source.card.sourceUrl);
    if (citation) {
        const credit = document.createElement('a');
        credit.className = 'publisher-citation';
        credit.textContent = citation.label;
        credit.href = citation.homeUrl;
        credit.target = '_blank';
        credit.rel = 'noopener noreferrer';
        publisher.textContent = '';
        publisher.append(credit);
    }
    date.dateTime = publishedAt(source);
    date.textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(new Date(date.dateTime));
    date.title = date.dateTime;
    date.setAttribute('aria-label', t(locale, 'published') + ': ' + date.textContent);
    link.className = 'news-story-source-link';
    link.href = source.card.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.card.title;
    link.title = source.card.sourceUrl;
    link.dir = 'auto';
    const originalLanguage = newsOriginalLanguage(source), language = document.createElement('span');
    link.lang = originalLanguage ?? '';
    link.setAttribute('translate', 'no');
    language.dataset.originalLanguage = originalLanguage ?? 'unknown';
    language.textContent = originalLanguage ? (new Intl.DisplayNames([locale], { type: 'language' }).of(originalLanguage) ?? originalLanguage) : locale === 'ro' ? 'Limba sursei neprecizata' : locale === 'it' ? 'Lingua della fonte non specificata' : 'Source language unspecified';
    meta.append(publisher, document.createTextNode(' · '), date, document.createTextNode(' · '), language);
    row.append(meta, link);
    if (citation) {
        const original = document.createElement('a');
        original.className = 'text-button';
        original.href = source.card.sourceUrl;
        original.textContent = t(locale, 'openSource');
        original.target = '_blank';
        original.rel = 'noopener noreferrer';
        row.append(original);
    }
    return row;
}
/** Inert until the reader explicitly requests more originals from a connected, open disclosure. */
export function newsStorySourcesNode(item, page, language, city) {
    const initial = createNewsStorySourcesState(item, page, Date.now(), city);
    if (!initial)
        return null;
    let state = initial, request = null, expired = false;
    const locale = resolveLocale(language), timeZone = page.day?.timeZone ?? city?.timezone ?? 'UTC';
    const details = document.createElement('details'), summary = document.createElement('summary'), note = document.createElement('p'), list = document.createElement('ol'), progress = document.createElement('p'), more = document.createElement('button'), status = document.createElement('p');
    details.className = 'news-story-sources';
    details.dataset.storyKey = state.storyKey;
    summary.textContent = t(locale, 'navSources') + ' · ' + new Intl.NumberFormat(locale).format(state.sourceTotal);
    const publishers = document.createElement('span');
    publishers.className = 'news-story-publishers';
    publishers.dir = 'auto';
    publishers.setAttribute('translate', 'no');
    publishers.textContent = [...new Set(state.sources.map(source => source.card.publisher))].slice(0, 3).join(' · ');
    summary.append(publishers);
    details.dataset.sourceTotal = String(state.sourceTotal);
    note.className = 'news-story-sources-note';
    note.textContent = t(locale, 'storyReportsNote');
    list.className = 'news-story-sources-list';
    progress.className = 'news-story-sources-progress';
    more.className = 'news-story-sources-more';
    more.type = 'button';
    status.className = 'news-story-sources-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    const update = () => {
        progress.textContent = t(locale, 'navSources') + ': ' + new Intl.NumberFormat(locale).format(state.sources.length) + ' / ' + new Intl.NumberFormat(locale).format(state.sourceTotal);
        const remaining = state.sourceTotal - state.sources.length;
        more.hidden = state.nextCursor === null;
        more.disabled = expired;
        // Keep keyboard focus during loading; the request guard prevents repeated activation.
        more.setAttribute('aria-disabled', String(request !== null || expired));
        more.textContent = request !== null ? t(locale, 'checkingSources') : t(locale, 'showMore', { count: Math.min(NEWS_SOURCE_PAGE_SIZE, remaining), remaining });
    };
    const markExpired = () => { expired = true; status.textContent = t(locale, 'followStale'); update(); };
    const loadMore = async () => {
        if (!details.isConnected || !details.open || request !== null || state.nextCursor === null || expired)
            return;
        if (Date.parse(state.context.expiresAt) <= Date.now()) {
            markExpired();
            return;
        }
        const controller = new AbortController();
        request = controller;
        details.setAttribute('aria-busy', 'true');
        status.textContent = '';
        update();
        try {
            const value = await fetchNewsStorySources(state.nextCursor, controller.signal, city);
            if (request !== controller || !details.isConnected || !details.open)
                return;
            const next = appendNewsStorySources(state, value, Date.now(), city);
            if (!next) {
                if (Date.parse(state.context.expiresAt) <= Date.now())
                    throw new NewsStorySourcesError('expired');
                throw new NewsStorySourcesError('unavailable');
            }
            const additions = next.sources.slice(state.sources.length).map(source => sourceNode(source, locale, timeZone)), focusMore = document.activeElement === more;
            list.append(...additions);
            state = next;
            request = null;
            update();
            status.textContent = progress.textContent;
            if (focusMore)
                additions[0]?.querySelector('a')?.focus();
        }
        catch (error) {
            if (request !== controller || !details.isConnected || !details.open)
                return;
            if (error instanceof NewsStorySourcesError && error.code === 'expired')
                markExpired();
            else
                status.textContent = t(locale, 'storiesUnavailable') + ' ' + t(locale, 'refreshHint');
        }
        finally {
            if (request === controller)
                request = null;
            if (request === null) {
                details.removeAttribute('aria-busy');
                update();
            }
        }
    };
    more.addEventListener('click', () => { void loadMore(); });
    details.addEventListener('toggle', () => {
        if (!details.open && request !== null) {
            request.abort();
            request = null;
            details.removeAttribute('aria-busy');
            status.textContent = '';
            update();
        }
    });
    for (const source of state.sources)
        list.append(sourceNode(source, locale, timeZone));
    details.append(summary, note, list, progress, more, status);
    update();
    return details;
}
/** Separate verified changes never rewrite the original card or its source receipt. */
export function newsReadingUpdatesNode(updates, language, city, currentSources) {
    if (updates.length === 0)
        return null;
    const locale = resolveLocale(language), now = Date.now(), latest = updates[updates.length - 1], current = currentSources ?? latest;
    const checkedAt = (source) => source.kind === 'global' ? source.card.observedAt : source.card.checkedAt;
    const changed = new Map();
    for (const update of updates)
        for (const source of update.changes)
            changed.set(source.kind + ':' + source.card.id, { source, edition: update.edition });
    const rows = [...changed.values()], details = document.createElement('details'), summary = document.createElement('summary'), note = document.createElement('p'), list = document.createElement('ol');
    details.className = 'news-story-sources news-story-updates';
    details.dataset.newsUpdates = 'true';
    // Only this subtree changes. The original card and any expanded source pagination remain mounted.
    details.dataset.newsUpdatesSignature = JSON.stringify([updates.map(update => [
            update.edition.epoch, update.edition.revision, update.edition.startedAt, update.edition.expiresAt, Date.parse(update.edition.expiresAt) <= now,
            update.sourceCountIncreased, update.item.story?.key ?? null, update.item.story?.sourceTotal ?? 1,
            update.changes.map(source => [source.kind, source.card.id, source.card.sourceUrl, source.card.title, checkedAt(source), publishedAt(source),
                source.kind === 'global' ? source.card.contentHash : source.card.news?.documentHash ?? null])
        ]), [current.edition.epoch, current.edition.revision, current.edition.startedAt, current.edition.expiresAt, Date.parse(current.edition.expiresAt) <= now, current.item.story ?? null]]);
    const title = locale === 'ro' ? 'Actualizari ale subiectului' : locale === 'it' ? 'Aggiornamenti della notizia' : 'Story updates';
    summary.textContent = title + (rows.length ? ' · ' + new Intl.NumberFormat(locale).format(rows.length) : '');
    note.className = 'news-story-sources-note';
    note.textContent = locale === 'ro'
        ? 'Informatii si surse aparute dupa afisarea acestui card. Versiunea initiala este pastrata mai sus.'
        : locale === 'it' ? 'Informazioni e fonti successive alla comparsa di questa scheda. La versione iniziale resta sopra.'
            : 'Information and sources found after this card was displayed. The original version is kept above.';
    list.className = 'news-story-sources-list news-reading-updates-list';
    let displayed = 0;
    const appendRows = () => {
        const additions = rows.slice(displayed, displayed + NEWS_SOURCE_PAGE_SIZE).map(({ source, edition }) => {
            const row = sourceNode(source, locale, edition.day?.timeZone ?? city?.timezone ?? 'UTC');
            row.dataset.updateSourceId = source.card.id;
            row.dataset.updateEpoch = edition.epoch;
            const suppliedSummary = source.kind === 'global' ? source.card.summary : source.card.news?.summary ?? source.card.text;
            if (suppliedSummary && suppliedSummary !== source.card.title) {
                const text = document.createElement('p');
                text.className = 'news-story-sources-note';
                text.dataset.updateSummary = 'true';
                text.textContent = suppliedSummary;
                text.dir = 'auto';
                text.lang = newsOriginalLanguage(source) ?? '';
                text.setAttribute('translate', 'no');
                row.append(text);
            }
            const byline = source.kind === 'global' ? source.card.byline : source.card.news?.byline, licenseUrl = source.kind === 'global' ? source.card.licenseUrl : source.card.news?.licenseUrl;
            if (byline) {
                const credit = document.createElement('p');
                credit.className = 'news-story-sources-note';
                credit.textContent = byline;
                credit.dir = 'auto';
                credit.setAttribute('translate', 'no');
                row.append(credit);
            }
            if (licenseUrl) {
                const license = document.createElement('a');
                license.className = 'text-button';
                license.href = licenseUrl;
                license.target = '_blank';
                license.rel = 'noopener noreferrer';
                license.textContent = locale === 'ro' ? 'Licenta sursei' : locale === 'it' ? 'Licenza della fonte' : 'Source license';
                row.append(license);
            }
            const check = document.createElement('p'), time = document.createElement('time'), expired = Date.parse(edition.expiresAt) <= now;
            check.className = 'news-story-sources-status';
            time.dataset.updateChecked = 'true';
            time.dateTime = checkedAt(source);
            time.title = time.dateTime;
            time.textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: edition.day?.timeZone ?? city?.timezone ?? 'UTC' }).format(new Date(time.dateTime));
            check.append(document.createTextNode(locale === 'ro' ? 'Sursa verificata la ' : locale === 'it' ? 'Fonte verificata il ' : 'Source checked '), time);
            if (expired)
                check.append(document.createTextNode(locale === 'ro' ? ' · Verificarea editiei a expirat.' : locale === 'it' ? ' · La verifica di questa edizione è scaduta.' : ' · This edition check has expired.'));
            row.append(check);
            return row;
        });
        displayed += additions.length;
        list.append(...additions);
        return additions;
    };
    details.append(summary, note, list);
    appendRows();
    if (displayed < rows.length) {
        const more = document.createElement('button');
        more.className = 'news-story-sources-more';
        more.type = 'button';
        const updateMore = () => { const remaining = rows.length - displayed; more.hidden = remaining === 0; more.textContent = t(locale, 'showMore', { count: Math.min(NEWS_SOURCE_PAGE_SIZE, remaining), remaining }); };
        more.addEventListener('click', () => { const additions = appendRows(); updateMore(); additions[0]?.querySelector('a')?.focus(); });
        updateMore();
        details.append(more);
    }
    if (current.item.story && (current.item.story.nextSourcesCursor !== null || latest.sourceCountIncreased && latest.changes.length === 0)) {
        const sources = newsStorySourcesNode(current.item, current.edition, language, city);
        if (sources) {
            sources.dataset.currentUpdateSources = 'true';
            const currentSummary = sources.querySelector('summary');
            if (currentSummary)
                currentSummary.textContent = (locale === 'ro' ? 'Toate sursele din editia actualizata' : locale === 'it' ? 'Tutte le fonti della nuova edizione' : 'All sources in the updated edition') + ' · ' + new Intl.NumberFormat(locale).format(current.item.story.sourceTotal);
            details.append(sources);
        }
        else {
            const unavailable = document.createElement('p');
            unavailable.className = 'news-story-sources-status';
            unavailable.textContent = locale === 'ro' ? 'Verificarea editiei actualizate a expirat. Linkurile deja afisate raman disponibile.'
                : locale === 'it' ? 'La verifica della nuova edizione è scaduta. I link già mostrati restano disponibili.'
                    : 'The updated edition check has expired. The links already shown remain available.';
            details.append(unavailable);
        }
    }
    return details;
}
/** Preserve the card, its color, original open panels and focus when only updates change. */
export function syncNewsReadingUpdates(current, incoming) {
    const before = current.querySelector(':scope > details[data-news-updates]');
    const after = incoming.querySelector(':scope > details[data-news-updates]');
    if (before?.dataset.newsUpdatesSignature === after?.dataset.newsUpdatesSignature)
        return;
    const active = document.activeElement, focused = active instanceof HTMLElement && before?.contains(active);
    const focusedLink = focused && active instanceof HTMLAnchorElement ? active.getAttribute('href') : null;
    if (after) {
        after.open = before?.open ?? false;
        const currentSources = after.querySelector('details[data-current-update-sources]');
        if (currentSources && before?.querySelector('details[data-current-update-sources]')?.open)
            currentSources.open = true;
        if (before)
            before.replaceWith(after);
        else {
            const evidence = current.querySelector(':scope > .evidence');
            if (evidence)
                evidence.before(after);
            else
                current.append(after);
        }
    }
    else
        before?.remove();
    if (focused) {
        const link = focusedLink ? [...(after?.querySelectorAll('a[href]') ?? [])].find(node => node.getAttribute('href') === focusedLink) : undefined;
        const visibleLink = link && !link.closest('details:not([open])') ? link : undefined;
        const focus = visibleLink ?? after?.querySelector('summary') ?? current.querySelector('h3');
        if (focus) {
            if (focus.tagName === 'H3')
                focus.tabIndex = -1;
            focus.focus({ preventScroll: true });
        }
    }
}
