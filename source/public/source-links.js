import { publisherForNewsUrl, canonicalNewsUrl } from './news-sources.js';
function string(value, max) { return typeof value === 'string' && value.length <= max; }
export function safeLink(value) {
    if (!string(value, 3000))
        return null;
    try {
        const u = new URL(value);
        return u.protocol === 'https:' && !u.username && !u.password && !u.port && (['eur-lex.europa.eu', 'www.ecb.europa.eu', 'github.com', 'op.europa.eu', 'www.nasa.gov', 'science.nasa.gov', 'www.usgs.gov', 'www.fda.gov', 'www.gov.uk', 'globalvoices.org', 'www.eff.org', 'www.ncsc.gov.uk', '360info.org', 'www.scidev.net', 'www.sanews.gov.za', 'www.cbs.nl', 'www.noaa.gov', 'www.nsf.gov', 'www.nist.gov', 'www.federalreserve.gov', 'consumer.ftc.gov', 'www.ftc.gov', 'ec.europa.eu', 'commission.europa.eu', 'www.consilium.europa.eu', 'www.beehive.govt.nz', 'www.gdeltproject.org', 'gdeltproject.org'].includes(u.hostname) || publisherForNewsUrl(value) !== null) ? u.href : null;
    }
    catch {
        return null;
    }
}
/** Exact publisher presentation requirements; never a generic reuse licence. */
export function pressReviewCitation(sourceUrl) {
    const publisher = publisherForNewsUrl(sourceUrl);
    if (publisher?.id !== 'descopera' && publisher?.id !== 'spotmedia')
        return null;
    const url = canonicalNewsUrl(sourceUrl);
    if (!url)
        return null;
    if (publisher.id === 'spotmedia')
        return Object.freeze({ label: 'SURSA: Spotmedia.ro', homeUrl: 'https://spotmedia.ro/', originalLabel: 'Integral pe Spotmedia.ro' });
    return Object.freeze({ label: 'SURSA: DESCOPERA.ro', homeUrl: 'https://www.descopera.ro/', originalLabel: 'Integral pe DESCOPERA.ro' });
}
