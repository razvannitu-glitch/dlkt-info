import { validLocalNewsArticle } from './local-news-policy.js';
import { rankContextualCards } from './contextual.js';
import { TOPIC_DESCRIPTIONS } from './topics.js';
import { sourceMatchesCardTopic, sourceRelevantToTopics, sourcesCoverTopic } from './source-relevance.js';
import { metadataChanges } from './comparison.js';
import { selectReadingCards } from './reader.js';
import { groupStories, storyThreadKey } from './story-grouping.js';
import { localEventEligible } from './local-contracts.js';
import { localCoverageReading } from './local-presentation.js';
import { compareLocal } from './local-memory.js';
import { DAILY_TOPIC_FRESHNESS_MS, profileKey, localDay, validProfile } from './daily-contracts.js';
export function topicSignature(c) { return JSON.stringify([c.identity, c.title, c.date, c.dateLabel, c.deadline, c.version, c.sourceUrl, c.publisher, ...(c.summary !== undefined ? [c.summary] : []), ...(c.byline !== undefined ? [c.byline, c.licenseUrl] : []), ...(c.context !== undefined ? [JSON.stringify(c.context)] : [])]); }
export function localSignature(c) { return JSON.stringify([c.id, c.title, c.text, c.validFrom, c.facts]); }
const STORY_FEEDBACK_VERSION = 'dlkt-daily-story-feedback-1';
function storyFeedbackKey(signature) {
    if (signature.length > 24000 || !signature.startsWith(`["${STORY_FEEDBACK_VERSION}",`))
        return null;
    try {
        const value = JSON.parse(signature);
        return Array.isArray(value) && value.length === 2 && value[0] === STORY_FEEDBACK_VERSION && typeof value[1] === 'string' && value[1].length > 0 && JSON.stringify(value) === signature ? value[1] : null;
    }
    catch {
        return null;
    }
}
function feedbackSignature(view) {
    const key = storyThreadKey(view.card);
    if (key === null)
        return topicSignature(view.card);
    const signature = JSON.stringify([STORY_FEEDBACK_VERSION, key]);
    if (signature.length > 24000)
        throw Error('DAILY_STORY_FEEDBACK_TOO_LARGE');
    return signature;
}
/** Versioned thread feedback survives a representative change; old article feedback still matches its original. */
export function feedbackMatches(item, feedback) {
    if (feedback.signature === item.signature && (feedback.id === item.id || item.id.startsWith('topic:') && feedback.id.startsWith('topic:') && storyFeedbackKey(item.signature) !== null))
        return true;
    return item.topic !== undefined && item.topic !== null && [item.topic.card, ...item.topic.related].some(card => feedback.id === 'topic:' + card.id && feedback.signature === topicSignature(card));
}
export function isHidden(item, feedback, now, zone) { return feedback.some(f => feedbackMatches(item, f) && f.action === 'not-today' && f.day === localDay(now, zone) && f.timezone === zone); }
const labels = TOPIC_DESCRIPTIONS;
export function selectDaily(p, topic, local, previous, feedback, now) {
    if (!validProfile(p) || !Number.isFinite(now))
        throw Error('DAILY_PROFILE_INVALID');
    const key = profileKey(p), prior = previous?.profileKey === key && Date.parse(previous.generatedAt) <= now + 300000 ? previous : null;
    const notes = [];
    const sourceRecords = [...(topic?.cards ?? []), ...(prior?.comparison ?? prior?.records ?? [])];
    const sources = topic?.sources.filter(s => sourceRelevantToTopics(s, p.topics, sourceRecords)) ?? [];
    const usable = sources.filter(s => (s.state === 'verified' || s.state === 'partial') && s.error === null && s.verifiedAt !== null && Date.parse(s.verifiedAt) <= now + 300000 && Date.parse(s.verifiedAt) >= now - DAILY_TOPIC_FRESHNESS_MS);
    const topicState = !p.topics.length ? 'not-selected' : !topic || topic.state === 'unavailable' || !usable.length ? 'unavailable' : p.topics.some(t => !sourcesCoverTopic(sources, t, sourceRecords)) || usable.length !== sources.length || sources.some(s => s.state === 'partial' || s.rejected > 0) ? 'partial' : 'ready';
    let identityConflict = false;
    const records = topicState === 'unavailable' ? [] : (topic?.cards ?? []).filter(c => p.topics.includes(c.topic) && c.sourceState !== 'stale' && usable.some(s => sourceMatchesCardTopic(s, c)));
    const localValid = local?.city.id === p.cityId ? local : null;
    const localCards = (localValid?.cards ?? []).filter(c => Date.parse(c.validTo) > now && localEventEligible(c, now) && (c.kind !== 'local-news' || Boolean(localValid && validLocalNewsArticle(c.news, localValid.city, now))));
    const localReady = localValid?.state === 'ready' && localValid.weatherState === 'ready' && (localValid.city.id !== '2643743' || localValid.transportState === 'ready') && localCards.length === localValid.cards.length;
    if (p.cityId && (!localReady))
        notes.push('Some local checks are expired or unavailable. Refresh before relying on them; this is not an all-clear.');
    if (topicState === 'partial' || topicState === 'unavailable')
        notes.push('Some selected sources could not be checked completely. Available cards remain readable; the previous complete edition is kept.');
    if (localValid && (localValid.coverage || localValid.newsSources))
        notes.push(...localCoverageReading(localValid, now).map(item => item.text));
    else if (localValid?.transportState === 'not-covered')
        notes.push('This city currently has a city-centre forecast only. Local events and other services are not connected.');
    const localItems = localCards.map(c => ({ id: 'local:' + c.id, signature: localSignature(c), topic: null, local: c, reason: c.context?.why ?? `For ${localValid?.city.name ?? ''}, the city you selected.`, change: prior?.local ? 'same' : 'first', changes: [] }));
    const previousRecords = prior?.comparison ?? prior?.records ?? [];
    const old = new Map(previousRecords.map(c => [c.id, c]));
    const included = new Set(prior?.records.map(c => c.id) ?? []);
    const priorStories = new Map(groupStories(previousRecords.filter(card => card.kind === 'publication')).map(group => [group.key, group]));
    const includedStories = new Set(groupStories((prior?.records ?? []).filter(card => card.kind === 'publication')).map(group => group.key));
    const safeRecords = records.filter(c => { const before = old.get(c.id); if (before && before.identity !== c.identity) {
        identityConflict = true;
        return false;
    } return true; });
    if (identityConflict)
        notes.push('A conflicting document identity was excluded. The previous complete edition is kept.');
    const chosen = selectReadingCards(safeRecords, { topics: p.topics, query: p.query, budget: Math.max(1, records.length), mode: 'briefing' }, now);
    const contextualSettings = { countryCode: localValid?.city.countryCode ?? null, topics: p.topics, query: p.query, budget: Math.max(1, records.length), publicationWindowMs: null };
    const contextual = rankContextualCards(safeRecords, contextualSettings, now);
    let topicItems = contextual.map(original => {
        const members = [original.card, ...original.related], key = original.storyKey, known = key === undefined ? undefined : priorStories.get(key);
        const changed = members.flatMap(card => { const before = old.get(card.id); if (before?.identity !== card.identity)
            return []; const changes = metadataChanges(before, card); return changes.length ? [{ card, changes }] : []; })[0];
        // Attribute before/after fields to the original that changed, even when it was
        // previously a secondary source. The presentation group itself remains one.
        const framed = changed !== undefined && changed.card.id !== original.card.id ? rankContextualCards([changed.card], { ...contextualSettings, budget: 1 }, now)[0] : undefined;
        const v = framed === undefined ? original : Object.freeze({ ...framed, storyKey: original.storyKey ?? framed.storyKey ?? JSON.stringify(['article', framed.card.identity]),
            grouping: original.grouping, related: Object.freeze(members.filter(card => card.id !== framed.card.id)) });
        const before = old.get(v.card.id), sameIdentity = before?.identity === v.card.identity;
        const changes = changed?.card.id === v.card.id ? changed.changes : before && sameIdentity ? metadataChanges(before, v.card) : [];
        const previousIdentities = new Set(known ? [known.card, ...known.related].map(card => card.identity) : []);
        const addedCoverage = known !== undefined && members.some(card => !previousIdentities.has(card.identity));
        const change = !prior ? 'first' : changes.length ? 'different' : addedCoverage ? 'coverage'
            : before && sameIdentity ? included.has(v.card.id) || key !== undefined && includedStories.has(key) ? 'same' : 'available'
                : known !== undefined ? 'available' : prior.comparison !== undefined ? 'added' : 'available';
        return { id: 'topic:' + v.card.id, signature: feedbackSignature(v), topic: v, local: null,
            reason: (p.query ? `Matches “${p.query}” in the ${labels[v.card.topic]} source you selected.` : `From ${labels[v.card.topic]}, selected by you.`) + ' ' + v.reason, change, changes };
    });
    // A reduced reading budget is not evidence that an old document is new.
    // Hold the prior selected cards stable unless actual changes or newly indexed matches appear.
    const priority = { different: 0, coverage: 1, added: 1, first: 2, same: 2, available: 2 };
    const wasIncluded = (item) => included.has(item.topic?.card.id ?? '') || item.topic?.storyKey !== undefined && includedStories.has(item.topic.storyKey);
    topicItems.sort((a, b) => priority[a.change] - priority[b.change] || Number(wasIncluded(b)) - Number(wasIncluded(a)));
    // Presentation grouping must never erase originals from the comparison corpus.
    const comparison = chosen.cards.flatMap(v => [v.card, ...v.related]);
    const hiddenForDay = (item) => {
        if (isHidden(item, feedback, now, p.timezone))
            return true;
        if (item.topic === null || storyThreadKey(item.topic.card) === null)
            return false;
        const key = item.topic?.storyKey, known = key === undefined ? undefined : priorStories.get(key);
        return known !== undefined && [known.card, ...known.related].some(card => isHidden({ id: 'topic:' + card.id, signature: topicSignature(card) }, feedback, now, p.timezone));
    };
    const hidden = topicItems.filter(hiddenForDay).length;
    topicItems = topicItems.filter(item => !hiddenForDay(item)).slice(0, p.budget);
    const edition = { generatedAt: new Date(now).toISOString(), profileKey: key, topicState, local: localValid, records: topicItems.flatMap(i => i.topic ? [i.topic.card] : []), comparison, complete: !identityConflict && (topicState === 'ready' || topicState === 'not-selected') && (!p.cityId || localReady) };
    if (prior && topicState !== 'unavailable' && p.topics.length && topicItems.length > 0 && topicItems.every(i => i.change === 'same' || i.change === 'available'))
        notes.push('No listing differences in these comparable cards. Older publications are not new merely because you opened today’s edition.');
    return { edition, items: [...localItems, ...topicItems], hidden, topicCount: topicItems.length, localChanges: prior?.local && localValid ? compareLocal(prior.local, localValid) : [], notes, previousAt: prior?.generatedAt ?? null };
}
