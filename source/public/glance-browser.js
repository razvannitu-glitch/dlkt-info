import { DEFAULT_PREFERENCES, CURRENCIES, FX_HOME, FX_SOURCE, GLANCE_VERSION, object, validFx, validGlance, validPreferences, eligiblePublication } from './glance-contracts.js';
import { currentLocalCards, forecastRange, quoteCurrency, nextGlanceDelay, localDay } from './glance-presentation.js';
import { currentLocalSnapshot, validCity } from './local-contracts.js';
import { readPreferences, savePreferences, clearPreferences } from './glance-preferences.js';
import { weatherMotionNode, updateWeatherMotion } from './glance-weather-motion.js';
import { getLocale, countryLabel, translate } from './i18n-browser.js';
import { NewsTicker } from './glance-ticker.js';
import { selectHomeLanguage } from './home-local.js';
import { sourceLanguage, newsLanguageMatches } from './news-sources.js';
const get = (id) => { const n = document.getElementById(id); if (!n)
    throw Error('GLANCE_ELEMENT_MISSING'); return n; };
const node = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
export function setupGlance() {
    const root = get('today-glance'), custom = get('glance-customize'), detail = get('glance-detail'), body = get('glance-detail-body'), status = get('glance-status'), refresh = get('glance-refresh');
    const list = get('glance-list'), read = get('glance-read');
    let detailReturn = null;
    // Verified news and local information use a non-alert scrolling ribbon.
    const ticker = new NewsTicker(root, kind => { if (kind === 'key') {
        if (!list.open)
            list.showModal();
        return;
    } openSignal(kind); });
    const weatherMotion = weatherMotionNode(null, Date.now(), true);
    get('glance-weather').append(weatherMotion);
    let preferences = readPreferences(() => localStorage), snapshot = null, city = null, local = null, estimatedCity = false, busy = false, localBusy = false, localTicket = 0, attempted = false, timer, opened = null;
    let browserZone = 'UTC';
    try {
        browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
    catch { /* UTC remains explicit. */ }
    const zone = () => city?.timezone ?? browserZone;
    const date = (value, withTime = false) => new Intl.DateTimeFormat(getLocale(), { timeZone: zone(), day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' } : {}) }).format(new Date(value));
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
        const now = Date.now(), cards = currentLocalCards(local, city, now);
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
        const now = Date.now(), cards = currentLocalCards(local, city, now), locale = getLocale();
        const calendar = get('glance-date');
        calendar.textContent = new Intl.DateTimeFormat(locale, { timeZone: zone(), weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
        calendar.dataset.compactDate = new Intl.DateTimeFormat(locale, { timeZone: zone(), day: 'numeric', month: 'short' }).format(now);
        calendar.dateTime = localDay(now, zone());
        calendar.title = calendar.textContent + ' · ' + zone();
        get('glance-title').textContent = translate('navToday');
        get('glance-city-label').textContent = city?.name ?? translate('chooseCity');
        get('glance-city').setAttribute('aria-label', city ? translate('changeCity') + ': ' + city.name + ', ' + countryLabel(city.countryCode, city.country) : translate('chooseCity'));
        get('glance-zone').textContent = city ? countryLabel(city.countryCode, city.country) + (estimatedCity ? (locale === 'ro' ? ' · aproximativ' : locale === 'it' ? ' · approssimativo' : ' · approximate') : '') : '';
        get('glance-weather').hidden = !preferences.weather;
        get('glance-forex').hidden = !preferences.forex;
        const forecast = cards.find(c => c.kind === 'forecast'), range = forecast ? forecastRange(forecast) : null;
        updateWeatherMotion(weatherMotion, forecast ?? null, now);
        tile('glance-weather', city ? range ?? (localBusy ? 'Checking forecast…' : 'Unavailable') : 'Choose your city', forecast ? `Forecast · ${city?.name} · ${new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', minute: '2-digit' }).format(new Date(forecast.validFrom))}–${new Intl.DateTimeFormat('en-GB', { timeZone: zone(), hour: '2-digit', minute: '2-digit' }).format(new Date(forecast.validTo))}` : city ? localBusy ? 'Checking the connected source' : 'Refresh to check the source' : 'Local forecast, when connected');
        const fx = snapshot?.forex, q = quote();
        const n = fx && validFx(fx, now) ? fx.rates[q] : undefined;
        tile('glance-forex', n !== undefined ? `1 EUR = ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 4 }).format(n)} ${q}` : busy ? 'Checking ECB…' : 'Unavailable', n !== undefined && fx ? `ECB reference · ${date(fx.date)}` : 'Reference rates · not live quotes');
        const notice = cards.find(c => c.kind === 'transport-notice'), headsup = get('glance-headsup');
        headsup.hidden = !notice;
        headsup.textContent = notice ? `Local heads-up · ${notice.title}` : '';
        const weatherQuick = get('glance-weather-quick'), forexQuick = get('glance-forex-quick');
        const weatherHidden = !preferences.weather || !forecast || !range, forexHidden = !preferences.forex || n === undefined;
        // Preserve keyboard position before an expired or unavailable utility leaves the toolbar.
        if (document.activeElement === weatherQuick && weatherHidden || document.activeElement === forexQuick && forexHidden)
            get('glance-city').focus({ preventScroll: true });
        weatherQuick.hidden = weatherHidden;
        weatherQuick.textContent = (locale === 'ro' ? 'Vreme' : locale === 'it' ? 'Meteo' : 'Weather') + ' ' + (range ?? '');
        weatherQuick.title = get('glance-weather-note').textContent ?? '';
        weatherQuick.setAttribute('aria-label',weatherQuick.textContent + ' · ' + weatherQuick.title);
        forexQuick.hidden = forexHidden;
        forexQuick.textContent = n !== undefined ? '1 € = ' + new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n) + ' ' + q : '';
        forexQuick.title = get('glance-forex-note').textContent ?? '';
        forexQuick.setAttribute('aria-label',forexQuick.textContent + ' · ' + forexQuick.title);
        read.textContent = locale === 'ro' ? 'Surse si preferinte' : locale === 'it' ? 'Fonti e preferenze' : 'Sources and preferences';
        read.setAttribute('aria-label', locale === 'ro' ? 'Informatii, surse si setari' : locale === 'it' ? 'Informazioni, fonti e impostazioni' : 'Information, sources and settings');
        // Local reports first, then verified publisher metadata; no synthetic or stale headlines.
        const tickerItems = [];
        const seenSources = new Set();
        const newsLinks = get('glance-news-sources');
        newsLinks.replaceChildren();
        function addNews(title, publisher, url, note) {
            if (seenSources.has(url) || tickerItems.length >= 12)
                return;
            seenSources.add(url);
            tickerItems.push({ signal: 'key', label: publisher, value: title, note });
            const anchor = link(title, url);
            anchor.classList.add('glance-news-link');
            anchor.setAttribute('aria-label', publisher + ': ' + title);
            newsLinks.append(anchor);
        }
        for (const card of selectHomeLanguage(local, city, now, locale).cards)
            if (card.kind === 'local-news') {
                addNews(card.title, card.publisher, card.sourceUrl, 'Local · source checked ' + date(card.checkedAt));
            }
        for (const publication of snapshot?.publications ?? []) {
            if (!eligiblePublication(publication, now) || !newsLanguageMatches(sourceLanguage(publication), locale))
                continue;
            addNews(publication.title, publication.publisher, publication.sourceUrl, 'Published ' + date(publication.date));
        }
        newsLinks.hidden = newsLinks.childElementCount === 0;
        if (tickerItems.length === 0) {
            if (preferences.weather && forecast && range && city)
                tickerItems.push({ signal: 'weather', label: city.name + ' · Weather', value: range, note: 'MET Norway · forecast' });
            if (preferences.forex && n !== undefined && fx)
                tickerItems.push({ signal: 'forex', label: 'ECB reference', value: '1 EUR = ' + new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n) + ' ' + q, note: date(fx.date) });
        }
        const ribbon = get('glance-ribbon');
        ribbon.hidden = tickerItems.length === 0;
        ribbon.setAttribute('aria-hidden', String(tickerItems.length === 0));
        ticker.update(tickerItems);
        get('glance-empty').hidden = preferences.weather || preferences.forex;
        refresh.disabled = busy || localBusy;
        if (detail.open)
            renderDetail();
        clearTimeout(timer);
        if (document.visibilityState === 'visible')
            timer = setTimeout(render, nextGlanceDelay(cards, [], fx ?? null, now));
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
            status.textContent = !data.forex && preferences.forex ? 'The currency reference is unavailable. Open details or refresh to try again.' : '';
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
    function populate() { get('glance-show-weather').checked = preferences.weather; get('glance-show-forex').checked = preferences.forex; get('glance-currency').value = preferences.currency; get('glance-save-status').textContent = ''; }
    function openSignal(kind) { detailReturn = list.open ? get('glance-city') : document.activeElement instanceof HTMLElement ? document.activeElement : get('glance-city'); if (list.open)
        list.close(); if (kind === 'weather' && !city) {
        get('entry-show-city').click();
        return;
    } opened = kind; renderDetail(); detail.showModal(); }
    const currencies = get('glance-currency');
    currencies.append(new Option('For my city, otherwise USD', 'auto'));
    for (const c of CURRENCIES)
        currencies.append(new Option(`EUR / ${c}`, c));
    get('glance-customize-open').addEventListener('click', () => { if (list.open)
        list.close(); populate(); custom.showModal(); });
    custom.addEventListener('close', () => get('glance-city').focus());
    get('glance-customize-close').addEventListener('click', () => custom.close());
    get('glance-detail-close').addEventListener('click', () => detail.close());
    detail.addEventListener('close', () => { opened = null; (detailReturn?.isConnected && !detailReturn.hidden ? detailReturn : get('glance-city')).focus(); detailReturn = null; });
    read.addEventListener('click', () => list.showModal());
    get('glance-list-close').addEventListener('click', () => list.close());
    get('glance-preferences').addEventListener('submit', e => { e.preventDefault(); const next = { version: GLANCE_VERSION, weather: get('glance-show-weather').checked, forex: get('glance-show-forex').checked, keyThing: false, currency: currencies.value }; if (!validPreferences(next))
        return; preferences = next; get('glance-save-status').textContent = savePreferences(preferences, () => localStorage) ? 'Saved in this browser.' : 'Applied for this visit. Browser storage is unavailable.'; render(); if (!attempted && preferences.forex)
        void load(); });
    refresh.addEventListener('click', () => { void refreshCity(); void load(); });
    get('glance-city').addEventListener('click', () => get('choose-place').click());
    for (const [id, kind] of [['glance-weather', 'weather'], ['glance-forex', 'forex'], ['glance-weather-quick', 'weather'], ['glance-forex-quick', 'forex'], ['glance-headsup', 'notice']])
        get(id).addEventListener('click', () => openSignal(kind));
    document.addEventListener('dlkt:city-selected', event => { if (event instanceof CustomEvent && object(event.detail) && validCity(event.detail.city)) {
        if (event.detail.restored === true && document.body.dataset.entryView === 'daily' && city)
            return;
        ++localTicket;
        localBusy = true;
        city = event.detail.city;
        estimatedCity = event.detail.estimated === true;
        local = null;
        render();
    } });
    document.addEventListener('dlkt:local-snapshot', event => { if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city))
        return; const c = event.detail.city; if (city && city.id !== c.id && !(event.detail.origin === 'daily' && document.body.dataset.entryView === 'daily'))
        return; ++localTicket; localBusy = false; city = c; local = currentLocalSnapshot(event.detail.snapshot, c, Date.now()) ? event.detail.snapshot : null; render(); });
    document.addEventListener('dlkt:daily-cleared', () => { preferences = { ...DEFAULT_PREFERENCES }; clearPreferences(() => localStorage); render(); });
    document.addEventListener('dlkt:language-changed', render);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible')
        render();
    else
        clearTimeout(timer); });
    window.addEventListener('pageshow', render);
    root.hidden = false;
    render();
    if (preferences.forex)
        void load();
}
if (typeof document !== 'undefined')
    setupGlance();
