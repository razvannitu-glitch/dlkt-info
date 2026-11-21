import { hasEditorialTopics } from './editorial-topics.js';
import { PUBLIC_TOPICS } from './topics.js';
import { validCard, copyCard } from './card-validation.js';
import { object, validLocalSnapshot, currentLocalSnapshot } from './local-contracts.js';
export const DAILY_VERSION = 'dlkt-personal-edition-1';
export const DAILY_KEY = 'personal-edition';
export const DAILY_TOPIC_FRESHNESS_MS = 3_600_000;
export const DAILY_TOPICS = PUBLIC_TOPICS;
export function validTime(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v) || !Number.isFinite(Date.parse(v)))
    return false; return new Date(v).toISOString() === (v.includes('.') ? v : v.replace('Z', '.000Z')); }
export function validZone(v) { if (typeof v !== 'string' || v.length > 80)
    return false; try {
    new Intl.DateTimeFormat('en', { timeZone: v });
    return true;
}
catch {
    return false;
} }
export function validProfile(v) { return object(v) && (v.cityId === null || typeof v.cityId === 'string' && /^\d{1,12}$/u.test(v.cityId)) && Array.isArray(v.topics) && v.topics.length <= DAILY_TOPICS.length && v.topics.every(t => DAILY_TOPICS.includes(t)) && new Set(v.topics).size === v.topics.length && typeof v.query === 'string' && v.query.length <= 200 && !/[\u0000-\u001f\u007f]/u.test(v.query) && Number.isSafeInteger(v.budget) && Number(v.budget) > 0 && validZone(v.timezone) && (v.cityId !== null || v.topics.length > 0); }
export function profileKey(p) { return JSON.stringify([p.cityId, [...p.topics].sort(), p.query.normalize('NFKC').trim().toLowerCase(), p.budget, p.timezone]); }
export function localDay(now, timezone) { if (!Number.isFinite(now) || !validZone(timezone))
    throw Error('DAILY_CLOCK_INVALID'); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t)?.value ?? '').join('-'); }
