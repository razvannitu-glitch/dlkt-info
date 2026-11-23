import {getLocale,translate as tr,translatedCategory,countryLabel,languageLabel,setupLanguage,applyInterfaceLanguage} from '../i18n/browser.js';
import {sourceLanguage,selectNewsLanguage} from './news-sources.js';
import {consistentCards} from './evidence-consistency.js';
import {newsOriginalLanguage,type NewsSourceScope,type NewsPage,type NewsPageItem,type NewsStorySource} from './news-page-contracts.js';
import {photoNode,integratePhotoHeadline} from '../media/browser.js';
import {setupExplore,type ExploreController} from '../explore/browser.js';
import {contextForCard} from './context.js';
import {nextDailyEditionDelay,selectContextualToday} from './contextual-today.js';
import {LiveEdition,editionCardSignature,editionStorySignature,editionUpdateLabel,PUBLIC_EDITION_POLL_MS,publicEditionPollDelay} from './live-edition.js';
import {publicEditionState} from './home-edition.js';
import {observeNewsStream,NEWS_PAGE_SIZE,type NewsStreamFilter} from './news-stream.js';
import {NewsContinuation,continuationItems} from './news-continuation.js';
import {newsStorySourcesNode} from './news-story-browser.js';
import {countryEditionProfile} from './country-editions.js';
import {commercialCardNode} from './commercial-browser.js';
import {NEWS_CATEGORIES,newsCategoryLabel,isNewsCategoryId} from './news-taxonomy.js';
import {NewsMasonry} from './news-masonry.js';
import {knowledgeCardNode} from './knowledge-browser.js';
import {KNOWLEDGE_CARDS} from './knowledge-catalog.js';
import {selectInlineKnowledge,interleaveKnowledge,readKnowledgeSeen,writeKnowledgeSeen,type InlineKnowledge} from './knowledge-stream.js';
import type {NewsPeriod} from './news-day.js';
import {NewsReadingState} from './news-reading-state.js';
import {DiscoveryLoading,renderDiscoveryLoading,bindDiscoveryLoadingActions,type DiscoveryLoadingElements} from './loading.js';
import {selectHomeLanguage} from './home-local.js';
import {localCardNode} from '../local/card-node.js';
import {localCoverageReading} from '../local/presentation.js';
import {validCity,currentLocalSnapshot,type City,type LocalSnapshot} from '../local/contracts.js';
import {selectReturnBrief,nextReturnDelay} from './return-brief.js';
import {selectSavedUpdates,nextSavedUpdateDelay,SnapshotProgress,type SavedUpdate,type SavedUpdates} from './saved-updates.js';
import {cardLink} from '../share/link.js';
import {cardGuideNode} from './card-guide.js';
import {editorialCardPresentation,editorialSourceContext,compactEditionStatus} from './editorial-presentation.js';
import {organizationSetupFromHash,organizationReadingSettings} from '../organizations/setup.js';
import {cardCreditsNode} from './credits.js';
import {PUBLIC_TOPICS,TOPIC_LABELS} from './topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_LABELS,editorialCategory as categoryForCard,type PublicEditorialCategory} from './editorial-categories.js';
import {CategoryFollowing,type FollowPresentation} from './follow-browser.js';
import {shareCard} from '../share/actions.js';
import {setupEdition} from '../edition/browser.js';
import {captureCheckpoint,compareCheckpoint,focusedSnapshot,compareFocusedCheckpoint,type ComparisonCheckpoint,type ComparedCard,type MetadataField} from './comparison.js';
import {DeviceMemory,memoryError,type DeviceSnapshot,type SavedCard} from './device-memory.js';
import {safeLink,validCard} from './card-validation.js';
import {attachInsight,pruneInsights} from './insight-browser.js';
import { selectReadingCards, savedReadingCards, type ReaderSettings, type ReadingCard } from './reader.js';
import type { EvidenceCard, IceoSnapshot, SourceHealth, Topic } from './contracts.js';

const TOPICS = PUBLIC_TOPICS;
const labels=TOPIC_LABELS;
function required<T extends Element>(selector:string):T {
  const node=document.querySelector<T>(selector);if(!node)throw new Error('READER_ELEMENT_MISSING');return node;
}
const form=required<HTMLFormElement>('#preferences');
const query=required<HTMLInputElement>('#query'),budget=required<HTMLInputElement>('#budget');
const cards=required<HTMLElement>('#cards'),status=required<HTMLElement>('#status');
const heading=required<HTMLElement>('#result-heading'),count=required<HTMLElement>('#result-count');
const empty=required<HTMLElement>('#empty'),emptyCopy=required<HTMLElement>('#empty-copy');
const finish=required<HTMLElement>('#finish'),finishCopy=required<HTMLElement>('#finish-copy');
const explore=required<HTMLButtonElement>('#explore-records'),more=required<HTMLButtonElement>('#show-all');
const health=required<HTMLElement>('#source-health'),checked=required<HTMLElement>('#checked-at');
const refresh=required<HTMLButtonElement>('#refresh'),briefing=required<HTMLElement>('#briefing');
const panel=required<HTMLDialogElement>('#personalise'),template=required<HTMLTemplateElement>('#card-template');
const feedback=required<HTMLElement>('#selection-note'),announcement=required<HTMLElement>('#reader-announcement');
const discoveryLoadingElements:DiscoveryLoadingElements={
 panel:required<HTMLElement>('#discovery-loading'),title:required<HTMLElement>('#discovery-loading-title'),
 copy:required<HTMLElement>('#discovery-loading-copy'),personalise:required<HTMLButtonElement>('#discovery-loading-personalise'),
 hint:required<HTMLElement>('#discovery-loading-hint'),retry:required<HTMLButtonElement>('#discovery-loading-retry'),
 status:required<HTMLElement>('#discovery-status'),
};
const discoveryLoading=new DiscoveryLoading(()=>renderDiscovery());
let initialCheckStarted=false;
let snapshot:IceoSnapshot|null=null,loading=false,mode:ReaderSettings['mode']='briefing';
let worldExplorer:ExploreController|null=null;
const snapshotProgress=new SnapshotProgress();
let lastLoadRegressed=false;
let renderTimer:ReturnType<typeof setTimeout>|undefined;
let discoveryExpiry:ReturnType<typeof setTimeout>|undefined;
let publicRefreshTimer:ReturnType<typeof setTimeout>|undefined;
let savedUpdateExpiry:ReturnType<typeof setTimeout>|undefined;
let lastPublicCheckAttempt=0;
const PUBLIC_REFRESH_MS=PUBLIC_EDITION_POLL_MS;
let publicRefreshFailures=0,publicEtag:string|null=null,automaticPublicLoad=false,applyPublicUpdate=false;
const liveEdition=new LiveEdition();
const newsReading=new NewsReadingState();
let newsMasonry:NewsMasonry|null=null;
const newsContinuation=new NewsContinuation(fetch,Date.now,()=>queueMicrotask(renderDiscovery));
let restartNewsEdition=false;
let newsFilter:NewsStreamFilter='all',stopNewsObserver:()=>void=()=>{};
let newsPeriod:NewsPeriod='recent';
let newsSourceScope:NewsSourceScope='all';
let newsInteractionKey='',newsInteractionRevision=0;
const inlineKnowledgeSeen=readKnowledgeSeen();
let inlineKnowledgeContext='';
let inlineKnowledgeSelection:readonly InlineKnowledge[]=[];
let lastLocalLanguageRefresh=0;
const currentCardByNode=new WeakMap<HTMLElement,EvidenceCard>();
function schedulePublicRefresh():void {
  clearTimeout(publicRefreshTimer);
  if(document.visibilityState!=='visible')return;
  publicRefreshTimer=setTimeout(()=>{if(document.visibilityState==='visible')void load(true);},Math.max(1000,publicEditionPollDelay(publicRefreshFailures)-(Date.now()-lastPublicCheckAttempt)));
}
const device=new DeviceMemory();
let deviceState:DeviceSnapshot={focus:null,cards:[],rejected:0};
let dailyPresent=false;
let contextualCity:City|null=null;
let contextualCityExplicit=false;
let contextualLocation:'estimated'|'saved'|'selected'|null=null;
let contextualLocationPending=true;
let contextualLocal:LocalSnapshot|null=null;
let contextualLocalState:'idle'|'loading'|'loaded'|'unavailable'='idle';
let savedInterests:readonly Topic[]=[];
let visitInterests:readonly Topic[]|null=null;
let savedView=false,changesView=false,deviceBusy=false,editedFocus=false;
let checkpoint:ComparisonCheckpoint|null=null,checkpointInvalid=false,checkpointLoaded=false,lastLoadFailed=true;
const memoryMessage=required<HTMLElement>('#memory-status');
const following=new CategoryFollowing({device,snapshot:()=>snapshot,available:()=>!lastLoadFailed&&!lastLoadRegressed&&!loading,
 loading:()=>loading,busy:()=>deviceBusy,write:writeDevice,refresh:()=>{void load();},personalise:openSettings});
