import { consistentCards } from './evidence-consistency.js';
import { PUBLIC_EDITORIAL_CATEGORIES, EDITORIAL_CATEGORY_LABELS, EDITORIAL_CATEGORY_TOPICS } from './editorial-categories.js';
/** Discovery is a title/link index, not a licence to republish publisher articles or images. */
export const NEWS_INDEX_URL = 'https://data.gdeltproject.org/gdeltv3/gal/feed.rss';
const publisher = (id, label, ...hosts) => Object.freeze({ id, label, origins: Object.freeze(hosts.map(host => `https://${host}`)) });
/** Exact reviewed origins only. No suffix matching, wildcard subdomains or user-supplied hosts. */
export const NEWS_PUBLISHERS = Object.freeze([
    publisher('reuters', 'Reuters', 'www.reuters.com', 'reuters.com'),
    publisher('ap', 'Associated Press', 'apnews.com', 'www.apnews.com'),
    publisher('bbc', 'BBC', 'www.bbc.com', 'bbc.com', 'www.bbc.co.uk', 'bbc.co.uk'),
    publisher('guardian', 'The Guardian', 'www.theguardian.com', 'theguardian.com'),
    publisher('ft', 'Financial Times', 'www.ft.com', 'ft.com'),
    publisher('cnbc', 'CNBC', 'www.cnbc.com', 'cnbc.com'),
    publisher('france24', 'France 24', 'www.france24.com', 'france24.com'),
    publisher('dw', 'DW', 'www.dw.com', 'dw.com', 'amp.dw.com'),
    publisher('aljazeera', 'Al Jazeera', 'www.aljazeera.com', 'aljazeera.com'),
    publisher('npr', 'NPR', 'www.npr.org', 'npr.org'),
    publisher('rte', 'RTE', 'www.rte.ie', 'rte.ie'),
    publisher('cnn', 'CNN', 'www.cnn.com', 'cnn.com', 'edition.cnn.com'),
    publisher('abc-au', 'ABC Australia', 'www.abc.net.au', 'abc.net.au'),
    publisher('cbc', 'CBC', 'www.cbc.ca', 'cbc.ca'),
    publisher('euronews', 'Euronews', 'www.euronews.com', 'euronews.com'),
    publisher('politico', 'POLITICO', 'www.politico.com', 'politico.com', 'www.politico.eu', 'politico.eu'),
    publisher('bloomberg', 'Bloomberg', 'www.bloomberg.com', 'bloomberg.com'),
    publisher('business-insider', 'Business Insider', 'www.businessinsider.com', 'businessinsider.com'),
    publisher('fortune', 'Fortune', 'fortune.com', 'www.fortune.com'),
    publisher('techcrunch', 'TechCrunch', 'techcrunch.com', 'www.techcrunch.com'),
    publisher('the-verge', 'The Verge', 'www.theverge.com', 'theverge.com'),
    publisher('ars-technica', 'Ars Technica', 'arstechnica.com', 'www.arstechnica.com'),
    publisher('wired', 'WIRED', 'www.wired.com', 'wired.com'),
    publisher('engadget', 'Engadget', 'www.engadget.com', 'engadget.com'),
    publisher('nvidia', 'NVIDIA', 'blogs.nvidia.com', 'nvidianews.nvidia.com'),
    publisher('anthropic', 'Anthropic', 'www.anthropic.com', 'anthropic.com'),
    publisher('rockstar', 'Rockstar Games', 'www.rockstargames.com', 'rockstargames.com'),
    publisher('playstation', 'PlayStation', 'blog.playstation.com'),
    publisher('ign', 'IGN', 'www.ign.com', 'ign.com'),
    publisher('pcgamer', 'PC Gamer', 'www.pcgamer.com', 'pcgamer.com'),
    publisher('eurogamer', 'Eurogamer', 'www.eurogamer.net', 'eurogamer.net'),
    publisher('gamespot', 'GameSpot', 'www.gamespot.com', 'gamespot.com'),
    publisher('variety', 'Variety', 'variety.com', 'www.variety.com'),
    publisher('billboard', 'Billboard', 'www.billboard.com', 'billboard.com'),
    publisher('hollywood-reporter', 'The Hollywood Reporter', 'www.hollywoodreporter.com', 'hollywoodreporter.com'),
    publisher('deadline', 'Deadline', 'deadline.com', 'www.deadline.com'),
    publisher('espn', 'ESPN', 'www.espn.com', 'espn.com', 'global.espn.com', 'africa.espn.com'),
    publisher('sky-sports', 'Sky Sports', 'www.skysports.com', 'skysports.com'),
    publisher('olympics', 'Olympics', 'www.olympics.com', 'olympics.com'),
    publisher('parents', 'Parents', 'www.parents.com', 'parents.com'),
    publisher('edweek', 'Education Week', 'www.edweek.org', 'edweek.org'),
    publisher('nature', 'Nature', 'www.nature.com', 'nature.com'),
    publisher('science', 'Science', 'www.science.org', 'science.org'),
    publisher('live-science', 'Live Science', 'www.livescience.com', 'livescience.com'),
    publisher('scientific-american', 'Scientific American', 'www.scientificamerican.com', 'scientificamerican.com'),
    publisher('space', 'Space.com', 'www.space.com', 'space.com'),
    publisher('national-geographic', 'National Geographic', 'www.nationalgeographic.com', 'nationalgeographic.com'),
    publisher('new-scientist', 'New Scientist', 'www.newscientist.com', 'newscientist.com'),
    publisher('travel-leisure', 'Travel + Leisure', 'www.travelandleisure.com', 'travelandleisure.com'),
    publisher('skift', 'Skift', 'skift.com', 'www.skift.com'),
    publisher('lonely-planet', 'Lonely Planet', 'www.lonelyplanet.com', 'lonelyplanet.com'),
    publisher('conde-nast-traveler', 'Conde Nast Traveler', 'www.cntraveler.com', 'cntraveler.com'),
    publisher('good-housekeeping', 'Good Housekeeping', 'www.goodhousekeeping.com', 'goodhousekeeping.com'),
    publisher('consumer-reports', 'Consumer Reports', 'www.consumerreports.org', 'consumerreports.org'),
    publisher('which', 'Which?', 'www.which.co.uk', 'which.co.uk'),
    publisher('food-wine', 'Food & Wine', 'www.foodandwine.com', 'foodandwine.com'),
    publisher('food-safety-news', 'Food Safety News', 'www.foodsafetynews.com', 'foodsafetynews.com'),
    publisher('architectural-digest', 'Architectural Digest', 'www.architecturaldigest.com', 'architecturaldigest.com'),
    publisher('dezeen', 'Dezeen', 'www.dezeen.com', 'dezeen.com'),
    publisher('weather-channel', 'The Weather Channel', 'weather.com', 'www.weather.com'),
    publisher('accuweather', 'AccuWeather', 'www.accuweather.com', 'accuweather.com'),
    publisher('carbon-brief', 'Carbon Brief', 'www.carbonbrief.org', 'carbonbrief.org'),
    publisher('global-voices', 'Global Voices', 'globalvoices.org', 'www.globalvoices.org'),
    publisher('360info', '360info', '360info.org', 'www.360info.org'),
    publisher('scmp', 'South China Morning Post', 'www.scmp.com', 'scmp.com'),
    publisher('the-hindu', 'The Hindu', 'www.thehindu.com', 'thehindu.com'),
    publisher('japan-times', 'The Japan Times', 'www.japantimes.co.jp', 'japantimes.co.jp'),
    publisher('cna', 'CNA', 'www.channelnewsasia.com', 'channelnewsasia.com'),
    publisher('straits-times', 'The Straits Times', 'www.straitstimes.com', 'straitstimes.com'),
    publisher('nytimes', 'The New York Times', 'www.nytimes.com', 'nytimes.com'),
    // Exact primary feed origins checked 2026-11-22; discovery does not grant republication rights.
    publisher('digi24', 'Digi24', 'www.digi24.ro'),
    publisher('hotnews', 'HotNews.ro', 'hotnews.ro'),
]);
const byOrigin = new Map(NEWS_PUBLISHERS.flatMap(value => value.origins.map(origin => [origin, value])));
export function publisherForNewsUrl(value) {
    if (value.length > 3000 || /[\u0000-\u0020\u007f<>\\]/u.test(value))
        return null;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password && !url.port ? byOrigin.get(url.origin) ?? null : null;
    }
    catch {
        return null;
    }
}
/** Reviewed publisher-edition tags, not a claim to detect every article's language. */
export const NEWS_SOURCE_LANGUAGES = Object.freeze([
    'en', 'fr', 'ja', 'es', 'ar', 'de', 'pt-BR', 'pt-002', 'sq', 'am', 'bn', 'bs', 'bg', 'zh-Hans', 'zh-Hant', 'hr',
    'fa-AF', 'el', 'ha', 'hi', 'id', 'sw', 'mk', 'ps', 'fa-IR', 'pl', 'ro', 'ru', 'sr', 'tr', 'uk', 'ur',
]);
const publication = (publisherId, countryCode, countryName, coverage, ...editions) => Object.freeze({ publisherId, countryCode, countryName, coverage, editions: Object.freeze(editions.map(([path, language]) => Object.freeze({ path, language }))) });
/** Publication provenance only. A publisher's country or edition never establishes a story's location. */
export const NEWS_PUBLICATION_SCOPES = Object.freeze([
    // Romanian primary editions: exact publisher RSS channel identities verified 2026-11-22.
    publication('digi24', 'RO', 'Romania', 'Romania and global reporting', ['/stiri/', 'ro']),
    publication('hotnews', 'RO', 'Romania', 'Romania and global reporting', ['/', 'ro']),
    publication('ap', 'US', 'United States', 'Global reporting', ['/article/', 'en']),
    publication('bbc', 'GB', 'United Kingdom', 'Global reporting', ['/news/', 'en'], ['/sport/', 'en'], ['/japanese/', 'ja']),
    // Existing direct news indexes and their primary English editions checked 2026-11-22:
    // theverge.com, pcgamer.com, livescience.com, parents.com and edweek.org.
    publication('the-verge', 'US', 'United States', 'Technology and global reporting', ['/', 'en']),
    publication('pcgamer', 'GB', 'United Kingdom', 'Gaming reporting', ['/', 'en']),
    publication('live-science', 'US', 'United States', 'Science reporting', ['/', 'en']),
    publication('parents', 'US', 'United States', 'Parenting and family reporting', ['/', 'en']),
    publication('edweek', 'US', 'United States', 'United States education reporting', ['/', 'en']),
    publication('guardian', 'GB', 'United Kingdom', 'Global reporting', ['/', 'en']),
    publication('france24', 'FR', 'France', 'Global reporting', ['/fr/', 'fr'], ['/en/', 'en'], ['/es/', 'es'], ['/ar/', 'ar']),
    // Edition paths/hreflang labels checked in DW's official language navigation2026-11-21.
    // Language-specific public news sitemaps are registered separately below; no DW RSS subscription or new article origin is enabled.
    publication('dw', 'DE', 'Germany', 'Global reporting', ['/en/', 'en'], ['/fr/', 'fr'], ['/de/', 'de'], ['/es/', 'es'], ['/ar/', 'ar'], ['/pt-br/', 'pt-BR'], ['/pt-002/', 'pt-002'], ['/sq/', 'sq'], ['/am/', 'am'], ['/bn/', 'bn'], ['/bs/', 'bs'], ['/bg/', 'bg'], ['/zh/', 'zh-Hans'], ['/zh-hant/', 'zh-Hant'], ['/hr/', 'hr'], ['/fa-af/', 'fa-AF'], ['/el/', 'el'], ['/ha/', 'ha'], ['/hi/', 'hi'], ['/id/', 'id'], ['/sw/', 'sw'], ['/mk/', 'mk'], ['/ps/', 'ps'], ['/fa-ir/', 'fa-IR'], ['/pl/', 'pl'], ['/ro/', 'ro'], ['/ru/', 'ru'], ['/sr/', 'sr'], ['/tr/', 'tr'], ['/uk/', 'uk'], ['/ur/', 'ur']),
    publication('japan-times', 'JP', 'Japan', 'Japan and global reporting', ['/', 'en']),
    publication('the-hindu', 'IN', 'India', 'India and global reporting', ['/', 'en']),
    publication('abc-au', 'AU', 'Australia', 'Australia and global reporting', ['/news/', 'en']),
    publication('rte', 'IE', 'Ireland', 'Ireland and global reporting', ['/news/', 'en']),
    publication('cna', 'SG', 'Singapore', 'Singapore, Asia and global reporting', ['/', 'en']),
    publication('straits-times', 'SG', 'Singapore', 'Singapore, Asia and global reporting', ['/', 'en']),
    // The New York Times also publishes other language editions. Only its dated English path is declared below.
    publication('nytimes', 'US', 'United States', 'United States and global reporting'),
]);
const publicationScopes = new Map(NEWS_PUBLICATION_SCOPES.map(value => [value.publisherId, value]));
const editionPath = (path, prefix) => prefix === '/' || path === prefix.slice(0, -1) || path.startsWith(prefix);
/** Source-edition language, not automatic detection of the language of an individual article. */
export function sourcePublicationContext(value) {
    const raw = typeof value === 'string' ? value : value.sourceUrl;
    if (raw.length > 3000 || /[\u0000-\u0020\u007f<>\\]/u.test(raw))
        return null;
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
        return null;
    // This source already belongs to the reviewed-feed registry; it is not added to news discovery's origin allowlist.
    if (url.origin === 'https://www.sanews.gov.za' && ['/south-africa/', '/features/'].some(path => editionPath(url.pathname, path)))
        return Object.freeze({ language: 'en', publisherCountryCode: 'ZA', publisherCountryName: 'South Africa', coverage: 'South African government reporting', basis: 'reviewed-publisher' });
    const publisher = byOrigin.get(url.origin), scope = publisher ? publicationScopes.get(publisher.id) : undefined;
    if (!scope)
        return null;
    const edition = scope.editions.find(value => editionPath(url.pathname, value.path));
    const language = edition?.language ?? (scope.publisherId === 'nytimes' && /^\/\d{4}\//u.test(url.pathname) ? 'en' : null);
    return Object.freeze({ language, publisherCountryCode: scope.countryCode, publisherCountryName: scope.countryName, coverage: scope.coverage, basis: 'reviewed-publisher' });
}
export function sourceLanguage(value) { return sourcePublicationContext(value)?.language ?? null; }
/** Strip only known tracking fields; preserve URL parameters that identify the article. */
export function canonicalNewsUrl(value) {
    if (!publisherForNewsUrl(value))
        return null;
    const url = new URL(value);
    url.hash = '';
    // Encoded values are valid; encoded parameter names are intentionally rejected,
    // matching the public archive SQL instead of guessing their decoded meaning.
    if (url.search.slice(1).split('&').some(parameter => parameter.split('=')[0]?.includes('%')))
        return null;
    for (const key of [...url.searchParams.keys()]) {
        const normalized = key.toLowerCase();
        if (normalized.startsWith('utm_') || ['fbclid', 'gclid', 'mc_cid', 'mc_eid'].includes(normalized))
            url.searchParams.delete(key);
    }
    if (url.pathname === '/' || /\/(?:login|signin|sign-in|account|subscribe|search|api)(?:\/|$)/iu.test(url.pathname))
        return null;
    return url.href;
}
export const NEWS_DISCOVERY_INDEXES = Object.freeze([
    // Primary receipt: GitHub Actions run 45050736033, job 137295063381, 2026-11-22 17:40 UTC.
    // Both robots policies allowed these exact public endpoints. Digi24 omits channel language;
    // the reviewed Romanian website edition supplies that provenance, not automatic text detection.
    { id: 'digi24-ro-news', publisherId: 'digi24', url: 'https://www.digi24.ro/rss', format: 'rss', language: 'ro', feedTitle: 'Digi24', feedHome: 'https://www.digi24.ro/', articlePath: '/stiri/', allowMissingLanguage: true },
    { id: 'hotnews-ro-news', publisherId: 'hotnews', url: 'https://hotnews.ro/feed', format: 'rss', language: 'ro', feedTitle: 'HotNews.ro', feedHome: 'https://hotnews.ro', articlePath: '/' },
    { id: 'guardian-news', publisherId: 'guardian', url: 'https://www.theguardian.com/sitemaps/news.xml' },
    { id: 'ap-news', publisherId: 'ap', url: 'https://apnews.com/news-sitemap-content.xml' },
    { id: 'bbc-news', publisherId: 'bbc', url: 'https://www.bbc.com/sitemaps/https-sitemap-com-news-1.xml' },
    { id: 'verge-news', publisherId: 'the-verge', url: 'https://www.theverge.com/sitemaps/google_news' },
    { id: 'pcgamer-news', publisherId: 'pcgamer', url: 'https://www.pcgamer.com/sitemap-news.xml' },
    { id: 'live-science-news', publisherId: 'live-science', url: 'https://www.livescience.com/sitemap-news.xml' },
    { id: 'parents-news', publisherId: 'parents', url: 'https://www.parents.com/google-news-sitemap.xml' },
    { id: 'travel-leisure-news', publisherId: 'travel-leisure', url: 'https://www.travelandleisure.com/google-news-sitemap.xml' },
    { id: 'food-wine-news', publisherId: 'food-wine', url: 'https://www.foodandwine.com/google-news-sitemap.xml' },
    { id: 'good-housekeeping-news', publisherId: 'good-housekeeping', url: 'https://www.goodhousekeeping.com/sitemap_google_news.xml' },
    { id: 'education-week-news', publisherId: 'edweek', url: 'https://www.edweek.org/news-sitemap-content.xml' },
    { id: 'weather-channel-news', publisherId: 'weather-channel', url: 'https://weather.com/api/payload/v1/sitemaps/en-US/news.xml' },
    { id: 'the-hindu-news', publisherId: 'the-hindu', url: 'https://www.thehindu.com/sitemap/googlenews/all/all.xml' },
    // Public endpoints and channel identities checked2026-11-21. Original article metadata remains mandatory.
    // Official XML endpoints and representative original pages inspected2026-11-22.
    // A sitemap headline is only a candidate; mismatching original metadata remains rejected.
    { id: 'dw-ro-news', publisherId: 'dw', url: 'https://www.dw.com/ro/news-sitemap.xml', language: 'ro', articlePath: '/ro/' },
    { id: 'dw-de-news', publisherId: 'dw', url: 'https://www.dw.com/de/news-sitemap.xml', language: 'de', articlePath: '/de/' },
    { id: 'dw-fr-news', publisherId: 'dw', url: 'https://www.dw.com/fr/news-sitemap.xml', language: 'fr', articlePath: '/fr/' },
    { id: 'dw-es-news', publisherId: 'dw', url: 'https://www.dw.com/es/news-sitemap.xml', language: 'es', articlePath: '/es/' },
    { id: 'dw-ar-news', publisherId: 'dw', url: 'https://www.dw.com/ar/news-sitemap.xml', language: 'ar', articlePath: '/ar/' },
    { id: 'france24-en-news', publisherId: 'france24', url: 'https://www.france24.com/en/rss', format: 'rss', language: 'en', feedTitle: 'France 24 - International breaking news, top stories and headlines', feedHome: 'https://www.france24.com/en/', articlePath: '/en/' },
    { id: 'france24-fr-news', publisherId: 'france24', url: 'https://www.france24.com/fr/rss', format: 'rss', language: 'fr', feedTitle: "France 24 - Infos, news & actualités - L'information internationale en direct", feedHome: 'https://www.france24.com/fr/', articlePath: '/fr/' },
    { id: 'france24-es-news', publisherId: 'france24', url: 'https://www.france24.com/es/rss', format: 'rss', language: 'es', feedTitle: 'France 24 - Noticias y actualidad internacional en vivo', feedHome: 'https://www.france24.com/es/', articlePath: '/es/' },
    { id: 'france24-ar-news', publisherId: 'france24', url: 'https://www.france24.com/ar/rss', format: 'rss', language: 'ar', feedTitle: 'فرانس 24 – الأخبار والأحداث الدولية على مدار الساعة', feedHome: 'https://www.france24.com/ar/', articlePath: '/ar/' },
    { id: 'japan-times-news', publisherId: 'japan-times', url: 'https://www.japantimes.co.jp/feed/', format: 'rss', language: 'en', feedTitle: 'Latest articles - The Japan Times', feedHome: 'https://www.japantimes.co.jp/', articlePath: '/' },
    { id: 'guardian-africa-news', publisherId: 'guardian', url: 'https://www.theguardian.com/world/africa/rss', format: 'rss', language: 'en', feedTitle: 'Africa | The Guardian', feedHome: 'https://www.theguardian.com/world/africa', articlePath: '/' },
].map(index => Object.freeze(index)));
const newsSource = (id, label, topic) => Object.freeze({
    id, label, publisher: 'Reviewed news discovery', topic,
    adapter: 'news-index', endpoint: NEWS_INDEX_URL, homepage: 'https://www.gdeltproject.org/', termsUrl: 'https://www.gdeltproject.org/about.html',
    attribution: 'News discovery: GDELT and reviewed public publisher indexes. Headline, publication date and original publisher link only; publisher articles and images are not republished.',
    scope: 'GDELT and reviewed publisher news indexes, with retained candidates from the last 24 hours. Publication date checked in original publisher metadata. Partial discovery coverage; no independent fact corroboration.',
    rightsCheckedAt: '2026-11-20', rightsReviewBy: '2027-02-20',
});
export const NEWS_CATEGORY_SOURCES = Object.freeze(PUBLIC_EDITORIAL_CATEGORIES.map(category => newsSource(`news-${category}`, EDITORIAL_CATEGORY_LABELS[category], EDITORIAL_CATEGORY_TOPICS[category])));
/** An unknown label is retained without assigning a fabricated subject. */
export const NEWS_UNCLASSIFIED_SOURCE = newsSource('news-unclassified', 'Other source-checked topics', 'other');
/** An observed homepage link is a bounded publisher-selection signal, never a global importance rank. */
export const NEWS_FEATURED_SOURCE = Object.freeze({
    id: 'editorial-frontpage', label: 'Publisher homepage selection', publisher: 'Publisher homepage selection', topic: 'world', adapter: 'news-index',
    endpoint: 'https://apnews.com/', homepage: 'https://apnews.com/', termsUrl: 'https://apnews.com/termsofservice',
    attribution: 'Original publisher homepage links observed by DLKT. No article body, images or audience measurements are republished.',
    scope: 'At most10 matching candidate links inside main content on each of4 reviewed publisher homepages: AP, The Guardian, PC Gamer and BBC. Bounded HTML prefix inspection may be partial. This is publisher placement, not a worldwide popularity or importance ranking.',
    rightsCheckedAt: '2026-11-20', rightsReviewBy: '2027-02-20',
});
export const NEWS_SOURCES = Object.freeze([...NEWS_CATEGORY_SOURCES, NEWS_UNCLASSIFIED_SOURCE, NEWS_FEATURED_SOURCE]);
/** Match reviewed edition tags. Unknown provenance never becomes English by default. */
export function newsLanguageMatches(language, preferred) {
    if (language === null || language.length > 80 || preferred.length > 80)
        return false;
    try {
        const source = new Intl.Locale(language), target = new Intl.Locale(preferred);
        if (source.language !== target.language)
            return false;
        if (source.language !== 'zh')
            return true;
        const script = (value) => value.script ?? (['TW', 'HK', 'MO'].includes(value.region ?? '') ? 'Hant' : 'Hans');
        return script(source) === script(target);
    }
    catch {
        return false;
    }
}
/** A reading projection only. Original cards, hashes and persisted comparisons are unchanged. */
export function selectNewsLanguage(records, preferred) {
    return Object.freeze(consistentCards(records).filter(card => card.kind !== 'publication' || newsLanguageMatches(sourceLanguage(card), preferred)));
}
/** Call with eligible publications, not the configured catalog or a stale raw snapshot. */
export function newsLanguageCoverage(records) {
    const unique = new Map(records.filter(card => card.kind === 'publication').map(card => [card.identity, card]));
    const languages = new Map(), publishers = new Set();
    let unknownLanguage = 0;
    for (const card of unique.values()) {
        publishers.add(card.publisher);
        const language = sourceLanguage(card);
        if (language === null)
            unknownLanguage++;
        else
            languages.set(language, (languages.get(language) ?? 0) + 1);
    }
    return Object.freeze({ publications: unique.size, publishers: publishers.size, unknownLanguage,
        languages: Object.freeze([...languages].sort(([a], [b]) => a.localeCompare(b)).map(([language, count]) => Object.freeze({ language, count }))) });
}
