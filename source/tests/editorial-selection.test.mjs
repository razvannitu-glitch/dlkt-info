import test from 'node:test';
import assert from 'node:assert/strict';
import {PUBLIC_TOPICS} from '../.build/src/iceo/topics.js';
import {PUBLIC_EDITORIAL_CATEGORIES,EDITORIAL_CATEGORY_LABELS,EDITORIAL_CATEGORY_TOPICS,newsCategoryFromSourceId,classifyEditorialCard,classifyNewsHeadline,editorialCategory,headlineDiscoveryPriority} from '../.build/src/iceo/editorial-categories.js';

test('specialist events and local disruption subjects reach discovery without a dedicated category',()=>{
  const url='https://publisher.example/news/verified-item';
  for(const [title,category]of [
    ['Equestrian championship announces the final schedule','sport'],
    ['Dressage competition opens entries for the city event','sport'],
    ['A DJ announces a livestream set tonight','culture'],
    ['Roadworks close the main bridge this weekend','travel'],
    ['Traffic collision closes a road in the city centre','travel'],
    ['Premier League club reports record quarterly revenue','business'],
  ])assert.equal(classifyNewsHeadline(title,url),category,title);
  assert.equal(classifyNewsHeadline('A different view of the coming year',url),null);
});
import {rankEditorialCards} from '../.build/src/iceo/editorial-ranking.js';
import {selectContextualToday} from '../.build/src/iceo/contextual-today.js';
import {rankContextualCards} from '../.build/src/iceo/contextual.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';

const now=Date.parse('2026-11-20T12:00:00Z');
const context={countryCode:null,preferredTopics:[]};
const card=(id,category='world',extra={})=>({
  id:id.toString(16).padStart(24,'0'),identity:`https://publisher.example/stories/${id}`,sourceUrl:`https://publisher.example/stories/${id}`,
  title:`Controlled source publication ${id}`,topic:EDITORIAL_CATEGORY_TOPICS[category],kind:'publication',publisher:`Publisher ${id}`,
  sourceIds:[`news-${category}`],date:'2026-11-20T10:00:00.000Z',dateLabel:'Published',observedAt:new Date(now).toISOString(),
  contentHash:id.toString(16).padStart(64,'0'),boundary:'Controlled public fixture.',deadline:null,version:null,
  attribution:`Source: Publisher ${id}.`,sourceState:'verified',...extra,
});
const select=records=>selectContextualToday(records,context,now);

test('the twenty editorial categories remain independent of saved Topic IDs',()=>{
  assert.deepEqual(PUBLIC_EDITORIAL_CATEGORIES,['world','business','technology','money','health','sport','gaming','culture','shopping','travel','work','education','family','science','environment','public-affairs','digital-life','food','housing','weather']);
  assert.equal(new Set(PUBLIC_EDITORIAL_CATEGORIES).size,20);
  for(const category of PUBLIC_EDITORIAL_CATEGORIES){assert.ok(EDITORIAL_CATEGORY_LABELS[category]);assert.ok(PUBLIC_TOPICS.includes(EDITORIAL_CATEGORY_TOPICS[category]));}
  assert.equal(PUBLIC_TOPICS.includes('gaming'),false);assert.equal(PUBLIC_TOPICS.includes('family'),false);
  assert.equal(EDITORIAL_CATEGORY_TOPICS.family,'public-affairs');
});

test('actual category-discovery provenance is the strongest category hint',()=>{
  const fixture=card(1,'gaming',{topic:'technology',title:'The publisher announces a new edition'});
  assert.deepEqual(classifyEditorialCard(fixture),{category:'gaming',basis:'category-discovery'});
  assert.equal(newsCategoryFromSourceId('news-gaming'),'gaming');assert.equal(newsCategoryFromSourceId('news-gaming-extra'),null);
  assert.equal(newsCategoryFromSourceId('news-unknown'),null);assert.equal(newsCategoryFromSourceId('not-news-gaming'),null);
  const multi=card(2,'world',{sourceIds:['news-world','news-gaming'],title:'A new video game adds a cooperative story mode'});
  assert.equal(editorialCategory(multi),'gaming');assert.equal(editorialCategory({...multi,sourceIds:[...multi.sourceIds].reverse()}),'gaming');
});

