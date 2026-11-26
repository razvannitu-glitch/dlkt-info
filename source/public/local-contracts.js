import { validCityPlaces } from './local-places.js';
import { newsFeed, newsFeedsFor, newsEndpoint, newsSourceForUrl, newsTopicLabel, validLocalNewsArticle } from './local-news-policy.js';
export const PALMA_ID = '2512989';
export const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const finite = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
export const stamp = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(v) && Number.isFinite(Date.parse(v));
const text = (v, max = 4000) => typeof v === 'string' && v.length > 0 && v.length <= max;
/** Exact Locationforecast2 symbol vocabulary; day/night is supplied by MET, never inferred locally.
 * https://api.met.no/weatherapi/locationforecast/2.0/documentation (reviewed2026-11-21).
 * lightssleet/lightssnow are the publisher's documented legacy spellings.
 */
const PERIOD_WEATHER = ['clearsky', 'fair', 'partlycloudy', 'lightrainshowers', 'rainshowers', 'heavyrainshowers', 'lightsleetshowers', 'sleetshowers', 'heavysleetshowers', 'lightsnowshowers', 'snowshowers', 'heavysnowshowers', 'lightrainshowersandthunder', 'rainshowersandthunder', 'heavyrainshowersandthunder', 'lightssleetshowersandthunder', 'sleetshowersandthunder', 'heavysleetshowersandthunder', 'lightssnowshowersandthunder', 'snowshowersandthunder', 'heavysnowshowersandthunder'];
const WEATHER_SYMBOLS = new Set(['cloudy', 'fog', 'lightrain', 'rain', 'heavyrain', 'lightsleet', 'sleet', 'heavysleet', 'lightsnow', 'snow', 'heavysnow', 'lightrainandthunder', 'rainandthunder', 'heavyrainandthunder', 'lightsleetandthunder', 'sleetandthunder', 'heavysleetandthunder', 'lightsnowandthunder', 'snowandthunder', 'heavysnowandthunder', ...PERIOD_WEATHER.flatMap(code => ['day', 'night', 'polartwilight'].map(period => `${code}_${period}`))]);
export const validWeatherSymbol = (value) => typeof value === 'string' && WEATHER_SYMBOLS.has(value);
export function validWeatherSymbols(value, from, to) {
    const start = Date.parse(from), end = Date.parse(to);
    let previous = -Infinity;
    return Number.isFinite(start) && Number.isFinite(end) && Array.isArray(value) && value.length > 0 && value.length <= 7 && value.every(row => {
        if (!object(row) || Object.keys(row).length !== 2 || !stamp(row.at) || !validWeatherSymbol(row.symbol))
            return false;
        const at = Date.parse(row.at), valid = at % 3600000 === 0 && at > previous && at >= start - 3600000 && at < end;
        previous = at;
        return valid;
    });
}
export function validCity(v) { return object(v) && text(v.id, 12) && /^\d+$/u.test(v.id) && text(v.name, 200) && text(v.country, 120) && text(v.countryCode, 2) && /^[A-Z]{2}$/u.test(v.countryCode) && typeof v.region === 'string' && v.region.length <= 200 && finite(v.lat, -90, 90) && finite(v.lon, -180, 180) && text(v.timezone, 80) && validTimezone(v.timezone); }
const validZones = new Set();
function validTimezone(zone) { if (validZones.has(zone))
    return true; try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    if (validZones.size < 1000)
        validZones.add(zone);
    return true;
}
catch {
    return false;
} }
export function localSource(v, kind) { if (typeof v !== 'string')
    return false; try {
    const u = new URL(v);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash)
        return false;
    switch (kind) {
        case 'local-news': return newsSourceForUrl(v) !== undefined;
        case 'forecast': return u.hostname === 'api.met.no' && u.pathname === '/weatherapi/locationforecast/2.0/compact';
        case 'transport': return u.hostname === 'tfl.gov.uk' && u.pathname === '/tube-dlr-overground/status/' && !u.search;
        case 'transport-notice': return u.hostname === 'www.tib.org' && /^\/es\/w\/[a-z0-9-]+$/u.test(u.pathname) && !u.search;
        case 'utility-notice': return u.href === 'https://www.cmteb.ro/functionare_sistem_termoficare.php';
        case 'event': return (u.hostname === 'www.palmacultura.com' && /^\/(?:ca|es)\/noticia\/\d+\/[a-z0-9-]+$/u.test(u.pathname) || u.hostname === 'arcub.ro' && /^\/eveniment\/[a-z0-9-]+$/u.test(u.pathname)) && !u.search;
        case 'municipal-news': return u.hostname === 'noticies.palma.es' && u.pathname.startsWith('/-/') && u.pathname.length < 1500 && !u.search;
    }
}
catch {
    return false;
} }
function validContext(v) { return object(v) && ['essential', 'discover', 'context'].includes(String(v.section)) && ['scheduled', 'operator-notice', 'publisher-announcement'].includes(String(v.status)) && text(v.place, 300) && text(v.when, 500) && text(v.why, 1000) && text(v.action, 1000) && /^\d{4}-\d{2}-\d{2}$/u.test(String(v.sourceDate)) && Number.isFinite(Date.parse(String(v.sourceDate))) && new Date(String(v.sourceDate)).toISOString().slice(0, 10) === v.sourceDate && (v.startsAt === null || stamp(v.startsAt)) && (v.datePrecision === undefined || ['day', 'minute'].includes(String(v.datePrecision)) && stamp(v.startsAt)) && (v.endsAt === undefined || v.datePrecision === 'day' && stamp(v.endsAt) && stamp(v.startsAt) && Date.parse(v.endsAt) > Date.parse(v.startsAt)) && (v.datePrecision !== 'day' || stamp(v.endsAt)) && typeof v.documentUrl === 'string' && (newsEndpoint(v.documentUrl) || coverageSource(v.documentUrl) || localSource(v.documentUrl, 'transport-notice') || localSource(v.documentUrl, 'municipal-news') || localSource(v.documentUrl, 'event')) && typeof v.documentHash === 'string' && /^[a-f0-9]{64}$/u.test(v.documentHash); }
function validCoverage(v) { const domains = ['weather', 'transport', 'administration', 'events', 'utilities', 'emergency-alerts', 'exchange', 'accommodation', 'opportunities']; return Array.isArray(v) && v.length <= 9 && new Set(v.map(c => object(c) ? c.domain : null)).size === v.length && v.every(c => object(c) && domains.includes(c.domain) && ['ready', 'partial', 'unavailable', 'not-covered'].includes(String(c.state)) && (c.checkedAt === null || stamp(c.checkedAt)) && (c.sourceUrl === null || coverageSource(c.sourceUrl)) && text(c.note, 1000)); }
export function coverageSource(v) { return typeof v === 'string' && ['https://www.tib.org/es/avisos', 'https://www.palmacultura.com/index.php?Idi=2', 'https://arcub.ro/agenda', 'https://www.cmteb.ro/functionare_sistem_termoficare.php', 'https://noticies.palma.es/inici', 'https://api.met.no/weatherapi/locationforecast/2.0/compact', 'https://tfl.gov.uk/tube-dlr-overground/status/'].includes(v); }
export function validLocalSnapshot(v, cityId) { return object(v) && v.version === 'dlkt-local-1' && validCity(v.city) && v.city.id === cityId && stamp(v.checkedAt) && ['ready', 'partial', 'unavailable'].includes(String(v.state)) && ['ready', 'unavailable'].includes(String(v.weatherState)) && ['ready', 'unavailable', 'not-covered'].includes(String(v.transportState)) && (v.places === undefined || validCityPlaces(v.places, v.city, Date.parse(v.checkedAt))) && (v.coverage === undefined || validCoverage(v.coverage)) && Array.isArray(v.cards) && v.cards.length <= 60 && new Set(v.cards.map(c => object(c) ? c.id : null)).size === v.cards.length && v.cards.every(c => object(c) && text(c.id, 100) && ['forecast', 'transport', 'transport-notice', 'utility-notice', 'event', 'municipal-news', 'local-news'].includes(String(c.kind)) && text(c.title, 300) && text(c.text, 8000) && text(c.publisher, 100) && localSource(c.sourceUrl, c.kind) && (c.photoRevision === undefined || v.city.id === '683506' && c.kind === 'event' && c.publisher === 'ARCUB' && String(c.sourceUrl).startsWith('https://arcub.ro/eveniment/') && /^bucharest:arcub:[a-f0-9]{24}$/u.test(String(c.id)) && typeof c.photoRevision === 'string' && /^[a-f0-9]{64}$/u.test(c.photoRevision)) && (c.sourceUpdatedAt === null || stamp(c.sourceUpdatedAt)) && (c.weatherSymbols === undefined || c.kind === 'forecast' && validWeatherSymbols(c.weatherSymbols, String(c.validFrom), String(c.validTo))) && stamp(c.checkedAt) && stamp(c.validFrom) && stamp(c.validTo) && Date.parse(c.validFrom) < Date.parse(c.validTo) && Array.isArray(c.facts) && c.facts.length <= 20 && c.facts.every(f => text(f, 8000)) && text(c.boundary, 1000) && (c.kind === 'local-news' ? validNewsCard(c, v.city, Date.parse(v.checkedAt)) : c.news === undefined && (['forecast', 'transport'].includes(String(c.kind)) ? c.context === undefined : validContext(c.context) && c.context.section === (c.kind === 'event' ? 'discover' : c.kind === 'municipal-news' ? 'context' : 'essential') && c.context.status === (c.kind === 'event' ? 'scheduled' : c.kind === 'municipal-news' ? 'publisher-announcement' : 'operator-notice') && c.context.documentUrl === (c.kind === 'event' ? (String(c.sourceUrl).startsWith('https://arcub.ro/eveniment/') ? (c.context.datePrecision ? c.sourceUrl : 'https://arcub.ro/agenda') : 'https://www.palmacultura.com/index.php?Idi=2') : c.sourceUrl)))) && validNewsHealth(v.newsSources, v.city, v.cards, Date.parse(v.checkedAt)); }
/** News is linked to a reviewed publisher, a concrete article place reference and its own source check. */
function validNewsCard(value, city, now) {
    if (!object(value) || !validLocalNewsArticle(value.news, city, now) || !validContext(value.context))
        return false;
    const news = value.news, context = value.context;
    return value.id === news.id && value.kind === 'local-news' && value.title === news.title && value.text === (news.summary ?? 'Read the publisher report for the complete details.')
        && value.publisher === news.publisher && value.sourceUrl === news.url && value.sourceUpdatedAt === null
        && value.checkedAt === news.checkedAt && value.validFrom === news.checkedAt && value.validTo === news.validUntil
        && Array.isArray(value.facts) && value.facts.length === 0 && context.section === 'context' && context.status === 'publisher-announcement'
        && context.documentUrl === news.documentUrl && context.documentHash === news.documentHash && context.sourceDate === news.publishedAt.slice(0, 10)
        && context.startsAt === null && context.endsAt === undefined && context.datePrecision === undefined;
}
function validNewsHealth(value, city, cards, now) {
    const articles = cards.filter(card => card.kind === 'local-news');
    if (value === undefined)
        return articles.length === 0;
    const definitions = newsFeedsFor(city);
    if (!Array.isArray(value) || value.length !== definitions.length || new Set(value.map(item => object(item) ? item.sourceId : null)).size !== value.length)
        return false;
    return value.every(item => {
        if (!object(item) || typeof item.sourceId !== 'string')
            return false;
        const source = newsFeed(item.sourceId);
        if (!source || !definitions.includes(source) || item.publisher !== source.publisher || item.feedUrl !== source.endpoint || item.termsUrl !== source.termsUrl
            || !['ready', 'partial', 'unavailable'].includes(String(item.state)) || !Number.isSafeInteger(item.count) || Number(item.count) < 0 || Number(item.count) > 20
            || !Number.isSafeInteger(item.rejected) || Number(item.rejected) < 0 || Number(item.rejected) > 200)
            return false;
        const selected = articles.filter(card => card.news?.sourceId === source.id);
        if (selected.length !== item.count)
            return false;
        if (item.state === 'unavailable')
            return item.checkedAt === null && selected.length === 0 && typeof item.error === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/u.test(item.error);
        return item.error === null && stamp(item.checkedAt) && Date.parse(item.checkedAt) <= now + 5000 && Date.parse(item.checkedAt) > now - 300000
            && selected.every(card => card.checkedAt === item.checkedAt) && ((item.state === 'partial') === (Number(item.rejected) > 0));
    });
}
export const localCardLabel = (c) => c.kind === 'local-news' && c.news ? newsTopicLabel(c.news.topic) : c.kind === 'event' && c.publisher === 'ARCUB' ? (c.context?.datePrecision ? 'Events in Bucharest' : 'From the ARCUB agenda') : ({ forecast: 'Weather', transport: 'London Tube', 'transport-notice': 'Transport', 'utility-notice': 'Heating & hot water', event: 'Discover today', 'municipal-news': 'City announcements', 'local-news': 'Local reporting' })[c.kind];
export function localCoverageNotes(s) { return s.coverage ? s.coverage.map(c => c.note) : [s.transportState === 'not-covered' ? 'Local transport and events are not connected for this city.' : s.transportState === 'unavailable' ? 'Tube status is unavailable, not an all-clear.' : 'London Tube only; not all local transport. Recheck before travelling.']; }
const BUCHAREST_ID = '683506';
const ARCUB_AGENDA_SOURCE = 'https://arcub.ro/agenda';
/** ARCUB supplies a dated listing, not a verified start time or city-wide schedule. */
function isArcubAgendaCard(card) {
    const context = card.context;
    if (card.kind !== 'event' || !/^bucharest:arcub:[a-f0-9]{24}$/u.test(card.id) || card.publisher !== 'ARCUB'
        || !card.sourceUrl.startsWith('https://arcub.ro/eveniment/') || card.sourceUpdatedAt !== null
        || context?.section !== 'discover' || context.status !== 'scheduled')
        return false;
    if (context.datePrecision === undefined)
        return context.documentUrl === ARCUB_AGENDA_SOURCE && context.startsAt === null
            && context.sourceDate === new Date(card.checkedAt).toISOString().slice(0, 10);
    return context.documentUrl === card.sourceUrl && context.startsAt !== null
        && (context.datePrecision === 'minute' ? context.endsAt === undefined : context.endsAt !== undefined);
}
const CMTEB_SOURCE = 'https://www.cmteb.ro/functionare_sistem_termoficare.php';
function isCmtebCard(card) {
    return card.kind === 'utility-notice' && /^bucharest:cmteb:sector-[1-6]$/u.test(card.id)
        && card.publisher === 'Termoenergetica Bucuresti (CMTEB)' && card.sourceUrl === CMTEB_SOURCE
        && card.sourceUpdatedAt === null && card.context?.documentUrl === CMTEB_SOURCE
        && card.context.section === 'essential' && card.context.status === 'operator-notice'
        && card.context.startsAt === null && card.context.endsAt === undefined && card.context.datePrecision === undefined
        && card.context.sourceDate === new Date(card.checkedAt).toISOString().slice(0, 10);
}
function currentBucharestCoverage(snapshot, now) {
    const events = snapshot.cards.filter(card => card.kind === 'event'), utilities = snapshot.cards.filter(card => card.kind === 'utility-notice');
    if (snapshot.coverage === undefined)
        return events.length === 0 && utilities.length === 0;
    if (snapshot.coverage.length > 2)
        return false;
    for (const item of snapshot.coverage) {
        const isEvents = item.domain === 'events' && item.sourceUrl === ARCUB_AGENDA_SOURCE;
        const isUtilities = item.domain === 'utilities' && item.sourceUrl === CMTEB_SOURCE;
        if (!isEvents && !isUtilities)
            return false;
        const cards = isEvents ? events : utilities;
        if (item.state === 'unavailable') {
            if (item.checkedAt !== null || cards.length || snapshot.state === 'ready')
                return false;
        }
        else if (item.state !== 'partial' || item.checkedAt === null || Date.parse(item.checkedAt) > now + 5000
            || Date.parse(item.checkedAt) < now - 300000 || cards.length > (isEvents ? 8 : 6) || snapshot.state !== 'partial'
            || cards.some(card => (isEvents ? !isArcubAgendaCard(card) : !isCmtebCard(card))
                || (isEvents && card.context?.datePrecision ? Date.parse(card.checkedAt) < now - 300000 : card.checkedAt !== item.checkedAt) || Date.parse(card.checkedAt) > now + 5000))
            return false;
    }
    return (!events.length || snapshot.coverage.some(item => item.domain === 'events'))
        && (!utilities.length || snapshot.coverage.some(item => item.domain === 'utilities'));
}
/** Date precision is retained: a day range does not establish today's opening hours. */
export function localEventEligible(card, now) {
    if (card.kind !== 'event' || card.context?.startsAt === null)
        return true;
    if (card.context?.datePrecision === 'day')
        return card.context.endsAt !== undefined && Date.parse(card.context.endsAt) > now;
    return Date.parse(card.context?.startsAt ?? '') > now;
}
export function currentLocalSnapshot(v, city, now) {
    if (!validLocalSnapshot(v, city.id) || Object.keys(city).some(k => v.city[k] !== city[k]) || Date.parse(v.checkedAt) > now + 5000 || Date.parse(v.checkedAt) < now - 300000)
        return false;
    if (v.places !== undefined && !validCityPlaces(v.places, city, now))
        return false;
    if (!validNewsHealth(v.newsSources, city, v.cards, now))
        return false;
    const expected = new URL('https://api.met.no/weatherapi/locationforecast/2.0/compact');
    expected.searchParams.set('lat', city.lat.toFixed(4));
    expected.searchParams.set('lon', city.lon.toFixed(4));
    if (v.transportState !== 'not-covered' && city.id !== '2643743')
        return false;
    if ((v.weatherState === 'ready' ? 1 : 0) !== v.cards.filter(c => c.kind === 'forecast').length)
        return false;
    if ((v.transportState === 'ready' ? 1 : 0) !== v.cards.filter(c => c.kind === 'transport').length)
        return false;
    if (v.state === 'unavailable' && v.cards.length)
        return false;
    const bucharest = v.city.id === BUCHAREST_ID;
    if (bucharest && (city.countryCode !== 'RO' || city.timezone !== 'Europe/Bucharest' || !currentBucharestCoverage(v, now)))
        return false;
    if (v.coverage !== undefined && v.city.id !== PALMA_ID && !bucharest)
        return false;
    if (v.city.id !== PALMA_ID && v.cards.some(c => !['forecast', 'transport', 'local-news'].includes(c.kind) && !(bucharest && (isArcubAgendaCard(c) || isCmtebCard(c)))))
        return false;
    if (!bucharest && v.cards.some(c => c.kind === 'utility-notice' || c.kind === 'event' && c.sourceUrl.startsWith('https://arcub.ro/eveniment/')))
        return false;
    return v.cards.every(c => Date.parse(c.checkedAt) <= now + 5000 && Date.parse(c.checkedAt) >= now - 18 * 3600000
        && Date.parse(c.validTo) > now && (c.sourceUpdatedAt === null || Date.parse(c.sourceUpdatedAt) <= now + 300000)
        && (c.kind === 'local-news' ? validNewsCard(c, city, now) : c.kind === 'forecast' ? c.sourceUrl === expected.href : c.kind === 'transport' ? c.sourceUrl === 'https://tfl.gov.uk/tube-dlr-overground/status/' : Date.parse(c.checkedAt) >= now - 300000 && Date.parse(c.validTo) <= Date.parse(c.checkedAt) + 300000 && c.validFrom === c.checkedAt && c.context !== undefined && (bucharest ? (isCmtebCard(c) || isArcubAgendaCard(c) && localEventEligible(c, now)) : c.context.sourceDate <= new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now) && (c.kind !== 'event' || c.context.startsAt !== null && Date.parse(c.context.startsAt) > now && Date.parse(c.validTo) <= Date.parse(c.context.startsAt) && new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.parse(c.context.startsAt)) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)))));
}
