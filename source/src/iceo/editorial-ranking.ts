import {consistentCards} from './evidence-consistency.js';
import type {EvidenceCard} from './contracts.js';
import {COMPARISON_MAX_AGE_MS} from './comparison.js';
import {contextForCard} from './context.js';
import type {ContextualReadingCard} from './contextual.js';
import {readingCard,normalizeFocus} from './reader.js';
import {editorialRelevance,validateEditorialContext,type EditorialReaderContext,type EditorialRelevance} from './editorial-relevance.js';
import {classifyEditorialCard,classifyNewsHeadline,editorialHeadlineSignals,headlineSignalPriority,EDITORIAL_CATEGORY_LABELS,type EditorialClassification,type EditorialHeadlineSignal,type PublicEditorialCategory} from './editorial-categories.js';
import {groupStories} from './story-grouping.js';

export type EditorialSignal='publisher-frontpage'|EditorialHeadlineSignal;
type HeadlineSignal=Exclude<EditorialSignal,'publisher-frontpage'>;
export interface EditorialReadingCard extends ContextualReadingCard {
  /** Navigation label only. An unclassified publication remains eligible. */
  readonly category?:PublicEditorialCategory;
  readonly editorialReason?:string;
  readonly editorial?:Readonly<{
    classification:EditorialClassification['basis']|'unclassified';
    signals:readonly EditorialSignal[];
    headlineSignals:readonly HeadlineSignal[];
    relatedListingsAreIndependentConfirmations:false;
    developmentPriority:number;
    globalEssential:boolean;
    developmentReason:string;
    relevance:EditorialRelevance;
  }>;
}
export interface RankedEditorialCard extends EditorialReadingCard {
  readonly editorialReason:string;
  readonly editorial:NonNullable<EditorialReadingCard['editorial']>;
}

const WINDOW_MS=86_400_000;

interface DevelopmentPriority {readonly priority:0|1|2|3;readonly globalEssential:boolean;readonly reason:string}
/** Headline evidence is an editorial hint, never independent corroboration or a measured impact score. */
function developmentPriority(card:EvidenceCard,category:PublicEditorialCategory|undefined,signals:readonly HeadlineSignal[]):DevelopmentPriority {
  const title=normalizeFocus(card.title);
  const feature=/^(?:how to|why you|what to (?:buy|watch|wear|cook)|the best|best |opinion[: ]|analysis[: ]|a closer look|remembering|looking back|on this day|this day in|in (?:18|19|20)\d{2}|the history of)|\b(?:buying guide|gift guide|listicle|round[- ]up|retrospective|anniversary|tips for|explained|\d+ best|\d+ ways to)\b/u.test(title);
  const speculative=/\b(?:could|might|may|would|will|plans? to|expected to|likely to|aims? to|rumou?rs?|denies?|denied|denial|claims?|false|falsely|hoax|fabricated|fictional|not|no|never|nobody|none|without|(?:years?|decades?|centuries?) ago)\b/u.test(title);
  const minor=/\b(?:small accessory|minor (?:update|change)|new colou?r|accessory update)\b/u.test(title);
  if(feature||minor)return {priority:0,globalEssential:false,reason:'Feature, explanatory or minor-product headline; substantive reported developments take precedence.'};
  if(!speculative){
    const diplomacy=category==='world'&&(/\b(?:ceasefire|peace (?:agreement|accord|deal))\b.{0,50}\b(?:takes? effect|comes? into (?:effect|force)|begins?|starts?|agreed|signed|reached|collapses?|ends?)\b/u.test(title)
      ||/\b(?:agree|agrees|sign|signs|reach|reaches|announce|announces)\b.{0,40}\b(?:ceasefire|peace (?:agreement|accord|deal))\b/u.test(title)
      ||/\b(?:invades|declares war on)\b|\b(?:launches?|begins?|starts?)\b.{0,35}\b(?:invasion|military offensive|airstrikes?)\b/u.test(title));
    const disaster=category==='weather'&&/\b(?:earthquake|floods?|wildfire|hurricane|typhoon|tsunami|cyclone)\b.{0,70}\b(?:kills?|forces? (?:mass )?evacuation|leaves? .{0,20} dead|displaces?)\b/u.test(title);
    const emergency=category==='health'&&/\b(?:who|world health organi[sz]ation)\b.{0,40}\bdeclares?\b.{0,40}\b(?:global|international|pandemic)\b/u.test(title);
    const disruption=category!==undefined&&['digital-life','travel','business'].includes(category)&&(/\b(?:global|worldwide|widespread) (?:outage|cyberattack|disruption)\b.{0,50}\b(?:hits?|disrupts?|grounds?|halts?|shuts?)\b/u.test(title)
      ||/\b(?:outage|cyberattack)\b.{0,50}\b(?:disrupts?|grounds?|halts?|shuts?)\b.{0,50}\b(?:worldwide|globally|across multiple countries)\b/u.test(title));
    if(diplomacy||disaster||emergency||disruption)return {priority:3,globalEssential:true,reason:'Global-essential editorial priority: the headline reports a new conflict, emergency or major disruption. This is not a personal-risk assessment or independent confirmation.'};
    if(headlineSignalPriority(signals)>0)return {priority:2,globalEssential:false,reason:'The headline describes a concrete policy, economic, research, competition, regulatory or product development; source claims remain attributed.'};
  }
  return {priority:1,globalEssential:false,reason:speculative?'Prospective or qualified headline; no completed major event is inferred.':'Source-backed publication without a stronger supported development signal.'};
}
const discoveredNews=(view:RankedEditorialCard):boolean=>view.editorial.classification==='category-discovery'||view.card.sourceIds.includes('news-unclassified');
function order(a:RankedEditorialCard,b:RankedEditorialCard):number {
  const aPriority=headlineSignalPriority(a.editorial.headlineSignals),bPriority=headlineSignalPriority(b.editorial.headlineSignals);
  return b.editorial.developmentPriority-a.editorial.developmentPriority
    ||Number(b.editorial.globalEssential)-Number(a.editorial.globalEssential)
    ||b.editorial.relevance.priority-a.editorial.relevance.priority
    ||Number(discoveredNews(b))-Number(discoveredNews(a))
    ||Number(bPriority===2)-Number(aPriority===2)
    ||Number(b.editorial.signals.includes('publisher-frontpage'))-Number(a.editorial.signals.includes('publisher-frontpage'))
    ||bPriority-aPriority
    ||Date.parse(b.card.date)-Date.parse(a.card.date)||a.card.id.localeCompare(b.card.id);
}
export const compareEditorialCards=order;

