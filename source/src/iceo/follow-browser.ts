import {getLocale,translate as tr,translatedCategory} from '../i18n/browser.js';
import type {MessageKey} from '../i18n/catalog.js';
import {cardLink} from '../share/link.js';
import {sourceLanguage} from './news-sources.js';
import {nextCategoryFollowDelay,selectCategoryFollowReturn,type CategoryFollowState,type CategoryFollowReturnItem} from './category-follow.js';
import type {DeviceMemory} from './device-memory.js';
import type {PublicEditorialCategory} from './editorial-categories.js';
import type {IceoSnapshot} from './contracts.js';

interface FollowingOptions {
 readonly device:DeviceMemory;
 readonly snapshot:()=>IceoSnapshot|null;
 readonly available:()=>boolean;
 readonly loading:()=>boolean;
 readonly busy:()=>boolean;
 readonly write:(action:()=>Promise<void>,message:string,after?:()=>void,localizedErrors?:boolean)=>Promise<void>;
 readonly refresh:()=>void;
 readonly personalise:()=>void;
}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string):HTMLElementTagNameMap[K] {
 const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function date(value:string):string{return new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}
function itemMessage(item:CategoryFollowReturnItem):string {
 if(item.state==='baseline-required')return tr('followBaseline');
 if(item.state==='unavailable')return tr('followUnavailable');
 if(item.state==='stale')return tr('followStale');
 const changes=item.newCount+item.updatedCount;
 return (changes||item.state==='partial'?tr('followSummary',{new:item.newCount,updated:item.updatedCount}):tr('followNoChanges'))+(item.state==='partial'?' '+tr('followPartial'):'');
}

/** One local preference controller. It neither fetches sources nor starts a timer. */
export class CategoryFollowing {
 private state:CategoryFollowState|null=null;
 private loaded=false;
 private invalid=false;
 private readGeneration=0;
 private signature='';
 private readonly host:HTMLElement;
 constructor(private readonly options:FollowingOptions){
  const host=document.getElementById('following-brief');if(!host)throw Error('FOLLOWING_ELEMENT_MISSING');this.host=host;
 }
 get hasMemory():boolean{return this.state!==null||this.invalid;}
 async read():Promise<void>{
  const generation=++this.readGeneration;
  try{
   const state=await this.options.device.readCategoryFollows();
   if(generation===this.readGeneration){this.state=state;this.invalid=false;}
  }catch(error){if(generation===this.readGeneration)this.invalid=true;throw error;}
  finally{if(generation===this.readGeneration){this.loaded=true;this.render();}}
 }
 nextDelay(now:number):number|null{return nextCategoryFollowDelay(this.state,this.options.snapshot(),now);}
 private follows(category:PublicEditorialCategory):boolean{return this.state?.entries.some(entry=>entry.category===category)??false;}
 private async toggle(category:PublicEditorialCategory,desired?:boolean):Promise<void>{
  if(this.options.busy()||!this.loaded)return;
  if(this.invalid){try{await this.read();}catch{await this.options.write(async()=>{throw Error('CATEGORY_FOLLOW_STORAGE_INVALID');},'',undefined,true);return;}}
  const followed=desired??!this.follows(category),expected=this.state?.revision??null;
  const snapshot=this.options.available()?this.options.snapshot():null;
  const message=tr(followed?'followSaved':'followRemoved',{category:translatedCategory(category)});
  await this.options.write(async()=>{this.state=await this.options.device.setCategoryFollow(category,followed,snapshot,expected);this.readGeneration++;this.invalid=false;},message,undefined,true);
 }
 private async acknowledge(category:PublicEditorialCategory):Promise<void>{
  const snapshot=this.options.snapshot(),revision=this.state?.revision;
  if(this.options.busy()||!this.options.available()||!snapshot||!revision||this.invalid)return;
  await this.options.write(async()=>{this.state=await this.options.device.acknowledgeCategoryFollow(category,snapshot,revision);this.readGeneration++;},tr('followAcknowledged',{category:translatedCategory(category)}),undefined,true);
 }
 attach(article:HTMLElement,category:PublicEditorialCategory):void{
  const content=article.querySelector('.card-content');if(!content)return;
  const row=element('div','card-follow');
  const button=element('button','follow-category');button.type='button';button.dataset.followCategory=category;
  button.addEventListener('click',()=>{void this.toggle(category);});
  row.append(button,element('span','follow-scope',tr('browserOnly')));content.append(row);this.updateButton(button,category);
 }
 private updateButton(button:HTMLButtonElement,category:PublicEditorialCategory):void {
  const followed=this.follows(category),label=tr(followed?'followingCategory':'followCategory',{category:translatedCategory(category)});
  button.textContent=(followed?'✓ ':'+ ')+label;button.setAttribute('aria-pressed',String(followed));
  button.setAttribute('aria-label',label);button.title=tr(followed?'unfollowCategory':'followCategory',{category:translatedCategory(category)})+' · '+tr('browserOnly');
  button.disabled=this.options.busy()||!this.loaded;
 }
 render():void {
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-follow-category]')){
   const category=button.dataset.followCategory as PublicEditorialCategory;this.updateButton(button,category);
   const scope=button.parentElement?.querySelector('.follow-scope');if(scope)scope.textContent=tr('browserOnly');
  }
  const model=selectCategoryFollowReturn(this.state,this.options.snapshot(),Date.now(),this.options.available());
  this.host.hidden=!this.invalid&&!model.items.length;
  if(this.host.hidden){this.signature='';this.host.replaceChildren();return;}
  const pending=this.options.loading(),busy=this.options.busy();
  const signature=JSON.stringify([getLocale(),this.invalid,pending,busy,model.state,model.items.map(item=>[item.category,item.state,item.savedAt,item.canAcknowledge,item.newCount,item.updatedCount,item.cards.map(change=>[change.card.id,change.card.contentHash,change.card.title,change.card.publisher,change.kind])])]);
  if(signature===this.signature)return;this.signature=signature;
  const expanded=new Set([...this.host.querySelectorAll<HTMLDetailsElement>('details[open][data-follow-topic]')].map(node=>node.dataset.followTopic));
  const active=document.activeElement instanceof HTMLElement&&this.host.contains(document.activeElement)?document.activeElement.dataset.followAction:null;
  const header=element('div','following-heading'),title=element('h2','','');title.id='following-title';title.tabIndex=-1;title.textContent=tr('followedTopics');
  const refresh=element('button','text-button',tr('refresh'));refresh.type='button';refresh.disabled=pending;refresh.dataset.followAction='refresh';refresh.addEventListener('click',()=>this.options.refresh());header.append(title,refresh);
  const scope=element('p','follow-scope',tr('browserOnly')),status=element('p','following-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  this.host.replaceChildren(header,scope,status);this.host.dataset.followState=this.invalid?'invalid':pending?'pending':model.state;
  if(this.invalid){status.textContent=tr('followInvalid');const settings=element('button','secondary',tr('navPersonalise'));settings.type='button';settings.dataset.followAction='personalise';settings.addEventListener('click',()=>this.options.personalise());this.host.append(settings);return;}
  if(pending)status.textContent=tr('followChecking');
  else if(model.state==='complete')status.textContent=model.newCount+model.updatedCount?tr('followSummary',{new:model.newCount,updated:model.updatedCount}):tr('followNoChanges');
  else if(model.state==='partial')status.textContent=tr('followSummary',{new:model.newCount,updated:model.updatedCount})+' · '+tr('followPartial');
  else {const key:MessageKey=model.state==='stale'?'followStale':model.state==='baseline-required'?'followBaseline':'followUnavailable';status.textContent=tr(key);}
  const topics=element('div','following-topics');
  for(const item of model.items){
   const details=element('details','follow-topic');details.dataset.followTopic=item.category;details.open=expanded.has(item.category);
   const summary=element('summary','');summary.dataset.followAction='open:'+item.category;
   const counts=pending?tr('followChecking'):item.state==='complete'||item.state==='partial'?tr('followSummary',{new:item.newCount,updated:item.updatedCount})+(item.state==='partial'?' · '+tr('partialCoverage'):''):itemMessage(item);
   summary.append(element('span','',translatedCategory(item.category)),element('span','follow-count',counts));details.append(summary);
   const body=element('div','follow-topic-body');body.append(element('p','privacy-note',pending?tr('followChecking'):itemMessage(item)));
   if(item.savedAt)body.append(element('p','privacy-note',tr('followCheckSaved',{time:date(item.savedAt)})));
   if(item.cards.length){
    const updates=element('details','follow-updates');updates.dataset.followTopic='updates:'+item.category;updates.open=expanded.has(updates.dataset.followTopic);
    updates.append(element('summary','',tr('followOpen')));
    const list=element('ul','following-items');
    // The validated snapshot bounds the list; each item opens the existing public card route.
    for(const change of item.cards){
     const row=element('li',''),link=element('a','',change.card.title);link.href=cardLink(change.card);link.dir='auto';link.lang=sourceLanguage(change.card)??'';link.setAttribute('translate','no');
     const source=element('span','follow-source',change.card.publisher);source.dir='auto';source.setAttribute('translate','no');
     row.append(element('span','follow-change',tr(change.kind==='listing-updated'?'followUpdated':'followNew')),link,source);list.append(row);
    }
    updates.append(list);body.append(updates);
   }
   const actions=element('div','follow-actions'),save=element('button','secondary',tr('followAcknowledge')),remove=element('button','text-button',tr('unfollowCategory',{category:translatedCategory(item.category)}));
   save.type='button';save.disabled=busy||pending||!item.canAcknowledge;save.dataset.followAction='ack:'+item.category;save.addEventListener('click',()=>{void this.acknowledge(item.category);});
   remove.type='button';remove.disabled=busy;remove.dataset.followAction='remove:'+item.category;remove.addEventListener('click',()=>{void this.toggle(item.category,false);});
   actions.append(save,remove);body.append(actions);details.append(body);topics.append(details);
  }
  this.host.append(topics,element('p','follow-boundary',tr('followBoundary')));
  if(active){const replacement=[...this.host.querySelectorAll<HTMLElement>('[data-follow-action]')].find(node=>node.dataset.followAction===active);(replacement??title).focus({preventScroll:true});}
 }
}
