import { COMPARISON_MAX_AGE_MS, captureCheckpoint, compareFocusedCheckpoint, focusedSnapshot, parseCheckpoint } from './comparison.js';
import { classifyNotice } from './reader.js';
import { PUBLIC_TOPICS } from './topics.js';
import { hasEditorialTopics } from './editorial-topics.js';
import { sourceRelevantToTopics } from './source-relevance.js';
/** Derive a bounded return summary. The checkpoint is never mutated or advanced here. */
export function selectReturnBrief(input, snapshot, now, currentAvailable) {
    const empty = { state: 'setup', topics: [], savedAt: null, omittedLegacy: false, comparison: null, newCount: 0, updatedCount: 0, highlights: [], deadlines: [] };
    if (!input)
        return empty;
    const saved = parseCheckpoint(input);
    if (!saved)
        return { ...empty, state: 'invalid' };
    const savedTopics = saved.topics ?? PUBLIC_TOPICS.filter(topic => saved.records.some(card => card.topic === topic)
        || saved.sources.some(source => source.topic === topic && !hasEditorialTopics(source.id)));
    const hasTechnologyPublications = saved.records.some(card => card.topic === 'technology' && card.kind !== 'software-release')
        || saved.sources.some(source => source.topic === 'technology' && hasEditorialTopics(source.id));
    const topics = PUBLIC_TOPICS.filter(topic => savedTopics.includes(topic) && (topic !== 'technology' || hasTechnologyPublications));
    if (!topics.length)
        return { ...empty, state: 'invalid' };
    const omittedLegacy = saved.records.some(card => card.kind === 'software-release')
        || saved.sources.some(source => source.topic === 'technology' && !hasTechnologyPublications);
    const base = { ...empty, topics, savedAt: saved.savedAt, omittedLegacy, state: 'unavailable' };
    if (!snapshot || !currentAvailable)
        return base;
    try {
        const result = compareFocusedCheckpoint(saved, snapshot, topics, now);
        if (result.state === 'unavailable')
            return { ...base, comparison: result };
        const ordered = [...result.cards].sort((a, b) => b.card.date.localeCompare(a.card.date) || a.card.id.localeCompare(b.card.id));
        let deadlines = [];
        // Dates are shown only when every source in the selected current slice is fresh and coherent.
        try {
            const current = captureCheckpoint(focusedSnapshot(snapshot, topics), now, '11111111-1111-4111-8111-111111111111');
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
            const part = (type) => parts.find(p => p.type === type)?.value ?? '';
            const day = Date.parse(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`), end = new Date(day + 7 * 86400000).toISOString().slice(0, 10);
            deadlines = current.records.filter(c => { const state = classifyNotice(c, now); return (state === 'deadline-today' || state === 'deadline-ahead') && c.deadline !== null && c.deadline <= end; })
                .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? '') || a.id.localeCompare(b.id)).slice(0, 3);
        }
        catch { /* An incomplete fresh slice does not establish an upcoming-deadline list. */ }
        return { ...base, state: omittedLegacy ? 'partial' : result.state, comparison: result, newCount: result.cards.filter(c => c.kind === 'not-in-saved-check').length,
            updatedCount: result.cards.filter(c => c.kind === 'listing-updated').length, highlights: ordered.slice(0, 3), deadlines };
    }
    catch {
        return base;
    }
}
const publisherDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
/** Re-render at the exact freshness boundary or next publisher-region day; no network polling. */
export function nextReturnDelay(snapshot, topics, now) {
    if (!snapshot || !topics.length || !Number.isFinite(now))
        return null;
    const boundaries = snapshot.sources.filter(s => sourceRelevantToTopics(s, topics, snapshot.cards) && s.verifiedAt !== null)
        .map(s => Date.parse(s.verifiedAt ?? '') + COMPARISON_MAX_AGE_MS + 1).filter(t => Number.isFinite(t) && t > now);
    const day = publisherDay.format(now);
    let low = now + 1, high = now + 26 * 3600000;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (publisherDay.format(mid) === day)
            low = mid + 1;
        else
            high = mid;
    }
    return Math.max(1, Math.min(low, ...boundaries) - now);
}
