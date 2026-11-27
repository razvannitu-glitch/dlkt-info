import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const PATH='/__qa/editorial-source-intent.js';
export function editorialIntentFixture(req,res,url){
 if(url.pathname!==PATH)return false;
 if(url.search||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return true;}
 const source=readFileSync(new URL('../source/.build/src/audience/editorial-source-intent.js',import.meta.url),'utf8');
 res.setHeader('Content-Type','text/javascript; charset=utf-8');res.writeHead(200).end(req.method==='HEAD'?undefined:source);return true;
}
// Real canonical reader DOM and native CDP gestures, not synthetic card markup.
// The test-only document bubble listener blocks actual publisher navigation
// AFTER the feed listener observes the intent; no external request is needed.
export async function verifyEditorialIntent({origin,openIsolated,evaluate,loaded,pause,keyboard,selectControlledEdition,fixture}){
 const measurements=[];
 for(const format of [{width:390,height:844,mobile:true},{width:1440,height:900,mobile:false}]){
  const browser=await openIsolated(),call=browser.call;
  const run=body=>evaluate(call,'(()=>{'+body+';return true;})()');
  const snapshot=()=>evaluate(call,'window.__editorialQA.controller.snapshot()');
  const sum=async()=>{const s=await snapshot();assert.equal(s.status,'collecting');return s.rows.reduce((a,r)=>({exposures:a.exposures+r.qualifiedImpressions,intents:a.intents+r.sourceIntents}),{exposures:0,intents:0});};
  const until=async(fn,label)=>{
   for(let i=0;i<90;i++){if(await fn())return;const s=await snapshot();assert.equal(s.status,'collecting','unexpected terminal state during '+label);await pause(100);}
   // Controlled fixture geometry and identity-shape diagnostics only; never log source URLs or identifiers.
   const detail=await evaluate(call,`(()=>{const q=window.__editorialQA,n=document.querySelector(q.selector),r=n?.getBoundingClientRect(),v=window.visualViewport;
    const width=v?.width??innerWidth,height=v?.height??innerHeight,left=v?.offsetLeft??0,top=v?.offsetTop??0;
    const ratio=r&&r.width>0&&r.height>0?Math.max(0,Math.min(r.right,left+width)-Math.max(r.left,left))*Math.max(0,Math.min(r.bottom,top+height)-Math.max(r.top,top))/(r.width*r.height):null;
    return {snapshot:q.controller.snapshot(),focused:document.hasFocus(),visibility:document.visibilityState,entryView:document.body.dataset.entryView,exploring:!!document.body.dataset.worldExplore,modal:!!document.querySelector('dialog[open]'),connected:!!n,geometry:{width:r?.width,height:r?.height,ratio,viewportWidth:width,viewportHeight:height},
     canonicalIdentity:!!(n&&q.module.readerSourceIntentIdentity(n.dataset.cardId,n.dataset.newsStreamKey,n.dataset.newsCategory,n.dataset.storyKey)),storyForm:n?.dataset.storyKey?.startsWith('article:')?'article-fallback':n?.dataset.storyKey?.startsWith('story:')?'grouped':'other'};
   })()`);
   throw Error('DLKT_EDITORIAL_INTENT_TIMEOUT_'+label+'_'+format.width+'_'+JSON.stringify(detail));
  };
  try{
   await call('Emulation.setDeviceMetricsOverride',{...format,deviceScaleFactor:1,scale:1});
   await call('Emulation.setFocusEmulationEnabled',{enabled:true});
   await call('Page.navigate',{url:origin+'/'});await loaded(call);await call('Page.bringToFront');await selectControlledEdition(call,fixture);
   const inactive=await evaluate(call,`(async()=>{const module=await import('${PATH}');window.__editorialQA={module,permit:null,controller:module.startEditorialSourceIntent(()=>null),gestures:[]};return window.__editorialQA.controller.snapshot();})()`);
   assert.equal(inactive.status,'stopped');assert.deepEqual(inactive.rows,[]);
   const target=await evaluate(call,`(()=>{const q=window.__editorialQA,root=document.getElementById('discovery-cards');const cards=[...root.querySelectorAll(':scope > article.info-card.editorial-card[data-news-category="13000000"][data-edition-part="stream"]')];const card=cards.find(n=>{const t=n.querySelector('h3 > a.card-title-link'),a=n.querySelector('.card-actions > a.source-link'),r=n.getBoundingClientRect();return t&&a&&t.href===a.href&&t.protocol==='https:'&&r.height>0&&r.height<innerHeight*1.9;});if(!card)throw Error('ELIGIBLE_REAL_CARD_REQUIRED');const id=card.dataset.cardId;q.selector='#discovery-cards > article[data-card-id="'+id+'"]';q.originalNodes=[...root.children];document.addEventListener('click',event=>{const a=event.target instanceof Element?event.target.closest('a'):null;if(a&&a.closest(q.selector)){q.gestures.push({trusted:event.isTrusted,primary:a.matches('.card-title-link,.source-link'),prevented:event.defaultPrevented});event.preventDefault();}});return {category:card.dataset.newsCategory,hasPrimaryLinks:true};})()`);
   assert.equal(target.category,'13000000');assert.equal(target.hasPrimaryLinks,true);
   const canonical=await evaluate(call,`(()=>{const q=window.__editorialQA,n=document.querySelector(q.selector);return !!q.module.readerSourceIntentIdentity(n.dataset.cardId,n.dataset.newsStreamKey,n.dataset.newsCategory,n.dataset.storyKey);})()`);
   assert.equal(canonical,true,'actual reader presentation key binds to canonical measurement identity');
   const focus=selector=>run("const q=window.__editorialQA,link=document.querySelector(q.selector+' "+selector+"');link.scrollIntoView({block:'center',behavior:'instant'});link.focus({preventScroll:true});if(document.activeElement!==link)throw Error('INTENT_FOCUS')");
   await focus('h3 > a.card-title-link');
   const begin="const q=window.__editorialQA,now=Date.now();q.permit={state:'confirmed',purpose:q.module.SOURCE_INTENT_PURPOSE,noticeVersion:q.module.SOURCE_INTENT_NOTICE,pilotEligible:true,revision:1,issuedAt:now,expiresAt:now+60000};q.controller=q.module.startEditorialSourceIntent(()=>q.permit)";
   await run(begin);
   await keyboard(call,'Enter');
   assert.equal((await sum()).intents,0,'trusted activation before qualification does not enter numerator');
   await run("document.querySelector(window.__editorialQA.selector).scrollIntoView({block:'center',behavior:'instant'})");
   await until(async()=>{const s=await snapshot();return s.status==='collecting'&&s.rows.some(r=>r.category==='13000000'&&r.qualifiedImpressions>0);},'EXPOSURE');
   await run("document.querySelector(window.__editorialQA.selector+' h3 > a.card-title-link').click()");
   assert.equal((await sum()).intents,0,'programmatic click does not qualify');
   await focus('h3 > a.card-title-link');await pause(350);
   await keyboard(call,'Enter');
   await until(async()=>(await sum()).intents===1,'TRUSTED_KEYBOARD');
   const coordinate=await evaluate(call,`(()=>{const q=window.__editorialQA,a=document.querySelector(q.selector+' .card-actions > a.source-link');a.scrollIntoView({block:'center',behavior:'instant'});const r=a.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
   await pause(350);
   assert.equal(await evaluate(call,`document.elementFromPoint(${coordinate.x},${coordinate.y})?.closest('a')===document.querySelector(window.__editorialQA.selector+' .card-actions > a.source-link')`),true);
   if(format.mobile){
    await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
    await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[coordinate]});
    await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
   }else{
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...coordinate,button:'left',clickCount:1});
    await call('Input.dispatchMouseEvent',{type:'mouseReleased',...coordinate,button:'left',clickCount:1});
   }
   await pause(200);
   assert.equal((await sum()).intents,1,'second primary-link activation for the same qualified card is deduplicated');
   const gestures=await evaluate(call,'window.__editorialQA.gestures');
   assert.ok(gestures.some(g=>!g.trusted&&g.primary));assert.ok(gestures.filter(g=>g.trusted&&g.primary&&!g.prevented).length>=3,'native keyboard and pointer/touch activations reached the original anchor');
   assert.equal(await evaluate(call,'window.__editorialQA.originalNodes.every(n=>n.isConnected)'),true,'the candidate does not replace the reader cards');
   const measured=await snapshot();assert.ok(measured.rows.every(r=>r.sourceIntents<=r.qualifiedImpressions));
   await run("window.__editorialQA.permit=null");
   assert.equal((await snapshot()).status,'stopped');assert.deepEqual((await snapshot()).rows,[]);
   const blocked=await evaluate(call,`(()=>{const q=window.__editorialQA,now=Date.now();Object.defineProperty(navigator,'globalPrivacyControl',{value:true,configurable:true});q.permit={state:'confirmed',purpose:q.module.SOURCE_INTENT_PURPOSE,noticeVersion:q.module.SOURCE_INTENT_NOTICE,pilotEligible:true,revision:2,issuedAt:now,expiresAt:now+60000};q.controller=q.module.startEditorialSourceIntent(()=>q.permit);return q.controller.snapshot();})()`);
   assert.equal(blocked.status,'stopped');assert.deepEqual(blocked.rows,[]);
   measurements.push({viewport:format.width,qualifiedExposure:true,preQualificationExcluded:true,syntheticClickExcluded:true,keyboardIntent:true,nativePointerOrTouch:true,deduplicated:true,withdrawalClears:true,gpcBlocked:true,productionActivation:false});
  }finally{await browser.close();}
 }
 return {status:'EDITORIAL_READER_INTENT_PASS',measurements,scope:'actual canonical reader and controlled corpus; explicit fixture permission, native gestures with outbound navigation blocked; no real consent or collection'};
}
