import { photoNode, integratePhotoHeadline } from './card-photo-browser.js';
import { contextForCard } from './context.js';
import { nextDailyEditionDelay, selectContextualToday } from './contextual-today.js';
import { LiveEdition, editionCardSignature, editionUpdateLabel, PUBLIC_EDITION_POLL_MS, publicEditionPollDelay } from './live-edition.js';
import { appendPublicEdition, appendPublicContinuation, dailyEditionSummary, publicEditionState } from './home-edition.js';
import { DiscoveryLoading, renderDiscoveryLoading, bindDiscoveryLoadingActions } from './loading.js';
import { selectHomeLocal } from './home-local.js';
import { localCardNode } from './local-card-node.js';
import { localCoverageReading } from './local-presentation.js';
import { validCity, currentLocalSnapshot } from './local-contracts.js';
import { selectReturnBrief, nextReturnDelay } from './return-brief.js';
import { selectSavedUpdates, nextSavedUpdateDelay, SnapshotProgress } from './saved-updates.js';
import { cardLink } from './shared-card-link.js';
import { cardGuideNode } from './card-guide.js';
import { editorialCardPresentation, compactEditionStatus } from './editorial-presentation.js';
import { organizationSetupFromHash, organizationReadingSettings } from './organization-setup.js';
import { cardCreditsNode } from './credits.js';
import { PUBLIC_TOPICS, TOPIC_LABELS } from './topics.js';
import { PUBLIC_EDITORIAL_CATEGORIES, EDITORIAL_CATEGORY_LABELS } from './editorial-categories.js';
import { shareCard } from './shared-card-actions.js';
import { setupEdition } from './edition-browser.js';
import { captureCheckpoint, compareCheckpoint, focusedSnapshot, compareFocusedCheckpoint } from './comparison.js';
import { DeviceMemory, memoryError } from './device-memory.js';
import { safeLink, validCard } from './card-validation.js';
import { attachInsight, pruneInsights } from './insight-browser.js';
import { selectReadingCards, readingCard, safeLocale } from './reader.js';
const TOPICS = PUBLIC_TOPICS;
const labels = TOPIC_LABELS;
function required(selector) {
    const node = document.querySelector(selector);
    if (!node)
        throw new Error('READER_ELEMENT_MISSING');
    return node;
}
const form = required('#preferences');
const query = required('#query'), budget = required('#budget');
const cards = required('#cards'), status = required('#status');
const heading = required('#result-heading'), count = required('#result-count');
const empty = required('#empty'), emptyCopy = required('#empty-copy');
const finish = required('#finish'), finishCopy = required('#finish-copy');
const explore = required('#explore-records'), more = required('#show-all');
const health = required('#source-health'), checked = required('#checked-at');
const refresh = required('#refresh'), briefing = required('#briefing');
const panel = required('#personalise'), template = required('#card-template');
const feedback = required('#selection-note'), announcement = required('#reader-announcement');
const discoveryLoadingElements = {
    panel: required('#discovery-loading'), title: required('#discovery-loading-title'),
    copy: required('#discovery-loading-copy'), personalise: required('#discovery-loading-personalise'),
    hint: required('#discovery-loading-hint'), retry: required('#discovery-loading-retry'),
    status: required('#discovery-status'),
};
const discoveryLoading = new DiscoveryLoading(() => renderDiscovery());
let initialCheckStarted = false;
let snapshot = null, loading = false, mode = 'briefing';
const snapshotProgress = new SnapshotProgress();
let lastLoadRegressed = false;
let renderTimer;
let discoveryExpiry;
let publicRefreshTimer;
let savedUpdateExpiry;
let lastPublicCheckAttempt = 0;
const PUBLIC_REFRESH_MS = PUBLIC_EDITION_POLL_MS;
let publicRefreshFailures = 0, publicEtag = null, automaticPublicLoad = false, applyPublicUpdate = false;
const liveEdition = new LiveEdition();
let continuationCount = 0, continuationContext = '';
const currentCardByNode = new WeakMap();
function schedulePublicRefresh() {
    clearTimeout(publicRefreshTimer);
    if (document.visibilityState !== 'visible')
        return;
    publicRefreshTimer = setTimeout(() => { if (document.visibilityState === 'visible')
        void load(true); }, Math.max(1000, publicEditionPollDelay(publicRefreshFailures) - (Date.now() - lastPublicCheckAttempt)));
}
const device = new DeviceMemory();
let deviceState = { focus: null, cards: [], rejected: 0 };
let dailyPresent = false;
let contextualCity = null;
let contextualCityExplicit = false;
let contextualLocation = null;
let contextualLocationPending = true;
let contextualLocal = null;
let contextualLocalState = 'idle';
let savedInterests = [];
let visitInterests = null;
let savedView = false, changesView = false, deviceBusy = false, editedFocus = false;
let checkpoint = null, checkpointInvalid = false, checkpointLoaded = false, lastLoadFailed = true;
const memoryMessage = required('#memory-status');
let toastTimer;
function toast(message) { const item = required('#reader-toast'); clearTimeout(toastTimer); item.textContent = message; item.hidden = false; toastTimer = setTimeout(() => { item.hidden = true; }, 5500); }
let changes = null;
try {
    if (typeof BroadcastChannel === 'function')
        changes = new BroadcastChannel('dlkt-info-device-changes-v1');
}
catch { /* Reading and storage do not depend on cross-tab messaging. */ }
function memoryControls() {
    required('#saved-count').textContent = String(deviceState.cards.length);
    required('#forget-focus').hidden = deviceState.focus === null;
    required('#clear-device').disabled = deviceBusy || (!deviceState.focus && !deviceState.cards.length && !deviceState.rejected && !checkpoint && !checkpointInvalid && !dailyPresent);
    document.querySelectorAll('[data-memory-write]').forEach(b => { b.disabled = deviceBusy; });
    document.querySelectorAll('[data-save-card]').forEach(b => {
        const saved = deviceState.cards.some(entry => entry.id === b.dataset.saveCard);
        const label = b.querySelector('.save-label');
        if (label)
            label.textContent = saved ? 'Saved here' : 'Save here';
        else
            b.textContent = saved ? 'Saved here' : 'Save here';
        b.setAttribute('aria-pressed', String(saved));
        b.title = saved ? 'Remove this card from this browser' : 'Save this card in this browser only';
        b.disabled = deviceBusy;
    });
    comparisonControls();
    renderReturnBrief();
}
function restoreSettings(s) {
    form.querySelectorAll('input[name=topic]').forEach(i => { i.checked = s.topics.includes(i.value); });
    query.value = s.query;
    budget.value = String(s.budget);
    mode = s.mode;
}
async function readDevice(restore = false) {
    try {
        deviceState = await device.read();
        try {
            const personal = await device.readDaily();
            dailyPresent = personal !== null;
            savedInterests = personal?.profile.topics ?? deviceState.focus?.settings.topics ?? [];
        }
        catch {
            dailyPresent = true;
            savedInterests = [];
        }
        await readComparison();
        if (restore && deviceState.focus && !editedFocus) {
            restoreSettings(deviceState.focus.settings);
            memoryMessage.textContent = 'Your remembered focus was restored in this browser.';
            void load();
            document.dispatchEvent(new CustomEvent('dlkt:reader-selected', { detail: { restored: true } }));
        }
        if (deviceState.rejected)
            memoryMessage.textContent = 'Some stored data could not be read safely. It is not shown; you can clear this browser data.';
        memoryControls();
        if (savedView || changesView || restore)
            render();
    }
    catch (error) {
        checkpointLoaded = true;
        checkpointInvalid = true;
        memoryMessage.textContent = memoryError(error);
        memoryControls();
        if (changesView)
            render();
    }
}
async function writeDevice(action, message, after) {
    if (deviceBusy)
        return;
    deviceBusy = true;
    memoryControls();
    let committed = false;
    try {
        await action();
        committed = true;
        deviceState = await device.read();
        try {
            const personal = await device.readDaily();
            dailyPresent = personal !== null;
            savedInterests = personal?.profile.topics ?? deviceState.focus?.settings.topics ?? [];
        }
        catch {
            dailyPresent = true;
            savedInterests = [];
        }
        await readComparison();
        memoryMessage.textContent = message;
        announcement.textContent = message;
        toast(message);
        after?.();
        if (savedView)
            render();
        try {
            changes?.postMessage('changed');
        }
        catch { /* A committed write stays successful if messaging is unavailable. */ }
    }
    catch (error) {
        if (error instanceof Error && error.message === 'CHECKPOINT_CONCURRENT_UPDATE') {
            await readComparison();
            if (changesView)
                render();
        }
        memoryMessage.textContent = committed ? 'Change saved, but this page could not reload it. Refresh to view the stored data.' : memoryError(error);
        announcement.textContent = memoryMessage.textContent;
        toast(memoryMessage.textContent);
    }
    finally {
        deviceBusy = false;
        memoryControls();
        if (changesView)
            required('#comparison-message').textContent = memoryMessage.textContent;
    }
}
async function readComparison() {
    try {
        checkpoint = await device.readCheckpoint();
        checkpointInvalid = false;
    }
    catch {
        checkpoint = null;
        checkpointInvalid = true;
    }
    finally {
        checkpointLoaded = true;
    }
}
function comparisonControls() {
    let allowed = false;
    if (snapshot && !lastLoadFailed && !loading && !checkpointInvalid && checkpointLoaded) {
        try {
            const selected = settings();
            if (selected)
                captureCheckpoint(focusedSnapshot(snapshot, selected.topics), Date.now(), '11111111-1111-4111-8111-111111111111');
            allowed = selected !== null;
        }
        catch { /* Missing or expired source checks must not replace a baseline. */ }
    }
    required('#save-check').disabled = deviceBusy || !allowed;
    required('#forget-check').hidden = !checkpoint;
    required('#forget-check').disabled = deviceBusy;
}
function annotateComparison(node, difference) {
    node.dataset.comparison = difference.kind;
    const message = difference.kind === 'not-in-saved-check'
        ? 'Not in your saved check. This listing may have been published earlier.'
        : 'Listing updated since your saved check. See the exact changes below.';
    node.querySelector('.card-content')?.prepend(make('p', 'saved-copy-note', message));
    if (!difference.changes.length)
        return;
    const labels = { title: 'Title', date: 'Date', dateLabel: 'Date meaning', deadline: 'Listed closing date', version: 'Version', sourceUrl: 'Source address', publisher: 'Publisher', summary: 'Publisher excerpt', byline: 'Source credits', licenseUrl: 'Source license', context: 'Publisher coverage' };
    const detail = make('details', 'evidence'), list = make('dl', '');
    detail.append(make('summary', '', 'What changed in this listing?'));
    for (const change of difference.changes) {
        list.append(make('dt', '', labels[change.field]), make('dd', '', `Saved: ${change.before ?? 'Not provided'}`), make('dd', '', `Current: ${change.after ?? 'Not provided'}`));
    }
    detail.append(list);
    node.append(detail);
}
function openReturnChanges() {
    const topics = checkpoint ? selectReturnBrief(checkpoint, null, Date.now(), false).topics : [];
    if (topics.length)
        restoreSettings({ topics, query: '', budget: 6, mode: 'records' });
    required('#comparison-saved-only').checked = false;
    changesView = true;
    savedView = false;
    editedFocus = true;
    render();
    if (!snapshot && !loading)
        void load();
    document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));
    heading.focus();
    heading.scrollIntoView({ block: 'start' });
}
function currentSavedUpdates() { return selectSavedUpdates(deviceState.cards, snapshot, Date.now(), !lastLoadFailed && !loading); }
function openSavedCards(id) {
    if (id) {
        const index = deviceState.cards.findIndex(item => item.id === id);
        if (index >= 0 && Number(budget.value) <= index)
            budget.value = String(index + 1);
    }
    changesView = false;
    savedView = true;
    editedFocus = true;
    render();
    document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));
    heading.focus();
    heading.scrollIntoView({ block: 'start' });
    // Only the existing public snapshot is requested. Saved identities never leave the browser.
    if (!loading)
        void load();
}
function savedSummary(model) {
    if (loading)
        return 'Checking current sources for your saved cards. Your original copies stay intact.';
    if (model.state === 'unavailable')
        return 'Current checks are unavailable for your saved cards. This is not a no-change result. Your original copies stay intact.';
    const changes = `${model.materialCount} saved card${model.materialCount === 1 ? ' has' : 's have'} a changed listed detail · ${model.wordingCount} with revised publisher wording.`;
    const scope = ` ${model.checkedCount}/${model.items.length} saved listings checked. Comparisons are with the copy you saved, not with your last visit.`;
    const missing = model.missingCount ? ` ${model.missingCount} no longer appear in the checked feed; this does not establish their current status.` : '';
    const unavailable = model.unavailableCount ? ` ${model.unavailableCount} could not be checked.` : '';
    const unsupported = model.notComparableCount ? ` ${model.notComparableCount} have no supported details in both copies to compare.` : '';
    return (lastLoadRegressed ? 'An older source response was ignored. The last verified comparison is shown. ' : '') + changes + scope + missing + unavailable + unsupported + (model.state === 'partial' ? ' Coverage is incomplete.' : '');
}
function annotateSavedUpdate(node, item) {
    node.dataset.savedUpdate = item.state;
    const body = node.querySelector('.card-content');
    if (!body)
        return;
    const section = make('div', 'saved-update');
    if (item.changes.length) {
        section.append(make('p', 'saved-copy-note', 'Listed details changed since you saved this card.'));
        for (const change of item.changes)
            section.append(make('p', 'card-context', `${change.label}: saved ${change.before} → current ${change.after}.`));
    }
    if (item.wording) {
        const details = make('details', 'evidence');
        details.append(make('summary', '', 'Publisher wording revised'), make('p', 'privacy-note', 'Exact excerpts are compared below. A wording revision does not establish a changed price, schedule, eligibility or personal impact.'), make('p', 'card-context', `Saved: ${item.wording.before}`), make('p', 'card-context', `Current: ${item.wording.after}`));
        section.append(details);
    }
    if (item.state === 'unchanged')
        section.append(make('p', 'saved-copy-note', 'No changes in the supported details compared.'));
    section.append(make('p', 'privacy-note', item.note));
    if (item.checkedAt)
        section.append(make('p', 'card-date', `Current source check: ${formatted(item.checkedAt, false, true)}.`));
    body.append(section);
}
function renderReturnBrief() {
    const host = required('#return-brief'), copy = required('#return-copy'), list = required('#return-highlights'), dates = required('#return-deadlines');
    const button = required('#return-open');
    button.disabled = deviceBusy;
    required('#return-refresh').disabled = loading;
    list.replaceChildren();
    dates.replaceChildren();
    clearTimeout(savedUpdateExpiry);
    if (deviceState.cards.length) {
        const saved = currentSavedUpdates();
        host.dataset.state = loading ? 'pending' : saved.state;
        required('#return-title').textContent = 'Your saved information.';
        button.textContent = 'View saved updates';
        copy.textContent = savedSummary(saved);
        const highlights = saved.items.filter(item => item.changes.length || item.wording).sort((a, b) => Number(b.changes.length > 0) - Number(a.changes.length > 0)).slice(0, 3);
        for (const item of highlights) {
            const row = make('p', 'return-item'), open = make('button', 'text-button', item.saved.card.title);
            open.type = 'button';
            open.addEventListener('click', () => openSavedCards(item.saved.id));
            row.append(make('span', 'privacy-note', item.changes.length ? 'Listed detail changed' : 'Publisher wording revised'), open);
            for (const change of item.changes)
                row.append(make('span', 'privacy-note', `${change.label}: ${change.before} → ${change.after}`));
            list.append(row);
        }
        const delay = nextSavedUpdateDelay(deviceState.cards, snapshot, Date.now());
        if (delay !== null && document.visibilityState === 'visible')
            savedUpdateExpiry = setTimeout(() => { if (savedView)
                render();
            else
                renderReturnBrief(); }, delay);
        return;
    }
    const model = selectReturnBrief(checkpoint, snapshot, Date.now(), !lastLoadFailed && !loading);
    host.dataset.state = checkpointInvalid ? 'invalid' : checkpoint && (loading || !initialCheckStarted) ? 'pending' : model.state;
    required('#return-title').textContent = checkpoint ? 'Since your saved check.' : 'Make your next visit useful.';
    button.textContent = checkpoint ? 'View changes' : 'Set up my return';
    if (checkpointInvalid) {
        copy.textContent = 'Your saved check could not be read safely. Open Personalise to review browser storage.';
        button.textContent = 'Open Personalise';
        return;
    }
    if (!checkpointLoaded) {
        copy.textContent = 'Loading your browser-only saved check…';
        button.disabled = true;
        return;
    }
    if (!checkpoint) {
        copy.textContent = 'Choose your interests and explicitly save a source check. Return here to see what changed. Stored only in this browser.';
        return;
    }
    const scope = model.topics.map(t => labels[t]).join(', ');
    if (model.state === 'invalid') {
        copy.textContent = 'This saved check has no supported public interests. Choose interests and save a new check in Changes.';
        return;
    }
    if (model.state === 'unavailable') {
        copy.textContent = loading ? 'Checking sources for your saved interests…' : !initialCheckStarted ? 'Preparing the source check for your saved interests…' : 'A current comparison is unavailable. This is not a no-change result. Your saved check is kept intact.';
        return;
    }
    const result = model.comparison;
    if (!result)
        return;
    copy.textContent = `${model.newCount} new to this comparison · ${model.updatedCount} listings updated. Saved ${formatted(model.savedAt ?? checkpoint.savedAt)}. ${result.comparableSources}/${result.totalSources} sources comparable. ${model.state === 'partial' ? 'Coverage is incomplete. ' : ''}${model.omittedLegacy ? 'Previously saved software interests are excluded from this homepage summary. ' : ''}Interests: ${scope}.`;
    const boundary = make('p', 'privacy-note', 'New to this comparison may include older publications. Missing feed entries are not confirmed withdrawn. Article text is not compared.');
    list.append(boundary);
    for (const item of model.highlights) {
        const row = make('p', 'return-item'), link = make('a', '', item.card.title);
        link.href = cardLink(item.card);
        row.append(make('span', 'privacy-note', item.kind === 'listing-updated' ? 'Updated listing' : 'New to your saved check'), link, make('span', 'privacy-note', `${item.card.publisher} · ${item.card.dateLabel}: ${formatted(item.card.date, true)}`));
        list.append(row);
    }
    if (model.deadlines.length) {
        dates.append(make('h3', '', 'Listed closing dates · next 7 days'), make('p', 'privacy-note', 'Dates use the publisher region, Europe/Berlin. Confirm exact closing time, current status and eligibility in the original notice.'));
        for (const card of model.deadlines) {
            const row = make('p', 'return-item'), link = make('a', '', `${card.deadline ?? ''} · ${card.title}`);
            link.href = cardLink(card);
            row.append(link);
            dates.append(row);
        }
    }
}
function renderComparison() {
    const intro = required('#comparison-copy');
    heading.textContent = 'Since your saved check';
    cards.dataset.comparisonState = lastLoadFailed ? 'unavailable' : checkpoint ? 'pending' : 'no-baseline';
    cards.replaceChildren();
    pruneInsights();
    finish.hidden = true;
    more.hidden = true;
    feedback.textContent = '';
    count.textContent = '';
    intro.textContent = 'Save a source check for your selected interests, then return to compare listings. Nothing is stored automatically. Article-text changes are not compared.';
    checked.textContent = checkpoint ? `Comparison saved ${formatted(checkpoint.savedAt)}` : 'No comparison check saved';
    empty.hidden = false;
    empty.querySelector('strong')?.replaceChildren(document.createTextNode('No comparison yet.'));
    if (checkpointInvalid) {
        status.textContent = 'The saved comparison could not be read safely.';
        emptyCopy.textContent = 'Use Personalise to clear local data, or retry if browser storage is blocked.';
    }
    else if (!checkpointLoaded) {
        status.textContent = 'Loading your saved source check.';
        emptyCopy.textContent = 'No comparison is available until local storage has been read.';
    }
    else if (!checkpoint) {
        status.textContent = 'Start with Save this source check. Nothing is stored automatically.';
        emptyCopy.textContent = 'Then return to Changes to see listings absent from that check and exact metadata updates.';
    }
    else if (!snapshot || lastLoadFailed) {
        status.textContent = 'Current sources are unavailable. This is not a no-change result.';
        emptyCopy.textContent = 'Your saved check is unchanged. Refresh when the sources are available.';
    }
    else {
        const selected = settings();
        if (!selected || !selected.topics.length) {
            feedback.textContent = 'Choose an interest and a positive whole number for the card budget.';
            comparisonControls();
            return;
        }
        const result = compareFocusedCheckpoint(checkpoint, snapshot, selected.topics, Date.now());
        const savedOnly = required('#comparison-saved-only').checked;
        const savedIds = new Set(deviceState.cards.filter(c => selected.topics.includes(c.card.topic)).map(c => c.id));
        if (savedOnly && !savedIds.size) {
            status.textContent = 'No saved cards in these interests.';
            empty.querySelector('strong')?.replaceChildren(document.createTextNode('Save a card to narrow this comparison.'));
            emptyCopy.textContent = 'This filter compares the explicit source check for your selected interests. It does not start background monitoring.';
            feedback.textContent = result.notes.join(' ');
            cards.dataset.comparisonState = result.state;
            briefing.setAttribute('aria-busy', 'false');
            memoryControls();
            return;
        }
        const relevant = result.cards.filter(d => !savedOnly || savedIds.has(d.card.id));
        const allMatches = selectReadingCards(relevant.map(d => d.card), { ...selected, budget: Math.max(1, relevant.length), mode: 'records' }, Date.now());
        const selection = selectReadingCards(relevant.map(d => d.card), { ...selected, mode: 'records' }, Date.now());
        const indexed = new Map(result.cards.map(d => [d.card.id, d]));
        cards.replaceChildren(...selection.cards.map((view, i) => { const node = cardNode(view, i, selection.cards.length); const diff = indexed.get(view.card.id); if (diff)
            annotateComparison(node, diff); return node; }));
        pruneInsights();
        cards.dataset.comparisonState = result.state;
        count.textContent = `${selection.cards.length} cards`;
        const matchedIds = new Set(allMatches.cards.map(v => v.card.id));
        const newCount = relevant.filter(d => matchedIds.has(d.card.id) && d.kind === 'not-in-saved-check').length, updated = matchedIds.size - newCount;
        status.textContent = result.state === 'unavailable' ? 'Comparison unavailable. No sources have safe matching checks.'
            : `${newCount} listings new to this comparison; ${updated} listings updated in your ${savedOnly ? 'saved-card ' : ''}focus. ${result.state === 'partial' ? 'Coverage is incomplete; this is not an all-clear.' : 'Compared available source listings, not the entire web.'}`;
        if (result.oldestObservation)
            checked.textContent = `Saved ${formatted(checkpoint.savedAt)} · sources checked ${formatted(result.oldestObservation)}${result.newestObservation !== result.oldestObservation ? ' to ' + formatted(result.newestObservation ?? result.oldestObservation) : ''}`;
        empty.hidden = selection.cards.length > 0;
        const title = result.state === 'unavailable' ? 'Comparison unavailable.' : result.cards.length > 0 ? 'No matching differences.' : 'No listing differences found.';
        empty.querySelector('strong')?.replaceChildren(document.createTextNode(title));
        emptyCopy.textContent = result.state === 'unavailable' ? 'The saved check is kept intact. Refresh sources and try again.' : result.cards.length > 0 ? 'Other differences exist, but none match your current focus. Change your filter to inspect them.' : result.state === 'partial' ? 'No differences in the comparable records. Some source coverage is incomplete.' : 'No metadata differences were found in the comparable current listings. Missing feed entries are not confirmed withdrawn; article text and the entire web have not been compared.';
        feedback.textContent = result.notes.join(' ');
        intro.textContent = `Comparison stored only in this browser. ${result.comparableSources}/${result.totalSources} sources comparable. Entries missing from a feed are not treated as withdrawn. Chosen interests: ${selected.topics.map(t => labels[t]).join(', ')}. Saving again replaces the baseline with these interests.`;
        if (selection.cards.length) {
            finish.hidden = false;
            finishCopy.textContent = 'These are source-listing differences, not a record of what you have read.';
            explore.hidden = false;
            more.hidden = selection.cards.length >= selection.availableGroups;
        }
    }
    briefing.setAttribute('aria-busy', 'false');
    memoryControls();
}
function savedCards() {
    empty.querySelector('strong')?.replaceChildren(document.createTextNode('No saved cards.'));
    const entries = deviceState.cards;
    const s = settings();
    if (!s) {
        feedback.textContent = 'Enter a positive whole number for the card budget.';
        return;
    }
    const limit = s.budget;
    const shown = entries.slice(0, limit);
    const updates = currentSavedUpdates();
    cards.replaceChildren(...shown.map((entry, i) => { const node = cardNode(readingCard({ ...entry.card, sourceState: 'stale' }, Date.now()), i, shown.length, entry); const update = updates.items.find(item => item.saved.id === entry.id); if (update)
        annotateSavedUpdate(node, update); return node; }));
    pruneInsights();
    heading.textContent = 'Saved in this browser';
    count.textContent = `${shown.length} of ${entries.length}`;
    status.textContent = entries.length ? savedSummary(updates) : 'Your saved copies, without the current topic filters. Open the original source for its current terms.';
    checked.textContent = 'Browser-only collection · no account sync';
    empty.hidden = shown.length > 0;
    emptyCopy.textContent = 'Use Save here on a card to keep its title, date and original source in this browser.';
    finish.hidden = true;
    feedback.textContent = 'Clearing site data or ending a private-browsing session can remove this collection. Do not use it as your only archive.';
    more.hidden = shown.length >= entries.length;
    if (shown.length < entries.length) {
        finish.hidden = false;
        finishCopy.textContent = 'More saved cards are available.';
        explore.hidden = true;
    }
    briefing.setAttribute('aria-busy', 'false');
    memoryControls();
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function string(value, max = 4000) { return typeof value === 'string' && value.length <= max; }
function stamp(value) { return string(value, 100) && Number.isFinite(Date.parse(value)); }
function validHealth(value) {
    return object(value) && string(value.id, 80) && string(value.label, 300) && string(value.scope) && string(value.publisher, 300) && TOPICS.includes(value.topic)
        && ['verified', 'partial', 'stale', 'unavailable'].includes(String(value.state))
        && Number.isSafeInteger(value.count) && Number(value.count) >= 0 && Number.isSafeInteger(value.rejected) && Number(value.rejected) >= 0
        && (value.verifiedAt === null || stamp(value.verifiedAt)) && safeLink(value.termsUrl) !== null;
}
function valid(value) {
    return object(value) && value.version === 'iceo-primary-mesh-1' && value.product === 'dlkt-info'
        && ['current-official-records', 'current-source-records'].includes(String(value.mode)) && value.deltaAvailable === false
        && value.scheduledDelivery === false && value.accountPersistence === false
        && ['ready', 'partial', 'unavailable'].includes(String(value.state)) && stamp(value.generatedAt)
        && Array.isArray(value.cards) && value.cards.length <= 5000 && value.cards.every(validCard)
        && Array.isArray(value.sources) && value.sources.length <= 100 && value.sources.every(validHealth);
}
function formatted(value, dayOnly = false, utc = false) {
    const options = dayOnly ? { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short', ...(utc ? { timeZone: 'UTC' } : {}) };
    return new Intl.DateTimeFormat(safeLocale(navigator.language || 'en-GB'), options).format(new Date(value));
}
function make(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function settings() {
    const n = Number(budget.value);
    budget.setCustomValidity(Number.isSafeInteger(n) && n > 0 ? '' : 'Choose a positive whole number.');
    if (!budget.validity.valid)
        return null;
    return { topics: Array.from(form.querySelectorAll('input[name=topic]:checked')).map(input => input.value), query: query.value.slice(0, 200).trim(), budget: n, mode };
}
function allVisibleTopicsSelected() { return Array.from(form.querySelectorAll('input[name=topic]:not([hidden])')).every(input => input.checked); }
function updateTabs() {
    const context = settings();
    if (context)
        required('#personalise-summary').textContent = `${allVisibleTopicsSelected() ? 'All topics' : context.topics.map(t => labels[t]).join(', ') || 'No topics'} · ${context.budget} cards`;
    if (context && (editedFocus || deviceState.focus !== null))
        document.dispatchEvent(new CustomEvent('dlkt:topic-context', { detail: context }));
    const prepare = document.querySelector('#prepare-edition');
    if (prepare)
        prepare.hidden = savedView || changesView || mode !== 'briefing';
    document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === (changesView ? 'changes' : savedView ? 'saved' : mode))));
    const chosen = Array.from(form.querySelectorAll('input[name=topic]:checked')).map(input => input.value);
    document.querySelectorAll('[data-focus]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.focus === 'all' ? allVisibleTopicsSelected() : chosen.length === 1 && chosen[0] === button.dataset.focus)));
}
function renderHealth() {
    if (!snapshot)
        return;
    health.replaceChildren();
    health.append(make('p', 'privacy-note', `${snapshot.sources.length} source feeds from ${new Set(snapshot.sources.map(source => source.publisher)).size} publishers. Availability is shown below; multiple feeds are not independent confirmations.`));
    for (const source of snapshot.sources) {
        const section = make('article', 'source-health');
        const state = source.state === 'partial' ? 'Some records excluded' : source.state === 'verified' ? 'Available' : source.state === 'stale' ? 'Older verification' : 'Unavailable';
        section.append(make('h3', '', `${source.label} · ${state}`), make('p', '', source.scope));
        section.append(make('p', '', `${source.count} accepted records${source.rejected ? `; ${source.rejected} rejected by validation` : ''}.`));
        section.append(make('p', '', source.verifiedAt ? `Last successful source check: ${formatted(source.verifiedAt, false, true)}.` : 'No successful source check is available.'));
        const url = safeLink(source.termsUrl);
        if (url) {
            const link = make('a', '', 'Source terms');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            section.append(link);
        }
        health.append(section);
    }
}
async function shareSource(card, button, fallback) {
    const url = safeLink(card.sourceUrl);
    if (!url)
        return;
    try {
        if (typeof navigator.share === 'function')
            await navigator.share({ title: card.title, url });
        else if (navigator.clipboard) {
            await navigator.clipboard.writeText(url);
            button.textContent = 'Link copied';
            announcement.textContent = 'Original source link copied.';
            toast('Original source link copied.');
        }
        else {
            fallback.hidden = false;
            fallback.value = url;
            fallback.focus();
            fallback.select();
        }
    }
    catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError')
            return;
        fallback.hidden = false;
        fallback.value = url;
        fallback.focus();
        fallback.select();
        announcement.textContent = 'Copy the original source link from the selected field.';
    }
}
function cardNode(view, index, total, saved, automaticInsights = true) {
    const fragment = template.content.cloneNode(true);
    const node = fragment.querySelector('article');
    if (!node)
        throw new Error('READER_TEMPLATE_INVALID');
    node.classList.add('editorial-card');
    const put = (selector, value) => { const el = node.querySelector(selector); if (el)
        el.textContent = value; };
    const photograph = photoNode(view.card);
    if (photograph)
        node.querySelector('header')?.after(photograph);
    const card = view.card, presentation = editorialCardPresentation(view, saved !== undefined);
    node.dataset.notice = view.noticeState;
    node.dataset.cardId = card.id;
    const evidence = node.querySelector('.evidence');
    currentCardByNode.set(node, card);
    const coverage = contextForCard(card);
    if ('reason' in view && typeof view.reason === 'string') {
        const why = make('p', 'contextual-reason', view.reason);
        evidence?.append(why);
        node.dataset.contextual = 'true';
    }
    node.dataset.coverage = coverage.basis;
    const editorialCategory = 'category' in view && typeof view.category === 'string' && PUBLIC_EDITORIAL_CATEGORIES.includes(view.category) ? view.category : null;
    const unclassified = 'editorial' in view && object(view.editorial) && view.editorial.classification === 'unclassified';
    put('.card-topic', unclassified ? 'Other topics' : editorialCategory ? EDITORIAL_CATEGORY_LABELS[editorialCategory] : labels[card.topic]);
    if (editorialCategory)
        node.dataset.editorialCategory = editorialCategory;
    put('.card-index', `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`);
    put('.card-kind', presentation.kindLabel);
    const kind = node.querySelector('.card-kind');
    if (kind)
        kind.hidden = !presentation.kindLabel;
    put('h3', presentation.headline);
    const title = node.querySelector('h3'), sourceUrl = safeLink(card.sourceUrl);
    if (title && sourceUrl) {
        const titleLink = make('a', 'card-title-link', presentation.headline);
        titleLink.href = sourceUrl;
        titleLink.target = '_blank';
        titleLink.rel = 'noopener noreferrer';
        title.replaceChildren(titleLink);
    }
    const credit = cardCreditsNode(card);
    if (credit)
        node.querySelector('.card-meta')?.after(credit);
    put('.card-context', presentation.visibleContext ?? '');
    put('.card-publisher', card.publisher);
    put('.card-date', `${view.dateLabel === 'Published' ? '' : view.dateLabel + ': '}${formatted(card.date, true)}`);
    const readingContext = node.querySelector('.card-context'), guide = cardGuideNode(card);
    if (readingContext instanceof HTMLElement)
        readingContext.hidden = presentation.visibleContext === null;
    if (presentation.detailContext)
        evidence?.append(make('p', 'card-detail-context', presentation.detailContext));
    if (presentation.safetyNote)
        readingContext?.after(make('p', 'card-scope-note', presentation.safetyNote));
    if (card.summary !== undefined && card.summary !== view.context) {
        const excerpt = make('p', 'card-context publisher-excerpt');
        excerpt.append(make('strong', '', 'Publisher excerpt: '), document.createTextNode(card.summary));
        readingContext?.after(excerpt);
    }
    evidence?.append(guide);
    const link = node.querySelector('.source-link');
    if (link)
        link.href = safeLink(card.sourceUrl) ?? '#';
    const deadline = node.querySelector('.card-deadline');
    if (deadline && card.deadline) {
        deadline.hidden = false;
        deadline.textContent = `Listed closing date: ${formatted(card.deadline, true)}${view.noticeState === 'awarded' ? ' · not an application deadline for this award' : ''}`;
    }
    const details = node.querySelector('.evidence dl');
    for (const [key, value] of [['Original title', card.title], ['Publisher', card.publisher], ['Source checked', formatted(card.observedAt, false, true)], ['Publication timestamp', formatted(card.date, card.dateLabel === 'Document date')], ['Document identity', card.identity], ['Date meaning', view.dateLabel]]) {
        const detail = make('dd', '', value);
        if (key === 'Source checked')
            detail.dataset.sourceChecked = 'true';
        details?.append(make('dt', '', key), detail);
    }
    details?.append(make('dt', '', 'Publisher coverage'), make('dd', '', coverage.label), make('dt', '', 'Coverage meaning'), make('dd', '', coverage.boundary));
    put('.card-boundary', card.boundary);
    put('.card-attribution', card.attribution);
    if (presentation.originalTitleInDetails)
        put('.evidence summary', 'Full title & source details');
    const related = node.querySelector('.related');
    if (related && view.related.length) {
        related.hidden = false;
        const summary = related.querySelector('summary');
        if (summary)
            summary.textContent = 'grouping' in view && view.grouping === 'matching-headlines' ? `${view.related.length} matching publisher listing${view.related.length === 1 ? '' : 's'} · not independent confirmation` : `${view.related.length} other listed version${view.related.length === 1 ? '' : 's'}`;
        const list = related.querySelector('ul');
        for (const item of view.related) {
            const url = safeLink(item.sourceUrl);
            if (!url)
                continue;
            const row = make('li', '');
            const a = make('a', '', `${item.version ?? item.title} · ${formatted(item.date)}`);
            a.href = url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            row.append(a);
            list?.append(row);
        }
    }
    const button = node.querySelector('.share-source'), fallback = node.querySelector('.share-fallback');
    if (button && fallback) {
        const label = button.querySelector('.share-label');
        if (label)
            label.textContent = 'Share card';
        else
            button.textContent = 'Share card';
        button.setAttribute('aria-label', 'Share this DLKT card');
        fallback.setAttribute('aria-label', 'DLKT card link to copy');
        button.addEventListener('click', () => { void shareCard(currentCardByNode.get(node) ?? card, { button, fallback, announce: message => { announcement.textContent = message; toast(message); } }); });
    }
    const sourceShare = make('button', 'text-button', 'Share original source');
    sourceShare.type = 'button';
    const sourceFallback = make('input', 'share-fallback');
    sourceFallback.type = 'text';
    sourceFallback.readOnly = true;
    sourceFallback.hidden = true;
    sourceFallback.setAttribute('aria-label', 'Original source link to copy');
    sourceShare.addEventListener('click', () => { void shareSource(card, sourceShare, sourceFallback); });
    node.querySelector('.evidence')?.append(sourceShare, sourceFallback);
    const save = node.querySelector('.save-card');
    if (save) {
        save.dataset.saveCard = card.id;
        save.addEventListener('click', () => {
            const exists = deviceState.cards.some(entry => entry.id === card.id);
            void writeDevice(() => exists ? device.remove(card.id) : device.save(currentCardByNode.get(node) ?? card), exists ? 'Card removed from this browser.' : 'Card saved in this browser only.');
        });
    }
    if (saved) {
        const note = make('p', 'saved-copy-note', `Saved here ${formatted(saved.savedAt)}. Original source check ${formatted(card.observedAt)}. This saved copy is retained; current comparisons appear separately when available.`);
        evidence?.append(note);
    }
    else
        attachInsight(node, card, automaticInsights, () => currentCardByNode.get(node) ?? card);
    if (photograph && title) {
        integratePhotoHeadline(photograph, title, node.querySelector(':scope > header') ?? undefined);
        const photoDetails = photograph.querySelector('.photo-details');
        if (photoDetails && evidence) {
            const photoEvidence = make('div', 'card-photo-evidence');
            photoEvidence.append(make('p', 'details-label', 'About this image'));
            for (const child of [...photoDetails.children])
                if (child.tagName !== 'SUMMARY')
                    photoEvidence.append(child);
            const photoCredit = photograph.querySelector('.card-photo-credit');
            if (photoCredit)
                photoEvidence.append(photoCredit.cloneNode(true));
            evidence.append(photoEvidence);
            photoDetails.remove();
        }
    }
    return node;
}
function render() {
    renderDiscovery();
    updateTabs();
    required('#comparison-panel').hidden = !changesView;
    if (changesView) {
        renderComparison();
        return;
    }
    if (savedView) {
        savedCards();
        return;
    }
    if (!snapshot) {
        memoryControls();
        return;
    }
    empty.querySelector('strong')?.replaceChildren(document.createTextNode('No matching cards.'));
    const s = settings();
    if (!s) {
        feedback.textContent = 'Enter a positive whole number for the card budget.';
        return;
    }
    const selection = selectReadingCards(snapshot.cards, s, Date.now());
    cards.replaceChildren(...selection.cards.map((card, i) => cardNode(card, i, selection.cards.length)));
    pruneInsights();
    heading.replaceChildren(document.createTextNode(mode === 'briefing' ? 'Topic results' : 'Explore records'), make('span', 'title-dot', '.'));
    count.textContent = `${selection.cards.length} cards`;
    const rejected = snapshot.sources.reduce((n, source) => n + source.rejected, 0);
    status.dataset.level = snapshot.state === 'unavailable' || snapshot.sources.some(source => source.state !== 'verified') || rejected ? 'warning' : 'normal';
    const unavailable = snapshot.sources.some(source => source.state === 'unavailable' || source.state === 'stale');
    status.textContent = snapshot.state === 'unavailable' ? 'Sources are unavailable. This is not a “nothing changed” result.'
        : unavailable ? 'Some sources are unavailable or older. See Sources & coverage.' : rejected ? 'Coverage is partial. Incomplete records are excluded.' : 'Current source selection. Open Changes to compare a saved check.';
    feedback.textContent = mode === 'briefing' ?
        [selection.excludedNotices ? `${selection.excludedNotices} closed or unconfirmed procurement notices kept in Explore.` : '', selection.excludedStale ? `${selection.excludedStale} older source records kept in Explore.` : '', selection.groupedVersions ? `${selection.groupedVersions} additional software versions grouped with their product.` : ''].filter(Boolean).join(' ') : 'Includes closed and unconfirmed notices, each labelled with its available status.';
    checked.textContent = `Checked ${formatted(snapshot.generatedAt)}`;
    empty.hidden = selection.cards.length > 0;
    emptyCopy.textContent = snapshot.state === 'unavailable' ? 'No synthetic substitute is shown. Try a source check again later.' : !s.topics.length ? 'Choose a topic to start.' : selection.excludedNotices > 0 ? 'No current application window is established by the matching notices. Explore keeps the closed and unconfirmed records available.' : 'No available record matches these settings. Try another focus or inspect source coverage.';
    finish.hidden = selection.cards.length === 0;
    finishCopy.textContent = `${selection.cards.length} cards in this selection. You can change your focus or explore the available records.`;
    more.hidden = selection.cards.length >= selection.availableGroups;
    explore.hidden = mode === 'records';
    briefing.setAttribute('aria-busy', 'false');
    memoryControls();
}
async function load(automatic = false) {
    if (loading)
        return;
    clearTimeout(publicRefreshTimer);
    lastPublicCheckAttempt = Date.now();
    initialCheckStarted = true;
    loading = true;
    discoveryLoading.begin();
    automaticPublicLoad = automatic;
    refresh.disabled = true;
    briefing.setAttribute('aria-busy', 'true');
    if (!automatic)
        status.textContent = 'Checking the available source snapshot…';
    renderDiscovery();
    if (savedView && !automatic)
        savedCards();
    try {
        const headers = { Accept: 'application/json' };
        if (publicEtag && snapshot)
            headers['If-None-Match'] = publicEtag;
        const response = await fetch('/api/iceo', { credentials: 'omit', cache: 'no-cache', headers, signal: AbortSignal.timeout(45000) });
        if (response.status === 304 && snapshot) {
            lastLoadFailed = false;
            lastLoadRegressed = false;
            publicRefreshFailures = 0;
            if (!automatic)
                applyPublicUpdate = true;
            return;
        }
        if (!response.ok)
            throw new Error('SNAPSHOT_UNAVAILABLE');
        const value = await response.json();
        if (!valid(value))
            throw new Error('SNAPSHOT_INVALID');
        const progress = snapshotProgress.accept(value, Date.now());
        if (progress !== 'accepted')
            throw new Error(progress === 'regressed' ? 'SNAPSHOT_REGRESSED' : 'SNAPSHOT_INVALID');
        snapshot = value;
        const etag = response.headers.get('etag');
        publicEtag = etag && /^"[a-f0-9]{64}"$/u.test(etag) ? etag : null;
        lastLoadFailed = false;
        lastLoadRegressed = false;
        publicRefreshFailures = 0;
        if (!automatic)
            applyPublicUpdate = true;
        if (!automatic)
            render();
        else
            renderDiscovery();
        renderHealth();
    }
    catch (error) {
        publicRefreshFailures = Math.min(2, publicRefreshFailures + 1);
        if (error instanceof Error && error.message === 'SNAPSHOT_REGRESSED' && snapshot) {
            lastLoadRegressed = true;
            if (!automatic)
                render();
            else
                renderDiscovery();
            status.textContent = `An older source response was ignored. Showing the snapshot previously verified at ${formatted(snapshot.generatedAt)}.`;
        }
        else {
            lastLoadFailed = true;
            lastLoadRegressed = false;
            if (automatic) {
                renderDiscovery();
            }
            else if (changesView) {
                render();
            }
            else if (snapshot) {
                render();
                status.textContent = `Refresh unavailable. Showing the snapshot previously loaded at ${formatted(snapshot.generatedAt)}; it is not newly verified.`;
            }
            else if (savedView) {
                render();
            }
            else {
                heading.textContent = 'Source check unavailable';
                status.textContent = 'No verified snapshot could be loaded. Retry the source check.';
                empty.hidden = false;
                emptyCopy.textContent = 'No synthetic information is substituted.';
            }
        }
    }
    finally {
        discoveryLoading.finish();
        loading = false;
        automaticPublicLoad = false;
        refresh.disabled = false;
        briefing.setAttribute('aria-busy', 'false');
        if (savedView && !automatic)
            savedCards();
        renderDiscovery();
        memoryControls();
        schedulePublicRefresh();
    }
}
/** Reuse unchanged article nodes, including focused controls and expanded source details. */
function reconcileDiscovery(target, next) {
    const key = (node) => node.dataset.cardId ? `card:${node.dataset.cardId}` : node.dataset.homeLocalId ? `local:${node.dataset.homeLocalId}` : node.id;
    const current = new Map([...target.children].filter((node) => node instanceof HTMLElement).map(node => [key(node), node]));
    const desired = [...next.children].filter((node) => node instanceof HTMLElement).map(node => {
        const existing = current.get(key(node));
        if (!existing || !key(node))
            return node;
        const same = node.dataset.cardId ? existing.dataset.liveSignature === node.dataset.liveSignature : existing.textContent === node.textContent && existing.dataset.weatherRevision === node.dataset.weatherRevision;
        if (!same)
            return node;
        existing.className = node.className;
        if (node.dataset.editionPart)
            existing.dataset.editionPart = node.dataset.editionPart;
        else
            delete existing.dataset.editionPart;
        const freshCard = currentCardByNode.get(node);
        if (freshCard)
            currentCardByNode.set(existing, freshCard);
        for (const selector of ['.card-index', '.card-date', '.contextual-reason', '[data-source-checked]']) {
            const before = existing.querySelector(selector), after = node.querySelector(selector);
            if (before && after)
                before.textContent = after.textContent;
        }
        return existing;
    });
    const keep = new Set(desired);
    for (const node of [...target.children])
        if (!keep.has(node))
            node.remove();
    desired.forEach((node, index) => { if (target.children[index] !== node)
        target.insertBefore(node, target.children[index] ?? null); });
    target.dataset.editionState = next.dataset.editionState ?? '';
    target.dataset.dailyCoverage = next.dataset.dailyCoverage ?? '';
}
function renderDiscovery() {
    clearTimeout(discoveryExpiry);
    renderReturnBrief();
    const section = required('#discovery'), target = required('#discovery-cards'), host = document.createElement('div'), note = required('#discovery-status'), button = required('#discovery-refresh');
    button.disabled = loading;
    target.setAttribute('aria-busy', String(loading));
    if (document.body.dataset.entryView !== 'start') {
        section.dataset.loading = 'hidden';
        renderDiscoveryLoading(discoveryLoadingElements, 'hidden');
        target.replaceChildren();
        pruneInsights();
        return;
    }
    const anchors = applyPublicUpdate ? [] : [...target.querySelectorAll('article')].flatMap(node => { const rect = node.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0 ? [{ node, top: rect.top }] : []; });
    const now = Date.now();
    const city = contextualCity && contextualLocation !== 'estimated' ? { id: contextualCity.id, name: contextualCity.name, countryCode: contextualCity.countryCode, confirmed: true } : undefined;
    const interests = visitInterests ?? savedInterests;
    const context = { countryCode: contextualCity?.countryCode ?? null, preferredTopics: interests, ...(city ? { city } : {}) };
    const candidate = snapshot ? selectContextualToday(snapshot.cards, context, now) : { first: [], more: [] };
    const contextKey = JSON.stringify([context.countryCode, city?.id ?? null, [...interests].sort()]);
    if (continuationContext !== contextKey) {
        continuationContext = contextKey;
        continuationCount = 0;
    }
    const live = liveEdition.present(candidate, contextKey, now, applyPublicUpdate);
    applyPublicUpdate = false;
    const today = live.selection;
    button.textContent = live.changes.total ? 'Show updates' : 'Refresh';
    button.setAttribute('aria-label', live.changes.total ? `Show updates: ${editionUpdateLabel(live.changes)}` : 'Refresh daily top');
    const editionState = publicEditionState(today, { snapshotState: snapshot?.state ?? null, loading: loading || !initialCheckStarted, failed: lastLoadFailed });
    const loadingPhase = discoveryLoading.phase({ pending: editionState === 'pending', unavailable: editionState === 'unavailable', firstCount: today.first.length, moreCount: today.more.length });
    section.dataset.loading = loadingPhase;
    renderDiscoveryLoading(discoveryLoadingElements, loadingPhase);
    const local = selectHomeLocal(contextualLocal, contextualCity, now);
    const suppressLocalPending = (loadingPhase === 'initial' || loadingPhase === 'slow') && !local.cards.length;
    const awaitingLocal = contextualLocationPending || contextualCity !== null && contextualLocalState === 'loading';
    required('#today-heading').textContent = "Today's top";
    required('#home-location').textContent = contextualCity
        ? `${contextualCity.name} · ${contextualCity.country}${contextualLocation === 'estimated' ? ' · approximate' : ''}`
        : contextualLocationPending ? 'Finding your city…' : 'Choose a city for local updates.';
    const discoveryDelay = nextDailyEditionDelay(today, now), returnDelay = checkpoint ? nextReturnDelay(snapshot, selectReturnBrief(checkpoint, null, now, false).topics, now) : null;
    const localDelay = local.expiresAt === null ? null : Math.max(25, local.expiresAt - now + 25);
    const delays = [discoveryDelay, returnDelay, localDelay].filter((n) => n !== null);
    if (delays.length && document.visibilityState === 'visible')
        discoveryExpiry = setTimeout(renderDiscovery, Math.min(...delays));
    host.replaceChildren();
    // Publication reading does not wait for city lookup. The existing selector owns eligibility.
    appendPublicEdition(host, today, (view, index, total) => {
        const node = cardNode(view, index, total, undefined, false);
        node.dataset.liveSignature = editionCardSignature(view.card);
        return node;
    }, editionState);
    if (loadingPhase !== 'hidden')
        host.querySelector('#home-edition-pending, #home-edition-unavailable')?.remove();
    // Local source records stay contiguous and distinct from the global daily top.
    if (!suppressLocalPending && (contextualCity || contextualLocationPending)) {
        const label = make('div', 'discovery-section-label');
        label.id = 'home-local-heading';
        label.append(make('h2', '', contextualCity ? `In ${contextualCity.name}` : 'Local information'));
        host.append(label);
    }
    for (const item of local.cards) {
        if (!contextualCity)
            break;
        const node = localCardNode(item, contextualCity, now);
        node.dataset.homeLocalId = item.id;
        node.dataset.cityId = contextualCity.id;
        host.append(node);
    }
    if (!suppressLocalPending && !local.cards.length && (contextualCity || contextualLocationPending)) {
        const state = make('div', 'discovery-section-label');
        state.id = 'home-local-state';
        state.setAttribute('role', 'status');
        const expired = contextualLocalState === 'loaded' && contextualLocal !== null;
        state.append(make('p', 'privacy-note', awaitingLocal ? 'Checking local updates…' : expired ? 'The local check has expired. Refresh to see current local information.' : contextualLocalState === 'unavailable' ? 'Local information could not be checked. Refresh to try again.' : 'No current local cards were verified. Check local sources or choose another city.'));
        host.append(state);
    }
    if (contextualCity) {
        const details = make('details', 'selection-details discovery-section-label');
        details.id = 'home-coverage';
        details.append(make('summary', '', 'Local sources & coverage'));
        if (contextualLocal) {
            for (const item of localCoverageReading(contextualLocal, now))
                details.append(make('p', 'privacy-note', item.text));
            details.append(make('p', 'privacy-note', `Local check: ${formatted(contextualLocal.checkedAt)}. Each card keeps its own event date, area and source.`));
        }
        else
            details.append(make('p', 'privacy-note', contextualLocalState === 'loading' ? 'Local sources are being checked.' : 'Local sources could not be verified. This does not mean there are no disruptions or events.'));
        details.append(make('p', 'privacy-note', 'City-level coverage only; your address and neighbourhood are not known. Only connected sources are included.'));
        host.append(details);
    }
    appendPublicContinuation(host, today, (view, index, total) => {
        const node = cardNode(view, index, total, undefined, false);
        node.dataset.liveSignature = editionCardSignature(view.card);
        return node;
    }, continuationCount);
    reconcileDiscovery(target, host);
    pruneInsights();
    const publicationState = editionState === 'unavailable' ? 'Publications could not be checked. Refresh to try again.' : today.first.length + today.more.length ? dailyEditionSummary(today) : editionState === 'pending' ? 'Checking connected publications…' : 'No current publications meet this selection.';
    const sourceState = loading && !automaticPublicLoad ? ' Checking for updates…' : lastLoadFailed && snapshot ? ' Refresh unavailable; retained source checks are not newly verified.' : snapshot?.state === 'partial' ? ' Some source coverage is incomplete.' : '';
    const localState = awaitingLocal ? ' Local information is still being checked below.' : local.cards.length ? ` ${local.cards.length} local cards are available separately below.` : contextualCity ? ' Local coverage is shown below.' : '';
    const updates = live.changes.total ? ` ${editionUpdateLabel(live.changes)}. Select Show updates when you are ready; your reading position stays stable.` : '';
    const noteText = (snapshot ? `${formatted(snapshot.generatedAt, true)} · Source check ${formatted(snapshot.generatedAt)}. ` : '') + publicationState + sourceState + localState + updates;
    if (loadingPhase === 'hidden') {
        const checkedTime = snapshot ? new Intl.DateTimeFormat(safeLocale(navigator.language || 'en-GB'), { hour: '2-digit', minute: '2-digit' }).format(new Date(snapshot.generatedAt)) : null;
        const compact = compactEditionStatus({ state: editionState, count: today.first.length, continuation: today.more.length, checkedTime, refreshing: loading && !automaticPublicLoad, refreshFailed: lastLoadFailed && snapshot !== null, partial: snapshot?.state === 'partial' || today.daily?.completeCoverage === false, updates: live.changes.total });
        if (note.textContent !== compact)
            note.textContent = compact;
    }
    const editionDetails = required('#discovery-details');
    editionDetails.hidden = loadingPhase !== 'hidden';
    const detailCopy = required('#discovery-details-copy');
    const locationDetail = contextualCity ? ` City: ${contextualCity.name}, ${contextualCity.country}. ${contextualLocation === 'estimated' ? 'Approximate city from your connection; no precise location is known.' : contextualLocation === 'saved' ? 'Using your saved city.' : 'Chosen for this visit.'}` : '';
    if (detailCopy.textContent !== noteText + locationDetail)
        detailCopy.textContent = noteText + locationDetail;
    const anchor = anchors.find(item => item.node.isConnected);
    if (anchor) {
        const offset = anchor.node.getBoundingClientRect().top - anchor.top;
        if (Math.abs(offset) > 1)
            window.scrollBy(0, offset);
    }
    memoryControls();
}
required('#discovery-cards').addEventListener('click', event => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-public-more]'))
        return;
    const before = new Set([...required('#discovery-cards').querySelectorAll('article[data-edition-part="more"]')].map(node => node.dataset.cardId));
    continuationCount += 20;
    renderDiscovery();
    const added = [...required('#discovery-cards').querySelectorAll('article[data-edition-part="more"]')].find(node => !before.has(node.dataset.cardId));
    const title = added?.querySelector('h3');
    if (title) {
        title.tabIndex = -1;
        title.focus({ preventScroll: true });
    }
    announcement.textContent = 'More current reports are available below.';
});
// Automatic location and saved choices inform this page without choosing a view or writing memory.
document.addEventListener('dlkt:city-selected', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city))
        return;
    const automatic = event.detail.restored === true || event.detail.estimated === true;
    if (automatic && contextualCityExplicit)
        return;
    if (!automatic)
        contextualCityExplicit = true;
    contextualCity = event.detail.city;
    contextualLocationPending = false;
    contextualLocation = event.detail.estimated === true ? 'estimated' : event.detail.restored === true ? 'saved' : 'selected';
    contextualLocal = null;
    contextualLocalState = 'loading';
    renderDiscovery();
});
document.addEventListener('dlkt:local-snapshot', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail) || event.detail.origin === 'daily' || !validCity(event.detail.city) || !contextualCity || event.detail.city.id !== contextualCity.id)
        return;
    contextualLocal = currentLocalSnapshot(event.detail.snapshot, contextualCity, Date.now()) ? event.detail.snapshot : null;
    contextualLocalState = contextualLocal ? 'loaded' : 'unavailable';
    renderDiscovery();
});
document.addEventListener('dlkt:location-settled', () => { contextualLocationPending = false; renderDiscovery(); });
required('#return-open').addEventListener('click', () => { if (deviceState.cards.length)
    openSavedCards();
else if (checkpointInvalid)
    openSettings();
else
    openReturnChanges(); });
