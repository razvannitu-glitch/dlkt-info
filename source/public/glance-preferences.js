import { DEFAULT_PREFERENCES, validPreferences } from './glance-contracts.js';
const KEY = 'dlkt-glance-preferences-1';
/** The accessor itself can throw when a browser denies storage. */
export function readPreferences(storage) {
    try {
        const raw = storage().getItem(KEY);
        if (raw && raw.length < 1000) {
            const v = JSON.parse(raw);
            if (validPreferences(v))
                return v;
        }
    }
    catch { /* Defaults remain usable without persistence. */ }
    return { ...DEFAULT_PREFERENCES };
}
export function savePreferences(value, storage) {
    if (!validPreferences(value))
        return false;
    try {
        storage().setItem(KEY, JSON.stringify(value));
        return true;
    }
    catch {
        return false;
    }
}
export function clearPreferences(storage) { try {
    storage().removeItem(KEY);
}
catch { /* Clearing still applies to this visit. */ } }
