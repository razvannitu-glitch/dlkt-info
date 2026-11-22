/** Pure headline disambiguation. These checks label subjects, never source trust or event location. */
const normalized = (value) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim();
const FAIR_WEATHER = /\bfair[\s\p{Pd}]+weather\b/gu;
const METEOROLOGICAL_CONTEXT = /\b(?:meteorolog(?:y|ical|ists?)|weather forecasts?|weather conditions|temperatures?|rainfall|snowfall|sunshine|humidity|clear skies|sunny skies|wind speeds?|weather warnings?)\b/u;
const LITERAL_FAIR_WEATHER = /\bfair[\s\p{Pd}]+weather\s+(?:(?:is|was|will|would|should|could|may|might|can|be|been|being|has|have|had|to|set|likely|expected|forecast|predicted|still)\s+){0,4}(?:forecast|expected|predicted|return(?:s|ed|ing)?|continu(?:e|es|ed|ing)|persist(?:s|ed|ing)?|prevail(?:s|ed|ing)?)\b/u;
/** An unsupported fair-weather descriptor is not weather evidence; real forecasts and hazards remain. */
export function weatherSubjectText(value) {
    const title = normalized(value);
    return METEOROLOGICAL_CONTEXT.test(title) || LITERAL_FAIR_WEATHER.test(title) ? title : title.replace(FAIR_WEATHER, ' ');
}
export function hasUnsupportedWeatherDescriptor(value) {
    const title = normalized(value);
    return weatherSubjectText(title) !== title;
}
const CHILD_PROTECTION = /\b(?:(?:child|children|children['’]s|child['’]s)[ -](?:safety|protection|safeguarding)|(?:safeguarding|protecting) (?:children|minors))\b/u;
const CONSUMER_SAFETY = /\b(?:product (?:recall|safety)|(?:food|toy|toys|car seat|child seat|stroller|crib|cot|pram|high chair)[ -]recalls?|recall(?:s|ed)?|consumer (?:products?|warnings?)|allergens?|choking hazard)\b/u;
const DIGITAL_SAFETY = /\b(?:online safety|internet safety|digital safety|online child safety|digital child safety|child safety online|child protection online|social media|cybersecurity|cyber security|data protection|digital privacy|parental controls?)\b/u;
/** Protection of children is a family subject; product recalls and online controls keep their own subject. */
export function hasChildProtectionSubject(value) {
    const title = normalized(value);
    return CHILD_PROTECTION.test(title) && !CONSUMER_SAFETY.test(title) && !DIGITAL_SAFETY.test(title);
}
/** Summit is an event format shared by civic, scientific, sporting and diplomatic meetings. */
export function hasDiplomaticSummitContext(value) {
    const title = normalized(value);
    if (!/\bsummits?\b/u.test(title))
        return false;
    if (/\b(?:diploma(?:cy|tic)|bilateral|multilateral|world leaders?|heads? of (?:state|government)|prime ministers?|foreign ministers?|foreign secretar(?:y|ies)|ambassadors?|peace talks|ceasefire|nuclear (?:arms|weapons|disarmament)|arms[- ]control|state visits?|international relations|g7|g8|g20|nato|brics|asean|apec|united nations)\b/u.test(title))
        return true;
    // A university/company president is an organizational role, not a head of state.
    const organization = '(?:universit(?:y|ies)|colleges?|schools?|compan(?:y|ies)|corporations?|corporate|business|banks?|clubs?|associations?|unions?|federations?|foundations?|charit(?:y|ies))';
    const organizationalPresident = new RegExp(`\\b${organization}\\b[^.!?]{0,40}\\bpresidents?\\b|\\bpresidents?\\b[^.!?]{0,30}\\b(?:of|at)\\b[^.!?]{0,30}\\b${organization}\\b`, 'u');
    return /\bpresidents?\b/u.test(title) && !organizationalPresident.test(title);
}
