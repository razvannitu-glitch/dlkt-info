import { parseFocus, parseSaved } from './device-memory.js';
import { parseCheckpoint } from './comparison.js';
export const ACCOUNT_VERSION = 'dlkt-info-reader-account-1';
export const ACCOUNT_MEMORY_KEY = 'reader-account-v1';
export const ACCOUNT_MAX_BYTES = 2_097_152;
export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const isRevision = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(v);
export function parseAccountValue(v) {
    if (!isObject(v) || Object.keys(v).sort().join(',') !== 'cards,checkpoint,focus' || !Array.isArray(v.cards))
        throw Error('ACCOUNT_VALUE_INVALID');
    const focus = v.focus === null ? null : parseFocus(v.focus), checkpoint = v.checkpoint === null ? null : parseCheckpoint(v.checkpoint);
    if ((v.focus !== null && !focus) || (v.checkpoint !== null && !checkpoint))
        throw Error('ACCOUNT_VALUE_INVALID');
    const cards = [];
    const ids = new Set();
    for (const raw of v.cards) {
        const card = parseSaved(raw);
        if (!card || ids.has(card.id))
            throw Error('ACCOUNT_VALUE_INVALID');
        ids.add(card.id);
        cards.push(card);
    }
    const value = { focus, cards, checkpoint };
    if (new TextEncoder().encode(JSON.stringify(value)).byteLength > ACCOUNT_MAX_BYTES)
        throw Error('ACCOUNT_VALUE_TOO_LARGE');
    return value;
}
export function parseAccountState(v) {
    if (!isObject(v) || v.version !== ACCOUNT_VERSION || !isRevision(v.revision) || typeof v.updatedAt !== 'string' || !Number.isFinite(Date.parse(v.updatedAt)))
        throw Error('ACCOUNT_STATE_INVALID');
    return { version: ACCOUNT_VERSION, revision: v.revision, updatedAt: v.updatedAt, value: parseAccountValue(v.value) };
}