required('#return-refresh').addEventListener('click', () => { void load(); });
required('#comparison-saved-only').addEventListener('change', () => { if (changesView)
    render(); });
required('#discovery-refresh').addEventListener('click', () => { applyPublicUpdate = true; renderDiscovery(); void load(); if (contextualCity && contextualLocalState !== 'loading') {
    contextualLocalState = 'loading';
    required('#refresh-local').click();
    renderDiscovery();
} });
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        renderDiscovery();
        if (savedView)
            savedCards();
        if (Date.now() - lastPublicCheckAttempt >= PUBLIC_REFRESH_MS)
            void load(true);
        else
            schedulePublicRefresh();
    }
    else {
        clearTimeout(discoveryExpiry);
        clearTimeout(publicRefreshTimer);
        clearTimeout(savedUpdateExpiry);
    }
});
window.addEventListener('pageshow', () => { renderDiscovery(); schedulePublicRefresh(); });
document.addEventListener('dlkt:entry-view', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail))
        return;
    if (event.detail.view === 'start' && !snapshot && !loading)
        void load();
    else
        renderDiscovery();
});
function openSettings() { if (!panel.open)
    panel.showModal(); query.focus(); }
bindDiscoveryLoadingActions(discoveryLoadingElements, { personalise: openSettings, retry: () => required('#discovery-refresh').click() }, { settings: panel, settingsFallback: required('#personalise-button'), menuFallback: required('#header-menu'), retryTarget: required('#entry-title') });
function closeSettings() { panel.close(); }
required('#close-focus').addEventListener('click', closeSettings);
required('#focus-summary-button').addEventListener('click', openSettings);
required('#empty-edit-focus').addEventListener('click', openSettings);
panel.addEventListener('click', event => { if (event.target !== panel)
    return; const rect = panel.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)
    closeSettings(); });
