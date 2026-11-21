import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import chromium from '@sparticuz/chromium';
import {chromium as pw} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';
const base=process.env.ICEO_BASE??'http://127.0.0.1:3100';
const report={base,checkedAt:new Date().toISOString(),checks:[],errors:[],scope:'Real source metadata; controlled changed-record and outage responses only inside isolated browser'};
const check=(name,pass,details=null)=>{report.checks.push({name,passed:!!pass,details});assert.ok(pass,name);};
await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await pw.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const ctx=await browser.newContext({viewport:{width:390,height:844},locale:'en-GB',timezoneId:'Europe/Bucharest',reducedMotion:'reduce'});
 const page=await ctx.newPage();page.setDefaultTimeout(20000);page.on('pageerror',e=>report.errors.push(e.message));
 const ready=()=>page.waitForFunction(()=>document.body.dataset.entryView==='daily'&&!document.querySelector('#daily-refresh').disabled&&document.querySelectorAll('#daily-cards article').length===1);
 const state=()=>page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().readDaily();});
 await page.goto(base,{waitUntil:'networkidle'});await page.locator('#entry-daily').click();await page.locator('[name=daily-topic][value=business]').check();await page.locator('#daily-budget').fill('1');await page.locator('#daily-settings [type=submit]').click();await ready();
 check('preview-does-not-persist',await state()===null);
 const initialId=await page.locator('#daily-cards article').getAttribute('data-daily-id');await page.locator('#daily-save').click();await page.waitForFunction(()=>document.querySelector('#daily-feedback').textContent.includes('saved here'));
 const first=await state();check('one-displayed-card-and-larger-source-baseline',first.edition.records.length===1&&first.edition.comparison.length>1,{displayed:first.edition.records.length,compared:first.edition.comparison.length});
 for(let i=1;i<=4;i++){
  await page.reload({waitUntil:'networkidle'});await ready();
  check('identical-check-keeps-selection-'+i,await page.locator('#daily-cards article').getAttribute('data-daily-id')===initialId);
  check('identical-check-is-not-promoted-as-new-'+i,await page.locator('#daily-cards>.daily-card').count()===0&&await page.locator('#daily-previous article').count()===1);
 }
 const stable=await state();const candidate=stable.edition.comparison.find(c=>!stable.edition.records.some(v=>v.id===c.id));assert.ok(candidate);
 const original=await(await ctx.request.get(base+'/api/iceo')).json();const altered=structuredClone(original);const target=altered.cards.find(c=>c.id===candidate.id);assert.ok(target);target.title+=' — controlled publisher correction';
 await page.route('**/api/iceo',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(altered)}));await page.locator('#daily-refresh').click();await ready();
 const changed=page.locator('#daily-cards>.daily-card');
 check('change-outside-reading-budget-becomes-visible',await changed.count()===1&&await changed.getAttribute('data-daily-id')==='topic:'+candidate.id);
 check('change-keeps-exact-previous-and-current-evidence',await changed.textContent().then(t=>t.includes(candidate.title)&&t.includes('controlled publisher correction')));
 await page.locator('#daily-refresh').click();await ready();
 check('same-corrected-source-does-not-resurface-other-old-card',await page.locator('#daily-cards article').getAttribute('data-daily-id')==='topic:'+candidate.id&&await page.locator('#daily-cards>.daily-card').count()===0);
 const beforeError=await state();await page.unroute('**/api/iceo');await page.route('**/api/iceo',r=>r.fulfill({status:503,contentType:'application/json',body:'{}'}));await page.locator('#daily-refresh').click();await page.waitForFunction(()=>!document.querySelector('#daily-refresh').disabled);
 check('source-failure-preserves-full-comparison',(await state()).revision===beforeError.revision);
 check('source-failure-is-not-clear-or-empty-success',await page.locator('.daily-overview').textContent().then(t=>t.includes('incomplete')));
 await page.unroute('**/api/iceo');await page.locator('#daily-refresh').click();await ready();
 const legacyId=await page.locator('#daily-cards article').getAttribute('data-daily-id');
 await page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');const m=new DeviceMemory(),s=await m.readDaily();const{comparison,...edition}=s.edition;await m.writeDaily({version:s.version,profile:s.profile,edition,feedback:s.feedback},s.revision);});
 await page.reload({waitUntil:'networkidle'});await ready();
 check('old-stored-edition-restores-without-reset-or-fake-novelty',await page.locator('#daily-cards article').getAttribute('data-daily-id')===legacyId&&await page.locator('#daily-cards>.daily-card').count()===0);
 check('legacy-edition-gains-bounded-source-comparison',(await state()).edition.comparison.length>1);
 await page.locator('#daily-previous>summary').click();await page.locator('#daily-previous [data-daily-feedback=not-today]').click();await ready();
 check('not-today-shows-available-alternative-not-new-update',await page.locator('#daily-cards .daily-change').textContent().then(t=>t.includes('not a new update')));
 check('no-overflow-390',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:320,height:780});check('no-overflow-320',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 check('no-javascript-errors',report.errors.length===0,report.errors);
 report.passed=report.checks.filter(c=>c.passed).length;report.total=report.checks.length;writeFileSync('/tmp/r0912-stability-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,passed:report.passed,total:report.total,compared:first.edition.comparison.length}));
}catch(e){writeFileSync('/tmp/r0912-stability-browser-failure.json',JSON.stringify(report,null,2));throw e;}finally{await browser.close();}
