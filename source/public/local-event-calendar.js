import { localSource, object, validCity } from './local-contracts.js';
const encoder = new TextEncoder();
const bounded = (value, maximum) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\p{Surrogate}\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
function instant(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value))
        return null;
    const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value.replace(/Z$/u, value.includes('.') ? 'Z' : '.000Z') ? time : null;
}
const stamp = (time) => new Date(time).toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
/** RFC 5545 TEXT escaping prevents source text from introducing calendar properties. */
function calendarText(value) {
    return value.replace(/\\/gu, '\\\\').replace(/\r\n|\r|\n|\u2028|\u2029/gu, '\\n').replace(/[,;]/gu, '\\$&');
}
/** Folding counts UTF-8 octets, including the continuation space, without splitting code points. */
function fold(line) {
    let output = '', octets = 0;
    for (const character of line) {
        const size = encoder.encode(character).length;
        if (octets + size > 75) {
            output += '\r\n ';
            octets = 1;
        }
        output += character;
        octets += size;
    }
    return output;
}
function wallClock(time, zone) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(time);
    const get = (kind) => parts.find(part => part.type === kind)?.value ?? '';
    return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')), minute: Number(get('minute')) };
}
/** Only reviewed, current, minute-precision schedules can become a calendar entry.
 * The existing source record remains authoritative; no end time, ticket or booking is inferred.
 */
export function localEventCalendar(card, city, now) {
    if (!Number.isFinite(now) || !object(card) || !validCity(city) || card.kind !== 'event' || !object(card.context))
        return null;
    const context = card.context;
    if (context.section !== 'discover' || context.status !== 'scheduled' || context.endsAt !== undefined
        || !bounded(card.title, 300) || !bounded(card.text, 8000) || !bounded(card.boundary, 1000)
        || !bounded(context.place, 300) || !bounded(context.when, 500) || !bounded(context.action, 1000)
        || !bounded(card.sourceUrl, 1500)
        || !bounded(context.documentHash, 64) || !/^[a-f0-9]{64}$/u.test(context.documentHash)
        || !Array.isArray(card.facts) || card.facts.length > 20 || !card.facts.every(fact => bounded(fact, 8000))
        || !localSource(card.sourceUrl, 'event'))
        return null;
    const checked = instant(card.checkedAt), from = instant(card.validFrom), until = instant(card.validTo), start = instant(context.startsAt);
    if (checked === null || from === null || until === null || start === null || checked > now + 5000 || now - checked >= 300000
        || from !== checked || until <= now || until <= from || until > Math.min(checked + 300000, start) || start <= now || start % 60000 !== 0)
        return null;
    const source = new URL(card.sourceUrl);
    if (source.href !== card.sourceUrl)
        return null;
    let schedule = null;
    if (city.id === '2512989' && city.countryCode === 'ES' && city.timezone === 'Europe/Madrid'
        && card.publisher === 'Ajuntament de Palma / PalmaCultura' && source.hostname === 'www.palmacultura.com'
        && card.id === `palma:event:${source.pathname.split('/')[3] ?? ''}`
        && context.documentUrl === 'https://www.palmacultura.com/index.php?Idi=2' && context.datePrecision === undefined) {
        schedule = /^(\d{4}-\d{2}-\d{2}) · (?:a partir de las\s+)?(\d{1,2})(?:[.:](\d{2}))?\s*h \(Europe\/Madrid\)$/iu.exec(context.when);
        if (context.sourceDate !== wallClock(now, city.timezone).day)
            return null;
    }
    else if (city.id === '683506' && city.countryCode === 'RO' && city.timezone === 'Europe/Bucharest'
        && card.publisher === 'ARCUB' && source.hostname === 'arcub.ro' && /^bucharest:arcub:[a-f0-9]{24}$/u.test(card.id)
        && context.documentUrl === card.sourceUrl && context.datePrecision === 'minute') {
        schedule = /^(\d{4}-\d{2}-\d{2}) · (\d{2}):(\d{2}) \(Europe\/Bucharest\)$/u.exec(context.when);
    }
    else
        return null;
    if (!schedule)
        return null;
    const wall = wallClock(start, city.timezone);
    if (wall.day !== schedule[1] || wall.hour !== Number(schedule[2]) || wall.minute !== Number(schedule[3] ?? 0))
        return null;
    const description = [card.text, ...card.facts, `Published schedule: ${context.when}`, context.action, card.boundary,
        'End time not verified. This calendar file is not a booking or a live schedule update.',
        `Source: ${card.publisher}`, card.sourceUrl, `Source checked: ${card.checkedAt}`].join('\n\n');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DLKT//Local events//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
        `UID:dlkt-${card.id.replace(/:/gu, '-')}@dlkt.ee`, `DTSTAMP:${stamp(checked)}`, `DTSTART:${stamp(start)}`,
        `SUMMARY:${calendarText(card.title)}`, `LOCATION:${calendarText(context.place)}`, `DESCRIPTION:${calendarText(description)}`,
        `URL:${card.sourceUrl}`, 'TRANSP:TRANSPARENT', 'END:VEVENT', 'END:VCALENDAR'];
    return Object.freeze({ filename: `dlkt-${card.id.replace(/:/gu, '-')}.ics`, contentType: 'text/calendar;charset=utf-8', content: lines.map(fold).join('\r\n') + '\r\n' });
}
