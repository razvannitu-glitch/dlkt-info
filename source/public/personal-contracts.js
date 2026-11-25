import { isRecord } from './data-guards.js';
export const PERSONAL_LOCAL_VERSION = 'dlkt-personal-local-1';
export const LOCAL_NEEDS = Object.freeze([
    'weather', 'mobility', 'utilities', 'culture', 'administration', 'local-reporting',
]);
function isNeed(value) {
    return LOCAL_NEEDS.some(need => need === value);
}
export function parsePersonalLocalProfile(value) {
    if (!isRecord(value) || Object.keys(value).length !== 3
        || !Object.hasOwn(value, 'version') || !Object.hasOwn(value, 'cityId') || !Object.hasOwn(value, 'needs')
        || value.version !== PERSONAL_LOCAL_VERSION || typeof value.cityId !== 'string'
        || !/^\d{1,12}$/u.test(value.cityId) || !Array.isArray(value.needs)
        || value.needs.length > LOCAL_NEEDS.length || Object.keys(value.needs).length !== value.needs.length) {
        throw new Error('PERSONAL_LOCAL_PROFILE_INVALID');
    }
    const needs = [];
    for (let index = 0; index < value.needs.length; index++) {
        const need = value.needs[index];
        if (!Object.hasOwn(value.needs, index) || !isNeed(need))
            throw new Error('PERSONAL_LOCAL_PROFILE_INVALID');
        needs.push(need);
    }
    if (new Set(needs).size !== needs.length)
        throw new Error('PERSONAL_LOCAL_PROFILE_INVALID');
    return Object.freeze({ version: PERSONAL_LOCAL_VERSION, cityId: value.cityId, needs: Object.freeze(needs) });
}
