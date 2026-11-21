import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import chromium from '@sparticuz/chromium';
import {chromium as pw} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';
const base=process.env.ICEO_BASE??'http://127.0.0.1:3100';
const report={base,checkedAt:new Date().toISOString(),checks:[],errors:[],scenarios:['live source selection and saved return','controlled publisher-title change','controlled unavailable source','clock-only 1-hour source expiry','controlled operational expiry','local date rollover','persisted-page restoration']};
const check=(name,pass,details=null)=>{report.checks.push({name,passed:!!pass,details});assert.ok(pass,name);};
await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await pw.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'en-GB',timezoneId:'Europe/Bucharest',reducedMotion:'reduce'});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
 const state=()=>page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().readDaily();});
 const ready=()=>page.waitForFunction(()=>document.body.dataset.entryView==='daily'&&!document.querySelector('#daily-refresh').disabled&&document.querySelectorAll('#daily-cards article').length>0);
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#entry-daily').click();if(await page.locator('#daily-more').getAttribute('open')===null){await page.locator('#daily-more>summary').click();}await page.locator('[name=daily-topic][value=technology]').check();await page.locator('#daily-settings [type=submit]').click();await ready();
 check('first-preview-shows-cards-without-previous-section',await page.locator('#daily-cards>.daily-card').count()>0&&await page.locator('#daily-previous').count()===0);
 await page.locator('#daily-save').click();await page.waitForFunction(()=>document.querySelector('#daily-feedback').textContent.includes('saved here'));await page.reload({waitUntil:'networkidle'});await ready();
 check('saved-return-opens-directly',await page.evaluate(()=>document.body.dataset.entryView==='daily'));
 check('unchanged-topics-are-not-repeated-in-primary-reading',await page.locator('#daily-cards>.daily-card').count()===0);
 check('previous-topics-remain-accessible-collapsed',await page.locator('#daily-previous').isVisible()&&await page.locator('#daily-previous').getAttribute('open')===null&&await page.locator('#daily-previous article').count()>0);
 check('overview-explains-retained-not-read',await page.locator('.daily-overview').textContent().then(t=>t.includes('unchanged'))&&await page.locator('#daily-previous').textContent().then(t=>t.includes('not marked as read')));
 await page.locator('#daily-previous>summary').click();check('opening-previous-exposes-card',await page.locator('#daily-previous article').first().isVisible());
 const baseline=await state();const chosen=baseline.edition.records[0];const original=await(await ctx.request.get(base+'/api/iceo')).json();assert.ok(original.cards.some(c=>c.id===chosen.id));
 const altered=structuredClone(original);altered.cards.find(c=>c.id===chosen.id).title+=' — controlled wording correction';
 await page.route('**/api/iceo',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(altered)}));await page.locator('#daily-refresh').click();await ready();
 const changed=page.locator(`#daily-cards>.daily-card[data-daily-id="topic:${chosen.id}"]`);
 check('material-change-is-promoted-from-disclosure',await changed.isVisible());
 check('change-explains-what-moved-without-inventing-impact',await changed.locator('.card-context').allTextContents().then(t=>t.some(x=>x.includes('publisher title changed'))));
 await changed.locator('details.evidence>summary').click();check('before-after-source-wording-is-retained',await changed.locator('details.evidence').textContent().then(t=>t.includes(chosen.title)&&t.includes('controlled wording correction')));
 await page.unroute('**/api/iceo');const beforeFailure=await state();await page.route('**/api/iceo',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.locator('#daily-refresh').click();await page.waitForFunction(()=>!document.querySelector('#daily-refresh').disabled);
 check('failed-check-is-not-a-no-change-success',await page.locator('.daily-overview').textContent().then(t=>t.includes('not confirmation that nothing changed')));
 check('failed-check-does-not-advance-complete-memory',(await state()).revision===beforeFailure.revision);
 await page.unroute('**/api/iceo');await page.locator('#daily-refresh').click();await ready();page.once('dialog',d=>d.accept());await page.locator('#daily-forget').click();await page.waitForFunction(()=>document.querySelector('#daily-feedback').textContent.includes('removed'));
 check('forget-clears-visible-comparison-not-just-storage',await state()===null&&await page.locator('#daily-changes').isHidden()&&await page.locator('#daily-previous').count()===0);
 // Clock scenarios are isolated, use a real source payload with deliberately controlled times,
 // and never alter upstream data or public users' data.
 const clockPage=await ctx.newPage();clockPage.setDefaultTimeout(20000);clockPage.on('pageerror',e=>report.errors.push(e.message));
 const at=Date.now(),nowStamp=new Date(at).toISOString(),fixture=structuredClone(original);
 fixture.generatedAt=nowStamp;fixture.sources.forEach(s=>{s.checkedAt=nowStamp;if(s.verifiedAt!==null)s.verifiedAt=nowStamp;});fixture.cards.forEach(c=>c.observedAt=nowStamp);
 let sourceRequests=0;await clockPage.route('**/api/iceo',r=>{sourceRequests++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(fixture)});});
 await clockPage.clock.install({time:new Date(at)});
 await clockPage.goto(base,{waitUntil:'networkidle'});await clockPage.locator('#entry-daily').click();if(await clockPage.locator('#daily-more').getAttribute('open')===null){await clockPage.locator('#daily-more>summary').click();}await clockPage.locator('[name=daily-topic][value=technology]').check();await clockPage.locator('#daily-settings [type=submit]').click();await clockPage.waitForFunction(()=>!document.querySelector('#daily-refresh').disabled&&document.querySelectorAll('#daily-cards article').length>0);await clockPage.locator('#daily-save').click();await clockPage.waitForFunction(()=>document.querySelector('#daily-feedback').textContent.includes('saved here'));
 const memoryBefore=await clockPage.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().readDaily();});const requestsBefore=sourceRequests;
 await clockPage.clock.fastForward(3_600_200);
 check('visible-tab-clock-withdraws-expired-topic-checks',await clockPage.locator('#daily-cards article').count()===0);
 check('clock-expiry-says-checks-incomplete',await clockPage.locator('.daily-overview').textContent().then(t=>t.includes('incomplete')));
 check('clock-expiry-does-not-poll-source',sourceRequests===requestsBefore);
 const memoryAfter=await clockPage.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().readDaily();});
 check('clock-expiry-preserves-last-complete-edition',memoryBefore.revision===memoryAfter.revision&&JSON.stringify(memoryBefore.edition)===JSON.stringify(memoryAfter.edition));
 // BFCache restoration cannot show a fresh-looking old check.
 await clockPage.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));
 check('back-forward-restoration-keeps-expired-cards-withdrawn',await clockPage.locator('#daily-cards article').count()===0);
 await clockPage.close();
 // Clear only test profile, then exercise a short-lived local operational fixture.
 await page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');const m=new DeviceMemory(),s=await m.readDaily();if(s)await m.writeDaily(null,s.revision);});
 const localPage=await ctx.newPage();localPage.setDefaultTimeout(20000);localPage.on('pageerror',e=>report.errors.push(e.message));const localAt=Date.now();await localPage.clock.install({time:new Date(localAt)});
 const localPayload=await(await ctx.request.get(base+'/api/local?city=683506')).json();assert.equal(localPayload.weatherState,'ready');
 const localFixture=structuredClone(localPayload);localFixture.checkedAt=new Date(localAt).toISOString();for(const c of localFixture.cards){c.checkedAt=localFixture.checkedAt;c.validFrom=localFixture.checkedAt;c.validTo=new Date(localAt+120000).toISOString();}
 let localRequests=0;await localPage.route('**/api/local?city=683506',r=>{localRequests++;return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(localFixture)});});
 await localPage.goto(base);await localPage.locator('#entry-daily').click();await localPage.locator('#daily-city').click();await localPage.locator('#place-query').fill('Bucuresti');await localPage.locator('[data-city-id="683506"]').click();await localPage.locator('#daily-settings [type=submit]').click();await localPage.waitForFunction(()=>!document.querySelector('#daily-refresh').disabled&&document.querySelectorAll('#daily-cards article').length===1);
 check('forecast-heading-does-not-keep-relative-next-hours-promise',await localPage.locator('#daily-cards h3').textContent()==='Weather in Bucharest');const localRequestCount=localRequests;
 await localPage.clock.fastForward(120200);
 check('operational-card-is-withdrawn-at-expiry',await localPage.locator('#daily-cards article').count()===0);
 check('operational-expiry-keeps-manual-refresh-clear',await localPage.locator('#daily-status').textContent().then(t=>t.includes('expired')&&t.includes('Refresh')));
 check('operational-expiry-does-not-poll-upstream',localRequests===localRequestCount);
 await localPage.close();
 // Use a local midnight shortly after fresh topic observations, not a 24-hour UTC delay.
 const midnight=await ctx.newPage();midnight.on('pageerror',e=>report.errors.push(e.message));midnight.setDefaultTimeout(20000);
 const nearMidnight=Date.parse(new Date().toISOString().slice(0,10)+'T21:59:30Z');await midnight.clock.install({time:new Date(nearMidnight)});
 const nightFixture=structuredClone(original);nightFixture.generatedAt=new Date(nearMidnight).toISOString();nightFixture.sources.forEach(s=>{s.checkedAt=nightFixture.generatedAt;if(s.verifiedAt!==null)s.verifiedAt=nightFixture.generatedAt;});nightFixture.cards.forEach(c=>c.observedAt=nightFixture.generatedAt);
 await midnight.route('**/api/iceo',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(nightFixture)}));
 await midnight.goto(base);await midnight.locator('#entry-daily').click();if(await midnight.locator('#daily-more').getAttribute('open')===null){await midnight.locator('#daily-more>summary').click();}await midnight.locator('[name=daily-topic][value=technology]').check();await midnight.locator('#daily-settings [type=submit]').click();await midnight.waitForFunction(()=>!document.querySelector('#daily-refresh').disabled&&document.querySelectorAll('#daily-cards article').length>0);
 const first=midnight.locator('#daily-cards article').first(),id=await first.getAttribute('data-daily-id');await first.locator('[data-daily-feedback=not-today]').click();await midnight.waitForFunction(i=>!document.querySelector(`[data-daily-id="${i}"]`),id);
 check('not-today-removes-only-that-version-until-local-midnight',await midnight.locator(`[data-daily-id="${id}"]`).count()===0);await midnight.clock.fastForward(31000);
 check('next-local-date-restores-card-without-reload',await midnight.locator(`[data-daily-id="${id}"]`).count()===1);await midnight.close();
 check('no-javascript-errors-in-live-and-controlled-scenarios',report.errors.length===0,report.errors);
 report.passed=report.checks.filter(c=>c.passed).length;report.total=report.checks.length;writeFileSync('/tmp/r0911-clear-return-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,passed:report.passed,total:report.total,errors:report.errors}));
}catch(e){writeFileSync('/tmp/r0911-clear-return-failure.json',JSON.stringify(report,null,2));throw e;}finally{await browser.close();}
