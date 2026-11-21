import {NEWS_WINDOW_MS} from '../local/news-policy.js';
import {sourceRelevantToTopics} from '../iceo/source-relevance.js';
import type {IceoSnapshot} from '../iceo/contracts.js';
import type {MetadataChange} from '../iceo/comparison.js';
import type {LocalSnapshot} from '../local/contracts.js';
import {DAILY_TOPIC_FRESHNESS_MS,localDay,type DailyProfile} from './contracts.js';
import type {DailyItem,DailySelection} from './selection.js';

export interface DailyReadingPlan {
  readonly current: readonly DailyItem[];
  readonly previous: readonly DailyItem[];
  readonly summary: string;
}
/** Presentation only: older topics remain accessible, never declared read or irrelevant. */
export function planDailyReading(selection:DailySelection):DailyReadingPlan {
  const current=selection.items.filter(i=>i.local!==null||i.change!=='same');
  const previous=selection.items.filter(i=>i.local===null&&i.change==='same');
  const changed=selection.items.filter(i=>i.topic!==null&&i.change==='different').length;
  const added=selection.items.filter(i=>i.topic!==null&&i.change==='added').length;
  let summary='Your first selection. Save it to compare with your next edition.';
  if(selection.previousAt){
    const parts:string[]=[];
    if(changed)parts.push(`${changed} topic card${changed===1?' has':'s have'} changed since the previous source check.`);
    if(added)parts.push(`${added} topic card${added===1?' was':'s were'} not in the previous source check; check publication dates, as these may be older.`);
    if(previous.length)parts.push(`${previous.length} unchanged topic card${previous.length===1?' is':'s are'} available below.`);
    if(!parts.length)parts.push(selection.edition.topicState==='not-selected'?'Local information for the time periods shown.':'No additional topic cards in this selection.');
    if(!selection.edition.complete)parts.push('Some checks are incomplete. This is not confirmation that nothing changed.');
    summary=parts.join(' ');
  }else if(!selection.edition.complete){
    summary='This selection is incomplete. Available information is below; missing checks are not an all-clear.';
  }
  return{current,previous,summary};
}
/** Do not repeat lengthy legal titles or interpret the significance of a changed field. */
export function changeExplanation(change:MetadataChange):string {
  switch(change.field){
    case 'context':return 'Publisher coverage metadata changed. This describes the source coverage, not a new event or a personal impact.';
    case 'title':return 'The publisher title changed. The exact previous and current wording is in Source and details.';
    case 'deadline':return `Listed deadline: ${change.before??'not provided'} → ${change.after??'not provided'}. Check the original terms before acting.`;
    case 'version':return `Listed version: ${change.before??'not provided'} → ${change.after??'not provided'}.`;
    case 'date':return `Date listed by the source: ${change.before??'not provided'} → ${change.after??'not provided'}.`;
    case 'dateLabel':return 'The meaning of the listed date changed. Compare the labels in Source and details.';
    case 'summary':return 'The publisher excerpt changed. The exact previous and current wording is in Source and details.';
    case 'byline':return 'The source author or translation credits changed. Compare the exact credits in Source and details.';
    case 'licenseUrl':return 'The source license changed. Check the original source terms before reusing this content.';
    case 'publisher':return 'The listed publisher changed. See the previous and current publisher in Source and details.';
    case 'sourceUrl':return 'The source link changed. Both addresses remain in Source and details.';
  }
}
/** Find the next local calendar date without assuming all days last 24 hours. */
export function nextLocalDay(now:number,timezone:string):number {
  const day=localDay(now,timezone);
  let low=Math.floor(now),high=low+3_600_000;
  for(let h=1;localDay(high,timezone)===day&&h<48;h++)high+=3_600_000;
  if(localDay(high,timezone)===day)throw Error('DAILY_DATE_BOUNDARY_UNAVAILABLE');
  while(high-low>1){const middle=low+Math.floor((high-low)/2);if(localDay(middle,timezone)===day)low=middle;else high=middle;}
  return high;
}
/** Clock-only UI checks: this does not poll sources or schedule background monitoring. */
export function nextReadingBoundary(profile:DailyProfile,topic:IceoSnapshot|null,local:LocalSnapshot|null,now:number):number {
  const boundaries=[nextLocalDay(now,profile.timezone)];
  if(profile.topics.includes('opportunities'))boundaries.push(nextLocalDay(now,'Europe/Berlin'));
  for(const source of topic?.sources??[]){
    if(!sourceRelevantToTopics(source,profile.topics,topic?.cards??[])||source.verifiedAt===null)continue;
    const end=Date.parse(source.verifiedAt)+DAILY_TOPIC_FRESHNESS_MS+1;
    if(Number.isFinite(end)&&end>now)boundaries.push(end);
  }
  for(const card of local?.cards??[])for(const end of [Date.parse(card.validTo),...(card.news?[Date.parse(card.news.publishedAt)+NEWS_WINDOW_MS+1]:[])]){if(Number.isFinite(end)&&end>now)boundaries.push(end);}
  return Math.min(...boundaries);
}
