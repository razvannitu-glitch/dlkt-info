import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {validNewsPage,validNewsSourceScope,newsOriginalLanguage,NEWS_PAGE_VERSION} from '../.build/src/iceo/news-page-contracts.js';
import {NEWS_CATEGORIES,newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {newsDayWindow} from '../.build/src/iceo/news-day.js';
import {findCity} from '../.build/src/local/cities.js';
import {newsCard} from '../.build/src/local/service.js';
import {NOW,iso,article,local,hash} from './fixtures/news-corpus.mjs';
import {cardContent} from '../.build/src/iceo/card-validation.js';

const TIME=NOW+1000;
const global=(id,language='en',options={})=>{
 const card=article(id,{language,...options});
 if(language==='it'){
  const url='https://www.repubblica.it/politica/2026/11/22/news/national-fixture-425742775/';
  Object.assign(card,{sourceUrl:url,identity:url,id:hash(url).slice(0,24),publisher:'la Repubblica',title:'Il governo presenta la proposta al Parlamento',attribution:'Controlled Italian publisher fixture.'});
  card.contentHash=hash(cardContent(card));
 }
 return {kind:'global',card};
};
function pageFor(originals,{language='ro',sourceScope,city,period='recent'}={}){
 const items=originals.map(source=>({...source,key:(source.kind==='global'?'article:':'local:')+source.card.id,category:newsCategory(source.card)}));
 const counts=Object.fromEntries(['other',...NEWS_CATEGORIES.map(category=>category.id)].map(id=>[id,0]));
 for(const item of items)counts[item.category??'other']++;
 const localCount=items.filter(item=>item.kind==='local').length;
 return {version:NEWS_PAGE_VERSION,epoch:'1',revision:1,generatedAt:iso(NOW),startedAt:iso(TIME),expiresAt:iso(NOW+120000),
  language,...(sourceScope===undefined?{}:{sourceScope}),cityId:city?.id??null,countryCode:city?.countryCode??null,
  coverage:{national:0,local:localCount,international:items.length-localCount},period,day:period==='today'?newsDayWindow(TIME,city?.timezone??'UTC'):null,
  filter:'all',items,total:items.length,articleTotal:items.length,filteredTotal:items.length,counts,nextCursor:null};
}

test('all admits verified original languages while edition and legacy responses stay language-specific',()=>{
 const originals=['ro','en','ar','it'].map((language,index)=>global(100+index,language)),before=JSON.stringify(originals);
 const all=pageFor(originals,{sourceScope:'all'});assert.equal(validNewsPage(all,TIME),true);
 assert.equal(validNewsPage({...all,sourceScope:'edition'},TIME),false);
 const legacy={...all};delete legacy.sourceScope;assert.equal(validNewsPage(legacy,TIME),false);
 assert.equal(validNewsPage(pageFor([originals[0]]),TIME),true);
 assert.equal(validNewsPage(pageFor([originals[0]],{sourceScope:'edition'}),TIME),true);
 assert.deepEqual(originals.map(newsOriginalLanguage),['ro','en','ar','it']);
 assert.equal(JSON.stringify(originals),before,'source scope never translates or rewrites source evidence');
 for(const value of ['all','edition'])assert.equal(validNewsSourceScope(value),true);
 for(const value of ['',null,'ALL',false,'ro',{}]){
  assert.equal(validNewsSourceScope(value),false);assert.equal(validNewsPage({...all,sourceScope:value},TIME),false);
 }
 assert.equal(validNewsPage({...all,privateField:'unexpected'},TIME),false);
});

test('all preserves the original publication day, source-check deadline and local city authority',()=>{
 const yesterday=global(200,'en',{published:NOW-13*3600000});
 assert.equal(validNewsPage(pageFor([yesterday],{sourceScope:'all'}),TIME),true);
 assert.equal(validNewsPage(pageFor([yesterday],{sourceScope:'all',period:'today'}),TIME),false);
 const stale=global(201,'en',{observed:NOW-2*3600000});
 assert.equal(validNewsPage(pageFor([stale],{sourceScope:'all'}),TIME),false);
 const parsed=local(1),source={kind:'local',card:newsCard(parsed.snapshot.articles[0],parsed.city)};
 const all=pageFor([source],{language:'en',sourceScope:'all',city:parsed.city});
 assert.equal(newsOriginalLanguage(source),'ro');
 assert.equal(validNewsPage(all,TIME,parsed.city),true);
 assert.equal(validNewsPage({...all,sourceScope:'edition'},TIME,parsed.city),false);
 assert.equal(validNewsPage(all,TIME),false);
 assert.equal(validNewsPage(all,TIME,findCity('3165524')),false);
});

test('the real home source control starts all, preserves the chosen interface language and English selects an edition',()=>{
 const source=readFileSync('.build/src/iceo/browser.js','utf8'),html=readFileSync('public/iceo.html','utf8');
 assert.match(source,/let newsSourceScope = 'all';/u);
 assert.match(html,/id="home-news-source-scope"[^>]*class="text-button"/u);
 const copyStart=source.indexOf('const allSourcesLabel ='),copyEnd=source.indexOf("required('#home-location').textContent",copyStart);
 const labelsStart=source.indexOf("required('#home-news-language-label').textContent"),labelsEnd=source.indexOf("const periodPicker = required('#home-news-period');",labelsStart);
 const handlers=source.split('\n').filter(line=>/^required\('#home-news-(?:source-scope|english)'\)\.addEventListener\('click'/u.test(line)).join('\n');
 assert.ok(copyStart>=0&&copyEnd>copyStart&&labelsStart>=0&&labelsEnd>labelsStart&&handlers.split('\n').length===2);
 const nodes=new Map(),listeners=new Map();let renders=0;
 const context={language:'ro',newsSourceScope:'all',newsFilter:'07000000',newsPeriod:'today',Event,
  languageLabel:language=>({ro:'romana',en:'English',it:'italiano'})[language]??language,
  required(selector){
   if(!nodes.has(selector))nodes.set(selector,{dataset:{},attributes:{},textContent:'',hidden:false,
    setAttribute(name,value){this.attributes[name]=value;},addEventListener(event,callback){listeners.set(selector+':'+event,callback);},
    dispatchEvent(event){if(selector==='#reader-language'&&event.type==='change')context.language=this.value;},
    focus(){this.focused=true;}});
   return nodes.get(selector);
  }};
 const labels='(function(){'+source.slice(copyStart,copyEnd)+source.slice(labelsStart,labelsEnd)+'})()';
 context.renderDiscovery=()=>{renders++;runInNewContext(labels,context);};
 runInNewContext(handlers,context);context.renderDiscovery();
 assert.equal(nodes.get('#home-news-language-label').textContent,'Toate sursele · limbi originale');
 assert.equal(nodes.get('#home-news-source-scope').textContent,'Inapoi la romana');assert.equal(nodes.get('#home-news-english').hidden,false);
 listeners.get('#home-news-source-scope:click')();
 assert.equal(context.newsSourceScope,'edition');assert.equal(context.language,'ro');
 assert.equal(nodes.get('#home-news-language-label').textContent,'romana');assert.equal(nodes.get('#home-news-source-scope').textContent,'Toate sursele');
 listeners.get('#home-news-source-scope:click')();assert.equal(context.newsSourceScope,'all');
 listeners.get('#home-news-english:click')();assert.equal(context.newsSourceScope,'edition');assert.equal(context.language,'en');
 assert.equal(nodes.get('#home-news-language-label').textContent,'English');assert.equal(nodes.get('#home-news-english').hidden,true);
 listeners.get('#home-news-source-scope:click')();assert.equal(context.newsSourceScope,'all');assert.equal(context.language,'en');assert.equal(nodes.get('#home-news-english').hidden,false);
 const before=renders;listeners.get('#home-news-english:click')();
 assert.equal(context.newsSourceScope,'edition');assert.equal(context.language,'en');assert.equal(renders,before+1,'English still changes scope when the interface is already English');
 assert.equal(context.newsFilter,'07000000');assert.equal(context.newsPeriod,'today');
});
