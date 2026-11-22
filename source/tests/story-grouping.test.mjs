import test from 'node:test';
import assert from 'node:assert/strict';
import {groupStories,storyThreadKey} from '../.build/src/iceo/story-grouping.js';
import {contextFromPublisherCategories} from '../.build/src/iceo/context.js';

const date='2026-11-22T08:00:00.000Z',observedAt='2026-11-22T09:00:00.000Z';
const card=(id,title,extra={})=>({
 id:id.toString(16).padStart(24,'0'),identity:`https://publisher.example/articles/${id}`,sourceUrl:`https://publisher.example/articles/${id}`,
 title,topic:'environment',kind:'publication',publisher:`Publisher ${id}`,sourceIds:['news-environment'],date,dateLabel:'Published',observedAt,
 contentHash:id.toString(16).padStart(64,'0'),boundary:'Controlled original publication.',deadline:null,version:null,attribution:`Source: Publisher ${id}.`,sourceState:'verified',...extra,
});
const all=group=>[group.card,...group.related];
const titles=group=>all(group).map(item=>item.title).sort();
const guardian='Cop31 live: A new draft deal on the table as talks go into final hours';
const bbc='COP31: New draft deal aims to avert collapse of talks at climate summit';

test('the observed Guardian and BBC COP31 headlines form one attributed thread without changing either original',()=>{
 const first=card(1,guardian,{publisher:'The Guardian',sourceUrl:'https://www.theguardian.com/environment/live/2026/nov/22/cop31-climate-crisis-talks-turkey-latest-news-updates'});
 const second=card(2,bbc,{publisher:'BBC',sourceUrl:'https://www.bbc.com/news/articles/cq7827z2841zo'});
 const originals=JSON.stringify([first,second]),groups=groupStories([second,first]);
 assert.equal(groups.length,1);assert.equal(groups[0].basis,'shared-event');assert.equal(groups[0].card,first);assert.equal(groups[0].related[0],second);
 assert.deepEqual(titles(groups[0]),[guardian,bbc].sort());assert.equal(JSON.stringify([first,second]),originals);
 assert.equal(groups[0].key,storyThreadKey(first));assert.equal(groups[0].key,storyThreadKey(second));
 assert.ok(Object.isFrozen(groups));assert.ok(Object.isFrozen(groups[0]));assert.ok(Object.isFrozen(groups[0].related));
 const evolved=card(3,'Cop31 live: new draft deal under scrutiny as divided talks risk longest climate summit ever');
 assert.equal(groupStories([evolved,second]).length,1);assert.equal(storyThreadKey(evolved),groups[0].key);
});

test('named-event identity survives reorder, source additions, date range and representative replacement',()=>{
 const first=card(1,guardian),second=card(2,bbc),earlier=card(3,'COP31 negotiations continue over the draft agreement',{date:'2026-11-17T08:00:00.000Z'});
 const identity=storyThreadKey(first);
 for(const records of [[first,second],[second,first],[earlier,second,first],[first,earlier,second],[second],[earlier]]){
  const result=groupStories(records);assert.equal(result.length,1);assert.equal(result[0].key,identity);
  assert.equal(result[0].related.length,records.length-1);
 }
 const chosen=groupStories([first,second],(a,b)=>b.id.localeCompare(a.id));
 assert.equal(chosen[0].card,second);assert.equal(chosen[0].key,identity);assert.equal(chosen[0].related[0],first);
});

test('same explicit event and negotiation subject can match across supported original languages',()=>{
 const originals=[guardian,'COP31 : les négociations reprennent après un nouveau projet d’accord','COP31: un borrador de acuerdo intenta salvar las negociaciones','COP31: Neuer Entwurf soll die Verhandlungen retten','COP31、新たな合意案を協議','COP31公布新协议草案，谈判继续','COP31: مسودة اتفاق جديدة لإنقاذ المفاوضات'];
 const records=originals.map((title,index)=>card(index+1,title));
 const groups=groupStories(records);assert.equal(groups.length,1);assert.deepEqual(titles(groups[0]),[...originals].sort());
 assert.ok(records.every(record=>storyThreadKey(record)===groups[0].key));
});

