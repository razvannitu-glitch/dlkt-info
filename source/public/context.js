/** Reviewed exact country labels, not a place-name recognizer or an exhaustive gazetteer. */
const COUNTRY_NAMES = [
    ['AL', 'Albania'], ['AR', 'Argentina'], ['AT', 'Austria'], ['AU', 'Australia'], ['BA', 'Bosnia and Herzegovina'],
    ['BD', 'Bangladesh'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['BO', 'Bolivia'], ['BR', 'Brazil'], ['BY', 'Belarus'],
    ['CA', 'Canada'], ['CH', 'Switzerland'], ['CL', 'Chile'], ['CM', 'Cameroon'], ['CN', 'China'], ['CO', 'Colombia'],
    ['CU', 'Cuba'], ['CZ', 'Czechia'], ['DE', 'Germany'], ['DK', 'Denmark'], ['DO', 'Dominican Republic'],
    ['DZ', 'Algeria'], ['EC', 'Ecuador'], ['EG', 'Egypt'], ['ES', 'Spain'], ['ET', 'Ethiopia'], ['FI', 'Finland'],
    ['FR', 'France'], ['GB', 'United Kingdom'], ['GH', 'Ghana'], ['GR', 'Greece'], ['GT', 'Guatemala'],
    ['HR', 'Croatia'], ['HT', 'Haiti'], ['HU', 'Hungary'], ['ID', 'Indonesia'], ['IE', 'Ireland'], ['IL', 'Israel'],
    ['IN', 'India'], ['IQ', 'Iraq'], ['IR', 'Iran'], ['IS', 'Iceland'], ['IT', 'Italy'], ['JM', 'Jamaica'],
    ['JO', 'Jordan'], ['JP', 'Japan'], ['KE', 'Kenya'], ['KH', 'Cambodia'], ['KR', 'South Korea'], ['LB', 'Lebanon'],
    ['LK', 'Sri Lanka'], ['LT', 'Lithuania'], ['LV', 'Latvia'], ['MA', 'Morocco'], ['MD', 'Moldova'],
    ['MM', 'Myanmar'], ['MX', 'Mexico'], ['MY', 'Malaysia'], ['NG', 'Nigeria'], ['NL', 'Netherlands'],
    ['NO', 'Norway'], ['NP', 'Nepal'], ['NZ', 'New Zealand'], ['PE', 'Peru'], ['PH', 'Philippines'],
    ['PK', 'Pakistan'], ['PL', 'Poland'], ['PT', 'Portugal'], ['PY', 'Paraguay'], ['RO', 'Romania'],
    ['RS', 'Serbia'], ['RU', 'Russia'], ['SE', 'Sweden'], ['SG', 'Singapore'], ['SI', 'Slovenia'],
    ['SK', 'Slovakia'], ['SN', 'Senegal'], ['SY', 'Syria'], ['TH', 'Thailand'], ['TN', 'Tunisia'],
    ['TR', 'Turkey'], ['TZ', 'Tanzania'], ['UA', 'Ukraine'], ['UG', 'Uganda'], ['US', 'United States'],
    ['UY', 'Uruguay'], ['VE', 'Venezuela'], ['VN', 'Vietnam'], ['ZA', 'South Africa'], ['ZW', 'Zimbabwe'],
];
const countries = new Map(COUNTRY_NAMES.map(([code, name]) => [code, Object.freeze({ code, name })]));
const normalize = (value) => value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLowerCase();
const categoryCodes = new Map(COUNTRY_NAMES.map(([code, name]) => [normalize(name), code]));
// Only unambiguous complete aliases. Georgia, Congo, Korea, America and regional tags stay unknown.
for (const [label, code] of [['United States of America', 'US'], ['U.S.A.', 'US'], ['USA', 'US'], ['U.K.', 'GB'], ['UK', 'GB'], ['Czech Republic', 'CZ'], ['Türkiye', 'TR']])
    categoryCodes.set(normalize(label), code);
const categorySources = new Set(['gv-world', 'gv-culture']);
const CATEGORY_BOUNDARY = 'These are country categories supplied by the publisher. They describe coverage, not proof of the event location, personal impact or rules applying to you.';
const SCOPE_BOUNDARY = 'This is the declared scope of the publisher source, not an article-specific affected location or a statement that it applies to you.';
const UNSPECIFIED = Object.freeze({ countries: Object.freeze([]), basis: 'unspecified', label: 'Geographic context not specified', boundary: 'No supported article country category or geographic publisher scope is available. No location or personal impact is inferred from the title or publisher headquarters.' });
function scope(codes, label) {
    const values = codes.map(code => { const country = countries.get(code); if (!country)
        throw Error('CONTEXT_COUNTRY_UNSUPPORTED'); return country; });
    return Object.freeze({ countries: Object.freeze(values), basis: 'publisher-scope', label, boundary: SCOPE_BOUNDARY });
}
const UK_SCOPE = scope(['GB'], 'United Kingdom · publisher scope');
const sourceScopes = Object.freeze({
    'govuk-news': UK_SCOPE, 'govuk-products': UK_SCOPE, 'ncsc-news': UK_SCOPE, 'govuk-travel': UK_SCOPE,
    'sanews': scope(['ZA'], 'South Africa · government publisher scope'),
    'cbs-news': scope(['NL'], 'Netherlands · statistics publisher scope'),
    'beehive-news': scope(['NZ'], 'New Zealand · government publisher scope'),
    'fed-news': scope(['US'], 'United States · Federal Reserve scope'),
    'ftc-consumer': scope(['US'], 'United States · consumer protection scope'),
    'fda-food': scope(['US'], 'United States · food safety scope'),
    'ec-press': scope([], 'European Union · Commission publisher scope'),
    'eu-council': scope([], 'European Union · Council publisher scope'),
    'noaa-news': scope([], 'Weather, ocean and climate · NOAA scope'),
    'nist-news': scope([], 'Science, technology and standards · NIST scope'),
    'nsf-news': scope([], 'Science and research · NSF scope'),
    'scidev-news': scope([], 'Science and development · publisher scope'),
    '360-news': scope([], 'Research-based explanations · publisher scope'),
    'fda-news': scope(['US'], 'United States · publisher scope'),
    'eu-law': scope([], 'European Union · publisher scope'),
    'ecb-news': scope([], 'Euro area · publisher scope'),
    'ecb-statistics': scope([], 'Euro area · publisher scope'),
    'ecb-procurement': scope([], 'ECB procurement · publisher scope'),
    'nasa-news': scope([], 'Science and space · publisher scope'),
    'usgs-news': scope([], 'Earth science · publisher scope'),
    'eff-digital': scope([], 'Digital rights · publisher scope'),
    'nextjs': scope([], 'Software releases · publisher scope'),
    'nodejs': scope([], 'Software releases · publisher scope'),
});
const same = (left, right) => left.basis === right.basis && left.label === right.label && left.boundary === right.boundary && left.countries.length === right.countries.length && left.countries.every((country, index) => country.code === right.countries[index]?.code && country.name === right.countries[index]?.name);
function sourceScope(ids) {
    if (!ids.length)
        return UNSPECIFIED;
    const scopes = ids.map(id => Object.prototype.hasOwnProperty.call(sourceScopes, id) ? sourceScopes[id] : undefined), first = scopes[0];
    return first && scopes.every(value => value !== undefined && same(first, value)) ? first : UNSPECIFIED;
}
function categoryContext(values) {
    return Object.freeze({ countries: Object.freeze([...values]), basis: 'publisher-category', label: 'Publisher country categories · ' + values.map(country => country.name).join(', '), boundary: CATEGORY_BOUNDARY });
}
/** Accept only actual publisher category values; unknown/ambiguous/compound tags are ignored. */
export function contextFromPublisherCategories(sourceId, tags) {
    if (!categorySources.has(sourceId) || tags.length > 128)
        return undefined;
    const codes = new Set();
    for (const tag of tags) {
        if (typeof tag !== 'string' || tag.length > 160 || /[\u0000-\u001f\u007f<>]/u.test(tag))
            continue;
        const code = categoryCodes.get(normalize(tag));
        if (code)
            codes.add(code);
    }
    if (codes.size === 0 || codes.size > 8)
        return undefined;
    const values = [...codes].sort().flatMap(code => { const country = countries.get(code); return country ? [country] : []; });
    return categoryContext(values);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exact(value, keys) { return Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)); }
