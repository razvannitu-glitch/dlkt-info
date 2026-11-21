import type {EvidenceCard} from '../iceo/contracts.js';
import {PUBLIC_EDITORIAL_CATEGORIES,editorialCategory,classifyNewsHeadline,type PublicEditorialCategory} from '../iceo/editorial-categories.js';
import {rankEditorialCards,type EditorialReadingCard} from '../iceo/editorial-ranking.js';
import {validCity,type City} from '../local/contracts.js';
import {exploreGeography,type ExploreGeography} from './geography.js';

export interface ExploreContext {
  readonly city:City|null;
  readonly countryCode?:string|null;
  readonly category:PublicEditorialCategory|null;
  /** Bounded aliases returned with a canonical catalog city; no browser city dataset is needed. */
  readonly cityAliases?:readonly string[];
}
export interface ExploreReadingCard extends EditorialReadingCard {readonly explore:ExploreGeography}
export interface ExploreSelection {
  readonly cards:readonly ExploreReadingCard[];
  readonly local:readonly ExploreReadingCard[];
  readonly national:readonly ExploreReadingCard[];
  readonly world:readonly ExploreReadingCard[];
  /** Unique eligible publications, including grouped listings, before geographical/category filtering. */
  readonly eligibleCount:number;
  /** Number of displayed story groups; related listings retain their original renderer/actions. */
  readonly matchedCount:number;
}

/** Apply the existing public eligibility/conflict gates to the entire corpus, then explore it. */
export function selectExploreCards(records:readonly EvidenceCard[],context:ExploreContext,now:number):ExploreSelection {
  const code=context.countryCode?.toUpperCase()??null,aliases=context.cityAliases??[];
  if(context.city!==null&&!validCity(context.city)||code!==null&&!/^[A-Z]{2}$/u.test(code)
    ||context.category!==null&&!PUBLIC_EDITORIAL_CATEGORIES.includes(context.category)
    ||aliases.length>32||aliases.some(alias=>typeof alias!=='string'||alias.length<2||alias.length>200||/[\u0000-\u001f\u007f<>\p{Surrogate}]/u.test(alias)))throw Error('EXPLORE_CONTEXT_INVALID');
  if(context.city!==null&&code!==null&&context.city.countryCode!==code)throw Error('EXPLORE_CITY_COUNTRY_MISMATCH');
  const eligible=rankEditorialCards(records,now).flatMap(view=>[view.card,...view.related]);
  const groups:Record<ExploreGeography['scope'],EvidenceCard[]>={city:[],country:[],world:[]};
  const evidence=new Map<string,ExploreGeography>();
  for(const card of eligible){
    if(context.category!==null){
      // Use the same existing classification/fallback as public ranking, before grouping:
      // a differently classified representative must not hide a matching related listing.
      const category=editorialCategory(card)??(card.sourceIds.includes('news-unclassified')?null:classifyNewsHeadline(card.title,card.sourceUrl));
      if(category!==context.category)continue;
    }
    const geography=exploreGeography(card,context.city,code,aliases);
    if(geography!==null){groups[geography.scope].push(card);evidence.set(card.id,geography);}
  }
  // Group after geographical filtering so a matching related listing is never lost behind
  // a non-matching representative. National stories never become local/global filler.
  const views=(scope:ExploreGeography['scope']):readonly ExploreReadingCard[]=>Object.freeze(rankEditorialCards(groups[scope],now)
    .filter(view=>context.category===null||view.category===context.category)
    .map(view=>{
      const geography=evidence.get(view.card.id);
      if(geography===undefined)throw Error('EXPLORE_EVIDENCE_MISSING');
      return Object.freeze({...view,explore:geography});
    }));
  const local=views('city'),national=views('country'),world=views('world'),cards=Object.freeze([...local,...national,...world]);
  return Object.freeze({cards,local,national,world,eligibleCount:eligible.length,matchedCount:cards.length});
}
