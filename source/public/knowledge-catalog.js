import { validateKnowledgeCatalog } from './knowledge.js';
// Original DLKT explanations based on linked primary sources. Text-only; no third-party imagery or endorsements.
const reviewed = [
    {
        "id": "venus-rotation",
        "category": "13000000",
        "topic": {
            "en": "Space",
            "ro": "Spatiu",
            "it": "Spazio"
        },
        "source": {
            "publisher": "NASA",
            "url": "https://science.nasa.gov/venus/venus-facts/"
        },
        "copy": {
            "en": {
                "title": "Venus completes a year before one full spin.",
                "explanation": "One rotation takes about 243 Earth days; one orbit takes about 225. That is a sidereal day, measured against the stars.",
                "connection": "A rotation and a sunrise-to-sunrise day are different measurements."
            },
            "ro": {
                "title": "Pe Venus, anul trece inaintea unei rotatii complete.",
                "explanation": "O rotatie dureaza aproximativ 243 de zile terestre, iar o orbita circa 225. Aceasta este ziua siderala, masurata fata de stele.",
                "connection": "Rotatia si intervalul dintre doua rasarituri masoara lucruri diferite."
            },
            "it": {
                "title": "Su Venere, un anno precede una rotazione completa.",
                "explanation": "Una rotazione dura circa 243 giorni terrestri; un'orbita circa 225. È il giorno siderale, misurato rispetto alle stelle.",
                "connection": "Una rotazione e l'intervallo tra due albe sono misure diverse."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "web-public-domain",
        "category": "13000000",
        "topic": {
            "en": "Technology",
            "ro": "Tehnologie",
            "it": "Tecnologia"
        },
        "source": {
            "publisher": "CERN",
            "url": "https://home.cern/science/computing/the-birth-of-the-web/licensing-web/"
        },
        "copy": {
            "en": {
                "title": "CERN opened its Web software to everyone in 1993.",
                "explanation": "On 30 April, CERN put its basic Web client, server and common code into the public domain, allowing anyone to use and modify them.",
                "connection": "The release concerned software, not ownership of everything on the Web."
            },
            "ro": {
                "title": "CERN a deschis software-ul Web tuturor in 1993.",
                "explanation": "Pe 30 aprilie, CERN a trecut clientul Web de baza, serverul si codul comun in domeniul public, permitand utilizarea si modificarea lor.",
                "connection": "Decizia privea software-ul, nu toate materialele publicate pe Web."
            },
            "it": {
                "title": "Nel 1993 CERN aprì a tutti il software del Web.",
                "explanation": "Il 30 aprile CERN rese di pubblico dominio il client Web di base, il server e il codice comune, permettendone uso e modifica.",
                "connection": "La decisione riguardava il software, non ogni contenuto del Web."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "banana-berry",
        "category": "10000000",
        "topic": {
            "en": "Food",
            "ro": "Alimentatie",
            "it": "Alimentazione"
        },
        "source": {
            "publisher": "Royal Botanic Gardens, Kew",
            "url": "https://www.kew.org/plants/cavendish-banana"
        },
        "copy": {
            "en": {
                "title": "A banana is a berry, botanically speaking.",
                "explanation": "Kew classifies banana fruits as berries. The botanical category describes how a fruit develops from a flower, not its size or how we eat it.",
                "connection": "Everyday food names and botanical categories do different jobs."
            },
            "ro": {
                "title": "Botanic vorbind, banana este o baca.",
                "explanation": "Kew clasifica fructul bananierului drept baca. Categoria botanica descrie dezvoltarea din floare, nu dimensiunea fructului sau felul in care il mancam.",
                "connection": "Denumirile culinare si categoriile botanice au scopuri diferite."
            },
            "it": {
                "title": "Dal punto di vista botanico, la banana è una bacca.",
                "explanation": "Kew classifica il frutto del banano come bacca. La categoria descrive lo sviluppo dal fiore, non le dimensioni o il modo di consumarlo.",
                "connection": "I nomi culinari e le categorie botaniche hanno scopi diversi."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "ocean-oxygen",
        "category": "06000000",
        "topic": {
            "en": "Oceans",
            "ro": "Oceane",
            "it": "Oceani"
        },
        "source": {
            "publisher": "NOAA",
            "url": "https://oceanservice.noaa.gov/facts/ocean-oxygen.html/"
        },
        "copy": {
            "en": {
                "title": "The ocean produces roughly half of Earth's oxygen.",
                "explanation": "Most of this production comes from photosynthesising plankton. Marine life consumes roughly the same amount, while atmospheric oxygen has accumulated over immense timescales.",
                "connection": "Oxygen production and the oxygen remaining available are not the same."
            },
            "ro": {
                "title": "Oceanul produce aproximativ jumatate din oxigenul Terrei.",
                "explanation": "Cea mai mare parte provine din planctonul fotosintetic. Viata marina consuma aproximativ aceeasi cantitate, iar oxigenul atmosferic s-a acumulat pe perioade imense.",
                "connection": "Productia de oxigen si cantitatea ramasa disponibila nu sunt identice."
            },
            "it": {
                "title": "L'oceano produce circa metà dell'ossigeno terrestre.",
                "explanation": "Gran parte deriva dal plancton fotosintetico. La vita marina ne consuma una quantità simile, mentre l'ossigeno atmosferico si è accumulato in tempi lunghissimi.",
                "connection": "La produzione di ossigeno e la quantità disponibile non coincidono."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "snowflake-six",
        "category": "17000000",
        "topic": {
            "en": "Weather",
            "ro": "Vreme",
            "it": "Meteo"
        },
        "source": {
            "publisher": "Met Office",
            "url": "https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow/snowflake"
        },
        "copy": {
            "en": {
                "title": "A snowflake's sixfold pattern starts inside the ice.",
                "explanation": "Water molecules arrange into a hexagonal crystal structure. Changes in temperature and humidity shape the intricate details as the crystal grows.",
                "connection": "The pattern reflects the material's structure and its changing surroundings."
            },
            "ro": {
                "title": "Forma in sase directii a fulgului incepe in gheata.",
                "explanation": "Moleculele de apa formeaza o structura cristalina hexagonala. Schimbarile de temperatura si umiditate modeleaza detaliile in timpul cresterii cristalului.",
                "connection": "Forma reflecta structura materialului si mediul prin care trece."
            },
            "it": {
                "title": "La simmetria del fiocco nasce dentro il ghiaccio.",
                "explanation": "Le molecole d'acqua formano una struttura cristallina esagonale. Temperatura e umidità modellano i dettagli durante la crescita del cristallo.",
                "connection": "La forma riflette la struttura del materiale e l'ambiente circostante."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "qr-recovery",
        "category": "13000000",
        "topic": {
            "en": "Digital life",
            "ro": "Viata digitala",
            "it": "Vita digitale"
        },
        "source": {
            "publisher": "DENSO WAVE",
            "url": "https://www.qrcode.com/en/about/error_correction.html"
        },
        "copy": {
            "en": {
                "title": "A QR code can recover some damaged data.",
                "explanation": "QR codes add error-correction information. Four levels trade extra redundancy for data capacity and symbol size; damaged codes are not guaranteed to scan.",
                "connection": "Design a printed code for its real conditions, then test it."
            },
            "ro": {
                "title": "Un cod QR poate recupera o parte din datele deteriorate.",
                "explanation": "Codurile QR includ informatii pentru corectarea erorilor. Cele patru niveluri echilibreaza redundanta, capacitatea si dimensiunea; scanarea unui cod deteriorat nu este garantata.",
                "connection": "Proiecteaza codul pentru conditiile reale de folosire si testeaza-l."
            },
            "it": {
                "title": "Un codice QR può recuperare parte dei dati danneggiati.",
                "explanation": "I QR includono informazioni per correggere gli errori. Quattro livelli bilanciano ridondanza, capacità e dimensioni; la lettura di un codice danneggiato non è garantita.",
                "connection": "Progetta il codice per l'uso reale e poi provalo."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "liberty-patina",
        "category": "01000000",
        "topic": {
            "en": "Architecture",
            "ro": "Arhitectura",
            "it": "Architettura"
        },
        "source": {
            "publisher": "U.S. National Park Service",
            "url": "https://www.nps.gov/stli/faqs.htm"
        },
        "copy": {
            "en": {
                "title": "The Statue of Liberty was not always green.",
                "explanation": "Its copper exterior was originally brown. Exposure produced the familiar green patina, a coating that also helps protect the copper beneath.",
                "connection": "A material's weathered surface can become part of its identity."
            },
            "ro": {
                "title": "Statuia Libertatii nu a fost mereu verde.",
                "explanation": "Exteriorul de cupru era initial maro. Expunerea la mediu a produs patina verde, strat care ajuta si la protejarea cuprului de dedesubt.",
                "connection": "Imbatranirea unui material poate deveni parte din identitatea sa vizuala."
            },
            "it": {
                "title": "La Statua della Libertà non è sempre stata verde.",
                "explanation": "Il rivestimento di rame era originariamente marrone. L'esposizione ha prodotto la patina verde, che aiuta anche a proteggere il rame sottostante.",
                "connection": "L'invecchiamento di un materiale può diventare parte della sua identità."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "inflation-basket",
        "category": "04000000",
        "topic": {
            "en": "Economics",
            "ro": "Economie",
            "it": "Economia"
        },
        "source": {
            "publisher": "European Central Bank",
            "url": "https://www.ecb.europa.eu/ecb-and-you/explainers/tell-me-more/html/what_is_inflation.en.html"
        },
        "copy": {
            "en": {
                "title": "Inflation weights purchases by how much households spend.",
                "explanation": "A price index combines many goods and services. Bigger spending categories carry more weight, so a household's personal shopping mix can differ from the average.",
                "connection": "One rising price is only part of the overall picture."
            },
            "ro": {
                "title": "Inflatia tine cont de ponderea cheltuielilor gospodariilor.",
                "explanation": "Indicele combina preturile multor bunuri si servicii. Categoriile cu cheltuieli mai mari cantaresc mai mult, iar cosul unei familii poate diferi de medie.",
                "connection": "Scumpirea unui singur produs arata doar o parte din situatie."
            },
            "it": {
                "title": "L'inflazione pesa gli acquisti in base alla spesa.",
                "explanation": "Un indice combina molti beni e servizi. Le categorie con maggiore spesa pesano di più; il paniere di una famiglia può differire dalla media.",
                "connection": "L'aumento di un solo prezzo è soltanto parte del quadro."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "olympic-rings",
        "category": "15000000",
        "topic": {
            "en": "Sport",
            "ro": "Sport",
            "it": "Sport"
        },
        "source": {
            "publisher": "International Olympic Committee",
            "url": "https://www.olympics.com/ioc/faq/olympic-symbol-and-identity/what-is-the-meaning-of-the-olympic-rings"
        },
        "copy": {
            "en": {
                "title": "An Olympic ring's colour does not name a continent.",
                "explanation": "The five rings represent the union of five continents and a worldwide meeting of athletes. The IOC rejects assigning a particular continent to each colour.",
                "connection": "A familiar explanation can spread without being the official meaning."
            },
            "ro": {
                "title": "Culoarea unui inel olimpic nu desemneaza un continent.",
                "explanation": "Cele cinci inele reprezinta unirea a cinci continente si intalnirea sportivilor lumii. CIO respinge asocierea fiecarui continent cu o anumita culoare.",
                "connection": "O explicatie populara nu este automat si semnificatia oficiala."
            },
            "it": {
                "title": "Il colore di un anello olimpico non indica un continente.",
                "explanation": "I cinque anelli rappresentano l'unione di cinque continenti e l'incontro degli atleti del mondo. Il CIO respinge l'abbinamento di ogni colore a un continente.",
                "connection": "Una spiegazione popolare non coincide necessariamente con il significato ufficiale."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "coral-partnership",
        "category": "06000000",
        "topic": {
            "en": "Nature",
            "ro": "Natura",
            "it": "Natura"
        },
        "source": {
            "publisher": "NOAA",
            "url": "https://oceanservice.noaa.gov/facts/coral.html"
        },
        "copy": {
            "en": {
                "title": "Corals are animals, even when they look like plants.",
                "explanation": "Many live with microscopic algae. Stress can make corals expel those algae and turn white. A bleached coral is stressed, but not necessarily dead.",
                "connection": "Bleaching and death describe different stages of reef damage."
            },
            "ro": {
                "title": "Coralii sunt animale, chiar daca seamana cu plantele.",
                "explanation": "Multi traiesc impreuna cu alge microscopice. Stresul poate provoca eliminarea algelor si albirea coralului. Un coral albit nu este neaparat mort.",
                "connection": "Albirea si moartea descriu stadii diferite ale afectarii recifului."
            },
            "it": {
                "title": "I coralli sono animali, anche quando sembrano piante.",
                "explanation": "Molti vivono con alghe microscopiche. Lo stress può far espellere le alghe e sbiancare il corallo. Un corallo sbiancato non è necessariamente morto.",
                "connection": "Sbiancamento e morte descrivono fasi diverse del danno alla barriera."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "braille-code",
        "category": "05000000",
        "topic": {
            "en": "Accessibility",
            "ro": "Accesibilitate",
            "it": "Accessibilità"
        },
        "source": {
            "publisher": "American Foundation for the Blind",
            "url": "https://www.afb.org/blindness-and-low-vision/braille/what-braille"
        },
        "copy": {
            "en": {
                "title": "Braille is a reading code, not a separate language.",
                "explanation": "Patterns of raised dots represent written language. The familiar six-dot cell has two columns of three positions, with combinations for letters, numbers and other signs.",
                "connection": "Language and accessible reading format are separate choices."
            },
            "ro": {
                "title": "Braille este un sistem de scriere, nu o limba separata.",
                "explanation": "Combinatiile de puncte reliefate reprezinta limbajul scris. Celula obisnuita cu sase puncte are doua coloane de cate trei pozitii, pentru litere, numere si semne.",
                "connection": "Limba si formatul accesibil de lectura sunt alegeri diferite."
            },
            "it": {
                "title": "Il Braille è un codice di scrittura, non una lingua.",
                "explanation": "I punti in rilievo rappresentano il linguaggio scritto. La comune cella a sei punti ha due colonne di tre posizioni, per lettere, numeri e segni.",
                "connection": "La lingua e il formato di lettura accessibile sono scelte diverse."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:10:14.000Z",
        "reviewBy": "2027-05-21T22:10:14.000Z"
    },
    {
        "id": "torino-museo-egizio-1824",
        "category": "01000000",
        "topic": {
            "en": "History",
            "ro": "Istorie",
            "it": "Storia"
        },
        "geography": {
            "countryCode": "IT",
            "cityIds": [
                "3165524"
            ],
            "label": {
                "en": "Turin · Italy",
                "ro": "Torino · Italia",
                "it": "Torino · Italia"
            }
        },
        "source": {
            "publisher": "Museo Egizio",
            "url": "https://www.museoegizio.it/en/discover/story"
        },
        "copy": {
            "en": {
                "title": "Turin's Egyptian museum dates to 1824.",
                "explanation": "Founded in 1824, Museo Egizio describes itself as the world's oldest museum devoted entirely to ancient Egyptian culture.",
                "connection": "A Turin institution connects the city's cultural heritage with ancient Egypt."
            },
            "ro": {
                "title": "Muzeul egiptean din Torino dateaza din 1824.",
                "explanation": "Fondat in 1824, Museo Egizio se prezinta drept cel mai vechi muzeu din lume dedicat integral culturii Egiptului antic.",
                "connection": "O institutie din Torino leaga patrimoniul cultural al orasului de Egiptul antic."
            },
            "it": {
                "title": "Il museo egizio di Torino risale al 1824.",
                "explanation": "Fondato nel 1824, il Museo Egizio si presenta come il più antico museo al mondo dedicato interamente alla cultura dell'antico Egitto.",
                "connection": "Un'istituzione torinese collega il patrimonio culturale della città all'antico Egitto."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:36:16.000Z",
        "reviewBy": "2027-05-21T22:36:16.000Z"
    },
    {
        "id": "bucharest-athenaeum-circular-foundations",
        "category": "01000000",
        "topic": {
            "en": "History",
            "ro": "Istorie",
            "it": "Storia"
        },
        "geography": {
            "countryCode": "RO",
            "cityIds": [
                "683506"
            ],
            "label": {
                "en": "Bucharest · Romania",
                "ro": "Bucuresti · Romania",
                "it": "Bucarest · Romania"
            }
        },
        "source": {
            "publisher": "Filarmonica George Enescu",
            "url": "https://www.filarmonicaenescu.ro/ro/istoric-ateneul-roman"
        },
        "copy": {
            "en": {
                "title": "Why Bucharest's Athenaeum is round.",
                "explanation": "The Romanian Athenaeum was built over foundations prepared for a riding school. Its circular shape comes from that earlier project.",
                "connection": "Plans for horse riding helped shape a space for music in Bucharest."
            },
            "ro": {
                "title": "De ce este Ateneul din Bucuresti rotund.",
                "explanation": "Ateneul Roman a fost construit peste fundatiile pregatite pentru o scoala de echitatie. De aici provine forma sa circulara.",
                "connection": "Un proiect pentru echitatie a influentat arhitectura unei sali de concerte din Bucuresti."
            },
            "it": {
                "title": "Perché l'Ateneo di Bucarest è rotondo.",
                "explanation": "L'Ateneo Romeno fu costruito sulle fondamenta predisposte per una scuola di equitazione. La sua forma circolare deriva da quel progetto precedente.",
                "connection": "Un progetto per l'equitazione ha contribuito a dare forma a uno spazio per la musica a Bucarest."
            }
        },
        "kind": "knowledge",
        "revision": 1,
        "reviewedAt": "2026-11-22T22:36:16.000Z",
        "reviewBy": "2027-05-21T22:36:16.000Z"
    }
];
export const KNOWLEDGE_CARDS = Object.freeze(validateKnowledgeCatalog(reviewed));
