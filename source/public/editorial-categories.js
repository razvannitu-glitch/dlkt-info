/** Audience-facing editorial categories. Persisted Topic IDs and card hashes stay unchanged. */
export const PUBLIC_EDITORIAL_CATEGORIES = [
    'world', 'business', 'technology', 'money', 'health', 'sport', 'gaming', 'culture', 'shopping', 'travel',
    'work', 'education', 'family', 'science', 'environment', 'public-affairs', 'digital-life', 'food', 'housing', 'weather',
];
export const EDITORIAL_CATEGORIES_VERSION = 'dlkt-public-editorial-categories-3';
export const EDITORIAL_CATEGORY_LABELS = Object.freeze({
    world: 'World & geopolitics', business: 'Business & economy', technology: 'AI & technology', money: 'Money & cost of living',
    health: 'Health & wellbeing', sport: 'Sports & competitions', gaming: 'Gaming & esports', culture: 'Culture & entertainment', shopping: 'Shopping & consumer products',
    travel: 'Travel & flights', work: 'Work & careers', education: 'Education & learning', family: 'Family & parenting',
    science: 'Science & space', environment: 'Climate & energy', 'public-affairs': 'Politics & rights',
    'digital-life': 'Digital life & security', food: 'Food & everyday living', housing: 'Housing & cities', weather: 'Weather & major disruptions',
});
/** Coarse compatibility mapping for new source records; never rename stored preferences. */
export const EDITORIAL_CATEGORY_TOPICS = Object.freeze({
    world: 'world', business: 'business', technology: 'technology', money: 'money', health: 'health', sport: 'sport', gaming: 'culture',
    culture: 'culture', shopping: 'money', travel: 'travel', work: 'work-education', education: 'work-education', family: 'public-affairs',
    science: 'science', environment: 'environment', 'public-affairs': 'public-affairs', 'digital-life': 'digital-life',
    food: 'food', housing: 'housing', weather: 'weather',
});
/** Shared acquisition/ranking hints from the headline, not measured reach or proven impact. */
export function editorialHeadlineSignals(value, category) {
    const title = value.normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/gu, ' ').trim(), signals = [];
    if (category === 'world' && /\b(?:summits?|nuclear(?:[- ]arms| (?:weapons|disarmament))? talks?|arms[- ]control talks?|peace (?:agreements?|accords?)|ceasefires?)\b/u.test(title))
        signals.push('diplomatic-development');
    if (['world', 'public-affairs', 'business', 'money', 'technology', 'digital-life', 'shopping', 'health'].includes(category)
        && /\b(?:investigates?|under investigation|opens? (?:an? )?investigation|antitrust|regulatory (?:action|inquiry|investigation)|export (?:controls?|bans?))\b/u.test(title))
        signals.push('investigation-or-regulatory-action');
    if (['world', 'public-affairs', 'business', 'money', 'work', 'education', 'health', 'environment', 'housing', 'digital-life'].includes(category)
        && /\b(?:passes?|adopts?|enacts?|overturns?|bans?|lifts? (?:a |the )?ban|ceasefire|election results?|court rules?|new law|new rules|policy change)\b/u.test(title))
        signals.push('policy-change');
    if (['technology', 'gaming', 'shopping', 'travel'].includes(category)
        && /\b(?:launch(?:es|ed)?|unveils?|introduces?|releases?|opens?|starts? (?:a |new )?(?:route|service)|release date)\b/u.test(title))
        signals.push('product-or-service-change');
    if (['science', 'health', 'environment'].includes(category)
        && /\b(?:discover(?:s|ed|y)?|researchers? find|study finds|trial results?|new evidence|breakthrough)\b/u.test(title))
        signals.push('research-finding');
    if (['sport', 'gaming'].includes(category)
        && /\b(?:wins?|won|champions?|world record|final result|tournament result|title victory)\b/u.test(title))
        signals.push('competition-result');
    if (['business', 'money', 'work'].includes(category)
        && /\b(?:earnings|merger|acquisition|interest rate|inflation|jobs report|employment report|trade deal|tariffs?|ipo|initial public offering|stock market debut|(?:shares?|stocks?) (?:slumps?|plunges?|tumbles?|falls?|rises?|surges?))\b/u.test(title))
        signals.push('economic-development');
    return Object.freeze(signals);
}
export function headlineSignalPriority(signals) {
    return signals.includes('investigation-or-regulatory-action') || signals.includes('diplomatic-development') ? 2 : signals.length ? 1 : 0;
}
export function headlineDiscoveryPriority(title, category) {
    return headlineSignalPriority(editorialHeadlineSignals(title, category));
}
export function newsCategoryFromSourceId(id) {
    if (!id.startsWith('news-'))
        return null;
    const value = id.slice(5);
    return PUBLIC_EDITORIAL_CATEGORIES.includes(value) ? value : null;
}
const SUBJECTS = [
    ['gaming', /\b(?:video games?|videogames?|gaming|gameplay|esports?|playstation|xbox|nintendo|grand theft auto|gta\s*(?:6|vi))\b/u],
    ['family', /\b(?:parenting|parental leave|childcare|child care|nurseries|breastfeeding|child adoption|adopting (?:a |the )?(?:child|children|baby)|adoptive parents?|foster parents?|foster care|care leavers?|guardianship|raising children|parents and children)\b/u],
    ['shopping', /\b(?:shopping|shopping deals?|retail discounts?|black friday|cyber monday|price comparison|buying guide|consumer products?)\b/u],
    ['education', /\b(?:education|schools?|universit(?:y|ies)|students?|scholarships?|curriculum|curricula|tuition|exams?|classrooms?|learning)\b/u],
    ['work', /\b(?:careers?|employment|unemployment|jobs?|workforce|workers?|workplace|hiring|recruitment|layoffs?|redundancies|labour market|labor market)\b/u],
];
const NEWS_SUBJECTS = [
    ...SUBJECTS.slice(0, 3),
    ['sport', /\b(?:sports?|football|soccer|rugby|cricket|tennis|basketball|baseball|hockey|olympics?|athletics|formula one|formula 1|f1|grand prix|world cup|champions league|premier league|equestrian|dressage|show[- ]jumping|horse racing|cycling|swimming|sailing|climbing|badminton|volleyball|motogp|triathlon)\b/u],
    ['weather', /\b(?:weather|hurricanes?|typhoons?|cyclones?|tornadoes?|earthquakes?|floods?|flooding|wildfires?|tsunami|heatwave|storm warnings?|snowstorm)\b/u],
    ['digital-life', /\b(?:cybersecurity|cyber security|cyber[- ]?attacks?|cyber director|data leaks?|data breach|ransomware|phishing|digital privacy|digital rights|online safety|social media|internet censorship|passwords?)\b/u],
    ['health', /\b(?:health|medical|medicine|vaccin(?:e|es|ation)|hospitals?|cancer|disease|clinical|patients?|mental health|nutrition|fitness|dementia|diabetes|first[- ]aid|cpr|cardiopulmonary resuscitation|life[- ]saving (?:techniques?|skills?|training|procedures?|treatments?))\b/u],
    ['science', /\b(?:science|scientific|researchers?|research|discovery|discoveries|astronom(?:y|ers?)|astrophysics|stellar|black holes?|neutron stars?|physics|chemistry|biology|fossils?(?!\s+fuels?\b)|archaeology|spacecraft|exoplanet|telescope|astronauts?|lunar|galaxies|milky way)\b/u],
    ['environment', /\b(?:climate|environment|biodiversity|conservation|pollution|emissions|carbon|deforestation|fossil fuels?|renewable energy|clean energy|cop\d{2})\b/u],
    ['food', /\b(?:food|recipes?|cooking|restaurants?|chefs?|cuisine|groceries|farming|agriculture|food safety|food recall|allergens?)\b/u],
    ['housing', /\b(?:housing|house prices?|home prices?|homes? for sale|houses? for sale|properties for sale|mortgages?|tenants?|rental|rents?|urban planning|city planning|homelessness|real estate)\b/u],
    ...SUBJECTS.slice(3),
    ['travel', /\b(?:travel|tourism|tourists?|flights?|airlines?|airports?|aviation|railways?|rail|trains?|railways?|passports?|visas?|cruises?|getaways?|holiday destinations?|vacation destinations?|transport|mobility|roadworks?|road closures?|street resurfacing|traffic collisions?|traffic diversions?|bridge repairs?|traffic accidents?)\b/u],
    ['money', /\b(?:personal finance|cost of living|household budgets?|savings|(?:personal|household) saving|saving money|pensions?|retirement|credit cards?|consumer prices?|income tax|tax returns?|financial literacy)\b/u],
    ['technology', /\b(?:artificial intelligence|ai|technology|technologies|software|semiconductors?|computer chips?|computing|robotics|quantum computing|smartphones?|smartwatches?|laptops?|large language models?|virtual reality|augmented reality|mixed reality|vr headsets?|spatial computing|3d displays?)\b/u],
    ['business', /\b(?:business|economy|economic|earnings|profits?|revenue|mergers?|acquisitions?|stock markets?|stock exchange|shares?|investors?|investment|inflation|interest rates?|tariffs?|trade deals?|banks?|banking)\b/u],
    ['culture', /\b(?:culture|cultural|arts?|music|musicians?|films?|movies?|cinema|actors?|actresses|television|museums?|heritage|festivals?|concerts?|entertainment|books?|novels?|oscars?|grammys?|dj sets?|dj live(?:stream)?|djs?|theatre|theater|exhibitions?|dance performances?)\b/u],
    ['world', /\b(?:war|wars|ceasefire|conflict|invasion|missiles?|airstrikes?|air strikes?|diplomatic|diplomacy|summits?|bilateral talks|state visits?|foreign affairs|humanitarian|peace talks|sanctions|international relations|border clashes|defen[cs]e)\b/u],
    ['public-affairs', /\b(?:politics|political|elections?|parliament|congress|senate|president|prime minister|government|governor|mayor|courts? (?:rules?|rulings?|orders?|judgments?|decisions?|overturns?|upholds?|rejects?|blocks?|hears?)|judicial|judiciary|legislation|legislature|laws?|voters?|democracy|civil rights)\b/u],
];
const SECTIONS = Object.freeze({
    world: 'world', international: 'world', business: 'business', economy: 'business', markets: 'business',
    technology: 'technology', tech: 'technology', 'artificial-intelligence': 'technology', money: 'money', 'personal-finance': 'money',
    health: 'health', wellness: 'health', sport: 'sport', sports: 'sport', gaming: 'gaming', 'video-games': 'gaming',
    culture: 'culture', entertainment: 'culture', arts: 'culture', movies: 'culture', music: 'culture', books: 'culture',
    shopping: 'shopping', deals: 'shopping', travel: 'travel', careers: 'work', work: 'work', education: 'education',
    parenting: 'family', family: 'family', science: 'science', space: 'science', environment: 'environment', climate: 'environment',
    politics: 'public-affairs', 'public-affairs': 'public-affairs', cybersecurity: 'digital-life', 'digital-life': 'digital-life',
    food: 'food', recipes: 'food', housing: 'housing', 'real-estate': 'housing', weather: 'weather',
});
/** Reviewed specialist-publication scope, used only after actual headline/section evidence. */
const SPECIALIST_PUBLISHERS = Object.freeze(Object.fromEntries([
    ['parents.com', 'family'], ['pcgamer.com', 'gaming'], ['ign.com', 'gaming'], ['eurogamer.net', 'gaming'], ['gamespot.com', 'gaming'],
    ['livescience.com', 'science'], ['scientificamerican.com', 'science'], ['edweek.org', 'education'],
    ['travelandleisure.com', 'travel'], ['cntraveler.com', 'travel'], ['lonelyplanet.com', 'travel'],
    ['foodandwine.com', 'food'], ['foodsafetynews.com', 'food'],
].flatMap(([host, category]) => [[host, category], [`www.${host}`, category]])));
const FINANCIAL_DEVELOPMENT = /\b(?:earnings|quarterly profits?|annual profits?|quarterly revenue|annual revenue|stock markets?|stock exchange|share price|ipo|initial public offering|stock market debut|(?:shares?|stocks?) (?:slumps?|plunges?|slides?|tumbles?|falls?|rises?|rall(?:y|ies)|surges?|soars?|jumps?|drops?|gains?|trading))\b/u;
const ASTRONOMICAL_MERGER = /\b(?:stellar|astronom(?:y|ers?)|black holes?|neutron stars?|galaxies)\b/u;
/** A school-system merger is not a corporate deal merely because it says "merger". */
function educationInstitutionMerger(title) {
    return /\bmergers?\b/u.test(title)
        && /\b(?:schools?|universit(?:y|ies)|colleges?|education (?:departments?|boards?|directorates?|ministries)|(?:departments?|boards?|directorates?|ministries) of (?:school |intermediate |higher )?education)\b/u.test(title)
        && !/\b(?:compan(?:y|ies)|corporate|corporations?|firms?|banks?|banking|software|shareholders?|investors?|acquisitions?)\b/u.test(title)
        && !ASTRONOMICAL_MERGER.test(title)
        && !FINANCIAL_DEVELOPMENT.test(title);
}
/** Discovery classification uses explicit subjects/section names, never a guessed global-topic fallback. */
export function classifyNewsHeadline(title, sourceUrl) {
    if (!title.trim() || title.length > 4000 || /[\u0000-\u001f\u007f]/u.test(title))
        return null;
    let url;
    try {
        url = new URL(sourceUrl);
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
        return null;
    const normalized = title.normalize('NFKC').toLowerCase();
    // An editorial cartoon is commentary, not a new diplomatic event or a quota-filling news item.
    if (/\s[–—-]\s*cartoon\s*$/u.test(normalized))
        return null;
    // The nature of the reported development matters more than the company sector.
    const financial = FINANCIAL_DEVELOPMENT.test(normalized);
    const merger = /\b(?:mergers?|acquisitions?)\b/u.test(normalized) && !ASTRONOMICAL_MERGER.test(normalized);
    if (educationInstitutionMerger(normalized))
        return 'education';
    if (financial || merger)
        return 'business';
    if (/\b(?:budget cuts?|spending cuts?|cost[- ]cutting|cost[- ]savings?|efficiency savings|round of savings)\b/u.test(normalized)
        && !/\b(?:household|personal finance|savings accounts?|income tax|pensions?|retirement)\b/u.test(normalized))
        return 'business';
    if (/\b(?:photographer of the year|photography (?:awards?|competitions?|contests?)|photo (?:awards?|competitions?|contests?))\b/u.test(normalized))
        return 'culture';
    // Holiday weather is an attribute of a destination, not a major disruption.
    if (/\b(?:getaways?|holiday destinations?|vacation destinations?)\b/u.test(normalized)
        && !/\b(?:hurricanes?|typhoons?|cyclones?|tornadoes?|earthquakes?|floods?|flooding|wildfires?|tsunami|heatwave|storm warnings?|snowstorm)\b/u.test(normalized))
        return 'travel';
    const category = NEWS_SUBJECTS.find(([, pattern]) => pattern.test(normalized))?.[0];
    // A team/squad summit on a sports desk is not an international diplomatic summit.
    if (category === 'world' && url.pathname.toLowerCase().split('/').some(segment => segment === 'sport' || segment === 'sports')
        && !/\b(?:war|wars|ceasefire|conflict|invasion|missiles?|airstrikes?|air strikes?|foreign affairs|diplomacy|diplomatic|bilateral talks|state visits?|nuclear)\b/u.test(normalized))
        return 'sport';
    // An athlete's career is sporting context, unless the headline explicitly
    // reports employment or workforce changes rather than sporting progress.
    if (category === 'work' && url.pathname.toLowerCase().split('/').some(segment => segment === 'sport' || segment === 'sports')
        && !/\b(?:employment|unemployment|jobs?|workforce|workers?|workplace|hiring|recruitment|layoffs?|redundancies|labour market|labor market)\b/u.test(normalized))
        return 'sport';
    if (category !== undefined)
        return category;
    for (const segment of url.pathname.toLowerCase().split('/')) {
        const section = Object.hasOwn(SECTIONS, segment) ? SECTIONS[segment] : undefined;
        if (section !== undefined)
            return section;
    }
    return Object.hasOwn(SPECIALIST_PUBLISHERS, url.hostname) ? SPECIALIST_PUBLISHERS[url.hostname] ?? null : null;
}
const LEGACY = Object.freeze({
    world: 'world', business: 'business', technology: 'technology', money: 'money', health: 'health', sport: 'sport', culture: 'culture',
    travel: 'travel', science: 'science', space: 'science', environment: 'environment', energy: 'environment',
    'public-affairs': 'public-affairs', regulation: 'public-affairs', 'digital-life': 'digital-life', food: 'food', housing: 'housing', weather: 'weather',
});
/**
 * Source IDs are provenance supplied by the validated public acquisition pipeline,
 * not authorization by themselves. Multiple category queries never create copies:
 * a matching explicit subject breaks a tie, then the stable category order does.
 */
export function classifyEditorialCard(card) {
    if (card.sourceIds.includes('news-unclassified'))
        return null;
    const title = card.title.normalize('NFKC').toLowerCase();
    const subjects = SUBJECTS.filter(([, pattern]) => pattern.test(title)).map(([category]) => category);
    const hints = PUBLIC_EDITORIAL_CATEGORIES.filter(category => card.sourceIds.some(id => newsCategoryFromSourceId(id) === category));
    // Correct only the old generic-merger discovery hint. Preserve the original
    // card/source IDs and discovery provenance, including a checked frontpage link.
    if (hints.length === 1 && hints[0] === 'business' && educationInstitutionMerger(title))
        return Object.freeze({ category: 'education', basis: 'category-discovery' });
    if (hints.length) {
        const category = subjects.find(value => hints.includes(value)) ?? hints[0];
        return category === undefined ? null : Object.freeze({ category, basis: 'category-discovery' });
    }
    // A broad agency feed is not evidence that every item is a weather event.
    if (card.topic === 'weather' && /\b(?:fishing|fisheries)\b/u.test(title))
        return /\b(?:data|research|survey|study)\b/u.test(title) ? Object.freeze({ category: 'science', basis: 'headline-subject' }) : null;
    if (/\bstormy\b[^.!?]{0,60}\b(?:pacific|atlantic|ocean|coast|seas?)\b/u.test(title))
        return Object.freeze({ category: 'weather', basis: 'headline-subject' });
    // Broad institutional sources do not fill these categories merely because they
    // mention a child, a game, a purchase, a product recall or a consumer warning.
    const subject = subjects[0];
    if (subject !== undefined)
        return Object.freeze({ category: subject, basis: 'headline-subject' });
    const category = LEGACY[card.topic];
    return category === undefined ? null : Object.freeze({ category, basis: 'legacy-topic' });
}
export function editorialCategory(card) {
    return classifyEditorialCard(card)?.category ?? null;
}
/** Match the corrected school-merger discovery hint without rewriting saved Topics. */
export function editorialInterestTopic(card) {
    if (card.topic !== 'business' || !card.sourceIds.includes('news-business')
        || card.sourceIds.some(id => { const category = newsCategoryFromSourceId(id); return category !== null && category !== 'business'; }))
        return card.topic;
    return classifyEditorialCard(card)?.category === 'education' ? EDITORIAL_CATEGORY_TOPICS.education : card.topic;
}
