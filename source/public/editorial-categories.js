/** Audience-facing editorial categories. Persisted Topic IDs and card hashes stay unchanged. */
export const PUBLIC_EDITORIAL_CATEGORIES = [
    'world', 'business', 'technology', 'money', 'health', 'sport', 'gaming', 'culture', 'shopping', 'travel',
    'work', 'education', 'family', 'science', 'environment', 'public-affairs', 'digital-life', 'food', 'housing', 'weather',
];
export const EDITORIAL_CATEGORIES_VERSION = 'dlkt-public-editorial-categories-4';
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
    const folded = title.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
    const add = (signal, categories, pattern) => { if (categories.includes(category) && pattern.test(folded) && !signals.includes(signal))
        signals.push(signal); };
    add('diplomatic-development', ['world'], /\b(?:cessez-le-feu|accord de paix|negociations? de paix|sommet diplomatique|sommet bilateral)\b|停戦合意|和平合意|首脳会談|核軍縮協議/u);
    add('investigation-or-regulatory-action', ['world', 'public-affairs', 'business', 'money', 'technology', 'digital-life', 'shopping', 'health'], /\b(?:ouvre une enquete|ouvrent une enquete|enquete antitrust|enquete pour|sanctions reglementaires|controle des exportations)\b|独占禁止法違反|当局が調査|規制当局.*調査|輸出規制/u);
    add('policy-change', ['world', 'public-affairs', 'business', 'money', 'work', 'education', 'health', 'environment', 'housing', 'digital-life'], /\b(?:adopte une loi|adoptent une loi|nouvelle loi|nouvelles regles|resultats des elections|interdit|interdisent)\b|法案.*可決|新法.*成立|選挙結果|規制.*導入/u);
    add('product-or-service-change', ['technology', 'gaming', 'shopping', 'travel'], /\b(?:lance|lancent|devoile|devoilent|date de sortie|nouvelle liaison)\b|発売日.*発表|新製品.*発表|新型.*発表|サービス.*開始|新路線.*開設/u);
    add('research-finding', ['science', 'health', 'environment'], /\b(?:decouvrent|decouverte|une etude revele|une etude montre|resultats de l'essai)\b|研究.*発見|研究.*解明|臨床試験.*結果/u);
    add('competition-result', ['sport', 'gaming'], /\b(?:remporte|remportent|record du monde|victoire en finale)\b|優勝|世界新記録|決勝.*勝利/u);
    add('economic-development', ['business', 'money', 'work'], /\b(?:resultats trimestriels|fusion d'entreprises|taux d'interet|accord commercial|droits de douane|introduction en bourse)\b|決算.*発表|企業.*買収|企業.*合併|金利.*引き|貿易協定|関税/u);
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
/** Reviewed language rules preserve original headlines; an unknown subject stays unknown. */
const FRENCH_SUBJECTS = [
    ['gaming', /\b(?:jeux? video|jeu en ligne|esport|playstation|xbox|nintendo|grand theft auto)\b/u],
    ['family', /\b(?:parentalite|conge parental|garde d'enfants|creches?|allaitement|adoption d'enfants|parents adoptifs)\b/u],
    ['shopping', /\b(?:soldes|promotions commerciales|black friday|cyber monday|comparateur de prix|guide d'achat|produits de consommation)\b/u],
    ['sport', /\b(?:football|rugby|tennis|basketball|baseball|cyclisme|natation|athletisme|jeux olympiques|coupe du monde|ligue des champions|formule 1|grand prix|tournoi|sportifs?)\b/u],
    ['weather', /\b(?:ouragans?|typhons?|cyclones?|tornades?|seismes?|tremblements de terre|inondations?|feux de foret|incendies de foret|tsunami|canicules?|alerte meteo|tempetes?|chutes de neige)\b/u],
    ['digital-life', /\b(?:cybersecurite|cyberattaques?|fuite de donnees|fuites de donnees|rancongiciels?|hameconnage|vie privee numerique|droits numeriques|reseaux sociaux|securite en ligne|mots? de passe)\b/u],
    ['health', /\b(?:sante|medecine|medicale?s?|vaccins?|vaccination|hopitaux|hopital|cancer|maladies?|essais? cliniques?|patients?|demence|diabete|premiers secours)\b/u],
    ['science', /\b(?:scientifiques?|recherche scientifique|chercheurs?|astronomie|astrophysique|trous? noirs?|etoiles? a neutrons|physique|chimie|biologie|fossiles?(?!\s+(?:combustibles|energetiques)\b)|archeologie|sonde spatiale|exoplanetes?|telescopes?|astronautes?|galaxies|fusion nucleaire)\b/u],
    ['environment', /\b(?:climat|climatique|environnement|biodiversite|pollution|emissions de carbone|deforestation|energies? renouvelables?|combustibles fossiles|transition energetique)\b/u],
    ['food', /\b(?:alimentation|alimentaire|recettes?|cuisine|restaurants?|agriculture|agriculteurs?|rappel alimentaire|allergenes?)\b/u],
    ['housing', /\b(?:logements?|prix de l'immobilier|loyers?|locataires?|urbanisme|sans-abri|immobilier|prets? immobiliers?)\b/u],
    ['education', /\b(?:education|ecoles?|universites?|etudiants?|bourses? d'etudes|programmes? scolaires?|frais de scolarite|examens? scolaires?|salles? de classe|apprentissage)\b/u],
    ['work', /\b(?:emplois?|chomage|salaries?|travailleurs?|recrutement|licenciements?|conditions de travail|marche du travail|greve)\b/u],
    ['travel', /\b(?:voyages?|tourisme|touristes?|vols? aeriens?|compagnies? aeriennes?|aeroports?|aviation|chemins? de fer|trains?|passeports?|visas?|croisieres?|transports?|circulation routiere|fermetures? de routes?)\b/u],
    ['money', /\b(?:finances? personnelles?|cout de la vie|vie chere|budget des menages|epargne|retraites?|pensions?|cartes? de credit|prix a la consommation|impot sur le revenu)\b/u],
    ['technology', /\b(?:intelligence artificielle|technologies?|logiciels?|semi-conducteurs?|puces? informatiques?|robotique|informatique quantique|smartphones?|ordinateurs?|realite virtuelle)\b/u],
    ['business', /\b(?:economie|economique|entreprises?|benefices?|chiffre d'affaires|marches? boursiers?|investisseurs?|investissements?|inflation|taux d'interet|droits de douane|accords? commerciaux|banques?|guerre des prix)\b/u],
    ['culture', /\b(?:culture|culturel|arts contemporains|biennale|musique|musiciens?|films?|cinema|acteurs?|actrices|television|musees?|patrimoine|festivals?|concerts?|livres?|romans?|theatre|expositions?|photographie)\b/u],
    ['world', /\b(?:guerres?|cessez-le-feu|conflits? armes?|invasion|missiles?|combats|attaques? de drones?|frappes aeriennes|echange de frappes|diplomatie|diplomatique|sommet bilateral|sommet diplomatique|affaires etrangeres|humanitaire|negociations? de paix|sanctions|relations internationales|defense militaire)\b/u],
    ['public-affairs', /\b(?:politique|elections?|presidentielle|legislatives|parlement|senat|president|premier ministre|gouvernement|maire|municipales|justice|tribunal|verdict|proces|jurisprudence|negociations de coalition|manifestations?|manifestants?|manifeste(?:nt)?|mobilisation|loi|legislation|electeurs?|democratie|droits civiques|candidature)\b/u],
];
const JAPANESE_SUBJECTS = [
    ['gaming', /ビデオゲーム|ゲームソフト|ゲーム機|オンラインゲーム|ｅスポーツ|eスポーツ|任天堂|プレイステーション|ニンテンドー/u],
    ['family', /子育て|育児休業|育児休暇|保育所|保育園|児童養護|養子縁組/u],
    ['shopping', /ブラックフライデー|買い物|価格比較|購入ガイド|セール開催|消費者製品/u],
    ['sport', /サッカー|ラグビー|テニス|バスケットボール|野球|五輪|オリンピック|陸上競技|ワールドカップ|水泳|競泳|大相撲|スポーツ/u],
    ['weather', /台風|竜巻|地震|洪水|浸水|豪雨|山火事|津波|猛暑|大雪|暴風|気象警報/u],
    ['digital-life', /サイバー攻撃|サイバーセキュリティ|情報漏えい|情報流出|個人情報.*流出|ランサムウェア|フィッシング|ネット上の安全|パスワード/u],
    ['health', /医療|健康|ワクチン|病院|がん治療|癌|感染症|臨床試験|患者|認知症|糖尿病|救急医療/u],
    ['science', /科学|研究者|天文学|宇宙|ブラックホール|中性子星|物理学|化学|生物学|考古学|探査機|望遠鏡|銀河|核融合/u],
    ['environment', /気候変動|地球温暖化|生物多様性|環境汚染|温室効果ガス|森林破壊|再生可能エネルギー|脱炭素|化石燃料/u],
    ['food', /食品|料理|レシピ|レストラン|農業|食の安全|食物アレルギー/u],
    ['housing', /住宅|家賃|不動産|住宅ローン|入居者|都市計画|ホームレス/u],
    ['education', /教育|学校|大学|学生|奨学金|授業料|入学試験|教室/u],
    ['work', /雇用|失業|従業員|労働者|採用|人員削減|解雇|労働市場|職場環境/u],
    ['travel', /旅行|観光|航空|空港|鉄道|列車|旅券|パスポート|交通|通行止め/u],
    ['money', /家計|生活費|貯蓄|年金|クレジットカード|消費者物価|所得税/u],
    ['technology', /人工知能|半導体|ソフトウェア|ロボット|量子コンピューター|スマートフォン|生成ai|仮想現実/u],
    ['business', /経済|企業|業績|決算|株式市場|株価|投資家|投資|インフレ|金利|関税|貿易協定|銀行/u],
    ['culture', /文化|音楽|映画|俳優|女優|美術館|博物館|文化遺産|コンサート|小説|演劇|展覧会/u],
    ['world', /戦争|停戦|武力紛争|侵攻|ミサイル|空爆|外交|首脳会談|人道支援|和平交渉|経済制裁|国際関係/u],
    ['public-affairs', /政治|選挙|国会|大統領|首相|政府|市長|裁判所|法案|有権者|民主主義|公民権/u],
];
const FRENCH_SECTIONS = Object.freeze({
    economie: 'business', technologie: 'technology', technologies: 'technology', sante: 'health', sports: 'sport', culture: 'culture', voyage: 'travel', education: 'education', sciences: 'science', planete: 'environment', politique: 'public-affairs', cuisine: 'food', meteo: 'weather',
});
function localizedNewsSubject(title, url) {
    if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title) || /^\/japanese(?:\/|$)/u.test(url.pathname)) {
        if (/(?:企業|会社|銀行).*(?:合併|買収)|(?:合併|買収).*(?:企業|会社|銀行)/u.test(title))
            return 'business';
        return JAPANESE_SUBJECTS.find(([, pattern]) => pattern.test(title))?.[0] ?? null;
    }
    if (!/^\/fr(?:\/|$)/u.test(url.pathname))
        return undefined;
    const folded = title.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC').replace(/[’‘]/gu, "'");
    if (/\b(?:energies?|combustibles?) fossiles\b|\bcop\d{2}\b/u.test(folded))
        return 'environment';
    if (/\bfusion\b/u.test(folded) && /\b(?:ecoles?|universites?)\b/u.test(folded) && !/\b(?:entreprises?|banques?|societes?)\b/u.test(folded))
        return 'education';
    if (/\b(?:resultats trimestriels|chiffre d'affaires|introduction en bourse|guerre des prix)\b|\bfusion\b[^.!?]{0,50}\b(?:entreprises?|banques?|societes?)\b/u.test(folded))
        return 'business';
    const category = FRENCH_SUBJECTS.find(([, pattern]) => pattern.test(folded))?.[0];
    if (category)
        return category;
    for (const segment of url.pathname.split('/')) {
        const category = Object.hasOwn(FRENCH_SECTIONS, segment) ? FRENCH_SECTIONS[segment] : undefined;
        if (category)
            return category;
    }
    return null;
}
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
    const localized = localizedNewsSubject(normalized, url);
    if (localized !== undefined)
        return localized;
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
