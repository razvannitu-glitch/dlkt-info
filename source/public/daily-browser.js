import { translate as tr } from './i18n-browser.js';
import { sourceLanguage } from './news-sources.js';
import { contextForCard } from './context.js';
import { photoNode, contextPhotoNode } from './card-photo-browser.js';
import { localCardPhotoReference } from './local-photo-reference.js';
import { editorialCategory as categoryForCard } from './editorial-categories.js';
import { cardGuideNode } from './card-guide.js';
import { cardCreditsNode } from './credits.js';
import { localReading, localCardCategory } from './local-presentation.js';
import { sharedTopic } from './shared-card-link.js';
import { addCardSharing } from './shared-card-actions.js';
import { planDailyReading, changeExplanation, nextReadingBoundary } from './daily-reading.js';
import { DeviceMemory, validSettings } from './device-memory.js';
import { safeLink } from './card-validation.js';
import { attachInsight, pruneInsights } from './insight-browser.js';
import { safeLocale } from './reader.js';
import { object, validCity, currentLocalSnapshot, localCardLabel, localCoverageNotes } from './local-contracts.js';
import { DAILY_VERSION, DAILY_TOPICS, validProfile, profileKey, localDay, validZone, validTopicSnapshot } from './daily-contracts.js';
import { selectDaily, feedbackMatches } from './daily-selection.js';
import { DAILY_INTERESTS, DAILY_LENGTHS, RECOMMENDED_DAILY_TOPICS, interestState, toggleInterest } from './daily-interests.js';
const get = (id) => { const n = document.getElementById(id); if (!n)
    throw Error('DAILY_ELEMENT_MISSING'); return n; };
