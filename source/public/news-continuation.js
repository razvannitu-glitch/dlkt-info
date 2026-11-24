import { validNewsPage, validNewsStorySourcesPage, NEWS_MAX_RESPONSE_BYTES } from './news-page-contracts.js';
import { readingCard } from './reader.js';
import { editorialCategory } from './editorial-categories.js';
import { storyThreadKey, romanianIncidentRecord, romanianIncidentThreadKey, printedLocalIncidentPlace } from './story-grouping.js';
const contextKey = (context) => JSON.stringify([context.language, context.cityId, context.city?.countryCode ?? null, context.city?.timezone ?? 'UTC', context.filter, context.period ?? 'recent', context.sourceScope ?? 'edition']);
const MAX_PAGE_BYTES = NEWS_MAX_RESPONSE_BYTES;
async function jsonBody(response, signal) {
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json'))
        throw Error('NEWS_PAGE_INVALID');
    const length = response.headers.get('content-length');
    if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_PAGE_BYTES))
        throw Error('NEWS_PAGE_INVALID');
    const reader = response.body?.getReader();
    if (!reader)
        throw Error('NEWS_PAGE_INVALID');
    const chunks = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => undefined); };
    signal.addEventListener('abort', cancel, { once: true });
    try {
        for (;;) {
            signal.throwIfAborted();
            const entry = await reader.read();
            if (entry.done)
                break;
            size += entry.value.byteLength;
            if (size > MAX_PAGE_BYTES) {
                await reader.cancel();
                throw Error('NEWS_PAGE_INVALID');
            }
            chunks.push(entry.value);
        }
        signal.throwIfAborted();
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }
    finally {
        signal.removeEventListener('abort', cancel);
        reader.releaseLock();
    }
}
function itemIdentity(item) {
    return item.kind === 'global' ? [item.card.id, item.card.identity, item.card.sourceUrl] : [item.card.id, item.card.sourceUrl, item.card.sourceUrl];
}
/** Reading memory is bounded like one corpus; aliases cannot grow without limit across refreshes. */
export const NEWS_READING_MAX_ITEMS = 5000;
export const NEWS_READING_MAX_KEYS = NEWS_READING_MAX_ITEMS * 8;
export const NEWS_REFRESH_MAX_PAGES = 3;
function originals(item) {
    const primary = item.kind === 'global' ? { kind: 'global', card: item.card } : { kind: 'local', card: item.card };
    return [primary, ...(item.story?.related ?? [])];
}
function completeIncidentThread(original) {
    if (original.kind === 'global')
        return romanianIncidentThreadKey(romanianIncidentRecord(original.card));
    const article = original.card.news;
    return original.card.kind === 'local-news' && article !== undefined && printedLocalIncidentPlace(article.title, article.geoAnchors)
        ? romanianIncidentThreadKey({ recordKey: 'local:' + original.card.id, title: article.title, date: article.publishedAt, countries: '' }) : null;
}
function originalReadingKeys(original) {
    const [id, identity, url] = itemIdentity(original), keys = ['id:' + id, 'identity:' + identity, 'url:' + url];
    // A singleton has no API story summary. Complete local and global identities
    // retain the same conservative event alias across publisher changes.
    const thread = original.kind === 'global' ? storyThreadKey(original.card) : completeIncidentThread(original);
    if (thread !== null)
        keys.push('thread:' + thread);
    return keys;
}
function readingKeys(item) {
    const keys = ['item:' + item.key], sources = originals(item), complete = sources.map(completeIncidentThread);
    if (item.story)
        keys.push('story:' + item.story.key);
    const incidents = [...new Set(complete.filter((thread) => thread !== null))], incident = incidents.length === 1 ? incidents[0] : null;
    const partialAliases = [];
    for (const [index, original] of sources.entries()) {
        const aliases = originalReadingKeys(original);
        keys.push(...aliases);
        if (incident !== null && complete[index] === null)
            partialAliases.push(...aliases);
    }
    if (incident !== null && complete[0] === null)
        partialAliases.push('item:' + item.key);
    return { aliases: keys, incident, partialAliases };
}
const incidentBound = (alias) => 'incident-bound:' + alias;
const incidentBinding = (incident, alias) => 'incident-binding:' + JSON.stringify([incident, alias]);
function eligibleReadingAlias(seen, reading, alias) {
    return seen.has(alias) && (reading.incident === null || !seen.has(incidentBound(alias))
        || seen.has(incidentBinding(reading.incident, alias)));
}
function knownReadingKeys(seen, reading) {
    return reading.aliases.some(alias => eligibleReadingAlias(seen, reading, alias));
}
function retainReadingKeys(seen, reading) {
    for (const alias of reading.aliases)
        seen.add(alias);
    // A missing detail may resolve differently in another edition. Its known URL,
    // ID or headline cannot carry reading memory into another explicit incident.
    // Retain one owner per partial alias; later retargets cannot grow a relation set.
    if (reading.incident !== null)
        for (const alias of reading.partialAliases)
            if (!seen.has(incidentBound(alias))) {
                seen.add(incidentBound(alias));
                seen.add(incidentBinding(reading.incident, alias));
            }
}
const NO_READING_UPDATES = Object.freeze([]);
function originalIdentity(source) {
    return source.kind === 'global' ? source.card.identity : source.card.sourceUrl;
}
/** Dates, check hashes and alternate URLs alone do not add publisher information. */
function originalInformation(source) {
    const card = source.card;
    return source.kind === 'global'
        ? JSON.stringify([card.publisher, card.title, source.card.summary ?? null, source.card.byline ?? null, source.card.licenseUrl ?? null])
        : JSON.stringify([card.publisher, card.title, source.card.news?.summary ?? source.card.text, source.card.news?.byline ?? null, source.card.news?.licenseUrl ?? null]);
}
/** Use only explicit event anchors already recognized by grouping. The wrapper's
 * publication window and a penalty's excerpt are not a different incident. */
