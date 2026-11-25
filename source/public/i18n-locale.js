import { LOCALES, MESSAGES, CATEGORY_LABELS, messageParameters } from './i18n-catalog.js';
export { LOCALES } from './i18n-catalog.js';
const supported = new Set(LOCALES.map(value => value.code));
const rtl = new Set(LOCALES.filter(value => value.direction === 'rtl').map(value => value.code));
const aliases = Object.freeze({ tl: 'fil', iw: 'he', in: 'id' });
const copyUrl = (input) => {
    const url = new URL(input instanceof URL ? input.href : input, 'https://locale.invalid/');
    if (!['http:', 'https:'].includes(url.protocol))
        throw Error('I18N_URL_INVALID');
    return url;
};
/** Canonical BCP47 negotiation against the shipped catalog, never a dynamic module/import path. */
function canonicalLocale(input) {
    if (typeof input !== 'string' || input.length > 80 || !/^[a-z]{2,3}(?:-[a-z0-9]{1,8})*$/iu.test(input))
        return null;
    try {
        const value = new Intl.Locale(input), language = aliases[value.language] ?? value.language;
        const candidate = language === 'zh'
            ? value.script === 'Hant' ? 'zh-Hant' : value.script === 'Hans' ? 'zh-Hans' : ['TW', 'HK', 'MO'].includes(value.region ?? '') ? 'zh-Hant' : 'zh-Hans'
            : language;
        return supported.has(candidate) ? candidate : null;
    }
    catch {
        return null;
    }
}
/** Only exact catalog codes written by the language picker are persistent preferences. */
export function localeFromPreference(input) {
    return typeof input === 'string' && supported.has(input) ? input : null;
}
// Browser preferences resolve supported choices in multilingual countries. The default
// otherwise comes from the platform's CLDR likely-subtag data, not an inferred user profile.
const countryAlternatives = Object.freeze({
    BE: ['nl', 'fr', 'de'], CA: ['en', 'fr'], CH: ['de', 'fr', 'it'], CM: ['fr', 'en'],
    CY: ['tr'], DZ: ['ar', 'fr'], HK: ['zh-Hant', 'en'], IE: ['en'], IL: ['he', 'ar'],
    IN: ['hi', 'en', 'bn', 'ta', 'te', 'ur'], KE: ['sw', 'en'], LK: ['ta', 'en'], LU: ['fr', 'de'],
    MA: ['ar', 'fr'], MO: ['zh-Hant', 'pt'], MT: ['en'], MU: ['en', 'fr'],
    MY: ['ms', 'en', 'zh-Hans', 'ta'], PH: ['fil', 'en'], PK: ['ur', 'en'],
    SG: ['en', 'ms', 'zh-Hans', 'ta'], TN: ['ar', 'fr'], TZ: ['sw', 'en'], UG: ['en', 'sw'], ZA: ['en'],
});
/** A supported country default precedes browser fallback; unknown or unshipped defaults do not. */
export function localeFromCountry(input, navigatorLanguages = []) {
    if (typeof input !== 'string' || !/^[A-Z]{2}$/u.test(input) || input === 'ZZ')
        return null;
    try {
        if (new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' }).of(input) === undefined)
            return null;
    }
    catch {
        return null;
    }
    const alternatives = Object.hasOwn(countryAlternatives, input) ? countryAlternatives[input] : undefined;
    if (alternatives) {
        for (const language of navigatorLanguages.slice(0, 32)) {
            const locale = canonicalLocale(language);
            if (locale && alternatives.includes(locale))
                return locale;
        }
    }
    if (input === 'HK' || input === 'MO')
        return 'zh-Hant';
    try {
        return canonicalLocale(new Intl.Locale('und-' + input).maximize().toString());
    }
    catch {
        return null;
    }
}
/** Duplicate/invalid URL values never select an arbitrary first language. Hash contents are ignored. */
export function localeFromUrl(input) {
    try {
        const values = copyUrl(input).searchParams.getAll('lang');
        return values.length === 1 ? canonicalLocale(values[0]) : null;
    }
    catch {
        return null;
    }
}
/** Explicit saved/manual preference > entry URL > current country > browser > English. */
export function resolveLocale(explicit, navigatorLanguages = [], context = {}) {
    const manual = localeFromPreference(context.manualLocale);
    if (manual)
        return manual;
    if (explicit !== null && explicit !== undefined) {
        const isUrl = explicit instanceof URL || /[:/?#]/u.test(explicit);
        if (!isUrl)
            return canonicalLocale(explicit) ?? 'en';
        try {
            const url = copyUrl(explicit);
            if (url.searchParams.has('lang'))
                return localeFromUrl(url) ?? 'en';
        }
        catch {
            return 'en';
        }
    }
    const country = localeFromCountry(context.countryCode, navigatorLanguages);
    if (country)
        return country;
    for (const language of navigatorLanguages.slice(0, 32)) {
        const locale = canonicalLocale(language);
        if (locale)
            return locale;
    }
    return 'en';
}
/** Preserve all other query parameters and the hash; never mutate the caller's URL object. */
export function localeUrl(input, locale) {
    if (!supported.has(locale))
        throw Error('I18N_LOCALE_INVALID');
    const url = copyUrl(input);
    url.searchParams.delete('lang');
    url.searchParams.set('lang', locale);
    if (input instanceof URL || /^[a-z][a-z\d+.-]*:/iu.test(input))
        return url.href;
    if (input.startsWith('//'))
        return '//' + url.host + url.pathname + url.search + url.hash;
    if (input.startsWith('?') || input.startsWith('#'))
        return url.search + url.hash;
    return (input.startsWith('/') ? url.pathname : url.pathname.slice(1)) + url.search + url.hash;
}
/** UI-only plain text. No article transformation, markup evaluation, storage or network side effect. */
export function t(locale, key, params = {}) {
    if (!supported.has(locale))
        throw Error('I18N_LOCALE_INVALID');
    const dictionary = MESSAGES[locale];
    if (!Object.hasOwn(dictionary, key))
        throw Error('I18N_MESSAGE_INVALID');
    const template = dictionary[key], required = messageParameters(template), provided = Object.keys(params).sort();
    if (JSON.stringify([...new Set(required)]) !== JSON.stringify(provided))
        throw Error('I18N_PARAMETERS_INVALID:' + key);
    return template.replace(/\{([a-z][a-zA-Z]*)\}/gu, (_match, name) => {
        const value = params[name];
        if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value)))
            throw Error('I18N_PARAMETER_VALUE_INVALID');
        const text = typeof value === 'number' ? new Intl.NumberFormat(locale).format(value) : value;
        // Isolate substituted names/numbers within RTL sentences. Original records are not rewritten.
        return rtl.has(locale) ? '\u2068' + text.replace(/[\u202a-\u202e\u2066-\u2069]/gu, '') + '\u2069' : text;
    });
}
export function categoryLabel(locale, category) {
    if (!supported.has(locale))
        throw Error('I18N_LOCALE_INVALID');
    if (!Object.hasOwn(CATEGORY_LABELS[locale], category))
        throw Error('I18N_CATEGORY_INVALID');
    return CATEGORY_LABELS[locale][category];
}
