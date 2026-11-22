import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parseDocument,DomUtils}from'htmlparser2';import{initialEntryState,reduceEntry,topicSearchView}from'../.build/src/entry/state.js';
const read=p=>readFileSync(p,'utf8'),html=read('public/iceo.html'),doc=parseDocument(html),all=fn=>DomUtils.findAll(fn,doc.children),byId=id=>all(n=>n.attribs?.id===id)[0];
test('first visit puts information cards before optional search and remembered-check setup',()=>{assert.equal(initialEntryState.view,'start');const main=all(n=>n.name==='main')[0];const directChildren=main.children.filter(n=>n.type==='tag');assert.equal(directChildren[0].attribs.id,'discovery');assert.equal(directChildren.find(n=>n.name==='section').attribs.id,'discovery');assert.ok(html.indexOf('id="discovery-cards"')<html.indexOf('id="entry-options"'));assert.ok(html.indexOf('id="discovery-cards"')<html.indexOf('id="return-brief"'));assert.equal(byId('entry-options').name,'details');assert.equal(byId('entry-options').attribs.open,undefined);assert.ok(DomUtils.findAll(n=>n.attribs?.id==='entry-search',byId('entry-options').children).length===1);assert.notEqual(byId('topic-workspace').attribs.hidden,undefined);assert.notEqual(byId('local-briefing').attribs.hidden,undefined);});
test('remembered city and later topic restoration both preserve direct homepage',()=>{const a=reduceEntry(initialEntryState,{type:'restore',view:'local'});assert.equal(a.view,'start');assert.equal(reduceEntry(a,{type:'restore',view:'topics'}).view,'start');});
test('earlier topic memory and later city context also preserve direct homepage',()=>{const a=reduceEntry(initialEntryState,{type:'restore',view:'topics'});assert.equal(a.view,'start');assert.equal(reduceEntry(a,{type:'restore',view:'local'}).view,'start');});
test('typing blocks late restoration from stealing the entry screen',()=>{const a=reduceEntry(initialEntryState,{type:'interact'});for(const view of['local','topics'])assert.deepEqual(reduceEntry(a,{type:'restore',view}),a);});
test('explicit navigation wins over restoration in either order',()=>{for(const view of['local','topics','daily','start']){const a=reduceEntry(initialEntryState,{type:'choose',view});assert.equal(reduceEntry(a,{type:'restore',view:'local'}).view,view);}});
test('presentation reducer does not mutate caller state',()=>{const frozen=Object.freeze({...initialEntryState});reduceEntry(frozen,{type:'choose',view:'local'});assert.equal(frozen.view,'start');});
test('entry has labelled native input, explicit submit and finite contextual suggestions',()=>{const input=byId('entry-query');assert.equal(input.attribs.type,'search');assert.ok(input.attribs['aria-label']);assert.equal(byId('entry-submit').attribs.type,'submit');assert.match(read('src/entry/browser.ts'),/value.cities.length > 8/u);});
test('entry does not add personal persistence, background notifications or third party search',()=>{const js=read('src/entry/browser.ts');assert.doesNotMatch(js,/localStorage|sessionStorage|setInterval|navigator\.geolocation|innerHTML|outerHTML|insertAdjacentHTML|eval\s*\(/u);assert.match(js,/credentials: 'omit'/u);assert.match(js,/Not the whole web/u);});
test('script ordering registers entry navigation before existing controllers',()=>{assert.ok(html.indexOf('/entry-browser.js')<html.indexOf('/iceo.js'));assert.ok(html.indexOf('/entry-browser.js')<html.indexOf('/local-browser.js'));});
test('anonymous welcome shows a bounded mix without opening settings or saving a profile',()=>{const source=read('src/iceo/browser.ts');assert.equal(byId('discovery').attribs.hidden,undefined);assert.ok(byId('discovery-cards'));assert.match(source,/selectContextualToday/u);assert.doesNotMatch(source,/if\(!organizationPreview&&!dailyPresent&&!deviceState.focus\)void load\(\)/u);assert.match(source,/dlkt:topic-request/u);});
test('entry build assets exactly match reviewed strict TypeScript',()=>{for(const name of['browser','state','header']){const c=read(`.build/src/entry/${name}.js`).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll("'./state.js'","'./entry-state.js'").replaceAll("'./header.js'","'./entry-header.js'").replaceAll("'../share/link.js'","'./shared-card-link.js'").replaceAll("'../organizations/setup.js'","'./organization-setup.js'");assert.equal(c,read(`public/entry-${name}.js`));}});

test('all twenty public categories are visible and selected in the public discovery form',()=>{const legacy=all(n=>n.name==='input'&&n.attribs?.name==='topic'&&n.attribs?.value==='technology');assert.equal(legacy.length,1);assert.equal(legacy[0].attribs.hidden,undefined);assert.equal(legacy[0].attribs.checked,'');assert.equal(legacy[0].attribs.disabled,undefined);assert.equal(all(n=>n.name==='button'&&(n.attribs?.['data-entry-topic']==='technology'||n.attribs?.['data-focus']==='technology')).length,0);assert.equal(all(n=>n.name==='input'&&n.attribs?.name==='topic'&&n.attribs.hidden===undefined).length,20);});

test('city correction and return navigation are accessible without a hidden search prerequisite',()=>{assert.equal(byId('home-city').attribs['aria-controls'],'place-dialog');assert.equal(byId('home-city').attribs['aria-haspopup'],'dialog');assert.equal(byId('entry-title').attribs.tabindex,'-1');const source=read('src/entry/browser.ts');assert.match(source,/\{ type: 'restore', view: 'local' \} : \{ type: 'choose', view: 'start' \}/u);assert.doesNotMatch(source,/localViewPicking/u);assert.match(source,/options.open = state.view === 'topics'/u);assert.match(source,/required<HTMLElement>\('entry-title'\)\.focus\(\)/u);});


test('main briefing and optional profile management have separate entry points',()=>{
 const nav=byId('header-navigation'),options=byId('entry-options');
 assert.equal(DomUtils.findAll(n=>n.attribs?.id==='entry-today',nav.children).length,1);
 assert.equal(DomUtils.findAll(n=>n.attribs?.id==='entry-daily',nav.children).length,0);
 assert.equal(DomUtils.findAll(n=>n.attribs?.id==='entry-daily',options.children).length,1);
 assert.equal(DomUtils.textContent(byId('entry-today')),"Today's top");
 assert.equal(DomUtils.textContent(byId('entry-daily')),'Manage my briefing');
 assert.equal(all(n=>n.attribs?.id==='entry-daily').length,1);
 assert.equal(all(n=>n.attribs?.id==='entry-today').length,1);
});
test('empty topic searches return local edition and intentional queries remain searchable',()=>{
 for(const query of['',' ','\n\t','\u00a0'])assert.equal(topicSearchView(query),'start');
 for(const query of['Bucharest','  NASA  ','EU law','0'])assert.equal(topicSearchView(query),'topics');
 const topicState=reduceEntry(initialEntryState,{type:'choose',view:'topics'});
 assert.equal(reduceEntry(topicState,{type:'choose',view:topicSearchView(' ')}).view,'start');
 assert.equal(reduceEntry(topicState,{type:'choose',view:topicSearchView('NASA')}).view,'topics');
});
test('topic exploration names its worldwide scope instead of claiming a local briefing',()=>{
 assert.equal(DomUtils.textContent(byId('result-heading')),'Topic results.');
 assert.match(DomUtils.textContent(byId('topic-workspace')),/Worldwide topic results from connected sources/u);
 assert.equal(DomUtils.textContent(byId('entry-return')),"Today's top");
 assert.equal(byId('entry-return').attribs.type,'button');
});
