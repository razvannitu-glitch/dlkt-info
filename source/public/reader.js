import { compareDailyUse } from './card-guide.js';
import { PUBLIC_TOPICS } from './topics.js';
import { COMPARISON_MAX_AGE_MS } from './comparison.js';
import { groupStories } from './story-grouping.js';
/** Presentation rules use explicit source metadata, never inferred document contents. */
export const READER_VERSION = 'iceo-reader-1';
const TOPICS = PUBLIC_TOPICS;
export const normalizeFocus = (value) => value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim();
function euroDay(now) {
    if (!Number.isFinite(now))
        throw new Error('READER_CLOCK_INVALID');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const get = (type) => parts.find(part => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}
function validDay(value) {
    return value !== null && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function classifyNotice(card, now) {
    if (card.kind !== 'procurement-notice')
        return 'not-applicable';
    const title = normalizeFocus(card.title);
    // Notice type takes precedence over copied or stale date fields.
    if (/^(?:procurement\s+)?contract\s+award\s+notice\b/u.test(title))
        return 'awarded';
    if (/^(?:contract\s+notice:\s*)?(?:(?:contract|procurement)\s+)?(?:cancellation|cancelled|canceled)\b/u.test(title))
        return 'cancelled';
    if (!validDay(card.deadline))
        return 'unconfirmed';
    const today = euroDay(now);
    if (card.deadline < today)
        return 'expired';
    if (!/^contract\s+notice\b/u.test(title) || card.sourceState === 'stale')
        return 'unconfirmed';
    return card.deadline === today ? 'deadline-today' : 'deadline-ahead';
}
export function isConsolidated(card) {
    return card.kind === 'legal-document' && /^celex:0\d{4}[A-Z]\d{4}-\d{8}$/u.test(card.identity);
}
function shortTitle(title) {
    if (title.length <= 160)
        return { value: title, shortened: false };
    const prefix = title.slice(0, 157);
    const boundary = prefix.lastIndexOf(' ');
    return { value: `${prefix.slice(0, boundary > 95 ? boundary : 157)}…`, shortened: true };
}
export function readingCard(card, now, related = []) {
    const title = shortTitle(card.title);
    const noticeState = classifyNotice(card, now);
    let heading = title.value, shortened = title.shortened, label = 'Publisher update', dateLabel = card.dateLabel;
    let context = 'Read the original publication for its findings and scope. This card is based on the publisher listing, not a full-document summary.';
    if (card.summary !== undefined) {
        context = card.summary;
        label = 'Publisher excerpt';
    }
    if (card.kind === 'software-release') {
        const product = card.sourceIds.includes('nodejs') ? 'Node.js' : card.sourceIds.includes('nextjs') ? 'Next.js' : card.publisher;
        heading = `${product} ${card.version ?? ''}`.trim();
        shortened = heading !== card.title;
        label = 'Software release';
        context = `A non-prerelease version listed by the ${product} maintainers. Check release notes and compatibility before updating.`;
    }
    else if (card.kind === 'legal-document') {
        label = isConsolidated(card) ? 'Consolidated text' : 'EU legal document';
        if (isConsolidated(card)) {
            dateLabel = card.identity.slice(-8) === card.date.slice(0, 10).replaceAll('-', '') ? 'Consolidation date' : 'Document date';
            context = 'An updated consolidated version of an existing act. This does not mean a new law was adopted on the date shown.';
        }
        else
            context = 'An EU legal document listing. The document date alone does not establish when it was published, adopted or took effect.';
    }
    else if (card.kind === 'procurement-notice') {
        const states = {
            awarded: ['Contract awarded', 'An award notice, not an invitation to apply. Kept for market research and supplier intelligence.'],
            cancelled: ['Cancellation notice', 'The title identifies a cancelled procedure. Do not treat this as an open application.'],
            expired: ['Deadline passed', 'The listed deadline has passed. No current application window is established by this record.'],
            'deadline-today': ['Deadline today · confirm status', 'The listed closing date is today in the publisher region. Confirm the exact time, eligibility and current procedure status in the notice.'],
            'deadline-ahead': ['Future deadline · confirm status', 'The contract notice lists a future deadline. Confirm the current procedure status and eligibility before applying.'],
            unconfirmed: ['Application status unconfirmed', 'The available metadata does not establish an active application window. Check the original notice.'],
        };
        const wording = states[noticeState === 'not-applicable' ? 'unconfirmed' : noticeState];
        label = wording[0];
        context = wording[1];
    }
    return Object.freeze({ card, related: Object.freeze([...related]), heading, context, label, dateLabel, shortened, noticeState });
}
/** Saved originals are an archive, not a current feed: grouping never erases a copy. */
export function savedReadingCards(records, now) {
    if (!Number.isFinite(now) || records.length > 5000)
        throw Error('SAVED_READING_INPUT_INVALID');
    const positions = new Map();
    records.forEach((card, index) => { if (!positions.has(card))
        positions.set(card, index); });
    const groups = groupStories(records, (a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
    const included = new Map(), views = [];
    const archived = (card) => Object.freeze({ ...card, sourceState: 'stale' });
    for (const group of groups) {
        for (const card of [group.card, ...group.related])
            included.set(card, (included.get(card) ?? 0) + 1);
        views.push({ position: positions.get(group.card) ?? 0, view: Object.freeze({ ...readingCard(archived(group.card), now, group.related.map(archived)), storyKey: group.key, grouping: group.basis }) });
    }
    // Conflicting or repeated archive entries are not evidence to merge, but they
    // remain the reader's saved originals. Keep each excluded occurrence visible.
    records.forEach((card, index) => {
        const count = included.get(card) ?? 0;
        if (count > 0) {
            included.set(card, count - 1);
            return;
        }
        views.push({ position: index, view: Object.freeze({ ...readingCard(archived(card), now), label: 'Separate saved copy', grouping: 'single' }) });
    });
    return Object.freeze(views.sort((a, b) => a.position - b.position).map(item => item.view));
}
/** Explicit query first, then metadata eligibility, product grouping and publisher diversity. */
export function selectReadingCards(records, settings, now) {
    if (!Number.isSafeInteger(settings.budget) || settings.budget <= 0 || !Number.isFinite(now)
        || !['briefing', 'records'].includes(settings.mode) || settings.topics.some(topic => !TOPICS.includes(topic))
        || settings.query.length > 200)
        throw new Error('READER_SETTINGS_INVALID');
    const query = normalizeFocus(settings.query);
    const matches = records.filter(card => settings.topics.includes(card.topic) && (!query || normalizeFocus([card.title, card.publisher, card.identity, card.version ?? ''].join(' ')).includes(query)));
    let excludedNotices = 0, excludedStale = 0, groupedVersions = 0;
    const filtered = matches.filter(card => {
        if (settings.mode === 'records')
            return true;
        if (card.sourceState === 'stale') {
            excludedStale++;
            return false;
        }
        const notice = classifyNotice(card, now);
        if (notice !== 'not-applicable' && notice !== 'deadline-today' && notice !== 'deadline-ahead') {
            excludedNotices++;
            return false;
        }
        return true;
    }).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
    const publications = groupStories(filtered.filter(card => card.kind === 'publication'));
    const groups = new Map();
    for (const card of filtered.filter(card => card.kind !== 'publication')) {
        const product = card.kind === 'software-release' ? (card.sourceIds.includes('nodejs') ? 'nodejs' : card.sourceIds.includes('nextjs') ? 'nextjs' : null) : null;
        const key = settings.mode === 'briefing' && product !== null ? `software:${product}` : card.id;
        const current = groups.get(key);
        if (current) {
            current.push(card);
            if (settings.mode === 'briefing' && product !== null)
                groupedVersions++;
        }
        else
            groups.set(key, [card]);
    }
    const remaining = publications.map(group => Object.freeze({ ...readingCard(group.card, now, group.related), storyKey: group.key, grouping: group.basis }));
    for (const group of groups.values()) {
        const first = group[0];
        if (first === undefined)
            continue;
        remaining.push(Object.freeze({ ...readingCard(first, now, group.slice(1)), grouping: group.length > 1 && first.kind === 'software-release' ? 'software-versions' : 'single' }));
    }
    remaining.sort((a, b) => Date.parse(b.card.date) - Date.parse(a.card.date) || a.card.id.localeCompare(b.card.id));
    const availableGroups = remaining.length, chosen = [];
    let used = new Set();
    while (remaining.length > 0 && chosen.length < settings.budget) {
        let position = settings.mode === 'records' ? 0 : remaining.findIndex(view => !used.has(view.card.publisher));
        if (position < 0) {
            used = new Set();
            position = 0;
        }
        const view = remaining.splice(position, 1)[0];
        if (view === undefined)
            continue;
        used.add(view.card.publisher);
        chosen.push(view);
    }
    return Object.freeze({ cards: Object.freeze(chosen), matchingRecords: matches.length, availableGroups, excludedNotices, excludedStale, groupedVersions });
}
/** A malformed operating-system locale must not break the reading experience. */
export function safeLocale(value) { try {
    return Intl.getCanonicalLocales(value)[0] ?? 'en-GB';
}
catch {
    return 'en-GB';
} }
export const DISCOVERY_TOPICS = Object.freeze(['world', 'digital-life', 'culture', 'business', 'health', 'environment', 'public-affairs', 'science', 'regulation', 'opportunities']);
export const DISCOVERY_BUDGET = 12;
export const DISCOVERY_SOURCE_MAX_AGE_MS = COMPARISON_MAX_AGE_MS;
const DISCOVERY_WINDOW_MS = 14 * 86400000;
/** A bounded, recent welcome selection. One available topic per round; no invented filler. */
function discoveryCandidates(records, now) {
    if (!Number.isFinite(now))
        throw new Error('READER_CLOCK_INVALID');
    const recent = records.filter(card => Date.parse(card.date) <= now && Date.parse(card.date) > now - DISCOVERY_WINDOW_MS && Date.parse(card.observedAt) <= now + 300000 && now - Date.parse(card.observedAt) < DISCOVERY_SOURCE_MAX_AGE_MS);
    const eligible = selectReadingCards(recent, { topics: DISCOVERY_TOPICS, query: '', budget: Math.max(1, recent.length), mode: 'briefing' }, now);
    const groups = new Map();
    for (const view of eligible.cards) {
        const group = groups.get(view.card.topic) ?? [];
        group.push(view);
        groups.set(view.card.topic, group);
    }
    for (const group of groups.values())
        group.sort((a, b) => compareDailyUse(a.card, b.card));
    const chosen = [];
    while (chosen.length < eligible.cards.length) {
        let added = false;
        for (const topic of DISCOVERY_TOPICS) {
            const view = groups.get(topic)?.shift();
            if (!view)
                continue;
            chosen.push(view);
            added = true;
        }
        if (!added)
            break;
    }
    return Object.freeze(chosen);
}
export function selectDiscoveryCards(records, now) {
    return Object.freeze(discoveryCandidates(records, now).slice(0, DISCOVERY_BUDGET));
}
/** Five different starting interests, then a finite continuation. Counts are source-backed, not a world-news ranking. */
export function selectTodayCards(records, now) {
    const candidates = discoveryCandidates(records, now), first = [], more = [];
    const used = new Set(), usedTopics = new Set(), publishers = new Map();
    const take = (view, target, limit) => {
        if (!view || target.length >= limit || used.has(view.card.id) || (publishers.get(view.card.publisher) ?? 0) >= 3)
            return false;
        target.push(view);
        used.add(view.card.id);
        if (target === first)
            usedTopics.add(view.card.topic);
        publishers.set(view.card.publisher, (publishers.get(view.card.publisher) ?? 0) + 1);
        return true;
    };
    const groups = [['world', 'public-affairs'], ['business'], ['health'], ['digital-life', 'science', 'environment'], ['culture', 'public-affairs']];
    for (const [index, topics] of groups.entries()) {
        const options = candidates.filter(view => topics.includes(view.card.topic) && !used.has(view.card.id) && !usedTopics.has(view.card.topic) && (publishers.get(view.card.publisher) ?? 0) < 3);
        if (index === 0)
            options.sort((a, b) => Number(a.card.topic !== 'world') - Number(b.card.topic !== 'world'));
        else
            options.sort((a, b) => compareDailyUse(a.card, b.card));
        take(options[0], first, 5);
    }
    for (const view of candidates)
        take(view, first, 5);
    for (const view of candidates)
        take(view, more, DISCOVERY_BUDGET);
    return Object.freeze({ first: Object.freeze(first), more: Object.freeze(more) });
}
/** Reproject when a publication window or source check expires; this does not fetch. */
export function nextDiscoveryDelay(cards, now) {
    const boundaries = cards.flatMap(view => [Date.parse(view.card.observedAt) + DISCOVERY_SOURCE_MAX_AGE_MS, Date.parse(view.card.date) + DISCOVERY_WINDOW_MS]).filter(value => Number.isFinite(value) && value > now);
    return boundaries.length ? Math.min(2147483647, Math.max(25, Math.min(...boundaries) - now + 1)) : null;
}
