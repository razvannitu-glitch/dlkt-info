import { localCardLabel } from './local-contracts.js';
const LOCAL_NEWS_CATEGORIES = {
    transport: 'travel', education: 'education', city: 'housing', utilities: 'housing', safety: 'public-affairs',
    culture: 'culture', events: 'culture', economy: 'business', environment: 'environment',
};
/** Presentation color follows the existing validated local kind/topic, never inferred article geography. */
export function localCardCategory(card) {
    if (card.news)
        return LOCAL_NEWS_CATEGORIES[card.news.topic];
    switch (card.kind) {
        case 'forecast': return 'weather';
        case 'transport':
        case 'transport-notice': return 'travel';
        case 'utility-notice': return 'housing';
        case 'event': return 'culture';
        default: return 'public-affairs';
    }
}
/** Unknown event dates remain publisher listings, never today recommendations. */
export function localDiscoveryLabel(cards) {
    const undated = cards.find(card => card.kind === 'event' && card.context?.startsAt === null);
    return undated ? localCardLabel(undated) : 'Discover today';
}
/** An exact, reviewed rendering vocabulary. Unrecognised prices keep every original qualifier. */
export function admissionText(original) {
    const value = original.trim().replace(/\.$/u, '');
    const reviewed = {
        'entrada libre con reserva previa (aforo limitado)': 'Free admission with advance reservation. Capacity is limited.',
        'gratuito con reserva de entrada': 'Free admission with a ticket reservation.',
        'actividad gratuita, entrada libre': 'Free activity with open admission.',
        'entrada libre hasta completar aforo': 'Free admission, subject to capacity.',
        'actividad gratuita, inscripción previa': 'Free activity; advance registration is required.',
        'gratuito': 'Free admission.',
    };
    return reviewed[value.toLocaleLowerCase('es')] ?? `Admission terms from the organiser: ${original}`;
}
const clock = (at, city) => new Intl.DateTimeFormat('en-GB', { timeZone: city.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at));
const day = (at, city) => new Intl.DateTimeFormat('en-CA', { timeZone: city.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
function eventTime(at, city, now, from) {
    const date = day(Date.parse(at), city) === day(now, city) ? 'Today' : new Intl.DateTimeFormat('en-GB', { timeZone: city.timezone, day: 'numeric', month: 'long' }).format(new Date(at));
    return `${date} ${from ? 'from' : 'at'} ${clock(at, city)} (${city.name} time)`;
}
/** Condense only the known generated summary; unexpected source wording remains intact. */
function compactEventReading(card, city, locale) {
    const context = card.context;
    if (!context?.datePrecision || !context.startsAt || context.documentUrl !== card.sourceUrl)
        return null;
    const start = Date.parse(context.startsAt);
    const end = context.datePrecision === 'day' ? Date.parse(context.endsAt ?? '') - 1 : start;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || start % 60000 !== 0)
        return null;
    if (context.datePrecision === 'day' && (context.endsAt === undefined || (end + 1) % 60000 !== 0 || clock(context.startsAt, city) !== '00:00' || clock(context.endsAt, city) !== '00:00'))
        return null;
    const first = day(start, city);
    const last = day(end, city);
    const when = context.datePrecision === 'day'
        ? first + (first === last ? '' : ' to ' + last) + ' · dates only; check opening hours'
        : first + ' · ' + clock(context.startsAt, city) + ' (' + city.timezone + ')';
    if (context.when !== when
        || card.text !== `${context.place}. Published schedule: ${when}. Check the organiser for current admission and availability.`
        || context.action !== 'Check the organiser for opening hours, admission and any schedule changes.')
        return null;
    const ro = locale === 'ro';
    const date = new Intl.DateTimeFormat(ro ? 'ro-RO' : 'en-GB', { timeZone: city.timezone, day: 'numeric', month: 'short', year: 'numeric' });
    const period = (ro ? 'Cand: ' : 'When: ') + date.formatRange(start, end)
        + (context.datePrecision === 'minute' ? ' · ' + clock(context.startsAt, city) + (ro ? ' (ora locala)' : ' (local time)') : '');
    const nextStep = context.datePrecision === 'day'
        ? (ro ? 'Datele nu confirma orele de acces. Verifica programul, biletele si disponibilitatea la organizator.' : 'Dates do not confirm opening hours. Check the organiser for the current schedule, tickets and availability.')
        : (ro ? 'Verifica eventualele modificari de program, biletele si disponibilitatea la organizator.' : 'Check the organiser for schedule changes, tickets and availability.');
    return { title: card.title, paragraphs: [context.place], period, nextStep };
}
/** Presentation never changes the source record, its timing, saved signature or evidence. */
export function localReading(card, city, now, locale = 'en') {
    if (locale === 'ro' && card.kind === 'forecast') {
        const cityName = city.id === '683506' ? 'Bucuresti' : city.name;
        const measure = /^Hourly forecast temperatures ([-0-9.]+)–([-0-9.]+) °C\. Total precipitation ([-0-9.]+) mm over the six hourly periods\. Highest hourly wind-speed forecast ([-0-9.]+) km\/h \(not gusts\)\.$/u.exec(card.text);
        const summary = measure ? `Temperaturi prognozate intre ${measure[1]} si ${measure[2]} °C. Precipitatii estimate: ${measure[3]} mm in sase ore. Viteza maxima orara a vantului: ${measure[4]} km/h (fara rafale).` : card.text;
        const date = new Intl.DateTimeFormat('ro-RO', { timeZone: city.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return { title: 'Vremea in ' + cityName, paragraphs: [summary], period: date.format(new Date(card.validFrom)) + ' – ' + date.format(new Date(card.validTo)) + ' (ora locala)', nextStep: null };
    }
    if (locale === 'ro' && card.kind === 'utility-notice' && city.id === '683506') {
        const overview = card.id === 'bucharest:cmteb:overview', sectors = overview ? /sectors ([1-6](?:, [1-6])*)$/u.exec(card.context?.place ?? '')?.[1] : undefined;
        const sector = overview ? sectors : card.id.startsWith('bucharest:cmteb:sector-') ? card.id.slice(-1) : undefined;
        if (sector)
            return { title: (overview ? 'Situatia incalzirii si apei calde in ' : 'Termoficare si apa calda in ') +(city.id === '683506' ? 'Bucuresti' : city.name),
                paragraphs: [`Lista oficiala CMTEB include interventii sau intreruperi ale incalzirii ori apei calde pentru sectorul sau sectoarele ${sector}. Consulta documentul operatorului pentru strazile afectate si orele estimate.`],
                period: null, nextStep: 'Verifica strada si imobilul in lista oficiala CMTEB.' };
    }
    if (card.kind === 'local-news' && card.news) {
        const published = new Intl.DateTimeFormat('en-GB', { timeZone: city.timezone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(card.news.publishedAt));
        return { title: card.title, paragraphs: card.news.summary ? [card.news.summary] : [], period: 'Published ' + published + ' (' + city.name + ' time)', nextStep: null };
    }
    if (card.kind === 'event' && card.context?.datePrecision) {
        return compactEventReading(card, city, locale) ?? { title: card.title, paragraphs: [card.text], period: card.context.when, nextStep: card.context.action };
    }
    if (card.kind === 'event' && card.context?.startsAt) {
        const prefix = 'Listed admission terms: ', terms = card.facts.find(f => f.startsWith(prefix))?.slice(prefix.length);
        if (terms)
            return { title: card.title, paragraphs: [`${eventTime(card.context.startsAt, city, now, /· a partir de las /iu.test(card.context.when))} at ${card.context.place}.`, admissionText(terms)], period: null, nextStep: 'Check available places with the organiser before you go.' };
    }
    if (card.kind === 'transport-notice' && card.facts[2]) {
        return { title: card.title, paragraphs: [card.text, `Operator notice (original wording): ${card.facts[2]}`], period: card.context?.when ?? null, nextStep: card.context?.action ?? null };
    }
    if (card.kind === 'municipal-news' && card.context) {
        const published = new Intl.DateTimeFormat('en-GB', { timeZone: city.timezone, day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${card.context.sourceDate}T12:00:00Z`));
        return { title: card.title, paragraphs: [`Published ${published} by ${card.publisher}. The checked card contains the publisher's headline and date; the complete announcement is available at the official source.`, card.boundary], period: null, nextStep: card.context.action };
    }
    if (card.kind === 'forecast') {
        const interval = new Intl.DateTimeFormat('en-GB', { timeZone: city.timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        return { title: `Weather in ${city.name}`, paragraphs: [card.text], period: `${interval.format(new Date(card.validFrom))} to ${interval.format(new Date(card.validTo))} (${city.name} time)`, nextStep: null };
    }
    return { title: card.title, paragraphs: [card.text], period: card.context?.when ?? null, nextStep: card.context?.action ?? null };
}
const domainName = { weather: 'Weather', transport: 'Transport', administration: 'Council announcements', events: 'Events', utilities: 'utility interruptions', 'emergency-alerts': 'official emergency warnings', exchange: 'currency reference rates', accommodation: 'accommodation prices and availability', opportunities: 'local opportunities and deadlines' };
/** Explain missing records without treating an empty or expired check as an all-clear. */
export function localCoverageReading(snapshot, now) {
    const current = snapshot.cards.filter(card => Date.parse(card.validTo) > now);
    const kinds = { transport: 'transport-notice', events: 'event', administration: 'municipal-news', utilities: 'utility-notice' };
    const result = [];
    if (snapshot.newsSources) {
        if (!snapshot.newsSources.length)
            result.push({ domain: null, text: 'Local reporting sources are not connected for ' + snapshot.city.name + '. Other available local information remains labelled by its source.', sourceUrl: null });
        for (const source of snapshot.newsSources) {
            const expired = source.checkedAt !== null && Date.parse(source.checkedAt) + 300000 <= now;
            const text = source.state === 'unavailable' ? source.publisher + ' could not be checked.' : expired ? 'The ' + source.publisher + ' check has expired. Refresh for current local reporting.' : source.count + ' local reports from ' + source.publisher + '. Publication time is shown on each card; it is not the time the event happened.';
            result.push({ domain: null, text, sourceUrl: source.feedUrl });
        }
    }
    for (const item of snapshot.coverage ?? []) {
        if (item.domain !== 'transport' && item.domain !== 'events' && item.domain !== 'administration' && item.domain !== 'utilities')
            continue;
        if (item.state === 'not-covered')
            continue;
        const kind = kinds[item.domain], hasCurrent = current.some(card => card.kind === kind), expired = snapshot.cards.some(card => card.kind === kind && Date.parse(card.validTo) <= now);
        if (item.domain === 'utilities') {
            result.push({ domain: item.domain, text: item.state === 'unavailable' ? 'Heating and hot-water status could not be checked. Missing information is not an all-clear.' : (expired && !hasCurrent || item.checkedAt !== null && Date.parse(item.checkedAt) + 300000 <= now) ? 'The heating and hot-water check has expired. Refresh or check CMTEB before relying on it.' : item.note, sourceUrl: item.sourceUrl });
            continue;
        }
        const arcub = item.domain === 'events' && snapshot.city.id === '683506' && item.sourceUrl === 'https://arcub.ro/agenda';
        let text = null;
        if (item.state === 'unavailable')
            text = `${domainName[item.domain]} could not be verified. Missing information does not mean nothing is happening.`;
        else if ((expired && !hasCurrent) || (item.checkedAt !== null && Date.parse(item.checkedAt) + 300000 <= now))
            text = `The last ${domainName[item.domain].toLowerCase()} check has expired. Refresh local or check the official source before relying on it.`;
        else if (!hasCurrent)
            text = item.domain === 'transport' ? 'No verified TIB notice with a current same-day schedule is shown. EMT buses and other transport are not covered; check your operator before travelling.' : item.domain === 'events' ? (arcub ? 'No current ARCUB agenda entry is shown. Check the organiser for dates, exact times and tickets.' : 'No verified event with a start time still ahead today is shown. Events already started and ticket availability are not checked.') : 'No recent council announcement was verified for this view.';
        if (item.state === 'partial')
            text = (text ? text + ' ' : '') + (arcub ? 'Coverage is limited to the ARCUB agenda; this is not a complete Bucharest events calendar. Confirm dates, times and tickets with the organiser.' : 'Some source records could not be verified; the cards contain only the accepted records.');
        if (text)
            result.push({ domain: item.domain, text, sourceUrl: item.sourceUrl });
    }
    const missing = (snapshot.coverage ?? []).filter(item => item.state === 'not-covered').map(item => domainName[item.domain]);
    if (missing.length)
        result.push({ domain: null, text: 'Not connected for this city: ' + missing.join(', ') + '.', sourceUrl: null });
    return result;
}
