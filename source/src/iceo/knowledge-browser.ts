import {getLocale} from '../i18n/browser.js';
import {knowledgeLanguage,type KnowledgeCard} from './knowledge.js';
import type {KnowledgeScope} from './knowledge-stream.js';

const labels={
 en:{know:'Did you know?',history:'On this day',recipe:'Recipe idea',care:'Together for good',context:'The useful bit',source:'Open source',careSource:'See official initiative',careNotice:'Independent information. No DLKT partnership or fundraising is implied.',checked:'Checked',global:'General knowledge'},
 ro:{know:'Stiati ca?',history:'S-a intamplat azi',recipe:'Idee de reteta',care:'Impreuna pentru bine',context:'Ce merita retinut',source:'Deschide sursa',careSource:'Vezi initiativa oficiala',careNotice:'Informare independenta. Nu este anuntat un parteneriat si DLKT nu colecteaza donatii.',checked:'Verificat',global:'Fapt general'},
 it:{know:'Lo sapevi?',history:'Accadde oggi',recipe:'Idea ricetta',care:'Insieme per il bene',context:'Da ricordare',source:'Apri la fonte',careSource:'Vedi iniziativa ufficiale',careNotice:'Informazione indipendente. Nessuna partnership DLKT o raccolta fondi e implicata.',checked:'Verificato',global:'Conoscenza generale'},
} as const;
function make<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text=''):HTMLElementTagNameMap[K]{
 const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
}
/** The sole knowledge surface is an inline card selected by the news stream's fixed cadence. */
export function knowledgeCardNode(card:KnowledgeCard,scope:KnowledgeScope):HTMLElement {
 const language=knowledgeLanguage(getLocale()),copy=labels[language],value=card.copy[language];
 const article=make('article','knowledge-card knowledge-card-inline');
 article.id='news-know-'+card.id;article.dataset.knowledgeId=card.id;article.dataset.newsStreamKey='knowledge:'+card.id;
 article.dataset.newsCategory=card.category;article.dataset.knowledgeScope=scope;article.dataset.knowledgeFormat=card.format??'did-you-know';
 article.dataset.liveSignature=JSON.stringify([card.id,card.revision,language,scope]);article.dataset.editionPart='stream';
 article.lang=language;article.dir='auto';article.tabIndex=-1;
 const meta=make('div','knowledge-card-meta');meta.append(make('span','knowledge-category-tag',card.format==='on-this-day'?copy.history:card.format==='recipe'?copy.recipe:card.format==='care'?copy.care:copy.know),make('span','knowledge-topic',scope==='global'?copy.global:(card.geography?.label[language]??copy.global)));
 const title=make('h3','knowledge-card-title',value.title);title.id='news-know-title-'+card.id;article.setAttribute('aria-labelledby',title.id);
 const detail=make('details','knowledge-context');detail.append(make('summary','',copy.context),make('p','',value.connection));
 const provenance=make('p','knowledge-provenance'),reviewed=make('time','',new Intl.DateTimeFormat(language,{year:'numeric',month:'short',day:'numeric'}).format(new Date(card.reviewedAt)));
 reviewed.dateTime=card.reviewedAt;reviewed.title=card.reviewedAt;
 provenance.append(document.createTextNode(card.source.publisher+' · '+copy.checked+' '),reviewed);
 const actions=make('div','knowledge-actions'),source=make('a','knowledge-source',card.format==='care'?copy.careSource:copy.source);
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg'),path=document.createElementNS('http://www.w3.org/2000/svg','path');
 icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','16');icon.setAttribute('height','16');icon.setAttribute('aria-hidden','true');icon.setAttribute('focusable','false');
 path.setAttribute('d','M7 17 17 7M7 7h10v10');path.setAttribute('fill','none');path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.8');path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');icon.append(path);source.append(icon);
 source.href=card.source.url;source.target='_blank';source.rel='noopener noreferrer';source.setAttribute('aria-label',(card.format==='care'?copy.careSource:copy.source)+' · '+card.source.publisher);
 actions.append(source);
 article.append(meta,title,make('p','knowledge-explanation',value.explanation),detail,provenance,actions);if(card.format==='care')article.append(make('p','knowledge-care-notice',copy.careNotice));return article;
}
