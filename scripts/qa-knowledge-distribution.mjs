import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Loopback-only test adapter around the actual compiled HTTP handler.
 * Synthetic decisions exercise behavior; never populate runtime admissions.
 */
export async function knowledgeDistributionFixture(){
 const [{handleCard},{KNOWLEDGE_CARDS},{knowledgeContentDigest,resolveKnowledgeShareFromCatalogue,resolveKnowledgeShare},{knowledgeCardLink},{knowledgeRightsCandidates}]=await Promise.all([
  import('../source/.build/api/card.js'),
  import('../source/.build/src/iceo/knowledge-catalog.js'),
  import('../source/.build/src/share/knowledge-resolution.js'),
  import('../source/.build/src/share/link.js'),
  import('../source/tests/fixtures/knowledge-rights-candidates.mjs'),
 ]);
 const now=Date.parse('2026-11-26T12:00:00.000Z');
 const cards=KNOWLEDGE_CARDS.filter(card=>['dlkt-elsewhere-helsinki-shared-workshop','dlkt-elsewhere-paris-schoolyard-oasis'].includes(card.id));
 assert.equal(cards.length,2);
 const licensed=knowledgeRightsCandidates[0];
 assert.ok(licensed);assert.ok(!KNOWLEDGE_CARDS.some(card=>knowledgeContentDigest(card)===knowledgeContentDigest(licensed)));
 const admitted=KNOWLEDGE_CARDS.find(card=>card.id===licensed.id);assert.ok(admitted);assert.equal(knowledgeContentDigest(admitted),'d4c1df98ae87865402292c04c46811d60eee7ed3bde9583f1e16cd243611110e');
 let active=false,approved=true,clock=now,deadline=now+60000,layoutOnly=false,unexpectedIO=0;
 const digest=knowledgeContentDigest;
 const link=(card,language)=>knowledgeCardLink(card,language,digest(card));
 const failIO=async()=>{unexpectedIO++;throw Error('DLKT_KNOWLEDGE_QA_UNEXPECTED_IO');};
 const resolve=async(reference,at)=>{
  if(!approved)return resolveKnowledgeShare(reference,at);
  if(layoutOnly&&reference.id===licensed.id&&reference.revision===licensed.revision&&reference.digest===digest(licensed)){
   // Direct renderer coverage only. The licensed fixture is NOT catalogue-admitted.
   if(at>=deadline)return null;
   return {card:licensed,language:reference.language,digest:reference.digest,validUntil:deadline};
  }
  const admissions=cards.map(card=>({id:card.id,revision:card.revision,digest:digest(card),reviewedAt:Date.parse(card.reviewedAt),expiresAt:deadline}));
  return resolveKnowledgeShareFromCatalogue(reference,at,cards,admissions);
 };
 return {now,cards,licensed,admitted,link,get deadline(){return deadline;},get unexpectedIO(){return unexpectedIO;},
  configure({enabled=true,allow=true,at=now,until=now+60000,licensedLayout=false}={}){active=enabled;approved=allow;clock=at;deadline=until;layoutOnly=licensedLayout;},
  handle(req,res,url){
   if(!active||!(url.pathname.startsWith('/card/dlkt-elsewhere-')||(url.pathname==='/api/card'&&url.searchParams.get('id')?.startsWith('dlkt-elsewhere-'))))return false;
   void handleCard(req,res,failIO,failIO,()=>clock,null,resolve).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
   return true;
  },
 };
}

