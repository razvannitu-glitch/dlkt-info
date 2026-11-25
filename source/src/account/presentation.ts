import {getLocale} from '../i18n/browser.js';
import {LOCALES,type Locale} from '../i18n/locale.js';
import {WELCOME_COPY} from '../brand/welcome-copy.js';

const romanian:Readonly<Record<string,string>>={
  "Your account.": "Contul tau.",
  "Back to briefing": "Inapoi la stiri",
  "Check account": "Verifica contul",
  "Email": "Email",
  "Send sign-in code": "Trimite codul de conectare",
  "Email code": "Codul din email",
  "Verify code": "Verifica codul",
  "Sign out": "Deconectare",
  "Local": "Local",
  "City": "Oras",
  "Country": "Tara",
  "World": "International",
  "Made personal": "Pe gustul tau",
  "Your profile": "Profilul tau",
  "Choose what matters to you. Your preferences shape your personal selection in Info Wallet.": "Alege ce conteaza pentru tine. Preferintele tale contureaza selectia personala din Info Wallet.",
  "Your details": "Datele tale",
  "Display name": "Numele afisat",
  "Preferred language": "Limba preferata",
  "Timezone": "Fus orar",
  "These profile preferences do not replace the language or place you choose while browsing.": "Preferintele profilului nu inlocuiesc limba sau locatia pe care le alegi cand navighezi.",
  "Your local day": "Ziua ta, aproape de tine",
  "City for local information": "Orasul pentru informatii locale",
  "Include Bucharest, Romania": "Include Bucuresti, Romania",
  "Local coverage currently starts with Bucharest. Country and world interests also work without a city.": "Acoperirea locala incepe momentan cu Bucuresti. Subiectele nationale si internationale sunt disponibile si fara un oras selectat.",
  "Useful near you": "Informatii utile din apropiere",
  "Your interests": "Interesele tale",
  "Select the subjects you want to follow. You can change your choices whenever you like.": "Selecteaza subiectele pe care vrei sa le urmaresti. Iti poti schimba alegerile oricand.",
  "Interests": "Interese",
  "Your choices are saved only when you press Save profile.": "Alegerile se pastreaza doar cand apesi Salveaza profilul.",
  "Save profile": "Salveaza profilul",
  "Keep useful things close": "Pastreaza ce iti este util",
  "Your saved reader copy": "Selectia ta salvata",
  "Import or restore a saved copy when you choose. This replaces the destination copy; it is not automatic syncing. Original source dates are retained. Use a private browser for your personal data.": "Importa sau restaureaza o copie atunci cand alegi. Actiunea inlocuieste copia de la destinatie; nu este o sincronizare automata. Datele originale ale surselor se pastreaza. Foloseste un browser personal pentru datele tale.",
  "Reload account copy": "Reincarca selectia din cont",
  "Import from this browser": "Importa din acest browser",
  "Restore in this browser": "Restaureaza in acest browser",
  "Delete account reader copy": "Sterge selectia din cont",
  "Confirm": "Confirma",
  "Cancel": "Anuleaza",
  "Technology": "Tehnologie",
  "Regulation": "Reglementari",
  "Opportunities": "Oportunitati",
  "Science": "Stiinta",
  "Environment": "Mediu",
  "Health": "Sanatate",
  "Public affairs": "Viata publica",
  "Digital life": "Viata digitala",
  "Culture": "Cultura",
  "Money": "Bani",
  "Space": "Spatiu",
  "Weather": "Vreme",
  "Energy": "Energie",
  "Work & education": "Munca si educatie",
  "Housing": "Locuire",
  "Travel": "Calatorii",
  "Food": "Alimentatie",
  "Sport": "Sport",
  "Other": "Alte subiecte",
  "Mobility": "Mobilitate",
  "Utilities": "Utilitati",
  "Public services": "Servicii publice",
  "Safety": "Siguranta",
  "Checking account availability.": "Se verifica disponibilitatea contului.",
  "Sign in to access your reader copy across devices.": "Conecteaza-te pentru a accesa selectia salvata pe dispozitivele tale.",
  "Signed in. Local data is not uploaded automatically.": "Esti conectat. Datele din browser nu sunt incarcate automat.",
  "No reader copy has been saved in this account.": "Nu ai inca o selectie salvata in acest cont.",
  "No profile has been saved in this account. These starting values are saved only when you choose Save profile.": "Profilul nu este inca salvat. Valorile initiale se pastreaza doar cand alegi Salveaza profilul.",
  "Profile preferences could not be loaded. Reload your account to retry. Your saved reader copy remains available.": "Preferintele nu au putut fi incarcate. Reincarca datele contului pentru a reincerca. Selectia salvata ramane disponibila.",
  "Enter the sign-in code sent to your email. You can request another code if needed.": "Introdu codul de conectare primit prin email. Poti solicita un alt cod daca ai nevoie.",
  "Enter the sign-in code sent to your email.": "Introdu codul de conectare primit prin email.",
  "Requesting a sign-in code.": "Se solicita codul de conectare.",
  "Verifying your sign-in code.": "Se verifica codul de conectare.",
  "Email changed. Request a sign-in code for this address.": "Adresa de email s-a schimbat. Solicita un cod pentru aceasta adresa.",
  "The code was not accepted. Try the code from your email or request a new code.": "Codul nu a fost acceptat. Verifica emailul primit sau solicita un cod nou.",
  "Too many sign-in attempts. Wait before trying again.": "Prea multe incercari de conectare. Asteapta inainte de a reincerca.",
  "Your session ended. Check account to sign in again. Private account details and pending actions have been cleared.": "Sesiunea s-a incheiat. Apasa Verifica contul pentru a te conecta din nou. Datele private si actiunile in asteptare au fost eliminate din pagina.",
  "Your session changed. Check account before making another change. Private details and pending actions have been cleared.": "Sesiunea s-a schimbat. Verifica din nou contul inainte de alta modificare. Datele private si actiunile in asteptare au fost eliminate din pagina.",
  "This profile changed on another device. Reload your account before saving again.": "Profilul a fost modificat pe alt dispozitiv. Reincarca datele contului inainte de o noua salvare.",
  "This account copy changed on another device. Check account to reload it before making another change.": "Selectia din cont a fost modificata pe alt dispozitiv. Verifica din nou contul inainte de alta modificare.",
  "The profile change could not be confirmed. Reload your account before retrying. Private details and pending changes have been cleared.": "Salvarea profilului nu a putut fi confirmata. Reincarca datele contului inainte de a reincerca. Datele private si modificarile in asteptare au fost eliminate din pagina.",
  "Sign-out could not be confirmed. Private details have been cleared from this page. Check account to verify your session.": "Deconectarea nu a putut fi confirmata. Datele private au fost eliminate din pagina. Verifica din nou contul pentru a confirma starea sesiunii.",
  "The change could not be confirmed. Check account and the browser copy before trying again. No pending action is retained.": "Modificarea nu a putut fi confirmata. Verifica datele contului si copia din browser inainte de a reincerca. Nu a ramas nicio actiune in asteptare.",
  "Account availability could not be verified. Private details are hidden. Check account to try again.": "Disponibilitatea contului nu a putut fi verificata. Datele private sunt ascunse. Apasa Verifica contul pentru a reincerca.",
  "Private details are hidden. Return to check your account.": "Datele private sunt ascunse. Revino pentru a verifica din nou contul.",
  "Your session changed. Checking your account again.": "Sesiunea s-a schimbat. Contul este verificat din nou.",
  "Your session is confirmed. Opening Info Wallet.": "Sesiunea este confirmata. Se deschide Info Wallet.",
  "Signing out and clearing private details.": "Se inchide sesiunea si se elimina datele private din pagina.",
  "You are signed out. Private account details and pending actions have been cleared from this page.": "Esti deconectat. Datele private si actiunile in asteptare au fost eliminate din pagina.",
  "Checking the browser copy before confirmation.": "Se verifica selectia din browser inainte de confirmare.",
  "Review the replacement before confirming. Nothing has been imported.": "Verifica inlocuirea inainte de confirmare. Importul nu a fost efectuat.",
  "Replace this browser’s remembered focus, saved cards and comparison check with the account copy? Other site data will not be changed.": "Inlocuiesti preferinta memorata, cardurile salvate si comparatia din acest browser cu copia din cont? Celelalte date ale site-ului nu vor fi modificate.",
  "Delete only the reader copy from this account? This does not delete your sign-in account or local browser copies.": "Stergi doar selectia salvata in cont? Contul de conectare si copiile din browser nu vor fi sterse.",
  "Checking your session before applying the confirmed change.": "Se verifica sesiunea inainte de aplicarea modificarii confirmate.",
  "Reader copy saved to the account. The local browser copy is unchanged.": "Selectia a fost salvata in cont. Copia din browser a ramas neschimbata.",
  "Account copy restored in this browser. Return to the briefing to use it.": "Selectia din cont a fost restaurata in acest browser. Revino la stiri pentru a o folosi.",
  "Account reader copy deleted. Local browser data is unchanged.": "Selectia din cont a fost stearsa. Datele din browser au ramas neschimbate.",
  "Check the name, language tag, timezone and interests before saving.": "Verifica numele, limba, fusul orar si interesele inainte de salvare.",
  "Checking your session before saving the profile.": "Se verifica sesiunea inainte de salvarea profilului.",
  "Profile saved to your account. Open Info Wallet to read your personal selection. Your saved reader copy and this browser’s reading preferences are unchanged.": "Profilul a fost salvat in cont. Deschide Info Wallet pentru selectia ta personala. Selectia salvata si preferintele de lectura ale browserului au ramas neschimbate.",
  "Account sign-in and cross-device saving are not activated yet. Reading, browser-only saving and edition preparation remain available. No email address is collected here.": "Conectarea si salvarea intre dispozitive nu sunt inca activate. Lectura, salvarea in browser si pregatirea selectiei raman disponibile. Aici nu este colectata nicio adresa de email."
};
/** Account utility copy currently ships in Romanian and English; no mislabeled fallback. */
export function accountText(value:string,locale:Locale=getLocale()):string{
  return locale==='ro'?(romanian[value]??value):value;
}
export function topicName(value:string):string{
  return value==='work-education'?'Work & education':value.charAt(0).toUpperCase()+value.slice(1).replaceAll('-',' ');
}
export function applyAccountPresentation():void{
  const locale=getLocale(),utilityLocale=locale==='ro'?'ro':'en';
  const root=document.querySelector<HTMLElement>('main.account-page');
  if(root){root.lang=utilityLocale;root.dir='ltr';}
  for(const node of document.querySelectorAll<HTMLElement>('[data-account-copy]')){
    node.textContent=accountText(node.dataset.accountCopy??'');node.lang=utilityLocale;node.dir='ltr';
  }
  const value=document.getElementById('account-value'),definition=LOCALES.find(item=>item.code===locale);
  if(value){value.textContent=WELCOME_COPY[locale].value;value.lang=locale;value.dir=definition?.direction??'ltr';}
  for(const label of document.querySelectorAll<HTMLLabelElement>('#account-profile-local-needs>label')){
    const input=label.querySelector<HTMLInputElement>('input');
    const node=label.lastChild;
    if(input&&node?.nodeType===Node.TEXT_NODE)node.textContent=accountText(topicName(input.value));
  }
  for(const id of ['account-message','account-profile-message']){
    const node=document.getElementById(id);if(!node)continue;
    const current=node.textContent??'';
    const original=Object.entries(romanian).find(([,translated])=>translated===current)?.[0]??current;
    node.textContent=accountText(original);
  }
  const city=document.getElementById('account-profile-city') as HTMLInputElement|null;
  const name=document.getElementById('account-profile-city-name');
  if(city?.value==='683506'&&name)name.textContent=accountText('Include Bucharest, Romania');
}