test('the framework handles separate numbered summits and tournament editions, beyond COP31',()=>{
 for(const pair of [
  ['G20 summit leaders reach a new trade agreement','G20: un nouveau projet d’accord au sommet'],
  ['COP32 talks continue over a draft agreement','COP32 : les négociations portent sur un nouvel accord'],
  ['2026 World Cup schedule announced','Coupe du monde 2026 : le calendrier est annoncé'],
  ['2028 Summer Olympics opening ceremony begins','Jeux olympiques d’été 2028 : cérémonie d’ouverture'],
 ])assert.equal(groupStories(pair.map((title,index)=>card(index+1,title))).length,1,pair.join(' / '));
 assert.equal(groupStories([card(1,'COP31 talks reach a draft agreement'),card(2,'COP32 talks reach a draft agreement')]).length,2);
 assert.equal(groupStories([card(1,'G20 summit 2026 reaches an agreement'),card(2,'G20 summit 2027 reaches an agreement')]).length,2);
});

test('same-event negations, reported numbers and negotiation stages remain separate accessible attributed reports',()=>{
 const records=[
  card(1,'COP31 draft deal includes fossil fuels',{summary:'Publisher A reports support from 80 countries.'}),
  card(2,'COP31 draft deal does not include fossil fuels',{summary:'Publisher B reports opposition from 20 countries.'}),
  card(3,'COP31 final agreement adopted after negotiations'),
 ];
 const before=JSON.stringify(records),groups=groupStories(records);assert.equal(groups.length,1);assert.equal(groups[0].basis,'shared-event');
 assert.deepEqual(new Set(all(groups[0])),new Set(records));assert.equal(JSON.stringify(records),before);
 assert.equal(groups[0].related.length,2);assert.ok(all(groups[0]).some(row=>row.title.includes('does not')));
 assert.ok(all(groups[0]).some(row=>row.summary?.includes('20 countries')));
 assert.deepEqual(Object.keys(groups[0]).sort(),['basis','card','key','related']);
});

test('different activities at one event and ambiguous bridging headlines do not merge transitively',()=>{
 const negotiations=card(1,'COP31 draft agreement remains under negotiation');
 const protests=card(2,'COP31 protests draw crowds outside the venue');
 const bridge=card(3,'COP31 protests continue as negotiators discuss the draft agreement');
 const otherEdition=card(4,'COP32 draft agreement remains under negotiation');
 const multiEvent=card(5,'COP31 and COP32 negotiations face separate decisions');
 for(const records of [[negotiations,protests,bridge,otherEdition,multiEvent],[multiEvent,bridge,protests,negotiations,otherEdition]]){
  assert.equal(groupStories(records).length,5);
 }
 assert.notEqual(storyThreadKey(negotiations),storyThreadKey(protests));
});

test('a named storm groups its coverage but generic cyclone verbs and different names do not',()=>{
 const named=[card(1,'Hurricane Iris approaches the coast'),card(2,'L’ouragan Iris provoque des inondations'),card(3,'Hurricane Iris leaves 12 dead'),card(4,'Hurricane Iris death toll is not 12, officials say')];
 assert.equal(groupStories(named).length,1);assert.deepEqual(new Set(all(groupStories(named)[0])),new Set(named));
 assert.equal(groupStories([card(5,'Cyclone kills 12 in India'),card(6,'Cyclone kills 20 in Australia')]).length,2);
 assert.equal(storyThreadKey(card(5,'Cyclone kills 12 in India')),null);
 assert.equal(groupStories([card(5,'Cyclone Kills 12 in India'),card(6,'Cyclone Kills 20 in Australia')]).length,2);
 assert.equal(storyThreadKey(card(5,'Cyclone Kills 12 in India')),null);
 assert.equal(groupStories([card(5,'Hurricane Iris 1995 damage is assessed'),card(6,'Hurricane Iris 2001 damage is assessed')]).length,2);
 assert.equal(groupStories([card(7,'Hurricane Iris approaches the coast'),card(8,'Hurricane Felix approaches the coast')]).length,2);
 assert.equal(groupStories([card(9,'Hurricane Iris approaches the coast'),card(10,'A documentary about Hurricane Iris is released')]).length,2);
});

test('distinct product models and named launches group without collapsing other reports about the company',()=>{
 for(const pair of [
  ['Acme unveils Nimbus 2 with a new camera','Nimbus 2 is released with upgraded optics'],
  ['Apple launches iPhone 18','L’iPhone 18 est dévoilé avec une nouvelle caméra'],
  ['Acme unveils “Aurora One”','The new “Aurora One” is released today'],
  ['Grand Theft Auto 6 is released today','GTA VI launches today'],
 ])assert.equal(groupStories(pair.map((title,index)=>card(index+1,title,{topic:'technology'}))).length,1,pair.join(' / '));
 assert.equal(groupStories([card(1,'Acme unveils Nimbus 2'),card(2,'Acme unveils Nimbus 3')]).length,2);
 assert.equal(groupStories([card(1,'Acme unveils Nimbus 2'),card(2,'Acme recalls Nimbus 2')]).length,2);
 assert.equal(groupStories([card(1,'Acme reports quarterly earnings'),card(2,'Acme faces a privacy investigation'),card(3,'Acme opens an office in Tokyo')]).length,3);
});