test('education-institution mergers do not become corporate deals, including cached business hints',()=>{
  const title='CJP seeks consultation before Telangana’s proposed merger of BIE with Directorate of School Education';
  const url='https://publisher.example/news/verified-item';
  assert.equal(classifyNewsHeadline(title,url),'education');
  assert.equal(classifyNewsHeadline('Two universities propose a merger after consultation',url),'education');
  const cached=card(1,'business',{title,sourceIds:['news-business','editorial-frontpage']});
  const before=JSON.stringify(cached);
  assert.deepEqual(classifyEditorialCard(cached),{category:'education',basis:'category-discovery'});
  const ranked=rankEditorialCards([cached],now)[0];
  assert.equal(ranked.category,'education');
  assert.ok(ranked.editorial.signals.includes('publisher-frontpage'));
  assert.equal(JSON.stringify(cached),before);
  for(const corporate of [
    'Two software companies announce a merger',
    'Bank merger includes a new education programme for schools',
    'A software merger creates classroom tools for schools',
    'An education company merger boosts shareholder returns',
    'Schools receive grants as investors agree a merger',
    'University merger partners report record quarterly revenue',
  ]){
    assert.equal(classifyNewsHeadline(corporate,url),'business',corporate);
    assert.equal(editorialCategory(card(2,'business',{title:corporate})),'business',corporate);
  }
  assert.equal(classifyNewsHeadline('Astronomers observe a stellar merger',url),'science');
  assert.equal(classifyNewsHeadline('University researchers observe a stellar merger',url),'science');
  assert.equal(editorialCategory(card(3,'education',{title,sourceIds:['news-education']})),'education');
  assert.equal(editorialCategory(card(4,'business',{title,sourceIds:['news-unclassified']})),null);
  assert.equal(editorialCategory(card(5,'public-affairs',{title,sourceIds:['news-public-affairs']})),'public-affairs');
});

test('legacy gaps do not become shopping, gaming or parenting from vague titles',()=>{
  const recall=card(1,'food',{sourceIds:['govuk-products'],topic:'food',title:'Product recall: a child safety warning for consumers'});
  assert.equal(editorialCategory(recall),'food');
  assert.equal(editorialCategory(card(2,'world',{sourceIds:['govuk-news'],title:'Government changes the game for businesses'})),'world');
  assert.equal(editorialCategory(card(3,'world',{sourceIds:['ecb-procurement'],topic:'opportunities',title:'Contract notice for professional services'})),null);
  assert.equal(editorialCategory(card(4,'work',{sourceIds:['govuk-news'],topic:'work-education',title:'A ministry publishes its annual report'})),null);
  assert.equal(editorialCategory(card(5,'culture',{sourceIds:['gv-culture'],title:'Parenting advice on arranging childcare'})),'family');
});

test('headline discovery classification covers explicit subjects across all twenty categories',()=>{
  const cases={
    world:'Leaders meet at a diplomatic summit for bilateral talks',business:'Company reports quarterly earnings above its forecast',
    technology:'New artificial intelligence model adds an offline mode',money:'A guide to household savings and pensions',
    health:'New vaccine enters a clinical trial',sport:'Cricket team wins the tournament final',gaming:'Video game studio publishes new gameplay footage',
    culture:'Cinema festival announces its opening film',shopping:'Shopping deals and retail discounts announced',travel:'Airline opens new flights to the island',
    work:'Employers publish a new hiring and recruitment plan',education:'Universities introduce new tuition rules',family:'Childcare provision expands for working parents',
    science:'Researchers report a discovery in particle physics',environment:'Climate negotiations focus on carbon emissions',
    'public-affairs':'Parliament debates a new electoral law','digital-life':'Ransomware attack exposes a data breach',
    food:'Restaurants publish new recipes for seasonal cooking',housing:'Rental housing regulations change for tenants',weather:'Hurricane warning issued ahead of the storm',
  };
  for(const [category,title]of Object.entries(cases))assert.equal(classifyNewsHeadline(title,'https://publisher.example/news/item'),category,title);
});

