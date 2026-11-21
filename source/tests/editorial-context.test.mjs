import test from 'node:test';
import assert from 'node:assert/strict';
import {rankEditorialCards} from '../.build/src/iceo/editorial-ranking.js';
import {editorialRelevance} from '../.build/src/iceo/editorial-relevance.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
const now=Date.parse('2026-11-21T12:00:00Z');
const context=(countryCode=null,preferredTopics=[],city)=>({countryCode,preferredTopics,...(city?{city}:{})});
const city=(name,countryCode,id='683506')=>({id,name,countryCode,confirmed:true});
const card=(id,category='world',patch={})=>({
 id:id.toString(16).padStart(24,'0'),identity:`fixture:${id}`,title:`Reported development ${id}`,topic:EDITORIAL_CATEGORY_TOPICS[category],kind:'publication',
 sourceUrl:`https://publisher.example/${category}/${id}`,publisher:`Publisher ${id}`,sourceIds:[`news-${category}`],
 date:'2026-11-21T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),contentHash:id.toString(16).padStart(64,'0'),
 boundary:'Controlled ranking fixture; not a real current event.',deadline:null,version:null,attribution:'Controlled source',sourceState:'verified',...patch,
});

test('material events outrank homepage how-to and listicle content despite explicit interest',()=>{
 const investigation=card(1,'technology',{title:'Regulator investigates chip exports after new evidence'});
 const howto=card(2,'travel',{title:'How to plan the best holiday in Romania',sourceIds:['news-travel','editorial-frontpage']});
 const listicle=card(3,'travel',{title:'10 best ways to enjoy a city break',sourceIds:['news-travel','editorial-frontpage']});
 const result=rankEditorialCards([howto,listicle,investigation],now,context('RO',['travel']));
 assert.equal(result[0].card.id,investigation.id);assert.equal(result[0].editorial.developmentPriority,2);
 assert.ok(result.slice(1).every(view=>view.editorial.developmentPriority===0));
});

test('real publisher country categories affect ranking; publisher country scope does not',()=>{
 const ro=card(1,'world',{sourceIds:['gv-world'],context:contextFromPublisherCategories('gv-world',['Romania'])});
 const gb=card(2,'world',{sourceIds:['gv-world'],context:contextFromPublisherCategories('gv-world',['United Kingdom'])});
 assert.equal(rankEditorialCards([gb,ro],now,context('RO'))[0].card,ro);
 assert.equal(rankEditorialCards([gb,ro],now,context('GB'))[0].card,gb);
 const institution=card(3,'health',{sourceIds:['fda-news'],publisher:'U.S. Food and Drug Administration'});
 assert.equal(editorialRelevance(institution,context('US')).country,null);
 assert.equal(editorialRelevance({...institution,context:ro.context},context('RO')).country,null,'a country category cannot be transplanted onto an unrelated source');
});

test('headline country matches are explicit wording signals, not proven geographic effects',()=>{
 const romanian=card(1,'business',{title:'Romania reports its quarterly economic figures'});
 const relevance=editorialRelevance(romanian,context('RO'));
 assert.equal(relevance.country,'headline-mention');assert.match(relevance.reasons.join(' '),/not proof of the event location/);
 assert.equal(editorialRelevance(card(2,'world',{title:'A programme helps us learn about public affairs'}),context('US')).country,null);
 assert.equal(editorialRelevance(card(3,'world',{title:'Jordan wins the tournament final'}),context('JO')).country,null);
 assert.equal(editorialRelevance(card(4,'world',{title:'Georgia schools announce an update'}),context('GE')).country,null);
 assert.equal(editorialRelevance(card(5,'world',{title:'USA officials report an update'}),context('US')).country,'headline-mention');
});

test('confirmed city overrides an estimated country and requires matching country context',()=>{
 const ro=card(1,'housing',{title:'Housing plans in Bucharest, Romania, enter public consultation'});
 const uk=card(2,'housing',{title:'Housing plans in the United Kingdom enter public consultation'});
 const selected=context('GB',[],city('Bucharest','RO'));
 const result=rankEditorialCards([uk,ro],now,selected);
 assert.equal(result[0].card,ro);assert.equal(result[0].editorial.relevance.cityMention,true);
 assert.equal(result.find(view=>view.card===uk).editorial.relevance.country,null);
 assert.match(result[0].reason,/confirmed city.*not verified event-location evidence/);
 const noCountry=card(3,'housing',{title:'Housing plans in Bucharest enter public consultation'});
 assert.equal(editorialRelevance(noCountry,selected).cityMention,false,'a city string alone is not enough to disambiguate its country');
});

