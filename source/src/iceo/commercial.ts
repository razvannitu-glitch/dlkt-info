export type CommercialLanguage='en'|'ro'|'it';
export interface CommercialArea {readonly city:string;readonly country:string}
export interface CommercialBrief {
 readonly business:string;readonly city:string;readonly country:string;
 readonly offer:string;readonly destination:string;readonly validUntil:string;
}
export interface CommercialRequest {readonly body:string;readonly mailto:string}
const CONTROLS=/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\p{Surrogate}]/u;
function field(value:unknown,max:number):value is string {
 return typeof value==='string'&&value.trim().length>0&&value===value.trim()&&value.length<=max&&!CONTROLS.test(value);
}
export function commercialLanguage(value:unknown):CommercialLanguage {return value==='ro'||value==='it'?value:'en';}
export function validCommercialArea(value:unknown):value is CommercialArea {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const area=value as Record<string,unknown>;return field(area.city,100)&&field(area.country,100);
}
export function commercialAreaFromSearch(search:string):CommercialArea|null {
 if(search.length>2048)return null;
 const query=new URLSearchParams(search);
 if(query.getAll('city').length!==1||query.getAll('country').length!==1)return null;
 const area={city:query.get('city'),country:query.get('country')};return validCommercialArea(area)?area:null;
}
export function commercialRequestUrl(area:CommercialArea,language:string):string {
 if(!validCommercialArea(area))throw Error('COMMERCIAL_AREA_INVALID');
 return '/organizations?'+new URLSearchParams({city:area.city,country:area.country,lang:commercialLanguage(language)}).toString()+'#advertise';
}
function destination(value:unknown):value is string {
 if(!field(value,2048))return false;
 try{const url=new URL(value),host=url.hostname.replace(/\.$/u,'');return url.protocol==='https:'&&!url.username&&!url.password&&host.includes('.')&&host!=='localhost'&&!host.endsWith('.localhost')&&!host.endsWith('.local')&&!/^[\d.]+$/u.test(host);}
 catch{return false;}
}
function calendarDate(value:unknown):value is string {
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value))return false;
 const stamp=Date.parse(value+'T00:00:00.000Z');return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value;
}
export function validCommercialBrief(value:unknown):value is CommercialBrief {
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 const brief=value as Record<string,unknown>;
 return Object.keys(brief).sort().join(',')==='business,city,country,destination,offer,validUntil'
  &&field(brief.business,100)&&field(brief.city,100)&&field(brief.country,100)
  &&field(brief.offer,600)&&destination(brief.destination)&&calendarDate(brief.validUntil);
}
export function prepareCommercialRequest(value:unknown):CommercialRequest|null {
 if(!validCommercialBrief(value))return null;
 const body=[
  'DLKT local advertising enquiry','',
  'Business: '+value.business,'City / area: '+value.city,'Country: '+value.country,
  'Offer and applicable conditions: '+value.offer,'Original offer URL: '+value.destination,
  'Proposed offer expiry date: '+value.validUntil,'',
  'Please confirm placement availability, review requirements, campaign dates and a price quote.',
  'This is an enquiry. No advertising placement, payment or publication is authorized by preparing this draft.',
 ].join('\n');
 return {body,mailto:'mailto:office@dlkt.ee?subject='+encodeURIComponent('DLKT · Local advertising enquiry')+'&body='+encodeURIComponent(body)};
}
export const COMMERCIAL_COPY={
 en:{label:'Local advertising',title:'Your ad here.',body:'Bring a useful offer to readers in',action:'Propose a local offer',note:'Enquiries open. Publication follows review and an agreed quote.',heading:'Advertise locally on DLKT.',intro:'Tell us what you offer and where it is available. Review your request before sending it. No payment or publication starts here.',business:'Business name',city:'City / service area',country:'Country',offer:'Offer, price and conditions',destination:'Original offer page',validUntil:'Offer valid until',prepare:'Prepare request',review:'Review your advertising enquiry',open:'Open email draft',copy:'Copy request',ready:'Your draft is ready below. Nothing has been sent.',copied:'Request copied. You decide whether to send it.',copyFailed:'Copy is unavailable. Select the request text and copy it manually.',invalid:'Complete the six fields with a valid date and a public HTTPS offer page. Use one line for each field.',hint:'Paid cards will be labelled. Availability, business identity, offer terms and destination are reviewed before an agreed placement. No audience or sales result is promised.',draftHint:'This draft stays on this page. Your email app opens only when you choose Open email draft; you choose whether to send.',price:'Placement format, dates and price are agreed before publication.'},
 ro:{label:'Publicitate locala',title:'Reclama ta aici.',body:'Prezinta o oferta utila cititorilor din',action:'Propune o oferta locala',note:'Primim solicitari. Publicarea urmeaza dupa verificare si oferta de pret acceptata.',heading:'Promoveaza local pe DLKT.',intro:'Spune-ne ce oferi si unde este disponibila oferta. Citeste solicitarea inainte sa o trimiti. Aici nu incepe nicio plata sau publicare.',business:'Numele afacerii',city:'Oras / zona deservita',country:'Tara',offer:'Oferta, pretul si conditiile',destination:'Pagina originala a ofertei',validUntil:'Oferta valabila pana la',prepare:'Pregateste solicitarea',review:'Citeste solicitarea de publicitate',open:'Deschide ciorna de email',copy:'Copiaza solicitarea',ready:'Ciorna este pregatita mai jos. Nimic nu a fost trimis.',copied:'Solicitarea a fost copiata. Tu decizi daca o trimiti.',copyFailed:'Copierea automata nu este disponibila. Selecteaza textul si copiaza-l manual.',invalid:'Completeaza cele sase campuri cu o data valida si o pagina HTTPS publica a ofertei. Foloseste un singur rand pentru fiecare camp.',hint:'Cardurile platite vor fi etichetate. Verificam disponibilitatea, identitatea afacerii, conditiile si destinatia ofertei inainte de publicarea convenita. Nu promitem audienta sau vanzari.',draftHint:'Ciorna ramane in aceasta pagina. Aplicatia de email se deschide doar la alegerea ta; tu decizi daca trimiti mesajul.',price:'Formatul, perioada si pretul sunt agreate inainte de publicare.'},
 it:{label:'Pubblicita locale',title:'Il tuo annuncio qui.',body:'Proponi un’offerta utile ai lettori di',action:'Proponi un’offerta locale',note:'Richieste aperte. Pubblicazione dopo verifica e preventivo concordato.',heading:'Promuovi la tua attivita su DLKT.',intro:'Descrivi l’offerta e la zona servita. Rileggi la richiesta prima di inviarla. Qui non iniziano pagamenti o pubblicazioni.',business:'Nome dell’attivita',city:'Citta / zona servita',country:'Paese',offer:'Offerta, prezzo e condizioni',destination:'Pagina originale dell’offerta',validUntil:'Offerta valida fino al',prepare:'Prepara la richiesta',review:'Rivedi la richiesta pubblicitaria',open:'Apri la bozza email',copy:'Copia la richiesta',ready:'La bozza e pronta qui sotto. Nulla e stato inviato.',copied:'Richiesta copiata. Decidi tu se inviarla.',copyFailed:'La copia automatica non e disponibile. Seleziona il testo e copialo manualmente.',invalid:'Compila i sei campi con una data valida e una pagina HTTPS pubblica. Usa una sola riga per ogni campo.',hint:'Gli annunci a pagamento saranno etichettati. Disponibilita, identita aziendale, condizioni e destinazione sono verificati prima della pubblicazione concordata. Nessuna promessa di pubblico o vendite.',draftHint:'La bozza resta in questa pagina. L’app email si apre solo quando scegli di farlo; decidi tu se inviare.',price:'Formato, periodo e prezzo vengono concordati prima della pubblicazione.'},
} as const;
