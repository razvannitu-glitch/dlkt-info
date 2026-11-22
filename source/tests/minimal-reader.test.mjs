import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{parseDocument,DomUtils}from'htmlparser2';import{runInNewContext}from'node:vm';
const html=readFileSync('public/iceo.html','utf8'),css=readFileSync('public/iceo.css','utf8'),js=readFileSync('src/iceo/browser.ts','utf8');const doc=parseDocument(html);const all=fn=>DomUtils.findAll(fn,doc.children);const byId=id=>all(n=>n.attribs?.id===id)[0];
test('reader has one primary heading per exclusive view and only the intentional Plus plan aside',()=>{
 const headings=all(n=>n.name==='h1');
 const initiallyVisible=node=>{for(let parent=node;parent;parent=parent.parent)if(parent.attribs?.hidden!==undefined)return false;return true;};
 assert.deepEqual(headings.map(node=>node.attribs.id),['entry-title','knowledge-title','world-title']);
 assert.deepEqual(headings.filter(initiallyVisible).map(node=>node.attribs.id),['entry-title']);
 assert.notEqual(byId('world-explore').attribs.hidden,undefined);
 assert.notEqual(byId('knowledge-discovery').attribs.hidden,undefined);
 assert.match(readFileSync('public/explore.css','utf8'),/body\[data-world-explore=active\] \.reader-shell>section:not\(#world-explore\)/u);
 assert.deepEqual(all(n=>n.name==='aside').map(node=>node.attribs.id),['knowledge-plan']);assert.strictEqual(byId('knowledge-plan').parent,byId('knowledge-discovery'));assert.equal(byId('knowledge-plan').attribs['aria-labelledby'],'knowledge-plan-title');assert.equal(byId('entry-title').name,'h1');assert.equal(byId('result-heading').name,'h2');
});
test('news, knowledge and world modes keep exactly one visible primary heading through controller flags and mode CSS',()=>{
 const knowledgeCss=readFileSync('public/knowledge.css','utf8'),exploreCss=readFileSync('public/explore.css','utf8');
 assert.match(knowledgeCss,/\.reader-content-switch\[hidden\],\.knowledge-discovery\[hidden\]\{display:none!important\}/u);
 assert.match(knowledgeCss,/body\[data-reader-content=knowledge\]\[data-entry-view=start\]:not\(\[data-world-explore\]\) #discovery\{display:none!important\}/u);
 assert.match(exploreCss,/body\[data-world-explore=active\] \.reader-shell>section:not\(#world-explore\),body\[data-world-explore=active\] #today-glance\{display:none!important\}/u);
 const compiled=readFileSync('.build/src/iceo/knowledge-browser.js','utf8');
 const active=compiled.match(/function knowledgeModeActive\(\)\s*\{[^{}]*\}/u)?.[0];
 const visibility=compiled.match(/const home\s*=[\s\S]*?;\s*controls\.hidden\s*=[^;]+;\s*section\.hidden\s*=[^;]+;/u)?.[0];
 assert.ok(active,'the compiled mode predicate remains executable');assert.ok(visibility,'the compiled controller sets both visibility flags');
 for(const [content,world,expected]of[['news',false,'entry-title'],['knowledge',false,'knowledge-title'],['news',true,'world-title'],['knowledge',true,'world-title']]){
  const dataset={entryView:'start',readerContent:content,...(world?{worldExplore:'active'}:{})};
  const state={document:{body:{dataset}},controls:{hidden:false},section:{hidden:true}};
  runInNewContext(active+'\n'+visibility,state);
  assert.equal(state.controls.hidden,world,'the content switch is available only on the home surface');
  const view=parseDocument(html),nodes=predicate=>DomUtils.findAll(predicate,view.children),id=value=>nodes(node=>node.attribs?.id===value)[0];
  const main=nodes(node=>node.name==='main')[0],knowledge=id('knowledge-discovery'),explore=id('world-explore');
  if(state.section.hidden)knowledge.attribs.hidden='';else delete knowledge.attribs.hidden;
  if(world)delete explore.attribs.hidden;else explore.attribs.hidden='';
  // Check the actual hidden flags together with the two asserted CSS selectors above.
  const visible=node=>{
   for(let parent=node;parent;parent=parent.parent){
    if(parent.attribs?.hidden!==undefined)return false;
    if(parent.attribs?.id==='discovery'&&dataset.readerContent==='knowledge'&&dataset.entryView==='start'&&!('worldExplore'in dataset))return false;
    if(dataset.worldExplore==='active'&&parent.name==='section'&&parent.parent===main&&parent.attribs?.id!=='world-explore')return false;
   }
   return true;
  };
  assert.deepEqual(nodes(node=>node.name==='h1').filter(visible).map(node=>node.attribs.id),[expected],content+(world?' + world':''));
  assert.deepEqual(nodes(node=>node.name==='aside').filter(visible).map(node=>node.attribs.id),expected==='knowledge-title'?['knowledge-plan']:[]);
 }
});
test('all document element IDs are unique',()=>{const ids=all(n=>Boolean(n.attribs?.id)).map(n=>n.attribs.id);assert.equal(new Set(ids).size,ids.length);});
test('personalisation is an initially closed labelled native dialog',()=>{const dialog=byId('personalise');assert.equal(dialog.name,'dialog');assert.equal(dialog.attribs.open,undefined);assert.equal(dialog.attribs['aria-labelledby'],'focus-title');assert.ok(byId('close-focus'));assert.match(js,/panel\.showModal\(\)/u);assert.match(js,/panel\.close\(\)/u);});
test('exactly three primary modes; full source records remain accessible in More',()=>{const nav=all(n=>n.attribs?.class==='view-switch')[0];const buttons=DomUtils.findAll(n=>n.name==='button',nav.children);assert.deepEqual(buttons.map(b=>b.attribs['data-view']),['briefing','changes','saved']);const records=all(n=>n.attribs?.['data-view']==='records');assert.equal(records.length,1);assert.ok(DomUtils.textContent(byId('reader-more')).includes('Explore all records'));});
test('personal settings controls retain labels and existing functional IDs',()=>{for(const id of['query','budget'])assert.ok(all(n=>n.name==='label'&&n.attribs.for===id).length===1);for(const id of['remember-focus','forget-focus','clear-device','confirm-clear','save-check','forget-check','download-reading-copy','download-edition'])assert.ok(byId(id));});
test('data storage and coverage limitations remain explicit through the compact legal footer',()=>{
 assert.match(html,/only in this browser/u);assert.match(html,/not full-document summaries/u);assert.match(html,/not the whole web/u);
 const footer=all(n=>n.name==='footer'&&n.attribs?.class?.split(/\s+/u).includes('site-footer'))[0];assert.ok(footer);
 const links=DomUtils.findAll(n=>n.name==='a',footer.children);
 for(const route of ['/terms','/privacy','/sources'])assert.equal(links.filter(link=>link.attribs.href===route).length,1,route+' remains directly accessible in the footer');
 const terms=readFileSync('public/terms.html','utf8'),privacy=readFileSync('public/privacy.html','utf8'),sources=readFileSync('public/sources.html','utf8');
 assert.match(terms,/Public reading is currently free and does not start a subscription or a trial/u);
 assert.match(terms,/No paid checkout, automatic charge or scheduled account delivery is activated/u);
 assert.match(privacy,/My profile and Info Wallet use the same optional private preference record/u);
 assert.match(privacy,/These actions are not automatic background sync or a merge/u);
 assert.match(privacy,/Connecting an available provider requires a separate OAuth authorization/u);
 assert.match(sources,/Extracted passages are selected passages, not a complete report/u);
 assert.match(sources,/partial coverage of connected sources, not a search of every page on the web/u);
});
test('reduced motion and keyboard focus styling preserved',()=>{assert.match(css,/@media\(prefers-reduced-motion:reduce\)/u);assert.match(css,/:focus-visible/u);assert.match(html,/Skip to briefing/u);});
test('source detail disclosure preserves unabridged titles and full dates behind translated labels',()=>{assert.match(js,/\[tr\('originalTitle'\),card.title\]/u);assert.match(js,/\[tr\('published'\),formatted\(card.date,card.dateLabel==='Document date'\)\]/u);assert.match(js,/originalText\(detail\)/u);assert.match(css,/-webkit-line-clamp:4/u);});
test('form application exits alternate modes and no longer opens automatically on desktop',()=>{assert.match(js,/event.preventDefault\(\);changesView=false;savedView=false;mode='briefing'/u);assert.doesNotMatch(js,/min-width:901px/u);});
test('reader adds no remote fonts or new API destinations and keeps real account navigation without DLKT World',()=>{
 assert.doesNotMatch(html,/fonts\.google|use\.typekit|cdn\./u);assert.doesNotMatch(js,/https:\/\/api\./u);assert.doesNotMatch(html,/world\.dlkt\.ee|DLKT World/u);
 for(const route of ['account','wallet']){
  assert.ok(all(n=>n.name==='a'&&n.attribs?.href==='/'+route).length>0,'the reader links to /'+route);
  assert.ok(readFileSync('public/'+route+'.html','utf8').length>0,'the linked '+route+' page is published');
 }
});