export async function verifyKnowledgeDistribution({fixture,origin,openIsolated,evaluate,loaded,focusSelector,keyboard,pause,outputDir}){
 const browser=await openIsolated(),call=browser.call,layouts=[],checks=[];
 const wait=async(expression)=>{for(let i=0;i<60;i++){if(await evaluate(call,expression))return;await pause(50);}throw Error('DLKT_KNOWLEDGE_BROWSER_TIMEOUT:'+expression);};
 const stateExpression="(()=>{const b=document.getElementById('shared-copy'),i=document.getElementById('shared-fallback'),f=document.getElementById('shared-freshness'),links=[...document.querySelectorAll('a[data-knowledge-share-url]')];return {buttonHidden:b.hidden,buttonDisabled:b.disabled,fallback:i.value,fallbackHidden:i.hidden,fallbackDisabled:i.disabled,expired:f.textContent===f.dataset.expiredMessage,links:links.map(a=>({href:a.getAttribute('href'),disabled:a.getAttribute('aria-disabled'),tabIndex:a.tabIndex})),writes:globalThis.__qaWrites.slice()};})()";
 const state=()=>evaluate(call,stateExpression);
 function disabled(s){
  assert.equal(s.buttonHidden,true);assert.equal(s.buttonDisabled,true);
  assert.equal(s.fallback,'');assert.equal(s.fallbackHidden,true);assert.equal(s.fallbackDisabled,true);
  assert.equal(s.expired,true);assert.equal(s.links.length,3);
  assert.ok(s.links.every(link=>link.href===null&&link.disabled==='true'&&link.tabIndex===-1));
 }
 const path=link=>new URL(link).pathname+new URL(link).search;
 async function open(card,language,{width=390,until=fixture.now+60000,licensedLayout=false,runtimeAdmission=false,at=fixture.now}={}){
  fixture.configure({until,licensedLayout,at,allow:!runtimeAdmission});
  const link=fixture.link(card,language);
  await call('Emulation.setDeviceMetricsOverride',{width,height:width<600?844:900,deviceScaleFactor:1,mobile:width<600,scale:1});
  await call('Page.navigate',{url:origin+path(link)});await loaded(call);
  await wait("Boolean(document.querySelector('[data-shared-knowledge-id]')) && document.getElementById('shared-copy').hidden===false && document.querySelectorAll('a[data-knowledge-share-url][href]').length===3");
  return link;
 }
 async function expire(eventExpression){
  return evaluate(call,"(()=>{globalThis.__qaNow=Number(document.getElementById('shared-freshness').dataset.validUntil);return "+eventExpression+";})()");
 }
 const save=async(name)=>{const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;assert.ok(typeof data==='string'&&data.length>=1000);writeFileSync(join(outputDir,name),Buffer.from(data,'base64'),{mode:0o600});return name;};
 try{
  await call('Page.bringToFront');await call('Network.enable');
  await call('Network.setBlockedURLs',{urls:['https://*']});
  await call('Page.addScriptToEvaluateOnNewDocument',{source:"globalThis.__qaNow="+fixture.now+";globalThis.__qaWrites=[];globalThis.__qaClipboardMode='write';Date.now=()=>globalThis.__qaNow;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{if(globalThis.__qaClipboardMode==='reject')throw Error('controlled clipboard denial');globalThis.__qaWrites.push(value);}}});"});
  for(const [card,language,width,licensedLayout,runtimeAdmission=false] of [
   [fixture.cards[0],'en',320,false],[fixture.cards[1],'ro',390,false],[fixture.cards[0],'it',1440,false],[fixture.licensed,'en',320,true],[fixture.licensed,'it',768,true],
   [fixture.admitted,'en',320,false,true],[fixture.admitted,'ro',390,false,true],[fixture.admitted,'it',1440,false,true],
  ]){
   const link=await open(card,language,{width,licensedLayout,runtimeAdmission,...(runtimeAdmission?{at:Date.parse(card.reviewedAt)+1000,until:Date.parse(card.reviewBy)}:{})});
   if(runtimeAdmission)await evaluate(call,'(globalThis.__qaNow='+String(Date.parse(card.reviewedAt)+1000)+',true)');
   const view=await evaluate(call,"(()=>{const a=document.querySelector('[data-shared-knowledge-id]'),f=document.getElementById('shared-freshness');return {width:innerWidth,scrollWidth:document.documentElement.scrollWidth,id:a.dataset.sharedKnowledgeId,language:document.documentElement.lang,title:a.querySelector('h1').textContent,body:a.innerText,source:a.querySelector('a.source-link').href,canonical:document.querySelector('link[rel=canonical]').href,meta:document.querySelector('meta[property=\"og:url\"]').content,until:Number(f.dataset.validUntil),credits:[...a.querySelectorAll('.card-credits a')].map(a=>a.href)};})()");
   assert.equal(view.id,card.id);assert.equal(view.language,language);assert.equal(view.title,card.copy[language].title);assert.ok(view.body.includes(card.copy[language].connection));
   assert.ok(view.body.includes(card.geography.label[language]));assert.equal(view.source,card.source.url);assert.equal(view.canonical,link);assert.equal(view.meta,link);
   assert.equal(view.until,fixture.deadline);assert.ok(view.scrollWidth<=view.width+2,'standalone layout overflow at '+width+'px');
   if(licensedLayout||runtimeAdmission)assert.ok(view.credits.includes('https://creativecommons.org/licenses/by/4.0/'),'licensed renderer shows credit and licence');
   if(runtimeAdmission){assert.ok(view.credits.includes('https://www.nsw.gov.au/nsw-government/about-website/copyright'));assert.ok(view.body.includes('© State of New South Wales. For current information go to www.nsw.gov.au.'));}
   for(const a of (await state()).links){assert.equal(a.disabled,'false');assert.equal(a.tabIndex,0);const target=new URL(a.href);assert.ok([...target.searchParams.values()].includes(link));}
   await focusSelector(call,'#shared-copy');await keyboard(call,'Enter');
   await wait('globalThis.__qaWrites.length===1');assert.deepEqual((await state()).writes,[link]);
   layouts.push({width,language,id:card.id,licensedRendererOnly:licensedLayout,runtimeAdmission,documentWidth:view.scrollWidth,screenshot:await save('dlkt-knowledge-share-'+width+'-'+language+'-'+(runtimeAdmission?'admission':licensedLayout?'licensed':'ordinary')+'.png')});
  }
  const card=fixture.cards[0],link=await open(card,'en');
  await expire("(document.getElementById('shared-copy').click(),true)");
  disabled(await state());assert.deepEqual((await state()).writes,[]);checks.push('exact-deadline-copy-denied-before-timer');
  for(const type of ['click','auxclick','pointerdown','keydown','contextmenu']){
   await open(card,'en');
   const allowed=await expire("document.querySelector('a[data-knowledge-share-url]').dispatchEvent(new Event("+JSON.stringify(type)+",{bubbles:true,cancelable:true}))");
   assert.equal(allowed,false,type);disabled(await state());
  }
  checks.push('expired-social-events-denied');
  await open(card,'ro');
  await evaluate(call,"(globalThis.__qaClipboardMode='reject',true)");
  await focusSelector(call,'#shared-copy');await keyboard(call,'Enter');
  await wait("document.getElementById('shared-fallback').hidden===false");
  assert.equal((await state()).fallback,fixture.link(card,'ro'));
  const allowed=await expire("document.getElementById('shared-fallback').dispatchEvent(new Event('copy',{bubbles:true,cancelable:true}))");
  assert.equal(allowed,false);disabled(await state());checks.push('expired-manual-fallback-copy-denied');
  await open(card,'it');
  await evaluate(call,"(globalThis.__qaClipboardMode='reject',true)");
  await focusSelector(call,'#shared-copy');await keyboard(call,'Enter');await wait("document.getElementById('shared-fallback').hidden===false");
  await expire("(document.dispatchEvent(new Event('visibilitychange')),true)");
  disabled(await state());checks.push('foreground-visibility-handler-clears-fallback');
  await open(card,'en');
  await expire("(window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})),true)");
  disabled(await state());checks.push('restored-page-expires');
  await open(card,'en',{until:fixture.now+1000});
  await expire('true');await wait("document.getElementById('shared-copy').disabled===true");
  disabled(await state());checks.push('actual-browser-timer-expires');
  await save('dlkt-knowledge-share-expired-390.png');
  fixture.configure({allow:false});
  const denied=await fetch(origin+path(link),{signal:AbortSignal.timeout(2000)});
  assert.equal(denied.status,404);assert.ok(!(await denied.text()).includes(card.copy.en.title));
  checks.push('real-runtime-unapproved-admission-denies');
  const finalCard=fixture.admitted,finalLink=fixture.link(finalCard,'ro');
  fixture.configure({allow:false,at:Date.parse(finalCard.reviewBy)});
  assert.equal((await fetch(origin+path(finalLink),{signal:AbortSignal.timeout(2000)})).status,404);
  fixture.configure({allow:false,at:Date.parse(finalCard.reviewedAt)+1000});
  assert.equal((await fetch(origin+path(fixture.link(fixture.licensed,'ro')),{signal:AbortSignal.timeout(2000)})).status,404);
  checks.push('actual-admission-expiry-and-laboratory-digest-denial');
  fixture.configure({at:fixture.now+60000});
  const expired=await fetch(origin+path(link),{signal:AbortSignal.timeout(2000)});
  assert.equal(expired.status,404);checks.push('server-denies-expired-reference');
  assert.equal(fixture.unexpectedIO,0);
  const report={status:'KNOWLEDGE_DISTRIBUTION_BROWSER_PASS',scope:'Actual compiled handler, packaged public modules and real headless Chromium DOM; synthetic legacy admissions plus actual branch NSW admission; controlled clock/clipboard, visibility and restored-page events; no social posting or production publication',layouts,checks,unexpectedIO:fixture.unexpectedIO};
  writeFileSync(join(outputDir,'knowledge-distribution.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
  console.log('DLKT_KNOWLEDGE_DISTRIBUTION_BROWSER '+JSON.stringify(report));
  return report;
 }finally{fixture.configure({enabled:false});await browser.close();}
}
