import { safeLink } from './source-links.js';
export const SOURCE_LICENSES = Object.freeze({
    'gv-world': 'https://creativecommons.org/licenses/by/3.0/',
    'gv-culture': 'https://creativecommons.org/licenses/by/3.0/',
    'eff-digital': 'https://creativecommons.org/licenses/by/4.0/',
    'ec-press': 'https://creativecommons.org/licenses/by/4.0/',
    'cbs-news': 'https://creativecommons.org/licenses/by/4.0/',
    'scidev-news': 'https://creativecommons.org/licenses/by/3.0/',
    '360-news': 'https://creativecommons.org/licenses/by/4.0/',
});
const LICENSES = ['https://creativecommons.org/licenses/by/3.0/', 'https://creativecommons.org/licenses/by/4.0/'];
export function validCredits(value) {
    const ids = Array.isArray(value.sourceIds) ? value.sourceIds : [];
    const required = ids.filter((id) => typeof id === 'string' && Object.hasOwn(SOURCE_LICENSES, id)).map(id => SOURCE_LICENSES[id]);
    if (value.byline === undefined && value.licenseUrl === undefined)
        return required.length === 0;
    return typeof value.byline === 'string' && value.byline.length > 0 && value.byline.length <= 600 && !/[\u0000-\u001f\u007f\p{Surrogate}]/u.test(value.byline)
        && typeof value.licenseUrl === 'string' && LICENSES.includes(value.licenseUrl) && required.every(url => url === value.licenseUrl);
}
export function licenseLabel(url) { return url === LICENSES[0] ? 'CC BY 3.0' : url === LICENSES[1] ? 'CC BY 4.0' : ''; }
/** Only text nodes and fixed, validated license links. No source markup is rendered. */
export function cardCreditsNode(card) {
    if (!card.byline || !card.licenseUrl || !validCredits(card))
        return null;
    const source = safeLink(card.sourceUrl);
    if (!source)
        return null;
    const row = document.createElement('p');
    row.className = 'card-credits';
    row.append(document.createTextNode(card.byline + ' · '));
    const link = document.createElement('a');
    link.href = card.licenseUrl;
    link.textContent = licenseLabel(card.licenseUrl);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    row.append(link, document.createTextNode(' · '));
    const original = document.createElement('a');
    original.href = source;
    original.textContent = 'Original: ' + card.publisher;
    original.target = '_blank';
    original.rel = 'noopener noreferrer';
    row.append(original);
    return row;
}