test('discovery uses known section paths and keeps unknown or unsafe inputs unclassified',()=>{
  assert.equal(classifyNewsHeadline('Martin Rowson on the summits in Shenzhen and Brussels – cartoon','https://www.theguardian.com/commentisfree/picture/item'),null);
  assert.equal(classifyNewsHeadline('A different view of the coming year','https://publisher.example/science/story'),'science');
  assert.equal(classifyNewsHeadline('A different view of the coming year','https://publisher.example/news/story'),null);
  for(const url of ['javascript:alert(1)','http://publisher.example/world/item','https://reader:password@publisher.example/world/item','https://publisher.example:8443/world/item'])assert.equal(classifyNewsHeadline('Diplomatic talks continue',url),null);
  assert.equal(classifyNewsHeadline('', 'https://publisher.example/world/item'),null);
  assert.equal(classifyNewsHeadline('x'.repeat(4001),'https://publisher.example/world/item'),null);
});

test('specialist publisher scope is an exact-host fallback after actual subject evidence',()=>{
  for(const [host,category]of [['parents.com','family'],['pcgamer.com','gaming'],['ign.com','gaming'],['livescience.com','science'],['edweek.org','education'],['travelandleisure.com','travel'],['foodandwine.com','food']]){
    assert.equal(classifyNewsHeadline('A different view of the coming year',`https://${host}/story`),category);
    assert.equal(classifyNewsHeadline('A different view of the coming year',`https://www.${host}/story`),category);
    assert.equal(classifyNewsHeadline('A different view of the coming year',`https://${host}.example/story`),null);
  }
  assert.equal(classifyNewsHeadline('A clinical trial studies a new vaccine','https://www.parents.com/story'),'health');
  assert.equal(classifyNewsHeadline('A different view of the coming year','https://www.reuters.com/news/story'),null);
});

