import { DEFAULT_PREFERENCES, CURRENCIES, FX_HOME, FX_SOURCE, GLANCE_VERSION, object, validFx, validGlance, validPreferences } from './glance-contracts.js';
import { currentLocalCards, forecastRange, keyThing, quoteCurrency, nextGlanceDelay } from './glance-presentation.js';
import { currentLocalSnapshot, validCity } from './local-contracts.js';
import { PUBLIC_TOPICS } from './topics.js';
import { safeLink } from './card-validation.js';
import { readPreferences, savePreferences, clearPreferences } from './glance-preferences.js';
import { NewsTicker } from './glance-ticker.js';
import { weatherMotionNode, updateWeatherMotion } from './glance-weather-motion.js';
import { getLocale } from './i18n-browser.js';
const get = (id) => { const n = document.getElementById(id); if (!n)
    throw Error('GLANCE_ELEMENT_MISSING'); return n; };
const node = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
export function setupGlance() {
    const root = get('today-glance'), custom = get('glance-customize'), detail = get('glance-detail'), body = get('glance-detail-body'), status = get('glance-status'), refresh = get('glance-refresh');
    const list = get('glance-list'), read = get('glance-read');
    const ticker = new NewsTicker(root, openSignal);
    const weatherMotion = weatherMotionNode(null, Date.now(), true);
    get('glance-weather').append(weatherMotion);
    let preferences = readPreferences(() => localStorage), snapshot = null, city = null, local = null, topics = [], busy = false, localBusy = false, localTicket = 0, attempted = false, timer, opened = null;
    let browserZone = 'UTC';
    try {
        browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    catch { /* UTC remains explicit. */ }
    const zone = () => city?.timezone ?? browserZone;
    const date = (value, withTime = false) => new Intl.DateTimeFormat('en-GB', { timeZone: zone(), day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}) }).format(new Date(value));
    function link(text, url) { const a = node('a', text, 'source-link'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; }
    function tile(id, title, note) { get(id + '-value').textContent = title; get(id + '-note').textContent = note; }
    const quote = () => preferences.currency === 'auto' ? quoteCurrency(city?.countryCode) : preferences.currency;
    function localDetail(card) { body.append(node('p', card.text), node('p', `Source checked ${date(card.checkedAt, true)}. Usable until ${date(card.validTo, true)}.`, 'privacy-note'), node('p', card.boundary, 'privacy-note')); if (card.sourceUpdatedAt)
        body.append(node('p', `Source issued ${date(card.sourceUpdatedAt, true)}.`, 'privacy-note')); if (card.context)
        body.append(node('p', card.context.when), node('p', card.context.place), node('p', card.context.why)); body.append(link(`Open ${card.publisher}`, card.sourceUrl)); if (card.kind === 'forecast')
        body.append(node('p', 'MET Norway · CC BY 4.0. Temperature range and six-hour precipitation are calculated by DLKT from the source forecast.', 'privacy-note'), link('Source licence', 'https://creativecommons.org/licenses/by/4.0/')); }
    function renderDetail() {
        if (!opened)
            return;
        const now = Date.now(), cards = currentLocalCards(local, city, now), key = keyThing(snapshot?.publications ?? [], local, city, topics, now, zone(), getLocale());
        body.replaceChildren();
        const title = get('glance-detail-title');
        if (opened === 'weather') {
            title.textContent = city ? `Weather in ${city.name}` : 'Your weather';
            const card = cards.find(c => c.kind === 'forecast');
            if (card) {
                body.append(weatherMotionNode(card, now));
                localDetail(card);
            }
            else
                body.append(node('p', city ? 'No current forecast is available. Refresh to check the connected source.' : 'Choose a city to see its city-centre forecast.'));
        }
        if (opened === 'forex') {
            title.textContent = 'Currency reference';
            const fx = snapshot?.forex, q = quote();
            if (fx && validFx(fx, now) && fx.rates[q] !== undefined) {
                const n = fx.rates[q], previous = fx.previousRates[q];
                body.append(node('p', `1 EUR = ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(n)} ${q}`), node('p', `Reference date ${date(fx.date)}. Source checked ${date(fx.checkedAt, true)}.`, 'privacy-note'));
                if (previous !== undefined && fx.previousDate)
                    body.append(node('p', `Change ${((n / previous - 1) * 100).toFixed(2)}% against the ${date(fx.previousDate)} reference, calculated by DLKT.`));
                body.append(node('p', 'ECB reference rates are informational, not live prices or executable exchange quotes. The source data are available free of charge from the ECB.', 'privacy-note'), link('Open ECB reference rates', FX_HOME), link('Original ECB XML', FX_SOURCE));
            }
            else
                body.append(node('p', 'The selected reference rate is unavailable or expired. Refresh to check the ECB source.'));
        }
        if (opened === 'key') {
            title.textContent = key?.title ?? 'Today’s key thing';
            if (key) {
                body.append(node('p', key.reason, 'privacy-note'));
                if (key.event)
                    localDetail(key.event);
                if (key.news) {
                    const n = key.news.news;
                    if (n) {
                        body.append(node('p', `${n.byline ? n.byline + ' · ' : ''}${n.publisher} · Published ${date(n.publishedAt, true)}`, 'privacy-note'));
                        if (n.summary)
                            body.append(node('p', n.summary));
                        body.append(node('p', `Source checked ${date(n.checkedAt, true)}.`, 'privacy-note'), node('p', n.attribution, 'privacy-note'), link('Read the full report', n.url));
                        if (n.licenseUrl)
                            body.append(link('CC BY 4.0', n.licenseUrl));
                    }
                }
                if (key.publication) {
                    const p = key.publication;
                    body.append(node('p', `${p.publisher} · ${p.dateLabel} ${date(p.date)}`, 'privacy-note'));
                    if (p.summary)
                        body.append(node('p', p.summary));
                    body.append(node('p', `Source checked ${date(p.observedAt, true)}. ${p.boundary}`, 'privacy-note'), node('p', 'Selected from the connected publishers. This is not a ranking of all world news or an independent verification of the publisher’s claims.', 'privacy-note'), node('p', p.attribution, 'privacy-note'));
                    const url = safeLink(p.sourceUrl);
                    if (url)
                        body.append(link('Open original publication', url));
                }
            }
            else
                body.append(node('p', 'No recent item from the connected sources is available. Refresh to check again.'));
        }
        if (opened === 'notice') {
            title.textContent = 'Local heads-up';
            const card = cards.find(c => c.kind === 'transport-notice');
            if (card)
                localDetail(card);
            else
                body.append(node('p', 'This source check has expired. Refresh local sources for the current publisher notices.'));
        }
    }
    function render() {
        const now = Date.now(), cards = currentLocalCards(local, city, now);
        get('glance-date').textContent = new Intl.DateTimeFormat('en-GB', { timeZone: zone(), weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
        get('glance-zone').textContent = city ? `${city.name} · ${zone()}` : browserZone;
        get('glance-city').textContent = city ? 'Change city' : 'Choose city';
        get('glance-weather').hidden = !preferences.weather;
        get('glance-forex').hidden = !preferences.forex;
        get('glance-key').hidden = !preferences.keyThing;
        const forecast = cards.find(c => c.kind === 'forecast'), range = forecast ? forecastRange(forecast) : null;
        updateWeatherMotion(weatherMotion, forecast ?? null, now);
        tile('glance-weather', city ? range ?? (localBusy ? 'Checking forecast…' : 'Unavailable') : 'Choose your city', forecast ? `Forecast · ${city?.name} · ${new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', minute: '2-digit' }).format(new Date(forecast.validFrom))}–${new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', minute: '2-digit' }).format(new Date(forecast.validTo))}` : city ? localBusy ? 'Checking the connected source' : 'Refresh to check the source' : 'Local forecast, when connected');
        const fx = snapshot?.forex, q = quote();
        const n = fx && validFx(fx, now) ? fx.rates[q] : undefined;
        tile('glance-forex', n !== undefined ? `1 EUR = ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(n)} ${q}` : busy ? 'Checking ECB…' : 'Unavailable', n !== undefined && fx ? `ECB reference · ${date(fx.date)}` : 'Reference rates · not live quotes');
        const key = keyThing(snapshot?.publications ?? [], local, city, topics, now, zone(), getLocale());
        tile('glance-key', key?.title ?? (busy ? 'Finding a key thing…' : 'No current item available'), key?.news ? `Local report · ${key.news.publisher} · ${date(key.news.news?.publishedAt ?? key.news.checkedAt)}` : key?.event ? `Upcoming today · ${city?.name}` : key?.publication ? `Selected publication · ${key.publication.publisher} · ${date(key.publication.date)}` : 'Only from connected sources');
        const notice = cards.find(c => c.kind === 'transport-notice'), headsup = get('glance-headsup');
        headsup.hidden = !notice;
        headsup.textContent = notice ? `Local heads-up · ${notice.title}` : '';
        const items = [];
        for (const [enabled, id, signal, label] of [[preferences.weather, 'glance-weather', 'weather', 'Weather'], [preferences.forex, 'glance-forex', 'forex', 'Currency'], [preferences.keyThing, 'glance-key', 'key', 'Today']])
            if (enabled)
                items.push({ signal, label, value: get(id + '-value').textContent ?? '', note: get(id + '-note').textContent ?? '' });
        if (notice)
            items.push({ signal: 'notice', label: 'Local heads-up', value: notice.title, note: notice.publisher });
        ticker.update(items);
        get('glance-empty').hidden = preferences.weather || preferences.forex || preferences.keyThing;
        refresh.disabled = busy || localBusy;
        if (detail.open)
            renderDetail();
        clearTimeout(timer);
        if (document.visibilityState === 'visible')
            timer = setTimeout(render, nextGlanceDelay(cards, snapshot?.publications ?? [], fx ?? null, now));
    }
    async function load() {
        if (busy)
            return;
        busy = true;
        attempted = true;
        refresh.disabled = true;
        status.textContent = 'Checking the connected sources…';
        render();
        try {
            const r = await fetch('/api/glance', { method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
            if (!r.ok)
                throw Error('GLANCE_REQUEST_FAILED');
            const text = await r.text();
            if (text.length > 150000)
                throw Error('GLANCE_TOO_LARGE');
            const data = JSON.parse(text);
            if (!validGlance(data, Date.now()))
                throw Error('GLANCE_INVALID');
            snapshot = data;
            status.textContent = !data.forex || !data.publications.length ? 'Some connected sources are unavailable. Open a signal for details.' : '';
        }
        catch {
            snapshot = null;
            status.textContent = 'Sources could not be checked. Refresh to try again.';
        }
        finally {
            busy = false;
            render();
        }
    }
    async function refreshCity() {
        if (!city || localBusy)
            return;
        const requested = city, ticket = ++localTicket;
        localBusy = true;
        render();
        try {
            const r = await fetch('/api/local?city=' + encodeURIComponent(requested.id), { credentials: 'omit', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
            if (!r.ok)
                throw Error('GLANCE_LOCAL_FAILED');
            const text = await r.text();
            if (text.length > 150000)
                throw Error('GLANCE_LOCAL_TOO_LARGE');
            const value = JSON.parse(text);
            if (ticket !== localTicket || city?.id !== requested.id)
                return;
            local = currentLocalSnapshot(value, requested, Date.now()) ? value : null;
        }
        catch {
            if (ticket === localTicket && city?.id === requested.id)
                local = null;
        }
        finally {
            if (ticket === localTicket) {
                localBusy = false;
                render();
            }
        }
    }
    function populate() { get('glance-show-weather').checked = preferences.weather; get('glance-show-forex').checked = preferences.forex; get('glance-show-key').checked = preferences.keyThing; get('glance-currency').value = preferences.currency; get('glance-save-status').textContent = ''; }
    function openSignal(kind) { if (list.open)
        list.close(); if (kind === 'weather' && !city) {
        get('entry-show-city').click();
        return;
    } opened = kind; renderDetail(); detail.showModal(); }
    const currencies = get('glance-currency');
    currencies.append(new Option('For my city, otherwise USD', 'auto'));
    for (const c of CURRENCIES)
        currencies.append(new Option(`EUR / ${c}`, c));
    get('glance-customize-open').addEventListener('click', () => { populate(); custom.showModal(); });
    get('glance-customize-close').addEventListener('click', () => custom.close());
    get('glance-detail-close').addEventListener('click', () => detail.close());
    detail.addEventListener('close', () => { opened = null; read.focus(); });
    read.addEventListener('click', () => list.showModal());
    get('glance-list-close').addEventListener('click', () => list.close());
    get('glance-preferences').addEventListener('submit', e => { e.preventDefault(); const next = { version: GLANCE_VERSION, weather: get('glance-show-weather').checked, forex: get('glance-show-forex').checked, keyThing: get('glance-show-key').checked, currency: currencies.value }; if (!validPreferences(next))
        return; preferences = next; get('glance-save-status').textContent = savePreferences(preferences, () => localStorage) ? 'Saved in this browser.' : 'Applied for this visit. Browser storage is unavailable.'; render(); if (!attempted && (preferences.forex || preferences.keyThing))
        void load(); });
    refresh.addEventListener('click', () => { void refreshCity(); void load(); });
    get('glance-city').addEventListener('click', () => get('choose-place').click());
    for (const [id, kind] of [['glance-weather', 'weather'], ['glance-forex', 'forex'], ['glance-key', 'key'], ['glance-headsup', 'notice']])
        get(id).addEventListener('click', () => openSignal(kind));
    document.addEventListener('dlkt:city-selected', event => { if (event instanceof CustomEvent && object(event.detail) && validCity(event.detail.city)) {
        if (event.detail.restored === true && document.body.dataset.entryView === 'daily' && city)
            return;
        ++localTicket;
        localBusy = true;
        city = event.detail.city;
        local = null;
        render();
    } });
    document.addEventListener('dlkt:local-snapshot', event => { if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city))
        return; const c = event.detail.city; if (city && city.id !== c.id && !(event.detail.origin === 'daily' && document.body.dataset.entryView === 'daily'))
        return; ++localTicket; localBusy = false; city = c; local = currentLocalSnapshot(event.detail.snapshot, c, Date.now()) ? event.detail.snapshot : null; render(); });
    document.addEventListener('dlkt:topic-context', event => { if (event instanceof CustomEvent && object(event.detail) && Array.isArray(event.detail.topics) && event.detail.topics.every(t => PUBLIC_TOPICS.includes(t))) {
        topics = event.detail.topics;
        render();
    } });
    document.addEventListener('dlkt:daily-cleared', () => { preferences = { ...DEFAULT_PREFERENCES }; clearPreferences(() => localStorage); render(); });
    document.addEventListener('dlkt:language-changed', render);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
        render();
    else
        clearTimeout(timer); });
    window.addEventListener('pageshow', render);
    root.hidden = false;
    render();
    if (preferences.forex || preferences.keyThing)
        void load();
}
if (typeof document !== 'undefined')
    setupGlance();
