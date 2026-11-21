import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';

const base=process.env.ICEO_BASE??'http://127.0.0.1:3100';
const report={base,checkedAt:new Date().toISOString(),environment:'controlled public-source fixtures in a real browser',checks:[],errors:[],publicRequests:[]};
const check=(name,pass)=>{report.checks.push({name,passed:Boolean(pass)});assert.ok(pass,name);};
const initialDeadline=new Date(Date.now()+10*86400000).toISOString().slice(0,10),newDeadline=new Date(Date.now()+12*86400000).toISOString().slice(0,10);
let scenario='initial';
function sourceResponse(){
 const stamp=new Date(Date.now()-(scenario==='regressed'?900000:0)).toISOString();
 const revised=scenario==='revised',card={id:'a'.repeat(24),identity:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',title:scenario==='cancelled'?'Cancellation notice: saved-update fixture':scenario==='metadata'?'Reworded contract title':'Contract notice: saved-update fixture',topic:'opportunities',kind:'procurement-notice',sourceUrl:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',publisher:'European Central Bank',sourceIds:['ecb-procurement'],date:stamp,dateLabel:'Published',observedAt:stamp,contentHash:(revised?'c':'b').repeat(64),boundary:'Controlled publisher listing fixture.',deadline:revised?newDeadline:initialDeadline,version:null,attribution:'European Central Bank',sourceState:'verified',summary:revised?'The publisher revised its application instructions.':'The publisher requires the documents specified in the notice.'};
 const cards=scenario==='missing'?[]:[card];
 const source={id:'ecb-procurement',label:'ECB procurement',publisher:'European Central Bank',topic:'opportunities',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:cards.length,rejected:0,error:null,retryAt:null,scope:'Current source listings',termsUrl:'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',windowed:true};
 return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:stamp,state:'ready',sources:[source],cards,conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['opportunities']};
}
await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
 await context.route('**/api/iceo',async route=>{
  const request=route.request();report.publicRequests.push({url:request.url(),method:request.method(),body:request.postData()});
  await route.fulfill({status:scenario==='failed'?503:200,contentType:'application/json',body:scenario==='failed'?'{}':JSON.stringify(sourceResponse())});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base,{waitUntil:'networkidle'});
 await page.locator('#discovery-cards [data-save-card]').first().click();
 await page.waitForFunction(()=>document.querySelector('#memory-status')?.textContent.includes('Card saved'));
 const readSaved=()=>page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().read();});
 const original=await readSaved();check('ordinary-save-establishes-baseline-without-checkpoint',original.cards.length===1&&await page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return await new DeviceMemory().readCheckpoint()===null;}));
 scenario='revised';await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#return-copy')?.textContent.includes('1 saved card has a changed listed detail'));
 check('return-shows-material-change-without-separate-setup',await page.locator('#return-title').textContent()==='Your saved information.');
 check('publisher-wording-is-counted-separately',await page.locator('#return-copy').textContent().then(value=>value.includes('1 with revised publisher wording')));
 const requestsBefore=report.publicRequests.length;await page.locator('#return-open').click();
 await page.locator('#cards [data-saved-update=changed]').waitFor();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
 check('saved-opening-rechecks-the-existing-public-snapshot',report.publicRequests.length>requestsBefore);
 check('exact-deadline-before-and-after-visible',await page.locator('#cards .saved-update').innerText().then(value=>value.includes(initialDeadline)&&value.includes(newDeadline)));
 await page.locator('#cards .saved-update details>summary').click();
 check('wording-change-is-not-presented-as-inferred-price-or-eligibility',await page.locator('#cards .saved-update').innerText().then(value=>value.includes('does not establish a changed price')&&value.includes('Saved: The publisher requires')&&value.includes('Current: The publisher revised')));
 check('view-and-refresh-do-not-overwrite-saved-copy',JSON.stringify((await readSaved()).cards)===JSON.stringify(original.cards));
 scenario='regressed';await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.querySelector('#return-copy')?.textContent.includes('An older source response was ignored'));
 check('regressed-success-does-not-erase-verified-change',await page.locator('#cards [data-saved-update=changed]').count()===1&&await page.locator('#return-copy').textContent().then(value=>value.includes('1 saved card has a changed listed detail')));
 scenario='cancelled';await page.locator('#refresh').click();
 await page.waitForFunction(()=>document.querySelector('#cards .saved-update')?.textContent.includes('Procedure notice type: saved Contract notice → current Cancellation notice'));
 check('explicit-cancellation-is-shown-without-inventing-deadline-or-price-changes',await page.locator('#cards .saved-update').innerText().then(value=>value.includes('Cancellation notice')&&!value.includes('Listed closing date: saved')));
 scenario='metadata';await page.reload({waitUntil:'networkidle'});
 await page.waitForFunction(()=>document.querySelector('#return-copy')?.textContent.includes('0 saved cards have a changed listed detail'));
 check('title-date-and-check-time-only-changes-do-not-alert',await page.locator('#return-copy').textContent().then(value=>value.includes('0 with revised publisher wording')));
 scenario='failed';await page.locator('#return-refresh').click();
 await page.waitForFunction(()=>document.querySelector('#return-copy')?.textContent.includes('Current checks are unavailable'));
 check('failed-refresh-is-not-a-no-change-result',await page.locator('#return-copy').textContent().then(value=>value.includes('not a no-change result')));
 check('failed-refresh-retains-original-copy',JSON.stringify((await readSaved()).cards)===JSON.stringify(original.cards));
 scenario='missing';await page.locator('#return-refresh').click();
 await page.waitForFunction(()=>document.querySelector('#return-copy')?.textContent.includes('no longer appear in the checked feed'));
 await page.locator('#return-open').click();await page.locator('#cards [data-saved-update=not-in-current-feed]').waitFor();
 check('rolling-feed-absence-does-not-erase-or-resolve-saved-card',await page.locator('#cards .saved-update').innerText().then(value=>value.includes('does not establish cancellation, withdrawal or resolution'))&&(await readSaved()).cards.length===1);
 scenario='initial';const blocked=await context.newPage();await blocked.addInitScript(()=>Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Blocked','SecurityError');},configurable:true}));await blocked.goto(base,{waitUntil:'networkidle'});await blocked.locator('#discovery-cards [data-save-card]').first().click();await blocked.waitForFunction(()=>document.querySelector('#memory-status')?.textContent.includes('Nothing new was saved'));
 check('storage-failure-keeps-reading-and-never-claims-save',await blocked.locator('#discovery-cards .info-card').count()>0&&await blocked.locator('#memory-status').textContent().then(value=>value.includes('Reading still works')));await blocked.close();
 check('saved-identities-never-enter-public-requests',report.publicRequests.every(request=>new URL(request.url).pathname==='/api/iceo'&&!new URL(request.url).search&&request.method==='GET'&&request.body===null));
 check('no-page-errors',report.errors.length===0);
 writeFileSync('/tmp/dlkt-saved-updates-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.checks.filter(item=>item.passed).length,total:report.checks.length}));
}catch(error){writeFileSync('/tmp/dlkt-saved-updates-browser-report.json',JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
