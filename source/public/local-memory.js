import { object, stamp, validLocalSnapshot } from './local-contracts.js';
const DB = 'dlkt-info-local-v1';
export function validMemory(v) { return object(v) && v.version === 1 && typeof v.revision === 'string' && /^[a-f0-9-]{36}$/u.test(v.revision) && typeof v.cityId === 'string' && stamp(v.savedAt) && validLocalSnapshot(v.snapshot, v.cityId); }
async function open() { return new Promise((resolve, reject) => { const request = indexedDB.open(DB, 1); request.onupgradeneeded = () => request.result.createObjectStore('place'); request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); }; request.onerror = () => reject(Error('LOCAL_STORAGE_UNAVAILABLE')); request.onblocked = () => reject(Error('LOCAL_STORAGE_BLOCKED')); }); }
export async function readLocalMemory() { const db = await open(); return new Promise((resolve, reject) => { const tx = db.transaction('place', 'readonly'), r = tx.objectStore('place').get('current'); let result = null; let invalid = false; r.onsuccess = () => { if (r.result !== undefined) {
    if (validMemory(r.result))
        result = r.result;
    else
        invalid = true;
} }; tx.oncomplete = () => { db.close(); invalid ? reject(Error('LOCAL_STORAGE_INVALID')) : resolve(result); }; tx.onabort = () => { db.close(); reject(Error('LOCAL_STORAGE_UNAVAILABLE')); }; }); }
export async function writeLocalMemory(value, expected) {
    if (value !== null && (!validLocalSnapshot(value, value.city.id) || value.state === 'unavailable'))
        throw Error('LOCAL_SNAPSHOT_INVALID');
    const next = value ? { version: 1, revision: crypto.randomUUID(), cityId: value.city.id, savedAt: new Date().toISOString(), snapshot: structuredClone(value) } : null;
    const db = await open();
    return new Promise((resolve, reject) => { const tx = db.transaction('place', 'readwrite'), store = tx.objectStore('place'), r = store.get('current'); let conflict = false; r.onsuccess = () => { const old = r.result; if (old !== undefined && !validMemory(old)) {
        tx.abort();
        return;
    } if ((validMemory(old) ? old.revision : null) !== expected) {
        conflict = true;
        tx.abort();
        return;
    } if (next)
        store.put(next, 'current');
    else
        store.delete('current'); }; tx.oncomplete = () => { db.close(); resolve(next); }; tx.onabort = () => { db.close(); reject(Error(conflict ? 'LOCAL_STORAGE_CONFLICT' : 'LOCAL_STORAGE_UNAVAILABLE')); }; });
}
/** Compare only overlapping forecast hours and still-present transport lines. Never infer a withdrawal. */
export function compareLocal(previous, current) {
    if (previous.city.id !== current.city.id)
        return [];
    const changes = [];
    const oldWeather = previous.cards.find(c => c.kind === 'forecast'), weather = current.cards.find(c => c.kind === 'forecast');
    if (oldWeather && weather) {
        const old = new Map(oldWeather.facts.map(f => [f.split(' | ')[0], f]));
        for (const f of weather.facts) {
            const before = old.get(f.split(' | ')[0]);
            if (before && before !== f)
                changes.push(`Forecast revised for the same hour. Before: ${before}. Now: ${f}.`);
        }
    }
    if (current.transportState === 'ready' && previous.transportState === 'ready') {
        for (const c of current.cards.filter(c => c.kind === 'transport')) {
            const before = previous.cards.find(o => o.id === c.id);
            if (before && (before.title !== c.title || before.text !== c.text))
                changes.push(`Operator report changed. Previously: ${before.title} — ${before.text}. Now: ${c.title} — ${c.text}.`);
            else if (!before)
                changes.push(`Not in your saved check: ${c.title}. This does not establish when the incident began.`);
        }
    }
    for (const c of current.cards.filter(c => c.context !== undefined)) {
        const before = previous.cards.find(o => o.id === c.id);
        if (before && (before.title !== c.title || before.text !== c.text || before.context?.when !== c.context?.when || JSON.stringify(before.facts) !== JSON.stringify(c.facts)))
            changes.push(`Local listing changed: ${c.title}. Previously: ${before.context?.when ?? before.title}. Now: ${c.context?.when ?? c.title}. Check the current source for its terms.`);
        else if (!before)
            changes.push(`New to your saved local check: ${c.title}. This does not establish when it was first published.`);
    }
    return changes;
}