test('a compatibility target or accessory is not the object of the reported product launch',()=>{
 const phone=card(1,'Apple launches iPhone 18',{topic:'technology'});
 for(const title of ['Company launches new case for iPhone 18','Company launches iPhone 18 case','Un fabricant lance une coque pour iPhone 18','Company unveils a charger compatible with iPhone 18','Insurer launches iPhone 18 protection plan']){
  assert.equal(groupStories([phone,card(2,title,{topic:'technology'})]).length,2,title);
 }
 assert.equal(groupStories([card(3,'Samsung releases Galaxy S26'),card(4,'Samsung releases Galaxy S26 software update')]).length,2);
});

test('winter, summer, youth, sport and activity distinguish tournament identities',()=>{
 for(const pair of [
  ['2026 Winter Olympics opening ceremony begins','2026 Youth Olympics opening ceremony begins'],
  ['2028 Summer Olympics opening ceremony begins','2028 Winter Olympics opening ceremony begins'],
  ['2026 World Cup schedule announced','2026 Cricket World Cup schedule announced'],
  ['2026 World Cup schedule announced','2026 World Cup ticket sales announced'],
 ])assert.equal(groupStories(pair.map((title,index)=>card(index+1,title,{topic:'sport'}))).length,2,pair.join(' / '));
 assert.equal(groupStories([card(1,'England beat Australia to win the tournament final'),card(2,'England beat New Zealand to win the tournament final')]).length,2);
});

test('a unique vulnerability identifier is a thread; a multi-identifier report cannot bridge different incidents',()=>{
 const a=card(1,'CVE-2026-12345 is exploited before a patch is released'),b=card(2,'A patch addresses CVE-2026-12345'),c=card(3,'CVE-2026-67890 affects a separate product'),bridge=card(4,'CVE-2026-12345 and CVE-2026-67890 are discussed in a bulletin');
 assert.equal(groupStories([a,b]).length,1);assert.equal(groupStories([a,b,c,bridge]).length,3);
});

test('a new documentary about the same explicit person and specific narrative is one thread, not every story about that person',()=>{
 const first=card(1,"Catherine's cancer journey depicted in new documentary",{date:'2026-11-21T18:59:56.567Z'});
 const second=card(2,'Princess of Wales: Catherine talks about her cancer journey in new documentary Heal',{date:'2026-11-21T12:00:03.094Z'});
 const originals=JSON.stringify([first,second]),group=groupStories([first,second]);assert.equal(group.length,1);assert.equal(group[0].basis,'shared-event');
 assert.equal(group[0].key,storyThreadKey(first));assert.equal(group[0].key,storyThreadKey(second));assert.equal(JSON.stringify([first,second]),originals);
 assert.equal(groupStories([second,first],(a,b)=>b.id.localeCompare(a.id))[0].key,group[0].key);
 const genericA=card(3,"Amina Patel's marathon recovery depicted in a new documentary"),genericB=card(4,'Amina Patel talks about her marathon recovery in a new documentary Forward');
 assert.equal(groupStories([genericA,genericB]).length,1);
 assert.equal(groupStories([genericA,card(5,"Amina Jones's marathon recovery depicted in a new documentary")]).length,2);
 for(const title of [
  "Anna's cancer journey depicted in new documentary",
  "Catherine Jones's cancer journey depicted in new documentary",
  "Catherine's football career depicted in new documentary",
  "Catherine's cancer journey depicted in a new film",
  "Catherine's cancer journey explored in a new book",
  'Catherine talks about her cancer journey in a new interview',
  'Catherine begins a new cancer treatment',
  "Catherine's personal journey depicted in new documentary",
 ])assert.equal(groupStories([first,card(6,title,{date:first.date})]).length,2,title);
 assert.equal(groupStories([first,{...second,date:'2026-11-17T12:00:03.094Z'}]).length,2);
});

