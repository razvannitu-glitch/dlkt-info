import { validInsight } from './insight-contracts.js';
import { validCard } from './card-validation.js';
import { validSettings } from './device-memory.js';
import { groupStories } from './story-grouping.js';
export const ARTIFACT_VERSION = 'dlkt-info-edition-artifact-1';
const obj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const instant = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/u.test(v) && Number.isFinite(Date.parse(v));
const hash = (v) => typeof v === 'string' && /^[a-f0-9]{64}$/u.test(v);
const count = (v) => Number.isSafeInteger(v) && Number(v) >= 0;
function validStoryGroups(value, primaries) {
    if (value === undefined)
        return true;
    if (!Array.isArray(value) || value.length > primaries.length)
        return false;
    const byId = new Map(primaries.map(card => [card.id, card])), primaryIds = new Set(), keys = new Set(), records = [...primaries];
    for (const group of value) {
        if (!obj(group) || Object.keys(group).some(key => !['key', 'primaryId', 'basis', 'related'].includes(key))
            || typeof group.key !== 'string' || !group.key.length || group.key.length > 24000 || keys.has(group.key)
            || typeof group.primaryId !== 'string' || primaryIds.has(group.primaryId)
            || !['matching-headlines', 'shared-event', 'software-versions'].includes(String(group.basis))
            || !Array.isArray(group.related) || group.related.length === 0 || group.related.length > 4999 || !group.related.every(validCard))
            return false;
        const primary = byId.get(group.primaryId);
        if (primary === undefined)
            return false;
        const members = [primary, ...group.related];
        if (group.basis === 'software-versions') {
            const product = (card) => card.kind !== 'software-release' ? null : card.sourceIds.includes('nodejs') ? 'nodejs' : card.sourceIds.includes('nextjs') ? 'nextjs' : null;
            const id = product(primary);
            if (id === null || group.key !== JSON.stringify(['software-versions', id]) || members.some(card => product(card) !== id))
                return false;
        }
        else {
            if (members.some(card => card.kind !== 'publication'))
                return false;
            const grouped = groupStories(members);
            const result = grouped[0];
            if (grouped.length !== 1 || result === undefined || result.key !== group.key || result.basis !== group.basis
                || result.card.id !== primary.id || result.related.length !== group.related.length)
                return false;
        }
        records.push(...group.related);
        if (records.length > 5000)
            return false;
        primaryIds.add(group.primaryId);
        keys.add(group.key);
    }
    if (groupStories(records.filter(card => card.kind === 'publication')).some(group => [group.card, ...group.related].filter(card => byId.has(card.id)).length > 1))
        return false;
    return new Set(records.map(card => card.id)).size === records.length
        && new Set(records.map(card => card.identity)).size === records.length
        && new Set(records.map(card => card.sourceUrl)).size === records.length;
}
/** Untrusted persisted/transported artifacts must be checked before rendering or sending. */
export function validArtifact(v) {
    if (!obj(v) || v.version !== ARTIFACT_VERSION || !hash(v.digest) || !obj(v.edition) || !Array.isArray(v.insights))
        return false;
    const e = v.edition;
    if (e.version !== 'dlkt-info-edition-1' || e.kind !== 'current-source-selection' || !hash(e.id) || !instant(e.generatedAt) || !instant(e.sourceCheckAt)
        || !['ready', 'partial', 'empty', 'unavailable'].includes(String(e.state)) || e.persisted !== false || e.delivered !== false
        || !validSettings(e.settings) || e.settings.mode !== 'briefing' || e.settings.topics.length === 0
        || !Array.isArray(e.cards) || e.cards.length > 5000 || e.cards.length > e.settings.budget || !e.cards.every(validCard)
        || new Set(e.cards.map(c => c.id)).size !== e.cards.length || e.cards.length !== v.insights.length
        || !count(e.availableGroups) || e.availableGroups < e.cards.length || !count(e.excludedNotices) || !count(e.excludedStale)
        || !Array.isArray(e.sourceChecks) || e.sourceChecks.length > 100 || !e.sourceChecks.every(s => obj(s) && typeof s.id === 'string' && s.id.length <= 80 && ['verified', 'partial', 'stale', 'unavailable'].includes(String(s.state)) && (s.verifiedAt === null || instant(s.verifiedAt))))
        return false;
    if ((e.state === 'unavailable' || e.state === 'empty') && e.cards.length !== 0)
        return false;
    if (e.state === 'ready' && e.cards.length === 0)
        return false;
    if (!validStoryGroups(e.storyGroups, e.cards))
        return false;
    const cards = e.cards, generatedAt = e.generatedAt;
    return v.insights.every((item, index) => {
        const card = cards[index];
        if (!card || !validInsight(item, card))
            return false;
        if (item.points.reduce((n, p) => n + p.text.length, 0) > 2000)
            return false;
        return Date.parse(item.checkedAt) <= Date.parse(generatedAt) + 300_000
            && (item.state !== 'ready' || Date.parse(item.checkedAt) >= Date.parse(generatedAt) - 3_600_000);
    });
}
/** This is the exact body covered by the transport fingerprint, not a digital signature. */
export function artifactBody(a) {
    return JSON.stringify({ version: a.version, edition: a.edition, insights: a.insights });
}
export async function verifyBrowserArtifact(value) {
    if (!validArtifact(value))
        return null;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(artifactBody(value))))).map(b => b.toString(16).padStart(2, '0')).join('');
    if (digest !== value.digest)
        return null;
    for (const insight of value.insights)
        for (const p of insight.points) {
            const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p.text)))).map(b => b.toString(16).padStart(2, '0')).join('');
            if (actual !== p.hash)
                return null;
        }
    return value;
}
