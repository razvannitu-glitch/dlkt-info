import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {ICEO_SOURCES} from '../../.build/src/iceo/registry.js';
import {publicSnapshotDigest} from '../../.build/src/iceo/refresh-ledger.js';
import {buildNewsCorpus} from '../../.build/src/iceo/news-corpus.js';
import {findCity} from '../../.build/src/local/cities.js';
import {parseLocalNews} from '../../.build/src/local/news-service.js';
import {CITY_NEWS_FEEDS} from '../../.build/src/local/news-policy.js';
export const NOW=Date.parse('2026-11-22T12:00:00.000Z');
export const iso=value=>new Date(value).toISOString();
export const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const CATEGORIES=Object.freeze({
 '01000000':'Concert opens a cultural festival','02000000':'Court rules in criminal trial','03000000':'Earthquake damages coastal town',
 '04000000':'Inflation report records price changes','05000000':'Students receive scholarships','06000000':'Wildlife conservation project begins',
 '07000000':'Vaccines reach hospitals','08000000':'Hollywood celebrity announces wedding','09000000':'Workers strike over employment contract',
 '10000000':'Gardening guide for a new season','11000000':'Parliament debates proposal','12000000':'Pope begins pilgrimage',
 '13000000':'Quantum computing research result','14000000':'Human rights monitor releases report','15000000':'Football team wins championship',
 '16000000':'Ceasefire negotiations resume','17000000':'Weather forecast predicts temperatures',other:'A publication about an unspecified subject'});
export function article(id,{now=NOW,language='en',category='13000000',boundary='Controlled source fixture.',observed=now,published=now-10000}={}){
 const url='https://www.dw.com/'+language+'/controlled-publication-'+id+'/a-'+(12500000+id);
 const card={id:hash(url).slice(0,24),identity:url,title:CATEGORIES[category]+' '+id,topic:'other',kind:'publication',
  sourceUrl:url,publisher:'DW',sourceIds:['news-unclassified'],date:iso(published),dateLabel:'Published',observedAt:iso(observed),contentHash:'',
  boundary,deadline:null,version:null,attribution:'Source: DW. Open the original publication.',sourceState:'verified'};
 card.contentHash=hash(cardContent(card));return card;
}
export function snapshot(cards,now=NOW){
 const definitions=ICEO_SOURCES.filter(source=>cards.some(card=>card.sourceIds.includes(source.id)));
 if(!definitions.length)definitions.push(ICEO_SOURCES.find(source=>source.id==='news-unclassified'));
 return {version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'corpus-test',mode:'current-source-records',generatedAt:iso(now),
  state:'partial',cards,sources:definitions.map(source=>({id:source.id,label:source.label,publisher:source.publisher,topic:source.topic,state:'verified',
   checkedAt:iso(now),verifiedAt:iso(now),count:cards.filter(card=>card.sourceIds.includes(source.id)).length,rejected:0,error:null,retryAt:null,
   scope:source.scope,termsUrl:source.termsUrl,windowed:true})),conflictCount:0,duplicateCount:0,
  deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:[...new Set(cards.map(card=>card.topic))]};
}
export function local(count=6,{now=NOW,published=now-10000}={}){
 const city=findCity('683506'),source=CITY_NEWS_FEEDS[0];
 const entries=Array.from({length:count},(_,id)=>'<item><title>Bucuresti: Metrorex publica programul liniei '+id+'</title><link>https://b365.ro/program-control-'+(123450+id)+'/</link><pubDate>'+new Date(published).toUTCString()+'</pubDate></item>').join('');
 const body='<rss version="2.0"><channel><title>'+source.title+'</title><link>'+source.home+'</link>'+entries+'</channel></rss>';
 const result=parseLocalNews(body,source.id,city,iso(now),now,{full:true});assert.equal(result.articles.length,count);
 return {city,snapshot:{articles:result.articles,sources:CITY_NEWS_FEEDS.map(feed=>({sourceId:feed.id,publisher:feed.publisher,feedUrl:feed.endpoint,termsUrl:feed.termsUrl,
  state:'ready',checkedAt:iso(now),count:feed.id===source.id?count:0,rejected:0,error:null}))}};
}
export function epoch(cards,locals=[],{now=NOW,id='1',revision=1}={}){
 const corpus=buildNewsCorpus(snapshot(cards,now),locals,now);
 return {version:'dlkt-news-epoch-1',epoch:id,revision,generatedAt:iso(now),publishedAt:iso(now),expiresAt:iso(now+3600000),digest:publicSnapshotDigest(corpus),corpus};
}
export class CorpusMemoryStore {
 constructor(epochs){this.epochs=new Map(epochs.map(value=>[value.epoch,value]));this.latest=epochs.at(-1)?.epoch;this.reads=[];}
 async read(id){this.reads.push(id??null);return this.epochs.get(id??this.latest)??null;}
 async stage(){throw Error('Public page must not stage or collect');}
 async lookup(){throw Error('Unexpected lookup');}
}