test('the development determines classification without permanent entity priorities',()=>{
  assert.equal(classifyNewsHeadline('Hearts: Vrancken on returning trio, squad summit and losing run','https://www.bbc.com/sport/football/articles/fixture'),'sport');
  assert.equal(classifyNewsHeadline('War forces the team to evacuate','https://www.bbc.com/sport/football/articles/fixture'),'world');
  assert.equal(classifyNewsHeadline('Nvidia reports record quarterly earnings from AI products','https://publisher.example/technology/item'),'business');
  assert.equal(classifyNewsHeadline('Presidents meet for a summit on bilateral relations','https://publisher.example/politics/item'),'world');
  assert.equal(classifyNewsHeadline('Researchers discover new quantum computing behaviour','https://publisher.example/technology/item'),'science');
  assert.equal(classifyNewsHeadline('Enterprise AI adoption accelerates in new industry survey','https://www.cnbc.com/news/item'),'technology');
  assert.equal(classifyNewsHeadline('Adoption of renewable energy reaches a new record','https://www.carbonbrief.org/news/item'),'environment');
  assert.equal(classifyNewsHeadline('Samsung unveils Galaxy smartphone with new AI features','https://www.theverge.com/tech/item'),'technology');
  assert.equal(classifyNewsHeadline('Child adoption guidance changes for prospective parents','https://www.parents.com/news/item'),'family');
  assert.equal(classifyNewsHeadline('Light-filled homes for sale in England – in pictures','https://www.theguardian.com/money/gallery/2026/nov/20/light-filled-homes-for-sale-in-england-in-pictures'),'housing');
  assert.equal(classifyNewsHeadline('Meta now sells 3D movies on Quest VR headsets','https://www.theverge.com/tech/1038157/meta-quest-vr-3d-movies-tv-app'),'technology');
  assert.equal(classifyNewsHeadline('Operation wards off risk of cyber-attack on supermarket fridges','https://publisher.example/technology/story'),'digital-life');
  assert.equal(classifyNewsHeadline('First ceremonies cement care leavers’ relationships','https://www.theguardian.com/society/item'),'family');
  assert.equal(classifyNewsHeadline('New guardianship arrangements recognise lasting family relationships','https://publisher.example/news/item'),'family');
  assert.equal(classifyNewsHeadline('Foster care support expands for young people','https://publisher.example/news/item'),'family');
  assert.equal(classifyNewsHeadline('The Guardian reports quarterly earnings','https://publisher.example/business/item'),'business');
  assert.equal(classifyNewsHeadline('An AI company becomes publicly listed in its IPO','https://publisher.example/technology/item'),'business');
  assert.equal(classifyNewsHeadline('A studio announces its initial public offering','https://publisher.example/gaming/item'),'business');
  assert.equal(classifyNewsHeadline('A software company prepares for its stock market debut','https://publisher.example/technology/item'),'business');
  assert.equal(classifyNewsHeadline('Police sub-inspector on duty at Madras High Court dies of heart attack','https://www.thehindu.com/news/cities/chennai/item'),null);
  assert.equal(classifyNewsHeadline('High Court orders a probe into a disputed will','https://publisher.example/news/item'),'public-affairs');
  assert.equal(classifyNewsHeadline('Court overturns a contested decision','https://publisher.example/news/item'),'public-affairs');
  assert.equal(classifyNewsHeadline('Astronomers spot giant star swallowing its companion in first-ever observations of a stellar merger','https://www.livescience.com/space/story'),'science');
  assert.equal(classifyNewsHeadline('Two software companies announce a merger','https://publisher.example/technology/story'),'business');
  assert.equal(classifyNewsHeadline('COP31 talks go into overtime over lack of fossil fuels in draft deal','https://www.theguardian.com/environment/story'),'environment');
  assert.equal(classifyNewsHeadline('Scientists examine ancient fossils in a new discovery','https://publisher.example/science/story'),'science');
  assert.equal(classifyNewsHeadline('Anthropic shares slump as markets reel from an AI sell-off','https://www.theguardian.com/technology/story'),'business');
  assert.equal(classifyNewsHeadline('These are the best warm-weather winter getaways','https://www.travelandleisure.com/destinations/story'),'travel');
  assert.equal(classifyNewsHeadline('Hurricane warning threatens popular holiday destinations','https://publisher.example/travel/story'),'weather');
  assert.equal(classifyNewsHeadline('Rangers: How legend McGregor is helping Pandur chase career goal','https://www.bbc.com/sport/articles/cklyl6gmegpzo'),'sport');
  assert.equal(classifyNewsHeadline('A champion considers the next step in her career','https://publisher.example/sports/story'),'sport');
  assert.equal(classifyNewsHeadline('Stadium workers face layoffs and consider new careers','https://publisher.example/sport/story'),'work');
  assert.equal(classifyNewsHeadline('Esports champion reflects on a remarkable career','https://publisher.example/sport/story'),'gaming');
  assert.equal(classifyNewsHeadline('BBC cuts: Next round of savings will be more noticeable to audiences, report warns','https://www.bbc.com/news/articles/story'),'business');
  assert.equal(classifyNewsHeadline('Waterfall of fog spills over cliffs in winning image for Weather Photographer of the Year 2026','https://www.livescience.com/planet-earth/weather/story'),'culture');
  assert.equal(classifyNewsHeadline('Burnham seals trade and youth mobility deals in biggest step towards EU since Brexit','https://www.theguardian.com/politics/story'),'travel');
  assert.equal(classifyNewsHeadline('Perambalur police personnel undergo special training in basic life saving techniques and first aid','https://www.thehindu.com/news/cities/tiruchirapalli/story'),'health');
  assert.equal(classifyNewsHeadline('Volunteers learn CPR and life-saving medical techniques','https://publisher.example/news/story'),'health');
  assert.equal(classifyNewsHeadline('Life-saving rescue brings passengers to safety','https://publisher.example/news/story'),null);
  assert.equal(classifyNewsHeadline('Household savings rise as families prepare for winter','https://publisher.example/news/story'),'money');
  assert.equal(classifyNewsHeadline('Personal saving habits and savings accounts explained','https://publisher.example/news/story'),'money');
});

