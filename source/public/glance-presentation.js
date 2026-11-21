import { selectHomeLocal } from './home-local.js';
import { eligiblePublication } from './glance-contracts.js';
export function localDay(now, timeZone) { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function quoteCurrency(country) { const map = { RO: 'RON', GB: 'GBP', CH: 'CHF', LI: 'CHF', JP: 'JPY', CA: 'CAD', AU: 'AUD', CZ: 'CZK', PL: 'PLN', HU: 'HUF', SE: 'SEK', NO: 'NOK', DK: 'DKK' }; return map[country ?? ''] ?? 'USD'; }
export function currentLocalCards(snapshot, city, now) { return !snapshot || !city || snapshot.city.id !== city.id || Date.parse(snapshot.checkedAt) > now + 5000 ? [] : snapshot.cards.filter(c => Date.parse(c.checkedAt) <= now + 5000 && Date.parse(c.validTo) > now && Date.parse(c.checkedAt) >= now - (c.kind === 'forecast' || c.kind === 'transport' ? 18 * 3600000 : 300000)); }
export function forecastRange(card) { if (card.kind !== 'forecast')
    return null; const match = /^Hourly forecast temperatures (-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?) °C\./u.exec(card.text); return match ? `${match[1]}–${match[2]} °C` : null; }
/** Re-project at expiry without polling sources; the calendar also advances in an open tab. */
export function nextGlanceDelay(cards, publications, fx, now) {
    const boundaries = [...cards.map(c => Date.parse(c.validTo)), ...cards.flatMap(c => c.context?.startsAt ? [Date.parse(c.context.startsAt)] : []), ...publications.flatMap(c => [Date.parse(c.date) + 7 * 86400000, Date.parse(c.observedAt) + 6 * 3600000]), ...(fx ? [Date.parse(fx.date) + 7 * 86400000, Date.parse(fx.checkedAt) + 6 * 3600000] : [])].filter(t => t > now);
    return Math.min(30000, ...boundaries.map(t => Math.max(25, t - now + 10)));
}
export function keyThing(publications, local, city, topics, now, timeZone) {
    const news = selectHomeLocal(local, city, now).cards.find(card => card.kind === 'local-news');
    if (news)
        return { kind: 'local-news', title: news.title, reason: 'A recent report selected from the connected city publishers.', news };
    const event = currentLocalCards(local, city, now).filter(c => c.kind === 'event' && c.context?.startsAt && Date.parse(c.context.startsAt) > now && localDay(Date.parse(c.context.startsAt), timeZone) === localDay(now, timeZone)).sort((a, b) => Date.parse(a.context?.startsAt ?? '') - Date.parse(b.context?.startsAt ?? ''))[0];
    if (event)
        return { kind: 'event', title: event.title, reason: 'Upcoming today in your selected city, from the connected municipal listings.', event };
    if (city && !topics.length)
        return null;
    const candidates = publications.filter(c => (!city || topics.includes(c.topic)) && eligiblePublication(c, now) && (c.topic !== 'health' || city?.countryCode === 'US' || topics.includes('health')) && (c.topic !== 'public-affairs' || city?.countryCode === 'GB' || topics.includes('public-affairs'))).sort((a, b) => Number(topics.includes(b.topic)) - Number(topics.includes(a.topic)) || Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
    const p = candidates[0];
    return p ? { kind: 'publication', title: p.title, reason: topics.includes(p.topic) ? 'A recent publication from one of your selected topics.' : p.topic === 'health' ? 'A recent US FDA announcement, relevant to the selected country.' : p.topic === 'public-affairs' ? 'A recent UK government announcement, relevant to the selected country.' : `A recent ${p.topic === 'environment' ? 'Earth science' : 'science'} publication from the connected publishers.`, publication: p } : null;
}