const options = required('#reader-more');
document.addEventListener('click', event => { if (event.target instanceof Node && !options.contains(event.target))
    options.open = false; });
document.addEventListener('keydown', event => { if (event.key === 'Escape' && options.open) {
    options.open = false;
    options.querySelector('summary')?.focus();
} });
options.querySelector('a')?.addEventListener('click', () => { options.open = false; const sourceDetails = document.querySelector('#sources>details'); if (sourceDetails)
    sourceDetails.open = true; });
required('#personalise-button').addEventListener('click', openSettings);
required('#edit-focus').addEventListener('click', openSettings);
form.addEventListener('input', () => { editedFocus = true; clearTimeout(renderTimer); renderTimer = setTimeout(render, 80); });
form.addEventListener('submit', event => { event.preventDefault(); changesView = false; savedView = false; mode = 'briefing'; editedFocus = true; clearTimeout(renderTimer); render(); if (settings()) {
    if (!snapshot)
        void load();
    const localEdition = !query.value.trim();
    if (localEdition)
        visitInterests = settings()?.topics ?? [];
    document.dispatchEvent(new CustomEvent('dlkt:reader-selected', { detail: localEdition ? { view: 'start' } : undefined }));
    renderDiscovery();
    panel.close();
    const destination = localEdition ? required('#entry-title') : heading;
    destination.focus();
    destination.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
} });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { options.open = false; if (button.dataset.view === 'saved') {
    openSavedCards();
    return;
} changesView = button.dataset.view === 'changes'; savedView = false; if (!changesView)
    mode = button.dataset.view === 'records' ? 'records' : 'briefing'; editedFocus = true; render(); if (!snapshot)
    void load(); document.dispatchEvent(new CustomEvent('dlkt:reader-selected')); }));
