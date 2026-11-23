import { validCard } from './card-validation.js';
import { NEWS_CATEGORIES, isNewsCategoryId, newsCategory } from './news-taxonomy.js';
import { sourceLanguage, newsLanguageMatches, sourceEditionCountryCode } from './news-sources.js';
import { localeFromPreference } from './i18n-locale.js';
import { validCity } from './local-contracts.js';
import { newsFeed, validLocalNewsArticle, NEWS_WINDOW_MS } from './local-news-policy.js';
import { newsPublishedInDay, validNewsDayWindow, validNewsPeriod } from './news-day.js';
export const validNewsSourceScope = (value) => value === 'edition' || value === 'all';
export const NEWS_PAGE_VERSION = 'dlkt-news-page-4';
export const NEWS_STORY_SOURCES_VERSION = 'dlkt-news-sources-1';
export const NEWS_SERVER_PAGE_SIZE = 20, NEWS_SOURCE_PAGE_SIZE = 20, NEWS_STORY_PREVIEW_SIZE = 3, NEWS_MAX_RESPONSE_BYTES = 1_048_576;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fields = (value, required, optional = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const integer = (value, max = 5000) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max;
const timestamp = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const bounded = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
export const validNewsCityId = (value) => typeof value === 'string' && /^[1-9]\d{0,11}$/u.test(value);
export const validNewsEpochId = (value) => typeof value === 'string' && /^[1-9]\d{0,15}$/u.test(value) && Number.isSafeInteger(Number(value));
export const validNewsStreamFilter = (value) => value === 'all' || value === 'other' || isNewsCategoryId(value);
const GLOBAL_REQUIRED = ['id', 'identity', 'title', 'topic', 'kind', 'sourceUrl', 'publisher', 'sourceIds', 'date', 'dateLabel', 'observedAt', 'contentHash', 'boundary', 'deadline', 'version', 'attribution', 'sourceState'];
const GLOBAL_OPTIONAL = ['summary', 'byline', 'licenseUrl', 'context', 'articleSubject'];
const LOCAL_REQUIRED = ['id', 'kind', 'title', 'text', 'publisher', 'sourceUrl', 'sourceUpdatedAt', 'checkedAt', 'validFrom', 'validTo', 'facts', 'boundary', 'context', 'news'];
const NEWS_REQUIRED = ['id', 'sourceId', 'title', 'publisher', 'url', 'publishedAt', 'checkedAt', 'validUntil', 'topic', 'cityId', 'geographyBasis', 'geoAnchors', 'documentHash', 'documentUrl', 'attribution'];
const CONTEXT_REQUIRED = ['section', 'place', 'when', 'why', 'action', 'sourceDate', 'startsAt', 'status', 'documentHash', 'documentUrl'];
/** Exact public field allowlist; server persistence also verifies the cryptographic record identity. */
export function validNewsGlobalCard(value, now) {
    if (!Number.isFinite(now) || !object(value) || !fields(value, GLOBAL_REQUIRED, GLOBAL_OPTIONAL) || !validCard(value)
        || value.kind !== 'publication' || value.dateLabel !== 'Published' || value.sourceState === 'stale' || value.sourceIds.length === 0 || value.sourceIds.length > 100
        || new Set(value.sourceIds).size !== value.sourceIds.length)
        return false;
    const published = Date.parse(value.date), observed = Date.parse(value.observedAt);
    return published <= now && published > now - 86400000 && observed <= now + 300000 && observed > now - 3600000;
}
/** Local article metadata is validated against the existing reviewed city/source policy. */
export function validNewsLocalCard(value, cityId, now, city) {
    if (!city || !validCity(city) || city.id !== cityId || !object(value) || !exact(value, LOCAL_REQUIRED) || !object(value.news) || !fields(value.news, NEWS_REQUIRED, ['summary', 'byline', 'licenseUrl'])
        || !validLocalNewsArticle(value.news, city, now) || !object(value.context) || !exact(value.context, CONTEXT_REQUIRED))
        return false;
    const article = value.news, context = value.context;
    return value.kind === 'local-news' && value.id === article.id && value.title === article.title
        && value.text === (article.summary ?? 'Read the publisher report for the complete details.')
        && value.publisher === article.publisher && value.sourceUrl === article.url && value.sourceUpdatedAt === null
        && value.checkedAt === article.checkedAt && value.validFrom === article.checkedAt && value.validTo === article.validUntil
        && Array.isArray(value.facts) && value.facts.length === 0 && bounded(value.boundary, 1000)
        && context.section === 'context' && context.status === 'publisher-announcement' && context.place === city.name
        && context.when === 'Published ' + article.publishedAt && bounded(context.why, 1000) && bounded(context.action, 1000)
        && context.sourceDate === article.publishedAt.slice(0, 10) && context.startsAt === null
        && context.documentHash === article.documentHash && context.documentUrl === article.documentUrl;
}
const STORY_KEY = /^story:[a-f0-9]{64}$/u;
const CURSOR = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u;
const cursor = (value) => bounded(value, 2048) && CURSOR.test(value);
export function validNewsStorySource(value, now, city) {
    if (!object(value) || !exact(value, ['kind', 'card']))
        return false;
    if (value.kind === 'global')
        return validNewsGlobalCard(value.card, now);
    return value.kind === 'local' && object(value.card) && object(value.card.news) && validNewsCityId(value.card.news.cityId)
        && validNewsLocalCard(value.card, value.card.news.cityId, now, city);
}
function distinctSources(sources) {
    const ids = new Set(), urls = new Set(), identities = new Set();
    for (const source of sources) {
        const identity = source.kind === 'global' ? source.card.identity : source.card.sourceUrl;
        if (ids.has(source.card.id) || urls.has(source.card.sourceUrl) || identities.has(identity))
            return false;
        ids.add(source.card.id);
        urls.add(source.card.sourceUrl);
        identities.add(identity);
    }
    return true;
}
export function validNewsPageItem(value, now, city) {
    if (!object(value) || !fields(value, ['kind', 'key', 'category', 'card'], ['story']) || (value.category !== null && !isNewsCategoryId(value.category)))
        return false;
    const primaryValid = value.kind === 'global' ? validNewsGlobalCard(value.card, now) && value.key === 'article:' + value.card.id && value.category === newsCategory(value.card)
        : value.kind === 'local' && object(value.card) && object(value.card.news) && validNewsCityId(value.card.news.cityId)
            && validNewsLocalCard(value.card, value.card.news.cityId, now, city) && value.key === 'local:' + value.card.id && value.category === newsCategory(value.card);
    if (!primaryValid)
        return false;
    if (value.story === undefined)
        return true;
    const story = value.story;
    if (!object(story) || !exact(story, ['key', 'basis', 'related', 'sourceTotal', 'nextSourcesCursor']) || typeof story.key !== 'string' || !STORY_KEY.test(story.key)
        || typeof story.basis !== 'string' || !['matching-headlines', 'shared-event'].includes(story.basis) || !integer(story.sourceTotal) || story.sourceTotal < 2
        || !Array.isArray(story.related) || story.related.length > NEWS_STORY_PREVIEW_SIZE || story.related.length >= story.sourceTotal
        || (story.nextSourcesCursor !== null && !cursor(story.nextSourcesCursor))
        || (story.nextSourcesCursor === null) !== (story.related.length + 1 === story.sourceTotal))
        return false;
    const originals = [];
    for (const source of [{ kind: value.kind, card: value.card }, ...story.related]) {
        if (!validNewsStorySource(source, now, city))
            return false;
        originals.push(source);
    }
    return distinctSources(originals);
}
/** Reviewed original language only; an unknown source is never labelled with the interface locale. */
export function newsOriginalLanguage(source) {
    if (source.kind === 'global')
        return sourceLanguage(source.card);
    const sourceId = source.card.news?.sourceId;
    return sourceId ? newsFeed(sourceId)?.language ?? null : null;
}
function sourceInContext(source, language, cityId, expiresAt, day, sourceScope = 'edition') {
    if (source.kind === 'global')
        return (sourceScope === 'all' || newsLanguageMatches(sourceLanguage(source.card), language))
            && (day === null || newsPublishedInDay(source.card.date, day))
            && Date.parse(expiresAt) <= Math.min(Date.parse(source.card.observedAt) + 3600000, Date.parse(source.card.date) + 86400000);
    const article = source.card.news;
    return article !== undefined && article.cityId === cityId && (sourceScope === 'all' || newsLanguageMatches(newsFeed(article.sourceId)?.language ?? null, language))
        && (day === null || newsPublishedInDay(article.publishedAt, day))
        && Date.parse(expiresAt) <= Math.min(Date.parse(article.validUntil), Date.parse(article.publishedAt) + NEWS_WINDOW_MS + 1);
}
/** Browser-safe boundary. Context continuity and cross-page duplicates are checked by the reader controller. */
export function validNewsPage(value, now = Date.now(), city) {
    if (!Number.isFinite(now) || !object(value) || !fields(value, ['version', 'epoch', 'revision', 'generatedAt', 'startedAt', 'expiresAt', 'language', 'cityId', 'countryCode', 'coverage', 'period', 'day', 'filter', 'items', 'total', 'articleTotal', 'filteredTotal', 'counts', 'nextCursor'], ['sourceScope'])
        || value.sourceScope !== undefined && !validNewsSourceScope(value.sourceScope)
        || value.version !== NEWS_PAGE_VERSION || !validNewsPeriod(value.period) || !validNewsEpochId(value.epoch) || !integer(value.revision, Number.MAX_SAFE_INTEGER) || value.revision === 0
        || !timestamp(value.generatedAt) || !timestamp(value.startedAt) || !timestamp(value.expiresAt) || Date.parse(value.generatedAt) > now + 5000
        || Date.parse(value.startedAt) > now + 5000 || Date.parse(value.startedAt) < Date.parse(value.generatedAt) - 5000 || Date.parse(value.expiresAt) <= Date.parse(value.startedAt) || Date.parse(value.expiresAt) <= now
        || Date.parse(value.expiresAt) > Date.parse(value.generatedAt) + 3600000 || Date.parse(value.expiresAt) <= Date.parse(value.generatedAt)
        || localeFromPreference(value.language) === null || (value.cityId !== null && !validNewsCityId(value.cityId)) || !validNewsStreamFilter(value.filter)
        || (value.countryCode !== null && (typeof value.countryCode !== 'string' || !/^[A-Z]{2}$/u.test(value.countryCode)))
        || (value.cityId === null) !== (value.countryCode === null)
        || city !== undefined && (!validCity(city) || value.cityId !== city.id || value.countryCode !== city.countryCode)
        || !object(value.coverage) || !exact(value.coverage, ['national', 'local', 'international']) || !Object.values(value.coverage).every(count => integer(count))
        || Number(value.coverage.national) + Number(value.coverage.local) + Number(value.coverage.international) !== value.total
        || value.countryCode === null && (value.coverage.national !== 0 || value.coverage.local !== 0)
        || !integer(value.total) || !integer(value.articleTotal) || value.articleTotal < value.total || value.total === 0 && value.articleTotal !== 0 || !integer(value.filteredTotal) || value.filteredTotal > value.total
        || !object(value.counts) || !exact(value.counts, ['other', ...NEWS_CATEGORIES.map(category => category.id)]) || !Object.values(value.counts).every(count => integer(count))
        || Object.values(value.counts).reduce((sum, count) => sum + Number(count), 0) !== value.total
        || value.filteredTotal !== (value.filter === 'all' ? value.total : value.counts[value.filter])
        || !Array.isArray(value.items) || value.items.length > NEWS_SERVER_PAGE_SIZE || value.items.length > value.filteredTotal
        || (value.nextCursor !== null && (!cursor(value.nextCursor) || value.items.length !== NEWS_SERVER_PAGE_SIZE))
        || (value.filteredTotal === 0 && (value.items.length !== 0 || value.nextCursor !== null)))
        return false;
    if (value.period === 'recent') {
        if (value.day !== null)
            return false;
    }
    else if (value.cityId !== null && city === undefined || !validNewsDayWindow(value.day, Date.parse(value.startedAt), city?.timezone ?? 'UTC')
        || Date.parse(value.expiresAt) > Date.parse(value.day.end))
        return false;
    const day = value.period === 'today' ? value.day : null;
    const language = value.language, keys = new Set(), stories = new Set(), ids = new Set(), urls = new Set(), identities = new Set();
    const observed = { national: 0, local: 0, international: 0 };
    let declaredSources = 0;
    for (const item of value.items) {
        if (!validNewsPageItem(item, now, city) || (value.filter !== 'all' && (item.category ?? 'other') !== value.filter))
            return false;
        if (keys.has(item.key) || item.story && stories.has(item.story.key))
            return false;
        keys.add(item.key);
        if (item.story)
            stories.add(item.story.key);
        declaredSources += item.story?.sourceTotal ?? 1;
        const primary = item.kind === 'global' ? { kind: 'global', card: item.card } : { kind: 'local', card: item.card };
        for (const source of [primary, ...(item.story?.related ?? [])]) {
            const identity = source.kind === 'global' ? source.card.identity : source.card.sourceUrl;
            if (ids.has(source.card.id) || urls.has(source.card.sourceUrl) || identities.has(identity)
                || !sourceInContext(source, language, value.cityId, value.expiresAt, day, value.sourceScope))
                return false;
            ids.add(source.card.id);
            urls.add(source.card.sourceUrl);
            identities.add(identity);
        }
        if (item.kind === 'local')
            observed.local++;
        else if (value.countryCode !== null && sourceEditionCountryCode(item.card) === value.countryCode)
            observed.national++;
        else
            observed.international++;
    }
    return declaredSources <= value.articleTotal && (value.items.length !== value.total || declaredSources === value.articleTotal) && observed.national <= Number(value.coverage.national) && observed.local <= Number(value.coverage.local) && observed.international <= Number(value.coverage.international);
}
export function validNewsStorySourcesPage(value, now = Date.now(), city) {
    if (!Number.isFinite(now) || !object(value) || !fields(value, ['version', 'epoch', 'revision', 'generatedAt', 'startedAt', 'expiresAt', 'language', 'cityId', 'countryCode', 'period', 'day', 'filter', 'storyKey', 'sourceTotal', 'offset', 'sources', 'nextCursor'], ['sourceScope'])
        || value.sourceScope !== undefined && !validNewsSourceScope(value.sourceScope)
        || value.version !== NEWS_STORY_SOURCES_VERSION || !validNewsPeriod(value.period) || !validNewsEpochId(value.epoch) || !integer(value.revision, Number.MAX_SAFE_INTEGER) || value.revision === 0
        || !timestamp(value.generatedAt) || !timestamp(value.startedAt) || !timestamp(value.expiresAt) || Date.parse(value.generatedAt) > now + 5000
        || Date.parse(value.startedAt) > now + 5000 || Date.parse(value.startedAt) < Date.parse(value.generatedAt) - 5000 || Date.parse(value.expiresAt) <= Date.parse(value.startedAt) || Date.parse(value.expiresAt) <= now
        || Date.parse(value.expiresAt) > Date.parse(value.generatedAt) + 3600000 || Date.parse(value.expiresAt) <= Date.parse(value.generatedAt)
        || localeFromPreference(value.language) === null || (value.cityId !== null && !validNewsCityId(value.cityId)) || !validNewsStreamFilter(value.filter)
        || (value.countryCode !== null && (typeof value.countryCode !== 'string' || !/^[A-Z]{2}$/u.test(value.countryCode)))
        || (value.cityId === null) !== (value.countryCode === null) || value.cityId !== null && city === undefined || city !== undefined && (!validCity(city) || value.cityId !== city.id || value.countryCode !== city.countryCode)
        || typeof value.storyKey !== 'string' || !STORY_KEY.test(value.storyKey) || !integer(value.sourceTotal) || value.sourceTotal < 2
        || !integer(value.offset) || value.offset < 1 || value.offset >= value.sourceTotal || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > NEWS_SOURCE_PAGE_SIZE
        || value.offset + value.sources.length > value.sourceTotal || (value.nextCursor !== null && !cursor(value.nextCursor))
        || (value.nextCursor === null) !== (value.offset + value.sources.length === value.sourceTotal))
        return false;
    if (value.period === 'recent') {
        if (value.day !== null)
            return false;
    }
    else if (value.cityId !== null && city === undefined || !validNewsDayWindow(value.day, Date.parse(value.startedAt), city?.timezone ?? 'UTC')
        || Date.parse(value.expiresAt) > Date.parse(value.day.end))
        return false;
    const day = value.period === 'today' ? value.day : null, sources = [];
    for (const source of value.sources) {
        if (!validNewsStorySource(source, now, city) || !sourceInContext(source, value.language, value.cityId, value.expiresAt, day, value.sourceScope))
            return false;
        sources.push(source);
    }
    return distinctSources(sources);
}
