/** Isolate contradictory identities before ranking; never make another category from a conflict. */
export function consistentCards(records) {
    const ids = new Map(), identities = new Map(), urls = new Map();
    const add = (map, key, value) => { const values = map.get(key) ?? new Set(); values.add(value); map.set(key, values); };
    for (const card of records) {
        add(ids, card.id, JSON.stringify([card.identity, card.sourceUrl, card.contentHash]));
        add(identities, card.identity, JSON.stringify([card.sourceUrl, card.contentHash]));
        add(urls, card.sourceUrl, JSON.stringify([card.identity, card.contentHash]));
    }
    const unique = new Map();
    for (const card of records) {
        if (ids.get(card.id)?.size !== 1 || identities.get(card.identity)?.size !== 1 || urls.get(card.sourceUrl)?.size !== 1)
            continue;
        const prior = unique.get(card.id);
        if (prior === undefined || Date.parse(card.observedAt) > Date.parse(prior.observedAt))
            unique.set(card.id, card);
    }
    return [...unique.values()];
}
