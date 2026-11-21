export const NEWS_WINDOW_MS = 72 * 60 * 60 * 1000;
export const NEWS_CHECK_MS = 5 * 60 * 1000;
/** Operator-reviewed city capabilities. An article still needs its own place reference. */
export const CITY_NEWS_FEEDS = Object.freeze([
    Object.freeze({ id: 'bucharest-b365', publisher: 'B365', cityId: '683506', countryCode: 'RO', timezone: 'Europe/Bucharest',
        endpoint: 'https://b365.ro/feed/', home: 'https://b365.ro/', title: 'B365', articlePattern: /^\/[a-z0-9-]+-\d{4,}\/$/u,
        termsUrl: 'https://b365.ro/despre-noi/', rightsCheckedAt: '2026-11-18', rightsReviewBy: '2026-12-18', quoteLimit: 250,
        attribution: 'Source: B365. Publisher headline and optional short excerpt. Read the original article for its full context.' }),
    Object.freeze({ id: 'bucharest-buletin', publisher: 'Buletin de București', cityId: '683506', countryCode: 'RO', timezone: 'Europe/Bucharest',
        endpoint: 'https://buletin.de/bucuresti/feed/', home: 'https://buletin.de/bucuresti/', title: 'Buletin de București', articlePattern: /^\/bucuresti\/[a-z0-9]+(?:-[a-z0-9]+)+\/$/u,
        termsUrl: 'https://buletin.de/bucuresti/termeni-si-conditii/', rightsCheckedAt: '2026-11-18', rightsReviewBy: '2026-12-18', quoteLimit: 500,
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        attribution: 'Source: Buletin de București. CC BY 4.0. Publisher headline and optional excerpt selected from the feed; the excerpt may be shortened. Read the original article.' }),
]);
const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[<>\u0000-\u001f\u007f]/u.test(v);
const timestamp = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const fold = (value) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
export function newsFeedsFor(city) { return CITY_NEWS_FEEDS.filter(s => s.cityId === city.id && s.countryCode === city.countryCode && s.timezone === city.timezone); }
export function newsFeed(sourceId) { return CITY_NEWS_FEEDS.find(s => s.id === sourceId); }
export function newsEndpoint(value) { return typeof value === 'string' && CITY_NEWS_FEEDS.some(s => s.endpoint === value); }
export function newsSourceForUrl(value) {
    if (typeof value !== 'string' || value.length > 2000)
        return undefined;
    try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || u.username || u.password || u.port || u.hash || u.search || u.href !== value)
            return undefined;
        return CITY_NEWS_FEEDS.find(source => new URL(source.home).origin === u.origin && source.articlePattern.test(u.pathname)
            && !['/bucuresti/termeni-si-conditii/', '/bucuresti/politica-de-confidentialitate/'].includes(u.pathname));
    }
    catch {
        return undefined;
    }
}
/** A conservative article-place reference; not a claim of distance, active incident or personal effect. */
export function newsGeographicAnchors(title, summary, sourceId, city) {
    const source = newsFeed(sourceId);
    if (!source || !newsFeedsFor(city).some(s => s.id === source.id))
        return [];
    const value = title + (summary ? ' ' + summary : ''), normalized = fold(value), anchors = [];
    // A nearby town is not silently relabelled as the selected city. Infrastructure may still be a city reference.
    const outsideCity = /\b(?:ganeasa|voluntari|tribunalul ilfov|judetul ilfov)\b/u.test(normalized)
        || /\b(?:langa|aproape de|in apropierea|din apropierea)\s+bucuresti\b/u.test(normalized);
    const patterns = [/\b(?:bucuresti|bucharest)\b/gu, /\bsector(?:ul|ului)?\s*[1-6]\b/gu,
        /\b(?:metrorex|termoenergetica|pmb)\b/gu,
        /\b(?:drumul taberei|vatra noua|colosseum mall|pajura|parcul pantelimon|aleea privighetorilor|calea victoriei|piata universitatii)\b/gu];
    for (let i = 0; i < patterns.length; i++) {
        if (i === 0 && outsideCity)
            continue;
        const pattern = patterns[i];
        if (!pattern)
            continue;
        for (const match of normalized.matchAll(pattern)) {
            const anchor = value.slice(match.index, match.index + match[0].length);
            if (!anchors.some(item => fold(item) === fold(anchor)))
                anchors.push(anchor);
            if (anchors.length === 6)
                return anchors;
        }
    }
    return anchors;
}
/** Topic classification is a transparent reading aid, not a measured importance score. */
export function newsTopic(title, summary) {
    const value = fold(title + (summary ? ' ' + summary : ''));
    if (/\b(?:termoficare|termoenergetica|apa calda|caldura|avarii|distributie a apei)\b/u.test(value))
        return 'utilities';
    if (/\b(?:scoala|scoli|liceu|liceul|elevi|gradinita|gradinite|universitate|educatie)\b/u.test(value))
        return 'education';
    if (/\b(?:deseuri|mediu|spatii verzi|poluare|garda de mediu)\b/u.test(value))
        return 'environment';
    if (/\b(?:agresiune|arest|incendiu|evacuare|accident|politisti|politia)\b/u.test(value))
        return 'safety';
    if (/\b(?:metrorex|metrou|magistrala|tramvai|autobuz|trafic|transport|trenuri|statie)\b/u.test(value))
        return 'transport';
    if (/\b(?:festival|concert|eveniment|spectacol|targ|craciun)\b/u.test(value))
        return 'events';
    if (/\b(?:muzeu|teatru|expozitie|cultura|cinema)\b/u.test(value))
        return 'culture';
    if (/\b(?:preturi|salarii|locuri de munca|afaceri|economie)\b/u.test(value))
        return 'economy';
    return 'city';
}
export const NEWS_TOPIC_LABELS = Object.freeze({ transport: 'Getting around', education: 'Schools & education', city: 'City life', utilities: 'Essential services', safety: 'Public safety', culture: 'Arts & culture', events: 'Things to do', economy: 'Local economy', environment: 'Environment' });
export function newsTopicLabel(topic) { return NEWS_TOPIC_LABELS[topic]; }
export function validLocalNewsArticle(value, city, now) {
    if (!record(value) || !Number.isFinite(now) || !text(value.sourceId, 80))
        return false;
    const source = newsFeed(value.sourceId);
    if (!source || !newsFeedsFor(city).some(s => s.id === source.id) || value.cityId !== city.id
        || new Date(now).toISOString().slice(0, 10) > source.rightsReviewBy || value.publisher !== source.publisher || value.documentUrl !== source.endpoint
        || newsSourceForUrl(value.url)?.id !== source.id || !text(value.id, 100) || !new RegExp('^local-news:' + city.id + ':' + source.id + ':[a-f0-9]{24}$', 'u').test(value.id)
        || !text(value.title, Math.min(300, source.quoteLimit)) || (value.summary !== undefined && !text(value.summary, source.quoteLimit))
        || value.title.length + (typeof value.summary === 'string' ? value.summary.length + 1 : 0) > source.quoteLimit
        || value.attribution !== source.attribution || value.licenseUrl !== source.licenseUrl
        || (source.licenseUrl ? (!text(value.byline, 205) || !value.byline.startsWith('By ')) : value.byline !== undefined)
        || value.geographyBasis !== 'article-place-reference' || !Array.isArray(value.geoAnchors) || value.geoAnchors.length === 0 || value.geoAnchors.length > 6
        || typeof value.documentHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.documentHash)
        || !timestamp(value.publishedAt) || !timestamp(value.checkedAt) || !timestamp(value.validUntil))
        return false;
    const checked = Date.parse(value.checkedAt), published = Date.parse(value.publishedAt), until = Date.parse(value.validUntil);
    if (checked > now + 5000 || checked <= now - NEWS_CHECK_MS || published > now + 300000 || published < now - NEWS_WINDOW_MS
        || until !== checked + NEWS_CHECK_MS || until <= now || value.topic !== newsTopic(value.title, value.summary))
        return false;
    const anchors = newsGeographicAnchors(value.title, value.summary, value.sourceId, city), geoAnchors = value.geoAnchors;
    return anchors.length === geoAnchors.length && anchors.every((anchor, index) => anchor === geoAnchors[index]);
}