const make = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; n.className = cls; return n; };
const section = get('daily-workspace'), form = get('daily-settings'), cards = get('daily-cards'), status = get('daily-status'), feedbackMessage = get('daily-feedback'), intro = get('daily-intro');
const store = new DeviceMemory();
let saved = null, profile = null, selectedCity = null, topicContext = null, city = null, local = null, topics = null, selection = null;
let baseline = null;
let sharedPreview = false;
let busy = false, storageFailed = false, edited = sharedTopic(window.location.hash) !== null, ticket = 0, pending = null, expiry, savedCards = [], feedback = [];
let channel = null;
try {
    if (typeof BroadcastChannel === 'function')
        channel = new BroadcastChannel('dlkt-info-device-changes-v1');
}
catch { /* Optional cross-tab messaging. */ }
const announce = (s) => { feedbackMessage.textContent = s; };
const changed = () => { try {
    channel?.postMessage('changed');
}
catch { /* Commits do not depend on messaging. */ } };
const zone = () => { try {
    const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return validZone(z) ? z : 'UTC';
}
catch {
    return 'UTC';
} };
const date = (value, time = false) => new Intl.DateTimeFormat(safeLocale(navigator.language || 'en-GB'), { timeZone: profile?.timezone ?? zone(), dateStyle: 'medium', ...(time ? { timeStyle: 'short' } : {}) }).format(new Date(value));
// Group buttons and restored profiles must retain every supported topic, including
// those without a second visible checkbox in the professional-options panel.
for (const topic of DAILY_TOPICS) {
    if (form.querySelector(`[name=daily-topic][value="${topic}"]`))
        continue;
    const input = make('input');
    input.type = 'checkbox';
    input.name = 'daily-topic';
    input.value = topic;
    input.hidden = true;
    form.append(input);
}
const selectedTopics = () => Array.from(form.querySelectorAll('[name=daily-topic]:checked')).map(n => n.value);
function setTopics(values) { form.querySelectorAll('[name=daily-topic]').forEach(n => n.checked = values.includes(n.value)); }
function syncSetup() {
    const values = selectedTopics();
    for (const interest of DAILY_INTERESTS) {
        const button = form.querySelector(`[data-daily-interest="${interest.id}"]`);
        if (!button)
            continue;
        const state = interestState(interest, values);
        button.setAttribute('aria-pressed', state);
        const mark = button.querySelector('.daily-interest-mark'), description = button.querySelector('small');
        if (mark)
            mark.textContent = state === 'true' ? '\u2713' : state === 'mixed' ? '\u2212' : '+';
        if (description)
            description.textContent = interest.description + (state === 'mixed' ? ' \u00b7 partly selected' : '');
    }
    const professional = values.filter(t => t === 'regulation' || t === 'opportunities').length;
    const groups = DAILY_INTERESTS.filter(i => interestState(i, values) !== 'false').length;
    const query = get('daily-query').value.trim(), budget = Number(get('daily-budget').value);
    get('daily-selection-summary').textContent = groups ? `${groups} interest${groups === 1 ? '' : 's'} selected.${query ? ` Filter: ${query}` : ''}` : get('daily-use-city').checked ? 'Your city is selected. Interests are optional.' : 'Choose an interest or try the balanced briefing.';
    get('daily-more-state').textContent = [professional ? `${professional} professional interest${professional === 1 ? '' : 's'}` : '', query ? 'text filter active' : ''].filter(Boolean).join(' \u00b7 ');
    form.querySelectorAll('[data-daily-length]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.dailyLength) === budget)));
    const note = get('daily-length-note');
    note.hidden = DAILY_LENGTHS.some(p => p.value === budget);
    note.textContent = Number.isSafeInteger(budget) && budget > 0 ? `Current: up to ${budget} interest cards` : 'Choose a valid card count.';
}
for (const interest of DAILY_INTERESTS) {
    const button = make('button', '', 'daily-interest');
    button.type = 'button';
    button.dataset.dailyInterest = interest.id;
    button.setAttribute('aria-pressed', 'false');
    const mark = make('span', '+', 'daily-interest-mark');
    mark.setAttribute('aria-hidden', 'true');
    button.append(mark, make('strong', interest.label), make('small', interest.description));
    button.addEventListener('click', () => { edited = true; setTopics(toggleInterest(interest.id, selectedTopics())); syncSetup(); });
    get('daily-interests').append(button);
}
for (const preset of DAILY_LENGTHS) {
    const button = make('button');
    button.type = 'button';
    button.dataset.dailyLength = String(preset.value);
    button.setAttribute('aria-pressed', 'false');
    button.append(make('span', preset.label), make('small', `Up to ${preset.value}`));
    button.addEventListener('click', () => { edited = true; get('daily-budget').value = String(preset.value); syncSetup(); });
    get('daily-lengths').append(button);
}
const lengthNote = make('small', '', 'privacy-note');
lengthNote.id = 'daily-length-note';
lengthNote.hidden = true;
get('daily-lengths').append(lengthNote);
get('daily-recommended').addEventListener('click', () => { edited = true; sharedPreview = true; setTopics(RECOMMENDED_DAILY_TOPICS); get('daily-query').value = ''; get('daily-budget').value = '8'; syncSetup(); form.requestSubmit(); });
async function json(path, signal) { const r = await fetch(path, { credentials: 'omit', headers: { Accept: 'application/json' }, signal }); if (!r.ok)
    throw Error('DAILY_SOURCE_UNAVAILABLE'); const t = await r.text(); if (t.length > 1_500_000)
    throw Error('DAILY_RESPONSE_TOO_LARGE'); return JSON.parse(t); }
function controls() { get('daily-refresh').disabled = busy || !profile; get('daily-save').disabled = busy || !profile || !selection || storageFailed || Boolean(!sharedPreview && saved && profile && profileKey(saved.profile) === profileKey(profile)); get('daily-edit').disabled = busy; get('daily-save').textContent = !sharedPreview && saved && profile && profileKey(saved.profile) === profileKey(profile) ? 'Saved as my briefing' : 'Save as my briefing'; get('daily-forget').hidden = !saved; get('daily-undo').hidden = !selection?.hidden; section.querySelectorAll('[data-daily-feedback],[data-daily-save]').forEach(b => b.disabled = busy); form.querySelectorAll('[data-daily-interest],[data-daily-length],#daily-recommended,[type=submit]').forEach(b => b.disabled = busy); }
function populate(p) {
    get('daily-use-city').checked = p?.cityId !== null && p?.cityId !== undefined || !p && selectedCity !== null;
    get('daily-use-city').disabled = !selectedCity;
    get('daily-city-name').textContent = selectedCity ? `${selectedCity.name}, ${selectedCity.country}` : 'Your city, too?';
    form.querySelectorAll('[name=daily-topic]').forEach(n => n.checked = p ? p.topics.includes(n.value) : topicContext?.topics.includes(n.value) ?? false);
    get('daily-query').value = p?.query ?? topicContext?.query ?? '';
    get('daily-budget').value = String(p?.budget ?? topicContext?.budget ?? 8);
    get('daily-timezone').textContent = p?.timezone ?? selectedCity?.timezone ?? zone();
    syncSetup();
}
function draft() { const p = { cityId: get('daily-use-city').checked && selectedCity ? selectedCity.id : null, topics: Array.from(form.querySelectorAll('[name=daily-topic]:checked')).map(n => n.value), query: get('daily-query').value.trim(), budget: Number(get('daily-budget').value), timezone: get('daily-use-city').checked && selectedCity ? selectedCity.timezone : zone() }; if (!validProfile(p)) {
    status.textContent = 'Choose a city or at least one connected topic, and a positive whole number of cards.';
    return null;
} return p; }
function show(restored = false) { document.dispatchEvent(new CustomEvent('dlkt:daily-selected', { detail: { restored } })); }
function start() { sharedPreview = false; show(); if (saved) {
    profile = saved.profile;
    feedback = [...saved.feedback];
    get('daily-options').open = false;
    void load();
}
else {
    populate(profile);
    get('daily-options').open = true;
    status.textContent = 'Choose what belongs in your briefing. Preview it before saving.';
} }
function descriptor(item) { return item.change === 'coverage' ? tr('storyCoverageAdded') : item.change === 'different' ? 'Listing changed since the previous source check' : item.change === 'added' ? 'New to the source check for this briefing · not necessarily newly published' : item.change === 'same' ? 'Previously included · checked again' : item.change === 'available' ? 'Available from your interests · not a new update' : 'From your selection'; }
function renderItem(item) {
    const a = make('article', '', 'info-card daily-card');
    a.dataset.dailyId = item.id;
    if (item.topic?.storyKey)
        a.dataset.storyKey = item.topic.storyKey;
    const category = item.topic ? categoryForCard(item.topic.card) : item.local ? localCardCategory(item.local) : null;
    if (category)
        a.dataset.editorialCategory = category;
    const head = make('header');
    head.append(make('span', item.local ? localCardLabel(item.local) : item.topic?.label ?? 'Selected source', 'card-topic'));
    const headline = item.local?.kind === 'forecast' && city ? `Weather in ${city.name}` : item.local?.title ?? item.topic?.heading ?? '';
    const body = make('div', '', 'card-content');
    if (item.topic)
        body.append(make('p', item.reason, 'card-kind'));
    body.append(make('h3', headline));
    const details = make('details', '', 'evidence');
    details.append(make('summary', 'Source and details'));
    let source = null;
    if (item.local && city) {
        const c = item.local, r = localReading(c, city, Date.now());
        for (const p of r.paragraphs)
            body.append(make('p', p, 'card-context'));
        if (r.period)
            body.append(make('p', r.period, 'card-date'));
        if (r.nextStep)
            body.append(make('p', r.nextStep, 'card-context'));
        body.append(make('p', c.news?.byline ? c.news.byline + ' · ' + c.publisher : c.publisher, 'card-boundary'));
        source = c.sourceUrl;
        if (c.news) {
            a.dataset.newsSourceId = c.news.sourceId;
            a.dataset.publishedAt = c.news.publishedAt;
            details.append(make('p', c.news.attribution, 'card-attribution'));
            if (c.news.licenseUrl) {
                const license = make('a', 'CC BY 4.0', 'card-attribution');
                license.href = c.news.licenseUrl;
                license.target = '_blank';
                license.rel = 'noopener noreferrer';
                body.append(license);
            }
        }
        details.append(make('p', `Source checked ${date(c.checkedAt, true)}`, 'card-boundary'), make('p', c.boundary, 'card-boundary'), make('p', c.kind === 'forecast' ? `Forecast period ends ${date(c.validTo, true)}.` : `Source check expires ${date(c.validTo, true)}; event and publication dates are separate.`, 'card-boundary'));
        if (c.kind === 'forecast') {
            const license = make('a', 'MET Norway · CC BY 4.0');
            license.href = 'https://creativecommons.org/licenses/by/4.0/';
            license.target = '_blank';
            license.rel = 'noopener noreferrer';
            details.append(license);
        }
        else if (c.kind === 'transport')
            details.append(make('p', 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights 2016. Geomni UK Map data © and database rights [2019].', 'card-attribution'));
        if (c.sourceUpdatedAt)
            details.append(make('p', `${c.kind === 'forecast' ? 'Forecast issued' : 'Source updated'} ${date(c.sourceUpdatedAt, true)}`, 'card-date'));
        if (c.context) {
            details.append(make('p', c.context.when, 'card-boundary'), make('p', c.context.why, 'card-boundary'), make('p', c.context.action, 'card-boundary'));
            const evidence = make('a', 'Checked evidence document', 'source-link');
            evidence.href = c.context.documentUrl;
            evidence.target = '_blank';
            evidence.rel = 'noopener noreferrer';
            details.append(evidence, make('p', `Evidence SHA-256: ${c.context.documentHash}`, 'card-boundary'));
        }
        for (const f of c.facts)
            details.append(make('p', f, 'card-boundary'));
    }
    if (item.topic) {
        const c = item.topic.card;
        const credit = cardCreditsNode(c);
        if (credit)
            body.append(credit);
        body.append(make('p', descriptor(item), 'daily-change'), make('p', `${c.publisher} · ${item.topic.dateLabel}: ${date(c.date)}`, 'card-date'), make('p', item.topic.context, 'card-context'), cardGuideNode(c));
        source = safeLink(c.sourceUrl);
        details.append(make('p', c.title, 'card-boundary'), make('p', `Source checked ${date(c.observedAt, true)}. ${c.boundary}`, 'card-boundary'), make('p', c.attribution, 'card-attribution'));
        const firstChange = item.changes[0];
        if (firstChange) {
            body.append(make('p', changeExplanation(firstChange), 'card-context'));
        }
        if (item.changes.length)
            for (const change of item.changes)
                details.append(make('p', `${change.field}: ${change.before ?? 'Not provided'} → ${change.after ?? 'Not provided'}`, 'card-boundary'));
    }
    if (item.topic) {
        const coverage = contextForCard(item.topic.card);
        a.dataset.contextual = 'true';
        a.dataset.coverage = coverage.basis;
        details.append(make('p', `Publisher coverage: ${coverage.label}`, 'card-boundary'), make('p', coverage.boundary, 'card-boundary'));
        if (item.topic.related.length) {
            const related = make('details', '', 'related'), publication = item.topic.card.kind === 'publication';
            related.append(make('summary', publication ? tr('storyReports', { count: item.topic.related.length }) : 'Other listed versions'));
            if (publication)
                related.append(make('p', tr('storyReportsNote'), 'privacy-note'));
            for (const entry of item.topic.related) {
                const url = safeLink(entry.sourceUrl);
                if (!url)
                    continue;
                const link = make('a', `${entry.publisher}: ${entry.title}`, 'source-link');
                link.href = url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.dir = 'auto';
                link.lang = sourceLanguage(entry) ?? '';
                link.setAttribute('translate', 'no');
                link.dataset.relatedCardId = entry.id;
                related.append(link, make('p', date(entry.date), 'card-date'));
                const credits = cardCreditsNode(entry);
                if (credits)
                    related.append(credits);
            }
            details.append(related);
        }
    }
    body.append(make('div', '', 'card-reading'));
    const actions = make('div', '', 'card-actions');
    const useful = make('button', feedback.some(f => feedbackMatches(item, f) && f.action === 'useful') ? 'Marked useful' : 'Useful', 'secondary');
    useful.type = 'button';
    useful.dataset.dailyFeedback = 'useful';
    useful.setAttribute('aria-pressed', String(useful.textContent === 'Marked useful'));
    useful.addEventListener('click', () => { void rate(item, 'useful'); });
    actions.append(useful);
    // Local operational reports are never hidden by an engagement preference.
    if (item.topic) {
        const later = make('button', 'Not today', 'text-button');
        later.type = 'button';
        later.dataset.dailyFeedback = 'not-today';
        later.addEventListener('click', () => { void rate(item, 'not-today'); });
        const save = make('button', savedCards.some(s => s.id === item.topic?.card.id) ? 'Saved here' : 'Save here', 'text-button');
        save.type = 'button';
        save.dataset.dailySave = 'true';
        save.addEventListener('click', () => { void saveCard(item, save); });
        actions.append(later, save);
    }
    if (item.topic)
        addCardSharing(actions, item.topic.card, announce);
    if (source) {
        const link = make('a', 'Open source', 'source-link');
        link.href = source;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        actions.append(link);
    }
    body.append(actions);
    a.append(head);
    const photograph = item.topic ? photoNode(item.topic.card) : item.local ? contextPhotoNode({ title: headline, sourceUrl: item.local.sourceUrl, ...(category ? { editorialCategory: category } : {}) }, Date.now(), localCardPhotoReference(item.local, city?.id ?? item.local.news?.cityId ?? '', Date.now())) : null;
    if (photograph)
        a.append(photograph);
    a.append(body, details);
    if (item.topic)
        attachInsight(a, item.topic.card);
    return a;
}
function render() {
    if (!profile || !selection)
        return;
    clearTimeout(expiry);
    const now = Date.now();
    // Reapply source freshness and calendar-day rules even when the tab stayed open.
    selection = selectDaily(profile, topics, local, baseline, feedback, now);
    const plan = planDailyReading(selection), live = selection.items;
    const previousOpen = document.querySelector('#daily-previous')?.open ?? false;
    cards.replaceChildren(make('p', plan.summary, 'privacy-note daily-overview'));
    for (const section of ['essential', 'discover']) {
        const items = plan.current.filter(i => i.local && (i.local.context?.section ?? 'essential') === section);
        if (items.length) {
            if (local?.coverage)
                cards.append(make('h3', section === 'essential' ? 'What can affect your day' : 'Discover today'));
            cards.append(...items.map(renderItem));
        }
    }
    const contextItems = plan.current.filter(i => i.local?.context?.section === 'context');
    if (contextItems.length) {
        const context = make('details');
        context.append(make('summary', `Recent city announcements (${contextItems.length})`), ...contextItems.map(renderItem));
        cards.append(context);
    }
    cards.append(...plan.current.filter(i => !i.local).map(renderItem));
    if (local?.coverage) {
        const coverage = make('details');
        coverage.append(make('summary', 'Local coverage'));
        for (const note of localCoverageNotes(local))
            coverage.append(make('p', note, 'privacy-note'));
        cards.append(coverage);
    }
    if (plan.previous.length) {
        const previous = make('details', '', 'daily-previous');
        previous.id = 'daily-previous';
        previous.open = previousOpen;
        previous.append(make('summary', `Previously included (${plan.previous.length})`), make('p', 'These topic cards have no comparable listing changes. Open them when useful; they are not marked as read.', 'privacy-note'), ...plan.previous.map(renderItem));
        cards.append(previous);
    }
    pruneInsights();
    get('daily-date').textContent = new Intl.DateTimeFormat(safeLocale(navigator.language || 'en-GB'), { timeZone: profile.timezone, weekday: 'long', month: 'long', day: 'numeric' }).format(now);
    intro.textContent = [city?.name, profile.topics.length ? `${profile.topics.length} selected topic${profile.topics.length === 1 ? '' : 's'}` : null, `${live.length} card${live.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
    const notes = [...selection.notes];
    status.textContent = notes.join(' ') || 'Prepared from the sources you selected. Publication dates remain visible on each card.';
    const changes = get('daily-changes');
    changes.replaceChildren();
    const diffs = selection.items.filter(i => i.change === 'different' || i.change === 'added' || i.change === 'coverage');
    changes.hidden = !selection.previousAt;
    if (selection.previousAt) {
        changes.append(make('summary', 'Since the previous complete source check'), make('p', `Prepared ${date(selection.previousAt, true)}. Compares eligible source listings and matching forecast hours, not your reading history. Older saved editions may only include the previously selected listings. Missing entries do not mean an incident ended.`, 'privacy-note'));
        for (const line of selection.localChanges)
            changes.append(make('p', line, 'privacy-note'));
        if (!selection.localChanges.length && !diffs.length)
            changes.append(make('p', 'No differences in the comparable items. New forecast time windows are not revisions.', 'privacy-note'));
        else if (diffs.length)
            changes.append(make('p', `${diffs.length} included item${diffs.length === 1 ? ' has' : 's have'} new information or additional reporting since that source check. See the label and source details on each card.`, 'privacy-note'));
    }
    get('daily-end-copy').textContent = live.length ? `That is your current selection.${selection.hidden ? ` ${selection.hidden} topic card${selection.hidden === 1 ? ' is' : 's are'} hidden for today.` : ''}` : 'No matching cards are available now. Change your selection or check again; nothing is added as filler.';
    get('daily-save-note').textContent = !sharedPreview && saved && profileKey(saved.profile) === profileKey(profile) ? 'Saved only in this browser. Rechecked when opened or refreshed, not in the background. Complete prepared editions are remembered for the next comparison.' : 'Preview only. Save this briefing to open it next time in this browser. No account or scheduled delivery is activated.';
    const next = nextReadingBoundary(profile, topics, local, now);
    if (document.visibilityState === 'visible' && document.body.dataset.entryView === 'daily')
        expiry = setTimeout(render, Math.min(2147483647, Math.max(25, next - now + 25)));
    controls();
}
async function persist(d) { try {
    saved = await store.writeDaily(d, saved?.revision ?? null);
    changed();
    return true;
}
catch (error) {
    announce(error instanceof Error && error.message === 'DAILY_CONCURRENT_UPDATE' ? 'Another tab changed your briefing. Reload before saving; nothing was overwritten.' : 'The browser could not save this change. Reading still works.');
    return false;
} }
async function load() {
    if (!profile)
        return;
    const requested = profile, seq = ++ticket;
    pending?.abort();
    pending = new AbortController();
    const signal = AbortSignal.any([pending.signal, AbortSignal.timeout(20000)]);
    busy = true;
    cards.replaceChildren();
    get('daily-changes').hidden = true;
    status.textContent = 'Preparing your selection…';
    controls();
    const previous = saved && profileKey(saved.profile) === profileKey(requested) ? saved.edition : null;
    baseline = previous;
    try {
        const [t, l] = await Promise.allSettled([
            requested.topics.length ? json('/api/iceo', signal) : Promise.resolve(null),
            requested.cityId ? (async () => { const data = await json('/api/places?id=' + encodeURIComponent(requested.cityId ?? ''), signal); if (!object(data) || !Array.isArray(data.cities) || data.cities.length !== 1 || !validCity(data.cities[0]) || data.cities[0].id !== requested.cityId || data.cities[0].timezone !== requested.timezone)
                throw Error('DAILY_CITY_MISMATCH'); const c = data.cities[0]; const value = await json('/api/local?city=' + c.id, signal); if (!currentLocalSnapshot(value, c, Date.now()))
                throw Error('DAILY_LOCAL_MISMATCH'); return { city: c, snapshot: value }; })() : Promise.resolve(null)
        ]);
        if (seq !== ticket || !profile || profileKey(profile) !== profileKey(requested))
            return;
        topics = t.status === 'fulfilled' && validTopicSnapshot(t.value, Date.now()) ? t.value : null;
        local = l.status === 'fulfilled' && l.value ? l.value.snapshot : null;
        city = l.status === 'fulfilled' && l.value ? l.value.city : null;
        if (city) {
            selectedCity = city;
            document.dispatchEvent(new CustomEvent('dlkt:local-snapshot', { detail: { city, snapshot: local, origin: 'daily' } }));
        }
        document.dispatchEvent(new CustomEvent('dlkt:topic-context', { detail: { topics: requested.topics } }));
        selection = selectDaily(requested, topics, local, previous, feedback, Date.now());
        try {
            savedCards = (await store.read()).cards;
        }
        catch { /* Storage failure cannot block reading. */ }
        if (seq !== ticket)
            return;
        if (document.body.dataset.entryView !== 'daily') {
            selection = null;
            return;
        }
        render();
        if (!sharedPreview && saved && profileKey(saved.profile) === profileKey(requested) && selection.edition.complete) {
            await persist({ version: DAILY_VERSION, profile: requested, edition: selection.edition, feedback });
        }
    }
    catch {
        if (seq === ticket) {
            status.textContent = 'This edition could not be prepared. Your previous complete edition is unchanged.';
            selection = null;
        }
    }
    finally {
        if (seq === ticket) {
            busy = false;
            controls();
        }
    }
}
async function saveCard(item, button) { if (!item.topic || busy)
    return; button.disabled = true; try {
    const id = item.topic.card.id;
    const found = (await store.read()).cards.some(c => c.id === id);
    if (found)
        await store.remove(id);
    else
        await store.save(item.topic.card);
    savedCards = (await store.read()).cards;
    button.textContent = found ? 'Save here' : 'Saved here';
    changed();
    announce(found ? 'Removed from Saved.' : 'Card saved in this browser.');
}
catch {
    announce('Card could not be saved. Reading is unchanged.');
}
finally {
    button.disabled = false;
} }
async function rate(item, action) {
    if (!profile || !selection || busy)
        return;
    busy = true;
    controls();
    const previous = [...feedback];
    const exists = feedback.some(f => feedbackMatches(item, f) && f.action === action);
    const today = localDay(Date.now(), profile.timezone);
    feedback = feedback.filter(f => !((f.id === item.id || feedbackMatches(item, f)) && f.action === action) && (f.action === 'useful' || f.day === today));
    if (!exists)
        feedback.push({ id: item.id, signature: item.signature, action, day: today, timezone: profile.timezone });
    feedback = feedback.slice(-2000);
    if (!sharedPreview && saved && profileKey(saved.profile) === profileKey(profile) && !await persist({ version: DAILY_VERSION, profile: saved.profile, edition: saved.edition, feedback }))
        feedback = previous;
    else
        announce(action === 'not-today' ? 'This topic is hidden until the next date in your selected time zone, including additional coverage.' : 'Usefulness noted. This is explicit feedback, not a claim that you read every card.');
    selection = selectDaily(profile, topics, local, baseline, feedback, Date.now());
    busy = false;
    render();
}
document.querySelectorAll('[data-daily-build]').forEach(b => b.addEventListener('click', () => { edited = true; sharedPreview = true; ++ticket; pending?.abort(); busy = false; selection = null; cards.replaceChildren(); get('daily-changes').hidden = true; intro.textContent = 'Choose your city and interests. Preview before saving.'; get('daily-end-copy').textContent = 'Preview your selection before saving it.'; get('daily-save-note').textContent = 'Preview only. Your saved briefing is unchanged until you choose Save as my briefing.'; if (saved) {
    profile = saved.profile;
    feedback = [...saved.feedback];
} populate(profile); get('daily-options').open = true; status.textContent = 'Choose what belongs in your briefing. Preview it before saving.'; show(); controls(); get('daily-interests').querySelector('button')?.focus(); }));
get('entry-daily').addEventListener('click', start);
document.querySelectorAll('[data-daily-start]').forEach(b => b.addEventListener('click', start));
form.addEventListener('input', () => { edited = true; syncSetup(); });
form.addEventListener('submit', event => { event.preventDefault(); const p = draft(); if (!p)
    return; profile = p; feedback = saved && profileKey(saved.profile) === profileKey(p) ? [...saved.feedback] : []; get('daily-options').open = false; show(); void load(); });
get('daily-edit').addEventListener('click', () => { populate(profile); get('daily-options').open = true; get('daily-interests').querySelector('button')?.focus(); });
get('daily-city').addEventListener('click', () => { edited = true; document.body.dataset.dailyPicking = 'true'; get('choose-place').click(); });
get('daily-refresh').addEventListener('click', () => { void load(); });
get('daily-save').addEventListener('click', () => { if (!profile || !selection || busy)
    return; const p = profile, e = selection.edition; if (saved && profileKey(saved.profile) !== profileKey(p) && !window.confirm('Replace the saved personal briefing in this browser? Saved cards and other settings stay unchanged.'))
    return; busy = true; controls(); void persist({ version: DAILY_VERSION, profile: p, edition: e.complete ? e : null, feedback }).then(ok => { if (ok) {
    sharedPreview = false;
    announce('Your personal briefing is saved here. Next time it opens directly; no email or background monitoring is activated.');
} }).finally(() => { busy = false; render(); }); });
get('daily-forget').addEventListener('click', () => { if (!saved || busy || !window.confirm('Remove this personal briefing, its previous edition and feedback from this browser? Your other saved cards stay unchanged.'))
    return; busy = true; controls(); void store.writeDaily(null, saved.revision).then(() => { saved = null; feedback = []; baseline = null; if (profile)
    selection = selectDaily(profile, topics, local, null, feedback, Date.now()); changed(); announce('Personal briefing removed. The current selection is a preview only.'); }).catch(() => announce('Removal could not be confirmed. Reload and try again.')).finally(() => { busy = false; render(); }); });
get('daily-undo').addEventListener('click', () => { if (!profile || busy)
    return; const old = [...feedback]; feedback = feedback.filter(f => f.action !== 'not-today'); busy = true; controls(); void (async () => { if (!sharedPreview && saved && profile && profileKey(saved.profile) === profileKey(profile) && !await persist({ version: DAILY_VERSION, profile: saved.profile, edition: saved.edition, feedback }))
    feedback = old; if (profile)
    selection = selectDaily(profile, topics, local, baseline, feedback, Date.now()); busy = false; render(); })(); });
document.addEventListener('dlkt:city-selected', event => { if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city))
    return; if (event.detail.restored === true && profile?.cityId && document.body.dataset.entryView === 'daily')
    return; selectedCity = event.detail.city; if (document.body.dataset.entryView === 'daily' && get('daily-options').open) {
    get('daily-use-city').disabled = false;
    get('daily-use-city').checked = true;
    get('daily-city-name').textContent = `${selectedCity.name}, ${selectedCity.country}`;
    get('daily-timezone').textContent = selectedCity.timezone;
    syncSetup();
} });
document.addEventListener('dlkt:topic-context', event => { if (event instanceof CustomEvent && validSettings(event.detail))
    topicContext = event.detail; });
document.addEventListener('visibilitychange', () => { clearTimeout(expiry); if (document.visibilityState === 'visible' && document.body.dataset.entryView === 'daily' && selection && profile)
    render(); });
window.addEventListener('pageshow', event => { if (event.persisted && document.body.dataset.entryView === 'daily' && selection)
    render(); });
new MutationObserver(() => { if (document.body.dataset.entryView !== 'daily')
    clearTimeout(expiry);
else if (selection && !busy)
    render(); }).observe(document.body, { attributes: true, attributeFilter: ['data-entry-view'] });
// An explicit saved personal briefing takes restoration priority, unless the user has already interacted.
void (async () => { try {
    saved = await store.readDaily();
}
catch {
    storageFailed = true;
    announce('Browser storage is unavailable. You can still preview a personal briefing.');
} if (saved && !edited) {
    profile = saved.profile;
    feedback = [...saved.feedback];
    get('daily-options').open = false;
    show(true);
    if (document.body.dataset.entryView === 'daily')
        void load();
} })();
// Clearing the shared collection must not silently resurrect a previously remembered briefing.
document.addEventListener('dlkt:daily-cleared', () => { saved = null; feedback = []; baseline = null; pending?.abort(); ++ticket; busy = false; announce('Personal briefing and feedback removed. This selection is no longer saved.'); if (profile)
    selection = selectDaily(profile, topics, local, null, feedback, Date.now()); render(); });
// A recipient's explicit choice opens a preview; it never overwrites a saved briefing.
document.addEventListener('dlkt:shared-topic', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail) || !DAILY_TOPICS.includes(event.detail.topic))
        return;
    edited = true;
    sharedPreview = true;
    pending?.abort();
    ++ticket;
    profile = { cityId: null, topics: [event.detail.topic], query: '', budget: 6, timezone: zone() };
    feedback = [];
    baseline = null;
    show();
    populate(profile);
    get('daily-options').open = false;
    void load();
});