function current(card:EvidenceCard,now:number):boolean {
  const published=Date.parse(card.date),observed=Date.parse(card.observedAt);
  // Updated alone does not establish an original publication or a material new
  // event. Professional records and software patches remain in the full reader.
  return card.kind==='publication'&&card.dateLabel==='Published'&&card.sourceState!=='stale'
    &&Number.isFinite(published)&&published<=now&&published>now-WINDOW_MS
    &&Number.isFinite(observed)&&observed<=now+300_000&&now-observed<COMPARISON_MAX_AGE_MS;
}

/** Public story ranking is independent of the legacy recall-first personal reader. */
export function rankEditorialCards(records:readonly EvidenceCard[],now:number,context:EditorialReaderContext={countryCode:null,preferredTopics:[]}):readonly RankedEditorialCard[] {
  if(!Number.isFinite(now)||records.length>5000)throw Error('EDITORIAL_INPUT_INVALID');
  validateEditorialContext(context);
  const views:RankedEditorialCard[]=[];
  for(const card of consistentCards(records.filter(record=>current(record,now)))){
    const existing=classifyEditorialCard(card),subject=existing===null&&!card.sourceIds.includes('news-unclassified')?classifyNewsHeadline(card.title,card.sourceUrl):null;
    const classification:EditorialClassification|null=existing??(subject===null?null:{category:subject,basis:'headline-subject'});
    const category=classification?.category;
    const headline=category===undefined?Object.freeze([]):editorialHeadlineSignals(card.title,category),geography=contextForCard(card);
    // This ID is attached only after the discovery pipeline matches the exact
    // article URL in the publisher's checked homepage. Title words cannot add it.
    const featured=(classification?.basis==='category-discovery'||card.sourceIds.includes('news-unclassified'))&&card.sourceIds.includes('editorial-frontpage');
    const signals:readonly EditorialSignal[]=Object.freeze(featured?['publisher-frontpage',...headline]:[...headline]);
    const basis=card.sourceIds.includes('news-unclassified')?'Source-checked news discovery without a category':classification?.basis==='category-discovery'?'Category-matched news discovery':'Reviewed publisher listing';
    const featuredReason=featured?'Featured on its publisher’s homepage at this source check. ':'';
    const relevance=editorialRelevance(card,context),development=developmentPriority(card,category,headline);
    const reason=featuredReason+`${category===undefined?'Other topics':EDITORIAL_CATEGORY_LABELS[category]} · ${basis} · ${geography.label}.`+(relevance.reasons.length?' '+relevance.reasons.join(' '):'');
    const editorialReason=development.reason+' '+featuredReason+(relevance.reasons.length?relevance.reasons.join(' ')+' ':'')+'Editorial ordering, not an audience or independent-verification score.';
    views.push(Object.freeze({...readingCard(card,now),reason,localMatch:relevance.country!==null,grouping:'single',...(category===undefined?{}:{category}),editorialReason,
      editorial:Object.freeze({classification:classification?.basis??'unclassified',signals,headlineSignals:headline,relatedListingsAreIndependentConfirmations:false,
        developmentPriority:development.priority,globalEssential:development.globalEssential,developmentReason:development.reason,relevance})}));
  }
  views.sort(order);
  const byId=new Map(views.map(view=>[view.card.id,view]));
  const groups=groupStories(views.map(view=>view.card),(a,b)=>{
    const left=byId.get(a.id),right=byId.get(b.id);
    if(left===undefined||right===undefined)throw Error('EDITORIAL_GROUP_MEMBER_MISSING');
    return order(left,right);
  });
  return Object.freeze(groups.map(group=>{
    const view=byId.get(group.card.id);
    if(view===undefined)throw Error('EDITORIAL_GROUP_MEMBER_MISSING');
    const reason=group.basis==='shared-event'?' Related coverage of the same identified story is grouped; reports may differ and are not independent confirmations.'
      :group.related.length?' Matching listings are grouped; they are not independent confirmations.':'';
    return Object.freeze({...view,storyKey:group.key,related:group.related,grouping:group.basis,editorialReason:view.editorialReason+reason});
  }).sort(order));
}