test('broad agency defaults cannot turn fisheries data into weather coverage',()=>{
  assert.equal(editorialCategory(card(901,'weather',{sourceIds:['noaa-news'],title:'Charting the course on recreational fishing data: A message from NOAA'})),'science');
  assert.equal(editorialCategory(card(902,'weather',{sourceIds:['noaa-news'],title:'A community discussion about recreational fishing'})),null);
  assert.equal(editorialCategory(card(903,'science',{sourceIds:['nasa-news'],topic:'space',title:'The Stormy Southwest Pacific'})),'weather');
});

test('qualified news outranks a legacy recall without inventing an audience metric',()=>{
  const news=card(1,'food',{title:'New food research reports its findings',date:'2026-11-20T08:00:00.000Z'});
  const recall=card(2,'food',{sourceIds:['fda-food'],title:'Product recall and safety alert issued for a small batch',date:'2026-11-20T11:00:00.000Z'});
  const result=rankEditorialCards([recall,news],now);
  assert.equal(result[0].card,news);assert.ok(result.every(view=>view.editorial.relatedListingsAreIndependentConfirmations===false));
  assert.ok(result.every(view=>!('popularity' in view.editorial)&&!('audienceCount' in view.editorial)));
  assert.doesNotMatch(result.map(view=>view.reason).join(' '),/most.read|trending|independently verified|confirmed by/iu);
});

test('a headline development signal breaks the fresh-news tie without a universal recall boost',()=>{
  const release=card(1,'technology',{title:'Publisher unveils a new computing platform',date:'2026-11-20T08:00:00.000Z'});
  const recall=card(2,'technology',{title:'Product recall safety alert for an accessory',date:'2026-11-20T11:00:00.000Z'});
  assert.equal(rankEditorialCards([recall,release],now)[0].card,release);
  assert.deepEqual(rankEditorialCards([recall],now)[0].editorial.headlineSignals,[]);
  // The separate personal reader is deliberately unchanged.
  assert.equal(rankContextualCards([release,recall],{countryCode:null,topics:PUBLIC_TOPICS,query:'',budget:10},now)[0].card,recall);
});

test('acquisition and reading share investigation priority without a permanent company bonus',()=>{
  const title='California investigates Nvidia over whether chip exports ended up in China';
  assert.equal(headlineDiscoveryPriority(title,'technology'),2);
  assert.equal(headlineDiscoveryPriority(title.replace('Nvidia','another chip company'),'technology'),2);
  assert.equal(headlineDiscoveryPriority('A short profile of Nvidia and its products','technology'),0);
  const investigation=card(910,'technology',{title,date:'2026-11-20T08:00:00.000Z'});
  const release=card(911,'technology',{title:'Publisher unveils a new accessory',date:'2026-11-20T11:30:00.000Z'});
  const first=rankEditorialCards([release,investigation],now)[0];
  assert.equal(first.card.id,investigation.id);assert.ok(first.editorial.signals.includes('investigation-or-regulatory-action'));
});

