import {getLocale} from '../i18n/browser.js';
import {NEWS_CATEGORIES,newsCategoryLabel,isNewsCategoryId,type NewsCategoryId} from './news-taxonomy.js';
import {NewsMasonry} from './news-masonry.js';
import {KNOWLEDGE_CARDS} from './knowledge-catalog.js';
import {DLKT_PLUS_PLAN,knowledgeLanguage,selectKnowledgeCards,knowledgeShareUrl,knowledgeTargetFromHash,type KnowledgeFilter,type KnowledgeLanguage} from './knowledge.js';

const labels={
 en:{news:'News',know:'Did you know?',title:'A little more to know.',intro:'Small discoveries. Useful context. Original sources.',preview:'Preview',category:'Category',all:'All categories',context:'The useful bit',source:'Open source',copy:'Copy card link',copied:'Card link copied.',copyFallback:'Copy this link to share the card.',checked:'Checked',count:'facts in this preview',empty:'No reviewed facts are available in this category yet.',english:'This preview is available in English, Romanian and Italian. The cards below are in English.',planTitle:'DLKT Plus',month:' / month',coming:'Planned membership',offer:'Did you know? is part of the planned Plus membership.',trial:'7 days to explore Plus, then €6.99/month.',planned:'Planned benefits: the growing knowledge collection, personal collections and reading preferences across devices.',notOpen:'Payments and trial activation are not open yet. This preview is free.',end:'You have seen this preview. More topics will appear as new facts are checked.'},
 ro:{news:'Stiri',know:'Stiati ca?',title:'Inca ceva de stiut.',intro:'Descoperiri scurte. Context util. Surse originale.',preview:'Preview',category:'Categorie',all:'Toate categoriile',context:'Ce merita retinut',source:'Deschide sursa',copy:'Copiaza linkul',copied:'Linkul cardului a fost copiat.',copyFallback:'Copiaza acest link pentru a distribui cardul.',checked:'Verificat',count:'informatii in acest preview',empty:'Nu exista inca informatii verificate in aceasta categorie.',english:'Acest preview este disponibil in engleza, romana si italiana. Cardurile de mai jos sunt in engleza.',planTitle:'DLKT Plus',month:' / luna',coming:'Abonament in pregatire',offer:'Stiati ca? face parte din viitorul abonament Plus.',trial:'7 zile pentru a explora Plus, apoi 6,99 EUR/luna.',planned:'Beneficii planificate: colectia de cunostinte in extindere, colectii personale si preferinte de lectura intre dispozitive.',notOpen:'Platile si activarea perioadei de proba nu sunt inca disponibile. Acest preview este gratuit.',end:'Ai parcurs acest preview. Alte subiecte vor aparea pe masura ce sunt verificate noi informatii.'},
 it:{news:'Notizie',know:'Lo sapevi?',title:'Qualcosa in più da sapere.',intro:'Piccole scoperte. Contesto utile. Fonti originali.',preview:'Anteprima',category:'Categoria',all:'Tutte le categorie',context:'Da ricordare',source:'Apri la fonte',copy:'Copia il link',copied:'Link della scheda copiato.',copyFallback:'Copia questo link per condividere la scheda.',checked:'Verificato',count:'fatti in questa anteprima',empty:'Nessun fatto verificato è ancora disponibile in questa categoria.',english:'Questa anteprima è disponibile in inglese, romeno e italiano. Le schede qui sotto sono in inglese.',planTitle:'DLKT Plus',month:' / mese',coming:'Abbonamento in preparazione',offer:'Lo sapevi? farà parte del futuro abbonamento Plus.',trial:'7 giorni per esplorare Plus, poi 6,99 EUR/mese.',planned:'Vantaggi previsti: la raccolta di conoscenze in crescita, collezioni personali e preferenze di lettura tra dispositivi.',notOpen:"Pagamenti e attivazione della prova non sono ancora disponibili. Questa anteprima è gratuita.",end:"Hai visto questa anteprima. Altri argomenti arriveranno man mano che saranno verificati nuovi fatti."},
} as const;
const italianCategories:Readonly<Record<NewsCategoryId,string>>={
 '01000000':'Cultura','02000000':'Giustizia','03000000':'Incidenti e disastri','04000000':'Economia','05000000':'Istruzione','06000000':'Ambiente','07000000':'Salute','08000000':'Storie di vita','09000000':'Lavoro','10000000':'Stile di vita','11000000':'Politica','12000000':'Religione','13000000':'Scienza e tecnologia','14000000':'Società','15000000':'Sport','16000000':'Guerra e pace','17000000':'Meteo',
};
function categoryLabel(id:NewsCategoryId,language:KnowledgeLanguage):string{return language==='it'?italianCategories[id]:newsCategoryLabel(id,language);}
function required<T extends HTMLElement>(id:string):T {const node=document.getElementById(id);if(!node)throw Error('KNOWLEDGE_ELEMENT_MISSING:'+id);return node as T;}
function make<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text=''):HTMLElementTagNameMap[K]{const node=document.createElement(tag);node.className=className;node.textContent=text;return node;}
export function knowledgeModeActive():boolean{return document.body.dataset.readerContent==='knowledge'&&document.body.dataset.entryView==='start'&&!document.body.dataset.worldExplore;}

