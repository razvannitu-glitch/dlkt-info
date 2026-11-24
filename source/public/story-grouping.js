import { contextForCard } from './context.js';
import { validArticleSubject } from './article-subject.js';
import { canonicalNewsUrl, publisherForNewsUrl } from './news-sources.js';
const MAX_RECORDS = 5000, WINDOW_MS = 2 * 86_400_000;
const VERSION = 'dlkt-story-1';
const STOP_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'be', 'been', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'its', 'of', 'on', 'or', 'that', 'the', 'their', 'this', 'to', 'was', 'were', 'will', 'with']);
// This module deliberately does not import reader.ts: the reader itself uses grouping.
// Latin folding does not remove Japanese voicing or split Korean syllables.
function text(value) {
    return value.normalize('NFKC').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC')
        .toLocaleLowerCase('en').replace(/[‘’]/gu, "'").replace(/[‐‑‒–—]/gu, '-').replace(/\s+/gu, ' ').trim();
}
const key = (...parts) => JSON.stringify([VERSION, ...parts]);
const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const defaultOrder = (a, b) => Date.parse(b.date) - Date.parse(a.date) || lexical(a.id, b.id);
function order(compare, a, b) {
    const result = compare(a, b);
    return Number.isFinite(result) && result !== 0 ? result : defaultOrder(a, b) || lexical(a.identity, b.identity);
}
function publicationYear(card) {
    const date = new Date(card.date);
    return Number.isFinite(date.getTime()) ? String(date.getUTCFullYear()) : null;
}
function countries(card) {
    return contextForCard(card).countries.map(country => country.code).sort().join(',');
}
/** Only the verified original publisher's separated terminal label is decoration. */
function groupingHeadline(card, title) {
    const publisher = publisherForNewsUrl(card.sourceUrl);
    if (!publisher || publisher.label !== card.publisher || canonicalNewsUrl(card.sourceUrl) !== card.sourceUrl)
        return title;
    const label = text(publisher.label);
    for (const separator of [' - ', ' | ']) {
        const suffix = separator + label;
        if (title.endsWith(suffix))
            return title.slice(0, -suffix.length).trim();
    }
    return title;
}
/** Exact fallback retains punctuation, numbers, negation, excerpt and geography. */
function headlineAnchor(card, title) {
    const comparison = groupingHeadline(card, title);
    const words = comparison.match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? [];
    const informative = comparison.length >= 55 && words.length >= 8 && new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word))).size >= 7;
    const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Hangul}]/u.test(comparison)
        && comparison.length >= 30 && new Set(comparison.match(/\p{L}/gu) ?? []).size >= 14;
    if (!informative && !cjk)
        return null;
    return { key: key('headline', comparison, card.summary === undefined ? '' : text(card.summary), countries(card)), basis: 'matching-headlines', strong: false };
}
/** Preserve the existing narrow, exact reported launch-revenue equivalence. */
function launchRevenueAnchor(card, title) {
    const normalized = title.replace(/\b(?:grand theft auto|gta)\s*(?:6|vi)\b/gu, 'grand theft auto 6');
    const match = /^(?:[\p{L}\p{N} &'’.-]{2,50} says )?(.{3,100}?) (?:earned|made|grossed|generated) (us\$|\$|usd)\s*(\d+(?:\.\d+)?) (billion|million|bn|m) (?:on launch day|in (?:its |the )?first day|in (?:its |the )?first 24 hours)\.?$/u.exec(normalized);
    if (!match || /\b(?:not|never|no|estimated?|projected|expected|denied|disputed|false|falsely|wrongly|incorrectly|allegedly|unconfirmed)\b/u.test(normalized))
        return null;
    const amount = Number(match[3]);
    if (!Number.isFinite(amount) || amount <= 0)
        return null;
    return { key: key('launch-revenue', match[1], match[2] === '$' ? 'unspecified-dollar' : 'USD', amount, match[4] === 'billion' || match[4] === 'bn' ? 'billion' : 'million', countries(card), card.summary === undefined ? '' : text(card.summary)), basis: 'matching-headlines', strong: false };
}
// A named event is necessary but not sufficient. A separate incident or activity
// at the same meeting must not become a negotiation merely because COP/G20 occurs.
const NEGOTIATION = /\b(?:draft|deal|agreement|accord|negotiations?|talks|communique|declaration|treaty|projet|brouillon|negociations?|pourparlers|borrador|acuerdo|negociaciones|conversaciones|rascunho|acordo|negociacoes|entwurf|abkommen|verhandlungen|proiect|acord|negocieri)\b|合意|協議|交渉|草案|协议|協議|谈判|談判|초안|합의|협상|مسودة|اتفاق|مفاوضات/u;
const PROTEST = /\b(?:protests?|protesters?|demonstrations?|manifestants?|manifestations?|protestas?|manifestacoes|demonstranten|proteste)\b|抗議|示威|抗议|시위|احتجاج/u;
const VENUE_INCIDENT = /\b(?:venue fire|fire at|evacuat(?:e|ed|ion)|bomb threat|security breach|incendie|evacuation|incendio|amenaza de bomba|brandalarm)\b|火災|避難|爆破予告|疏散|대피|حريق|إخلاء/u;
const ATTENDANCE = /\b(?:attend(?:s|ed|ance)?|boycott|withdraws? from|participants?|delegations?|participation|boicot|teilnahme|delegatii)\b|出席|欠席|参加国|참석|مشاركة/u;
const SCHEDULE = /\b(?:schedule|fixtures?|draw|calendar|calendrier|tirage|calendario|sorteo|spielplan|auslosung|programul)\b|日程|組み合わせ|赛程|賽程|抽签|抽籤|일정|대진|جدول|قرعة/u;
const TICKETS = /\b(?:tickets?|ticketing|billets?|entradas|bilhetes|bilete)\b|チケット|入場券|门票|門票|입장권|تذاكر/u;
const OPENING = /\b(?:opening ceremony|ceremonie d'ouverture|ceremonia de apertura|cerimonia de abertura|eroffnungsfeier|ceremonia de deschidere)\b|開会式|开幕式|開幕式|개막식|حفل الافتتاح/u;
const EXPLANATORY = /\b(?:anniversary|retrospective|documentary|documentaire|documental|documentario|biography|biographie|novel|roman|history of|anniversaire|aniversario|jahrestag|aniversare)\b|周年|回顧|纪录片|紀錄片|다큐멘터리/u;
/** The identified meeting itself overruns; employment hours or a side event do not establish this. */
function meetingProgress(value) {
    const title = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    if (/\b(?:workers?|staff|employees?|overtime pay|wages?|payroll|shifts?|working hours|hours worked)\b/iu.test(title))
        return false;
    const match = /\b(?:summit|conference|meeting)(?:\s+(?:in|at)\s+([^.!?:;]{1,70}?))?\s+(?:enters?|continues?|runs?|goes?|heads?|extends?)(?:\s+(?:into|in|for|a|an|the|its|another|second|third|fourth|fifth|sixth|final|extra|day|days|hour|hours|of)){0,8}\s+(?:overtime|extra (?:day|days|hours?)|past (?:its |the )?deadline)\b/iu.exec(title);
    if (!match)
        return false;
    // "Dinner at COP31 summit runs ..." makes the summit a location, not the
    // grammatical subject of the duration update.
    if (/\b(?:at|during|inside|outside|near|within|around|alongside|beside|before|after|for|of)\b/iu.test(title.slice(0, match.index)))
        return false;
    const location = match[1];
    // An optional printed place clause may intervene, not a different grammatical
    // subject such as "summit dinner" or "summit in Antalya staff shift".
    return location === undefined || /^(?:the )?\p{Lu}[\p{L}\p{M}'’.-]*(?:[ ,]+\p{Lu}[\p{L}\p{M}'’.-]*){0,5}$/u.test(location);
}
function summitSubject(title, progress) {
    // Competing activities are not a bridge between otherwise unrelated threads.
    const subjects = [VENUE_INCIDENT.test(title) ? 'venue-incident' : null, PROTEST.test(title) ? 'protests' : null, NEGOTIATION.test(title) || progress ? 'negotiations' : null].filter((value) => value !== null);
    if (subjects.length > 1)
        return null;
    if (subjects.length)
        return subjects[0] ?? null;
    return ATTENDANCE.test(title) ? 'attendance' : SCHEDULE.test(title) ? 'schedule' : null;
}
function explicitYear(title, event, fallback) {
    const escaped = event.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const match = new RegExp(`\\b(?:((?:19|20)\\d{2})\\s+${escaped}|${escaped}(?:\\s+(?:summit|meeting|sommet|cumbre|gipfel))?\\s+((?:19|20)\\d{2}))\\b`, 'u').exec(title);
    return match?.[1] ?? match?.[2] ?? fallback;
}
function numberedEventAnchor(card, title) {
    const year = publicationYear(card);
    if (!year)
        return null;
    const summits = [...title.matchAll(/\b(cop|unga)\s*-?\s*(\d{1,3})\b/gu)].map(match => `${match[1]}:${Number(match[2])}`);
    const annual = [...title.matchAll(/\b(g7|g8|g20|brics|asean|apec)\b/gu)].map(match => `${match[1]}:${explicitYear(title, match[1] ?? '', year)}`);
    const meetings = [...new Set([...summits, ...annual])];
    if (meetings.length === 1) {
        const subject = summitSubject(title, meetingProgress(card.title));
        if (subject)
            return { key: key('summit', meetings[0], subject), basis: 'shared-event', strong: true };
    }
    if (meetings.length)
        return null;
    // Tournament edition + a unique activity, not a category-wide sports bucket.
    const tournament = /\b(?:fifa world cup|world cup|coupe du monde|copa del mundo|copa do mundo|weltmeisterschaft|campionatul mondial)\b|ワールドカップ|世界杯|世界盃|월드컵|كأس العالم/u.test(title) ? 'world-cup'
        : /\b(?:olympics?|olympic games|jeux olympiques|juegos olimpicos|jogos olimpicos|olympische spiele|jocurile olimpice)\b|オリンピック|奥运会|奧運會|올림픽|الألعاب الأولمبية/u.test(title) ? 'olympics'
            : /\bwimbledon\b/u.test(title) ? 'wimbledon' : null;
    if (!tournament)
        return null;
    const edition = /\b((?:19|20)\d{2})\b/u.exec(title)?.[1];
    if (!edition)
        return null;
    const activity = SCHEDULE.test(title) ? 'schedule' : TICKETS.test(title) ? 'tickets' : OPENING.test(title) ? 'opening' : null;
    if (!activity)
        return null;
    const sport = /\b(?:cricket|rugby|hockey|basketball|baseball)\b/u.exec(title)?.[0] ?? 'unspecified';
    const division = /\b(?:women(?:'s)?|feminin|femenino|feminino|frauen|feminin)\b|女子|女足|여자/u.test(title) ? 'women' : /\b(?:under[ -]?\d{1,2}|u[ -]?\d{1,2})\b/u.exec(title)?.[0] ?? 'open';
    const season = /\b(?:winter|hiver|invierno|inverno|winterspiele|iarna)\b|冬季|冬の|동계|الشتوية/u.test(title) ? 'winter' : /\b(?:summer|ete|verano|verao|sommerspiele|vara)\b|夏季|夏の|하계|الصيفية/u.test(title) ? 'summer' : 'unspecified';
    const youth = /\b(?:youth|jeunesse|juventud|juventude|jugend|tineret)\b|ユース|青年|청소년|للشباب/u.test(title);
    return { key: key('tournament', tournament, edition, season, youth, sport, division, activity), basis: 'shared-event', strong: true };
}
const STORM_GENERIC = new Set(['warning', 'warnings', 'season', 'forecast', 'forecasts', 'damage', 'insurance', 'research', 'names', 'name', 'named', 'response', 'relief', 'risk', 'risks', 'alert', 'alerts', 'watch', 'watches', 'deaths', 'survivors', 'victims', 'nears', 'approaches', 'hits', 'strikes', 'makes', 'could', 'may', 'will', 'expected', 'new', 'a', 'the', 'un', 'une', 'el', 'la', 'de', 'del', 'en']);
const STORM_REPORT = /^(?:['’]s\s+)?(?:approach(?:es|ing)?|near(?:s|ing)?|hit(?:s|ting)?|strik(?:e|es|ing)|struck|mak(?:e|es|ing)|made|mov(?:e|es|ing)|head(?:s|ing)?|kill(?:s|ed)?|leaves?|left|death toll|damage|forecast|landfall|track|path|evacuat(?:e|es|ion)|impact|warning|winds?|rain|flood(?:s|ing)?|weaken(?:s|ed)?|strengthen(?:s|ed)?|becomes?|expected|could|may|will|is|was|has|devastat(?:es|ed)|destroy(?:s|ed)?|batter(?:s|ed)?|provoque|fait|touche|frappe|approche|cause|provoque|provoca|azota|deja|atinge|trifft|richtet|aduce|provoaca)\b/u;
function stormAnchor(card, title) {
    const year = publicationYear(card);
    if (!year)
        return null;
    const printed = card.title.normalize('NFKC').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
    // Require a printed proper name, not the next lower-case verb ("cyclone kills").
    // All-capital prose without an identifiable name stays ungrouped.
    const matches = [];
    for (const match of printed.matchAll(/\b(?:hurricane|tropical storm|typhoon|cyclone|ouragan|typhon|huracan|ciclon|furacao|tufao|taifun|zyklon|uragan)\s+([\p{L}][\p{L}'’-]{1,30})\b/giu)) {
        const name = match[1] ?? '';
        if (!/^\p{Lu}[\p{Ll}\p{M}]+(?:[-'’]\p{Lu}?[\p{Ll}\p{M}]+)*$/u.test(name) || STORM_GENERIC.has(text(name)))
            continue;
        const after = text(printed.slice((match.index ?? 0) + match[0].length)), before = printed.slice(0, match.index ?? 0);
        const explicit = /^((?:18|19|20)\d{2})\b/u.exec(after)?.[1] ?? /\b((?:18|19|20)\d{2})\s*$/u.exec(before)?.[1];
        const report = after.replace(/^(?:18|19|20)\d{2}\b\s*/u, '');
        // In Title Case "Cyclone Kills 12" still has no name + weather predicate.
        if (!STORM_REPORT.test(report) && !/^[:;,—-]/u.test(report))
            continue;
        matches.push(JSON.stringify([text(name), explicit ?? year]));
    }
    const names = [...new Set(matches)];
    if (names.length !== 1)
        return null;
    // A name identifies this year's storm thread; forecasts, landfall and updated
    // damage counts remain separate original reports within that thread.
    return { key: key('named-storm', names[0]), basis: 'shared-event', strong: true };
}
const PRODUCT_LAUNCH = /\b(?:launch(?:es|ed|ing)?|unveil(?:s|ed)?|introduc(?:e|es|ed)|releas(?:e|es|ed)|debut(?:s|ed)?|lance|lancent|lancement|devoile|devoilent|sortie|lanza|lanzamiento|presenta|lanca|lancamento|apresenta|erschein(?:t|en)|veroffentlicht|stellt vor|lanseaza|lansare|prezinta)\b|発売|発表|发布|發佈|推出|출시|공개|إطلاق|يطلق/u;
const PRODUCT_RECALL = /\b(?:recall(?:s|ed)?|rappel(?:e)?|retire du marche|retirada|recolhimento|ruckruf|rechemare)\b|リコール|召回|리콜|استدعاء/u;
const PRODUCT_REVIEW = /\b(?:review|reviews|comparison|compared|versus|vs|buying guide|testbericht|comparatif|comparacion|recenzie)\b|レビュー|比較|评测|評測|리뷰|비교/u;
const REVENUE_CONTEXT = /\b(?:earned|made|grossed|generated|revenue|billion|million|bn|estimated?|projected)\b/u;
const GENERIC_MODELS = new Set(['version', 'model', 'series', 'flight', 'mission', 'launch', 'chapter', 'section', 'article', 'day', 'week', 'month', 'year', 'part', 'episode', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'cop', 'unga', 'g', 'world', 'cup', 'olympics', 'top']);
const PRODUCT_TAIL = /^(?:["'”’\s]*$|["'”’\s]*[.!?:,;—-]|["'”’\s]+(?:with|without|featuring|at|in|on|for|today|tomorrow|soon|globally|worldwide|avec|sans|con|sin|com|sem|mit|ohne|cu|fara)\b)/u;
function directProductAction(before, after, action) {
    const preceding = new RegExp(`(?:${action.source})(?:\\s+(?:the|a|an|its|new|next|latest|flagship|le|la|les|un|une|nouveau|nouvelle|el|los|una|nuevo|nueva|o|os|um|uma|novo|nova|das|die|der|neue|neuen|un|o|noul|noua)){0,5}[\\s"'“”‘’]*$`, 'u');
    const following = new RegExp(`^[\\s"'“”‘’]*(?:(?:is|are|was|were|be|been|being|will|would|could|may|might|has|have|had|not|never|finally|now|officially|est|sera|ete|pas|n'est|es|fue|sera|nao|e|wird|ist|nicht|este|va|fi|nu)\\s+){0,5}(?:${action.source})`, 'u');
    return preceding.test(before) && PRODUCT_TAIL.test(after) || following.test(after)
        || /^[\s"'“”‘’]*(?:を|が)?(?:発売|発表|发布|發佈|推出|출시|공개|リコール|召回|리콜)/u.test(after);
}
function productNames(raw, title) {
    const names = new Set();
    if (/\b(?:grand theft auto|gta)\s*(?:6|vi)\b/u.test(title))
        names.add('grand theft auto 6');
    for (const match of title.matchAll(/\b(iphone|ipad|pixel|windows|playstation|galaxy [asz])\s*(\d{1,3}(?:\.\d{1,2})?)(?:\s+(pro|max|ultra|mini))?\b/gu))
        names.add(`${match[1]} ${match[2]}${match[3] ? ' ' + match[3] : ''}`);
    // A distinctive printed model/version can be recognized without a company list.
    for (const match of raw.normalize('NFKC').matchAll(/(?<![\p{L}\p{N}])([\p{L}][\p{L}-]{1,24})[ -]*(\d{1,3}(?:\.\d{1,2}){0,2})(?:\s+(Pro|Max|Ultra|Mini))?(?![\p{L}\p{N}])/gu)) {
        const name = match[1] ?? '', folded = text(name);
        if (!/\p{Lu}/u.test(name) || GENERIC_MODELS.has(folded))
            continue;
        names.add(`${folded} ${match[2]}${match[3] ? ' ' + text(match[3]) : ''}`);
    }
    // Quoted, short product names are explicit wording, never inferred aliases.
    for (const match of raw.matchAll(/[“"‘]([^”"’]{3,50})[”"’]/gu)) {
        const name = text(match[1] ?? '');
        if (name.split(' ').length <= 5 && /^[\p{L}\p{N} &'’-]+$/u.test(name) && !/\b(?:not|no|never|new|launch|release|announces?|says?|claims?)\b/u.test(name))
            names.add(name);
    }
    // Known alias and generic token extraction must not fabricate two products.
    if (names.has('grand theft auto 6')) {
        names.delete('gta 6');
        names.delete('auto 6');
    }
    return [...names];
}
function productAnchor(card, title) {
    if (PRODUCT_REVIEW.test(title) || REVENUE_CONTEXT.test(title) || card.topic === 'space' || /\b(?:rocket|spacecraft|satellite|orbital|space mission|launch pad|booster|payload)\b/u.test(title))
        return null;
    const launch = PRODUCT_LAUNCH.test(title), recall = PRODUCT_RECALL.test(title);
    if (launch === recall)
        return null;
    const names = productNames(card.title, title);
    if (names.length !== 1)
        return null;
    const name = names[0] ?? '', escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&').replace(/ /gu, '[ -]*');
    const mention = name === 'grand theft auto 6' ? /\b(?:grand theft auto|gta)\s*(?:6|vi)\b/u.exec(title) : new RegExp(escaped, 'u').exec(title);
    if (!mention)
        return null;
    const before = title.slice(0, mention.index), after = title.slice(mention.index + mention[0].length);
    // Compatibility/possessive wording makes the named model a target, not the
    // launched object: a new case "for iPhone 18" is not the iPhone launch.
    if (/\b(?:for|pour|para|fur|pentru|compatible with|compatible avec|compatible con|works with|designed for)\b[\p{L}\p{N} '"-]{0,35}$/u.test(before)
        || /^[\s'’:-]*(?:cases?|covers?|chargers?|adapters?|accessories|accessory|cables?|keyboards?|screen protectors?|skins?|docks?)\b|^(?:向け|用|対応)/u.test(after))
        return null;
    if (!directProductAction(before, after, launch ? PRODUCT_LAUNCH : PRODUCT_RECALL))
        return null;
    return { key: key('product', name, launch ? 'release' : 'recall'), basis: 'shared-event', strong: launch };
}
/** A specific personal narrative in a newly reported documentary, not all coverage of that person. */
function documentaryNarrativeAnchor(card, title) {
    if (!/\b(?:new|latest) documentary\b/u.test(title))
        return null;
    const printed = card.title.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    // A desk/role prefix is not an alias for a person. Both records must print the
    // same complete subject after that prefix; matching a first name is insufficient.
    const body = printed.replace(/^[^:]{1,80}:\s*/u, '');
    const name = "(\\p{Lu}[\\p{L}\\p{M}'’.-]*(?: \\p{Lu}[\\p{L}\\p{M}'’.-]*){0,3})";
    const possessive = new RegExp(`^${name}['’]s (.{3,65}?) (?:is |was |will be )?(?:depicted|portrayed|recounted|explored|examined|told|featured) in (?:a |the )?(?:new|latest) documentary\\b`, 'u').exec(body);
    const spoken = new RegExp(`^${name} (?:talks|speaks|opens up|recounts|reflects|shares|discusses)(?: about| on)? (?:his |her |their )?(.{3,65}?) in (?:a |the )?(?:new|latest) documentary\\b`, 'u').exec(body);
    const match = possessive ?? spoken;
    if (!match)
        return null;
    const subject = text(match[1] ?? ''), narrative = text(match[2] ?? '');
    const words = narrative.split(' ');
    if (words.length < 2 || words.length > 7 || !/\b(?:journey|recovery|battle|experience|career|campaign|story)$/u.test(narrative)
        || /^(?:(?:personal|life|own|full|untold|incredible|amazing|inspiring|inspirational|remarkable|extraordinary|latest|new) )+(?:journey|recovery|battle|experience|career|campaign|story)$/u.test(narrative))
        return null;
    return { key: key('documentary-narrative', subject, narrative, 'new-documentary'), basis: 'shared-event', strong: false };
}
// A dated result is an identified draw, not all reporting about a lottery.
// Dates are printed in the original headline; publication time is never a substitute.
const DRAW_MONTH_NAMES = [
    [1, 'january ianuarie janvier enero janeiro gennaio januar'], [2, 'february februarie fevrier febrero fevereiro febbraio februar'],
    [3, 'march martie mars marzo marco marz'], [4, 'april aprilie avril abril aprile'],
    [5, 'may mai mayo maio maggio'], [6, 'june iunie juin junio junho giugno juni'],
    [7, 'july iulie juillet julio julho luglio juli'], [8, 'august aout agosto'],
    [9, 'september septembrie septembre septiembre setembro settembre'], [10, 'october octombrie octobre octubre outubro ottobre oktober'],
    [11, 'november noiembrie novembre noviembre novembro'], [12, 'december decembrie decembre diciembre dezembro dicembre dezember'],
];
const DRAW_MONTHS = new Map(DRAW_MONTH_NAMES.flatMap(([month, names]) => names.split(' ').map(name => [name, month])));
const DRAW_MONTH_PATTERN = [...DRAW_MONTHS.keys()].join('|');
function drawDate(year, month, day) {
    if (!Number.isSafeInteger(year) || year < 1900 || year > 2099 || !Number.isSafeInteger(month) || month < 1 || month > 12 || !Number.isSafeInteger(day) || day < 1 || day > 31)
        return null;
    const value = new Date(Date.UTC(year, month - 1, day));
    return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value.toISOString().slice(0, 10) : null;
}
function explicitDrawDate(title) {
    const values = [];
    const add = (match, date) => { const index = match.index ?? -1; values.push({ date, index, end: index + match[0].length }); };
    for (const match of title.matchAll(/\b((?:19|20)\d{2})-(\d{2})-(\d{2})\b/gu))
        add(match, drawDate(Number(match[1]), Number(match[2]), Number(match[3])));
    for (const match of title.matchAll(/\b(\d{1,2})\.(\d{1,2})\.((?:19|20)\d{2})\b/gu))
        add(match, drawDate(Number(match[3]), Number(match[2]), Number(match[1])));
    for (const match of title.matchAll(new RegExp('\\b(\\d{1,2})\\.?\\s+(' + DRAW_MONTH_PATTERN + ')\\s+((?:19|20)\\d{2})\\b', 'gu')))
        add(match, drawDate(Number(match[3]), DRAW_MONTHS.get(match[2] ?? '') ?? 0, Number(match[1])));
    for (const match of title.matchAll(new RegExp('\\b(' + DRAW_MONTH_PATTERN + ')\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b', 'gu')))
        add(match, drawDate(Number(match[3]), DRAW_MONTHS.get(match[1] ?? '') ?? 0, Number(match[2])));
    const value = values[0];
    return values.length === 1 && value?.date !== null && value !== undefined && value.index >= 0 ? { date: value.date, index: value.index, end: value.end } : null;
}
const DRAW_DATE_CONNECTORS = new Set('for on of the du del de do da des am vom din draw tirage extragerea estrazione ziehung sunday monday tuesday wednesday thursday friday saturday dimanche lundi mardi mercredi jeudi vendredi samedi duminica luni marti miercuri joi vineri sambata'.split(' '));
/** The full date must follow the results/game phrase, not an update date later in a story. */
function drawDateFollows(title, prefixLength, printed) {
    if (printed.index < prefixLength)
        return false;
    const between = title.slice(prefixLength, printed.index);
    if (between.length > 70 || /[^\p{L}\s,:-]/u.test(between))
        return false;
    const words = between.replace(/[,:-]/gu, ' ').trim().split(/\s+/u).filter(Boolean);
    return words.length <= 6 && words.every(word => DRAW_DATE_CONNECTORS.has(word));
}
/** This reviewed Romanian results series identifies the operator even when the title omits it.
 * Its printed URL date must equal the headline date; host, path and identity are exact.
 * Evidence: HotNews /rezultatele-loto-6-din-49-din-22-noiembrie-2026-2410659.
 */
function reviewedRomanianDrawSeries(card, date) {
    if (card.identity !== card.sourceUrl)
        return false;
    try {
        const url = new URL(card.sourceUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'hotnews.ro' || url.port || url.username || url.password || url.search || url.hash)
            return false;
        const match = /^\/rezultatele-loto-6-din-49-din-(\d{1,2})-([a-z]+)-((?:19|20)\d{2})-\d{5,12}\/?$/u.exec(url.pathname);
        return match !== null && drawDate(Number(match[3]), DRAW_MONTHS.get(match[2] ?? '') ?? 0, Number(match[1])) === date;
    }
    catch {
        return false;
    }
}
function lotteryDrawAnchor(card, title) {
    const printed = explicitDrawDate(title);
    if (printed === null)
        return null;
    const date = printed.date;
    const games = [
        /\beuro\s?millions\b/u.test(title) ? 'euromillions' : null,
        /\beuro\s?jackpot\b/u.test(title) ? 'eurojackpot' : null,
        /\bmega\s?millions\b/u.test(title) ? 'mega-millions' : null,
    ].filter((value) => value !== null);
    if (games.length > 1)
        return null;
    if (games.length === 1) {
        const result = '(?:results?|resultats?|resultados?|risultati|ergebnisse|rezultate(?:le)?)';
        const game = '(?:euro\\s?millions|euro\\s?jackpot|mega\\s?millions)';
        const lead = new RegExp('^(?:' + game + '\\s+' + result + '|' + result + '(?:\\s+(?:for|de|del|do|da|du|des|von|la))?\\s+' + game + ')\\b', 'u').exec(title);
        // Whole-headline recognition deliberately rejects arbitrary tails: previews,
        // special draws, corrections and comparisons cannot borrow a standard draw key.
        if (!lead || !drawDateFollows(title, lead[0].length, printed) || !/^[\s.!]*$/u.test(title.slice(printed.end)))
            return null;
        return { key: key('lottery-draw', games[0], date, 'standard'), basis: 'shared-event', strong: true };
    }
    const lead = /^rezultate(?:le)?(?:\s+la)?\s+loto\b/u.exec(title);
    if (!lead || !drawDateFollows(title, lead[0].length, printed) || contextForCard(card).countries.some(country => country.code !== 'RO'))
        return null;
    // These complete, reviewed result templates identify the operator and daily
    // aggregate draw. Unknown suffixes or another named game/operator stay separate.
    const reviewedSeries = reviewedRomanianDrawSeries(card, date);
    const rawSuffix = title.slice(printed.end).replace(/^[\s.:-]+|[\s.!]+$/gu, '');
    // The reviewed publisher's HTML headline may include this exact site-name suffix.
    const suffix = reviewedSeries ? rawSuffix.replace(/\s+-\s+hotnews\.ro$/u, '') : rawSuffix;
    const operator = suffix === 'loteria romana' || suffix === 'numerele extrase si premiile puse in joc de loteria romana';
    if (!operator && suffix !== '' && suffix !== 'numerele castigatoare la extragerea de azi')
        return null;
    if (!operator && !reviewedSeries)
        return null;
    return { key: key('lottery-draw', 'ro-lottery-results', date, 'standard'), basis: 'shared-event', strong: true };
}
/**
 * Conservative Romanian reported-penalty paraphrases. An identical distinctive
 * actor, positive numeric penalty and concrete cause are required. This is a
 * headline match in the existing fixed time window, not inferred case identity.
 */
function reportedPenaltyAnchor(card, title) {
    const publisherSuffix = ' - ' + text(card.publisher);
    let headline = title.endsWith(publisherSuffix) ? title.slice(0, -publisherSuffix.length) : title;
    headline = headline.replace(/[.!]?\s+(?:video|foto)$/u, '').trim();
    if (/\b(?:nu|nici|fals|falsa|zvon|zvonuri|neaga|negat|dezminte|achitat(?:a|i|e)?|achitare|anulat(?:a|i|e)?|anulare|revocat(?:a|i|e)?|revocare|apel|recurs|contestat(?:a|i|e)?|contestatie|acuzat(?:a|i|e)?|acuzatie|risca|riscand|cerut|cere|solicita|propus|propune|ar|putea|va|vor|urmeaza|biciuit(?:a|i|e)?|executat(?:a|i|e)?|aplicat(?:a|i|e)?|documentar|retrospectiva|aniversare)\b/u.test(headline))
        return null;
    const match = /^(.{8,160}?)\s+(?:(?:a|au)\s+fost\s+)?(?:pedepsit(?:a|i|e)?|condamnat(?:a|i|e)?|(?:a|au)\s+primit)\s+(?:cu\s+|la\s+)?(\d{1,4})\s+(?:de\s+)?(lovituri de bici|ani de inchisoare|luni de inchisoare)\s+(?:pentru|din cauza)\s+(?:(?:un|o|unui|unei)\s+)?(.+)$/u.exec(headline);
    if (!match || Number(match[2]) <= 0 || [...headline.matchAll(/\b\d+\b/gu)].length !== 1)
        return null;
    const actor = (match[1] ?? '').replace(/[,\s]+$/u, '').replace(/^(?:un|o)\s+/u, '')
        .replace(/\s+si (?:membrii|membrele) (?:trupei|echipei) sale$/u, '');
    const words = actor.match(/\p{L}+/gu) ?? [];
    if (actor.length < 12 || words.length < 2 || new Set(words).size < 2 || !/^[\p{L}][\p{L} '.-]+$/u.test(actor)
        || /^(?:barbat|femeie|persoana|om|oameni|tanar|tanara|minor|minora|copil|alta?|inca)\b/u.test(actor))
        return null;
    // Remove only presentation/channel/clothing adjuncts observed in these
    // equivalent report forms. Names, places, other causes and extra numbers stay distinct.
    const cause = (match[4] ?? '').replace(/[.!]+$/u, '').replace(/\s+pe youtube\b/gu, '')
        .replace(/\s+fara (?:valul islamic|val islamic|valul|val|hijabul|hijab)\b/gu, '').replace(/\s+/gu, ' ').trim();
    if (cause.length < 4 || cause.length > 140 || !/^[\p{L}][\p{L} '-]+$/u.test(cause))
        return null;
    return { key: key('reported-penalty', 'ro', actor, Number(match[2]), match[3], cause, countries(card), card.summary === undefined ? '' : text(card.summary)),
        basis: 'matching-headlines', strong: false };
}
/**
 * A discovery thread needs the same explicit named trench as well as the rare
 * reported record. Publisher subject metadata is accepted only for its bound
 * original URL. Generic ocean/underwater labels never supply a named location.
 */
function deepestVolcanicDiscoveryAnchor(card, title) {
    if (!/\bworld'?s deepest explosive volcanic (?:activity|eruptions?)\b/u.test(title)
        || !/\b(?:finds?|found|discover(?:s|ed)|uncover(?:s|ed))\b/u.test(title)
        || /\b(?:not|never|no|may|might|could|would|possible|possibly|potential|expected|proposed|search|searches|searching|seeks|seeking|claims?|claimed|alleged|disputed|challenged|false|falsely|simulation|simulated|modelled|modeled|fiction|fictional|second|another|additional|previously|earlier|old|historic|historical|revisited|already|decades?|years?)\b/u.test(title)
        || /\b(?:18|19|20)\d{2}\b/u.test(title))
        return null;
    const generic = new Set(['ocean', 'oceanic', 'deep', 'deepest', 'deep ocean', 'deep-sea', 'deep sea', 'sea', 'undersea', 'underwater', 'deepwater', 'submarine', 'volcanic', 'active', 'remote', 'unnamed', 'unknown', 'unidentified', 'ancient']);
    const names = new Set();
    const add = (value) => {
        const name = text(value).replace(/^(?:the|an?) /u, '');
        if (name.length >= 3 && name.length <= 60 && name.split(' ').length <= 5 && !generic.has(name)
            && !name.replace(/-/gu, ' ').split(' ').every(word => generic.has(word))
            && /^[\p{L}][\p{L}' -]+$/u.test(name))
            names.add(name);
    };
    const printed = card.title.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    for (const match of printed.matchAll(/\b(?:[Ii]n|[Aa]t|[Bb]eneath|[Nn]ear) (?:the |an? )?(\p{Lu}[\p{L}\p{M}'’.-]*(?: \p{Lu}[\p{L}\p{M}'’.-]*){0,4}) [Tt]rench\b/gu))
        add(match[1] ?? '');
    if (validArticleSubject(card.articleSubject, card.sourceUrl)) {
        for (const keyword of card.articleSubject.keywords) {
            const match = /^([\p{L}][\p{L}' -]{1,60}) trench$/u.exec(text(keyword));
            if (match)
                add(match[1] ?? '');
        }
    }
    if (names.size !== 1)
        return null;
    return { key: key('volcanic-discovery', 'world-deepest-explosive', [...names][0], countries(card), card.summary === undefined ? '' : text(card.summary)),
        basis: 'shared-event', strong: false };
}
function aidParty(value) {
    const printed = value.normalize('NFKC').trim();
    return /^\p{Lu}[\p{L}\p{M}'’.-]*(?: \p{Lu}[\p{L}\p{M}'’.-]*){0,4}$/u.test(printed) ? text(printed) : null;
}
/**
 * Same-day aid-pledge coverage is an event thread, not an assertion that quoted
 * sums or currencies agree. Keep every original sum; never convert currencies.
 * Separate/additional rounds, a different donor/recipient/disaster or phase
 * cannot borrow this key.
 */
function disasterAidPledgeAnchor(card, title) {
    if (/\b(?:not|never|no|denies?|denied|false|falsely|alleged|reportedly|may|might|could|would|conditional|conditionally|additional|another|second|third|separate|extra|more|further|renewed|renewal|reiterates|reiterated|repeat|repeated|fresh|loan|loans|military|weapons|insurance)\b/u.test(title))
        return null;
    const printed = card.title.normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const lead = /^(.{2,70}?) pledges ((?:US\$|USD|EUR|GBP|\$|€|£)\s*(\d+(?:\.\d+)?)\s*(?:bn|billion|m|million)) (.+)$/u.exec(printed);
    if (!lead || !Number.isFinite(Number(lead[3])) || Number(lead[3]) <= 0)
        return null;
    const donor = aidParty(lead[1] ?? '');
    if (donor === null)
        return null;
    const tail = lead[4] ?? '';
    const relief = /^in (flood|earthquake|wildfire|tsunami) relief for (.{2,70}?)(?: as (.{2,70}?) visits (.{2,70}?))?[.!]?$/u.exec(tail);
    const rebuild = /^to help (.{2,70}?) rebuild after (?:a |the )?(?:(?:deadly|devastating|catastrophic) )?(?:glacier )?(flood|earthquake|wildfire|tsunami)[.!]?$/u.exec(tail);
    let recipient = null, hazard = null;
    if (relief) {
        recipient = aidParty(relief[2] ?? '');
        hazard = relief[1] ?? null;
        if (relief[3] !== undefined && (aidParty(relief[3]) === null || aidParty(relief[4] ?? '') === null))
            return null;
    }
    else if (rebuild) {
        recipient = aidParty(rebuild[1] ?? '');
        hazard = rebuild[2] ?? null;
    }
    if (recipient === null || hazard === null || recipient === donor)
        return null;
    const day = new Date(card.date).toISOString().slice(0, 10);
    return { key: key('disaster-aid-pledge', donor, recipient, hazard, day, countries(card), card.summary === undefined ? '' : text(card.summary)),
        basis: 'shared-event', strong: false };
}
/** Identical checked BBC article editions retain their original URLs and metadata.
 * Observed in public corpus1589: www.bbc.com and www.bbc.co.uk /news/articles/
 * use the same explicit article ID, headline and publication time.
 * This fallback is narrower than lowering headline-length safety thresholds.
 */
function reviewedArticleAnchor(card, title) {
    if (card.publisher !== 'BBC' || card.identity !== card.sourceUrl)
        return null;
    try {
        const url = new URL(card.sourceUrl);
        if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash
            || !['www.bbc.com', 'www.bbc.co.uk'].includes(url.hostname))
            return null;
        const match = /^\/news\/articles\/(c[a-z0-9]{12})$/u.exec(url.pathname);
        if (!match)
            return null;
        return { key: key('publisher-article', 'bbc', match[1], title, card.date, card.summary === undefined ? '' : text(card.summary), countries(card)), basis: 'matching-headlines', strong: false };
    }
    catch {
        return null;
    }
}
const ROMANIAN_OBSERVED_NAME = "\\p{Lu}[\\p{L}\\p{M}'’-]+(?:[ -]\\p{Lu}[\\p{L}\\p{M}'’-]+){1,3}";
const ROMANIAN_OBSERVED_PLACE = "\\p{Lu}[\\p{L}\\p{M}'’-]+(?:[ -]\\p{Lu}[\\p{L}\\p{M}'’-]+){0,3}";
const ROMANIAN_OBSERVED_UNCERTAIN = /\b(?:nu|nici|fals|falsa|zvon|zvonuri|neaga|dezminte|daca|ar|poate|posibil|posibila|urmeaza|va|vor|asteptat|asteptata|asteapta|retrospectiva|aniversare)\b/u;
const ROMANIAN_OBSERVED_OTHER = /\b(?:alt|alta|altul|nou|noua|al doilea|a doua|din nou|inca un|anul trecut|in urma cu)\b/u;
function romanianObservedPrinted(value) {
    return value.normalize('NFKC').normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').replace(/\s+/gu, ' ').trim();
}
function romanianObservedIdentity(record, kind, core, detail) {
    const window = Math.floor(Date.parse(record.date) / WINDOW_MS), printedDate = explicitDrawDate(text(record.title))?.date ?? '';
    const anchorKey = detail === null ? null : key('ro-explicit-incident', kind, core, detail, record.countries, printedDate);
    return { base: key('ro-incident-candidate', kind, core, record.countries, printedDate, window), anchorKey,
        completeKey: anchorKey === null ? null : key('window', anchorKey, window) };
}
function romanianObservedCourt(record, printed, title) {
    if (ROMANIAN_OBSERVED_UNCERTAIN.test(title) || ROMANIAN_OBSERVED_OTHER.test(title)
        || /\b(?:control judiciar|revocat|revocare|achitat|achitare|amanat|amanare|prelungit|prelungire|mentinut|mentine|rejudecare|a depus|a formulat|contesta|ataca decizia|a admis contestatia)\b/u.test(title))
        return null;
    const courts = [...printed.matchAll(new RegExp('\\b[Cc]urtea de [Aa]pel(?: (?:din )?(' + ROMANIAN_OBSERVED_PLACE + '))?', 'gu'))];
    if (courts.length !== 1 || !/\barest(?:ul)? la domiciliu\b/u.test(title))
        return null;
    const front = new RegExp('^(' + ROMANIAN_OBSERVED_NAME + '),\\s*(?:(?:a fost )?plasat in|in) arest la domiciliu[.!]', 'u').exec(printed);
    const subject = new RegExp('\\bin cazul lui (' + ROMANIAN_OBSERVED_NAME + ')(?:[.!]|$)', 'u').exec(printed);
    const names = [...new Set([front?.[1], subject?.[1]].filter((name) => name !== undefined).map(text))];
    if (names.length !== 1)
        return null;
    const court = courts[0], after = text(printed.slice((court.index ?? 0) + court[0].length));
    const replacement = /^a decis(?:, definitiv,)? sa inlocuiasca arestul preventiv cu arestul la domiciliu\b/u.test(after) && subject !== null;
    const release = /^a decis(?:, definitiv,)? sa-l elibereze din arestul central\b/u.test(after) && front !== null;
    // A dismissed challenge is part of the same explicitly printed positive custody outcome;
    // filing/admitting a challenge or an unspecified appeal never supplies this anchor.
    const rejectedChallenge = /^a respins contestatia\b/u.test(after) && front !== null;
    if (!replacement && !release && !rejectedChallenge)
        return null;
    return romanianObservedIdentity(record, 'appeal-court-house-arrest', names[0], court[1] === undefined ? null : text(court[1]));
}
function romanianObservedHotelFire(record, printed, title) {
    const status = title.replace(/\bnu se mai manifesta cu flacara deschisa\b/u, 'fara flacara deschisa');
    if (ROMANIAN_OBSERVED_UNCERTAIN.test(status) || ROMANIAN_OBSERVED_OTHER.test(title)
        || /\b(?:alarma falsa|exercitiu|simulare|anchet\w*|investig\w*|redeschid\w*|renov\w*|reconstr\w*|despagub\w*|asigur\w*|proces|procese|arestat\w*)\b/u.test(title)
        || (title.match(/\bhotel(?:ul)?\b/gu) ?? []).length !== 1)
        return null;
    const match = new RegExp('\\b[Hh]otel(?:ul)? (?:((' + ROMANIAN_OBSERVED_PLACE + ')) )?din (' + ROMANIAN_OBSERVED_PLACE + ')', 'u').exec(printed);
    if (!match)
        return null;
    const after = text(printed.slice(match.index + match[0].length));
    const burning = /^hotelul\b/u.test(title) && /^(?:inca )?arde\b/u.test(after);
    const reported = /^incendiu(?:l)?(?: puternic)?(?: de)? la (?:un )?hotel(?:ul)?\b/u.test(title);
    if (!burning && !reported)
        return null;
    return romanianObservedIdentity(record, 'hotel-fire', text(match[3] ?? ''), match[1] === undefined ? null : text(match[1]));
}
function romanianObservedIncident(record) {
    if (!record.title.trim() || record.title.length > 4000 || !Number.isFinite(Date.parse(record.date))
        || !/^(?:[A-Z]{2}(?:,[A-Z]{2})*)?$/u.test(record.countries))
        return null;
    const title = text(record.title);
    if (EXPLANATORY.test(title))
        return null;
    // A partial, historical, invalid or conflicting printed date is not an undated current event.
    if (/\b(?:18|19|20)\d{2}\b/u.test(title) && explicitDrawDate(title) === null)
        return null;
    const printed = romanianObservedPrinted(record.title);
    return romanianObservedCourt(record, printed, title) ?? romanianObservedHotelFire(record, printed, title);
}
export function romanianIncidentRecord(card) {
    return { recordKey: 'global:' + card.id, title: card.title, date: card.date, countries: countries(card) };
}
/** A standalone original can claim only its complete printed identity, never a resolved partial. */
export function romanianIncidentThreadKey(record) {
    return romanianObservedIncident(record)?.completeKey ?? null;
}
/** Preserve the existing local/global printed-place guard for the reader and server. */
export function printedLocalIncidentPlace(title, geoAnchors) {
    const normalized = (value) => value.normalize('NFKC').toLowerCase().replace(/[‘’]/gu, "'").replace(/[‐‑‒–—]/gu, '-').replace(/\s+/gu, ' ').trim();
    const headline = ' ' + normalized(title).replace(/[^\p{L}\p{N}]+/gu, ' ') + ' ';
    return geoAnchors.some(anchor => {
        const place = normalized(anchor).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
        return place.length >= 3 && headline.includes(' ' + place + ' ');
    });
}
/** One indexed base can resolve a missing detail only to one complete identity.
 * This is a shared-event inference, not fact equivalence. A partial never supplies a target.
 */
export function resolvedRomanianIncidentKeys(records) {
    if (!Array.isArray(records) || records.length > MAX_RECORDS)
        throw Error('STORY_INPUT_INVALID');
    const variants = new Map();
    for (const record of records) {
        const values = variants.get(record.recordKey) ?? new Set();
        values.add(JSON.stringify(record));
        variants.set(record.recordKey, values);
    }
    const parsed = records.flatMap(record => { const incident = variants.get(record.recordKey)?.size === 1 ? romanianObservedIncident(record) : null; return incident ? [{ record, incident }] : []; });
    const identities = new Map();
    for (const { incident } of parsed) {
        if (incident.completeKey === null)
            continue;
        const values = identities.get(incident.base) ?? new Set();
        values.add(incident.completeKey);
        identities.set(incident.base, values);
    }
    const resolved = new Map();
    for (const { record, incident } of parsed) {
        const candidates = identities.get(incident.base), target = incident.completeKey ?? (candidates?.size === 1 ? [...candidates][0] : undefined);
        if (target !== undefined)
            resolved.set(record.recordKey, target);
    }
    return resolved;
}
function identifiedRomanianIncidentAnchor(card) {
    const incident = romanianObservedIncident(romanianIncidentRecord(card));
    return incident?.anchorKey ? { key: incident.anchorKey, basis: 'shared-event', strong: false } : null;
}
function anchor(card) {
    if (card.kind !== 'publication' || !card.title.trim() || card.title.length > 4000 || !Number.isFinite(Date.parse(card.date)))
        return null;
    const title = text(card.title), revenue = launchRevenueAnchor(card, title);
    if (revenue)
        return revenue;
    const documentary = documentaryNarrativeAnchor(card, title);
    if (documentary)
        return documentary;
    if (!EXPLANATORY.test(title)) {
        const discovery = deepestVolcanicDiscoveryAnchor(card, title);
        if (discovery)
            return discovery;
        const aid = disasterAidPledgeAnchor(card, title);
        if (aid)
            return aid;
        const romanian = identifiedRomanianIncidentAnchor(card);
        if (romanian)
            return romanian;
        const draw = lotteryDrawAnchor(card, title);
        if (draw)
            return draw;
        const penalty = reportedPenaltyAnchor(card, title);
        if (penalty)
            return penalty;
        const vulnerability = [...new Set([...title.matchAll(/\bcve-(\d{4})-(\d{4,7})\b/gu)].map(match => `${match[1]}-${match[2]}`))];
        if (vulnerability.length === 1)
            return { key: key('vulnerability', vulnerability[0]), basis: 'shared-event', strong: true };
        if (vulnerability.length > 1)
            return headlineAnchor(card, title);
        const named = numberedEventAnchor(card, title) ?? stormAnchor(card, title) ?? productAnchor(card, title);
        if (named)
            return named;
    }
    return headlineAnchor(card, title) ?? reviewedArticleAnchor(card, title);
}
function anchoredKey(subject, card) {
    // Weak exact-headline/claim matches have fixed two-day epoch windows. This can
    // conservatively split a boundary-spanning report, but adding/removing another
    // source can never change the key of an existing record.
    return subject.strong ? subject.key : key('window', subject.key, Math.floor(Date.parse(card.date) / WINDOW_MS));
}
/** A shared subject hint is not semantic equivalence, corroboration or verified event identity. */
export function storyThreadKey(card) { const subject = anchor(card); return subject ? anchoredKey(subject, card) : null; }
/** Same ID/identity/URL conflicts are excluded before any presentation grouping. */
function consistentRecords(records) {
    const ids = new Map(), identities = new Map(), urls = new Map();
    const add = (map, id, value) => { const values = map.get(id) ?? new Set(); values.add(value); map.set(id, values); };
    for (const card of records) {
        add(ids, card.id, JSON.stringify([card.identity, card.sourceUrl, card.contentHash]));
        add(identities, card.identity, JSON.stringify([card.sourceUrl, card.contentHash]));
        add(urls, card.sourceUrl, JSON.stringify([card.identity, card.contentHash]));
    }
    const unique = new Map();
    for (const card of records) {
        if (ids.get(card.id)?.size !== 1 || identities.get(card.identity)?.size !== 1 || urls.get(card.sourceUrl)?.size !== 1)
            continue;
        const old = unique.get(card.id);
        if (old === undefined || Date.parse(card.observedAt) > Date.parse(old.observedAt))
            unique.set(card.id, card);
    }
    return [...unique.values()];
}
/**
 * Callers supply their already eligible, source-checked records. This function
 * neither fetches nor adds records, and never changes original text or metadata.
 * Complete records retain an explicit anchor. A reviewed incomplete incident can
 * join only one compatible complete identity; partials cannot supply an inference
 * target or create transitive similarity chains. Named edition identities
 * stay stable through the event; weak matches use fixed two-day windows.
 */
export function groupStories(records, compare = defaultOrder, incidentContext = []) {
    if (!Array.isArray(records) || !Array.isArray(incidentContext) || records.length + incidentContext.length > MAX_RECORDS)
        throw Error('STORY_INPUT_INVALID');
    const consistent = consistentRecords(records), incidents = resolvedRomanianIncidentKeys([...consistent.filter(card => card.kind === 'publication').map(romanianIncidentRecord), ...incidentContext]);
    const completeIncidents = new Set(consistent.filter(card => card.kind === 'publication' && incidents.has('global:' + card.id) && romanianIncidentThreadKey(romanianIncidentRecord(card)) === incidents.get('global:' + card.id)).map(card => card.id));
    const buckets = new Map();
    for (const card of consistent) {
        const incident = card.kind === 'publication' ? incidents.get('global:' + card.id) : undefined;
        const subject = incident ? { key: incident, basis: 'shared-event', strong: true } : anchor(card);
        const id = subject ? anchoredKey(subject, card) : key('record', card.identity, card.sourceUrl), bucket = buckets.get(id) ?? { anchor: subject, cards: [], incident: incident !== undefined };
        bucket.cards.push(card);
        buckets.set(id, bucket);
    }
    const groups = [];
    for (const [id, bucket] of buckets) {
        // A resolved partial remains an original source; the printed complete identity represents the thread.
        const ordered = [...bucket.cards].sort((a, b) => (bucket.incident ? Number(completeIncidents.has(b.id)) - Number(completeIncidents.has(a.id)) : 0) || order(compare, a, b)), primary = ordered[0];
        if (!primary)
            continue;
        groups.push(Object.freeze({ key: id, card: primary, related: Object.freeze(ordered.slice(1)), basis: ordered.length > 1 ? (bucket.anchor?.basis ?? 'matching-headlines') : 'single' }));
    }
    return Object.freeze(groups.sort((a, b) => order(compare, a.card, b.card) || lexical(a.key, b.key)));
}
