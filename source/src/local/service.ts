import {localNewsService,type LocalNewsService} from './news-service.js';
import {validLocalNewsArticle,type LocalNewsArticle} from './news-policy.js';
import {CityPlacesService} from './places.js';
import {localEventEligible,type City,type LocalSnapshot,type LocalCard} from './contracts.js';
import {LocalSourceCache} from './source-cache.js';
import {weatherCard,weatherUrl} from './weather.js';
import {transportCards,TFL_URL} from './transport.js';
import {localPublicationService,type LocalPublicationService} from './publications.js';
/** Publisher text is retained separately from DLKT's scope and next-action wording. */
export function newsCard(news:LocalNewsArticle,city:City):LocalCard {
 return {id:news.id,kind:'local-news',title:news.title,text:news.summary??'Read the publisher report for the complete details.',publisher:news.publisher,
  sourceUrl:news.url,sourceUpdatedAt:null,checkedAt:news.checkedAt,validFrom:news.checkedAt,validTo:news.validUntil,facts:[],
  boundary:'Publisher reporting with an explicit reference to this city. Publication time does not establish when the reported event happened; claims remain attributed to the publisher.',news,
  context:{section:'context',place:city.name,when:'Published '+news.publishedAt,why:'The publisher headline or excerpt contains an explicit reference to this city. This is not a measured distance from you.',
   action:'Open the complete publisher report for the facts, context and any subsequent correction.',sourceDate:news.publishedAt.slice(0,10),startsAt:null,status:'publisher-announcement',documentHash:news.documentHash,documentUrl:news.documentUrl}};
}
export class LocalBriefingService{
 constructor(private readonly weather=new LocalSourceCache(),private readonly transport=new LocalSourceCache(),private readonly clock:()=>number=Date.now,private readonly publications:Pick<LocalPublicationService,'snapshot'>=localPublicationService,private readonly places:Pick<CityPlacesService,'snapshot'>|null=null,private readonly news:Pick<LocalNewsService,'snapshot'>|null=null){}
 async snapshot(city:City):Promise<LocalSnapshot>{
  const now=this.clock();const weather=this.weather.read(weatherUrl(city),120000).then(d=>weatherCard(d.value,city,d.checkedAt,now));
  const transit=city.id==='2643743'?this.transport.read(TFL_URL,60000).then(d=>{if(now-Date.parse(d.checkedAt)>120000)throw Error('TRANSPORT_OLD');return transportCards(d.value,d.checkedAt,now);}):Promise.resolve(null);
  const publication=await Promise.allSettled([weather,transit,this.publications.snapshot(city),this.places?.snapshot(city)??Promise.resolve(null),this.news?.snapshot(city)??Promise.resolve(null)]);const w=publication[0],t=publication[1],p=publication[2];const cards:LocalCard[]=[];
  if(w.status==='fulfilled')cards.push(w.value as LocalCard);if(t.status==='fulfilled'&&Array.isArray(t.value))cards.push(...t.value);
  if(p.status==='fulfilled')cards.push(...p.value.cards);
  const newsResult=publication[4],newsSnapshot=newsResult?.status==='fulfilled'?newsResult.value:null;
  if(newsSnapshot)cards.push(...newsSnapshot.articles.map(article=>newsCard(article,city)));
  const completed=this.clock();const current=cards.filter(c=>Date.parse(c.validTo)>completed&&localEventEligible(c,completed)&&(c.kind!=='local-news'||validLocalNewsArticle(c.news,city,completed)));cards.splice(0,cards.length,...current);
  const newsSources=newsSnapshot?.sources.map(source=>{if(source.state==='unavailable')return source;const count=cards.filter(card=>card.news?.sourceId===source.sourceId).length,rejected=Math.min(200,source.rejected+Math.max(0,source.count-count));return{...source,count,rejected,state:rejected?'partial' as const:'ready' as const};});
  const weatherState=w.status==='fulfilled'&&cards.some(c=>c.kind==='forecast')?'ready':'unavailable';const transportState=city.id!=='2643743'?'not-covered':t.status==='fulfilled'&&cards.some(c=>c.kind==='transport')?'ready':'unavailable';
  const placeResult=publication[3];const places=placeResult?.status==='fulfilled'&&placeResult.value?placeResult.value:undefined;
  const coverage=p.status==='fulfilled'&&p.value.coverage.length?p.value.coverage:undefined;
  const incomplete=p.status==='rejected'||newsResult?.status==='rejected'||newsSources?.some(source=>source.state!=='ready')||coverage?.some(c=>c.state==='unavailable'||c.state==='partial');
  cards.sort((a,b)=>(a.context?.section==='essential'?0:a.kind==='forecast'||a.kind==='transport'?1:a.context?.section==='discover'?2:3)-(b.context?.section==='essential'?0:b.kind==='forecast'||b.kind==='transport'?1:b.context?.section==='discover'?2:3));
  return{version:'dlkt-local-1',city,checkedAt:new Date(completed).toISOString(),state:!cards.length&&!places?.items.length?'unavailable':weatherState==='unavailable'||places?.state==='unavailable'||transportState==='unavailable'||incomplete?'partial':'ready',weatherState,transportState,cards,...(places?{places}:{}),...(coverage?{coverage}:{}),...(newsSources?{newsSources}:{})};
 }
}
export const localBriefingService=new LocalBriefingService(undefined,undefined,Date.now,localPublicationService,new CityPlacesService(new LocalSourceCache()),localNewsService);
