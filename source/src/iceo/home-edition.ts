import type {ContextualToday} from './contextual-today.js';
import {DAILY_EDITION_POLICY} from './contextual-today.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_LABELS,editorialCategory} from './editorial-categories.js';
import type {ContextualReadingCard} from './contextual.js';

type CardNode=(view:ContextualReadingCard,index:number,total:number)=>HTMLElement;
export type PublicEditionState='pending'|'unavailable'|'empty'|'ready';
export function publicEditionState(selection:ContextualToday,acquisition:{snapshotState:'ready'|'partial'|'unavailable'|null;loading:boolean;failed:boolean}):PublicEditionState {
  if(acquisition.loading)return 'pending';
  if(acquisition.snapshotState===null||acquisition.snapshotState==='unavailable')return 'unavailable';
  if(selection.first.length+selection.more.length)return 'ready';
  return acquisition.failed?'unavailable':'empty';
}
export function dailyEditionSummary(selection:ContextualToday):string {
  const count=selection.first.length,topics=selection.daily?.selectedCategories.length??new Set(selection.first.map(view=>editorialCategory(view.card)).filter(Boolean)).size;
  const coverage=`${count} selected publication${count===1?'':'s'} from the last 24 hours · ${topics} topic groups in this top.`;
  const supply=count<DAILY_EDITION_POLICY.minimum?' Fewer than 20 meet the top selection; coverage is incomplete.'
    :count<DAILY_EDITION_POLICY.target?' Fewer than 30 meet the top selection.':'';
  const continuation=selection.more.length?` ${selection.more.length} further current reports are available below, including specialist topics.`:'';
  return coverage+supply+continuation;
}
/** Present the already-eligible daily top. This never selects, fetches or saves facts. */
export function appendPublicEdition(host:HTMLElement,selection:ContextualToday,cardNode:CardNode,state:PublicEditionState,_expanded=false):void {
  const make=<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text:string):HTMLElementTagNameMap[K]=>{
    const node=document.createElement(tag);node.className=className;node.textContent=text;return node;
  };
  host.dataset.editionState=state;
  host.dataset.dailyCoverage=selection.first.length<DAILY_EDITION_POLICY.minimum?'below-minimum':selection.daily?.completeCoverage!==true?'partial-categories':selection.first.length<DAILY_EDITION_POLICY.target?'below-target':'ready';
  if(state==='unavailable'||!selection.first.length){
    const copy=state==='unavailable'?'Publications could not be checked. Refresh to try again; this is not an empty result.':state==='pending'?'Checking publications from connected sources…':selection.more.length?'Current reports are available in the continuation below. No item has been promoted just to fill the top.':'No current publications from the last 24 hours meet this selection. Coverage is incomplete; no older substitute has been added.';
    const empty=make('p','discovery-section-label privacy-note',copy);
    empty.id=`home-edition-${state}`;host.append(empty);return;
  }
  selection.first.forEach((view,index)=>{
    const node=cardNode(view,index,selection.first.length);node.dataset.editionPart='first';
    if(selection.first.length%2===1&&index===selection.first.length-1)node.classList.add('today-last');
    host.append(node);
  });
  const end=make('div','finish discovery-section-label','');end.id='home-edition-end';
  end.append(make('h2',"","End of today's top."),make('p','',dailyEditionSummary(selection)+' Open an original source for the full context.'));
  const missing=selection.daily?.missingCategories??PUBLIC_EDITORIAL_CATEGORIES.filter(category=>!selection.first.some(view=>editorialCategory(view.card)===category));
  if(missing.length)end.append(make('p','privacy-note','No selected publication in this edition: '+missing.map(category=>EDITORIAL_CATEGORY_LABELS[category]).join(', ')+'.'));
  host.append(end);
}

/** Progressively reveal the full eligible stream, without requiring more upstream collection. */
export function appendPublicContinuation(host:HTMLElement,selection:ContextualToday,cardNode:CardNode,visibleCount:number):void {
  if(!Number.isSafeInteger(visibleCount)||visibleCount<0)throw Error('PUBLIC_CONTINUATION_COUNT_INVALID');
  if(!selection.more.length)return;
  const shown=Math.min(visibleCount,selection.more.length);
  const label=document.createElement('div');label.className='discovery-section-label';label.id='home-more-heading';
  const heading=document.createElement('h2');heading.textContent='More for your day';
  const copy=document.createElement('p');copy.className='privacy-note';copy.textContent=`${selection.more.length} further current reports from the connected sources. Topic labels help you browse; they do not limit this stream.`;
  label.append(heading,copy);host.append(label);
  selection.more.slice(0,shown).forEach((view,index)=>{
    const node=cardNode(view,index,selection.more.length);node.dataset.editionPart='more';
    if(shown%2===1&&index===shown-1)node.classList.add('today-last');
    host.append(node);
  });
  const controls=document.createElement('div');controls.className='finish discovery-section-label';controls.id='home-more-controls';
  if(shown<selection.more.length){
    const button=document.createElement('button');button.type='button';button.className='secondary';button.id='home-more-button';
    button.dataset.publicMore='true';button.textContent=`Show ${Math.min(20,selection.more.length-shown)} more · ${selection.more.length-shown} available`;
    controls.append(button);
  }else{
    const complete=document.createElement('p');complete.className='privacy-note';complete.textContent='You have reached the current connected-source selection. New reports appear through Show updates.';
    controls.append(complete);
  }
  host.append(controls);
}