let toastTimer:ReturnType<typeof setTimeout>|undefined;
function toast(message:string):void{const item=required<HTMLElement>('#reader-toast');clearTimeout(toastTimer);item.textContent=message;item.hidden=false;toastTimer=setTimeout(()=>{item.hidden=true;},5500);}
let changes:BroadcastChannel|null=null;
try{if(typeof BroadcastChannel==='function')changes=new BroadcastChannel('dlkt-info-device-changes-v1');}catch{/* Reading and storage do not depend on cross-tab messaging. */}
function memoryControls():void{
  required<HTMLElement>('#saved-count').textContent=String(deviceState.cards.length);
  required<HTMLButtonElement>('#forget-focus').hidden=deviceState.focus===null;
  required<HTMLButtonElement>('#clear-device').disabled=deviceBusy||(!deviceState.focus&&!deviceState.cards.length&&!deviceState.rejected&&!checkpoint&&!checkpointInvalid&&!dailyPresent&&!following.hasMemory);
  document.querySelectorAll<HTMLButtonElement>('[data-memory-write]').forEach(b=>{b.disabled=deviceBusy;});
  document.querySelectorAll<HTMLButtonElement>('[data-save-card]').forEach(b=>{
    const saved=deviceState.cards.some(entry=>entry.id===b.dataset.saveCard);
    const label=b.querySelector('.save-label');if(label)label.textContent=saved?tr('savedCard'):tr('saveCard');else b.textContent=saved?tr('savedCard'):tr('saveCard');b.setAttribute('aria-pressed',String(saved));
    b.title=saved?tr('savedCard'):tr('saveCard');b.disabled=deviceBusy;
  });
  comparisonControls();
  renderReturnBrief();
  following.render();
}
function restoreSettings(s:ReaderSettings):void{
  form.querySelectorAll<HTMLInputElement>('input[name=topic]').forEach(i=>{i.checked=s.topics.includes(i.value as Topic);});
  query.value=s.query;budget.value=String(s.budget);mode=s.mode;
}
async function readDevice(restore=false):Promise<void>{
  try{
    deviceState=await device.read();try{const personal=await device.readDaily();dailyPresent=personal!==null;savedInterests=personal?.profile.topics??deviceState.focus?.settings.topics??[];}catch{dailyPresent=true;savedInterests=[];}await readComparison();try{await following.read();}catch{/* The following panel exposes its own storage error. */}
    if(restore&&deviceState.focus&&!editedFocus){restoreSettings(deviceState.focus.settings);memoryMessage.textContent='Your remembered focus was restored in this browser.';void load();document.dispatchEvent(new CustomEvent('dlkt:reader-selected',{detail:{restored:true}}));}
    if(deviceState.rejected)memoryMessage.textContent='Some stored data could not be read safely. It is not shown; you can clear this browser data.';
    memoryControls();if(savedView||changesView||restore)render();
  }catch(error){checkpointLoaded=true;checkpointInvalid=true;try{await following.read();}catch{/* New controls retain their localized unavailable state. */}memoryMessage.textContent=memoryError(error);memoryControls();if(changesView)render();}
}
async function writeDevice(action:()=>Promise<void>,message:string,after?:()=>void,localizedErrors=false):Promise<void>{
  if(deviceBusy)return;deviceBusy=true;memoryControls();let committed=false;
  try{await action();committed=true;deviceState=await device.read();try{const personal=await device.readDaily();dailyPresent=personal!==null;savedInterests=personal?.profile.topics??deviceState.focus?.settings.topics??[];}catch{dailyPresent=true;savedInterests=[];}await readComparison();try{await following.read();}catch(error){if(localizedErrors)throw error;/* Invalid following data cannot interrupt a committed saved-card or legacy-check action. */}memoryMessage.textContent=message;announcement.textContent=message;toast(message);after?.();if(savedView)render();try{changes?.postMessage('changed');}catch{/* A committed write stays successful if messaging is unavailable. */}}
  catch(error){if(error instanceof Error&&error.message==='CHECKPOINT_CONCURRENT_UPDATE'){await readComparison();if(changesView)render();}
    let followConflict=false;if(error instanceof Error&&error.message==='CATEGORY_FOLLOW_CONCURRENT_UPDATE'){try{await following.read();followConflict=true;}catch{/* A failed reload is a storage error, never a claimed successful reconciliation. */}}
    memoryMessage.textContent=localizedErrors?tr(committed?'followReloadError':followConflict?'followConflict':'followSaveError'):committed?'Change saved, but this page could not reload it. Refresh to view the stored data.':memoryError(error);announcement.textContent=memoryMessage.textContent;toast(memoryMessage.textContent);}
  finally{deviceBusy=false;memoryControls();if(changesView)required<HTMLElement>('#comparison-message').textContent=memoryMessage.textContent;}
}
async function readComparison():Promise<void>{
  try{checkpoint=await device.readCheckpoint();checkpointInvalid=false;}
  catch{checkpoint=null;checkpointInvalid=true;}
  finally{checkpointLoaded=true;}
}
function comparisonControls():void{
  let allowed=false;
  if(snapshot&&!lastLoadFailed&&!loading&&!checkpointInvalid&&checkpointLoaded){
    try{const selected=settings();if(selected)captureCheckpoint(focusedSnapshot(snapshot,selected.topics),Date.now(),'11111111-1111-4111-8111-111111111111');allowed=selected!==null;}catch{/* Missing or expired source checks must not replace a baseline. */}
  }
  required<HTMLButtonElement>('#save-check').disabled=deviceBusy||!allowed;
  required<HTMLButtonElement>('#forget-check').hidden=!checkpoint;
  required<HTMLButtonElement>('#forget-check').disabled=deviceBusy;
}
function annotateComparison(node:HTMLElement,difference:ComparedCard):void{
  node.dataset.comparison=difference.kind;
  const message=difference.kind==='not-in-saved-check'
    ?'Not in your saved check. This listing may have been published earlier.'
    :'Listing updated since your saved check. See the exact changes below.';
  node.querySelector('.card-content')?.prepend(make('p','saved-copy-note',message));
  if(!difference.changes.length)return;
  const labels:Record<MetadataField,string>={title:'Title',date:'Date',dateLabel:'Date meaning',deadline:'Listed closing date',version:'Version',sourceUrl:'Source address',publisher:'Publisher',summary:'Publisher excerpt',byline:'Source credits',licenseUrl:'Source license',context:'Publisher coverage'};
  const detail=make('details','evidence'),list=make('dl','');detail.append(make('summary','','What changed in this listing?'));
  for(const change of difference.changes){list.append(make('dt','',labels[change.field]),make('dd','',`Saved: ${change.before??'Not provided'}`),make('dd','',`Current: ${change.after??'Not provided'}`));}
  detail.append(list);node.append(detail);
}
function openReturnChanges():void{
  const topics=checkpoint?selectReturnBrief(checkpoint,null,Date.now(),false).topics:[];
  if(topics.length)restoreSettings({topics,query:'',budget:6,mode:'records'});
  required<HTMLInputElement>('#comparison-saved-only').checked=false;
  changesView=true;savedView=false;editedFocus=true;render();if(!snapshot&&!loading)void load();
  document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));heading.focus();heading.scrollIntoView({block:'start'});
}
function currentSavedUpdates():SavedUpdates{return selectSavedUpdates(deviceState.cards,snapshot,Date.now(),!lastLoadFailed&&!loading);}
function openSavedCards(id?:string):void{
  if(id){const index=savedReadingCards(deviceState.cards.map(item=>item.card),Date.now()).findIndex(view=>[view.card,...view.related].some(card=>card.id===id));if(index>=0&&Number(budget.value)<=index)budget.value=String(index+1);}
  changesView=false;savedView=true;editedFocus=true;render();
  document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));heading.focus();heading.scrollIntoView({block:'start'});
  if(id){
    const target=[...cards.querySelectorAll<HTMLElement>('[data-card-id],[data-related-card-id]')].find(node=>node.dataset.cardId===id||node.dataset.relatedCardId===id);
    if(target){const related=target.closest<HTMLDetailsElement>('details.related');if(related)related.open=true;target.tabIndex=-1;target.focus({preventScroll:true});target.scrollIntoView({block:'start'});}
  }
  // Only the existing public snapshot is requested. Saved identities never leave the browser.
  if(!loading)void load();
}
function savedSummary(model:SavedUpdates):string{
  if(loading)return 'Checking current sources for your saved cards. Your original copies stay intact.';
  if(model.state==='unavailable')return 'Current checks are unavailable for your saved cards. This is not a no-change result. Your original copies stay intact.';
  const changes=`${model.materialCount} saved card${model.materialCount===1?' has':'s have'} a changed listed detail · ${model.wordingCount} with revised publisher wording.`;
  const scope=` ${model.checkedCount}/${model.items.length} saved listings checked. Comparisons are with the copy you saved, not with your last visit.`;
  const missing=model.missingCount?` ${model.missingCount} no longer appear in the checked feed; this does not establish their current status.`:'';
  const unavailable=model.unavailableCount?` ${model.unavailableCount} could not be checked.`:'';
  const unsupported=model.notComparableCount?` ${model.notComparableCount} have no supported details in both copies to compare.`:'';
  return (lastLoadRegressed?'An older source response was ignored. The last verified comparison is shown. ':'')+changes+scope+missing+unavailable+unsupported+(model.state==='partial'?' Coverage is incomplete.':'');
}
function annotateSavedUpdate(node:HTMLElement,item:SavedUpdate):void{
  node.dataset.savedUpdate=item.state;
  const body=node.querySelector('.card-content')??(node.dataset.relatedCardId?node:null);if(!body)return;
  const section=make('div','saved-update');
  if(item.changes.length){
    section.append(make('p','saved-copy-note','Listed details changed since you saved this card.'));
    for(const change of item.changes)section.append(make('p','card-context',`${change.label}: saved ${change.before} → current ${change.after}.`));
  }
  if(item.wording){
    const details=make('details','evidence');details.append(make('summary','','Publisher wording revised'),make('p','privacy-note','Exact excerpts are compared below. A wording revision does not establish a changed price, schedule, eligibility or personal impact.'),make('p','card-context',`Saved: ${item.wording.before}`),make('p','card-context',`Current: ${item.wording.after}`));section.append(details);
  }
  if(item.state==='unchanged')section.append(make('p','saved-copy-note','No changes in the supported details compared.'));
  section.append(make('p','privacy-note',item.note));
  if(item.checkedAt)section.append(make('p','card-date',`Current source check: ${formatted(item.checkedAt,false,true)}.`));
  body.append(section);
}
function renderReturnBrief():void{
  const host=required<HTMLElement>('#return-brief'),copy=required<HTMLElement>('#return-copy'),list=required<HTMLElement>('#return-highlights'),dates=required<HTMLElement>('#return-deadlines');
  const button=required<HTMLButtonElement>('#return-open');button.disabled=deviceBusy;required<HTMLButtonElement>('#return-refresh').disabled=loading;
  list.replaceChildren();dates.replaceChildren();
  clearTimeout(savedUpdateExpiry);
  if(deviceState.cards.length){
    const saved=currentSavedUpdates();host.dataset.state=loading?'pending':saved.state;
    required<HTMLElement>('#return-title').textContent='Your saved information.';button.textContent='View saved updates';copy.textContent=savedSummary(saved);
    const highlights=saved.items.filter(item=>item.changes.length||item.wording).sort((a,b)=>Number(b.changes.length>0)-Number(a.changes.length>0)).slice(0,3);
    for(const item of highlights){const row=make('p','return-item'),open=make('button','text-button',item.saved.card.title);open.type='button';open.addEventListener('click',()=>openSavedCards(item.saved.id));row.append(make('span','privacy-note',item.changes.length?'Listed detail changed':'Publisher wording revised'),open);for(const change of item.changes)row.append(make('span','privacy-note',`${change.label}: ${change.before} → ${change.after}`));list.append(row);}
    const delay=nextSavedUpdateDelay(deviceState.cards,snapshot,Date.now());
    if(delay!==null&&document.visibilityState==='visible')savedUpdateExpiry=setTimeout(()=>{if(savedView)render();else renderReturnBrief();},delay);
    return;
  }
  const model=selectReturnBrief(checkpoint,snapshot,Date.now(),!lastLoadFailed&&!loading);
  host.dataset.state=checkpointInvalid?'invalid':checkpoint&&(loading||!initialCheckStarted)?'pending':model.state;
  required<HTMLElement>('#return-title').textContent=checkpoint?'Since your saved check.':'Make your next visit useful.';
  button.textContent=checkpoint?'View changes':'Set up my return';
  if(checkpointInvalid){copy.textContent='Your saved check could not be read safely. Open Personalise to review browser storage.';button.textContent='Open Personalise';return;}
  if(!checkpointLoaded){copy.textContent='Loading your browser-only saved check…';button.disabled=true;return;}
  if(!checkpoint){copy.textContent='Choose your interests and explicitly save a source check. Return here to see what changed. Stored only in this browser.';return;}
  const scope=model.topics.map(t=>labels[t]).join(', ');
  if(model.state==='invalid'){copy.textContent='This saved check has no supported public interests. Choose interests and save a new check in Changes.';return;}
  if(model.state==='unavailable'){copy.textContent=loading?'Checking sources for your saved interests…':!initialCheckStarted?'Preparing the source check for your saved interests…':'A current comparison is unavailable. This is not a no-change result. Your saved check is kept intact.';return;}
  const result=model.comparison;if(!result)return;
  copy.textContent=`${model.newCount} new to this comparison · ${model.updatedCount} listings updated. Saved ${formatted(model.savedAt??checkpoint.savedAt)}. ${result.comparableSources}/${result.totalSources} sources comparable. ${model.state==='partial'?'Coverage is incomplete. ':''}${model.omittedLegacy?'Previously saved software interests are excluded from this homepage summary. ':''}Interests: ${scope}.`;
  const boundary=make('p','privacy-note','New to this comparison may include older publications. Missing feed entries are not confirmed withdrawn. Article text is not compared.');list.append(boundary);
  for(const item of model.highlights){const row=make('p','return-item'),link=make('a','',item.card.title);link.href=cardLink(item.card);row.append(make('span','privacy-note',item.kind==='listing-updated'?'Updated listing':'New to your saved check'),link,make('span','privacy-note',`${item.card.publisher} · ${item.card.dateLabel}: ${formatted(item.card.date,true)}`));list.append(row);}
  if(model.deadlines.length){dates.append(make('h3','','Listed closing dates · next 7 days'),make('p','privacy-note','Dates use the publisher region, Europe/Berlin. Confirm exact closing time, current status and eligibility in the original notice.'));
   for(const card of model.deadlines){const row=make('p','return-item'),link=make('a','',`${card.deadline??''} · ${card.title}`);link.href=cardLink(card);row.append(link);dates.append(row);}}
}
function renderComparison():void{
  const intro=required<HTMLElement>('#comparison-copy');
  heading.textContent='Since your saved check';cards.dataset.comparisonState=lastLoadFailed?'unavailable':checkpoint?'pending':'no-baseline';cards.replaceChildren();pruneInsights();finish.hidden=true;more.hidden=true;feedback.textContent='';count.textContent='';
  intro.textContent='Save a source check for your selected interests, then return to compare listings. Nothing is stored automatically. Article-text changes are not compared.';
  checked.textContent=checkpoint?`Comparison saved ${formatted(checkpoint.savedAt)}`:'No comparison check saved';
  empty.hidden=false;empty.querySelector('strong')?.replaceChildren(document.createTextNode('No comparison yet.'));
  if(checkpointInvalid){status.textContent='The saved comparison could not be read safely.';emptyCopy.textContent='Use Personalise to clear local data, or retry if browser storage is blocked.';}
  else if(!checkpointLoaded){status.textContent='Loading your saved source check.';emptyCopy.textContent='No comparison is available until local storage has been read.';}
  else if(!checkpoint){status.textContent='Start with Save this source check. Nothing is stored automatically.';emptyCopy.textContent='Then return to Changes to see listings absent from that check and exact metadata updates.';}
  else if(!snapshot||lastLoadFailed){status.textContent='Current sources are unavailable. This is not a no-change result.';emptyCopy.textContent='Your saved check is unchanged. Refresh when the sources are available.';}
  else{
    const selected=settings();
    if(!selected||!selected.topics.length){feedback.textContent='Choose an interest and a positive whole number for the card budget.';comparisonControls();return;}
    const result=compareFocusedCheckpoint(checkpoint,snapshot,selected.topics,Date.now());
    const savedOnly=required<HTMLInputElement>('#comparison-saved-only').checked;
    const savedIds=new Set(deviceState.cards.filter(c=>selected.topics.includes(c.card.topic)).map(c=>c.id));
    if(savedOnly&&!savedIds.size){status.textContent='No saved cards in these interests.';empty.querySelector('strong')?.replaceChildren(document.createTextNode('Save a card to narrow this comparison.'));emptyCopy.textContent='This filter compares the explicit source check for your selected interests. It does not start background monitoring.';feedback.textContent=result.notes.join(' ');cards.dataset.comparisonState=result.state;briefing.setAttribute('aria-busy','false');memoryControls();return;}
    const relevant=result.cards.filter(d=>!savedOnly||savedIds.has(d.card.id));
    const allMatches=selectReadingCards(relevant.map(d=>d.card),{...selected,budget:Math.max(1,relevant.length),mode:'records'},Date.now());
    const selection=selectReadingCards(relevant.map(d=>d.card),{...selected,mode:'records'},Date.now());
    const indexed=new Map(result.cards.map(d=>[d.card.id,d]));
    cards.replaceChildren(...selection.cards.map((view,i)=>{const node=cardNode(view,i,selection.cards.length);const diff=indexed.get(view.card.id);if(diff)annotateComparison(node,diff);return node;}));pruneInsights();
    cards.dataset.comparisonState=result.state;
    count.textContent=`${selection.cards.length} cards`;
    const matchedIds=new Set(allMatches.cards.map(v=>v.card.id));
    const newCount=relevant.filter(d=>matchedIds.has(d.card.id)&&d.kind==='not-in-saved-check').length,updated=matchedIds.size-newCount;
    status.textContent=result.state==='unavailable'?'Comparison unavailable. No sources have safe matching checks.'
      :`${newCount} listings new to this comparison; ${updated} listings updated in your ${savedOnly?'saved-card ':''}focus. ${result.state==='partial'?'Coverage is incomplete; this is not an all-clear.':'Compared available source listings, not the entire web.'}`;
    if(result.oldestObservation)checked.textContent=`Saved ${formatted(checkpoint.savedAt)} · sources checked ${formatted(result.oldestObservation)}${result.newestObservation!==result.oldestObservation?' to '+formatted(result.newestObservation??result.oldestObservation):''}`;
    empty.hidden=selection.cards.length>0;
    const title=result.state==='unavailable'?'Comparison unavailable.':result.cards.length>0?'No matching differences.':'No listing differences found.';
    empty.querySelector('strong')?.replaceChildren(document.createTextNode(title));
    emptyCopy.textContent=result.state==='unavailable'?'The saved check is kept intact. Refresh sources and try again.':result.cards.length>0?'Other differences exist, but none match your current focus. Change your filter to inspect them.':result.state==='partial'?'No differences in the comparable records. Some source coverage is incomplete.':'No metadata differences were found in the comparable current listings. Missing feed entries are not confirmed withdrawn; article text and the entire web have not been compared.';
    feedback.textContent=result.notes.join(' ');
    intro.textContent=`Comparison stored only in this browser. ${result.comparableSources}/${result.totalSources} sources comparable. Entries missing from a feed are not treated as withdrawn. Chosen interests: ${selected.topics.map(t=>labels[t]).join(', ')}. Saving again replaces the baseline with these interests.`;
    if(selection.cards.length){finish.hidden=false;finishCopy.textContent='These are source-listing differences, not a record of what you have read.';explore.hidden=false;more.hidden=selection.cards.length>=selection.availableGroups;}
  }
  briefing.setAttribute('aria-busy','false');memoryControls();
}
function savedCards():void{
  const expanded=new Set([...cards.querySelectorAll<HTMLDetailsElement>('details.related[open]')].map(detail=>{const article=detail.closest<HTMLElement>('[data-card-id]');return article?.dataset.storyKey??article?.dataset.cardId;}));
  const active=document.activeElement instanceof HTMLElement&&cards.contains(document.activeElement)?document.activeElement:null;
  const focused=active?.closest<HTMLElement>('[data-related-card-id],[data-card-id]'),focusedId=focused?.dataset.relatedCardId??focused?.dataset.cardId,focusedSave=active?.dataset.saveCard;
  empty.querySelector('strong')?.replaceChildren(document.createTextNode('No saved cards.'));
  const entries=deviceState.cards;const s=settings();if(!s){feedback.textContent='Enter a positive whole number for the card budget.';return;}const limit=s.budget;
  const groups=savedReadingCards(entries.map(entry=>entry.card),Date.now()),shown=groups.slice(0,limit),byId=new Map(entries.map(entry=>[entry.id,entry]));
  const updates=currentSavedUpdates();
  cards.replaceChildren(...shown.map((view,i)=>{
    const entry=byId.get(view.card.id);if(!entry)throw Error('SAVED_STORY_ORIGINAL_MISSING');
    const node=cardNode(view,i,shown.length,entry),update=updates.items.find(item=>item.saved.id===entry.id);if(update)annotateSavedUpdate(node,update);
    for(const row of node.querySelectorAll<HTMLElement>('[data-related-card-id]')){const relatedUpdate=updates.items.find(item=>item.saved.id===row.dataset.relatedCardId);if(relatedUpdate)annotateSavedUpdate(row,relatedUpdate);}
    return node;
  }));
  for(const article of cards.querySelectorAll<HTMLElement>('[data-card-id]')){const detail=article.querySelector<HTMLDetailsElement>('details.related');if(detail&&expanded.has(article.dataset.storyKey??article.dataset.cardId))detail.open=true;}
  if(focusedId){const replacement=[...cards.querySelectorAll<HTMLElement>('[data-related-card-id],[data-card-id]')].find(node=>node.dataset.relatedCardId===focusedId||node.dataset.cardId===focusedId);if(replacement){const target=focusedSave?replacement.querySelector<HTMLElement>('[data-save-card]')??replacement:replacement;if(target===replacement)target.tabIndex=-1;target.focus({preventScroll:true});}}
  pruneInsights();heading.textContent='Saved in this browser';count.textContent=`${shown.length} / ${groups.length}`;
  status.textContent=entries.length?savedSummary(updates):'Your saved copies, without the current topic filters. Open the original source for its current terms.';
  checked.textContent='Browser-only collection · no account sync';
  empty.hidden=shown.length>0;emptyCopy.textContent='Use Save here on a card to keep its title, date and original source in this browser.';
  finish.hidden=true;feedback.textContent='Clearing site data or ending a private-browsing session can remove this collection. Do not use it as your only archive.';
  more.hidden=shown.length>=groups.length;
  if(shown.length<groups.length){finish.hidden=false;finishCopy.textContent='More saved cards are available.';explore.hidden=true;}
  briefing.setAttribute('aria-busy','false');memoryControls();
}


