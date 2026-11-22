import { LOCALES, resolveLocale, localeUrl, t, categoryLabel } from './i18n-locale.js';
import { PUBLIC_EDITORIAL_CATEGORIES } from './editorial-categories.js';
/** Presentation language is URL/browser state, never a change to a saved profile or a source record. */
export function getLocale() {
    return resolveLocale(typeof window === 'undefined' ? null : window.location.href, typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]);
}
export function translate(key, params) { return t(getLocale(), key, params); }
export function translatedCategory(category) { return categoryLabel(getLocale(), category); }
export function countryLabel(code, fallback = code) {
    if (!/^[A-Z]{2}$/u.test(code))
        return fallback;
    try {
        return new Intl.DisplayNames([getLocale()], { type: 'region', fallback: 'none' }).of(code) ?? fallback;
    }
    catch {
        return fallback;
    }
}
export function languageLabel(code) {
    try {
        return new Intl.DisplayNames([getLocale()], { type: 'language', fallback: 'none' }).of(code) ?? code;
    }
    catch {
        return code;
    }
}
/** Appearance stays in its own controller; translation changes only the action label. */
function applyAppearanceLabel() {
    const button = document.getElementById('reader-theme-toggle');
    if (!button)
        return;
    const key = document.documentElement.dataset.readerTheme === 'night' ? 'switchToLightMode' : 'switchToDarkMode';
    const label = translate(key);
    button.dataset.i18nLabel = key;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
}
/** Bind only explicitly marked interface nodes. Publisher wording is never traversed or replaced. */
export function applyInterfaceLanguage(root = document) {
    applyAppearanceLabel();
    for (const brand of root.querySelectorAll('.brand-header,.brand-footer')) {
        brand.lang = 'en';
        brand.dir = 'ltr';
        brand.setAttribute('translate', 'no');
    }
    for (const item of root.querySelectorAll('[data-i18n]')) {
        const key = item.dataset.i18n;
        if (key === 'photoArchiveLabel') {
            const year = item.dataset.i18nYear;
            if (year && /^(?:19|20)\d{2}$/u.test(year))
                item.textContent = translate(key, { year });
        }
        else if (key)
            item.textContent = translate(key);
    }
    for (const item of root.querySelectorAll('[data-i18n-label]')) {
        const key = item.dataset.i18nLabel;
        if (key)
            item.setAttribute('aria-label', translate(key));
    }
    for (const item of root.querySelectorAll('[data-i18n-placeholder]')) {
        const key = item.dataset.i18nPlaceholder;
        if (key)
            item.placeholder = translate(key);
    }
    // Existing native topic inputs retain their identity, selection and private persistence behavior.
    for (const input of root.querySelectorAll('input[name="topic"]')) {
        if (!PUBLIC_EDITORIAL_CATEGORIES.includes(input.value))
            continue;
        const span = input.parentElement?.querySelector('span');
        if (span)
            span.textContent = translatedCategory(input.value);
    }
}
export function setupLanguage() {
    const picker = document.getElementById('reader-language');
    if (!(picker instanceof HTMLSelectElement))
        throw Error('I18N_PICKER_MISSING');
    for (const locale of LOCALES) {
        const option = document.createElement('option');
        option.value = locale.code;
        option.lang = locale.code;
        option.dir = locale.direction;
        option.textContent = locale.nativeName;
        picker.append(option);
    }
    let applied = null;
    const apply = () => {
        const locale = getLocale(), definition = LOCALES.find(value => value.code === locale);
        if (!definition)
            throw Error('I18N_CATALOG_INVALID');
        document.documentElement.lang = locale;
        document.documentElement.dir = definition.direction;
        picker.value = locale;
        applyInterfaceLanguage();
        if (applied !== locale) {
            applied = locale;
            document.dispatchEvent(new CustomEvent('dlkt:language-changed', { detail: { locale } }));
        }
    };
    picker.addEventListener('change', () => {
        if (!LOCALES.some(value => value.code === picker.value))
            return;
        history.pushState(null, '', localeUrl(window.location.href, picker.value));
        apply();
    });
    window.addEventListener('popstate', apply);
    window.addEventListener('languagechange', apply);
    // Entry controllers may update contextual labels, but never the source content.
    document.addEventListener('dlkt:entry-view', () => applyInterfaceLanguage());
    document.addEventListener('dlkt:theme-changed', applyAppearanceLabel);
    apply();
}
