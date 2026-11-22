import { weatherSubjectText, hasChildProtectionSubject } from './editorial-subject-semantics.js';
/** Reviewed multi-subject feeds. Topic labels are editorial, never publisher verification. */
const MULTI_TOPIC_SOURCES = ['govuk-news', 'govuk-products', 'gv-world', 'gv-culture', 'nasa-news', 'sanews', 'ec-press', 'eu-council', 'cbs-news', 'scidev-news', '360-news', 'noaa-news', 'nist-news', 'nsf-news', 'fed-news', 'ftc-consumer', 'fda-food', 'beehive-news'];
export const hasEditorialTopics = (sourceId) => sourceId === 'editorial-frontpage' || MULTI_TOPIC_SOURCES.includes(sourceId);
const rules = [
    ['sport', /\b(?:sports?|football|rugby|olympic|athletes?|cricket|tennis|basketball|hockey)\b/u],
    ['space', /\b(?:space|astronauts?|artemis|lunar|moon|mars|orbital|orbit|galaxy|galaxies|telescope|spacecraft|exoplanet|apod|nasa)\b/u],
    ['weather', /\b(?:weather|hurricanes?|typhoons?|cyclones?|tornadoes?|earthquakes?|floods?|flooding|wildfires?|storm warnings?|emergency warnings?)\b/u],
    ['food', /\b(?:food|agriculture|farming|farmers?|fisheries|product safety|product recall|contaminated|allergens?)\b/u],
    ['health', /\b(?:health|medical|medicine|medicines|vaccin(?:e|es|ation)|hospital|cancer|disease|ebola|fistula|hiv|clinical|patient|patients)\b/u],
    ['digital-life', /\b(?:cybersecurity|cyber security|privacy|phishing|scams?|ransomware|data protection|digital rights|online safety|online child safety|child safety online|child protection online|parental controls?)\b/u],
    ['energy', /\b(?:energy|electricity|renewables?|solar power|wind power|nuclear power|gas supply|oil prices?|power grid)\b/u],
    ['housing', /\b(?:housing|homes?|rent|rents|rental|urban|cities|city planning|construction|homelessness)\b/u],
    ['travel', /\b(?:travel|transport|mobility|railway|rail|trains?|aviation|airports?|flights?|roads?|traffic|tourism|tourists?)\b/u],
    ['work-education', /\b(?:education|schools?|universities|university|students?|skills|learning|employment|unemployment|jobs?|workers?|workforce)\b/u],
    ['culture', /\b(?:culture|cultural|arts?|music|films?|cinema|museum|heritage|festival|entertainment|books?|creative industries)\b/u],
    ['money', /\b(?:cost of living|inflation|consumer confidence|household|savings|pensions?|tax(?:es|ation)?|wages|income|financial literacy|interest rates?)\b/u],
    ['technology', /\b(?:artificial intelligence|ai|technology|technologies|software|digital|quantum|robotics|semiconductors?|computing)\b/u],
    ['environment', /\b(?:environment|climate|biodiversity|conservation|pollution|emissions|forests?|oceans?|carbon|cop\d{2})\b/u],
    ['opportunities', /\b(?:applications? open|apply by|call for proposals|funding opportunity|funding opportunities|scholarships?|grants?|tenders?|procurement)\b/u],
    ['regulation', /\b(?:rights|rules|regulation|legislation|laws?|legal|court|enforcement|justice|constitution)\b/u],
    ['world', /\b(?:conflict|ceasefire|war|defence|defense|sanctions|international|diplomatic|foreign affairs|humanitarian|security)\b/u],
    ['business', /\b(?:economy|economic|business|trade|markets?|investment|finance|financial|industry|industrial|companies|entrepreneur|growth|recovery)\b/u],
    ['science', /\b(?:science|scientific|research|discovery|discoveries|biology|physics|chemistry)\b/u],
];
/** Bounded rules inspect publisher category text first, then the article headline. */
export function editorialTopic(sourceId, fallback, title, categories) {
    if (!hasEditorialTopics(sourceId))
        return fallback;
    const tags = categories.slice(0, 128).map(value => value.normalize('NFKC').toLowerCase().trim());
    if (tags.some(hasChildProtectionSubject))
        return 'public-affairs';
    for (const [topic, pattern] of rules)
        if (tags.some(value => pattern.test(topic === 'weather' ? weatherSubjectText(value) : value)))
            return topic;
    const headline = title.normalize('NFKC').toLowerCase();
    if (hasChildProtectionSubject(headline))
        return 'public-affairs';
    return rules.find(([topic, pattern]) => pattern.test(topic === 'weather' ? weatherSubjectText(headline) : headline))?.[0] ?? fallback;
}