export function setupKnowledgeReader():void {
 const controls=required<HTMLElement>('reader-content-switch'),section=required<HTMLElement>('knowledge-discovery'),grid=required<HTMLElement>('knowledge-cards');
 const news=required<HTMLButtonElement>('reader-news-mode'),know=required<HTMLButtonElement>('reader-knowledge-mode'),picker=required<HTMLSelectElement>('knowledge-category');
 const status=required<HTMLElement>('knowledge-share-status'),fallback=required<HTMLInputElement>('knowledge-copy-link');
 let filter:KnowledgeFilter='all',masonry:NewsMasonry|null=null,renderKey='',shareRevision=0;
 const seed=new Date().toISOString().slice(0,10);
 function clearShare():void{shareRevision++;status.textContent='';fallback.hidden=true;fallback.value='';}
 function showMode(mode:'news'|'knowledge',focus=false,updateUrl=true):void {
  document.body.dataset.readerContent=mode;clearShare();
  if(updateUrl&&knowledgeTargetFromHash(location.hash)){
   const url=new URL(location.href);url.hash='';history.replaceState(null,'',url);
  }
  render();document.dispatchEvent(new CustomEvent('dlkt:knowledge-mode'));
  if(focus)(mode==='knowledge'?required<HTMLElement>('knowledge-title'):required<HTMLElement>('entry-title')).focus({preventScroll:true});
 }
 function render():void {
  const locale=getLocale(),language=knowledgeLanguage(locale),copy=labels[language];
  const home=document.body.dataset.entryView==='start'&&!document.body.dataset.worldExplore,active=home&&knowledgeModeActive();
  controls.hidden=!home;section.hidden=!active;
  news.textContent=copy.news;know.textContent=copy.know;news.setAttribute('aria-pressed',String(!active));know.setAttribute('aria-pressed',String(active));
  controls.setAttribute('aria-label',language==='ro'?'Tip de continut':language==='it'?'Tipo di contenuto':'Content type');
  if(!active){masonry?.disconnect();masonry=null;return;}
  required<HTMLElement>('knowledge-title').textContent=copy.title;required<HTMLElement>('knowledge-intro').textContent=copy.intro;
  required<HTMLElement>('knowledge-preview').textContent=copy.preview;required<HTMLElement>('knowledge-category-label').textContent=copy.category;
  const note=required<HTMLElement>('knowledge-language-note');note.hidden=locale===language;note.textContent=copy.english;
  const eligible=selectKnowledgeCards(KNOWLEDGE_CARDS,'all',Date.now(),seed);
  const available=new Set(eligible.map(card=>card.category));
  if(filter!=='all'&&!available.has(filter))filter='all';
  const categoryKey=language+':'+[...available].join(',');
  if(picker.dataset.optionsKey!==categoryKey){
   const all=make('option','',copy.all);all.value='all';const options=[all];
   for(const category of NEWS_CATEGORIES){if(!available.has(category.id))continue;const option=make('option','',categoryLabel(category.id,language));option.value=category.id;options.push(option);}
   picker.replaceChildren(...options);picker.dataset.optionsKey=categoryKey;
  }
  picker.value=filter;
  const selected=selectKnowledgeCards(KNOWLEDGE_CARDS,filter,Date.now(),seed);
  required<HTMLElement>('knowledge-count').textContent=selected.length+' '+copy.count;
  required<HTMLElement>('knowledge-plan-label').textContent=copy.coming;
  required<HTMLElement>('knowledge-plan-title').textContent=copy.planTitle;
  required<HTMLElement>('knowledge-plan-price').textContent=new Intl.NumberFormat(language,{style:'currency',currency:DLKT_PLUS_PLAN.currency}).format(DLKT_PLUS_PLAN.monthlyMinor/100)+copy.month;
  required<HTMLElement>('knowledge-plan-offer').textContent=copy.offer;
  required<HTMLElement>('knowledge-plan-trial').textContent=copy.trial;
  required<HTMLElement>('knowledge-plan-benefits').textContent=copy.planned;
  required<HTMLElement>('knowledge-plan-state').textContent=copy.notOpen;
  required<HTMLElement>('knowledge-end').textContent=selected.length?copy.end:copy.empty;
  const key=language+':'+filter+':'+selected.map(card=>card.id+':'+card.revision).join(',');
  if(renderKey!==key){
   masonry?.disconnect();masonry=null;renderKey=key;clearShare();
   const fragment=document.createDocumentFragment();
   for(const card of selected){
    const value=card.copy[language],article=make('article','knowledge-card');
    article.id='know-'+card.id;article.dataset.knowledgeId=card.id;article.dataset.newsStreamKey='knowledge:'+card.id;article.dataset.newsCategory=card.category;
    article.lang=language;article.dir='auto';article.tabIndex=-1;
    const meta=make('div','knowledge-card-meta');meta.append(make('span','knowledge-category-tag',categoryLabel(card.category,language)),make('span','knowledge-topic',card.topic[language]));
    const title=make('h2','knowledge-card-title',value.title);title.id='know-title-'+card.id;article.setAttribute('aria-labelledby',title.id);
    const detail=make('details','knowledge-context');detail.append(make('summary','',copy.context),make('p','',value.connection));
    const provenance=make('p','knowledge-provenance'),reviewed=make('time','',new Intl.DateTimeFormat(language,{year:'numeric',month:'short',day:'numeric'}).format(new Date(card.reviewedAt)));
    reviewed.dateTime=card.reviewedAt;reviewed.title=card.reviewedAt;
    provenance.append(document.createTextNode(card.source.publisher+' · '+copy.checked+' '),reviewed);
    const actions=make('div','knowledge-actions'),source=make('a','knowledge-source',copy.source+' ↗');
    source.href=card.source.url;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label',copy.source+' · '+card.source.publisher);
    const share=make('button','knowledge-share',copy.copy);share.type='button';share.dataset.knowledgeShare=card.id;
    share.setAttribute('aria-label',copy.copy+' · '+value.title);
    actions.append(source,share);article.append(meta,title,make('p','knowledge-explanation',value.explanation),detail,provenance,actions);fragment.append(article);
   }
   grid.replaceChildren(fragment);
  }
  if(masonry===null)masonry=new NewsMasonry(grid);masonry.update();
 }
 news.addEventListener('click',()=>showMode('news',true));
 know.addEventListener('click',()=>showMode('knowledge',true));
 picker.addEventListener('change',()=>{
  const value=picker.value;if(value!=='all'&&!isNewsCategoryId(value))return;filter=value;render();
 });
 grid.addEventListener('click',event=>{
  if(!(event.target instanceof Element))return;
  const button=event.target.closest<HTMLButtonElement>('[data-knowledge-share]');if(!button)return;
  const card=KNOWLEDGE_CARDS.find(value=>value.id===button.dataset.knowledgeShare);if(!card)return;
  const language=knowledgeLanguage(getLocale()),copy=labels[language],url=knowledgeShareUrl(card,language),ticket=++shareRevision;
  fallback.hidden=true;status.textContent='';
  void (async()=>{
   try{
    if(!navigator.clipboard?.writeText)throw Error('CLIPBOARD_UNAVAILABLE');
    await navigator.clipboard.writeText(url);if(ticket===shareRevision&&knowledgeModeActive())status.textContent=copy.copied;
   }catch{
    if(ticket!==shareRevision||!knowledgeModeActive())return;
    fallback.value=url;fallback.hidden=false;fallback.focus();fallback.select();status.textContent=copy.copyFallback;
   }
  })();
 });
 for(const id of ['entry-today','entry-return'])required<HTMLButtonElement>(id).addEventListener('click',()=>showMode('news'));
 document.addEventListener('dlkt:entry-view',render);document.addEventListener('dlkt:explore-view',render);
 document.addEventListener('dlkt:language-changed',render);
 window.addEventListener('pagehide',()=>{shareRevision++;masonry?.disconnect();masonry=null;});
 window.addEventListener('pageshow',render);
 function openLinkedCard():void {
  const id=knowledgeTargetFromHash(location.hash);if(!id)return;
  const card=KNOWLEDGE_CARDS.find(value=>value.id===id&&Date.now()>=Date.parse(value.reviewedAt)&&Date.now()<Date.parse(value.reviewBy));if(!card)return;
  filter='all';document.dispatchEvent(new CustomEvent('dlkt:reader-selected',{detail:{view:'start'}}));
  showMode('knowledge',false,false);const target=document.getElementById('know-'+id);target?.focus({preventScroll:true});target?.scrollIntoView({block:'center'});
 }
 window.addEventListener('hashchange',openLinkedCard);
 render();openLinkedCard();
}