document.querySelectorAll('[data-focus]').forEach(button => button.addEventListener('click', () => { savedView = false; editedFocus = true; form.querySelectorAll('input[name=topic]').forEach(input => { input.checked = !input.hidden && (button.dataset.focus === 'all' || input.value === button.dataset.focus); }); render(); if (!snapshot)
    void load(); document.dispatchEvent(new CustomEvent('dlkt:reader-selected')); }));
explore.addEventListener('click', () => { changesView = false; savedView = false; mode = 'records'; render(); if (!snapshot)
    void load(); document.dispatchEvent(new CustomEvent('dlkt:reader-selected')); heading.focus(); heading.scrollIntoView({ block: 'start' }); });
more.addEventListener('click', () => { if (changesView && checkpoint && snapshot) {
    const selected = settings();
    if (selected?.topics.length)
        budget.value = String(compareFocusedCheckpoint(checkpoint, snapshot, selected.topics, Date.now()).cards.length || 6);
    render();
    return;
} if (savedView) {
    budget.value = String(deviceState.cards.length || 6);
    render();
    return;
} const s = settings(); if (snapshot && s) {
    budget.value = String(selectReadingCards(snapshot.cards, s, Date.now()).availableGroups || s.budget);
    render();
} });
refresh.addEventListener('click', () => { void load(); });
required('#remember-focus').addEventListener('click', () => {
    const s = settings();
    if (!s) {
        budget.reportValidity();
        return;
    }
    editedFocus = true;
    void writeDevice(() => device.remember(s), 'Focus remembered in this browser. Future changes are saved only when you press Remember again.');
});
required('#forget-focus').addEventListener('click', () => { void writeDevice(() => device.forgetFocus(), 'Remembered focus removed. Your saved cards are unchanged.'); });
const confirmation = required('#clear-confirmation');
required('#clear-device').addEventListener('click', () => { confirmation.hidden = false; required('#cancel-clear').focus(); });
required('#cancel-clear').addEventListener('click', () => { confirmation.hidden = true; required('#clear-device').focus(); });
required('#confirm-clear').addEventListener('click', () => { void writeDevice(() => device.clear(), 'Remembered focus, saved cards and comparison check removed from this browser.', () => { confirmation.hidden = true; visitInterests = null; document.dispatchEvent(new CustomEvent('dlkt:daily-cleared')); changesView = false; savedView = false; editedFocus = true; form.reset(); mode = 'briefing'; render(); }); });
let pendingCheck = null;
const checkConfirmation = required('#check-confirmation');
function doCheck(pending) {
    if (pending.action === 'save' && pending.snapshot) {
        const snap = pending.snapshot;
        void writeDevice(() => device.saveCheckpoint(snap, pending.expected), 'Source check saved for your chosen interests in this browser. Nothing is checked in the background.', () => { checkConfirmation.hidden = true; pendingCheck = null; render(); });
    }
    else if (pending.action === 'forget' && pending.expected) {
        const revision = pending.expected;
        void writeDevice(() => device.forgetCheckpoint(revision), 'Comparison check removed. Saved cards and focus are unchanged.', () => { checkConfirmation.hidden = true; pendingCheck = null; render(); });
    }
}
required('#save-check').addEventListener('click', () => {
    if (!snapshot || lastLoadFailed || loading || deviceBusy)
        return;
    const selected = settings();
    if (!selected || !selected.topics.length)
        return;
    let scoped;
    try {
        scoped = focusedSnapshot(snapshot, selected.topics);
    }
    catch {
        return;
    }
    const pending = { action: 'save', snapshot: scoped, expected: checkpoint?.revision ?? null };
    if (!checkpoint) {
        doCheck(pending);
        return;
    }
    pendingCheck = pending;
    required('#check-confirmation-copy').textContent = 'Replace the saved source check? Future comparisons will start from the currently loaded source snapshot for your chosen interests. Previously saved interests outside this selection will no longer be tracked by this baseline. Your saved cards stay unchanged.';
    checkConfirmation.hidden = false;
    required('#cancel-check').focus();
});
required('#forget-check').addEventListener('click', () => {
    if (!checkpoint || deviceBusy)
        return;
    pendingCheck = { action: 'forget', snapshot: null, expected: checkpoint.revision };
    required('#check-confirmation-copy').textContent = 'Remove this comparison baseline? Your saved cards and focus will remain.';
    checkConfirmation.hidden = false;
    required('#cancel-check').focus();
});
required('#cancel-check').addEventListener('click', () => { pendingCheck = null; checkConfirmation.hidden = true; required('#save-check').focus(); });
required('#confirm-check').addEventListener('click', () => { if (pendingCheck)
    doCheck(pendingCheck); });
