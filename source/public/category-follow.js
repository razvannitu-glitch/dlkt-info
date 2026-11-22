import { COMPARISON_MAX_AGE_MS, captureCheckpoint, compareCheckpoint, focusedSnapshot, parseCheckpoint } from './comparison.js';
import { EDITORIAL_CATEGORIES_VERSION, PUBLIC_EDITORIAL_CATEGORIES, editorialCategory, newsCategoryFromSourceId } from './editorial-categories.js';
import { PUBLIC_TOPICS } from './topics.js';
import { safeLink, validCard } from './card-validation.js';
export const CATEGORY_FOLLOW_KEY = 'dlkt-category-follow-v1';
export const CATEGORY_FOLLOW_VERSION = 'dlkt-category-follow-1';
const SKEW = 300_000;
const MAX_BYTES = 8_000_000;
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function stamp(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function integer(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function text(value, max = 4000) { return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value); }
export function validCategoryFollowRevision(value) { return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(value); }
export function isFollowCategory(value) { return typeof value === 'string' && PUBLIC_EDITORIAL_CATEGORIES.includes(value); }
/** Browser data is untrusted. Retain public checkpoint fields and exact editorial IDs only. */
export function parseCategoryFollows(value) {
    try {
        if (!object(value) || value.version !== CATEGORY_FOLLOW_VERSION || !validCategoryFollowRevision(value.revision) || !Array.isArray(value.entries) || value.entries.length > PUBLIC_EDITORIAL_CATEGORIES.length)
            return null;
        const entries = [];
        for (const raw of value.entries) {
            if (!object(raw) || !isFollowCategory(raw.category) || !stamp(raw.followedAt) || typeof raw.classifierVersion !== 'string'
                || !/^dlkt-public-editorial-categories-\d{1,4}$/u.test(raw.classifierVersion))
                return null;
            const baseline = raw.baseline === null ? null : parseCheckpoint(raw.baseline);
            if (raw.baseline !== null && !baseline)
                return null;
            const baselineConflictCount = Object.hasOwn(raw, 'baselineConflictCount') ? raw.baselineConflictCount : 0;
            if (!integer(baselineConflictCount) || !baseline && baselineConflictCount !== 0)
                return null;
            if (baseline && (Date.parse(baseline.savedAt) < Date.parse(raw.followedAt)
                || raw.classifierVersion === EDITORIAL_CATEGORIES_VERSION && baseline.records.some(card => editorialCategory(card) !== raw.category)))
                return null;
            entries.push({ category: raw.category, followedAt: raw.followedAt, classifierVersion: raw.classifierVersion, baselineConflictCount, baseline });
        }
        if (new Set(entries.map(entry => entry.category)).size !== entries.length)
            return null;
        entries.sort((left, right) => PUBLIC_EDITORIAL_CATEGORIES.indexOf(left.category) - PUBLIC_EDITORIAL_CATEGORIES.indexOf(right.category));
        const result = { version: CATEGORY_FOLLOW_VERSION, revision: value.revision, entries };
        return JSON.stringify(result).length <= MAX_BYTES ? result : null;
    }
    catch {
        return null;
    }
}
function stored(value) {
    const result = value === null ? null : parseCategoryFollows(value);
    if (value !== null && !result)
        throw Error('CATEGORY_FOLLOW_STORAGE_INVALID');
    return result;
}
function input(category, now, nextRevision) {
    if (!isFollowCategory(category) || !Number.isFinite(now) || !validCategoryFollowRevision(nextRevision))
        throw Error('CATEGORY_FOLLOW_DATA_INVALID');
}
function validHealth(value) {
    return object(value) && text(value.id, 80) && /^[a-z0-9-]+$/u.test(value.id) && text(value.label, 300) && text(value.publisher, 300)
        && PUBLIC_TOPICS.includes(value.topic) && ['verified', 'partial', 'stale', 'unavailable'].includes(String(value.state))
        && stamp(value.checkedAt) && (value.verifiedAt === null || stamp(value.verifiedAt)) && integer(value.count) && integer(value.rejected)
        && (value.error === null || text(value.error, 300)) && (value.retryAt === null || stamp(value.retryAt))
        && text(value.scope) && safeLink(value.termsUrl) !== null && typeof value.windowed === 'boolean';
}
/**
 * reconcile() has already quarantined conflicting identities from this public catalog.
 * Validate the whole retained catalog before selecting a category. Only the adapter's
 * internal conflict marker is zeroed; original health, errors, timestamps and counts
 * remain intact, and callers retain the global exclusion count as an explicit limit.
 */
function retainedCatalog(snapshot) {
    if (!object(snapshot) || !integer(snapshot.conflictCount) || !integer(snapshot.duplicateCount)
        || !['ready', 'partial', 'unavailable'].includes(snapshot.state) || snapshot.conflictCount > 0 && snapshot.state !== 'partial'
        || !text(snapshot.productVersion, 40) || !stamp(snapshot.generatedAt)
        || snapshot.deltaAvailable !== false || snapshot.scheduledDelivery !== false || snapshot.accountPersistence !== false
        || !Array.isArray(snapshot.sources) || !snapshot.sources.every(validHealth)
        || !Array.isArray(snapshot.cards) || !snapshot.cards.every(card => validCard(card) && card.sourceIds.length > 0 && card.sourceIds.length <= 100 && new Set(card.sourceIds).size === card.sourceIds.length)
        || !Array.isArray(snapshot.coverage) || snapshot.coverage.some(topic => !PUBLIC_TOPICS.includes(topic)) || new Set(snapshot.coverage).size !== snapshot.coverage.length)
        throw Error('CHECKPOINT_SOURCE_CHECK_REQUIRED');
    // Existing structural, unique identity, provenance and original count gates run
    // over ALL records/sources, not over a conveniently filtered category slice.
    return focusedSnapshot(snapshot.conflictCount === 0 ? snapshot : { ...snapshot, conflictCount: 0 }, PUBLIC_TOPICS);
}
/** Project only exact categories and established source IDs after full raw validation. */
function categorySnapshot(snapshot, category, previous) {
    const checked = retainedCatalog(snapshot);
    const cards = checked.cards.filter(card => editorialCategory(card) === category);
    const ids = new Set(cards.flatMap(card => [...card.sourceIds]));
    for (const source of previous?.sources ?? [])
        ids.add(source.id);
    const sources = checked.sources.filter(source => ids.has(source.id) || newsCategoryFromSourceId(source.id) === category)
        .map(source => ({ ...source, count: cards.filter(card => card.sourceIds.includes(source.id)).length }));
    const state = snapshot.state === 'unavailable' || !sources.some(source => (source.state === 'verified' || source.state === 'partial') && source.error === null)
        ? 'unavailable' : snapshot.conflictCount === 0 && sources.every(source => source.state === 'verified' && source.error === null && source.rejected === 0) ? 'ready' : 'partial';
    const coverage = PUBLIC_TOPICS.filter(topic => cards.some(card => card.topic === topic) || sources.some(source => source.topic === topic));
    return { ...checked, cards, sources, state, coverage };
}
function assertForward(previous, current, followedAt) {
    if (followedAt !== undefined && Date.parse(current.savedAt) < Date.parse(followedAt))
        throw Error('CATEGORY_FOLLOW_OLDER_OBSERVATION');
    if (!previous)
        return;
    if (Date.parse(current.savedAt) < Date.parse(previous.savedAt))
        throw Error('CATEGORY_FOLLOW_OLDER_OBSERVATION');
    for (const before of previous.sources) {
        const after = current.sources.find(source => source.id === before.id);
        if (!after)
            throw Error('CATEGORY_FOLLOW_SOURCE_CHECK_REQUIRED');
        if (Date.parse(after.observedAt) < Date.parse(before.observedAt))
            throw Error('CATEGORY_FOLLOW_OLDER_OBSERVATION');
    }
}
export function captureCategoryFollowBaseline(snapshot, category, now, nextRevision, previous = null) {
    input(category, now, nextRevision);
    const result = captureCheckpoint(categorySnapshot(snapshot, category, previous), now, nextRevision);
    assertForward(previous, result);
    return result;
}
function stateWith(entries, nextRevision) {
    const result = parseCategoryFollows({ version: CATEGORY_FOLLOW_VERSION, revision: nextRevision, entries });
    if (!result)
        throw Error('CATEGORY_FOLLOW_DATA_INVALID');
    return result;
}
/** An explicit follow can be remembered without pretending an unavailable check is a baseline. */
export function changeCategoryFollow(value, category, followed, snapshot, now, nextRevision) {
    input(category, now, nextRevision);
    if (typeof followed !== 'boolean')
        throw Error('CATEGORY_FOLLOW_DATA_INVALID');
    const prior = stored(value), existing = prior?.entries.find(entry => entry.category === category);
    if (Boolean(existing) === followed)
        return { state: prior, changed: false };
    if (!followed)
        return { state: stateWith((prior?.entries ?? []).filter(entry => entry.category !== category), nextRevision), changed: true };
    let baseline = null;
    if (snapshot)
        try {
            baseline = captureCategoryFollowBaseline(snapshot, category, now, nextRevision);
        }
        catch { /* The follow remains explicit; a usable baseline is a separate visible state. */ }
    const entry = { category, followedAt: new Date(now).toISOString(), classifierVersion: EDITORIAL_CATEGORIES_VERSION, baselineConflictCount: baseline && snapshot ? snapshot.conflictCount : 0, baseline };
    return { state: stateWith([...(prior?.entries ?? []), entry], nextRevision), changed: true };
}
/** Advance one category only after an explicit acknowledgement of a fresh, coherent check. */
export function acknowledgeCategoryFollow(value, category, snapshot, now, nextRevision) {
    input(category, now, nextRevision);
    const prior = stored(value), entry = prior?.entries.find(item => item.category === category);
    if (!prior || !entry)
        throw Error('CATEGORY_FOLLOW_NOT_FOLLOWED');
    const baseline = captureCategoryFollowBaseline(snapshot, category, now, nextRevision, entry.baseline);
    assertForward(entry.baseline, baseline, entry.followedAt);
    return stateWith(prior.entries.map(item => item.category === category ? { ...item, baseline, baselineConflictCount: snapshot.conflictCount, classifierVersion: EDITORIAL_CATEGORIES_VERSION } : item), nextRevision);
}
function expired(source, now) {
    return source.state === 'stale' || stamp(source.verifiedAt) && Date.parse(source.verifiedAt) <= now && now - Date.parse(source.verifiedAt) > COMPARISON_MAX_AGE_MS;
}
function categoryReturn(entry, snapshot, now, currentAvailable) {
    let canAcknowledge = false, projected = null, currentConflictCount = 0;
    if (snapshot && currentAvailable)
        try {
            projected = categorySnapshot(snapshot, entry.category, entry.baseline);
            currentConflictCount = snapshot.conflictCount;
            const candidate = captureCheckpoint(projected, now, '11111111-1111-4111-8111-111111111111');
            assertForward(entry.baseline, candidate, entry.followedAt);
            canAcknowledge = true;
        }
        catch { /* Availability is derived; this never writes a replacement. */ }
    const excludedConflicts = entry.baselineConflictCount > 0 || currentConflictCount > 0;
    const base = { category: entry.category, state: 'unavailable', savedAt: entry.baseline?.savedAt ?? null, comparison: null, newCount: 0, updatedCount: 0, cards: [], canAcknowledge: false, excludedConflicts };
    if (!entry.baseline || entry.classifierVersion !== EDITORIAL_CATEGORIES_VERSION)
        return { ...base, state: 'baseline-required', canAcknowledge };
    if (!projected || !currentAvailable)
        return base;
    try {
        const raw = compareCheckpoint(entry.baseline, projected, now);
        const comparison = raw.state !== 'unavailable' && excludedConflicts
            ? { ...raw, state: 'partial', notes: [...raw.notes, 'Conflicting records were excluded from a source snapshot. Their affected sources or categories are not identified; only retained validated listings are compared.'] } : raw;
        const state = comparison.state === 'unavailable' && projected.sources.length > 0 && projected.sources.every(source => expired(source, now)) ? 'stale' : comparison.state;
        const cards = [...comparison.cards].sort((left, right) => right.card.date.localeCompare(left.card.date) || left.card.id.localeCompare(right.card.id));
        return { ...base, state, comparison, cards, canAcknowledge, newCount: cards.filter(item => item.kind === 'not-in-saved-check').length, updatedCount: cards.filter(item => item.kind === 'listing-updated').length };
    }
    catch {
        return base;
    }
}
/** Pure return projection. Reloads, timer expiry and reading never acknowledge changes. */
export function selectCategoryFollowReturn(value, snapshot, now, currentAvailable) {
    const empty = { state: 'empty', items: [], newCount: 0, updatedCount: 0, highlights: [], excludedConflicts: false };
    const saved = value === null ? null : parseCategoryFollows(value);
    if (value !== null && !saved)
        return { ...empty, state: 'invalid' };
    if (!saved?.entries.length)
        return empty;
    const items = saved.entries.map(entry => categoryReturn(entry, snapshot, now, currentAvailable));
    const state = items.every(item => item.state === 'complete') ? 'complete'
        : items.some(item => item.state === 'complete' || item.state === 'partial') ? 'partial'
            : items.every(item => item.state === 'baseline-required') ? 'baseline-required' : items.every(item => item.state === 'stale') ? 'stale' : 'unavailable';
    const highlights = items.flatMap(item => item.cards.map(card => ({ ...card, category: item.category })))
        .sort((left, right) => right.card.date.localeCompare(left.card.date) || left.card.id.localeCompare(right.card.id)).slice(0, 6);
    return { state, items, newCount: items.reduce((sum, item) => sum + item.newCount, 0), updatedCount: items.reduce((sum, item) => sum + item.updatedCount, 0), highlights, excludedConflicts: items.some(item => item.excludedConflicts) };
}
/** A deadline for the existing render timer, never a new timer or source request. */
export function nextCategoryFollowDelay(value, snapshot, now) {
    const saved = value === null ? null : parseCategoryFollows(value);
    if (!saved?.entries.length || !snapshot || !Number.isFinite(now))
        return null;
    const boundaries = [];
    for (const entry of saved.entries)
        try {
            for (const source of categorySnapshot(snapshot, entry.category, entry.baseline).sources) {
                if (!stamp(source.verifiedAt) || Date.parse(source.verifiedAt) > now + SKEW)
                    continue;
                const end = Date.parse(source.verifiedAt) + COMPARISON_MAX_AGE_MS + 1;
                if (end > now)
                    boundaries.push(end);
            }
        }
        catch { /* Invalid or unavailable projections do not schedule fresh-state claims. */ }
    return boundaries.length ? Math.max(1, Math.min(...boundaries) - now) : null;
}
