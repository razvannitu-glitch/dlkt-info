export const validNewsPeriod = (value) => value === 'today' || value === 'recent';
const DAY = 86_400_000;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const fields = ['date', 'timeZone', 'start', 'end'];
/** Find real calendar transitions, rather than adding 24 hours across daylight-saving changes. */
export function newsDayWindow(at, timeZone = 'UTC') {
    if (!Number.isFinite(at) || !Number.isSafeInteger(at) || typeof timeZone !== 'string' || !timeZone || timeZone.length > 80)
        throw Error('NEWS_DAY_INVALID');
    let formatter;
    try {
        formatter = new Intl.DateTimeFormat('en-GB', { timeZone, calendar: 'iso8601', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit' });
    }
    catch {
        throw Error('NEWS_DAY_INVALID');
    }
    const dateAt = (instant) => {
        const parts = formatter.formatToParts(instant), part = (type) => parts.find(value => value.type === type)?.value ?? '';
        return part('year').padStart(4, '0') + '-' + part('month') + '-' + part('day');
    };
    let date;
    try {
        date = dateAt(at);
    }
    catch {
        throw Error('NEWS_DAY_INVALID');
    }
    if (!/^\d{4}-\d\d-\d\d$/u.test(date))
        throw Error('NEWS_DAY_INVALID');
    // A bounded bracket covers 23/25-hour DST days and non-hour offsets. No host-time-zone parsing is used.
    const before = at - 2 * DAY, after = at + 2 * DAY;
    if (dateAt(before) >= date || dateAt(after) <= date)
        throw Error('NEWS_DAY_INVALID');
    const boundary = (low, high, afterDate) => {
        while (high - low > 1) {
            const middle = low + Math.floor((high - low) / 2), value = dateAt(middle);
            if (afterDate ? value <= date : value < date)
                low = middle;
            else
                high = middle;
        }
        return high;
    };
    const start = boundary(before, at, false), end = boundary(at, after, true);
    return Object.freeze({ date, timeZone, start: new Date(start).toISOString(), end: new Date(end).toISOString() });
}
/** Metadata cannot supply an arbitrary date, offset or zone instead of the reader's validated city. */
export function validNewsDayWindow(value, at, timeZone) {
    if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => typeof value[key] !== 'string'))
        return false;
    try {
        const expected = newsDayWindow(at, timeZone);
        return fields.every(key => value[key] === expected[key]);
    }
    catch {
        return false;
    }
}
export function newsPublishedInDay(publishedAt, day) {
    const published = Date.parse(publishedAt);
    return Number.isFinite(published) && published >= Date.parse(day.start) && published < Date.parse(day.end);
}
