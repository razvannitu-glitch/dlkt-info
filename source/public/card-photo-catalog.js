import { validContextForCard } from './context.js';
import { REVIEWED_PHOTOS } from './reviewed-photos.js';
import { CONTEXT_PHOTOS } from './context-photos.js';
const origins = new Set(['https://globalvoices.org', 'https://science.nasa.gov', 'https://assets.science.nasa.gov', 'https://commons.wikimedia.org', 'https://creativecommons.org', 'https://www.nasa.gov']);
const safe = (value) => { try {
    const u = new URL(value);
    return origins.has(u.origin) && !u.username && !u.password && u.protocol === 'https:';
}
catch {
    return false;
} };
/** Media have their own review. Publisher-text licensing is never treated as image permission. */
export function usablePhoto(photo, now) {
    return Number.isFinite(now) && Number.isFinite(Date.parse(photo.reviewedAt)) && Number.isFinite(Date.parse(photo.reviewBy))
        && Date.parse(photo.reviewedAt) <= now && now <= Date.parse(photo.reviewBy)
        && /^[a-f0-9]{64}$/u.test(photo.sha256) && photo.path === `/card-media/${photo.sha256.slice(0, 16)}.${photo.assetUrl.includes('.webp') ? 'webp' : 'jpg'}`
        && Number.isSafeInteger(photo.bytes) && photo.bytes > 1000 && photo.bytes <= 260000
        && Number.isSafeInteger(photo.width) && photo.width >= 640 && photo.width <= 1600 && Number.isSafeInteger(photo.height) && photo.height >= 300 && photo.height <= 1600
        && photo.alt.length > 10 && photo.alt.length <= 300 && photo.caption.length > 0 && photo.caption.length <= 300 && photo.credit.length > 0 && photo.credit.length <= 200
        && safe(photo.assetUrl) && safe(photo.creditUrl) && safe(photo.sourceUrl)
        && (['https://creativecommons.org/licenses/by-sa/4.0/', 'https://www.nasa.gov/nasa-brand-center/images-and-media/'].includes(photo.licenseUrl))
        && (photo.contextRevision === undefined || (/^[a-f0-9]{64}$/u.test(photo.contextRevision.contentHash) && validContextForCard(photo.contextRevision.context, [photo.sourceId])))
        && (photo.fit === 'cover' || photo.fit === 'contain');
}
/** Exact reviewed revision only. This changes presentation, never EvidenceCard or its stored hash. */
export function photoFor(card, now = Date.now()) {
    const p = REVIEWED_PHOTOS.find(p => p.cardId === card.id);
    if (!p || !usablePhoto(p, now))
        return null;
    const revision = p.contextRevision, context = card.context;
    // A finite second pin is derived from the reviewed article plus evidenced context only.
    // Neither arbitrary context nor a legacy hash attached to new context is accepted.
    const reviewedHash = context === undefined ? card.contentHash === p.contentHash : revision !== undefined && card.contentHash === revision.contentHash
        && validContextForCard(context, card.sourceIds) && context.basis === revision.context.basis && context.label === revision.context.label && context.boundary === revision.context.boundary
        && context.countries.length === revision.context.countries.length && context.countries.every((country, index) => country.code === revision.context.countries[index]?.code && country.name === revision.context.countries[index]?.name);
    return card.kind === 'publication' && card.identity === p.identity && card.sourceUrl === p.sourceUrl && card.topic === p.topic
        && card.publisher === p.publisher && card.sourceIds.includes(p.sourceId) && card.title === p.articleTitle && card.date === p.articleDate && reviewedHash ? p : null;
}
const contextLicenses = Object.freeze({
    'CC BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
    'CC BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
    'CC BY 2.0': 'https://creativecommons.org/licenses/by/2.0/',
    'CC BY-SA 4.0': 'https://creativecommons.org/licenses/by-sa/4.0/',
    'CC BY-SA 3.0': 'https://creativecommons.org/licenses/by-sa/3.0/',
    'CC BY-SA 2.5': 'https://creativecommons.org/licenses/by-sa/2.5/',
    'CC0': 'https://creativecommons.org/publicdomain/zero/1.0/',
});
const commonsUrl = (value, asset = false) => {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash
            && (asset ? ['upload.wikimedia.org', 'thumb.wikimedia.org'].includes(url.hostname) && url.pathname.startsWith('/wikipedia/commons/') : url.hostname === 'commons.wikimedia.org' && url.pathname.startsWith('/wiki/File:'));
    }
    catch {
        return false;
    }
};
/** Independent, finite review of a topic photograph; never evidence for an article. */
export function usableContextPhoto(photo, now) {
    return Number.isFinite(now) && Number.isFinite(Date.parse(photo.reviewedAt)) && Number.isFinite(Date.parse(photo.reviewBy))
        && Date.parse(photo.reviewedAt) <= now && now <= Date.parse(photo.reviewBy)
        && photo.kind === 'context' && photo.mimeType === 'image/jpeg' && /^[a-f0-9]{64}$/u.test(photo.sha256)
        && photo.path === `/card-media/${photo.sha256.slice(0, 16)}.jpg`
        && Number.isSafeInteger(photo.bytes) && photo.bytes > 1000 && photo.bytes <= 420000
        && Number.isSafeInteger(photo.width) && photo.width >= 640 && photo.width <= 1000 && Number.isSafeInteger(photo.height) && photo.height >= 300 && photo.height <= 1400
        && photo.alt.startsWith('Context: ') && photo.alt.length <= 300 && photo.caption.startsWith('Context photo: ') && photo.caption.length <= 300
        && photo.credit.length > 0 && photo.credit.length <= 200 && photo.changeNote.length > 0 && photo.changeNote.length <= 200
        && (photo.requiredAttribution === undefined || photo.requiredAttribution.length > 0 && photo.credit.includes(photo.requiredAttribution))
        && commonsUrl(photo.assetUrl, true) && commonsUrl(photo.creditUrl) && photo.sourceUrl === photo.creditUrl
        && contextLicenses[photo.license] === photo.licenseUrl && photo.fit === 'contain';
}
const folded = (value) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
function articleUrl(value) {
    if (!value)
        return null;
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url : null;
    }
    catch {
        return null;
    }
}
function articlePath(url) {
    if (!url)
        return '';
    try {
        return folded(decodeURIComponent(url.pathname));
    }
    catch {
        return '';
    }
}
const sportsPaths = [
    ['cricket', /\/(?:cricket|t20|ipl)(?:\/|$)/u],
    ['tennis', /\/(?:tennis|atp|wta)(?:\/|$)/u],
    ['basketball', /\/(?:basketball|nba|wnba)(?:\/|$)/u],
    ['rugby', /\/(?:rugby|rugby-union|rugby-league)(?:\/|$)/u],
    ['football', /\/(?:football|soccer)(?:\/|$)/u],
    ['equestrian', /\/(?:equestrian|horse-racing|dressage)(?:\/|$)/u],
];
const sportsHeadlines = [
    ['cricket', /\b(?:cricket|t20|twenty20|indian premier league|pakistan super league|(?:ipl|odi) (?:finals?|matches?|series|tournaments?|teams?)|wickets?|ashes (?:tests?|series|tour))\b/u],
    ['tennis', /\b(?:tennis|(?:atp|wta) (?:tour|finals?|rankings?|players?|tournaments?|matches?)|wimbledon|roland garros)\b/u],
    ['basketball', /\b(?:basketball|nba|wnba)\b/u],
    ['rugby', /\b(?:rugby|six nations)\b/u],
    ['football', /\b(?:football|soccer|uefa|fifa|premier league)\b/u],
    ['equestrian', /\b(?:equestrian|dressage|show[ -]?jumping|horse riding|horse racing|horses?)\b/u],
];
const headlineSubjects = [
    ['gaming', /\b(?:gaming|gamers?|video games?|game consoles?|playstation|ps5|grand theft auto|gta[ -]?(?:vi|6))\b/u],
    ['cinema', /\b(?:cinema|films?|movies?|hollywood|oscars?|bafta|box office)\b/u],
    ['art', /\b(?:museums?|art galleries|art gallery|art exhibitions?|visual arts?|paintings?|sculptures?|sculptors?)\b/u],
    ['roadworks', /\b(?:roadworks?|potholes?|street resurfacing|bridge repairs?)\b/u],
    ['housing', /\b(?:housing|apartments?|mortgages?|real estate|residential|new homes?|rental homes?|rental market|house prices|home prices|property prices|property market|rent(?:s|al)?(?: increases?| rises?| costs?))\b/u],
    ['energy', /\b(?:solar (?:panels?|power|energy|farms?|electrification)|photovoltaic)\b/u],
    ['technology', /\b(?:processors?|semiconductors?|microchips?|computer chips?|motherboards?|software|smartphones?|laptops?|artificial intelligence|ai models?|machine learning|cloud computing|data cent(?:er|re)s|cybersecurity)\b/u],
    ['music', /\b(?:concerts?|orchestras?|symphon(?:y|ies)|recitals?|live music|music festivals?|musicians?|singers?|new albums?|album releases?|opera)\b/u],
    ['education', /\b(?:schools?|students?|teachers?|universit(?:y|ies)|classrooms?|curriculum|scholarships?|tuition|education)\b/u],
    ['family', /\b(?:parents?|parenting|families|family|children|babies|baby|childcare|guardianship|care leavers)\b/u],
    ['health', /\b(?:doctors?|hospitals?|patients?|vaccines?|medical|medicine|disease|health|cancer|first aid|cpr)\b/u],
    ['weather', /\b(?:weather|storms?|hurricanes?|tornadoes?|heatwaves?|flooding|rainfall|snowfall|weather forecasts?)\b/u],
    ['travel', /\b(?:flights?|airports?|airlines?|aviation|tourism|tourists?|holidays?|travel|visas?)\b/u],
    ['shopping', /\b(?:supermarkets?|groceries|shopping|retailers?|discounts?|black friday|food prices)\b/u],
    ['science', /\b(?:laborator(?:y|ies)|microscopes?|laboratory research|biology|biologists?|chemistry|chemical research)\b/u],
    ['business', /\b(?:stock markets?|stocks?|shares?|ipo|earnings|quarterly profits?|corporate|companies|company|enterprise|mergers?|acquisitions?)\b/u],
];
const subjectPaths = [
    ['gaming', /\/(?:gaming|video-games)(?:\/|$)/u],
    ['cinema', /\/(?:film|films|movies|cinema)(?:\/|$)/u],
    ['art', /\/(?:art|visual-art|museums)(?:\/|$)/u],
    ['housing', /\/(?:housing|real-estate|property-market)(?:\/|$)/u],
    ['technology', /\/(?:technology|tech|computing)(?:\/|$)/u],
    ['energy', /\/(?:solar-energy|solar-power|photovoltaic)(?:\/|$)/u],
];
/** A foreign-country mention or ambiguous city cannot be outweighed by a UK investor or feed path. */
function photoRegion(title, path, uk) {
    const places = `${title} ${path.replace(/[\/_-]/gu, ' ')}`;
    const romania = /\b(?:romania|romanian|bucharest|bucuresti)\b/u.test(places);
    const foreign = /\b(?:canada|canadian|ontario|british columbia|new england|united states|usa|american|india|indian|china|chinese|russia|russian|australia|australian|new zealand|france|french|germany|german|italy|italian|spain|spanish|portugal|portuguese|ireland|irish|japan|japanese|brazil|brazilian|mexico|mexican|netherlands|dutch|switzerland|swiss|sweden|swedish|norway|norwegian|denmark|danish|poland|polish|turkey|turkish|ukraine|ukrainian|egypt|egyptian|israel|israeli|pakistan|bangladesh|south africa|nigeria|singapore)\b/u.test(places.replace(/\bnorthern ireland\b/gu, ''))
        || /\b(?:us|u\.s\.) (?:economy|inflation|housing|house prices|apartments|interest rates|pensions|government)\b/u.test(title) || /\/(?:us|us-news)(?:\/|$)/u.test(path);
    if (foreign || uk && romania)
        return null;
    return uk ? 'uk' : romania ? 'romania' : null;
}
function geographicSubject(subject, region) {
    if (subject !== 'housing')
        return subject;
    if (region === 'uk')
        return 'uk-housing';
    if (region === 'romania')
        return 'ro-housing';
    return subject;
}
/** Missing or conflicting subject evidence deliberately produces no decorative photograph. */
export function contextPhotoSubject(card) {
    const raw = folded(card.title), url = articleUrl(card.sourceUrl), path = articlePath(url);
    // Occupation, relatives and location are not the subject of a crime or military report.
    if (/\b(?:murder(?:ed|s)?|kill(?:ed|ing|ings)?|shooting|stabbing|rape|sexual assault|sexual abuse|abuse allegations?|criminal|crime|arrest(?:ed|s)?|charged with|criminal charges|faces? charges|on trial|faces? trial|appears? in court|court case|court hears|lawsuits?|police|prison|jail|prosecutors?|sentenced|fraud|corruption|gunman|massacre|bomb(?:ing|ed|s)?|airstrikes?|missiles?|war|military|troops?|soldiers?|army|armed forces|invasion)\b/u.test(raw)
        || /\/(?:crime|military|war)(?:\/|$)/u.test(path))
        return null;
    const title = raw
        .replace(/\b(?:fair[\s\p{Pd}]+weather|political storms?|political football|weather the storm|storm of criticism|horse[ -]trading|dark horse|trojan horse|school of thought|parent compan(?:y|ies)|family business|family office|family of (?:chips|processors|products)|opera browser|photo albums?)\b/gu, ' ');
    const uk = /\b(?:uk|britain|british|united kingdom|england|scotland|wales|northern ireland|sunderland|westminster|downing street|house of commons|house of lords|sterling|gbp)\b/u.test(title)
        || /\/(?:uk|uk-news|uk-politics)(?:\/|$)|\/news\/uk(?:-|\/)/u.test(path);
    const region = photoRegion(title, path, uk);
    const guardianPolitics = (url?.hostname === 'www.theguardian.com' || url?.hostname === 'theguardian.com') && path.startsWith('/politics/');
    for (const [subject, pattern] of sportsPaths)
        if (pattern.test(path))
            return subject;
    for (const [subject, pattern] of sportsHeadlines)
        if (pattern.test(title))
            return subject;
    if (/\b(?:xi|jinping)\b/u.test(title) && /\bputin\b/u.test(title))
        return 'china-russia';
    if (/\b(?:united nations|un security council|un general assembly)\b/u.test(title) || /\bUN\b/u.test(card.title))
        return 'diplomacy';
    const euro = /\b(?:euros?|eurozone|ecb|european central bank)\b|€/u.test(title) || url?.hostname === 'www.ecb.europa.eu' || url?.hostname === 'ecb.europa.eu';
    if (euro && /\b(?:inflation|interest rates?|savings|pensions?|coins?|currency|banknotes?|exchange rates?|monetary|deposits?|eurozone)\b/u.test(title))
        return 'money';
    if (region === 'uk' && /\b(?:inflation|interest rates?|savings|pensions?|sterling|gbp|monetary|economy|gdp|bank of england)\b/u.test(title))
        return 'uk-economy';
    const euPolitics = /\b(?:european union|european commission|european parliament|european council|council of the european union)\b/u.test(title) || /\bEU\b/u.test(card.title);
    if (euPolitics && /\b(?:deals?|agreements?|negotiations?|treaties|treaty)\b/u.test(title))
        return 'eu-politics';
    // The reviewed gaming photographs show PlayStation equipment, not other platforms or casinos.
    const unrelatedGaming = /\b(?:casinos?|gambling|betting|poker|slot machines?)\b/u.test(title)
        || /\b(?:nintendo|xbox|steam deck)\b/u.test(title) && !/\b(?:playstation|ps5)\b/u.test(title);
    for (const [subject, pattern] of headlineSubjects) {
        if (pattern.test(title))
            return subject === 'gaming' && unrelatedGaming ? null : geographicSubject(subject, region);
    }
    for (const [subject, pattern] of subjectPaths) {
        if (pattern.test(path))
            return subject === 'gaming' && unrelatedGaming ? null : geographicSubject(subject, region);
    }
    if (guardianPolitics || uk && /\b(?:politics|political|government|parliament|minister|labour|conservatives?|tories|reform|elections?|mps|westminster|downing street|house of commons|house of lords)\b/u.test(title))
        return 'uk-politics';
    if (euPolitics)
        return 'eu-politics';
    const us = /\b(?:united states|usa)\b/u.test(title) || /\bUS\b|\bU\.S\./u.test(card.title);
    if (/\b(?:white house|us president|u\.s\. president|united states president|president (?:donald )?trump|trump administration)\b/u.test(title)
        || us && /\b(?:federal|government|presiden(?:t|cy)|congress|senate)\b/u.test(title)
        || /\/(?:us|usa)\/politics(?:\/|$)|\/politics\/us(?:\/|$)/u.test(path))
        return 'us-politics';
    return null;
}
/** Non-secret public identity only. Tracking query parameters and fragments never select a photo. */
function photoIdentity(card) {
    const url = articleUrl(card.sourceUrl);
    return url ? `${url.origin}${url.pathname.replace(/\/+$/u, '') || '/'}` : folded(card.title).replace(/\s+/gu, ' ').trim();
}
function selectionScore(value) {
    let hash = 2166136261;
    for (const character of value)
        hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16777619);
    return hash >>> 0;
}
export function contextPhotoFor(card, now = Date.now(), photos = CONTEXT_PHOTOS) {
    const subject = contextPhotoSubject(card);
    if (subject === null)
        return null;
    // This reviewed image depicts a named campus, not education in every country.
    // Query strings, fragments and broad feed labels cannot establish that place.
    const miskolc = /\bmiskolc\b/u.test(`${folded(card.title)} ${articlePath(articleUrl(card.sourceUrl)).replace(/[\/_-]/gu, ' ')}`);
    const identity = photoIdentity(card);
    let selected = null, score = -1;
    for (const photo of photos) {
        if (photo.subject !== subject || !usableContextPhoto(photo, now))
            continue;
        if (photo.key === 'context-education' && !miskolc)
            continue;
        const candidateScore = selectionScore(`${identity}\n${photo.key}`);
        if (candidateScore > score || candidateScore === score && selected !== null && photo.key < selected.key) {
            selected = photo;
            score = candidateScore;
        }
    }
    return selected;
}
/** Exact reviewed article photograph first; explicitly labelled topic context otherwise. */
export function displayPhotoFor(card, now = Date.now()) {
    return photoFor(card, now) ?? contextPhotoFor(card, now);
}