test('a material investigation keeps its place ahead of weaker homepage listings within two category slots',()=>{
  const investigation=card(930,'technology',{title:'California investigates Nvidia over whether chip exports ended up in China',date:'2026-11-20T08:00:00.000Z'});
  const firstFeatured=card(931,'technology',{title:'A president threatens limits on AI data centres overseas',sourceIds:['news-technology','editorial-frontpage'],date:'2026-11-20T11:30:00.000Z'});
  const secondFeatured=card(932,'technology',{title:'Etsy sellers discuss an AI training policy',sourceIds:['news-technology','editorial-frontpage'],date:'2026-11-20T11:00:00.000Z'});
  const result=select([firstFeatured,secondFeatured,investigation]);
  assert.deepEqual(result.first.map(view=>view.card.id),[investigation.id,firstFeatured.id]);
  assert.ok(!result.first.some(view=>view.card.id===secondFeatured.id));
});

test('major diplomatic developments share strongest discovery and reading priority without leader-name bonuses',()=>{
  const title='India takes note of Trump-Xi-Putin summit, awaits more details';
  assert.equal(headlineDiscoveryPriority(title,'world'),2);
  for(const value of ['Countries announce a diplomatic summit','Negotiators resume nuclear-arms talks','Countries sign a peace agreement','A ceasefire comes into effect'])assert.equal(headlineDiscoveryPriority(value,'world'),2,value);
  assert.equal(headlineDiscoveryPriority('A profile of Trump, Xi and Putin','world'),0);
  assert.equal(headlineDiscoveryPriority('The annual software summit opens','technology'),1);
  const summit=card(940,'world',{title,date:'2026-11-20T08:00:00.000Z'});
  const routine=card(941,'world',{title:'A routine international bulletin from the publisher',sourceIds:['news-world','editorial-frontpage'],date:'2026-11-20T11:30:00.000Z'});
  const ranked=rankEditorialCards([routine,summit],now);
  assert.equal(ranked[0].card.id,summit.id);assert.ok(ranked[0].editorial.signals.includes('diplomatic-development'));
});

test('checked publisher-homepage evidence outranks a newer minor listing within its category',()=>{
  const featured=card(1,'technology',{sourceIds:['news-technology','editorial-frontpage'],title:'A closer look at a new computing platform',date:'2026-11-20T06:00:00.000Z'});
  const recent=card(2,'technology',{title:'Publisher unveils a small accessory update',date:'2026-11-20T11:30:00.000Z'});
  const result=rankEditorialCards([recent,featured],now);assert.equal(result[0].card,featured);
  assert.ok(result[0].editorial.signals.includes('publisher-frontpage'));assert.ok(!result[0].editorial.headlineSignals.includes('publisher-frontpage'));
  assert.match(result[0].reason,/Featured on its publisher’s homepage at this source check/u);
  assert.doesNotMatch(result[0].reason,/globally|most.read|independent confirmation/iu);
  const expired={...featured,observedAt:new Date(now-3_600_000).toISOString()};
  assert.deepEqual(rankEditorialCards([expired,recent],now).map(view=>view.card.id),[recent.id]);
});

test('homepage words and an unpaired source marker cannot fabricate featured evidence',()=>{
  const words=card(1,'technology',{title:'Featured on the publisher homepage: a new development'});
  const unpaired=card(2,'technology',{sourceIds:['editorial-frontpage'],title:'Featured on the publisher homepage: a new computing platform'});
  for(const view of rankEditorialCards([words,unpaired],now)){
    assert.ok(!view.editorial.signals.includes('publisher-frontpage'));assert.doesNotMatch(view.reason,/Featured on its publisher’s homepage/u);
  }
});

test('two categories sharing one persisted Topic still receive independent public places',()=>{
  const records=[card(1,'gaming'),card(2,'gaming'),card(3,'gaming'),card(4,'culture'),card(5,'culture')];
  assert.ok(records.every(value=>value.topic==='culture'));
  const result=select(records);assert.equal(result.first.length,4);
  assert.deepEqual(result.daily.selectedCategories,['gaming','culture']);
  assert.deepEqual(result.daily.selectedTopics,['culture']);assert.equal(result.daily.completeCoverage,false);
});