if (changes)
    changes.onmessage = event => { if (event.data === 'changed' && !deviceBusy)
        void readDevice(); };
window.addEventListener('focus', () => { if (!deviceBusy)
    void readDevice(); });
function openOrganizationFocus() {
    const linked = organizationSetupFromHash(window.location.hash);
    if (!linked)
        return false;
    editedFocus = true;
    changesView = false;
    savedView = false;
    restoreSettings(organizationReadingSettings(linked));
    render();
    if (!snapshot && !loading)
        void load();
    document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));
    return true;
}
const organizationPreview = openOrganizationFocus();
window.addEventListener('hashchange', openOrganizationFocus);
// Public cards do not wait for browser storage, location or a saved-profile restoration.
if (!organizationPreview)
    void load();
void readDevice(true);
setupEdition(settings);
document.addEventListener('dlkt:topic-request', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail) || typeof event.detail.query !== 'string' || event.detail.query.length > 200)
        return;
    const topic = event.detail.topic;
    if (topic !== 'all' && !TOPICS.includes(topic))
        return;
    editedFocus = true;
    changesView = false;
    savedView = false;
    mode = 'briefing';
    query.value = event.detail.query;
    form.querySelectorAll('input[name=topic]').forEach(input => { input.checked = topic === 'all' ? !input.hidden : input.value === topic; });
    render();
    if (!snapshot)
        void load();
    document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));
});
