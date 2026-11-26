import { getLocale } from './i18n-browser.js';
import { accountText, topicName } from './account-presentation.js';
const romanian = {
    "Skip to Wallet": "Sari la Info Wallet",
    "Back to briefing": "Inapoi la stiri",
    "A private place for your profile and the accounts that matter to your day.": "Profilul tau si conturile utile in fiecare zi, intr-un spatiu privat.",
    "Saved cards in this browser": "Cardurile salvate in acest browser",
    "Your saved public cards stay in this browser, separate from your private profile.": "Cardurile publice salvate raman in acest browser, separat de profilul tau privat.",
    "Your account": "Contul tau",
    "Checking private profile availability…": "Se verifica disponibilitatea profilului privat…",
    "Sign in to DLKT": "Conecteaza-te la DLKT",
    "Reload Wallet": "Reincarca Info Wallet",
    "Signing in to DLKT and authorizing an email or social account are separate choices. Your profile does not grant access to messages, comments or other private activity.": "Conectarea la DLKT si autorizarea unui cont de email sau social sunt alegeri separate. Profilul tau nu acorda acces la mesaje, comentarii sau alte activitati private.",
    "Your private profile": "Profilul tau privat",
    "Display name (optional)": "Numele afisat (optional)",
    "How you would like to be addressed in your private Wallet.": "Cum vrei sa te numim in Info Wallet.",
    "Use a language code, such as en or ro-RO. This profile preference does not change your reading language.": "Foloseste un cod de limba, precum ro sau ro-RO. Aceasta preferinta a profilului nu schimba limba de lectura.",
    "Time zone": "Fus orar",
    "Use a city-based time zone, such as Europe/Bucharest, or UTC.": "Foloseste un fus orar precum Europe/Bucharest sau UTC.",
    "Preferred reading time": "Ora preferata pentru lectura",
    "This saves a preference only. Automatic delivery and background alerts are not active.": "Se salveaza doar preferinta. Livrarea automata si alertele in fundal nu sunt active.",
    "Confirmed city for local information": "Orasul confirmat pentru informatii locale",
    "The first local pilot covers Bucharest with declared source coverage. Your interests also work without a city.": "Acoperirea locala incepe cu Bucuresti, pe baza surselor indicate. Interesele tale sunt disponibile si fara un oras.",
    "Local needs you want to follow": "Informatiile locale pe care le urmaresti",
    "Choose the subjects you want to keep in your profile. Your existing browser briefing stays separate.": "Alege subiectele pentru profilul tau. Selectia existenta din browser ramane separata.",
    "Your preferred daily mix": "Selectia zilnica preferata",
    "Balanced": "Echilibrata",
    "Personal updates alongside general interest information.": "Noutati personale alaturi de informatii de interes general.",
    "Personal updates first": "Mai intai noutatile personale",
    "Put authorized personal updates before general interest information.": "Afiseaza noutatile personale autorizate inaintea informatiilor generale.",
    "This saves your preferred mix. It does not connect accounts or change the current briefing.": "Se salveaza preferinta. Nu se conecteaza conturi si nu se modifica selectia curenta.",
    "Delete Wallet preferences": "Sterge preferintele",
    "Your profile is saved to your private DLKT account only when you choose Save. Unsaved edits are cleared when you leave this page.": "Profilul se salveaza in contul tau privat DLKT doar cand apesi Salveaza profilul. Modificarile nesalvate se elimina cand parasesti pagina.",
    "Delete your Wallet preferences?": "Stergi preferintele din Info Wallet?",
    "This removes your display name, language, time zone, preferred reading time, interests, confirmed city, local needs and daily mix preference from your Wallet. It does not delete your sign-in account or browser briefing, and it does not disconnect an email or social account. This cannot be undone.": "Se sterg numele afisat, limba, fusul orar, ora de lectura, interesele, orasul confirmat, nevoile locale si selectia zilnica preferata. Contul de conectare si selectia din browser raman; conturile externe nu se deconecteaza. Stergerea nu poate fi anulata.",
    "Keep preferences": "Pastreaza preferintele",
    "Relevant to you": "Relevant pentru tine",
    "Based on the preferences saved in your private profile. Source coverage varies. A matching interest is not proof of personal impact.": "Pe baza preferintelor salvate in profilul tau privat. Acoperirea surselor variaza. Potrivirea cu un interes nu confirma ca informatia te afecteaza direct.",
    "Refresh personal selection": "Actualizeaza selectia personala",
    "Show more matched cards": "Arata mai multe carduri potrivite",
    "Email & social accounts": "Conturi de email si sociale",
    "Retry connections": "Verifica din nou conexiunile",
    "Choose an available service to authorize your account. Your DLKT sign-in and each external connection are separate.": "Alege un serviciu disponibil pentru autorizare. Conectarea la DLKT si fiecare cont extern sunt separate.",
    "Checking connection availability…": "Se verifica disponibilitatea conexiunilor…",
    "A view count does not reveal who viewed something. A share count does not identify everyone who shared it. Names appear only when an authorized service provides them.": "Numarul de vizualizari sau distribuiri nu identifica persoanele implicate. Numele apar doar cand serviciul autorizat le furnizeaza.",
    "Your personal updates": "Noutatile tale personale",
    "No personal updates loaded": "Nu sunt incarcate noutati personale",
    "Connect an available account, then choose Check updates. Personal updates are cleared when you leave this page.": "Conecteaza un cont disponibil, apoi alege Verifica noutatile. Noutatile personale se elimina din pagina cand o parasesti.",
    "About DLKT": "Despre DLKT",
    "Sources & method": "Surse si metoda",
    "For organizations": "Pentru organizatii",
    "Company": "Companie",
    "Accessibility": "Accesibilitate",
    "Terms": "Termeni",
    "Privacy": "Confidentialitate",
    "Disclaimer": "Precizari",
    "Back to top": "Inapoi sus",
    "Your session ended. Sign in again to check your private profile.": "Sesiunea s-a incheiat. Conecteaza-te din nou pentru a verifica profilul privat.",
    "Your saved profile or session changed. Reload your Wallet before reading personal cards.": "Profilul salvat sau sesiunea s-a schimbat. Reincarca Info Wallet inainte de a citi cardurile personale.",
    "Account sign-in and private profile saving are not activated yet. No email address is collected here. You can explore the connection requirements below.": "Conectarea la cont si salvarea profilului privat nu sunt activate inca. Aici nu se colecteaza adrese de email. Poti consulta mai jos cerintele pentru conexiuni.",
    "Sign in to create your private Wallet profile. This does not authorize access to your email or social accounts.": "Conecteaza-te pentru a crea profilul privat. Aceasta actiune nu autorizeaza accesul la conturile de email sau sociale.",
    "Your profile has not been saved yet. Review these preferences before saving.": "Profilul nu este inca salvat. Verifica preferintele inainte de salvare.",
    "Signed in. Your profile is private. Email and social connections require separate authorization.": "Esti conectat. Profilul tau este privat. Conturile de email si sociale necesita autorizare separata.",
    "Your session changed. Reload your Wallet before making another change. Private details have been cleared.": "Sesiunea s-a schimbat. Reincarca Info Wallet inainte de alta modificare. Datele private au fost eliminate din pagina.",
    "Your profile changed in another tab or device. Reload your Wallet before making another change.": "Profilul s-a schimbat in alta fila sau pe alt dispozitiv. Reincarca Info Wallet inainte de alta modificare.",
    "Private profile saving is unavailable right now. Reload your Wallet to check its current state.": "Salvarea profilului privat nu este disponibila acum. Reincarca Info Wallet pentru a verifica starea curenta.",
    "Sign-out could not be confirmed. Your private details have been cleared from this page. Reload your Wallet to check your session.": "Deconectarea nu a putut fi confirmata. Datele private au fost eliminate din pagina. Reincarca Info Wallet pentru a verifica sesiunea.",
    "The change could not be confirmed. Reload your Wallet to check the saved profile before trying again.": "Modificarea nu a putut fi confirmata. Reincarca Info Wallet pentru a verifica profilul salvat inainte de a reincerca.",
    "Your private Wallet could not be checked. Reload to try again; no profile or activity is shown.": "Info Wallet nu a putut fi verificat. Reincarca pentru a reincerca. Profilul si activitatea privata nu sunt afisate.",
    "Private details are hidden. Return to reload your Wallet.": "Datele private sunt ascunse. Revino pentru a reincarca Info Wallet.",
    "Check your language code, time zone and preferred reading time. Keep the display name within 80 characters and use ordinary text.": "Verifica limba, fusul orar si ora de lectura. Numele afisat trebuie sa contina cel mult 80 de caractere si text obisnuit.",
    "Saving your private profile…": "Se salveaza profilul privat…",
    "Your private profile is saved. Your personal selection uses these confirmed preferences. Automatic delivery is not active.": "Profilul privat este salvat. Selectia personala foloseste aceste preferinte confirmate. Livrarea automata nu este activa.",
    "Deleting your Wallet preferences…": "Se sterg preferintele din Info Wallet…",
    "Your Wallet preferences were deleted. Your sign-in account and browser briefing are unchanged.": "Preferintele din Info Wallet au fost sterse. Contul de conectare si selectia din browser sunt neschimbate.",
    "Your session changed. Checking your Wallet again…": "Sesiunea s-a schimbat. Info Wallet este verificat din nou…",
    "Signing out and clearing private details…": "Se inchide sesiunea si se elimina datele private…",
    "You are signed out. Your private details have been cleared from this page.": "Esti deconectat. Datele private au fost eliminate din pagina.",
    "AI & technology": "AI si tehnologie",
    "Economy & business": "Economie si afaceri",
    "Rights & rules": "Drepturi si reguli",
    "Opportunities & deadlines": "Oportunitati si termene",
    "Science & discoveries": "Stiinta si descoperiri",
    "Climate & environment": "Clima si mediu",
    "Health & wellbeing": "Sanatate si stare de bine",
    "Politics & society": "Politica si societate",
    "World & security": "International si securitate",
    "Cybersecurity & digital rights": "Securitate cibernetica si drepturi digitale",
    "Culture & entertainment": "Cultura si divertisment",
    "Money & cost of living": "Bani si costul vietii",
    "Weather & emergencies": "Vreme si urgente",
    "Housing & cities": "Locuire si orase",
    "Travel & mobility": "Calatorii si mobilitate",
    "Food & consumer safety": "Alimentatie si siguranta consumatorului",
    "Other topics": "Alte subiecte",
    "AI, digital technology and software releases": "AI, tehnologie digitala si lansari software",
    "Economic developments, markets and businesses": "Economie, piete si afaceri",
    "Rights, public rules and legal publications": "Drepturi, reguli publice si publicatii juridice",
    "Opportunities, notices and useful deadlines; verify eligibility": "Oportunitati, anunturi si termene utile; verifica eligibilitatea",
    "Research findings and discoveries": "Rezultate ale cercetarii si descoperiri",
    "Climate, nature and environmental developments": "Clima, natura si evolutii ale mediului",
    "Public health and medical developments; source jurisdiction applies": "Sanatate publica si evolutii medicale; se aplica jurisdictia sursei",
    "Public decisions, government and society": "Decizii publice, administratie si societate",
    "International developments and security": "Evolutii internationale si securitate",
    "Cybersecurity, privacy and digital rights": "Securitate cibernetica, confidentialitate si drepturi digitale",
    "Arts, culture and entertainment": "Arta, cultura si divertisment",
    "Household money, prices and consumer finance": "Bugetul familiei, preturi si finante personale",
    "Space research, missions and astronomy": "Cercetare spatiala, misiuni si astronomie",
    "Weather developments and published emergency information; not a personal alert service": "Vreme si informatii publicate despre urgente; nu este un serviciu de alerte personale",
    "Energy supply, technology and policy": "Energie: furnizare, tehnologie si politici",
    "Employment, skills, learning and education": "Munca, competente, invatare si educatie",
    "Homes, planning and city life": "Locuinte, urbanism si viata orasului",
    "Travel, transport and mobility": "Calatorii, transport si mobilitate",
    "Food, product safety and consumer notices": "Alimentatie, siguranta produselor si anunturi pentru consumatori",
    "Sport developments and participation": "Noutati sportive si participare",
    "Source-checked publications without a confirmed topic label; not an inferred personal interest": "Publicatii verificate la sursa, fara o categorie confirmata; nu reprezinta un interes personal presupus",
    "Authorization returned. The current saved connection state is shown below.": "Ai revenit din procesul de autorizare. Starea actuala a conexiunii salvate este afisata mai jos.",
    "Authorization was cancelled. Your saved connections are checked below.": "Autorizarea a fost anulata. Conexiunile salvate sunt verificate mai jos.",
    "Authorization could not be completed. Check the service and try again.": "Autorizarea nu a putut fi finalizata. Verifica serviciul si incearca din nou.",
    "The authorization request expired. Start Connect again.": "Cererea de autorizare a expirat. Apasa din nou Conecteaza.",
    "Connected": "Conectat",
    "Authorization needs renewal": "Autorizarea trebuie reinnoita",
    "Ready to connect": "Disponibil pentru conectare",
    "Sign in to check availability": "Conecteaza-te pentru a verifica disponibilitatea",
    "Checking availability": "Se verifica disponibilitatea",
    "Not enabled for DLKT yet": "Inca neactivat in DLKT",
    "Availability not confirmed": "Disponibilitate neconfirmata",
    "No updates checked yet.": "Noutatile nu au fost inca verificate.",
    "Connect": "Conecteaza",
    "Check updates": "Verifica noutatile",
    "Reconnect": "Reconecteaza",
    "Unavailable": "Indisponibil",
    "Disconnect": "Deconecteaza",
    "Permissions & limits": "Permisiuni si limite",
    "Ready when you are": "Poti verifica noutatile cand doresti",
    "Connect an available account, then choose Check updates. This page does not run automatic or background synchronization.": "Conecteaza un cont disponibil, apoi apasa Verifica noutatile. Aceasta pagina nu sincronizeaza datele automat sau in fundal.",
    "Sign in to check your connections. Personal updates stay private and are cleared when you leave this page.": "Conecteaza-te pentru a verifica serviciile conectate. Noutatile personale raman private si sunt eliminate din pagina cand o parasesti.",
    "Some updates could not be retrieved": "Unele noutati nu au putut fi preluate",
    "These are the updates the service returned. This is not a complete activity history. Try Check updates again.": "Acestea sunt noutatile furnizate de serviciu. Nu reprezinta istoricul complet al activitatii. Apasa din nou Verifica noutatile.",
    "The latest check returned no updates within the supported window. This does not mean the account has no activity.": "Ultima verificare nu a returnat noutati pentru perioada acoperita. Acest lucru nu inseamna ca nu exista activitate in cont.",
    "Only activity returned by your authorized services is shown. Open an item to read it at the source.": "Sunt afisate doar activitatile furnizate de serviciile pe care le-ai autorizat. Deschide o informatie pentru a o citi la sursa.",
    "Sender as reported in the email header.": "Expeditorul indicat in antetul emailului.",
    "Opening secure authorization…": "Se deschide autorizarea securizata…",
    "Checking updates with the service…": "Se verifica noutatile la serviciul conectat…",
    "Disconnecting this account…": "Se deconecteaza acest cont…",
    "Checking saved connections…": "Se verifica conexiunile salvate…",
    "Disconnected from DLKT. Also remove DLKT access in the service account settings to revoke its authorization.": "Contul a fost deconectat de la DLKT. Pentru a revoca autorizarea, elimina si accesul DLKT din setarile contului de la serviciul respectiv.",
    "This account is disconnected from DLKT.": "Acest cont este deconectat de la DLKT.",
    "Latest check completed. Results are shown below.": "Ultima verificare s-a incheiat. Rezultatele sunt afisate mai jos.",
    "Choose Connect to authorize an available service. Each account needs your permission.": "Apasa Conecteaza pentru a autoriza un serviciu disponibil. Fiecare cont necesita permisiunea ta.",
    "Your saved connections are shown below. Updates are checked only when you request them.": "Conexiunile salvate sunt afisate mai jos. Noutatile sunt verificate numai atunci cand soliciti acest lucru.",
    "These services are not enabled for DLKT yet. Your DLKT profile is ready; no external account has been connected.": "Aceste servicii nu sunt inca activate in DLKT. Profilul DLKT este disponibil; niciun cont extern nu a fost conectat.",
    "Your session ended. Sign in to DLKT again to check these accounts.": "Sesiunea ta s-a incheiat. Conecteaza-te din nou la DLKT pentru a verifica aceste conturi.",
    "The connection state or change could not be confirmed. Choose Retry connections before trying again.": "Starea conexiunii sau modificarea ei nu a putut fi confirmata. Apasa Verifica din nou conexiunile inainte de o noua incercare.",
    "Sign in to DLKT above to check which accounts you can connect.": "Conecteaza-te la DLKT mai sus pentru a verifica ce conturi poti conecta.",
    "Account connections are not available in this environment.": "Conectarea conturilor externe nu este disponibila in acest mediu.",
    "Personal Google or Google Workspace account": "Cont personal Google sau Google Workspace",
    "Sender, subject, received time and unread status, with your permission.": "Expeditorul, subiectul, ora primirii si starea de citire, cu permisiunea ta.",
    "Group messages by conversation and open them in Gmail.": "Gruparea mesajelor pe conversatii si deschiderea lor in Gmail.",
    "Availability depends on the DLKT OAuth application and the access approved for your account. Public Gmail access requires Google verification.": "Disponibilitatea depinde de aplicatia OAuth DLKT si de accesul aprobat pentru contul tau. Accesul public la Gmail necesita verificarea Google.",
    "Reads message metadata only. It does not read message bodies or send email.": "Citeste doar metadatele mesajelor. Nu citeste continutul mesajelor si nu trimite emailuri.",
    "Personal Microsoft or work / school account": "Cont personal Microsoft sau cont de serviciu ori scoala",
    "Basic message details, with your permission.": "Detaliile de baza ale mesajelor, cu permisiunea ta.",
    "Reading message contents requires separate, broader permission.": "Citirea continutului mesajelor necesita o permisiune separata, mai extinsa.",
    "Your organization may require administrator approval.": "Organizatia ta poate solicita aprobarea administratorului.",
    "DLKT does not send messages or change your inbox.": "DLKT nu trimite mesaje si nu modifica inboxul.",
    "Instagram Business or Creator account": "Cont Instagram Business sau Creator",
    "Recent comments on your professional posts, with the permissions you grant.": "Comentariile recente la postarile contului tau profesional, conform permisiunilor acordate.",
    "Eligible professional accounts can authorize access through Instagram Login.": "Conturile profesionale eligibile pot autoriza accesul prin Instagram Login.",
    "Ordinary personal Instagram accounts are not eligible for this integration.": "Conturile personale obisnuite de Instagram nu sunt eligibile pentru aceasta integrare.",
    "The current connection does not retrieve direct messages, mentions, insights or identities of viewers and sharers.": "Conexiunea actuala nu preia mesaje directe, mentiuni, statistici sau identitatea persoanelor care vizualizeaza ori distribuie continutul.",
    "A Facebook Page you manage": "O Pagina Facebook pe care o administrezi",
    "Recent comments on posts from Facebook Pages you manage.": "Comentariile recente la postarile Paginilor Facebook pe care le administrezi.",
    "A bounded check of the Pages and posts actually supplied by Facebook.": "O verificare limitata a Paginilor si postarilor furnizate efectiv de Facebook.",
    "This integration does not provide your personal Facebook inbox.": "Aceasta integrare nu ofera acces la inboxul tau personal de Facebook.",
    "The current connection does not retrieve conversations, insights or identities of viewers and sharers.": "Conexiunea actuala nu preia conversatii, statistici sau identitatea persoanelor care vizualizeaza ori distribuie continutul.",
    "Open source": "Deschide sursa",
    "Source and coverage": "Sursa si acoperire",
    "Changed since the previous source check in this session.": "Modificari fata de verificarea anterioara a sursei din aceasta sesiune.",
    "Additional publisher coverage of this existing story.": "Relatari suplimentare ale altor publicatii despre acelasi subiect.",
    "Save card in this browser": "Salveaza cardul in acest browser",
    "Open saved cards in this browser": "Vezi cardurile salvate in browser",
    "This public source card was saved in this browser. Your private profile was not copied. ": "Cardul public a fost salvat in acest browser. Profilul tau privat nu a fost copiat. ",
    "Saving in this browser could not be confirmed.": "Salvarea in acest browser nu a putut fi confirmata.",
    "Confirm a city to match the local needs you selected.": "Confirma un oras pentru a primi informatiile locale selectate.",
    "Choose interests or confirm a city and select local needs, then save your profile.": "Selecteaza interese sau confirma un oras si alege informatiile locale, apoi salveaza profilul.",
    "Checking sources for your saved preferences.": "Se verifica sursele pentru preferintele tale salvate.",
    "Source checks timed out. Reload your Wallet to retry.": "Verificarea surselor a depasit timpul disponibil. Reincarca Info Wallet pentru a reincerca."
};
/** Only DLKT-owned UI text enters this function. Publisher and private provider text bypass it. */
export function walletText(value, locale = getLocale()) {
    if (locale !== 'ro')
        return value;
    if (Object.hasOwn(romanian, value))
        return romanian[value] ?? value;
    const shared = accountText(value, locale);
    if (shared !== value)
        return shared;
    const profile = /^Your profile was saved on (.+)\.$/u.exec(value);
    if (profile)
        return 'Profilul a fost salvat la ' + profile[1] + '.';
    const checked = /^Last checked: (.+)$/u.exec(value);
    if (checked)
        return 'Ultima verificare: ' + checked[1];
    const source = /^Source checked (.+)$/u.exec(value);
    if (source)
        return 'Sursa verificata la ' + source[1];
    const updates = /^(\d+) updates retrieved$/u.exec(value);
    if (updates)
        return updates[1] + (updates[1] === '1' ? ' noutate preluata' : ' noutati preluate');
    const more = /^Show more matched cards \((\d+)\)$/u.exec(value);
    if (more)
        return 'Arata mai multe carduri potrivite (' + more[1] + ')';
    const matches = /^(\d+) matched cards? from available checked sources\. (?:Local coverage: (ready|partial|unavailable|not-selected|not-configured|no-match)\. )?(?:Interest sources: (ready|partial|unavailable|not-selected)\. )?Missing checks do not mean that nothing happened\.$/u.exec(value);
    if (matches) {
        const states = { ready: 'disponibila', partial: 'partiala', unavailable: 'indisponibila', 'not-selected': 'neselectata', 'not-configured': 'neconfigurata', 'no-match': 'fara rezultate potrivite' };
        return matches[1] + (matches[1] === '1' ? ' card potrivit' : ' carduri potrivite') + ' din sursele disponibile verificate. '
            + (matches[2] ? 'Acoperire locala: ' + (states[matches[2]] ?? matches[2]) + '. ' : '')
            + (matches[3] ? 'Acoperirea intereselor: ' + (states[matches[3]] ?? matches[3]) + '. ' : '')
            + 'Lipsa verificarilor nu inseamna ca nu s-a intamplat nimic.';
    }
    return value;
}
const bindings = new WeakMap();
/** Bind only an owned leaf. No private canonical value is written to an attribute or persistent store. */
export function walletCopy(element, source, ariaSuffix) {
    if (!source) {
        bindings.delete(element);
        element.removeAttribute('data-wallet-ui');
        element.textContent = '';
        return;
    }
    const rendered = walletText(source);
    element.textContent = rendered;
    element.lang = getLocale() === 'ro' && rendered !== source ? 'ro' : 'en';
    element.dir = 'ltr';
    if (ariaSuffix !== undefined)
        element.setAttribute('aria-label', rendered + ': ' + ariaSuffix);
    element.setAttribute('data-wallet-ui', '');
    bindings.set(element, { source, rendered, ...(ariaSuffix === undefined ? {} : { ariaSuffix }) });
}
export function walletNode(tag, source, className = '') {
    const element = document.createElement(tag);
    element.className = className;
    walletCopy(element, source);
    return element;
}
/** Change labels around the native inputs, never their values or checked state. */
export function presentWalletProfileLabels() {
    for (const label of document.querySelectorAll('#wallet-local-needs>label')) {
        const input = label.querySelector('input');
        const leaf = label.lastChild;
        if (input && leaf?.nodeType === Node.TEXT_NODE)
            leaf.textContent = accountText(topicName(input.value));
    }
    const city = document.getElementById('wallet-city');
    const name = document.getElementById('wallet-city-name');
    if (city && name)
        walletCopy(name, city.value === '683506' ? 'Include Bucharest, Romania' : 'Previously saved city');
}
/** A locale event updates owned leaves in place. It never reloads private state or replaces cards/controls. */
export function applyWalletPresentation() {
    const locale = getLocale() === 'ro' ? 'ro' : 'en';
    for (const root of document.querySelectorAll('main.reader-shell, .site-footer')) {
        root.lang = locale;
        root.dir = 'ltr';
    }
    for (const element of document.querySelectorAll('[data-wallet-copy]')) {
        walletCopy(element, element.dataset.walletCopy ?? '');
    }
    for (const element of document.querySelectorAll('[data-wallet-ui]')) {
        const binding = bindings.get(element);
        if (!binding)
            continue;
        // Lifecycle code may have cleared a container. Never restore old text, or erase a newly appended child link.
        if (element.children.length || element.textContent !== binding.rendered) {
            bindings.delete(element);
            element.removeAttribute('data-wallet-ui');
            continue;
        }
        walletCopy(element, binding.source, binding.ariaSuffix);
    }
    presentWalletProfileLabels();
}