function object(value:unknown):value is Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function string(value:unknown,max=4000):value is string{return typeof value==='string'&&value.length<=max;}
function stamp(value:unknown):value is string{return string(value,100)&&Number.isFinite(Date.parse(value));}
function validHealth(value:unknown):value is SourceHealth {
  return object(value)&&string(value.id,80)&&string(value.label,300)&&string(value.scope)&&string(value.publisher,300)&&TOPICS.includes(value.topic as Topic)
    &&['verified','partial','stale','unavailable'].includes(String(value.state))
    &&Number.isSafeInteger(value.count)&&Number(value.count)>=0&&Number.isSafeInteger(value.rejected)&&Number(value.rejected)>=0
    &&(value.verifiedAt===null||stamp(value.verifiedAt))&&safeLink(value.termsUrl)!==null;
}
function valid(value:unknown):value is IceoSnapshot {
  return object(value)&&value.version==='iceo-primary-mesh-1'&&value.product==='dlkt-info'
    &&['current-official-records','current-source-records'].includes(String(value.mode))&&value.deltaAvailable===false
    &&value.scheduledDelivery===false&&value.accountPersistence===false
    &&['ready','partial','unavailable'].includes(String(value.state))&&stamp(value.generatedAt)
    &&Array.isArray(value.cards)&&value.cards.length<=5000&&value.cards.every(validCard)
    &&Array.isArray(value.sources)&&value.sources.length<=100&&value.sources.every(validHealth);
}
function formatted(value:string,dayOnly=false,utc=false,publicationTimeZone='UTC'):string {
  const options:Intl.DateTimeFormatOptions=dayOnly?{year:'numeric',month:'short',day:'numeric',timeZone:publicationTimeZone}
    :{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short',...(utc?{timeZone:'UTC'}:{})};
  return new Intl.DateTimeFormat(getLocale(),options).format(new Date(value));
}
function make<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string):HTMLElementTagNameMap[K]{
  const node=document.createElement(tag);node.className=className;if(text!==undefined)node.textContent=text;return node;
}
function settings():ReaderSettings|null {
  const n=Number(budget.value);budget.setCustomValidity(Number.isSafeInteger(n)&&n>0?'':'Choose a positive whole number.');
  if(!budget.validity.valid)return null;
  return {topics:Array.from(form.querySelectorAll<HTMLInputElement>('input[name=topic]:checked')).map(input=>input.value as Topic),query:query.value.slice(0,200).trim(),budget:n,mode};
}
function allVisibleTopicsSelected():boolean {return Array.from(form.querySelectorAll<HTMLInputElement>('input[name=topic]:not([hidden])')).every(input=>input.checked);}
function updateTabs():void {
  const context=settings();if(context)required<HTMLElement>('#personalise-summary').textContent=`${allVisibleTopicsSelected()?'All topics':context.topics.map(t=>labels[t]).join(', ')||'No topics'} · ${context.budget} cards`;if(context&&(editedFocus||deviceState.focus!==null))document.dispatchEvent(new CustomEvent('dlkt:topic-context',{detail:context}));
  const prepare=document.querySelector<HTMLButtonElement>('#prepare-edition');if(prepare)prepare.hidden=savedView||changesView||mode!=='briefing';
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===(changesView?'changes':savedView?'saved':mode))));
  const chosen=Array.from(form.querySelectorAll<HTMLInputElement>('input[name=topic]:checked')).map(input=>input.value);
  document.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.focus==='all'?allVisibleTopicsSelected():chosen.length===1&&chosen[0]===button.dataset.focus)));
}
function renderHealth():void {
  if(!snapshot)return;health.replaceChildren();
  health.append(make('p','privacy-note',`${snapshot.sources.length} source feeds from ${new Set(snapshot.sources.map(source=>source.publisher)).size} publishers. Availability is shown below; multiple feeds are not independent confirmations.`));
  for(const source of snapshot.sources){
    const section=make('article','source-health');
    const state=source.state==='partial'?'Some records excluded':source.state==='verified'?'Available':source.state==='stale'?'Older verification':'Unavailable';
    section.append(make('h3','',`${source.label} · ${state}`),make('p','',source.scope));
    section.append(make('p','',`${source.count} accepted records${source.rejected?`; ${source.rejected} rejected by validation`:''}.`));
    section.append(make('p','',source.verifiedAt?`Last successful source check: ${formatted(source.verifiedAt,false,true)}.`:'No successful source check is available.'));
    const url=safeLink(source.termsUrl);if(url){const link=make('a','','Source terms');link.href=url;link.target='_blank';link.rel='noopener noreferrer';section.append(link);}
    health.append(section);
  }
}
async function shareSource(card:EvidenceCard,button:HTMLButtonElement,fallback:HTMLInputElement):Promise<void>{
  const url=safeLink(card.sourceUrl);if(!url)return;
  try{
    if(typeof navigator.share==='function')await navigator.share({title:card.title,url});
    else if(navigator.clipboard){await navigator.clipboard.writeText(url);button.textContent='Link copied';announcement.textContent='Original source link copied.';toast('Original source link copied.');}
    else {fallback.hidden=false;fallback.value=url;fallback.focus();fallback.select();}
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')return;
    fallback.hidden=false;fallback.value=url;fallback.focus();fallback.select();
    announcement.textContent='Copy the original source link from the selected field.';
  }
}
function cardNode(view:ReadingCard,index:number,total:number,saved?:SavedCard,automaticInsights=true,followPresentation:FollowPresentation='category',publicationTimeZone='UTC',showOriginalLanguage=false):HTMLElement{
  const fragment=template.content.cloneNode(true) as DocumentFragment;
  const node=fragment.querySelector<HTMLElement>('article');if(!node)throw new Error('READER_TEMPLATE_INVALID');
  node.classList.add('editorial-card');
  const put=(selector:string,value:string):void=>{const el=node.querySelector<HTMLElement>(selector);if(el)el.textContent=value;};
  const photograph=photoNode(view.card);if(photograph)node.querySelector('header')?.after(photograph);
  const card=view.card,presentation=editorialCardPresentation(view,saved!==undefined);node.dataset.notice=view.noticeState;node.dataset.cardId=card.id;
  if(view.storyKey)node.dataset.storyKey=view.storyKey;
  const originalText=(element:HTMLElement,record:EvidenceCard=card):void=>{element.dir='auto';element.lang=sourceLanguage(record)??'';element.setAttribute('translate','no');};
  const evidence=node.querySelector<HTMLElement>('.evidence');
  currentCardByNode.set(node,card);
  const coverage=contextForCard(card);
  if('reason' in view&&typeof view.reason==='string'){const why=make('p','contextual-reason',view.reason);evidence?.append(why);node.dataset.contextual='true';}
  node.dataset.coverage=coverage.basis;
  const editorialCategory='category' in view&&typeof view.category==='string'&&(PUBLIC_EDITORIAL_CATEGORIES as readonly string[]).includes(view.category)?view.category as PublicEditorialCategory:categoryForCard(card);
  const unclassified='editorial' in view&&object(view.editorial)&&view.editorial.classification==='unclassified';
  put('.card-topic',unclassified?tr('otherTopics'):editorialCategory?translatedCategory(editorialCategory):labels[card.topic]);
  if(editorialCategory)node.dataset.editorialCategory=editorialCategory;put('.card-index',`${String(index+1).padStart(2,'0')} / ${String(total).padStart(2,'0')}`);
  put('.card-kind',presentation.kindLabel);const kind=node.querySelector<HTMLElement>('.card-kind');if(kind)kind.hidden=!presentation.kindLabel;
  put('h3',presentation.headline);
  const title=node.querySelector<HTMLElement>('h3'),sourceUrl=safeLink(card.sourceUrl);
  for(const original of node.querySelectorAll<HTMLElement>('h3,.card-publisher'))originalText(original);
  if(title&&sourceUrl){const titleLink=make('a','card-title-link',presentation.headline);titleLink.href=sourceUrl;titleLink.target='_blank';titleLink.rel='noopener noreferrer';title.replaceChildren(titleLink);}
  const credit=cardCreditsNode(card);if(credit)node.querySelector('.card-meta')?.after(credit);
  put('.card-context',presentation.visibleContext??'');put('.card-publisher',card.publisher);
  put('.card-date',`${view.dateLabel==='Published'?'':view.dateLabel+': '}${formatted(card.date,true,false,card.dateLabel==='Published'?publicationTimeZone:'UTC')}`);
  const readingContext=node.querySelector('.card-context'),guide=cardGuideNode(card);
  if(readingContext instanceof HTMLElement){
    readingContext.hidden=presentation.visibleContext===null;
    if(card.summary!==undefined&&presentation.visibleContext===card.summary){const wording=make('span','',card.summary);originalText(wording);readingContext.replaceChildren(make('strong','',tr('publisherExcerpt')+': '),wording);}
    else if(presentation.visibleContext!==null)readingContext.lang='en';
  }
  if(card.kind==='publication'){
    const provenance=editorialSourceContext(card),context=make('div','card-source-context');
    if(provenance.editionLanguage){const originalLanguage=make('p','',tr('editionLanguage',{language:languageLabel(provenance.editionLanguage)}));originalLanguage.dataset.originalLanguage=provenance.editionLanguage;context.append(originalLanguage);}
    else if(showOriginalLanguage){const originalLanguage=make('p','',getLocale()==='ro'?'Limba sursei neprecizata':getLocale()==='it'?'Lingua della fonte non specificata':'Source language unspecified');originalLanguage.dataset.originalLanguage='unknown';context.append(originalLanguage);}
    if(provenance.publisherCountry)context.append(make('p','',tr('publisherCountry',{country:countryLabel(provenance.publisherCountry.code,provenance.publisherCountry.name)})));
    if(provenance.coverage){const countries=new Intl.ListFormat(getLocale(),{style:'short',type:'conjunction'}).format(provenance.coverage.countries.map(country=>countryLabel(country.code,country.name)));context.append(make('p','',tr(provenance.coverage.basis==='publisher-category'?'publisherCountryTags':'publisherScopeCountries',{countries})));}
    if(showOriginalLanguage){
      const original=context.querySelector<HTMLElement>('[data-original-language]');
      if(original){const badge=make('span','card-language',provenance.editionLanguage?languageLabel(provenance.editionLanguage):original.textContent??'');badge.dataset.originalLanguage=original.dataset.originalLanguage??'unknown';badge.title=original.textContent??'';node.querySelector('.card-meta')?.append(badge);}
    }
    if(context.childNodes.length)evidence?.querySelector('summary')?.after(context);
    if(kind&&presentation.kindLabel==='From the publisher')kind.hidden=true;
  }
  if(presentation.detailContext)evidence?.append(make('p','card-detail-context',presentation.detailContext));
  if(presentation.safetyNote)readingContext?.after(make('p','card-scope-note',presentation.safetyNote));
  if(card.summary!==undefined&&card.summary!==presentation.visibleContext){
    const excerpt=make('p','card-context publisher-excerpt');
    const wording=make('span','',card.summary);originalText(wording);excerpt.append(make('strong','',tr('publisherExcerpt')+': '),wording);
    readingContext?.after(excerpt);
  }
  evidence?.append(guide);
  const link=node.querySelector<HTMLAnchorElement>('.source-link');if(link){link.href=safeLink(card.sourceUrl)??'#';const icon=link.querySelector('svg');link.replaceChildren(document.createTextNode(tr('openSource')+' '));if(icon)link.append(icon);}
  const deadline=node.querySelector<HTMLElement>('.card-deadline');
  if(deadline&&card.deadline){deadline.hidden=false;deadline.textContent=`Listed closing date: ${formatted(card.deadline,true)}${view.noticeState==='awarded'?' · not an application deadline for this award':''}`;}
  const details=node.querySelector<HTMLElement>('.evidence dl');
  for(const [key,value]of [[tr('originalTitle'),card.title],[tr('publisher'),card.publisher],[tr('sourceChecked'),formatted(card.observedAt,false,true)],[tr('published'),formatted(card.date,card.dateLabel==='Document date')],['Document identity',card.identity],['Date meaning',view.dateLabel]]){const detail=make('dd','',value);if(key===tr('sourceChecked'))detail.dataset.sourceChecked='true';if(key===tr('originalTitle')||key===tr('publisher'))originalText(detail);details?.append(make('dt','',key),detail);}
  details?.append(make('dt','','Publisher coverage'),make('dd','',coverage.label),make('dt','','Coverage meaning'),make('dd','',coverage.boundary));
  put('.card-boundary',card.boundary);put('.card-attribution',card.attribution);
  put('.evidence summary',tr('sourceDetails'));
  const related=node.querySelector<HTMLDetailsElement>('.related');
  if(related&&view.related.length){
    related.hidden=false;const summary=related.querySelector('summary'),publication=card.kind==='publication';
    if(summary)summary.textContent=publication?tr('storyReports',{count:view.related.length}):`${view.related.length} other listed version${view.related.length===1?'':'s'}`;
    if(publication)summary?.after(make('p','privacy-note',tr('storyReportsNote')));
    const list=related.querySelector('ul');
    for(const item of view.related){
      const url=safeLink(item.sourceUrl);if(!url)continue;
      const row=make('li',''),a=make('a','',`${item.publisher}: ${item.title}`);originalText(a,item);a.href=url;a.target='_blank';a.rel='noopener noreferrer';
      row.dataset.relatedCardId=item.id;currentCardByNode.set(row,item);row.append(a,make('p','privacy-note',formatted(item.date)));
      if(saved){const archived=deviceState.cards.find(entry=>entry.id===item.id);if(archived)row.append(make('p','saved-copy-note',`Saved here ${formatted(archived.savedAt)}. Original source check ${formatted(item.observedAt)}. This saved copy is retained.`));}
      const credits=cardCreditsNode(item);if(credits)row.append(credits);
      const saveRelated=make('button','text-button',tr('saveCard'));saveRelated.type='button';saveRelated.dataset.saveCard=item.id;
      saveRelated.addEventListener('click',()=>{const exists=deviceState.cards.some(entry=>entry.id===item.id);void writeDevice(()=>exists?device.remove(item.id):device.save(currentCardByNode.get(row)??item),exists?'Card removed from this browser.':'Card saved in this browser only.');});
      row.append(saveRelated);list?.append(row);
    }
  }
  const button=node.querySelector<HTMLButtonElement>('.share-source'),fallback=node.querySelector<HTMLInputElement>('.share-fallback');
  if(button&&fallback){const label=button.querySelector('.share-label');if(label)label.textContent=tr('shareCard');else button.textContent=tr('shareCard');button.setAttribute('aria-label',tr('shareCard'));button.title=tr('shareCard');fallback.setAttribute('aria-label','DLKT card link to copy');button.addEventListener('click',()=>{void shareCard(currentCardByNode.get(node)??card,{button,fallback,announce:message=>{announcement.textContent=message;toast(message);}});});}
  const sourceShare=make('button','text-button','Share original source');sourceShare.type='button';const sourceFallback=make('input','share-fallback');sourceFallback.type='text';sourceFallback.readOnly=true;sourceFallback.hidden=true;sourceFallback.setAttribute('aria-label','Original source link to copy');sourceShare.addEventListener('click',()=>{void shareSource(card,sourceShare,sourceFallback);});node.querySelector('.evidence')?.append(sourceShare,sourceFallback);
  const save=node.querySelector<HTMLButtonElement>('.save-card');
  if(save){save.dataset.saveCard=card.id;save.addEventListener('click',()=>{
    const exists=deviceState.cards.some(entry=>entry.id===card.id);
    void writeDevice(()=>exists?device.remove(card.id):device.save(currentCardByNode.get(node)??card),exists?'Card removed from this browser.':'Card saved in this browser only.');
  });}
  if(editorialCategory&&!unclassified)following.attach(node,editorialCategory,followPresentation);
  if(card.kind==='publication'&&evidence){const follow=node.querySelector('.card-follow');if(follow)evidence.append(follow);}
  if(saved){
    const note=make('p','saved-copy-note',`Saved here ${formatted(saved.savedAt)}. Original source check ${formatted(card.observedAt)}. This saved copy is retained; current comparisons appear separately when available.`);
    evidence?.append(note);
  }else attachInsight(node,card,automaticInsights,()=>currentCardByNode.get(node)??card);
  if(photograph&&title){
    integratePhotoHeadline(photograph,title,node.querySelector<HTMLElement>(':scope > header')??undefined);
    const photoDetails=photograph.querySelector<HTMLDetailsElement>('.photo-details');
    if(photoDetails&&evidence){
      const photoEvidence=make('div','card-photo-evidence'),photoLabel=make('p','details-label',tr('photoDetailsLabel'));photoLabel.dataset.i18n='photoDetailsLabel';photoEvidence.append(photoLabel);
      for(const child of [...photoDetails.children])if(child.tagName!=='SUMMARY')photoEvidence.append(child);
      const photoCredit=photograph.querySelector('.card-photo-credit');if(photoCredit)photoEvidence.append(photoCredit.cloneNode(true));
      evidence.append(photoEvidence);photoDetails.remove();
    }
    // A generic source-image link repeats the visible original-source action.
    // Reviewed photograph credits and licence links remain beside their image.
    if(photograph.querySelector('img[data-article-photo]'))photograph.querySelector('.card-photo-caption')?.remove();
  }
  return node;
}
function render():void {
  renderDiscovery();
  updateTabs();required<HTMLElement>('#comparison-panel').hidden=!changesView;if(changesView){renderComparison();return;}if(savedView){savedCards();return;}if(!snapshot){memoryControls();return;}empty.querySelector('strong')?.replaceChildren(document.createTextNode('No matching cards.'));const s=settings();if(!s){feedback.textContent='Enter a positive whole number for the card budget.';return;}
  const selection=selectReadingCards(selectNewsLanguage(snapshot.cards,getLocale()),s,Date.now());
  cards.replaceChildren(...selection.cards.map((card,i)=>cardNode(card,i,selection.cards.length)));
  pruneInsights();
  heading.replaceChildren(document.createTextNode(mode==='briefing'?'Topic results':'Explore records'),make('span','title-dot','.'));
  count.textContent=`${selection.cards.length} cards`;
  const rejected=snapshot.sources.reduce((n,source)=>n+source.rejected,0);
  status.dataset.level=snapshot.state==='unavailable'||snapshot.sources.some(source=>source.state!=='verified')||rejected?'warning':'normal';
  const unavailable=snapshot.sources.some(source=>source.state==='unavailable'||source.state==='stale');
  status.textContent=snapshot.state==='unavailable'?'Sources are unavailable. This is not a “nothing changed” result.'
    :unavailable?'Some sources are unavailable or older. See Sources & coverage.':rejected?'Coverage is partial. Incomplete records are excluded.':'Current source selection. Open Changes to compare a saved check.';
  feedback.textContent=mode==='briefing'?
    [selection.excludedNotices?`${selection.excludedNotices} closed or unconfirmed procurement notices kept in Explore.`:'',selection.excludedStale?`${selection.excludedStale} older source records kept in Explore.`:'',selection.groupedVersions?`${selection.groupedVersions} additional software versions grouped with their product.`:''].filter(Boolean).join(' '):'Includes closed and unconfirmed notices, each labelled with its available status.';
  checked.textContent=`Checked ${formatted(snapshot.generatedAt)}`;
  empty.hidden=selection.cards.length>0;
  emptyCopy.textContent=snapshot.state==='unavailable'?'No synthetic substitute is shown. Try a source check again later.':!s.topics.length?'Choose a topic to start.':selection.excludedNotices>0?'No current application window is established by the matching notices. Explore keeps the closed and unconfirmed records available.':'No available record matches these settings. Try another focus or inspect source coverage.';
  finish.hidden=selection.cards.length===0;finishCopy.textContent=`${selection.cards.length} cards in this selection. You can change your focus or explore the available records.`;
  more.hidden=selection.cards.length>=selection.availableGroups;explore.hidden=mode==='records';
  briefing.setAttribute('aria-busy','false');memoryControls();
}
async function load(automatic=false,acceptUpdates=!automatic):Promise<void>{
  if(loading)return;clearTimeout(publicRefreshTimer);lastPublicCheckAttempt=Date.now();initialCheckStarted=true;loading=true;discoveryLoading.begin();automaticPublicLoad=automatic;refresh.disabled=true;briefing.setAttribute('aria-busy','true');if(!automatic)status.textContent='Checking the available source snapshot…';renderDiscovery();if(savedView&&!automatic)savedCards();
  try{
    const headers:Record<string,string>={Accept:'application/json'};if(publicEtag&&snapshot)headers['If-None-Match']=publicEtag;
    const response=await fetch('/api/iceo',{credentials:'omit',cache:'no-cache',headers,signal:AbortSignal.timeout(45000)});
    if(response.status===304&&snapshot){lastLoadFailed=false;lastLoadRegressed=false;publicRefreshFailures=0;if(acceptUpdates)applyPublicUpdate=true;return;}
    if(!response.ok)throw new Error('SNAPSHOT_UNAVAILABLE');
    const value:unknown=await response.json();if(!valid(value))throw new Error('SNAPSHOT_INVALID');
    const progress=snapshotProgress.accept(value,Date.now());if(progress!=='accepted')throw new Error(progress==='regressed'?'SNAPSHOT_REGRESSED':'SNAPSHOT_INVALID');
    snapshot=value;const etag=response.headers.get('etag');publicEtag=etag&&/^"[a-f0-9]{64}"$/u.test(etag)?etag:null;lastLoadFailed=false;lastLoadRegressed=false;publicRefreshFailures=0;if(acceptUpdates)applyPublicUpdate=true;
    if(!automatic)render();else renderDiscovery();renderHealth();
  }catch(error){
    publicRefreshFailures=Math.min(2,publicRefreshFailures+1);
    if(error instanceof Error&&error.message==='SNAPSHOT_REGRESSED'&&snapshot){
      lastLoadRegressed=true;if(!automatic)render();else renderDiscovery();status.textContent=`An older source response was ignored. Showing the snapshot previously verified at ${formatted(snapshot.generatedAt)}.`;
    }else{
    lastLoadFailed=true;lastLoadRegressed=false;
    if(automatic){renderDiscovery();}
    else if(changesView){render();}
    else if(snapshot){render();status.textContent=`Refresh unavailable. Showing the snapshot previously loaded at ${formatted(snapshot.generatedAt)}; it is not newly verified.`;}
    else if(savedView){render();}
    else{heading.textContent='Source check unavailable';status.textContent='No verified snapshot could be loaded. Retry the source check.';empty.hidden=false;emptyCopy.textContent='No synthetic information is substituted.';}
    }
  }finally{discoveryLoading.finish();loading=false;automaticPublicLoad=false;refresh.disabled=false;briefing.setAttribute('aria-busy','false');if(savedView&&!automatic)savedCards();renderDiscovery();memoryControls();schedulePublicRefresh();}
}