test('twenty items from ten categories are not reported as complete coverage',()=>{
  const records=PUBLIC_EDITORIAL_CATEGORIES.slice(0,10).flatMap((category,index)=>[card(index*2+1,category),card(index*2+2,category)]);
  const result=select(records);assert.equal(result.first.length,20);assert.equal(result.daily.belowMinimum,false);
  assert.equal(result.daily.completeCoverage,false);assert.equal(result.daily.selectedCategories.length,10);assert.equal(result.daily.missingCategories.length,10);
});

test('publisher diversity cannot create false missing categories but still prefers available alternatives',()=>{
  const only=PUBLIC_EDITORIAL_CATEGORIES.flatMap((category,index)=>[card(index*3+1,category,{publisher:'Shared publisher'}),card(index*3+2,category,{publisher:'Shared publisher'})]);
  const first=select(only);assert.equal(first.first.length,20);assert.equal(first.daily.completeCoverage,true);
  assert.ok(PUBLIC_EDITORIAL_CATEGORIES.every(category=>first.first.filter(view=>view.category===category).length===1));
  const alternatives=PUBLIC_EDITORIAL_CATEGORIES.flatMap((category,index)=>[card(1000+index*2,category,{publisher:`Alternative ${index}`}),card(1001+index*2,category,{publisher:`Alternative ${index}`})]);
  const diverse=select([...only,...alternatives]);assert.equal(diverse.first.length,30);assert.equal(diverse.daily.completeCoverage,true);
  assert.ok(diverse.first.filter(view=>view.card.publisher==='Shared publisher').length<=4);
  assert.ok(PUBLIC_EDITORIAL_CATEGORIES.every(category=>diverse.first.filter(view=>view.category===category).length<=2));
});

test('publisher preferences never trade checked homepage stories for weaker category substitutes',()=>{
  const records=PUBLIC_EDITORIAL_CATEGORIES.flatMap((category,index)=>[
    card(100+index,category,{publisher:index<6?'Shared publisher':`First publisher ${index}`,sourceIds:index<6?[`news-${category}`,'editorial-frontpage']:[`news-${category}`],
      title:index===1?'Anthropic shares slump after its IPO':`Public source development ${index}`,date:'2026-11-20T08:00:00.000Z'}),
    card(200+index,category,{publisher:`Alternative ${index}`,date:'2026-11-20T11:00:00.000Z'}),
  ]);
  const second=card(800,'world',{publisher:'Shared publisher',sourceIds:['news-world','editorial-frontpage'],title:'A separate verified headline selected by the publisher',date:'2026-11-20T07:00:00.000Z'});
  const result=select([...records,second]);
  for(let index=0;index<6;index++)assert.ok(result.first.some(view=>view.card.id===card(100+index).id));
  assert.ok(result.first.some(view=>view.card.id===second.id));
  assert.equal(result.daily.completeCoverage,true);
  assert.ok(result.first.length<=30);
  assert.ok(PUBLIC_EDITORIAL_CATEGORIES.every(category=>result.first.filter(view=>view.category===category).length<=2));
});

test('same informative headline without excerpts gets one primary category and no corroboration claim',()=>{
  const title='International science consortium announces a new public satellite observation programme';
  const one=card(1,'science',{title}),two=card(2,'technology',{title});
  const result=select([two,one]);assert.equal(result.first.length,1);assert.equal(result.first[0].category,'science');
  assert.equal(result.first[0].related[0],two);assert.equal(result.first[0].grouping,'matching-headlines');
  assert.equal(result.first[0].editorial.relatedListingsAreIndependentConfirmations,false);
  assert.match(result.first[0].editorialReason,/not independent confirmations/u);
});

