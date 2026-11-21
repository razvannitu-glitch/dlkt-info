import { setupHeader } from './entry-header.js';
import { organizationSetupFromHash } from './organization-setup.js';
import { sharedTopic } from './shared-card-link.js';
import { validCity, object } from './local-contracts.js';
import { initialEntryState, reduceEntry, topicSearchView } from './entry-state.js';
function required(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error('ENTRY_ELEMENT_MISSING');
    return element;
}
const form = required('entry-search');
const query = required('entry-query');
const results = required('entry-suggestions');
const message = required('entry-message');
const description = required('entry-help');
const topicWorkspace = required('topic-workspace');
const localWorkspace = required('local-briefing');
const sourceSection = required('sources');
const options = required('entry-options');
setupHeader();
let state = initialEntryState;
let searchMode = 'city';
let ticket = 0;
let pending = null;
let timer;
let composition = false;
let selectedCity = null;
function cancelSearch() {
    ++ticket;
    pending?.abort();
    pending = null;
    clearTimeout(timer);
    results.replaceChildren();
    results.hidden = true;
    query.setAttribute('aria-expanded', 'false');
}
function present() {
    document.body.dataset.entryView = state.view;
    if (state.view !== 'topics')
        required('briefing').setAttribute('aria-busy', 'false');
    topicWorkspace.hidden = state.view !== 'topics';
    required('discovery').hidden = state.view !== 'start';
    localWorkspace.hidden = state.view !== 'local';
    sourceSection.hidden = state.view !== 'topics' && state.view !== 'start';
    required('daily-workspace').hidden = state.view !== 'daily';
    required('entry-return').hidden = state.view === 'start';
    required('entry-today').hidden = state.view !== 'start';
    required('entry-introduction').hidden = state.view !== 'start';
    options.open = state.view === 'topics';
    document.dispatchEvent(new CustomEvent('dlkt:entry-view', { detail: { view: state.view } }));
}
function chooseView(view) {
    state = reduceEntry(state, { type: 'choose', view });
    cancelSearch();
    present();
}
function openToday() {
    chooseView('start');
    required('entry-title').focus();
    required('discovery').scrollIntoView({ block: 'start' });
}
function chooseMode(mode, focus = false) {
    cancelSearch();
    searchMode = mode;
    query.value = '';
    message.textContent = '';
    document.querySelectorAll('[data-entry-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entryMode === mode)));
    query.placeholder = mode === 'city' ? 'Type your city' : 'A product, name or topic';
    query.setAttribute('aria-label', mode === 'city' ? 'Find your city' : 'Search connected topics');
    description.textContent = mode === 'city'
        ? 'Your local day from connected sources. Coverage is shown for each city.'
        : 'Explore connected world, culture, digital life, science, health, public affairs and economy sources. Not the whole web.';
    required('entry-submit').setAttribute('aria-label', mode === 'city' ? 'Find city' : 'Show matching cards');
    if (focus)
        query.focus();
}
function requestTopics(text, topic = 'all') {
    chooseView('topics');
    if (searchMode !== 'topic')
        chooseMode('topic');
    query.value = text;
    document.dispatchEvent(new CustomEvent('dlkt:topic-request', { detail: { query: text, topic } }));
}
function selectCity(city) {
    selectedCity = city;
    openToday();
    if (searchMode !== 'city')
        chooseMode('city');
    query.value = city.name;
    document.dispatchEvent(new CustomEvent('dlkt:city-request', { detail: city }));
}
function openCityBriefing() {
    if (selectedCity) {
        selectCity(selectedCity);
        return;
    }
    required('choose-place').click();
}
async function lookupCities() {
    const text = query.value.trim();
    cancelSearch();
    if (!text || searchMode !== 'city') {
        message.textContent = '';
        return;
    }
    const current = ticket;
    pending = new AbortController();
    message.textContent = 'Finding cities…';
    try {
        const response = await fetch('/api/places?q=' + encodeURIComponent(text), {
            credentials: 'omit', headers: { Accept: 'application/json' },
            signal: AbortSignal.any([pending.signal, AbortSignal.timeout(12000)])
        });
        if (!response.ok)
            throw new Error('CITY_LOOKUP_UNAVAILABLE');
        const raw = await response.text();
        if (raw.length > 150000)
            throw new Error('CITY_RESPONSE_TOO_LARGE');
        const value = JSON.parse(raw);
        if (current !== ticket || searchMode !== 'city')
            return;
        if (!object(value) || !Array.isArray(value.cities) || value.cities.length > 8 || !value.cities.every(validCity))
            throw new Error('CITY_RESPONSE_INVALID');
        for (const city of value.cities) {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'entry-city';
            button.dataset.entryCity = city.id;
            const name = document.createElement('strong');
            name.textContent = city.name;
            const context = document.createElement('span');
            context.textContent = `${city.region} · ${city.country}`;
            button.append(name, context);
            button.addEventListener('click', () => selectCity(city));
            item.append(button);
            results.append(item);
        }
        results.hidden = value.cities.length === 0;
        query.setAttribute('aria-expanded', String(!results.hidden));
        message.textContent = value.cities.length ? 'Choose your city and country.' : 'No city found in the current catalog. Try another spelling or a nearby city.';
    }
    catch (error) {
        if (current !== ticket || error instanceof DOMException && error.name === 'AbortError')
            return;
        message.textContent = 'City search is unavailable. Try again; your saved choice has not changed.';
    }
}
query.addEventListener('input', () => {
    state = reduceEntry(state, { type: 'interact' });
    cancelSearch();
    if (!composition && searchMode === 'city')
        timer = setTimeout(() => { void lookupCities(); }, 100);
});
query.addEventListener('compositionstart', () => { composition = true; cancelSearch(); });
query.addEventListener('compositionend', () => { composition = false; if (searchMode === 'city')
    void lookupCities(); });
query.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        cancelSearch();
        message.textContent = '';
    }
    if (event.key === 'ArrowDown' && !results.hidden) {
        event.preventDefault();
        results.querySelector('button')?.focus();
    }
});
results.addEventListener('keydown', event => {
    const buttons = Array.from(results.querySelectorAll('button'));
    const index = buttons.findIndex(button => button === document.activeElement);
    if (event.key === 'Escape') {
        cancelSearch();
        query.focus();
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        if (next < 0)
            query.focus();
        else
            buttons[Math.min(next, buttons.length - 1)]?.focus();
    }
});
form.addEventListener('submit', event => {
    event.preventDefault();
    if (composition)
        return;
    state = reduceEntry(state, { type: 'interact' });
    if (searchMode === 'city') {
        if (query.value.trim())
            void lookupCities();
        else {
            query.focus();
            message.textContent = 'Type a city, then choose the correct country.';
        }
    }
    else if (topicSearchView(query.value) === 'start')
        openToday();
    else
        requestTopics(query.value.trim());
});
document.querySelectorAll('[data-entry-mode]').forEach(button => button.addEventListener('click', () => {
    state = reduceEntry(state, { type: 'interact' });
    chooseMode(button.dataset.entryMode === 'topic' ? 'topic' : 'city', true);
}));
document.querySelectorAll('[data-entry-topic]').forEach(button => button.addEventListener('click', () => requestTopics('', button.dataset.entryTopic ?? 'all')));
required('entry-weather').addEventListener('click', openCityBriefing);
required('entry-nearby').addEventListener('click', () => { state = reduceEntry(state, { type: 'interact' }); required('choose-place').click(); });
required('entry-saved').addEventListener('click', () => { chooseView('topics'); document.querySelector('[data-view=saved]')?.click(); });
required('entry-today').addEventListener('click', openToday);
required('entry-return').addEventListener('click', openToday);
required('entry-show-city').addEventListener('click', openCityBriefing);
required('home-city').addEventListener('click', () => { state = reduceEntry(state, { type: 'interact' }); required('choose-place').click(); });
document.addEventListener('dlkt:reader-selected', event => {
    if (!(event instanceof CustomEvent))
        return;
    const restored = object(event.detail) && event.detail.restored === true;
    if (!restored && object(event.detail) && event.detail.view === 'start') {
        openToday();
        return;
    }
    state = reduceEntry(state, restored ? { type: 'restore', view: 'topics' } : { type: 'choose', view: 'topics' });
    if (state.view === 'topics') {
        cancelSearch();
        present();
        if (searchMode !== 'topic')
            chooseMode('topic');
        query.value = required('query').value;
    }
});
document.addEventListener('dlkt:city-selected', event => {
    if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city))
        return;
    selectedCity = event.detail.city;
    const dailyPick = document.body.dataset.dailyPicking === 'true';
    state = reduceEntry(state, dailyPick ? { type: 'choose', view: 'daily' } : event.detail.estimated === true ? { type: 'suggest', view: 'local' } : event.detail.restored === true ? { type: 'restore', view: 'local' } : { type: 'choose', view: 'start' });
    if (dailyPick) {
        present();
        queueMicrotask(() => { delete document.body.dataset.dailyPicking; });
    }
    else if (event.detail.estimated !== true && event.detail.restored !== true) {
        cancelSearch();
        present();
        if (searchMode !== 'city')
            chooseMode('city');
        query.value = selectedCity.name;
        required('entry-title').focus();
        required('discovery').scrollIntoView({ block: 'start' });
    }
    required('entry-show-city').textContent = selectedCity.name;
    if (state.view === 'local') {
        cancelSearch();
        present();
        if (searchMode !== 'city')
            chooseMode('city');
        query.value = selectedCity.name;
    }
});
// Keep a failed optional module from leaving a dead search field with no explanation.
window.addEventListener('error', event => { if (event.target instanceof HTMLScriptElement)
    message.textContent = 'Part of the page could not load. Reload to try again.'; }, true);
chooseMode('city');
present();
document.addEventListener('dlkt:daily-selected', event => { if (!(event instanceof CustomEvent))
    return; const restored = object(event.detail) && event.detail.restored === true; state = reduceEntry(state, restored ? { type: 'restore', view: 'daily' } : { type: 'choose', view: 'daily' }); if (state.view === 'daily') {
    cancelSearch();
    present();
} });
required('place-dialog').addEventListener('close', () => { queueMicrotask(() => { delete document.body.dataset.dailyPicking; }); });
function openSharedTopic() {
    if (organizationSetupFromHash(window.location.hash)) {
        chooseView('topics');
        return;
    }
    const topic = sharedTopic(window.location.hash);
    if (!topic)
        return;
    chooseView('daily');
    document.dispatchEvent(new CustomEvent('dlkt:shared-topic', { detail: { topic } }));
}
if (document.readyState !== 'complete')
    document.addEventListener('DOMContentLoaded', openSharedTopic, { once: true });
else
    queueMicrotask(openSharedTopic);
window.addEventListener('hashchange', openSharedTopic);