test('exact informative fallback preserves differing claims, excerpts and explicit country context',()=>{
 const title='International science consortium announces a new public satellite observation programme';
 assert.equal(groupStories([card(1,title),card(2,title)]).length,1);assert.equal(groupStories([card(1,title),card(2,title)])[0].basis,'matching-headlines');
 for(const [a,b]of [
  [{title},{title:title.replace('announces','does not announce')}],
  [{title:title+' with 12 instruments'},{title:title+' with 24 instruments'}],
  [{title,summary:'The publisher says funding has been approved.'},{title,summary:'The publisher says funding has not been approved.'}],
  [{title:'Daily update'},{title:'Daily update'}],
 ])assert.equal(groupStories([card(1,a.title,a),card(2,b.title,b)]).length,2);
 const gb=contextFromPublisherCategories('gv-world',['United Kingdom']),jp=contextFromPublisherCategories('gv-world',['Japan']);assert.ok(gb);assert.ok(jp);
 assert.equal(groupStories([card(1,title,{sourceIds:['gv-world'],context:gb}),card(2,title,{sourceIds:['gv-world'],context:jp})]).length,2);
});

test('existing exact reported launch-revenue equivalence remains narrow',()=>{
 const first=card(1,'Grand Theft Auto 6 earned $3.79 billion on launch day',{topic:'culture'});
 const second=card(2,'Rockstar says GTA VI made $3.79 billion in its first day',{topic:'culture'});
 assert.equal(groupStories([first,second]).length,1);assert.equal(groupStories([first,second])[0].basis,'matching-headlines');
 for(const title of ['GTA VI made $2.36 billion in its first day','GTA VI did not make $3.79 billion in its first day','GTA VI made an estimated $3.79 billion in its first day','GTA VI made $3.79 billion in its first day and workers now vote on a union','GTA VI made USD3.79 billion in its first day','No one says GTA VI made $3.79 billion in its first day','Rockstar falsely says GTA VI made $3.79 billion in its first day']){
  assert.equal(groupStories([first,{...second,title}]).length,2,title);
 }
});

test('weak temporal keys are fixed per record and cannot change when another episode appears or expires',()=>{
 const title='International science consortium announces a new public satellite observation programme';
 const first=card(1,title),monthsEarlier=card(2,title,{date:'2026-07-22T08:00:00.000Z'});
 const expected=storyThreadKey(first);assert.notEqual(storyThreadKey(monthsEarlier),expected);
 assert.equal(groupStories([first])[0].key,expected);
 const together=groupStories([monthsEarlier,first]);assert.equal(together.length,2);assert.equal(together.find(group=>group.card===first)?.key,expected);
 assert.equal(groupStories([first])[0].key,expected);
 const end=Date.parse('2026-11-22T08:00:00Z'),bucketStart=Math.floor(end/(2*86_400_000))*2*86_400_000;
 const boundaryBefore=card(3,title,{date:new Date(bucketStart-1).toISOString()}),boundaryAfter=card(4,title,{date:new Date(bucketStart).toISOString()});
 assert.equal(groupStories([boundaryBefore,boundaryAfter]).length,2);
});

test('strict ID, identity and URL conflicts are isolated before grouping, including a shared-event match',()=>{
 const original=card(1,guardian),safe=card(9,'A separate publication');
 for(const conflict of [
  {...card(2,bbc),id:original.id},
  {...card(2,bbc),identity:original.identity},
  {...card(2,bbc),sourceUrl:original.sourceUrl},
  {...original,contentHash:'f'.repeat(64)},
 ])assert.deepEqual(groupStories([original,conflict,safe]).map(group=>group.card),[safe]);
 const fresh={...original,observedAt:'2026-11-22T10:00:00.000Z'};
 assert.equal(groupStories([original,fresh]).length,1);assert.equal(groupStories([original,fresh])[0].card,fresh);
});

test('the helper only groups supplied records, leaves software versions alone and is bounded at 5000',()=>{
 const current=card(1,guardian),older=card(2,bbc,{date:'2026-11-17T08:00:00.000Z'});
 assert.deepEqual(all(groupStories([current])[0]),[current]);assert.equal(groupStories([current,older])[0].related.length,1);
 const software=card(3,guardian,{kind:'software-release'});assert.equal(storyThreadKey(software),null);assert.equal(groupStories([current,software]).length,2);
 const many=Array.from({length:5000},(_,index)=>card(index+100,'Controlled publication '+index));
 assert.equal(groupStories(many).length,5000);assert.throws(()=>groupStories([...many,card(6000,'Excess publication')]),/STORY_INPUT_INVALID/u);
 assert.deepEqual(groupStories([]),[]);
});
