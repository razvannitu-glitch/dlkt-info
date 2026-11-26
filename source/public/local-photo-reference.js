import { localEventEligible } from './local-contracts.js';
/** A reviewed original event page only; neither its image URL nor an arbitrary host is client input. */
export function arcubPhotoSource(sourceUrl, reference) {
    if (reference.cityId !== '683506' || !/^bucharest:arcub:[a-f0-9]{24}$/u.test(reference.id))
        return false;
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 1000 || /[\\\u0000-\u0020\u007f]/u.test(sourceUrl))
        return false;
    try {
        const url = new URL(sourceUrl);
        return url.href === sourceUrl && url.origin === 'https://arcub.ro' && !url.username && !url.password && !url.port && !url.search && !url.hash
            && /^\/eveniment\/[a-z0-9-]+$/u.test(url.pathname);
    }
    catch {
        return false;
    }
}
/** Share exact source-record identity between public recent/city cards and Daily. */
export function localCardPhotoReference(card, cityId, now = Date.now()) {
    if (card.kind === 'local-news' && card.news)
        return { id: card.news.id, revision: card.news.documentHash, cityId };
    const context = card.context;
    if (card.kind !== 'event' || card.publisher !== 'ARCUB' || !arcubPhotoSource(card.sourceUrl, { id: card.id, cityId })
        || !context || context.section !== 'discover' || context.status !== 'scheduled' || !/^[a-f0-9]{64}$/u.test(context.documentHash)
        || ![card.sourceUrl, 'https://arcub.ro/agenda'].includes(context.documentUrl)
        || card.photoRevision !== undefined && (typeof card.photoRevision !== 'string' || !/^[a-f0-9]{64}$/u.test(card.photoRevision)))
        return undefined;
    const checked = Date.parse(card.checkedAt), until = Date.parse(card.validTo);
    if (!Number.isFinite(now) || !Number.isFinite(checked) || !Number.isFinite(until) || checked > now + 5000 || checked < now - 300000
        || card.validFrom !== card.checkedAt || until <= now || until > checked + 300000 || !localEventEligible(card, now))
        return undefined;
    return { id: card.id, revision: card.photoRevision ?? context.documentHash, cityId };
}