test('same exact launch-day revenue claim groups aliases without merging other facts or sports',()=>{
  const first=card(920,'gaming',{title:'Grand Theft Auto 6 earned $3.79 billion on launch day'});
  const second=card(921,'gaming',{title:'Rockstar says GTA VI made $3.79 billion in its first day'});
  const grouped=rankEditorialCards([first,second],now);
  assert.equal(grouped.length,1);assert.equal(grouped[0].related.length,1);
  assert.equal(grouped[0].editorial.relatedListingsAreIndependentConfirmations,false);
  for(const title of ['GTA VI made $2.36 billion in its first day','GTA VI did not make $3.79 billion in its first day','GTA VI made an estimated $3.79 billion in its first day','GTA VI made $3.79 billion in its first day and workers now vote on a union','GTA VI made USD3.79 billion in its first day','No one says GTA VI made $3.79 billion in its first day','Rockstar falsely says GTA VI made $3.79 billion in its first day']){
    assert.equal(rankEditorialCards([first,{...second,title}],now).length,2,title);
  }
  assert.equal(rankEditorialCards([card(922,'sport',{title:'England beat Australia to win the tournament final'}),card(923,'sport',{title:'England beat New Zealand to win the tournament final'})],now).length,2);
});

test('negations, numbers, differing excerpts and generic headlines never create false story clusters',()=>{
  const title='International science consortium announces a new public satellite observation programme';
  for(const [left,right]of [
    [{title},{title:title.replace('announces','does not announce')}],
    [{title:title+' with 12 instruments'},{title:title+' with 24 instruments'}],
    [{title,summary:'The publisher says funding has been approved.'},{title,summary:'The publisher says funding has not been approved.'}],
    [{title:'Daily update'},{title:'Daily update'}],
  ])assert.equal(rankEditorialCards([card(1,'science',left),card(2,'science',right)],now).length,2);
});

test('identity conflicts are removed locally while a safe unrelated story survives',()=>{
  const first=card(1,'technology'),conflict=card(2,'gaming',{identity:first.identity,sourceUrl:first.sourceUrl}),safe=card(3,'science');
  assert.deepEqual(rankEditorialCards([first,conflict,safe],now).map(view=>view.card.id),[safe.id]);
});

test('source publication, observation freshness and kind boundaries cannot be padded',()=>{
  const valid=card(1,'world');
  const bad=[
    card(2,'world',{date:new Date(now-86_400_000).toISOString()}),card(3,'world',{date:new Date(now+1).toISOString()}),
    card(4,'world',{observedAt:new Date(now-3_600_000).toISOString()}),card(5,'world',{observedAt:new Date(now+300_001).toISOString()}),
    card(6,'world',{sourceState:'stale'}),card(7,'world',{dateLabel:'Updated'}),card(8,'world',{dateLabel:'Document date'}),
    card(9,'technology',{kind:'software-release',version:'1.0.1'}),card(10,'work',{kind:'procurement-notice'}),
  ];
  assert.deepEqual(rankEditorialCards([...bad,valid],now).map(view=>view.card.id),[valid.id]);
  const old=card(11,'world',{date:'2026-11-17T12:00:00.000Z',observedAt:new Date(now).toISOString()});
  assert.deepEqual(rankEditorialCards([old],now),[]);
});

test('selection preserves the original card, its hash content and every saved field',()=>{
  const source=card(1,'gaming'),before=JSON.stringify(source),content=JSON.stringify(cardContent(source));
  const result=select([source]);assert.equal(result.first[0].card,source);assert.equal(JSON.stringify(source),before);
  assert.equal(JSON.stringify(cardContent(result.first[0].card)),content);assert.equal(Object.hasOwn(source,'category'),false);
  assert.equal(Object.hasOwn(source,'editorial'),false);
});

test('source ordering and repeated records do not change the public result',()=>{
  const corpus=PUBLIC_EDITORIAL_CATEGORIES.flatMap((category,index)=>[card(index*3+1,category),card(index*3+2,category),card(index*3+3,category)]);
  const first=select(corpus),again=select([...corpus].reverse().concat(corpus[0]));
  assert.deepEqual(first.first.map(view=>[view.card.id,view.category]),again.first.map(view=>[view.card.id,view.category]));
  assert.equal(first.first.length,30);assert.equal(first.daily.completeCoverage,true);
});
