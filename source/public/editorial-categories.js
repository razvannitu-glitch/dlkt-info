import { weatherSubjectText, hasUnsupportedWeatherDescriptor, hasChildProtectionSubject, hasDiplomaticSummitContext } from './editorial-subject-semantics.js';
/** Audience-facing editorial categories. Persisted Topic IDs and card hashes stay unchanged. */
export const PUBLIC_EDITORIAL_CATEGORIES = [
    'world', 'business', 'technology', 'money', 'health', 'sport', 'gaming', 'culture', 'shopping', 'travel',
    'work', 'education', 'family', 'science', 'environment', 'public-affairs', 'digital-life', 'food', 'housing', 'weather',
];
export const EDITORIAL_CATEGORIES_VERSION = 'dlkt-public-editorial-categories-6';
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
    const summitSubject = /\bsummits?\b/u.test(title) ? englishHeadlineSubject(title) : null;
    // A checked World hint can support an otherwise terse summit title, but an
    // explicit civic/sectoral subject cannot acquire a diplomatic bonus from it.
    const diplomaticSummit = /\bsummits?\b/u.test(title) && (hasDiplomaticSummitContext(title) || summitSubject === null || summitSubject === 'world');
    if (category === 'world' && (diplomaticSummit || /\b(?:nuclear(?:[- ]arms| (?:weapons|disarmament))? talks?|arms[- ]control talks?|peace (?:agreements?|accords?)|ceasefires?)\b/u.test(title)))
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
    add('diplomatic-development', ['world'], /\b(?:alto el fuego|acuerdo de paz|cumbre bilateral|waffenstillstand|friedensabkommen|gipfeltreffen|cessar-fogo|acordo de paz|cimeira bilateral|cupula bilateral)\b|وقف إطلاق النار|اتفاق سلام|قمة ثنائية/u);
    add('investigation-or-regulatory-action', ['world', 'public-affairs', 'business', 'money', 'technology', 'digital-life', 'shopping', 'health'], /\b(?:abre una investigacion|investigacion antimonopolio|kartellverfahren|ermittlungen gegen|abre uma investigacao|investigacao antitruste)\b|تحقيق بشأن|تحقيق لمكافحة الاحتكار/u);
    add('policy-change', ['world', 'public-affairs', 'business', 'money', 'work', 'education', 'health', 'environment', 'housing', 'digital-life'], /\b(?:aprueba una ley|nueva ley|resultados electorales|neues gesetz|wahlergebnis|aprova uma lei|nova lei|resultados eleitorais)\b|قانون جديد|نتائج الانتخابات|البرلمان يقر/u);
    add('product-or-service-change', ['technology', 'gaming', 'shopping', 'travel'], /\b(?:lanza|lanzan|fecha de lanzamiento|nueva ruta|neues produkt|stellt.*vor|erscheinungstermin|lanca|data de lancamento|nova rota)\b|إطلاق منتج|موعد الإصدار|خدمة جديدة|يفتتح خطا/u);
    add('research-finding', ['science', 'health', 'environment'], /\b(?:descubren|estudio revela|forscher entdecken|studie zeigt|descobrem|estudo revela)\b|علماء يكتشفون|دراسة تكشف|نتائج التجربة السريرية/u);
    add('competition-result', ['sport', 'gaming'], /\b(?:gana la final|record mundial|gewinnt das finale|weltrekord|vence a final|recorde mundial)\b|يفوز بالنهائي|رقم قياسي عالمي/u);
    add('economic-development', ['business', 'money', 'work'], /\b(?:resultados trimestrales|tipos de interes|acuerdo comercial|aranceles|quartalszahlen|zinssatz|handelsabkommen|resultados trimestrais|taxa de juros|acordo comercial)\b|نتائج مالية|أسعار الفائدة|اتفاق تجاري|رسوم جمركية/u);
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
    ['digital-life', /\b(?:cybersecurity|cyber security|cyber[- ]?attacks?|cyber director|data leaks?|data breach|ransomware|phishing|digital privacy|digital rights|online safety|online child safety|child safety online|child protection online|parental controls?|social media|internet censorship|passwords?)\b/u],
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
    ['world', /\b(?:war|wars|ceasefire|conflict|invasion|missiles?|airstrikes?|air strikes?|diplomatic|diplomacy|bilateral talks|state visits?|foreign affairs|humanitarian|peace talks|peace (?:agreements?|accords?)|nuclear(?:[- ]arms| (?:weapons|disarmament))? talks?|arms[- ]control talks?|sanctions|international relations|border clashes|defen[cs]e)\b/u],
    ['public-affairs', /\b(?:politics|political|elections?|parliament|congress|senate|president|prime minister|government|governor|mayor|republicans?|democrats?|conservatives?|liberals?|maga|(?:left|right)[ -]wing|courts? (?:rules?|rulings?|orders?|judgments?|decisions?|overturns?|upholds?|rejects?|blocks?|hears?)|judicial|judiciary|legislation|legislature|laws?|voters?|democracy|civil rights)\b/u],
];
function matchesSubject(category, pattern, title) {
    // West Bank names a place. Keep any independent banking or economic words in the headline.
    if (category === 'business')
        return pattern.test(title.replace(/\bwest bank\b/gu, ' '));
    if (category === 'weather')
        return pattern.test(weatherSubjectText(title));
    if (category === 'family')
        return pattern.test(title) || hasChildProtectionSubject(title);
    if (category === 'world')
        return pattern.test(title) || hasDiplomaticSummitContext(title);
    return pattern.test(title);
}
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
const SPANISH_SUBJECTS = [
    ['gaming', /\b(?:videojuegos?|deportes electronicos|playstation|xbox|nintendo|gta (?:vi|6))\b/u],
    ['family', /\b(?:crianza|permiso parental|licencia parental|guarderias?|lactancia|adopcion de menores|cuidado infantil)\b/u],
    ['shopping', /\b(?:compras|rebajas|descuentos comerciales|black friday|comparador de precios|guia de compra)\b/u],
    ['sport', /\b(?:futbol|rugby|tenis|baloncesto|beisbol|ciclismo|natacion|atletismo|juegos olimpicos|copa del mundo|liga de campeones|formula 1|deportes?|fifa)\b/u],
    ['weather', /\b(?:huracanes?|tifones?|ciclones?|tornados?|terremotos?|inundaciones?|incendios forestales|tsunami|ola de calor|alerta meteorologica|tormentas?|nevadas?)\b/u],
    ['digital-life', /\b(?:ciberseguridad|ciberataques?|filtracion de datos|robo de datos|ransomware|phishing|privacidad digital|derechos digitales|seguridad en linea|contrasenas?)\b/u],
    ['health', /\b(?:salud|medicina|vacunas?|vacunacion|hospitales?|cancer|enfermedades?|ensayos? clinicos?|pacientes?|demencia|diabetes|cuidados intensivos|primeros auxilios)\b/u],
    ['science', /\b(?:ciencia|cientificos?|investigadores?|astronomia|astrofisica|agujeros? negros?|fisica|quimica|biologia|arqueologia|sonda espacial|exoplanetas?|telescopios?|astronautas?|galaxias|fusion nuclear)\b/u],
    ['environment', /\b(?:clima|climatico|medio ambiente|biodiversidad|contaminacion|emisiones de carbono|deforestacion|energias? renovables?|combustibles fosiles|glaciares|ecosistemas|cop\d{2})\b/u],
    ['food', /\b(?:alimentacion|seguridad alimentaria|recetas?|cocina|restaurantes?|agricultura|agricultores?|alergenos?)\b/u],
    ['housing', /\b(?:viviendas?|alquileres?|inquilinos?|urbanismo|personas sin hogar|inmobiliari[oa]s?|hipotecas?)\b/u],
    ['education', /\b(?:educacion|escuelas?|universidades?|estudiantes?|becas?|matriculas?|programas escolares|aulas?)\b/u],
    ['work', /\b(?:empleos?|desempleo|trabajadores?|contratacion|despidos?|condiciones laborales|mercado laboral|huelga)\b/u],
    ['travel', /\b(?:viajes?|turismo|turistas?|vuelos?|aerolineas?|aeropuertos?|aviacion|ferrocarriles?|trenes?|pasaportes?|visados?|cruceros?|transporte|carreteras?)\b/u],
    ['money', /\b(?:finanzas personales|costo de vida|coste de vida|presupuesto familiar|ahorros?|pensiones?|jubilacion|tarjetas de credito|precios al consumidor|impuesto sobre la renta)\b/u],
    ['technology', /\b(?:inteligencia artificial|tecnologia|software|semiconductores?|chips?|robotica|computacion cuantica|telefonos inteligentes|realidad virtual)\b/u],
    ['business', /\b(?:economia|economico|empresas?|beneficios|ingresos|bolsa de valores|acciones bursatiles|acciones en bolsa|cotizacion de (?:las )?acciones|inversores?|inversiones?|inflacion|tipos de interes|aranceles|acuerdos comerciales|bancos?)\b/u],
    ['culture', /\b(?:cultura|artes|musica|musicos?|orquestas?|peliculas?|cine|actores?|actrices|television|museos?|patrimonio|festivales?|conciertos?|libros?|novelas?|teatro|exposiciones?)\b/u],
    ['world', /\b(?:guerra|alto el fuego|conflicto armado|invasion|misiles?|ataques? aereos?|ataques? con drones|diplomacia|diplomatic[oa]s?|cumbre bilateral|asuntos exteriores|humanitari[oa]s?|negociaciones de paz|sanciones|relaciones internacionales)\b/u],
    ['public-affairs', /\b(?:politica|elecciones|parlamento|senado|presidente|primer ministro|gobierno|alcalde|justicia|tribunal|leyes?|legislacion|votantes|democracia|derechos civiles|candidatos?|coalicion|manifestaciones?|protestas?)\b/u],
];
const GERMAN_SUBJECTS = [
    ['gaming', /\b(?:videospiele?|computerspiele?|gaming|e-sport|playstation|xbox|nintendo)\b/u],
    ['family', /\b(?:elternzeit|kinderbetreuung|kindertagesstatten|erziehung|stillen|adoption von kindern|pflegeeltern)\b/u],
    ['shopping', /\b(?:einkaufen|rabatte?|black friday|preisvergleich|kaufberatung|verbraucherprodukte)\b/u],
    ['sport', /\b(?:fu(?:ss|ß)ball(?:spiel|mannschaft|liga|turnier)?|rugby|tennis|basketball|baseball|radsport|schwimmen|leichtathletik|olympia|olympische spiele|weltmeisterschaft|bundesliga|formel 1|sport)\b/u],
    ['weather', /\b(?:hurrikans?|taifune?|tornados?|erdbeben|uberschwemmungen|hochwasser|waldbrande|tsunami|hitzewelle|unwetter|schneesturm)\b/u],
    ['digital-life', /\b(?:cybersicherheit|cyberangriffe?|datenleck|datendiebstahl|ransomware|phishing|datenschutz|digitale rechte|passworter)\b/u],
    ['health', /\b(?:gesundheit|medizin|impfstoffe?|impfung|krankenhauser|krankenhaus|krebs|krankheiten|klinische studie|patienten|demenz|diabetes|erste hilfe)\b/u],
    ['science', /\b(?:wissenschaft|forscher|forschung|astronomie|astrophysik|schwarze locher|physik|chemie|biologie|archaologie|raumsonde|exoplaneten?|teleskope?|astronauten|galaxien|kernfusion)\b/u],
    ['environment', /\b(?:klima(?:wandel|schutz)?|umwelt|biodiversitat|umweltverschmutzung|co2-emissionen|abholzung|erneuerbare energien|fossile brennstoffe)\b/u],
    ['food', /\b(?:lebensmittel|rezepte?|kochen|restaurants?|landwirtschaft|lebensmittelsicherheit|allergene?)\b/u],
    ['housing', /\b(?:wohnungsmarkt|wohnungen|wohnraum|mieten|mieter|stadtplanung|obdachlosigkeit|immobilien|hypotheken)\b/u],
    ['education', /\b(?:bildung|schulen?|universitaten|universitat|studierende|studenten|stipendien|lehrplan|studiengebuhren|schulunterricht)\b/u],
    ['work', /\b(?:arbeitsplatze|arbeitslosigkeit|arbeitnehmer|beschaftigte|einstellungen|entlassungen|arbeitsbedingungen|arbeitsmarkt|streik)\b/u],
    ['travel', /\b(?:reisen|tourismus|touristen|fluge|fluggesellschaften|flughafen|luftfahrt|eisenbahn|zuge|reisepasse|visa|kreuzfahrten|verkehr|stra(?:ss|ß)ensperrungen)\b/u],
    ['money', /\b(?:private finanzen|lebenshaltungskosten|haushaltsbudget|ersparnisse|renten?|altersvorsorge|kreditkarten|verbraucherpreise|einkommensteuer)\b/u],
    ['technology', /\b(?:kunstliche intelligenz|technologie|software|halbleiter|computerchips|robotik|quantencomputer|smartphones?|virtuelle realitat)\b/u],
    ['business', /\b(?:wirtschaft|unternehmen|gewinne|umsatz|aktienmarkt|aktien|investoren|investitionen|inflation|zinsen|zolle|handelsabkommen|banken)\b/u],
    ['culture', /\b(?:kultur|kunst|musik|musiker|filme?|kino|schauspieler|fernsehen|museum|museen|kulturerbe|festivals?|konzerte?|bucher|romane?|theater|ausstellungen)\b/u],
    ['world', /\b(?:krieg|waffenruhe|waffenstillstand|bewaffneter konflikt|invasion|raketen|luftangriffe?|diplomatie|gipfeltreffen|au(?:ss|ß)enpolitik|humanitare hilfe|friedensverhandlungen|sanktionen)\b/u],
    ['public-affairs', /\b(?:politik|wahlen|parlament|bundestag|prasident|kanzler|regierung|burgermeister|gericht|gesetze?|gesetzgebung|wahler|demokratie|burgerrechte|proteste?)\b/u],
];
const PORTUGUESE_SUBJECTS = [
    ['gaming', /\b(?:videogames?|videojogos?|jogos eletronicos|esportes eletronicos|playstation|xbox|nintendo)\b/u],
    ['family', /\b(?:parentalidade|licenca parental|creches?|amamentacao|adocao de criancas|cuidados infantis)\b/u],
    ['shopping', /\b(?:compras|descontos|black friday|comparacao de precos|guia de compra|produtos de consumo)\b/u],
    ['sport', /\b(?:futebol|rugbi|tenis|basquete|beisebol|ciclismo|natacao|atletismo|jogos olimpicos|copa do mundo|liga dos campeoes|formula 1|esportes?|desportos?|fifa)\b/u],
    ['weather', /\b(?:furacoes|tufao|tornados?|terremotos?|sismos?|inundacoes|enchentes|incendios florestais|tsunami|onda de calor|alerta meteorologico|tempestades?|nevascas?)\b/u],
    ['digital-life', /\b(?:ciberseguranca|ciberataques?|ataques ciberneticos|vazamento de dados|fuga de dados|ransomware|phishing|privacidade digital|direitos digitais|seguranca online|senhas)\b/u],
    ['health', /\b(?:saude|medicina|vacinas?|vacinacao|hospitais|hospital|cancer|cancro|doencas?|ensaios? clinicos?|pacientes?|demencia|diabetes|cuidados intensivos|primeiros socorros)\b/u],
    ['science', /\b(?:ciencia|cientistas?|pesquisa cientifica|astronomia|astrofisica|buracos? negros?|fisica|quimica|biologia|arqueologia|sonda espacial|exoplanetas?|telescopios?|astronautas?|galaxias|fusao nuclear)\b/u],
    ['environment', /\b(?:clima|climatic[oa]s?|meio ambiente|biodiversidade|poluicao|emissoes de carbono|desmatamento|energias? renovaveis|combustiveis fosseis|geleiras|ecossistemas)\b/u],
    ['food', /\b(?:alimentacao|seguranca alimentar|receitas culinarias|culinaria|restaurantes?|agricultura|agricultores?|alergenos?)\b/u],
    ['housing', /\b(?:moradia|habitacao|alugueis|inquilinos|urbanismo|sem-abrigo|imobiliari[oa]s?|hipotecas?)\b/u],
    ['education', /\b(?:educacao|escolas?|universidades?|estudantes?|bolsas de estudo|propinas|mensalidades escolares|curriculo escolar|salas de aula)\b/u],
    ['work', /\b(?:empregos?|desemprego|trabalhadores|contratacao|demissoes|despedimentos|condicoes de trabalho|mercado de trabalho|greve)\b/u],
    ['travel', /\b(?:viagem|viagens|turismo|turistas?|voos?|companhias aereas|aeroportos?|aviacao|ferrovias|trens|comboios|passaportes?|vistos|cruzeiros?|transporte|estradas)\b/u],
    ['money', /\b(?:financas pessoais|custo de vida|orcamento familiar|poupanca|pensoes|aposentadoria|cartoes de credito|precos ao consumidor|imposto de renda)\b/u],
    ['technology', /\b(?:inteligencia artificial|tecnologia|software|semicondutores?|chips?|robotica|computacao quantica|smartphones?|realidade virtual)\b/u],
    ['business', /\b(?:economia|economic[oa]s?|empresas?|lucros?|faturamento|bolsa de valores|acoes|investidores?|investimentos?|inflacao|juros|tarifas|acordos comerciais|bancos?)\b/u],
    ['culture', /\b(?:cultura|artes|musica|musicos?|orquestras?|filmes?|cinema|atores?|atrizes|televisao|museus?|patrimonio|festivais|concertos?|livros?|romances?|teatro|exposicoes)\b/u],
    ['world', /\b(?:guerra|cessar-fogo|conflito armado|invasao|misseis|ataques aereos|diplomacia|diplomatic[oa]s?|cupula bilateral|cimeira bilateral|negociacoes de paz|sancoes|relacoes internacionais)\b/u],
    ['public-affairs', /\b(?:politica|eleicoes|parlamento|senado|presidente|primeiro-ministro|governo|prefeito|justica|tribunal|leis?|legislacao|eleitores|democracia|direitos civis|candidatos?|coligacao|manifestacoes|protestos?)\b/u],
];
const ARABIC_SUBJECTS = [
    ['gaming', /ألعاب الفيديو|العاب الفيديو|ألعاب إلكترونية|الألعاب الإلكترونية|بلايستيشن|نينتندو/u],
    ['family', /تربية الأطفال|تربية الاطفال|إجازة الوالدين|حضانة الأطفال|دور الحضانة|الرضاعة|تبني طفل|تبني الأطفال/u],
    ['shopping', /التسوق|تخفيضات تجارية|الجمعة السوداء|مقارنة الأسعار|دليل الشراء|منتجات استهلاكية/u],
    ['sport', /كرة القدم|كرة السلة|كرة المضرب|التنس|البيسبول|السباحة|ألعاب القوى|الألعاب الأولمبية|كأس العالم|دوري أبطال|الفورمولا|بطولة فرنسا|الفيفا|الرياضة/u],
    ['weather', /إعصار|أعاصير|زلزال|زلازل|فيضانات|حرائق الغابات|تسونامي|موجة حر|عاصفة|عواصف|ثلوج كثيفة/u],
    ['digital-life', /الأمن السيبراني|هجوم سيبراني|هجمات سيبرانية|تسريب بيانات|تسريب البيانات|برمجيات الفدية|التصيد الإلكتروني|الخصوصية الرقمية|الحقوق الرقمية|كلمات المرور/u],
    ['health', /الصحة|الرعاية الصحية|الطب(?!\p{L})|لقاح|لقاحات|تطعيم|مستشفى|مستشفيات|السرطان|أمراض|تجربة سريرية|تجارب سريرية|مرضى|الخرف|السكري|العناية المركزة/u],
    ['science', /علماء|بحث علمي|أبحاث علمية|علم الفلك|الفيزياء|الكيمياء|علم الأحياء|علم الآثار|مسبار فضائي|كوكب خارجي|تلسكوب|رواد الفضاء|مجرات|ثقب أسود|الاندماج النووي/u],
    ['environment', /المناخ|التنوع البيولوجي|التلوث|انبعاثات الكربون|إزالة الغابات|الطاقة المتجددة|الوقود الأحفوري|الاحتباس الحراري/u],
    ['food', /سلامة الغذاء|سلامة الأغذية|وصفات الطبخ|الطهي|المطاعم|الزراعة|المزارعين|حساسية الطعام/u],
    ['housing', /الإسكان|أزمة السكن|إيجارات|الإيجار|المستأجرين|التخطيط العمراني|المشردين|العقارات|الرهن العقاري/u],
    ['education', /التعليم|المدارس|مدارس|الجامعات|جامعة|الطلاب|منح دراسية|المناهج الدراسية|الرسوم الدراسية|الفصول الدراسية/u],
    ['work', /التوظيف|البطالة|الموظفين|العمال|تسريح|سوق العمل|ظروف العمل|إضراب/u],
    ['travel', /السفر|السياحة|السياح|رحلات جوية|الطيران|المطارات|(?:ال|لل)سكك الحديدية|القطارات|جوازات السفر|التأشيرات|النقل العام|إغلاق الطرق/u],
    ['money', /التمويل الشخصي|تكلفة المعيشة|غلاء المعيشة|ميزانية الأسرة|الادخار|المعاشات|التقاعد|بطاقات الائتمان|أسعار المستهلك|ضريبة الدخل/u],
    ['technology', /(?:ال|لل)ذكاء الاصطناعي|ذكاء اصطناعي|التكنولوجيا|البرمجيات|أشباه الموصلات|رقائق الحاسوب|الروبوتات|الحوسبة الكمية|الهواتف الذكية|الواقع الافتراضي/u],
    ['business', /الاقتصاد|اقتصاد|الشركات|أرباح|البورصة|أسهم|المستثمرين|استثمارات|التضخم|أسعار الفائدة|رسوم جمركية|اتفاق تجاري|البنوك/u],
    ['culture', /الثقافة|الفنون|الموسيقى|الموسيقيين|أفلام|فيلم|السينما|الممثلين|التلفزيون|المتاحف|التراث|مهرجان|حفلات موسيقية|رواية|روايات|المسرح|معرض فني/u],
    ['world', /الحرب|حرب|وقف إطلاق النار|نزاع مسلح|غزو|صواريخ|غارات|الدبلوماسية|قمة ثنائية|الشؤون الخارجية|مساعدات إنسانية|مفاوضات السلام|عقوبات|العلاقات الدولية|الجيش|مقاتلات/u],
    ['public-affairs', /السياسة|انتخابات|الانتخابات|البرلمان|مجلس الشيوخ|الرئيس|رئاسة|رئيس الوزراء|الحكومة|حزب|ائتلاف|العمدة|المحكمة|قانون|تشريع|الناخبين|الديمقراطية|الحقوق المدنية|احتجاج|مظاهرات/u],
];
function additionalLocalizedSubject(title, path) {
    const language = /^\/(es|de|pt-br|pt-002|ar)(?:\/|$)/u.exec(path)?.[1];
    if (!language)
        return undefined;
    const folded = title.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
    if (language === 'es') {
        if (/\b(?:resultados trimestrales|beneficios trimestrales|mercados bursatiles|wall street|guerra de precios)\b|\bfusion\b[^.!?]{0,50}\b(?:empresas?|bancos?)\b/u.test(folded))
            return 'business';
        if (/\bciencia ficcion\b/u.test(folded) && /\b(?:peliculas?|cine|novelas?)\b/u.test(folded))
            return 'culture';
        return SPANISH_SUBJECTS.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
    }
    if (language === 'de') {
        if (/\b(?:quartalszahlen|quartalsgewinn|borsengang|preiskrieg)\b/u.test(folded))
            return 'business';
        return GERMAN_SUBJECTS.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
    }
    if (language === 'ar') {
        if (/الوقود الأحفوري/u.test(title))
            return 'environment';
        if (/أرباح الشركات|نتائج مالية|حرب الأسعار/u.test(title))
            return 'business';
        return ARABIC_SUBJECTS.find(([, pattern]) => pattern.test(title))?.[0] ?? null;
    }
    if (/\b(?:resultados trimestrais|lucros trimestrais|guerra de precos)\b|\bfusao\b[^.!?]{0,50}\b(?:empresas?|bancos?)\b/u.test(folded))
        return 'business';
    return PORTUGUESE_SUBJECTS.find(([, pattern]) => pattern.test(folded))?.[0] ?? null;
}
function localizedNewsSubject(title, url) {
    const additional = additionalLocalizedSubject(title, url.pathname);
    if (additional !== undefined)
        return additional;
    if ((!/^\/fr(?:\/|$)/u.test(url.pathname) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(title)) || /^\/japanese(?:\/|$)/u.test(url.pathname)) {
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
/** Preserve the AI acronym before case folding: Romanian "ai" alone is not technology evidence. */
function subjectTitle(title) {
    const raw = title.normalize('NFKC');
    const explicitAi = /\bAI\b/u.test(raw) || /\b(?:generative|agentic|conversational) ai\b|\bai(?:[- ]powered| (?:models?|assistants?|chatbots?|tools?|systems?|agents?|software))\b/iu.test(raw);
    return (explicitAi ? raw : raw.replace(/(?<!\p{L})ai(?!\p{L})/giu, ' ')).toLowerCase();
}
/** The same subject rules repair proven stale hints and classify newly discovered headlines. */
function englishHeadlineSubject(title) {
    // Role vacancies describe employment even when the employer is a science or technology institution.
    if (/\b(?:job|staff|management) vacancies\b/u.test(title))
        return 'work';
    const financial = FINANCIAL_DEVELOPMENT.test(title);
    const merger = /\b(?:mergers?|acquisitions?)\b/u.test(title) && !ASTRONOMICAL_MERGER.test(title);
    if (educationInstitutionMerger(title))
        return 'education';
    if (financial || merger)
        return 'business';
    if (/\b(?:budget cuts?|spending cuts?|cost[- ]cutting|cost[- ]savings?|efficiency savings|round of savings)\b/u.test(title)
        && !/\b(?:household|personal finance|savings accounts?|income tax|pensions?|retirement)\b/u.test(title))
        return 'business';
    if (/\b(?:photographer of the year|photography (?:awards?|competitions?|contests?)|photo (?:awards?|competitions?|contests?))\b/u.test(title))
        return 'culture';
    // Holiday weather is an attribute of a destination, not a major disruption.
    if (/\b(?:getaways?|holiday destinations?|vacation destinations?)\b/u.test(title)
        && !/\b(?:hurricanes?|typhoons?|cyclones?|tornadoes?|earthquakes?|floods?|flooding|wildfires?|tsunami|heatwave|storm warnings?|snowstorm)\b/u.test(title))
        return 'travel';
    return NEWS_SUBJECTS.find(([category, pattern]) => matchesSubject(category, pattern, title))?.[0] ?? null;
}
/** Only explicit contrary subjects invalidate existing discovery provenance. */
export function contradictedHeadlineHints(headline) {
    const title = subjectTitle(headline), rejected = [];
    // A previous lowercase ai match cannot keep a disproven technology hint alive.
    if (/\bai\b/iu.test(headline) && !NEWS_SUBJECTS.some(([category, pattern]) => category === 'technology' && matchesSubject(category, pattern, title)))
        rejected.push('technology');
    // Spanish hostile actions are not shares; retained hints still require independent financial evidence.
    if (/\bacciones hostiles\b/u.test(title)) {
        const folded = title.normalize('NFKD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').normalize('NFC');
        const financial = SPANISH_SUBJECTS.some(([category, pattern]) => category === 'business' && pattern.test(folded)) || englishHeadlineSubject(title) === 'business';
        if (!financial)
            rejected.push('business');
    }
    // Do not let an earlier discovery label restore the same geographic bank false positive.
    if (/\bwest bank\b/u.test(title) && englishHeadlineSubject(title) !== 'business'
        && !NEWS_SUBJECTS.some(([category, pattern]) => category === 'business' && matchesSubject(category, pattern, title)))
        rejected.push('business');
    if (hasUnsupportedWeatherDescriptor(title)
        && !NEWS_SUBJECTS.some(([category, pattern]) => category === 'weather' && matchesSubject(category, pattern, title)))
        rejected.push('weather');
    if (/\bsummits?\b/u.test(title) && !hasDiplomaticSummitContext(title)) {
        const subject = englishHeadlineSubject(title);
        if (subject !== null && subject !== 'world')
            rejected.push('world');
    }
    return rejected;
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
    const normalized = subjectTitle(title);
    const localized = localizedNewsSubject(normalized, url);
    if (localized !== undefined)
        return localized;
    // An editorial cartoon is commentary, not a new diplomatic event or a quota-filling news item.
    if (/\s[–—-]\s*cartoon\s*$/u.test(normalized))
        return null;
    // The nature of the reported development matters more than the company sector.
    const category = englishHeadlineSubject(normalized);
    // A team/squad summit on a sports desk is not an international diplomatic summit.
    if (category === 'world' && url.pathname.toLowerCase().split('/').some(segment => segment === 'sport' || segment === 'sports')
        && !/\b(?:war|wars|ceasefire|conflict|invasion|missiles?|airstrikes?|air strikes?|foreign affairs|diplomacy|diplomatic|bilateral talks|state visits?|nuclear)\b/u.test(normalized))
        return 'sport';
    // An athlete's career is sporting context, unless the headline explicitly
    // reports employment or workforce changes rather than sporting progress.
    if (category === 'work' && url.pathname.toLowerCase().split('/').some(segment => segment === 'sport' || segment === 'sports')
        && !/\b(?:employment|unemployment|jobs?|workforce|workers?|workplace|hiring|recruitment|layoffs?|redundancies|labour market|labor market)\b/u.test(normalized))
        return 'sport';
    if (category !== null)
        return category;
    for (const segment of url.pathname.toLowerCase().split('/')) {
        const section = Object.hasOwn(SECTIONS, segment) ? SECTIONS[segment] : undefined;
        if (section === 'weather' && contradictedHeadlineHints(normalized).includes('weather'))
            continue;
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
    const title = subjectTitle(card.title);
    const subjects = SUBJECTS.filter(([category, pattern]) => matchesSubject(category, pattern, title)).map(([category]) => category);
    const discovered = PUBLIC_EDITORIAL_CATEGORIES.filter(category => card.sourceIds.some(id => newsCategoryFromSourceId(id) === category));
    const contradicted = contradictedHeadlineHints(card.title), hints = discovered.filter(category => !contradicted.includes(category));
    // Apply the shared semantic correction in the reading view as well, without
    // mutating original titles, IDs, hashes, provenance or saved preferences.
    if (!hints.length && (discovered.length > 0 || contradicted.some(category => category === card.topic))) {
        const category = englishHeadlineSubject(title);
        return category === null ? null : Object.freeze({ category, basis: discovered.length ? 'category-discovery' : 'headline-subject' });
    }
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
/** Match corrected discovery hints without rewriting card identity or saved Topics. */
export function editorialInterestTopic(card) {
    if (!card.sourceIds.includes('news-unclassified')) {
        const contradicted = contradictedHeadlineHints(card.title);
        if (contradicted.some(category => card.sourceIds.includes(`news-${category}`))) {
            const category = classifyEditorialCard(card)?.category;
            return category === undefined ? 'other' : EDITORIAL_CATEGORY_TOPICS[category];
        }
    }
    if (card.topic !== 'business' || !card.sourceIds.includes('news-business')
        || card.sourceIds.some(id => { const category = newsCategoryFromSourceId(id); return category !== null && category !== 'business'; }))
        return card.topic;
    return classifyEditorialCard(card)?.category === 'education' ? EDITORIAL_CATEGORY_TOPICS.education : card.topic;
}
