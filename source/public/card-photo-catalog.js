import { validContextForCard } from './context.js';
import { REVIEWED_PHOTOS } from './reviewed-photos.js';
import { CONTEXT_PHOTOS } from './context-photos.js';
const origins = new Set(['https://globalvoices.org', 'https://science.nasa.gov', 'https://assets.science.nasa.gov', 'https://commons.wikimedia.org', 'https://creativecommons.org', 'https://www.nasa.gov']);
const safe = (value) => { try {
    const u = new URL(value);
    return origins.has(u.origin) && !u.username && !u.password && u.protocol === 'https:';
}
catch {
    return false;
} };
/** Media have their own review. Publisher-text licensing is never treated as image permission. */
export function usablePhoto(photo, now) {
    return Number.isFinite(now) && Number.isFinite(Date.parse(photo.reviewedAt)) && Number.isFinite(Date.parse(photo.reviewBy))
        && Date.parse(photo.reviewedAt) <= now && now <= Date.parse(photo.reviewBy)
        && /^[a-f0-9]{64}$/u.test(photo.sha256) && photo.path === `/card-media/${photo.sha256.slice(0, 16)}.${photo.assetUrl.includes('.webp') ? 'webp' : 'jpg'}`
        && Number.isSafeInteger(photo.bytes) && photo.bytes > 1000 && photo.bytes <= 260000
        && Number.isSafeInteger(photo.width) && photo.width >= 640 && photo.width <= 1600 && Number.isSafeInteger(photo.height) && photo.height >= 300 && photo.height <= 1600
        && photo.alt.length > 10 && photo.alt.length <= 300 && photo.caption.length > 0 && photo.caption.length <= 300 && photo.credit.length > 0 && photo.credit.length <= 200
        && safe(photo.assetUrl) && safe(photo.creditUrl) && safe(photo.sourceUrl)
        && (['https://creativecommons.org/licenses/by-sa/4.0/', 'https://www.nasa.gov/nasa-brand-center/images-and-media/'].includes(photo.licenseUrl))
        && (photo.contextRevision === undefined || (/^[a-f0-9]{64}$/u.test(photo.contextRevision.contentHash) && validContextForCard(photo.contextRevision.context, [photo.sourceId])))
        && (photo.fit === 'cover' || photo.fit === 'contain');
}
/** Exact reviewed revision only. This changes presentation, never EvidenceCard or its stored hash. */
export function photoFor(card, now = Date.now()) {
    const p = REVIEWED_PHOTOS.find(p => p.cardId === card.id);
    if (!p || !usablePhoto(p, now))
        return null;
    const revision = p.contextRevision, context = card.context;
    // A finite second pin is derived from the reviewed article plus evidenced context only.
    // Neither arbitrary context nor a legacy hash attached to new context is accepted.
    const reviewedHash = context === undefined ? card.contentHash === p.contentHash : revision !== undefined && card.contentHash === revision.contentHash
        && validContextForCard(context, card.sourceIds) && context.basis === revision.context.basis && context.label === revision.context.label && context.boundary === revision.context.boundary
        && context.countries.length === revision.context.countries.length && context.countries.every((country, index) => country.code === revision.context.countries[index]?.code && country.name === revision.context.countries[index]?.name);
    return card.kind === 'publication' && card.identity === p.identity && card.sourceUrl === p.sourceUrl && card.topic === p.topic
        && card.publisher === p.publisher && card.sourceIds.includes(p.sourceId) && card.title === p.articleTitle && card.date === p.articleDate && reviewedHash ? p : null;
}
const contextLicenses = Object.freeze({
    'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
    'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
    'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
    'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
    'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
});
const commonsUrl = (value, asset = false) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
            && (asset ? ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && url.pathname.startsWith('/wikipedia/commons/') : url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:'));
    }
    catch {
        return false;
    }
};
/** Independent, finite review of a topic photograph; never evidence for an article. */
export function usableContextPhoto(photo, now) {
    return Number.isFinite(now) && Number.isFinite(Date.parse(photo.reviewedAt)) && Number.isFinite(Date.parse(photo.reviewBy))
        && Date.parse(photo.reviewedAt) <= now && now <= Date.parse(photo.reviewBy)
        && photo.kind === 'context' && photo.mimeType === 'image/jpeg' && /^[a-f0-9]{64}$/u.test(photo.sha256)
        && photo.path === `/card-media/${photo.sha256.slice(0, 16)}.jpg`
        && Number.isSafeInteger(photo.bytes) && photo.bytes > 1000 && photo.bytes <= 420000
        && Number.isSafeInteger(photo.width) && photo.width >= 640 && photo.width <= 1000 && Number.isSafeInteger(photo.height) && photo.height >= 300 && photo.height <= 1400
        && photo.alt.startsWith('Context: ') && photo.alt.length <= 300 && photo.caption.startsWith('Context photo: ') && photo.caption.length <= 300
        && photo.credit.length > 0 && photo.credit.length <= 200 && photo.changeNote.length > 0 && photo.changeNote.length <= 200
        && (photo.requiredAttribution === undefined || photo.requiredAttribution.length > 0 && photo.credit.includes(photo.requiredAttribution))
        && commonsUrl(photo.assetUrl, true) && commonsUrl(photo.creditUrl) && photo.sourceUrl === photo.creditUrl
        && contextLicenses[photo.license] === photo.licenseUrl && photo.fit === 'contain';
}
export function contextPhotoSubject(card) {
    const title = card.title.toLowerCase();
    if (/\b(?:equestrian|dressage|show[ -]?jumping|horse riding|horse racing|horses?)\b/u.test(title))
        return 'equestrian';
    if (/\b(?:roadworks?|road closures?|potholes?|street resurfacing|bridge repairs?|traffic diversions?|detours?)\b/u.test(title))
        return 'roadworks';
    if (/\b(?:concerts?|orchestra|singers?|live music|musicians?|opera|albums?|music festivals?)\b/u.test(title))
        return 'music';
    if (/\b(?:football|soccer|uefa|fifa|premier league)\b/u.test(title))
        return 'football';
    if (/\b(?:parents?|parenting|families|family|children|babies|baby|childcare|guardianship|care leavers)\b/u.test(title))
        return 'family';
    if (/\b(?:schools?|students?|teachers?|universit(?:y|ies)|classrooms?|curriculum|scholarships?)\b/u.test(title))
        return 'education';
    if (/\b(?:doctors?|hospitals?|patients?|vaccines?|medical|medicine|disease|health|cancer|first aid|cpr)\b/u.test(title))
        return 'health';
    if (/\b(?:weather|storms?|hurricanes?|tornadoes?|heatwaves?|flooding|rainfall|snowfall|climate)\b/u.test(title))
        return 'weather';
    if (/\b(?:flights?|airports?|airlines?|aviation|tourism|tourists?|holidays?|travel|visas?)\b/u.test(title))
        return 'travel';
    if (/\b(?:supermarkets?|groceries|shopping|retailers?|discounts?|black friday|food prices)\b/u.test(title))
        return 'shopping';
    const category = card.sourceIds?.find(id => id.startsWith('news-'))?.slice(5);
    const categories = { world: 'world', business: 'business', technology: 'technology', money: 'business', health: 'health', sport: 'football', gaming: 'technology', culture: 'music', shopping: 'shopping', travel: 'travel', work: 'business', education: 'education', family: 'family', science: 'science', environment: 'weather', 'public-affairs': 'world', 'digital-life': 'technology', food: 'shopping', housing: 'roadworks', weather: 'weather' };
    if (category && categories[category])
        return categories[category];
    const topics = { technology: 'technology', business: 'business', regulation: 'world', opportunities: 'business', science: 'science', environment: 'weather', health: 'health', 'public-affairs': 'world', world: 'world', 'digital-life': 'technology', culture: 'music', money: 'business', space: 'science', weather: 'weather', energy: 'weather', 'work-education': 'education', housing: 'roadworks', travel: 'travel', food: 'shopping', sport: 'football', other: 'education' };
    return card.topic ? topics[card.topic] : 'world';
}
export function contextPhotoFor(card, now = Date.now()) {
    const subject = contextPhotoSubject(card);
    return CONTEXT_PHOTOS.find(photo => photo.subject === subject && usableContextPhoto(photo, now))
        ?? CONTEXT_PHOTOS.find(photo => photo.subject === 'world' && usableContextPhoto(photo, now)) ?? null;
}
/** Exact reviewed article photograph first; explicitly labelled topic context otherwise. */
export function displayPhotoFor(card, now = Date.now()) {
    return photoFor(card, now) ?? contextPhotoFor(card, now);
}