/** Reuse unchanged article nodes, including focused controls and expanded source details. */
function reconcileDiscovery(target:HTMLElement,next:HTMLElement):void {
  const key=(node:HTMLElement):string=>node.dataset.storyKey?`story:${node.dataset.storyKey}`:node.dataset.cardId?`card:${node.dataset.cardId}`:node.dataset.homeLocalId?`local:${node.dataset.homeLocalId}`:node.id;
  const current=new Map([...target.children].filter((node):node is HTMLElement=>node instanceof HTMLElement).map(node=>[key(node),node]));
  const desired=[...next.children].filter((node):node is HTMLElement=>node instanceof HTMLElement).map(node=>{
    const existing=current.get(key(node));
    if(!existing||!key(node))return node;
    const same=node.dataset.liveSignature!==undefined?existing.dataset.liveSignature===node.dataset.liveSignature:existing.textContent===node.textContent&&existing.dataset.weatherRevision===node.dataset.weatherRevision;
    if(!same)return node;
    existing.className=node.className;
    if(node.dataset.editionPart)existing.dataset.editionPart=node.dataset.editionPart;else delete existing.dataset.editionPart;
    const freshCard=currentCardByNode.get(node);if(freshCard)currentCardByNode.set(existing,freshCard);
    const relatedChecks=new Map([...node.querySelectorAll<HTMLElement>('[data-related-card-id]')].map(row=>[row.dataset.relatedCardId,currentCardByNode.get(row)]));
    for(const row of existing.querySelectorAll<HTMLElement>('[data-related-card-id]')){const current=relatedChecks.get(row.dataset.relatedCardId);if(current)currentCardByNode.set(row,current);}
    for(const selector of ['.card-index','.card-date','.contextual-reason','.world-card-place','[data-source-checked]']){
      const before=existing.querySelector(selector),after=node.querySelector(selector);if(before&&after)before.textContent=after.textContent;
    }
    return existing;
  });
  const keep=new Set(desired);for(const node of [...target.children])if(!keep.has(node as HTMLElement))node.remove();
  desired.forEach((node,index)=>{if(target.children[index]!==node)target.insertBefore(node,target.children[index]??null);});
  target.dataset.editionState=next.dataset.editionState??'';target.dataset.dailyCoverage=next.dataset.dailyCoverage??'';
}
/** Previously validated links remain readable; an expired source cursor is never renewed. */
function retainedNewsSourcesNode(item:NewsPageItem,page:NewsPage,language:string):HTMLDetailsElement|null {
  if(!item.story||Date.parse(page.expiresAt)>Date.now())return null;
  const details=document.createElement('details'),summary=document.createElement('summary'),list=document.createElement('ol');
  details.className='news-story-sources';details.dataset.storyKey=item.story.key;details.dataset.sourceTotal=String(item.story.sourceTotal);
  summary.textContent=tr('navSources')+' · '+new Intl.NumberFormat(language).format(item.story.sourceTotal);
  const primary:NewsStorySource=item.kind==='global'?{kind:'global',card:item.card}:{kind:'local',card:item.card};
  const originals=[primary,...item.story.related];
  const publishers=make('span','news-story-publishers',[...new Set(originals.map(source=>source.card.publisher))].slice(0,3).join(' · '));
  publishers.dir='auto';publishers.setAttribute('translate','no');summary.append(publishers);list.className='news-story-sources-list';
  for(const source of originals){
    const url=safeLink(source.card.sourceUrl);if(!url)continue;
    const row=document.createElement('li'),meta=make('p','news-story-source-meta',source.card.publisher),link=document.createElement('a'),date=document.createElement('time');
    date.dateTime=source.kind==='global'?source.card.date:source.card.news!.publishedAt;date.title=date.dateTime;
    date.textContent=new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short',timeZone:page.day?.timeZone??'UTC'}).format(new Date(date.dateTime));
    meta.append(document.createTextNode(' · '),date);
    link.className='news-story-source-link';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=source.card.title;
    link.dir='auto';link.lang=newsOriginalLanguage(source)??'';link.setAttribute('translate','no');
    row.append(meta,link);list.append(row);
  }
  const note=make('p','news-story-sources-status',language==='ro'
    ?'Linkuri pastrate din lectura anterioara. Verificarea acestei editii a expirat.'
    :language==='it'?'Link conservati dalla lettura precedente. La verifica di questa edizione è scaduta.'
    :'Links kept from the earlier reading. This edition check has expired.');
  details.append(summary,list,note);return details;
}
function renderDiscovery():void {
  clearTimeout(discoveryExpiry);stopNewsObserver();
  worldExplorer?.update();
  const interactionKey=JSON.stringify([getLocale(),newsSourceScope,newsFilter,newsPeriod,contextualCity?.id??null,document.body.dataset.entryView,document.body.dataset.worldExplore??null]);
  if(interactionKey!==newsInteractionKey||restartNewsEdition){newsInteractionKey=interactionKey;newsInteractionRevision++;}
  renderReturnBrief();
  const section=required<HTMLElement>('#discovery'),target=required<HTMLElement>('#discovery-cards'),host=document.createElement('div'),note=required<HTMLElement>('#discovery-status'),button=required<HTMLButtonElement>('#discovery-refresh');
  const support=required<HTMLElement>('#home-local-cards'),supportHost=document.createElement('div'),extras=required<HTMLElement>('#home-local-extras'),extrasHost=document.createElement('div'),controls=required<HTMLElement>('#home-more-controls'),toolbar=required<HTMLElement>('#home-news-toolbar');
  button.disabled=loading;
  target.setAttribute('aria-busy',String(loading||newsContinuation.view().loading));
  if(document.body.dataset.entryView!=='start'){section.dataset.loading='hidden';renderDiscoveryLoading(discoveryLoadingElements,'hidden');newsMasonry?.disconnect();newsMasonry=null;target.replaceChildren();support.replaceChildren();extras.replaceChildren();controls.replaceChildren();toolbar.hidden=true;pruneInsights();return;}
  const anchors=[...target.querySelectorAll<HTMLElement>('article')].flatMap(node=>{const rect=node.getBoundingClientRect();return rect.top<innerHeight&&rect.bottom>0?[{node,top:rect.top}]:[];});
  const now=Date.now();
  const localNeedsCheck=contextualLocalState==='unavailable'||contextualLocal!==null&&now-Date.parse(contextualLocal.checkedAt)>=300_000;
  if(contextualCity&&contextualLocalState!=='loading'&&localNeedsCheck&&document.visibilityState==='visible'&&now-lastLocalLanguageRefresh>=120_000){
    lastLocalLanguageRefresh=now;contextualLocalState='loading';required<HTMLButtonElement>('#refresh-local').click();
  }
  const city=contextualCity&&contextualLocation!=='estimated'?{id:contextualCity.id,name:contextualCity.name,countryCode:contextualCity.countryCode,confirmed:true as const}:undefined;
  const interests=visitInterests??savedInterests;
  const context={countryCode:contextualCity?.countryCode??null,preferredTopics:interests,...(city?{city}:{})};
  const language=getLocale(),globalContext={countryCode:null,preferredTopics:[]};
  const local=selectHomeLanguage(contextualLocal,contextualCity,now,language);
  const awaitingLocal=contextualLocationPending||contextualCity!==null&&contextualLocalState==='loading';
  const candidate=snapshot?selectContextualToday(newsSourceScope==='all'?consistentCards(snapshot.cards):selectNewsLanguage(snapshot.cards,language),globalContext,now):{first:[],more:[]};
  const contextKey=JSON.stringify([language,newsSourceScope,context.countryCode,city?.id??null,newsPeriod,[...interests].sort()]);
  const live=liveEdition.present(candidate,contextKey,now,applyPublicUpdate,newsReading.hasVisibleLocal(now));
  const today=live.selection,reading=newsReading.present(today,local.cards,contextKey,language,now,applyPublicUpdate);
  void newsContinuation.start({language,sourceScope:newsSourceScope,cityId:contextualCity?.id??null,filter:newsFilter,period:newsPeriod,...(contextualCity?{city:contextualCity}:{})},restartNewsEdition);restartNewsEdition=false;applyPublicUpdate=false;
  const server=newsContinuation.view(),visible=continuationItems(server.items,now);
  const pageItemByKey=new Map(server.items.map(item=>[item.key,item]));
  const stream={total:server.page?.total??0,counts:server.page?.counts??Object.fromEntries(['other',...NEWS_CATEGORIES.map(category=>category.id)].map(id=>[id,0]))};
  const newsUpdates=live.changes.total+reading.pending;
  const topCount=server.page?.filteredTotal??0,remainingCount=Math.max(0,topCount-server.activeReceivedCount),readingTotal=server.retainedCount>0?visible.length:topCount,localNewsCount=server.items.filter(item=>item.kind==='local').length;
  target.dataset.newsLanguage=language;target.dataset.sourceScope=newsSourceScope;
  button.textContent=newsUpdates?(language==='ro'?'Arata noutatile':'Show updates')+' · '+new Intl.NumberFormat(language).format(newsUpdates):tr('refresh');
  button.setAttribute('aria-label',button.textContent);
  const globalEditionState=publicEditionState(today,{snapshotState:snapshot?.state??null,loading:loading||!initialCheckStarted,failed:lastLoadFailed});
  const editionState=visible.length>0?'ready':server.page?(topCount>0?'ready':'empty'):server.loading?'pending':server.error?'unavailable':globalEditionState;
  const loadingPhase=discoveryLoading.phase({pending:editionState==='pending',unavailable:editionState==='unavailable',firstCount:visible.length,moreCount:remainingCount});
  section.dataset.loading=loadingPhase;
  renderDiscoveryLoading(discoveryLoadingElements,loadingPhase);
  note.classList.add('sr-only');toolbar.hidden=false;
  discoveryLoadingElements.hint.textContent=tr('originalContentNote');
  discoveryLoadingElements.personalise.textContent=tr('navPersonalise');discoveryLoadingElements.retry.textContent=tr('refresh');
  if(getLocale()!=='en'&&loadingPhase!=='hidden'){
    discoveryLoadingElements.title.textContent=tr(editionState==='unavailable'?'storiesUnavailable':'loadingStories');
    discoveryLoadingElements.copy.textContent=tr(editionState==='unavailable'?'refreshHint':'homeContext');
    discoveryLoadingElements.status.textContent=tr(editionState==='unavailable'?'storiesUnavailable':'checkingSources');
  }
  const suppressLocalPending=(loadingPhase==='initial'||loadingPhase==='slow')&&!local.supporting.length;
  required<HTMLElement>('#today-heading').textContent=newsPeriod==='today'?(language==='ro'?'Stirile de azi':language==='it'?'Notizie di oggi':"Today's news"):(language==='ro'?'Stiri recente':language==='it'?'Notizie recenti':'Recent news');
  const editionCountry=server.page?.countryCode?countryLabel(server.page.countryCode):null,coverage=server.page?.coverage;
  const countryProfile=newsSourceScope==='edition'&&contextualCity&&contextualCity.countryCode!=='ZZ'?countryEditionProfile(
    {code:contextualCity.countryCode,name:contextualCity.country},language,
    server.page?.countryCode===contextualCity.countryCode&&server.page.language===language?coverage:undefined,
  ):null;
  section.dataset.countryEditionState=countryProfile?.state??'unknown';
  const nationalLabel=language==='ro'?'surse nationale':language==='it'?'fonti nazionali':'national sources';
  const internationalLabel=language==='ro'?'surse internationale':language==='it'?'fonti internazionali':'international sources';
  const allSourcesLabel=language==='ro'?'Toate sursele':language==='it'?'Tutte le fonti':'All sources';
  const originalSourcesLabel=language==='ro'?'Toate sursele · limbi originale':language==='it'?'Tutte le fonti · lingue originali':'All sources · original languages';
  required<HTMLElement>('#home-location').textContent=server.page&&coverage
    ?[editionCountry,...(newsSourceScope==='all'?[originalSourcesLabel]:[coverage.national>0?nationalLabel:internationalLabel,languageLabel(language)])].filter(Boolean).join(' · ')
    :contextualCity?`${contextualCity.name} · ${countryLabel(contextualCity.countryCode,contextualCity.country)}${contextualLocation==='estimated'?' · approximate':''}`
    :contextualLocationPending?tr('lookupLoading'):tr('chooseCity');
  const discoveryDelay=nextDailyEditionDelay(today,now),returnDelay=checkpoint?nextReturnDelay(snapshot,selectReturnBrief(checkpoint,null,now,false).topics,now):null;
  const localBoundaries=[local.expiresAt,reading.expiresAt,server.page?Date.parse(server.page.expiresAt):null].filter((time):time is number=>time!==null&&time>now);
  const localDelay=localBoundaries.length?Math.max(25,Math.min(...localBoundaries)-now+25):null;
  const delays=[discoveryDelay,returnDelay,localDelay,following.nextDelay(now)].filter((n):n is number=>n!==null);
  if(delays.length&&document.visibilityState==='visible')discoveryExpiry=setTimeout(renderDiscovery,Math.min(...delays));
  host.replaceChildren();
  required<HTMLElement>('#home-news-language-caption').textContent=language==='ro'?'Limba stirilor':language==='it'?'Lingua delle notizie':'News language';
  required<HTMLElement>('#home-news-language-label').textContent=newsSourceScope==='all'?originalSourcesLabel:languageLabel(language);
  const sourceScopeButton=required<HTMLButtonElement>('#home-news-source-scope');
  sourceScopeButton.textContent=newsSourceScope==='edition'?allSourcesLabel:language==='ro'?`Inapoi la ${languageLabel(language)}`:language==='it'?`Torna a ${languageLabel(language)}`:`Back to ${languageLabel(language)}`;
  sourceScopeButton.setAttribute('aria-pressed',String(newsSourceScope==='all'));sourceScopeButton.dataset.sourceScope=newsSourceScope;
  required<HTMLButtonElement>('#home-news-english').hidden=newsSourceScope==='edition'&&language==='en';
  const periodPicker=required<HTMLSelectElement>('#home-news-period');
  required<HTMLLabelElement>('#home-news-period-label').textContent=language==='ro'?'Perioada':language==='it'?'Periodo':'Period';
  const todayOption=periodPicker.querySelector<HTMLOptionElement>('option[value="today"]'),recentOption=periodPicker.querySelector<HTMLOptionElement>('option[value="recent"]');
  if(todayOption)todayOption.textContent=language==='ro'?'Azi':language==='it'?'Oggi':'Today';
  if(recentOption)recentOption.textContent=language==='ro'?'Recent':language==='it'?'Recenti':'Recent';
  periodPicker.value=newsPeriod;
  const day=server.page?.day,dayNote=required<HTMLElement>('#home-news-day');
  dayNote.textContent=day
    ?new Intl.DateTimeFormat(language,{day:'numeric',month:'long',year:'numeric',timeZone:day.timeZone}).format(new Date(day.start))+' · '+day.timeZone
    :newsPeriod==='recent'?(language==='ro'?'Cele mai recente articole eligibile din sursele conectate':language==='it'?'Gli articoli recenti disponibili dalle fonti collegate':'Recent eligible reports from connected sources'):'';
  const filterLabel=required<HTMLLabelElement>('#home-news-category-label');filterLabel.textContent=language==='ro'?'Categorie':language==='it'?'Categoria':'Category';
  const picker=required<HTMLSelectElement>('#home-news-category');
  const countsKey=JSON.stringify([language,newsSourceScope,stream.total,stream.counts]);
  if(picker.dataset.countsKey!==countsKey){
    const options:HTMLOptionElement[]=[];
    const addOption=(value:string,label:string,count:number):void=>{const option=make('option','',label+' · '+new Intl.NumberFormat(language).format(count));option.value=value;options.push(option);};
    addOption('all',language==='ro'?'Toate categoriile':language==='it'?'Tutte le categorie':'All categories',stream.total);
    for(const category of NEWS_CATEGORIES)addOption(category.id,newsCategoryLabel(category.id,language),stream.counts[category.id]??0);
    addOption('other',tr('otherTopics'),stream.counts.other??0);picker.replaceChildren(...options);picker.dataset.countsKey=countsKey;
  }
  picker.value=newsFilter;
  const progress=required<HTMLElement>('#home-news-progress'),format=new Intl.NumberFormat(language);
  const progressCopy=server.retainedCount>0
    ?language==='ro'?`${format.format(visible.length)} subiecte in lectura · ${format.format(server.activeReceivedCount)} din ${format.format(topCount)} parcurse in editia curenta`
      :language==='it'?`${format.format(visible.length)} notizie nella lettura · ${format.format(server.activeReceivedCount)} di ${format.format(topCount)} esaminate nell'edizione corrente`
      :`${format.format(visible.length)} stories in your reading · ${format.format(server.activeReceivedCount)} of ${format.format(topCount)} checked in the current edition`
    :language==='ro'?`${format.format(visible.length)} din ${format.format(topCount)} subiecte afisate`:language==='it'?`${format.format(visible.length)} di ${format.format(topCount)} notizie mostrate`:`${format.format(visible.length)} of ${format.format(topCount)} stories shown`;
  if(progress.textContent!==progressCopy)progress.textContent=progressCopy;
  const articleScope=language==='ro'?(newsSourceScope==='all'?'articole originale, in limbile surselor':'articole originale in aceasta limba'):language==='it'?(newsSourceScope==='all'?'articoli originali, nelle lingue delle fonti':'articoli originali in questa lingua'):(newsSourceScope==='all'?'original articles in their source languages':'original articles in this language');
  progress.title=language==='ro'?`${format.format(stream.total)} subiecte din ${format.format(server.page?.articleTotal??0)} ${articleScope}`:language==='it'?`${format.format(stream.total)} notizie da ${format.format(server.page?.articleTotal??0)} ${articleScope}`:`${format.format(stream.total)} stories from ${format.format(server.page?.articleTotal??0)} ${articleScope}`;
  host.dataset.editionState=editionState;host.dataset.dailyCoverage='connected-sources';
  const inlinePage=server.page;
  const inlineContext=inlinePage?JSON.stringify([inlinePage.language,inlinePage.sourceScope??'edition',inlinePage.cityId,inlinePage.countryCode,inlinePage.filter,inlinePage.period]):'';
  if(inlineContext!==inlineKnowledgeContext){
    inlineKnowledgeContext=inlineContext;
    inlineKnowledgeSelection=inlinePage?selectInlineKnowledge(KNOWLEDGE_CARDS.filter(card=>!inlineKnowledgeSeen.has(card.id)),{cityId:inlinePage.cityId,countryCode:inlinePage.countryCode,timeZone:inlinePage.day?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone},now,inlinePage.epoch+':'+inlinePage.revision):[];
  }
  if(server.retainedCount>0)host.append(make('p','discovery-section-label privacy-note',language==='ro'
    ?`Lectura pastrata · ${format.format(server.retainedCount)} subiecte din editiile anterioare. Verificarile originale raman neschimbate.`
    :language==='it'?`Lettura conservata · ${format.format(server.retainedCount)} notizie delle edizioni precedenti. Le verifiche originali restano invariate.`
    :`Kept reading · ${format.format(server.retainedCount)} stories from earlier editions. Original source checks remain unchanged.`));
  let newsIndex=0;
  for(const entry of interleaveKnowledge(visible,inlineKnowledgeSelection)){
    if(entry.kind==='knowledge'){
      if(now>=Date.parse(entry.item.card.reviewBy))continue;
      if(!inlineKnowledgeSeen.has(entry.item.card.id)&&selectInlineKnowledge([entry.item.card],{cityId:inlinePage?.cityId??null,countryCode:inlinePage?.countryCode??null,timeZone:inlinePage?.day?.timeZone??Intl.DateTimeFormat().resolvedOptions().timeZone},now,'reading-check').length===0)continue;
      host.append(knowledgeCardNode(entry.item.card,entry.item.scope));
      if(!document.body.dataset.worldExplore&&!inlineKnowledgeSeen.has(entry.item.card.id)){inlineKnowledgeSeen.add(entry.item.card.id);writeKnowledgeSeen(inlineKnowledgeSeen);}
      continue;
    }
    const item=entry.item,index=newsIndex++,originalItem=pageItemByKey.get(item.key),originalPage=newsContinuation.editionFor(item.key);
    if(server.retainedCount>0&&index===server.retainedCount)host.append(make('p','discovery-section-label',language==='ro'?'Subiecte nevazute din editia actualizata':language==='it'?"Notizie non ancora viste dall'edizione aggiornata":'Unseen stories from the updated edition'));
    let node:HTMLElement;
    if(item.kind==='global'){
      node=cardNode(item.view,index,readingTotal,undefined,false,'related',originalPage?.day?.timeZone??contextualCity?.timezone??'UTC',newsSourceScope==='all');node.dataset.liveSignature=JSON.stringify([language,newsSourceScope,editionCardSignature(item.view.card),editionStorySignature(item.view)]);
    }else{
      if(!contextualCity)continue;
      node=localCardNode(item.card,contextualCity,now);node.dataset.homeLocalId=item.card.id;node.dataset.cityId=contextualCity.id;
      node.dataset.liveSignature=JSON.stringify([language,newsSourceScope,item.card]);
      const originalLanguage=originalItem?newsOriginalLanguage(originalItem):null;
      const title=node.querySelector<HTMLElement>('h3');if(title){title.lang=originalLanguage??'';title.dir='auto';title.setAttribute('translate','no');}
      if(newsSourceScope==='all'){const sourceLanguageNote=make('p','card-date',originalLanguage?languageLabel(originalLanguage):language==='ro'?'Limba sursei neprecizata':language==='it'?'Lingua della fonte non specificata':'Source language unspecified');sourceLanguageNote.dataset.originalLanguage=originalLanguage??'unknown';title?.after(sourceLanguageNote);}
      const link=node.querySelector('.card-content > .source-link');if(link)link.textContent=tr('openSource');
      const details=node.querySelector('.evidence > summary');if(details)details.textContent=tr('sourceDetails');
    }
    if(originalItem?.story&&originalPage){
      node.dataset.storyKey=originalItem.story.key;
      node.dataset.liveSignature=JSON.stringify([node.dataset.liveSignature,originalItem.story,originalPage.epoch,originalPage.revision,originalPage.startedAt]);
      const sources=newsStorySourcesNode(originalItem,originalPage,language,contextualCity??undefined)??retainedNewsSourcesNode(originalItem,originalPage,language);
      if(sources){node.querySelector('.related')?.remove();const evidence=node.querySelector('.evidence');if(evidence)evidence.before(sources);else node.append(sources);}
    }
    node.dataset.editionPart='stream';node.dataset.newsStreamKey=item.key;node.dataset.newsCategory=item.category??'other';
    const label=node.querySelector('.card-topic');if(label)label.textContent=item.category?newsCategoryLabel(item.category,language):tr('otherTopics');
    host.append(node);
  }
  if(!visible.length&&loadingPhase==='hidden'){
    const message=make('p','discovery-section-label privacy-note',editionState==='unavailable'?tr('storiesUnavailable'):newsPeriod==='today'?(language==='ro'?'Nu sunt inca articole verificate pentru aceasta zi, categorie si limba. Alege Recent pentru articolele anterioare.':language==='it'?'Nessun articolo verificato per questo giorno, categoria e lingua. Scegli Recenti per gli articoli precedenti.':'No checked articles match this day, category and language yet. Choose Recent for earlier reports.'):(language==='ro'?'Nu sunt articole verificate pentru aceasta categorie si limba. Acoperirea surselor este partiala.':language==='it'?'Nessun articolo verificato per questa categoria e lingua. La copertura delle fonti è parziale.':'No checked articles match this category and language. Source coverage is partial.'));
    if(editionState!=='unavailable'&&newsSourceScope==='all')message.textContent=newsPeriod==='today'
      ?(language==='ro'?'Nu sunt inca articole verificate pentru aceasta zi si categorie in sursele conectate. Alege Recent pentru articolele anterioare.':language==='it'?'Nessun articolo verificato per questo giorno e categoria nelle fonti collegate. Scegli Recenti per gli articoli precedenti.':'No checked articles match this day and category in connected sources yet. Choose Recent for earlier reports.')
      :(language==='ro'?'Nu sunt articole verificate pentru aceasta categorie in sursele conectate. Acoperirea surselor este partiala.':language==='it'?'Nessun articolo verificato per questa categoria nelle fonti collegate. La copertura delle fonti è parziale.':'No checked articles match this category in connected sources. Source coverage is partial.');
    if(editionState!=='unavailable'&&countryProfile?.state==='unconnected')message.textContent=language==='ro'
      ?`Pentru ${countryProfile.countryName} nu sunt inca conectate surse nationale in ${languageLabel(language)}. Poti incerca perioada Recent sau optiunea English.`
      :language==='it'?`Per ${countryProfile.countryName} non sono ancora collegate fonti nazionali in ${languageLabel(language)}. Prova Recenti oppure English.`
      :`National sources in ${languageLabel(language)} are not connected for ${countryProfile.countryName} yet. Try Recent or another reading language.`;
    message.id='home-edition-'+editionState;host.append(message);
  }
  const streamEnd=document.createElement('div');
  if(server.limitReached){
    streamEnd.append(make('p','privacy-note',language==='ro'?'Ai ajuns la limita acestei lecturi. Poti incepe o lectura noua; sursele raman disponibile in cardurile afisate.':language==='it'?'Hai raggiunto il limite di questa lettura. Puoi iniziarne una nuova; le fonti restano disponibili nelle schede mostrate.':'This reading has reached its limit. You can start a new reading; source links remain in the displayed cards.'));
    const reset=make('button','secondary',language==='ro'?'Incepe o lectura noua':language==='it'?'Inizia una nuova lettura':'Start a new reading');reset.type='button';reset.dataset.newsReset='true';streamEnd.append(reset);
  }else if(server.error==='expired'){
    streamEnd.append(make('p','privacy-note',language==='ro'?'Actualizeaza editia pentru urmatoarele subiecte nevazute. Lectura pastrata ramane pe ecran.':'Update the edition for the next unseen stories. Your kept reading stays on screen.'));
    const update=make('button','secondary',language==='ro'?'Continua cu subiecte nevazute':'Continue with unseen stories');update.type='button';update.id='home-more-button';update.dataset.publicMore='true';streamEnd.append(update);
  }else if(server.loading||server.error||server.canContinue){
    const label=server.loading?(language==='ro'?'Se cauta urmatoarele subiecte nevazute…':'Finding the next unseen stories…'):server.error?(language==='ro'?'Reincearca incarcarea':'Retry loading'):server.manualContinuation?(language==='ro'?'Cauta urmatoarele nevazute':'Find the next unseen stories'):tr('showMore',{count:Math.min(NEWS_PAGE_SIZE,remainingCount),remaining:remainingCount});
    if(server.manualContinuation)streamEnd.append(make('p','privacy-note',language==='ro'?'Lectura este pastrata. Continua pentru urmatoarele subiecte nevazute.':'Your reading is kept. Continue looking for the next unseen stories.'));
    if(server.error)streamEnd.append(make('p','privacy-note',language==='ro'?'Urmatorul lot nu a putut fi incarcat. Ordinea articolelor afisate este pastrata.':'The next page could not be loaded. The reports already shown keep their order.'));
    const next=make('button','secondary',label);next.type='button';next.disabled=server.loading;next.id='home-more-button';next.dataset.publicMore='true';streamEnd.append(next);
  }else if(visible.length){
    streamEnd.append(make('p','privacy-note',language==='ro'?'Nu mai sunt subiecte nevazute in editia verificata. Lectura ta ramane pe ecran.':language==='it'?"Non ci sono altre notizie non viste nell'edizione verificata. La tua lettura resta sullo schermo.":'No unseen stories remain in the checked edition. Your reading stays on screen.'));
    const update=make('button','secondary',language==='ro'?'Cauta subiecte noi':'Check for new stories');update.type='button';update.dataset.newsRestart='true';streamEnd.append(update);
  }
  controls.replaceChildren(...streamEnd.childNodes);
  // Operational city information remains separate from the news stream.
  if(!suppressLocalPending&&contextualCity&&(local.supporting.length>0||localNewsCount>0)){
    const label=make('div','discovery-section-label');label.id='home-local-heading';
    label.append(make('h2','',contextualCity?tr('todayLocalTitle',{city:contextualCity.name}):tr('navMyCity')));
    supportHost.append(label);
  }
  for(const item of local.supporting){if(!contextualCity)break;const node=localCardNode(item,contextualCity,now);node.dataset.homeLocalId=item.id;node.dataset.cityId=contextualCity.id;supportHost.append(node);}
  if(contextualCity&&!suppressLocalPending)extrasHost.append(commercialCardNode({city:contextualCity.name,country:countryLabel(contextualCity.countryCode,contextualCity.country)},language));
  if(!suppressLocalPending&&!local.supporting.length&&!localNewsCount&&(contextualCity||contextualLocationPending)){
    const state=make('div','discovery-section-label');state.id='home-local-state';state.setAttribute('role','status');
    const expired=contextualLocalState==='loaded'&&contextualLocal!==null&&now-Date.parse(contextualLocal.checkedAt)>=300_000;
    state.append(make('p','privacy-note',awaitingLocal?'Checking local updates…':expired?'The local check has expired. Refresh to see current local information.':contextualLocalState==='unavailable'?'Local information could not be checked. Refresh to try again.':newsSourceScope==='all'?'No current local cards are available from connected sources.':'No current local cards match this reading language. Check connected sources or choose another language.'));
    extrasHost.append(state);
  }
  if(contextualCity){
    const details=make('details','selection-details discovery-section-label');details.id='home-coverage';details.append(make('summary','','Local sources & coverage'));
    if(contextualLocal){for(const item of localCoverageReading(contextualLocal,now))details.append(make('p','privacy-note',item.text));details.append(make('p','privacy-note',`Local check: ${formatted(contextualLocal.checkedAt)}. Each card keeps its own event date, area and source.`));}
    else details.append(make('p','privacy-note',contextualLocalState==='loading'?'Local sources are being checked.':'Local sources could not be verified. This does not mean there are no disruptions or events.'));
    details.append(make('p','privacy-note','City-level coverage only; your address and neighbourhood are not known. Only connected sources are included.'));
    extrasHost.append(details);
  }
  reconcileDiscovery(target,host);reconcileDiscovery(support,supportHost);reconcileDiscovery(extras,extrasHost);pruneInsights();
  if(newsMasonry===null)newsMasonry=new NewsMasonry(target);newsMasonry.update();
  const sentinel=controls.querySelector<HTMLElement>('#home-more-button');
  if(sentinel&&!server.loading&&(server.error===null||server.error==='expired')&&!server.manualContinuation&&!server.limitReached&&server.canContinue&&server.page?.nextCursor)stopNewsObserver=observeNewsStream(sentinel,()=>{void showNewsPage(false);});
  const publicationState=stream.total?`${stream.total} stories from ${server.page?.articleTotal??0} original articles ${newsSourceScope==='all'?'in their source languages':'in the selected language'} are available from connected sources. ${topCount} match the category filter; ${server.activeReceivedCount} have been checked in this edition. The reading contains ${visible.length} displayed stories, including ${server.retainedCount} retained from earlier editions without renewing their original source checks. Reports confidently identified as the same event share one card with their original source links. Different events remain separate.`:editionState==='unavailable'?'Publications could not be checked. Refresh to try again.':editionState==='pending'?'Checking connected publications…':newsSourceScope==='all'?'No current publications are available from connected sources.':'No current publications meet this language selection.';
  const sourceState=loading&&!automaticPublicLoad?' Checking for updates…':lastLoadFailed&&snapshot?' Refresh unavailable; retained source checks are not newly verified.':snapshot?.state==='partial'?' Some source coverage is incomplete.':'';
  const localState=(localNewsCount?` ${localNewsCount} local reports are among the articles loaded so far.`:'')+(awaitingLocal?' Local information is being checked.':local.supporting.length?` ${local.supporting.length} supporting local records are available below.`:contextualCity?' Local coverage is shown below.':'');
  const updateParts=[live.changes.total?editionUpdateLabel(live.changes):'',reading.pending?`${reading.pending} local report changes`:'' ].filter(Boolean);
  const updates=newsUpdates?` ${updateParts.join(' · ')}. Select Show updates when you are ready; your reading position stays stable.`:'';
  const editionGeneratedAt=server.page?.generatedAt??snapshot?.generatedAt;
  const noteText=(editionGeneratedAt?`${formatted(editionGeneratedAt,true)} · Source check ${formatted(editionGeneratedAt)}. `:'')+publicationState+sourceState+localState+updates;
  if(loadingPhase==='hidden'){
    const checkedTime=server.page?new Intl.DateTimeFormat(getLocale(),{hour:'2-digit',minute:'2-digit'}).format(new Date(server.page.generatedAt)):null;
    const compact=getLocale()==='en'?compactEditionStatus({state:editionState,count:topCount,continuation:0,checkedTime,refreshing:loading&&!automaticPublicLoad,refreshFailed:lastLoadFailed&&snapshot!==null,partial:true,updates:newsUpdates})
      :editionState==='unavailable'?tr('storiesUnavailable'):editionState==='pending'&&!topCount?tr('loadingStories')
      :[tr('matchingStories',{count:topCount}),checkedTime?tr('checkedAt',{time:checkedTime}):'',lastLoadFailed&&snapshot?tr('refreshUnavailable'):loading&&!automaticPublicLoad?tr('checkingUpdates'):'',tr('partialCoverage')].filter(Boolean).join(' · ');
    if(note.textContent!==compact)note.textContent=compact;
  }
  const editionDetails=required<HTMLDetailsElement>('#discovery-details');editionDetails.hidden=loadingPhase!=='hidden';
  const editionSummary=editionDetails.querySelector('summary');if(editionSummary)editionSummary.textContent=language==='ro'?'Despre editie':'About this edition';
  const detailCopy=required<HTMLElement>('#discovery-details-copy');
  const locationDetail=contextualCity?` City: ${contextualCity.name}, ${contextualCity.country}. ${contextualLocation==='estimated'?'Approximate city from your connection; no precise location is known.':contextualLocation==='saved'?'Using your saved city.':'Chosen for this visit.'}`:'';
  if(detailCopy.textContent!==noteText+locationDetail)detailCopy.textContent=noteText+locationDetail;
  let languages=editionDetails.querySelector<HTMLElement>('#edition-language-coverage');
  if(!languages){languages=make('div','');languages.id='edition-language-coverage';editionDetails.append(languages);}
  languages.replaceChildren();
  if(server.page){
    languages.append(make('p','privacy-note',((server.page.sourceScope??'edition')==='all'?originalSourcesLabel:languageLabel(server.page.language))+' · '+tr('matchingStories',{count:server.page.total})+' · '+tr('partialCoverage')));
    if(coverage){
      const number=new Intl.NumberFormat(language),national=number.format(coverage.national),localCount=number.format(coverage.local),international=number.format(coverage.international);
      languages.append(make('p','privacy-note',language==='ro'
        ?`Subiecte din editii nationale: ${national} · Subiecte locale verificate: ${localCount} · Subiecte din surse internationale: ${international}. Tara descrie editia sursei, nu locul fiecarui eveniment.`
        :language==='it'?`Notizie da edizioni nazionali: ${national} · Notizie locali verificate: ${localCount} · Notizie da fonti internazionali: ${international}. Il paese descrive l'edizione della fonte, non il luogo di ogni evento.`
        :`Stories from national editions: ${national} · Verified local stories: ${localCount} · Stories from international sources: ${international}. The country describes the publisher edition, not the location of every event.`));
      if(coverage.local===0)languages.append(make('p','privacy-note',language==='ro'?'Nicio stire locala verificata in aceasta editie.':language==='it'?'Nessuna notizia locale verificata in questa edizione.':'No verified local news in this edition.'));
      if(countryProfile&&coverage.national===0){
        const unconnected=countryProfile.state==='unconnected';
        languages.append(make('p','privacy-note',language==='ro'
          ?unconnected?`Nu sunt inca conectate surse nationale pentru ${countryProfile.countryName} in aceasta limba.`:'Sursele nationale sunt configurate, dar nu au articole eligibile in aceasta editie.'
          :language==='it'?unconnected?`Non sono ancora collegate fonti nazionali per ${countryProfile.countryName} in questa lingua.`:'Le fonti nazionali sono configurate, ma non hanno articoli idonei in questa edizione.'
          :unconnected?`National sources for ${countryProfile.countryName} are not connected in this language yet.`:'National sources are configured but have no eligible articles in this edition.'));
      }
    }
  }

  const anchor=anchors.find(item=>item.node.isConnected);if(anchor){const offset=anchor.node.getBoundingClientRect().top-anchor.top;if(Math.abs(offset)>1)window.scrollBy(0,offset);}
  memoryControls();
}
/** Explicit updates start a fresh cursor while preserving this context's reading prefix. */
function refreshNewsEdition():void {
  restartNewsEdition=true;applyPublicUpdate=true;renderDiscovery();void load();
  if(contextualCity&&contextualLocalState!=='loading'){
    contextualLocalState='loading';required<HTMLButtonElement>('#refresh-local').click();renderDiscovery();
  }
}
async function showNewsPage(focus:boolean):Promise<void> {
  const state=newsContinuation.view();
  if(document.visibilityState!=='visible'||document.body.dataset.entryView!=='start'||document.body.dataset.worldExplore||state.loading||state.limitReached||!focus&&(state.manualContinuation||state.page?.nextCursor===null)||!state.canContinue)return;
  const target=required<HTMLElement>('#discovery-cards'),before=new Set([...target.querySelectorAll<HTMLElement>('[data-news-stream-key]')].map(node=>node.dataset.newsStreamKey));
  const language=getLocale(),sourceScope=newsSourceScope,filter=newsFilter,period=newsPeriod,cityId=contextualCity?.id??null,revision=newsInteractionRevision,previousCount=state.items.length;
  await newsContinuation.next(true);
  if(revision!==newsInteractionRevision||sourceScope!==newsSourceScope||period!==newsPeriod||language!==getLocale()||filter!==newsFilter||cityId!==(contextualCity?.id??null)||document.body.dataset.entryView!=='start'||document.body.dataset.worldExplore)return;
  renderDiscovery();
  if(focus&&newsContinuation.view().items.length>previousCount){
    const added=[...target.querySelectorAll<HTMLElement>('[data-news-stream-key]')].find(node=>!before.has(node.dataset.newsStreamKey));
    const title=added?.querySelector<HTMLElement>('h3');if(title){title.tabIndex=-1;title.focus({preventScroll:true});const rect=title.getBoundingClientRect();if(rect.top<0||rect.bottom>innerHeight)title.scrollIntoView({block:'nearest',behavior:'auto'});}
    announcement.textContent=getLocale()==='ro'?'Mai multe stiri sunt disponibile mai jos.':'More current reports are available below.';
  }
}
required<HTMLElement>('#discovery').addEventListener('click',event=>{
  if(!(event.target instanceof Element))return;
  if(event.target.closest('[data-news-reset]')){newsInteractionRevision++;inlineKnowledgeContext='';void newsContinuation.reset();renderDiscovery();}
  else if(event.target.closest('[data-news-restart]'))refreshNewsEdition();
  else if(event.target.closest('[data-public-more]'))void showNewsPage(true);
});
required<HTMLElement>('#discovery').addEventListener('change',event=>{
  if(!(event.target instanceof HTMLSelectElement))return;
  if(event.target.id==='home-news-period'){
    const value=event.target.value;if(value!=='today'&&value!=='recent')return;
    newsPeriod=value;renderDiscovery();return;
  }
  if(event.target.id!=='home-news-category')return;
  const value=event.target.value;if(value!=='all'&&value!=='other'&&!isNewsCategoryId(value))return;
  const restoreFocus=document.activeElement===event.target;
  newsFilter=value;renderDiscovery();
  if(restoreFocus)required<HTMLSelectElement>('#home-news-category').focus({preventScroll:true});
});
required<HTMLButtonElement>('#home-news-source-scope').addEventListener('click',()=>{newsSourceScope=newsSourceScope==='all'?'edition':'all';renderDiscovery();});
required<HTMLButtonElement>('#home-news-english').addEventListener('click',()=>{newsSourceScope='edition';const picker=required<HTMLSelectElement>('#reader-language');picker.value='en';picker.dispatchEvent(new Event('change',{bubbles:true}));renderDiscovery();required<HTMLSelectElement>('#home-news-category').focus();});
// Automatic location and saved choices inform this page without choosing a view or writing memory.
document.addEventListener('dlkt:city-selected',event=>{
  if(!(event instanceof CustomEvent)||!object(event.detail)||!validCity(event.detail.city))return;
  const automatic=event.detail.restored===true||event.detail.estimated===true;
  if(automatic&&contextualCityExplicit)return;
  if(!automatic)contextualCityExplicit=true;
  contextualCity=event.detail.city;contextualLocationPending=false;
  contextualLocation=event.detail.estimated===true?'estimated':event.detail.restored===true?'saved':'selected';
  contextualLocal=null;contextualLocalState='loading';lastLocalLanguageRefresh=Date.now();renderDiscovery();
});
document.addEventListener('dlkt:local-snapshot',event=>{
  if(!(event instanceof CustomEvent)||!object(event.detail)||event.detail.origin==='daily'||!validCity(event.detail.city)||!contextualCity||event.detail.city.id!==contextualCity.id)return;
  contextualLocal=currentLocalSnapshot(event.detail.snapshot,contextualCity,Date.now())?event.detail.snapshot:null;
  contextualLocalState=contextualLocal?'loaded':'unavailable';lastLocalLanguageRefresh=Date.now();renderDiscovery();
});
document.addEventListener('dlkt:location-settled',()=>{contextualLocationPending=false;renderDiscovery();});
required<HTMLButtonElement>('#return-open').addEventListener('click',()=>{if(deviceState.cards.length)openSavedCards();else if(checkpointInvalid)openSettings();else openReturnChanges();});
required<HTMLButtonElement>('#return-refresh').addEventListener('click',()=>{void load();});
required<HTMLInputElement>('#comparison-saved-only').addEventListener('change',()=>{if(changesView)render();});
required<HTMLButtonElement>('#discovery-refresh').addEventListener('click',refreshNewsEdition);
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible'){renderDiscovery();if(savedView)savedCards();if(Date.now()-lastPublicCheckAttempt>=PUBLIC_REFRESH_MS)void load(true);else schedulePublicRefresh();}
  else{clearTimeout(discoveryExpiry);clearTimeout(publicRefreshTimer);clearTimeout(savedUpdateExpiry);}
});
window.addEventListener('pagehide',()=>{stopNewsObserver();newsMasonry?.disconnect();newsMasonry=null;});
window.addEventListener('pageshow',()=>{renderDiscovery();schedulePublicRefresh();});
document.addEventListener('dlkt:entry-view',event=>{
  if(!(event instanceof CustomEvent)||!object(event.detail))return;
  if(event.detail.view==='start'&&!snapshot&&!loading)void load();else renderDiscovery();
});
function openSettings():void{if(!panel.open)panel.showModal();query.focus();}
bindDiscoveryLoadingActions(discoveryLoadingElements,{personalise:openSettings,retry:()=>required<HTMLButtonElement>('#discovery-refresh').click()},{settings:panel,settingsFallback:required<HTMLButtonElement>('#personalise-button'),menuFallback:required<HTMLButtonElement>('#header-menu'),retryTarget:required<HTMLElement>('#entry-title')});
function closeSettings():void{panel.close();}
required<HTMLButtonElement>('#close-focus').addEventListener('click',closeSettings);
required<HTMLButtonElement>('#focus-summary-button').addEventListener('click',openSettings);
required<HTMLButtonElement>('#empty-edit-focus').addEventListener('click',openSettings);
panel.addEventListener('click',event=>{if(event.target!==panel)return;const rect=panel.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)closeSettings();});
const options=required<HTMLDetailsElement>('#reader-more');
document.addEventListener('click',event=>{if(event.target instanceof Node&&!options.contains(event.target))options.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&options.open){options.open=false;options.querySelector('summary')?.focus();}});
options.querySelector('a')?.addEventListener('click',()=>{options.open=false;const sourceDetails=document.querySelector<HTMLDetailsElement>('#sources>details');if(sourceDetails)sourceDetails.open=true;});
required<HTMLButtonElement>('#personalise-button').addEventListener('click',openSettings);
required<HTMLButtonElement>('#edit-focus').addEventListener('click',openSettings);
form.addEventListener('input',()=>{editedFocus=true;clearTimeout(renderTimer);renderTimer=setTimeout(render,80);});
form.addEventListener('submit',event=>{event.preventDefault();changesView=false;savedView=false;mode='briefing';editedFocus=true;clearTimeout(renderTimer);render();if(settings()){if(!snapshot)void load();const localEdition=!query.value.trim();if(localEdition)visitInterests=settings()?.topics??[];document.dispatchEvent(new CustomEvent('dlkt:reader-selected',{detail:localEdition?{view:'start'}:undefined}));renderDiscovery();panel.close();const destination=localEdition?required<HTMLElement>('#entry-title'):heading;destination.focus();destination.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});}});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button=>button.addEventListener('click',()=>{options.open=false;if(button.dataset.view==='saved'){openSavedCards();return;}changesView=button.dataset.view==='changes';savedView=false;if(!changesView)mode=button.dataset.view==='records'?'records':'briefing';editedFocus=true;render();if(!snapshot)void load();document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));}));
document.querySelectorAll<HTMLButtonElement>('[data-focus]').forEach(button=>button.addEventListener('click',()=>{savedView=false;editedFocus=true;form.querySelectorAll<HTMLInputElement>('input[name=topic]').forEach(input=>{input.checked=!input.hidden&&(button.dataset.focus==='all'||input.value===button.dataset.focus);});render();if(!snapshot)void load();document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));}));
explore.addEventListener('click',()=>{changesView=false;savedView=false;mode='records';render();if(!snapshot)void load();document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));heading.focus();heading.scrollIntoView({block:'start'});});
more.addEventListener('click',()=>{if(changesView&&checkpoint&&snapshot){const selected=settings();if(selected?.topics.length)budget.value=String(compareFocusedCheckpoint(checkpoint,snapshot,selected.topics,Date.now()).cards.length||6);render();return;}if(savedView){budget.value=String(deviceState.cards.length||6);render();return;}const s=settings();if(snapshot&&s){budget.value=String(selectReadingCards(snapshot.cards,s,Date.now()).availableGroups||s.budget);render();}});
refresh.addEventListener('click',()=>{void load();});

