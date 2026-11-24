# Inventarul cardurilor proprii DLKT — 24 noiembrie 2026

Acest inventar descrie implementarea existenta in proiectul razvannitu-glitch/dlkt-info la commitul 04b8ed41712968339a96b75a4bb6b46ac35a0251. Numarul definitiilor din cod nu reprezinta numarul de carduri afisate simultan, continut eligibil in fiecare oras, sincronizare cu un cont sau rezultate comerciale. Au fost verificate catalogul Knowledge, cititorul ICEO, randarea cardurilor locale si navigatia de intrare.

## Carduri locale de utilitate

Exista sapte variante in `source/src/local/card-node.ts`, randate de `localCardNode()`: Vreme (`forecast`), Transport (`transport`), anunt de transport (`transport-notice`), Termoficare si apa calda (`utility-notice`), Eveniment (`event`), Administratie (`municipal-news`) si Stiri locale (`local-news`). Fiecare depinde de existenta datelor eligibile pentru oras. Administratia si stirile locale prezinta informatii externe atribuite; nu sunt articole editoriale originale DLKT.

Vremea are prezentare proprie prin `weatherMotionNode()`, perioada prognozei, sursa MET Norway si atribuirea licentei CC BY 4.0. Componenta precizeaza ca datele sunt o prognoza pentru centrul orasului.

Termoficarea si apa calda au o prezentare specifica Bucurestiului pe baza evidentei CMTEB. Textul din card delimiteaza sinteza de confirmarea afectarii unui anumit imobil si precizeaza caracterul estimativ al orelor de remediere.

Evenimentele pot oferi descarcarea unui fisier de calendar prin `localEventCalendar()`, numai cand datele evenimentului trec validarea. Existenta butonului nu reprezinta o inscriere automata sau o rezervare.

## Continut original Knowledge

`source/src/iceo/knowledge-catalog.ts` contine exact 19 definitii in `KNOWLEDGE_CARDS`, validate prin `validateKnowledgeCatalog()`. Catalogul contine explicatii originale DLKT, exclusiv text, cu versiuni in romana, engleza si italiana, sursa primara nominalizata si termene de revizuire. Sunt 13 definitii generale sau locale, un card aniversar, o reteta si patru carduri de informare si ingrijire.

Integrarea din `source/src/iceo/browser.ts` foloseste `selectInlineKnowledge()` si `interleaveKnowledge()`. Selectia depinde de context, geografie, valabilitatea reviziei si identificatorii deja vazuti in browser. Cardul aniversar este legat de 23 noiembrie; nu este un card aniversar zilnic pentru orice data.