function archiveLocal(v, p, at) {
    if (p.cityId === null || !validLocalSnapshot(v, p.cityId) || v.city.timezone !== p.timezone || (v.state === 'ready' && (v.weatherState !== 'ready' || v.city.id === '2643743' && v.transportState !== 'ready')) || Date.parse(v.checkedAt) > at + 5000)
        return false;
    return currentLocalSnapshot(v, v.city, at);
}
export function copyLocal(v) {
    const c = v.city;
    return { version: 'dlkt-local-1', city: { id: c.id, name: c.name, countryCode: c.countryCode, country: c.country, region: c.region, lat: c.lat, lon: c.lon, timezone: c.timezone }, checkedAt: v.checkedAt, state: v.state, weatherState: v.weatherState, transportState: v.transportState, cards: v.cards.map(c => ({ id: c.id, kind: c.kind, title: c.title, text: c.text, publisher: c.publisher, sourceUrl: c.sourceUrl, sourceUpdatedAt: c.sourceUpdatedAt, checkedAt: c.checkedAt, validFrom: c.validFrom, validTo: c.validTo, facts: [...c.facts], boundary: c.boundary, ...(c.news ? { news: { ...c.news, geoAnchors: [...c.news.geoAnchors] } } : {}), ...(c.context ? { context: { section: c.context.section, place: c.context.place, when: c.context.when, why: c.context.why, action: c.context.action, sourceDate: c.context.sourceDate, startsAt: c.context.startsAt, ...(c.context.endsAt !== undefined ? { endsAt: c.context.endsAt } : {}), ...(c.context.datePrecision !== undefined ? { datePrecision: c.context.datePrecision } : {}), status: c.context.status, documentHash: c.context.documentHash, documentUrl: c.context.documentUrl } } : {}) })), ...(v.newsSources ? { newsSources: v.newsSources.map(source => ({ ...source })) } : {}), ...(v.coverage ? { coverage: v.coverage.map(c => ({ domain: c.domain, state: c.state, checkedAt: c.checkedAt, sourceUrl: c.sourceUrl, note: c.note })) } : {}) };
}
export function validEdition(v, p) {
    if (!object(v) || !validTime(v.generatedAt) || v.profileKey !== profileKey(p) || !['ready', 'partial', 'unavailable', 'not-selected'].includes(String(v.topicState)) || typeof v.complete !== 'boolean' || !Array.isArray(v.records) || v.records.length > Math.min(5000, p.budget) || !v.records.every(validCard) || new Set(v.records.map(c => c.id)).size !== v.records.length || new Set(v.records.map(c => c.identity)).size !== v.records.length || !v.records.every(c => p.topics.includes(c.topic) && c.sourceState !== 'stale' && Date.parse(c.observedAt) <= Date.parse(v.generatedAt) + 300000))
        return false;
    if ((p.topics.length === 0) !== (v.topicState === 'not-selected') || (['not-selected', 'unavailable'].includes(String(v.topicState)) && v.records.length > 0))
        return false;
    // Optional for backwards compatibility: old editions retained only the visible cards.
    // This separate, bounded source-check corpus must never be interpreted as reading history.
    if (v.comparison !== undefined) {
        if (!Array.isArray(v.comparison) || v.comparison.length > 5000 || !v.comparison.every(validCard))
            return false;
        const comparison = v.comparison;
        if (new Set(comparison.map(c => c.id)).size !== comparison.length || new Set(comparison.map(c => c.identity)).size !== comparison.length)
            return false;
        if (!comparison.every(c => p.topics.includes(c.topic) && c.sourceState !== 'stale' && Date.parse(c.observedAt) <= Date.parse(v.generatedAt) + 300000))
            return false;
        if (['not-selected', 'unavailable'].includes(String(v.topicState)) && comparison.length)
            return false;
        const byId = new Map(comparison.map(c => [c.id, JSON.stringify(copyCard(c))]));
        if (!v.records.every(c => byId.get(c.id) === JSON.stringify(copyCard(c))))
            return false;
    }
    if (v.local !== null && !archiveLocal(v.local, p, Date.parse(v.generatedAt)))
        return false;
    return !v.complete || (['ready', 'not-selected'].includes(String(v.topicState)) && (p.cityId === null ? v.local === null : object(v.local) && v.local.state === 'ready'));
}
function validFeedback(v) { return object(v) && typeof v.id === 'string' && v.id.length > 0 && v.id.length <= 200 && typeof v.signature === 'string' && v.signature.length <= 24000 && ['useful', 'not-today'].includes(String(v.action)) && typeof v.day === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(v.day) && Number.isFinite(Date.parse(v.day)) && new Date(v.day).toISOString().slice(0, 10) === v.day && validZone(v.timezone); }
export function parseDaily(value) {
    try {
        if (!object(value) || value.version !== DAILY_VERSION || typeof value.revision !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value.revision) || !validProfile(value.profile) || (value.edition !== null && !validEdition(value.edition, value.profile)) || !Array.isArray(value.feedback) || value.feedback.length > 2000 || !value.feedback.every(validFeedback))
            return null;
        if (JSON.stringify(value).length > 8_000_000)
            return null;
        const profile = { cityId: value.profile.cityId, topics: [...value.profile.topics], query: value.profile.query, budget: value.profile.budget, timezone: value.profile.timezone };
        const raw = value.edition;
        const edition = raw === null ? null : { generatedAt: raw.generatedAt, profileKey: raw.profileKey, topicState: raw.topicState, complete: raw.complete, records: raw.records.map(copyCard), ...(raw.comparison !== undefined ? { comparison: raw.comparison.map(copyCard) } : {}), local: raw.local === null ? null : copyLocal(raw.local) };
        return { version: DAILY_VERSION, revision: value.revision, profile, edition, feedback: value.feedback.map(f => ({ id: f.id, signature: f.signature, action: f.action, day: f.day, timezone: f.timezone })) };
    }
    catch {
        return null;
    }
}
/** Public response, not a browser-supplied corpus. Identity and source timestamps are required. */
function sourceHealth(v) {
    return object(v) && typeof v.id === 'string' && /^[a-z0-9-]{1,80}$/u.test(v.id) && typeof v.label === 'string' && v.label.length <= 300 && typeof v.scope === 'string' && v.scope.length <= 4000 && DAILY_TOPICS.includes(v.topic) && ['verified', 'partial', 'stale', 'unavailable'].includes(String(v.state)) && Number.isSafeInteger(v.count) && Number(v.count) >= 0 && Number.isSafeInteger(v.rejected) && Number(v.rejected) >= 0 && (v.verifiedAt === null || validTime(v.verifiedAt)) && validTime(v.checkedAt) && (v.error === null || typeof v.error === 'string');
}
export function validTopicSnapshot(v, now) {
    if (!object(v) || v.version !== 'iceo-primary-mesh-1' || v.product !== 'dlkt-info' || !["current-official-records", "current-source-records"].includes(String(v.mode)) || v.deltaAvailable !== false || v.scheduledDelivery !== false || v.accountPersistence !== false || !['ready', 'partial', 'unavailable'].includes(String(v.state)) || !validTime(v.generatedAt) || Date.parse(v.generatedAt) > now + 300000 || Date.parse(v.generatedAt) < now - DAILY_TOPIC_FRESHNESS_MS || !Number.isSafeInteger(v.conflictCount) || Number(v.conflictCount) < 0 || (Number(v.conflictCount) > 0 && v.state === 'ready') || !Array.isArray(v.cards) || v.cards.length > 5000 || !v.cards.every(validCard) || !Array.isArray(v.sources) || v.sources.length > 100 || !v.sources.every(sourceHealth))
        return false;
    const cards = v.cards, sources = v.sources;
    return (Number(v.conflictCount) === 0 || cards.length > 0) && new Set(cards.map(c => c.id)).size === cards.length && new Set(cards.map(c => c.identity)).size === cards.length && new Set(sources.map(s => s.id)).size === sources.length && cards.every(c => c.sourceIds.length > 0 && c.sourceIds.every(id => sources.some(s => s.id === id && (s.topic === c.topic || hasEditorialTopics(s.id))))) && sources.every(s => s.count === cards.filter(c => c.sourceIds.includes(s.id)).length);
}