function explicitReadingIncident(source) {
    const thread = source.kind === 'global' ? storyThreadKey(source.card) : completeIncidentThread(source);
    if (thread === null)
        return null;
    const wrapped = JSON.parse(thread);
    if (!Array.isArray(wrapped))
        return null;
    const anchor = wrapped[1] === 'window' && typeof wrapped[2] === 'string' ? JSON.parse(wrapped[2]) : wrapped;
    if (!Array.isArray(anchor))
        return null;
    if (anchor[1] === 'ro-explicit-incident')
        return JSON.stringify(anchor);
    if (anchor[1] === 'reported-penalty')
        return JSON.stringify(anchor.slice(0, -1));
    return null;
}
function readingOwner(owners, seen, reading) {
    let owner = null;
    for (const alias of reading.aliases) {
        if (!eligibleReadingAlias(seen, reading, alias))
            continue;
        const found = owners.get(alias);
        if (found === undefined || found === null)
            return null;
        if (owner !== null && found !== owner)
            return null;
        owner = found;
    }
    if (owner === null)
        return null;
    // A partial original reused for a different explicit incident cannot enrich
    // either owner merely because the new group also has a complete headline.
    for (const alias of reading.aliases)
        if (owners.has(alias) && owners.get(alias) !== owner)
            return null;
    return owner;
}
function retainReadingOwner(owners, seen, reading, owner) {
    for (const alias of reading.aliases) {
        const prior = owners.get(alias);
        // A new explicit incident may legitimately retain the same partial original.
        // Mark that ownership ambiguous without changing the existing dedup binding.
        if (owner !== null && prior !== undefined && prior !== owner) {
            owners.set(alias, null);
            continue;
        }
        if (!owners.has(alias) && eligibleReadingAlias(seen, reading, alias))
            owners.set(alias, owner);
    }
}
/** Fresh editions are validated independently; an explicit refresh preserves the reading prefix. */
export class NewsContinuation {
    fetcher;
    clock;
    changed;
    context = null;
    key = '';
    generation = 0;
    page = null;
    activePage = null;
    activeItems = [];
    items = [];
    seen = new Set();
    owners = new Map();
    novelty = new Map();
    updates = new Map();
    currentSources = new Map();
    updateUnits = 0;
    itemEditions = new Map();
    usedCursors = new Set();
    retainedCount = 0;
    manualContinuation = false;
    limitReached = false;
    freshStart = false;
    loading = false;
    error = null;
    controller = null;
    pending = null;
    constructor(fetcher = fetch, clock = Date.now, changed = () => { }) {
        this.fetcher = fetcher;
        this.clock = clock;
        this.changed = changed;
    }
    view() {
        const expired = this.error === 'expired' || this.activePage !== null && Date.parse(this.activePage.expiresAt) <= this.clock();
        return Object.freeze({ page: this.page, items: this.items, loading: this.loading,
            error: this.error ?? (expired ? 'expired' : null),
            initialized: this.context !== null, activeReceivedCount: this.activeItems.length, retainedCount: this.retainedCount,
            manualContinuation: this.manualContinuation, limitReached: this.limitReached,
            canContinue: this.context !== null && !this.limitReached && (expired || this.activePage?.nextCursor !== null) });
    }
    /** The original validated edition context, never the latest edition's source cursor context. */
    editionFor(key) { return this.itemEditions.get(key) ?? null; }
    /** Only meaningful checked changes; each keeps its own edition and source times. */
    updatesFor(key) { return this.updates.get(key) ?? NO_READING_UPDATES; }
    /** Fresh source access is independent of a change's historical receipt and notice. */
    currentSourcesFor(key) { return this.currentSources.get(key) ?? null; }
    start(context, restart = false) {
        const key = contextKey(context), same = this.key === key && this.context !== null;
        if (same && !restart)
            return this.pending ?? Promise.resolve();
        this.controller?.abort();
        this.generation++;
        this.context = Object.freeze({ ...context, sourceScope: context.sourceScope ?? 'edition' });
        this.key = key;
        if (!same) {
            this.page = null;
            this.items = Object.freeze([]);
            this.seen.clear();
            this.itemEditions.clear();
            this.owners.clear();
            this.novelty.clear();
            this.updates.clear();
            this.currentSources.clear();
            this.updateUnits = 0;
            this.limitReached = false;
        }
        this.retainedCount = same ? this.items.length : 0;
        this.activePage = null;
        this.activeItems = Object.freeze([]);
        this.usedCursors.clear();
        this.freshStart = restart;
        this.loading = false;
        this.error = null;
        this.pending = null;
        this.manualContinuation = false;
        return this.next();
    }
    /** Only the explicit reading-limit action discards same-context reading memory. */
    reset() {
        const context = this.context;
        if (context === null)
            return Promise.resolve();
        this.key = '';
        return this.start(context, true);
    }
    async next(recoverExpired = false) {
        if (this.loading)
            return this.pending ?? Promise.resolve();
        if (!this.context || this.limitReached)
            return;
        const expired = this.error === 'expired' || this.activePage !== null && Date.parse(this.activePage.expiresAt) <= this.clock();
        if (expired && !recoverExpired) {
            this.error = 'expired';
            this.changed();
            return;
        }
        if (!expired && this.activePage?.nextCursor === null)
            return;
        const generation = this.generation, context = this.context;
        const controller = new AbortController();
        this.controller = controller;
        this.loading = true;
        this.error = null;
        this.manualContinuation = false;
        let recovered = false;
        const recover = () => {
            if (!recoverExpired || recovered || generation !== this.generation)
                return false;
            recovered = true;
            this.retainedCount = this.items.length;
            this.activePage = null;
            this.activeItems = Object.freeze([]);
            this.usedCursors.clear();
            this.freshStart = true;
            return true;
        };
        if (expired)
            recover();
        // One bounded action, even when its first pages contain only previously shown reports.
        const timeout = setTimeout(() => controller.abort(), 12_000);
        const job = (async () => {
            try {
                for (let scanned = 0; scanned < NEWS_REFRESH_MAX_PAGES; scanned++) {
                    if (this.activePage && Date.parse(this.activePage.expiresAt) <= this.clock() && !recover()) {
                        this.error = 'expired';
                        this.manualContinuation = true;
                        return;
                    }
                    const cursor = this.activePage?.nextCursor ?? null;
                    if (cursor !== null && this.usedCursors.has(cursor))
                        throw Error('NEWS_PAGE_INVALID');
                    const query = new URLSearchParams({ lang: context.language, category: context.filter, period: context.period ?? 'recent', sourceScope: context.sourceScope ?? 'edition' });
                    if (context.cityId !== null)
                        query.set('city', context.cityId);
                    if (cursor !== null)
                        query.set('cursor', cursor);
                    const fetcher = this.fetcher;
                    const response = await fetcher('/api/news-page?' + query.toString(), { method: 'GET', credentials: 'omit', cache: cursor === null && !this.freshStart ? 'default' : 'no-store',
                        headers: { Accept: 'application/json' }, signal: controller.signal });
                    if (generation !== this.generation) {
                        await response.body?.cancel();
                        return;
                    }
                    if (response.status === 410 || response.status === 400 && cursor !== null) {
                        await response.body?.cancel();
                        if (generation !== this.generation)
                            return;
                        if (recover())
                            continue;
                        this.error = 'expired';
                        this.manualContinuation = true;
                        return;
                    }
                    if (!response.ok) {
                        await response.body?.cancel();
                        throw Error('NEWS_PAGE_UNAVAILABLE');
                    }
                    const value = await jsonBody(response, controller.signal);
                    if (generation !== this.generation)
                        return;
                    // An expired response is never accepted. At most one fresh cursor can be
                    // attempted within this same generation, timeout and three-request budget.
                    if (typeof value === 'object' && value !== null && 'expiresAt' in value && typeof value.expiresAt === 'string' && Date.parse(value.expiresAt) <= this.clock()) {
                        if (recover())
                            continue;
                        this.error = 'expired';
                        this.manualContinuation = true;
                        return;
                    }
                    if (!validNewsPage(value, this.clock(), context.city) || value.language !== context.language || value.cityId !== context.cityId || value.countryCode !== (context.city?.countryCode ?? null) || value.filter !== context.filter || value.period !== (context.period ?? 'recent') || (value.sourceScope ?? 'edition') !== (context.sourceScope ?? 'edition'))
                        throw Error('NEWS_PAGE_INVALID');
                    if (Date.parse(value.expiresAt) <= this.clock()) {
                        this.error = 'expired';
                        this.manualContinuation = true;
                        return;
                    }
                    const prior = this.activePage;
                    if (prior && (value.epoch !== prior.epoch || value.revision !== prior.revision || value.generatedAt !== prior.generatedAt || value.startedAt !== prior.startedAt
                        || value.period !== prior.period || (value.sourceScope ?? 'edition') !== (prior.sourceScope ?? 'edition') || JSON.stringify(value.day) !== JSON.stringify(prior.day)
                        || value.expiresAt !== prior.expiresAt || value.total !== prior.total || value.articleTotal !== prior.articleTotal || value.filteredTotal !== prior.filteredTotal || value.countryCode !== prior.countryCode
                        || value.coverage.national !== prior.coverage.national || value.coverage.local !== prior.coverage.local || value.coverage.international !== prior.coverage.international
                        || Object.keys(prior.counts).some(key => value.counts[key] !== prior.counts[key])))
                        throw Error('NEWS_PAGE_INVALID');
                    if (value.nextCursor !== null && (value.nextCursor === cursor || this.usedCursors.has(value.nextCursor) || value.items.length === 0))
                        throw Error('NEWS_PAGE_INVALID');
                    const ids = new Set(), identities = new Set(), urls = new Set(), keys = new Set(), stories = new Set();
                    const activeItems = Object.freeze([...this.activeItems, ...value.items]);
                    for (const item of activeItems) {
                        if (keys.has(item.key) || item.story && stories.has(item.story.key))
                            throw Error('NEWS_PAGE_INVALID');
                        keys.add(item.key);
                        if (item.story)
                            stories.add(item.story.key);
                        for (const original of originals(item)) {
                            const [id, identity, url] = itemIdentity(original);
                            if (ids.has(id) || identities.has(identity) || urls.has(url))
                                throw Error('NEWS_PAGE_INVALID');
                            ids.add(id);
                            identities.add(identity);
                            urls.add(url);
                        }
                    }
                    if (activeItems.length > value.filteredTotal || value.nextCursor === null && activeItems.length !== value.filteredTotal)
                        throw Error('NEWS_PAGE_INVALID');
                    if (value.nextCursor === null && value.filteredTotal === value.total && activeItems.reduce((sum, item) => sum + (item.story?.sourceTotal ?? 1), 0) !== value.articleTotal)
                        throw Error('NEWS_PAGE_INVALID');
                    // Stage aliases, ownership and updates together: invalid/late/over-budget
                    // pages cannot partially change the reading or its separately checked changes.
                    const seen = new Set(this.seen), owners = new Map(this.owners), novelty = new Map(this.novelty), updates = new Map(this.updates), currentSources = new Map(this.currentSources), additions = [];
                    let updateUnits = this.updateUnits;
                    // Store only the envelope, never an extra copy of every scanned page.
                    const edition = Object.freeze({ ...value, items: Object.freeze([]), nextCursor: null });
                    for (const item of value.items) {
                        const reading = readingKeys(item), known = knownReadingKeys(seen, reading), owner = known ? readingOwner(owners, seen, reading) : item.key;
                        if (!known)
                            additions.push(item);
                        let currentInformation = true;
                        if (owner !== null) {
                            const priorNovelty = novelty.get(owner), signatures = new Map(priorNovelty?.signatures), information = new Set([...signatures.values()].map(value => value.signature)), changes = [];
                            const sources = originals(item), sourceTotal = item.story?.sourceTotal ?? 1;
                            const incidents = [...new Set(sources.map(explicitReadingIncident).filter((incident) => incident !== null))];
                            // A stable original URL can be repurposed to a separately printed event.
                            // Preserve legacy prefix suppression, but never attach it to this owner.
                            if (priorNovelty !== undefined && (incidents.length > 1 || priorNovelty.incident !== null && incidents.some(incident => incident !== priorNovelty.incident)))
                                currentInformation = false;
                            for (const source of sources) {
                                if (!currentInformation)
                                    break;
                                const identity = originalIdentity(source), signature = originalInformation(source), previous = signatures.get(identity);
                                const checkedAt = Date.parse(source.kind === 'global' ? source.card.observedAt : source.card.checkedAt);
                                // A newer edition can still contain an older source snapshot. It must
                                // not undo a newer checked correction, nor teach aliases from that copy.
                                if (previous !== undefined && previous.signature !== signature && checkedAt <= previous.checkedAt) {
                                    currentInformation = false;
                                    break;
                                }
                                // Same publisher/content at an alternate URL is learned for future
                                // association, without pretending it is another substantive report.
                                if (priorNovelty !== undefined && previous?.signature !== signature && (previous !== undefined || !information.has(signature)))
                                    changes.push(source);
                                if (previous === undefined || checkedAt >= previous.checkedAt)
                                    signatures.set(identity, Object.freeze({ signature, checkedAt }));
                                information.add(signature);
                            }
                            if (currentInformation) {
                                const sourceCountIncreased = priorNovelty !== undefined && sourceTotal > priorNovelty.sourceTotal;
                                if (known && (changes.length > 0 || sourceCountIncreased)) {
                                    const update = Object.freeze({ item, edition, changes: Object.freeze(changes), sourceCountIncreased });
                                    updates.set(owner, Object.freeze([...(updates.get(owner) ?? NO_READING_UPDATES), update]));
                                    // Shared reading budget: a change costs one record plus each retained
                                    // preview original. No hidden unbounded history sits behind the cards.
                                    updateUnits += 1 + sources.length;
                                }
                                novelty.set(owner, Object.freeze({ signatures, sourceTotal: Math.max(priorNovelty?.sourceTotal ?? 0, sourceTotal), incident: priorNovelty?.incident ?? (incidents.length === 1 ? incidents[0] : null) }));
                                const priorSources = currentSources.get(owner);
                                if (priorSources === undefined || Date.parse(value.generatedAt) >= Date.parse(priorSources.edition.generatedAt)) {
                                    currentSources.set(owner, Object.freeze({ item, edition }));
                                }
                            }
                        }
                        if (currentInformation) {
                            retainReadingKeys(seen, reading);
                            retainReadingOwner(owners, seen, reading, owner);
                        }
                    }
                    if (this.items.length + additions.length + updateUnits > NEWS_READING_MAX_ITEMS || seen.size > NEWS_READING_MAX_KEYS) {
                        this.limitReached = true;
                        return;
                    }
                    for (const item of additions)
                        this.itemEditions.set(item.key, edition);
                    this.seen = seen;
                    this.owners = owners;
                    this.novelty = novelty;
                    this.updates = updates;
                    this.currentSources = currentSources;
                    this.updateUnits = updateUnits;
                    this.items = Object.freeze([...this.items, ...additions]);
                    this.activeItems = activeItems;
                    this.activePage = value;
                    this.page = value;
                    this.freshStart = false;
                    if (cursor !== null)
                        this.usedCursors.add(cursor);
                    this.limitReached = this.items.length + this.updateUnits >= NEWS_READING_MAX_ITEMS || seen.size >= NEWS_READING_MAX_KEYS;
                    if (additions.length > 0 || value.nextCursor === null || this.limitReached) {
                        if (recovered && additions.length === 0)
                            this.manualContinuation = true;
                        return;
                    }
                    if (scanned + 1 === NEWS_REFRESH_MAX_PAGES)
                        this.manualContinuation = true;
                }
                this.manualContinuation = true;
            }
            catch (error) {
                if (generation === this.generation)
                    this.error = error instanceof Error && error.message === 'NEWS_PAGE_INVALID' ? 'invalid' : 'unavailable';
            }
            finally {
                clearTimeout(timeout);
                if (generation === this.generation) {
                    this.loading = false;
                    this.pending = null;
                    this.controller = null;
                    this.changed();
                }
            }
        })();
        this.pending = job;
        this.changed();
        return job;
    }
}
export class NewsStorySourcesError extends Error {
    code;
    constructor(code) {
        super(code);
        this.code = code;
        this.name = 'NewsStorySourcesError';
    }
}
/** Bounded anonymous transport; the caller additionally checks edition, story, offset and prior identities. */
export async function fetchNewsStorySources(cursor, signal, city, fetcher = fetch, clock = Date.now) {
    if (typeof cursor !== 'string' || cursor.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/u.test(cursor) || signal.aborted)
        throw new NewsStorySourcesError('unavailable');
    const controller = new AbortController(), abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 12_000);
    try {
        const response = await fetcher('/api/news-page?' + new URLSearchParams({ sources: cursor }).toString(), { method: 'GET', credentials: 'omit', cache: 'no-store', headers: { Accept: 'application/json' }, signal: controller.signal });
        if (response.status === 410) {
            await response.body?.cancel();
            throw new NewsStorySourcesError('expired');
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new NewsStorySourcesError('unavailable');
        }
        const value = await jsonBody(response, controller.signal);
        if (!validNewsStorySourcesPage(value, clock(), city) || value.nextCursor === cursor)
            throw new NewsStorySourcesError('unavailable');
        return value;
    }
    catch (error) {
        if (error instanceof NewsStorySourcesError)
            throw error;
        throw new NewsStorySourcesError('unavailable');
    }
    finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
    }
}
/** Convert views only; the server already fixed categories and sequence for the entire edition. */
export function continuationItems(items, now) {
    return items.map(item => {
        if (item.kind === 'local')
            return { kind: 'local', card: item.card, key: item.key, category: item.category,
                url: item.card.sourceUrl, publisher: item.card.publisher, publishedAt: item.card.news.publishedAt, ...(item.story ? { story: item.story } : {}) };
        const card = item.card, category = editorialCategory(card), related = item.story?.related.flatMap(source => source.kind === 'global' ? [source.card] : []) ?? [];
        return { kind: 'global', key: item.key, category: item.category, url: card.sourceUrl, publisher: card.publisher, publishedAt: card.date, ...(item.story ? { story: item.story } : {}),
            view: { ...readingCard(card, now, related), reason: 'Original report in this checked news edition.', localMatch: false, grouping: item.story?.basis ?? 'single',
                storyKey: item.story?.key ?? 'article:' + card.identity, ...(category === null ? {} : { category }) } };
    });
}