required<HTMLButtonElement>('#remember-focus').addEventListener('click',()=>{
  const s=settings();if(!s){budget.reportValidity();return;}editedFocus=true;
  void writeDevice(()=>device.remember(s),'Focus remembered in this browser. Future changes are saved only when you press Remember again.');
});
required<HTMLButtonElement>('#forget-focus').addEventListener('click',()=>{void writeDevice(()=>device.forgetFocus(),'Remembered focus removed. Your saved cards are unchanged.');});
const confirmation=required<HTMLElement>('#clear-confirmation');
required<HTMLButtonElement>('#clear-device').addEventListener('click',()=>{confirmation.hidden=false;required<HTMLButtonElement>('#cancel-clear').focus();});
required<HTMLButtonElement>('#cancel-clear').addEventListener('click',()=>{confirmation.hidden=true;required<HTMLButtonElement>('#clear-device').focus();});
required<HTMLButtonElement>('#confirm-clear').addEventListener('click',()=>{void writeDevice(()=>device.clear(),'Remembered focus, saved cards and comparison check removed from this browser.',()=>{confirmation.hidden=true;visitInterests=null;document.dispatchEvent(new CustomEvent('dlkt:daily-cleared'));changesView=false;savedView=false;editedFocus=true;form.reset();mode='briefing';render();});});
let pendingCheck:{action:'save'|'forget';snapshot:IceoSnapshot|null;expected:string|null}|null=null;
const checkConfirmation=required<HTMLElement>('#check-confirmation');
function doCheck(pending:NonNullable<typeof pendingCheck>):void{
  if(pending.action==='save'&&pending.snapshot){const snap=pending.snapshot;void writeDevice(()=>device.saveCheckpoint(snap,pending.expected),'Source check saved for your chosen interests in this browser. Nothing is checked in the background.',()=>{checkConfirmation.hidden=true;pendingCheck=null;render();});}
  else if(pending.action==='forget'&&pending.expected){const revision=pending.expected;void writeDevice(()=>device.forgetCheckpoint(revision),'Comparison check removed. Saved cards and focus are unchanged.',()=>{checkConfirmation.hidden=true;pendingCheck=null;render();});}
}
required<HTMLButtonElement>('#save-check').addEventListener('click',()=>{
  if(!snapshot||lastLoadFailed||loading||deviceBusy)return;
  const selected=settings();if(!selected||!selected.topics.length)return;
  let scoped:IceoSnapshot;try{scoped=focusedSnapshot(snapshot,selected.topics);}catch{return;}
  const pending={action:'save' as const,snapshot:scoped,expected:checkpoint?.revision??null};
  if(!checkpoint){doCheck(pending);return;}pendingCheck=pending;
  required<HTMLElement>('#check-confirmation-copy').textContent='Replace the saved source check? Future comparisons will start from the currently loaded source snapshot for your chosen interests. Previously saved interests outside this selection will no longer be tracked by this baseline. Your saved cards stay unchanged.';
  checkConfirmation.hidden=false;required<HTMLButtonElement>('#cancel-check').focus();
});
required<HTMLButtonElement>('#forget-check').addEventListener('click',()=>{
  if(!checkpoint||deviceBusy)return;pendingCheck={action:'forget',snapshot:null,expected:checkpoint.revision};
  required<HTMLElement>('#check-confirmation-copy').textContent='Remove this comparison baseline? Your saved cards and focus will remain.';
  checkConfirmation.hidden=false;required<HTMLButtonElement>('#cancel-check').focus();
});
required<HTMLButtonElement>('#cancel-check').addEventListener('click',()=>{pendingCheck=null;checkConfirmation.hidden=true;required<HTMLButtonElement>('#save-check').focus();});
required<HTMLButtonElement>('#confirm-check').addEventListener('click',()=>{if(pendingCheck)doCheck(pendingCheck);});
if(changes)changes.onmessage=event=>{if(event.data==='changed'&&!deviceBusy)void readDevice();};
window.addEventListener('focus',()=>{if(!deviceBusy)void readDevice();});
function openOrganizationFocus():boolean {
 const linked=organizationSetupFromHash(window.location.hash);if(!linked)return false;
 editedFocus=true;changesView=false;savedView=false;restoreSettings(organizationReadingSettings(linked));
 render();if(!snapshot&&!loading)void load();
 document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));return true;
}
setupLanguage();
worldExplorer=setupExplore({snapshot:()=>snapshot,loading:()=>loading,failed:()=>lastLoadFailed,
 card:(view,index,total)=>cardNode(view,index,total,undefined,false),reconcile:reconcileDiscovery,
 refresh:()=>{void load();},saved:memoryControls});
document.addEventListener('dlkt:language-changed',()=>{applyInterfaceLanguage();render();});
const organizationPreview=openOrganizationFocus();
window.addEventListener('hashchange',openOrganizationFocus);
// Public cards do not wait for browser storage, location or a saved-profile restoration.
if(!organizationPreview)void load(false,false);
void readDevice(true);

setupEdition(settings);

document.addEventListener('dlkt:topic-request',event=>{
 if(!(event instanceof CustomEvent)||!object(event.detail)||typeof event.detail.query!=='string'||event.detail.query.length>200)return;
 const topic=event.detail.topic;if(topic!=='all'&&!TOPICS.includes(topic as Topic))return;
 editedFocus=true;changesView=false;savedView=false;mode='briefing';query.value=event.detail.query;
 form.querySelectorAll<HTMLInputElement>('input[name=topic]').forEach(input=>{input.checked=topic==='all'?!input.hidden:input.value===topic;});
 render();if(!snapshot)void load();document.dispatchEvent(new CustomEvent('dlkt:reader-selected'));
});