export function validArticleContext(value) {
    if (!object(value) || !exact(value, ['countries', 'basis', 'label', 'boundary']) || !Array.isArray(value.countries) || value.countries.length > 8 || typeof value.label !== 'string' || typeof value.boundary !== 'string')
        return false;
    let previous = '';
    const values = [];
    for (const item of value.countries) {
        if (!object(item) || !exact(item, ['code', 'name']) || typeof item.code !== 'string' || typeof item.name !== 'string')
            return false;
        const expected = countries.get(item.code);
        if (!expected || expected.name !== item.name || item.code <= previous)
            return false;
        previous = item.code;
        values.push(expected);
    }
    const basis = value.basis;
    if (basis !== 'publisher-category' && basis !== 'publisher-scope' && basis !== 'unspecified')
        return false;
    const candidate = { countries: values, basis, label: value.label, boundary: value.boundary };
    if (candidate.basis === 'publisher-category')
        return values.length > 0 && same(candidate, categoryContext(values));
    if (candidate.basis === 'publisher-scope')
        return Object.values(sourceScopes).some(expected => same(candidate, expected));
    return same(candidate, UNSPECIFIED);
}
/** Prevent a valid-looking category or source scope being attached to an unrelated publisher. */
export function validContextForCard(value, sourceIds) {
    if (!validArticleContext(value))
        return false;
    if (value.basis === 'publisher-category')
        return sourceIds.length > 0 && sourceIds.every(id => categorySources.has(id));
    return same(value, sourceScope(sourceIds));
}
/** Safe fallback also supports legacy cards with no stored context. Titles are never inspected. */
export function contextForCard(card) {
    return card.context !== undefined && validContextForCard(card.context, card.sourceIds) ? card.context : sourceScope(card.sourceIds);
}
