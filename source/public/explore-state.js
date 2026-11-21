import { PUBLIC_EDITORIAL_CATEGORIES } from './editorial-categories.js';
import { validCity } from './local-contracts.js';
export const EMPTY_EXPLORE_STATE = Object.freeze({ active: false, cityId: null, countryCode: null, category: null });
const OWNED_PARAMETERS = ['explore', 'city', 'country', 'category'];
const CITY_ID = /^[1-9]\d{0,11}$/u;
const COUNTRY_CODE = /^[A-Z]{2}$/u;
const categoryValid = (value) => typeof value === 'string' && PUBLIC_EDITORIAL_CATEGORIES.some(category => category === value);
const one = (params, key) => params.getAll(key).length === 1 ? params.get(key) : null;
const copyUrl = (input) => new URL(input instanceof URL ? input.href : input, 'https://explore.invalid/');
function checked(state) {
    if (typeof state.active !== 'boolean' || state.cityId !== null && !CITY_ID.test(state.cityId)
        || state.countryCode !== null && !COUNTRY_CODE.test(state.countryCode)
        || state.category !== null && !categoryValid(state.category))
        throw Error('EXPLORE_STATE_INVALID');
    return Object.freeze({ ...state });
}
/** Invalid or repeated optional values are ignored, never passed to an API or storage. */
export function parseExploreState(input) {
    let url;
    try {
        url = copyUrl(input);
    }
    catch {
        return EMPTY_EXPLORE_STATE;
    }
    if (one(url.searchParams, 'explore') !== '1')
        return EMPTY_EXPLORE_STATE;
    const city = one(url.searchParams, 'city'), country = one(url.searchParams, 'country'), category = one(url.searchParams, 'category');
    return Object.freeze({ active: true, cityId: city !== null && CITY_ID.test(city) ? city : null,
        countryCode: country !== null && /^[A-Za-z]{2}$/u.test(country) ? country.toUpperCase() : null,
        category: categoryValid(category) ? category : null });
}
/** Change only Explore's four parameters; retain unrelated parameters, duplicates and hash. */
export function exploreUrl(input, state) {
    checked(state);
    const url = copyUrl(input);
    for (const key of OWNED_PARAMETERS)
        url.searchParams.delete(key);
    if (state.active) {
        url.searchParams.set('explore', '1');
        if (state.cityId !== null)
            url.searchParams.set('city', state.cityId);
        if (state.countryCode !== null)
            url.searchParams.set('country', state.countryCode);
        if (state.category !== null)
            url.searchParams.set('category', state.category);
    }
    if (input instanceof URL || /^[a-z][a-z\d+.-]*:/iu.test(input))
        return url.href;
    if (input.startsWith('//'))
        return '//' + url.host + url.pathname + url.search + url.hash;
    if (input.startsWith('?') || input.startsWith('#'))
        return url.search + url.hash;
    return (input.startsWith('/') ? url.pathname : url.pathname.slice(1)) + url.search + url.hash;
}
/** Switching places preserves the selected editorial category. Clearing a city keeps its country. */
export function selectExploreCity(state, city) {
    checked(state);
    if (city !== null && !validCity(city))
        throw Error('EXPLORE_CITY_INVALID');
    return checked({ ...state, active: true, cityId: city?.id ?? null, countryCode: city?.countryCode ?? state.countryCode });
}
/** Country selection deliberately leaves city mode; null selects the connected worldwide corpus. */
export function selectExploreCountry(state, countryCode) {
    checked(state);
    if (countryCode !== null && !/^[A-Za-z]{2}$/u.test(countryCode))
        throw Error('EXPLORE_STATE_INVALID');
    return checked({ ...state, active: true, cityId: null, countryCode: countryCode?.toUpperCase() ?? null });
}
export function selectExploreCategory(state, category) {
    checked(state);
    return checked({ ...state, active: true, category });
}