test('ambiguous city names, substrings and people do not create geographic personalization',()=>{
 const reading=context('GB',[],city('Reading','GB','2639577'));
 assert.equal(editorialRelevance(card(1,'education',{title:'Reading books helps children across UK classrooms'}),reading).cityMention,false);
 assert.equal(editorialRelevance(card(2,'public-affairs',{title:'Reading council publishes transport plans in the UK'}),reading).cityMention,true);
 const paris=context('FR',[],city('Paris','FR','2988507'));
 assert.equal(editorialRelevance(card(3,'culture',{title:'Paris Hilton discusses a new film in France'}),paris).cityMention,false);
 assert.equal(editorialRelevance(card(4,'housing',{title:'Housing projects in Parisian suburbs across France'}),paris).cityMention,false);
 assert.equal(editorialRelevance(card(5,'housing',{title:'Housing projects in Paris, France, open for consultation'}),paris).cityMention,true);
 const nice=context('FR',[],city('Nice','FR','2990440'));
 assert.equal(editorialRelevance(card(6,'travel',{title:'Tourists stay in nice hotels throughout France'}),nice).cityMention,false);
 assert.throws(()=>rankEditorialCards([],now,{...reading,city:{...reading.city,confirmed:false}}),/DAILY_EDITION_CONTEXT_INVALID/);
});

test('only explicitly provided interests affect relevance; cards and source context stay immutable',()=>{
 const health=card(1,'health',{title:'A health agency publishes a public bulletin'}),politics=card(2,'public-affairs',{title:'A government publishes a public bulletin'});
 const before=JSON.stringify([health,politics]);
 assert.equal(editorialRelevance(health,context('RO')).explicitInterest,false);
 assert.equal(editorialRelevance(politics,context('RO')).explicitInterest,false);
 assert.equal(rankEditorialCards([politics,health],now,context(null,['health']))[0].card,health);
 assert.equal(rankEditorialCards([politics,health],now,context(null,['public-affairs']))[0].card,politics);
 assert.equal(JSON.stringify([health,politics]),before);
 assert.throws(()=>rankEditorialCards([],now,context(null,['health','health'])),/DAILY_EDITION_CONTEXT_INVALID/);
});

test('global essentials remain ahead of personal preferences and can exceed ordinary category and publisher caps',()=>{
 const essentials=[
  card(1,'world',{publisher:'Shared publisher',title:'Countries sign a ceasefire agreement after negotiations'}),
  card(2,'world',{publisher:'Shared publisher',title:'A separate peace deal takes effect after an overnight vote'}),
  card(3,'world',{publisher:'Shared publisher',title:'Army launches an invasion across the neighbouring border'}),
  card(4,'world',{publisher:'Shared publisher',title:'Negotiators announce a peace agreement ending border conflict'}),
  card(5,'world',{publisher:'Shared publisher',title:'Another ceasefire collapses after fresh border clashes'}),
 ];
 const preferred=card(10,'culture',{title:'Romania announces a new cultural programme',sourceIds:['news-culture','editorial-frontpage']});
 const result=selectContextualToday([preferred,...essentials],context('RO',['culture']),now);
 assert.equal(result.first.length,6);assert.ok(result.first.slice(0,5).every(view=>view.editorial.globalEssential));
 assert.ok(result.first.slice(0,5).every(view=>/Global-essential editorial priority/.test(view.editorialReason)));
 assert.ok(result.first.some(view=>view.card.id===preferred.id));
 assert.equal(result.daily.belowMinimum,true,'no additional cards are invented to meet a count');
});

test('war words, forecasts, denials, retrospectives and opinion do not fabricate essential events',()=>{
 for(const title of ['War and diplomacy feature in a new book','A ceasefire could take effect tomorrow','Countries did not sign a ceasefire agreement','No ceasefire agreement reached after talks','In 1945 an army invades a neighbouring country','Opinion: countries sign a ceasefire agreement','The anniversary of a peace deal takes effect in public memory']){
  const view=rankEditorialCards([card(1,'world',{title})],now)[0];assert.equal(view.editorial.globalEssential,false,title);
 }
 for(const [category,title] of [['health','False claim that WHO declares global pandemic spreads online'],['weather','Severe floods kill nobody after timely evacuation'],['world','A peace deal signed decades ago is disputed by historians']]){
  const view=rankEditorialCards([card(1,category,{title})],now)[0];assert.equal(view.editorial.globalEssential,false,title);
 }
});

test('importance, then context, determines final display rather than fixed category rounds',()=>{
 const routine=PUBLIC_EDITORIAL_CATEGORIES.map((category,index)=>card(100+index,category));
 const material=card(1,'technology',{title:'Regulator investigates a new technology export scheme'});
 const local=card(2,'housing',{title:'New housing plans in Bucharest, Romania, enter consultation'});
 const result=selectContextualToday([...routine,local,material],context('RO',[],city('Bucharest','RO')),now);
 assert.equal(result.first[0].card,material);assert.equal(result.first[1].card,local);
 assert.equal(result.daily.selectedCategories.length,20);
});

test('critical volume uses a bounded top plus accessible overflow; stale/future records remain excluded',()=>{
 const records=Array.from({length:45},(_,index)=>card(index+1,'world',{title:`Countries sign a ceasefire agreement for distinct region ${index}`}));
 const result=selectContextualToday(records,{...context(),limit:40},now);assert.equal(result.first.length,40);
 assert.equal(new Set(result.first.map(view=>view.card.id)).size,40);assert.equal(result.more.length,5);
 assert.equal(new Set([...result.first,...result.more].map(view=>view.card.id)).size,45);assert.equal(result.daily.completeCoverage,false);
 const expired={...records[0],observedAt:new Date(now-3_600_000).toISOString()};
 const future={...records[1],date:new Date(now+1).toISOString()};
 assert.deepEqual(rankEditorialCards([expired,future],now,context('RO')),[]);
});
