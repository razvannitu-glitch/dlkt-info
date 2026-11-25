import {CITY_NEWS_FEEDS,validLocalNewsArticle,NEWS_WINDOW_MS} from '../local/news-policy.js';
import {currentLocalSnapshot,validCity,object,stamp,localEventEligible,type City,type LocalCard,type LocalSnapshot} from '../local/contracts.js';

import {newsLanguageMatches} from './news-sources.js';

export interface HomeLocalSelection {
  readonly cards:readonly LocalCard[];
  readonly expiresAt:number|null;
}

const kindOrder:Readonly<Record<LocalCard['kind'],number>>={'utility-notice':0,'transport-notice':1,transport:2,forecast:3,event:4,'municipal-news':5,'local-news':6};

/** Distinct source articles remain distinct even when their headlines match. */
function sameStory(a:LocalCard,b:LocalCard):boolean {
 return a.sourceUrl===b.sourceUrl||a.id===b.id;
}
function newsOrder(card:LocalCard,now:number):number {
 if(!card.news)return Number.POSITIVE_INFINITY;
 const age=now-Date.parse(card.news.publishedAt),freshness=age<86400000?0:age<172800000?1:2;
 const practical=card.news.topic==='safety'?0:['transport','education','utilities','environment'].includes(card.news.topic)?1:['city','economy'].includes(card.news.topic)?2:3;
 return freshness*10+practical;
}
/** Source breadth and topic breadth follow freshness; this is a reading policy, not a calibrated impact score. */
function selectNews(cards:readonly LocalCard[],now:number):LocalCard[]{
 const pool=[...cards].sort((a,b)=>newsOrder(a,now)-newsOrder(b,now)||Date.parse(b.news?.publishedAt??'')-Date.parse(a.news?.publishedAt??'')||a.id.localeCompare(b.id));
 const selected:LocalCard[]=[],publishers=new Map<string,number>(),topics=new Map<string,number>();
 while(selected.length<pool.length){
  const available=pool.filter(card=>card.news&&!selected.includes(card)&&!selected.some(previous=>sameStory(previous,card)));
  if(!available.length)break;
  available.sort((a,b)=>Math.floor(newsOrder(a,now)/10)-Math.floor(newsOrder(b,now)/10)
   ||(publishers.get(a.publisher)??0)-(publishers.get(b.publisher)??0)
   ||(topics.get(a.news?.topic??'')??0)-(topics.get(b.news?.topic??'')??0)
   ||newsOrder(a,now)-newsOrder(b,now)||Date.parse(b.news?.publishedAt??'')-Date.parse(a.news?.publishedAt??'')||a.id.localeCompare(b.id));
  const next=available[0];if(!next?.news)break;selected.push(next);publishers.set(next.publisher,(publishers.get(next.publisher)??0)+1);topics.set(next.news.topic,(topics.get(next.news.topic)??0)+1);
 }
 return selected;
}
/** One city overview retains the exact operator document and source-check interval; it does not infer a user's sector. */
function operationalCards(cards:readonly LocalCard[],city:City):LocalCard[]{
 const cmteb=cards.filter(card=>card.kind==='utility-notice'&&/^bucharest:cmteb:sector-[1-6]$/u.test(card.id));
 if(city.id!=='683506'||cmteb.length<2)return [...cards];
 const first=cmteb[0];if(!first?.context||cmteb.some(card=>card.checkedAt!==first.checkedAt||card.context?.documentHash!==first.context?.documentHash))return [...cards];
 const sectors=cmteb.map(card=>card.id.slice(-1)).sort().join(', ');
 const text='CMTEB lists heating or hot-water service notices for sectors '+sectors+'. Check the official operator list for your street, the affected service and estimated restoration time.';
 const overview:LocalCard={...first,id:'bucharest:cmteb:overview',title:'Heating and hot-water updates in '+city.name,text,
  validTo:new Date(Math.min(...cmteb.map(card=>Date.parse(card.validTo)))).toISOString(),facts:cmteb.map(card=>card.title),
  boundary:'A city overview derived from the checked CMTEB sector records. It does not establish that your building is affected. Restoration times in the operator list are estimates.',
  context:{...first.context,place:city.name+' · sectors '+sectors,when:'Current operator list checked for '+cmteb.length+' sectors; exact areas and estimated times are at the source.',
   why:'The same checked operator document contains service notices in several sectors of this city.',action:'Check your street and building in the official operator list.'}};
 return [overview,...cards.filter(card=>!cmteb.includes(card))];
}

export type LocalCandidateSelection =
  | {readonly state:'current';readonly city:City;readonly snapshot:LocalSnapshot;readonly cards:readonly LocalCard[];readonly checkedAt:string}
  | {readonly state:'unavailable'|'invalid'|'stale';readonly city:null;readonly snapshot:null;readonly cards:readonly LocalCard[];readonly checkedAt:null};

/** Complete accepted source records before any homepage grouping or display cap.
 * Acquisition limits remain those of the connected sources. An empty valid
 * snapshot remains distinguishable from an absent, invalid or expired check. */