**1. Pe Venus, anul trece inaintea unei rotatii complete.** Identificator: `venus-rotation`. Format: explicatie Knowledge. Sursa nominalizata: [NASA](https://science.nasa.gov/venus/venus-facts/). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**2. CERN a deschis software-ul Web tuturor in 1993.** Identificator: `web-public-domain`. Format: explicatie Knowledge. Sursa nominalizata: [CERN](https://home.cern/science/computing/the-birth-of-the-web/licensing-web/). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**3. Botanic vorbind, banana este o baca.** Identificator: `banana-berry`. Format: explicatie Knowledge. Sursa nominalizata: [Royal Botanic Gardens, Kew](https://www.kew.org/plants/cavendish-banana). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**4. Oceanul produce aproximativ jumatate din oxigenul Terrei.** Identificator: `ocean-oxygen`. Format: explicatie Knowledge. Sursa nominalizata: [NOAA](https://oceanservice.noaa.gov/facts/ocean-oxygen.html/). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**5. Forma in sase directii a fulgului incepe in gheata.** Identificator: `snowflake-six`. Format: explicatie Knowledge. Sursa nominalizata: [Met Office](https://weather.metoffice.gov.uk/learn-about/weather/types-of-weather/snow/snowflake). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**6. Un cod QR poate recupera o parte din datele deteriorate.** Identificator: `qr-recovery`. Format: explicatie Knowledge. Sursa nominalizata: [DENSO WAVE](https://www.qrcode.com/en/about/error_correction.html). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**7. Statuia Libertatii nu a fost mereu verde.** Identificator: `liberty-patina`. Format: explicatie Knowledge. Sursa nominalizata: [U.S. National Park Service](https://www.nps.gov/stli/faqs.htm). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**8. Inflatia tine cont de ponderea cheltuielilor gospodariilor.** Identificator: `inflation-basket`. Format: explicatie Knowledge. Sursa nominalizata: [European Central Bank](https://www.ecb.europa.eu/ecb-and-you/explainers/tell-me-more/html/what_is_inflation.en.html). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**9. Culoarea unui inel olimpic nu desemneaza un continent.** Identificator: `olympic-rings`. Format: explicatie Knowledge. Sursa nominalizata: [International Olympic Committee](https://www.olympics.com/ioc/faq/olympic-symbol-and-identity/what-is-the-meaning-of-the-olympic-rings). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**10. Coralii sunt animale, chiar daca seamana cu plantele.** Identificator: `coral-partnership`. Format: explicatie Knowledge. Sursa nominalizata: [NOAA](https://oceanservice.noaa.gov/facts/coral.html). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**11. Braille este un sistem de scriere, nu o limba separata.** Identificator: `braille-code`. Format: explicatie Knowledge. Sursa nominalizata: [American Foundation for the Blind](https://www.afb.org/blindness-and-low-vision/braille/what-braille). Revizie valabila pana la 2027-05-21T22:10:14.000Z.

**12. Muzeul egiptean din Torino dateaza din 1824.** Identificator: `torino-museo-egizio-1824`. Format: explicatie Knowledge. Sursa nominalizata: [Museo Egizio](https://www.museoegizio.it/en/discover/story). Revizie valabila pana la 2027-05-21T22:36:16.000Z. Restrictie declarata: {"countryCode":"IT","cityIds":["3165524"],"label":{"en":"Turin · Italy","ro":"Torino · Italia","it":"Torino · Italia"}}.

**13. De ce este Ateneul din Bucuresti rotund.** Identificator: `bucharest-athenaeum-circular-foundations`. Format: explicatie Knowledge. Sursa nominalizata: [Filarmonica George Enescu](https://www.filarmonicaenescu.ro/ro/istoric-ateneul-roman). Revizie valabila pana la 2027-05-21T22:36:16.000Z. Restrictie declarata: {"countryCode":"RO","cityIds":["683506"],"label":{"en":"Bucharest · Romania","ro":"Bucuresti · Romania","it":"Bucarest · Romania"}}.

**14. 23 noiembrie 1992: industria calculatoarelor era considerata in criza.** Identificator: `computer-industry-1992-nov-23`. Format: on-this-day. Sursa nominalizata: [Computer History Museum](https://www.computerhistory.org/tdih/november/23/). Revizie valabila pana la 2027-05-20T09:00:00.000Z. Calendar: 23 noiembrie.

**15. Ovaz cald cu mar si scortisoara.** Identificator: `apple-cinnamon-oats`. Format: recipe. Sursa nominalizata: [Food Hero / Oregon State University](https://foodhero.org/recipes/apple-spice-oatmeal). Revizie valabila pana la 2027-05-20T09:00:00.000Z.

**16. Cancerul de san: informatia corecta conteaza.** Identificator: `care-breast-cancer-global`. Format: care. Sursa nominalizata: [World Health Organization](https://www.who.int/news-room/fact-sheets/detail/breast-cancer). Revizie valabila pana la 2027-01-22T11:15:00.000Z.

**17. Screeningul pentru cancerul de san, mai aproape de comunitati.** Identificator: `care-breast-screening-romania`. Format: care. Sursa nominalizata: [Fundatia Renasterea](https://fundatiarenasterea.ro/a-fost-lansat-programul-national-de-screening-pentru-cancerul-de-san-daria-depistarea-activa-responsabilitate-informatie-si-acces/). Revizie valabila pana la 2027-01-22T11:15:00.000Z. Restrictie declarata: {"countryCode":"RO","cityIds":[],"label":{"en":"Romania","ro":"Romania","it":"Romania"}}.

**18. Ajuta ingrijirea celor cu boli grave.** Identificator: `care-palliative-romania`. Format: care. Sursa nominalizata: [HOSPICE Casa Sperantei](https://hospice.ro/implica-te). Revizie valabila pana la 2027-01-22T11:15:00.000Z. Restrictie declarata: {"countryCode":"RO","cityIds":[],"label":{"en":"Romania","ro":"Romania","it":"Romania"}}.

**19. Un gest cu impact: intereseaza-te despre donarea de sange.** Identificator: `care-blood-donation-global`. Format: care. Sursa nominalizata: [World Health Organization](https://www.who.int/campaigns/world-blood-donor-day/2026). Revizie valabila pana la 2027-01-22T11:15:00.000Z.

## Functii personale ale cititorului public

Salvatele sunt afisate de `savedCards()`. Implementarea declara pastrarea in browser, fara sincronizare cu un cont. `currentSavedUpdates()` si `annotateSavedUpdate()` compara detaliile suportate ale inregistrarii curente cu copia salvata.

Comparatia cu o verificare salvata este randata de `renderComparison()`, pe baza unui reper salvat explicit si a intereselor alese. Nu reprezinta supravegherea completa a unei publicatii sau a internetului.

Rezumatul la revenire este randat de `renderReturnBrief()`. Poate prezenta schimbari relevante, pana la trei exemple privind salvatele si, unde modelul contine datele necesare, termene din urmatoarele sapte zile.

Urmarirea categoriilor este integrata prin `CategoryFollowing` si memoria dispozitivului. Actiunea din card nu demonstreaza existenta alertelor push sau a unor notificari programate.

Partajarea cardului DLKT, accesul la sursa originala, detaliile de provenienta si gruparea mai multor originale sub un subiect sunt componente proprii ale cititorului. Cardul standard `publication` este formatul de prezentare pentru articole externe. Categoriile editoriale ale stirilor nu se adauga la numarul de carduri originale Knowledge.

## Componente integrate si limitele verificarii

Cititorul apeleaza Explore, configurarea editiei prin `setupEdition(settings)` si cardul comercial local prin `commercialCardNode()`. Prezenta acestor integrari este verificata in cod; acest inventar nu afirma ca exista oferte platite, inventar publicitar vandut sau incasari.

Cursul valutar este vizibil in captura istorica furnizata de utilizator, dar nu a fost confirmat in auditul de cod al acestui inventar. `source/src/entry/header.ts` implementeaza navigatia responsive, focusul si pagina activa; nu contine serviciul valutar.

My account si Info Wallet sunt module separate, identificate la `source/src/account/browser.ts` si in `source/src/wallet/`. Nu au fost auditate functional in acest lot. Salvatele locale nu trebuie prezentate drept salvate sincronizate, iar existenta modulelor nu confirma integrarea furnizorilor, plati sau functii active ale contului.

## Dovezi ale lotului de surse, separate de inventarul definitiilor

PR44 a corectat alocarea cererilor catre origini disponibile, fara cresterea bugetelor. PR45 a adaugat Descopera si Spotmedia, impreuna cu validarea feedurilor, filtrarea promotionala, atribuirea si validarile private. Aceste modificari privesc oferta de informatii externe, nu cresterea celor 19 definitii originale Knowledge.

La verificarea din 24 noiembrie 2026, ora 21:53:43 Europe/Bucharest, snapshotul revizia 2152 continea 26 de originale RO/ro de la sase publicatii, inclusiv cate un original Descopera si Spotmedia. Ultima actualizare programata reusita era 21:52:36.453, iar corpusul publicat corespundea aceleiasi revizii. Acesta este un reper punctual; originalele distincte nu sunt o masurare a subiectelor semantice distincte si nu demonstreaza minimum sapte subiecte pe fiecare categorie.

Dovezi de implementare: [PR44](https://github.com/razvannitu-glitch/dlkt-info/pull/44), [PR45](https://github.com/razvannitu-glitch/dlkt-info/pull/45), [catalogul Knowledge](https://github.com/razvannitu-glitch/dlkt-info/blob/04b8ed41712968339a96b75a4bb6b46ac35a0251/source/src/iceo/knowledge-catalog.ts), [carduri locale](https://github.com/razvannitu-glitch/dlkt-info/blob/04b8ed41712968339a96b75a4bb6b46ac35a0251/source/src/local/card-node.ts), [cititor ICEO](https://github.com/razvannitu-glitch/dlkt-info/blob/04b8ed41712968339a96b75a4bb6b46ac35a0251/source/src/iceo/browser.ts).