export function selectLocalCandidates(snapshot:unknown,city:City|null,now:number):LocalCandidateSelection {
  const failed=(state:'unavailable'|'invalid'|'stale'):LocalCandidateSelection=>
    Object.freeze({state,city:null,snapshot:null,cards:Object.freeze([]),checkedAt:null});
  if(!Number.isFinite(now)||!validCity(city))return failed('invalid');
  if(snapshot===null||snapshot===undefined)return failed('unavailable');
  if(!object(snapshot)||!stamp(snapshot.checkedAt))return failed('invalid');
  const checked=Date.parse(snapshot.checkedAt);
  if(checked>now+5000)return failed('invalid');
  if(now-checked>=300000)return failed('stale');
  // Validate at the original check, then expire each source record separately.
  if(!currentLocalSnapshot(snapshot,city,checked))return failed('invalid');
  const cards=snapshot.cards.filter(card=>Date.parse(card.validTo)>now&&localEventEligible(card,now)
    &&(card.kind!=='local-news'||validLocalNewsArticle(card.news,city,now)));
  return Object.freeze({state:'current',city,snapshot,cards:Object.freeze(cards),checkedAt:snapshot.checkedAt});
}

/** Earliest actual validity boundary for the chosen records and their source check. */
export function localCandidateExpiry(cards:readonly LocalCard[],checked:number,now:number):number {
  const expiries=[checked+300000,...cards.flatMap(card=>[Date.parse(card.validTo),
    ...(card.news?[Date.parse(card.news.publishedAt)+NEWS_WINDOW_MS+1]:[]),
    ...(card.context?.startsAt?[Date.parse(card.context.endsAt??card.context.startsAt)]:[])])]
    .filter(time=>time>now);
  return Math.min(...expiries);
}

/** Shared stable ordering only; no truncation, grouping or inferred personal impact. */
export function orderLocalCandidates(cards:readonly LocalCard[]):readonly LocalCard[] {
  return cards.map((card,index)=>({card,index})).sort((left,right)=>{
    const kind=kindOrder[left.card.kind]-kindOrder[right.card.kind];
    if(kind)return kind;
    if(left.card.kind==='event'){
      const leftVenue=left.card.context?.place==='Venue not specified in the agenda'?1:0,rightVenue=right.card.context?.place==='Venue not specified in the agenda'?1:0;
      if(leftVenue!==rightVenue)return leftVenue-rightVenue;
      // A verified start takes precedence. An undated publisher listing stays undated.
      const leftStart=left.card.context?.startsAt,rightStart=right.card.context?.startsAt;
      if(leftStart&&rightStart)return Date.parse(leftStart)-Date.parse(rightStart)||left.index-right.index;
      if(leftStart)return-1;
      if(rightStart)return 1;
    }
    if(left.card.kind==='municipal-news'){
      const leftDate=left.card.context?.sourceDate,rightDate=right.card.context?.sourceDate;
      if(leftDate&&rightDate)return rightDate.localeCompare(leftDate)||left.index-right.index;
    }
    return left.index-right.index;
  }).map(item=>item.card);
}

/** Actual local information only: map references and source directories never become edition cards. */
export function selectHomeLocal(snapshot:unknown,city:City|null,now:number):HomeLocalSelection {
  const candidates=selectLocalCandidates(snapshot,city,now);
  if(candidates.state!=='current')return{cards:[],expiresAt:null};
  const checked=Date.parse(candidates.checkedAt);
  const eligible=operationalCards(candidates.cards,candidates.city);
  const news=selectNews(eligible.filter(card=>card.kind==='local-news'),now);
  const supporting=eligible.filter(card=>card.kind!=='local-news');
  const ordered=orderLocalCandidates(supporting).map((card,index)=>({card,index}));
  const kinds=new Set<LocalCard['kind']>(),cards:LocalCard[]=[];
  for(const {card} of ordered){
    if(kinds.has(card.kind))continue;
    cards.push(card);kinds.add(card.kind);
    if(cards.length===12)break;
  }
  // Preserve the homepage's existing kind diversity and display limits.
  while(cards.length<Math.min(12,ordered.length)){
    const before=cards.length;
    for(const kind of kinds){if(news.length&&cards.filter(card=>card.kind===kind).length>=2)continue;const next=ordered.find(item=>item.card.kind===kind&&!cards.includes(item.card));if(next)cards.push(next.card);if(cards.length===12)break;}
    if(cards.length===before)break;
  }
  const all=[...news,...cards];
  if(!all.length)return{cards:[],expiresAt:null};
  return{cards:all,expiresAt:localCandidateExpiry(all,checked,now)};
}

export interface HomeLanguageSelection extends HomeLocalSelection {
  readonly topNews:readonly LocalCard[];
  readonly supporting:readonly LocalCard[];
}
/** Reuse checked city records. A publication aged24–72h stays local, outside the24h top. */
export function selectHomeLanguage(snapshot:unknown,city:City|null,now:number,language:string):HomeLanguageSelection {
  const selected=selectHomeLocal(snapshot,city,now);
  const cards=selected.cards.filter(card=>{
    if(card.kind!=='local-news')return true;
    const feed=CITY_NEWS_FEEDS.find(value=>value.id===card.news?.sourceId);
    return feed!==undefined&&newsLanguageMatches(feed.language,language);
  });
  const topNews=cards.filter(card=>card.kind==='local-news'&&card.news!==undefined
    &&Date.parse(card.news.publishedAt)<=now&&Date.parse(card.news.publishedAt)>now-86_400_000);
  const supporting=cards.filter(card=>card.kind!=='local-news');
  const boundaries=[...(selected.expiresAt===null?[]:[selected.expiresAt]),...topNews.map(card=>Date.parse(card.news!.publishedAt)+86_400_000+1)].filter(time=>time>now);
  return Object.freeze({cards:Object.freeze(cards),topNews:Object.freeze(topNews),supporting:Object.freeze(supporting),expiresAt:boundaries.length?Math.min(...boundaries):null});
}
