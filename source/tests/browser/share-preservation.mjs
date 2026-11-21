import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';

const base=process.env.ICEO_BASE??'http://127.0.0.1:3100';
const report={base,checkedAt:new Date().toISOString(),environment:'controlled public snapshot and archive responses in a real browser',checks:[],errors:[],archiveRequests:[]};
const check=(name,pass)=>{report.checks.push({name,passed:Boolean(pass)});assert.ok(pass,name);};
const id='a'.repeat(24),revision='b'.repeat(64),path='/card/'+id+'?v='+revision,link='https://www.dlkt.ee'+path;
let scenario='pending',release;
const held=new Promise(resolve=>{release=resolve;});
function snapshot(){
 const stamp=new Date().toISOString(),card={id,identity:'https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html',title:'A useful publisher statement',topic:'business',kind:'publication',sourceUrl:'https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html',publisher:'European Central Bank',sourceIds:['ecb-news'],date:stamp,dateLabel:'Published',observedAt:stamp,contentHash:revision,boundary:'Controlled publisher listing fixture.',deadline:null,version:null,attribution:'European Central Bank',sourceState:'verified',summary:'The publisher describes the reporting period and its limits.',privateQuery:'private-query-sentinel',savedHistory:['private-history-sentinel']};
 const source={id:'ecb-news',label:'ECB publications',publisher:'European Central Bank',topic:'business',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:1,rejected:0,error:null,retryAt:null,scope:'Controlled source fixture.',termsUrl:'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',windowed:true};
 return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:stamp,state:'ready',sources:[source],cards:[card],conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['business']};
}

await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
 await context.addCookies([{name:'private-session-fixture',value:'private-cookie-sentinel',url:base}]);
 await context.addInitScript(()=>{
  Object.defineProperty(navigator,'share',{configurable:true,value:async payload=>{window.__nativeShare={payload,active:navigator.userActivation.isActive};}});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copiedLink=value;}}});
 });
 await context.route('**/api/iceo',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot())}));
 await context.route('**/api/share-archive',async route=>{
  const request=route.request(),mode=scenario;report.archiveRequests.push({method:request.method(),url:request.url(),body:request.postDataJSON(),headers:request.headers()});
  if(mode==='pending')await held;
  await route.fulfill({status:mode==='failure'?503:200,contentType:'application/json',body:JSON.stringify(mode==='failure'?{error:'SHARE_ARCHIVE_UNAVAILABLE'}:{state:'preserved',path:mode==='wrong-revision'?'/card/'+id+'?v='+'c'.repeat(64):path})});
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base,{waitUntil:'networkidle'});
 const trigger=page.locator('#discovery-cards .share-source').first();await trigger.click();
 const dialog=page.locator('.share-dialog'),copy=dialog.getByRole('button',{name:'Copy link',exact:true}),native=dialog.getByRole('button',{name:'More apps',exact:true});
 await dialog.waitFor();
 check('dialog-opens-from-public-card-without-account-setup',await dialog.getByRole('heading',{name:'Share this card'}).isVisible());
 check('copy-and-native-share-disabled-during-preservation',await copy.isDisabled()&&await native.isDisabled());
 for(const label of ['Facebook','X','Threads','Download image']){
  const option=dialog.locator('a').filter({hasText:new RegExp('^'+label+'$')});
  check('pending-'+label.toLowerCase().replaceAll(' ','-')+'-has-no-destination',await option.getAttribute('href')===null&&await option.getAttribute('aria-disabled')==='true');
 }
 release();await copy.waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('.share-dialog .primary')?.disabled===false);
 check('successful-preservation-enables-the-exact-card-link',await dialog.getByRole('link',{name:'Open card',exact:true}).getAttribute('href')===path&&await dialog.getByRole('link',{name:'Download image',exact:true}).getAttribute('href')==='/api/card-image?id='+id+'&v='+revision);
 const count=report.archiveRequests.length;await copy.click();
 check('copy-keeps-the-exact-public-revision',await page.evaluate(()=>window.__copiedLink)===link);
 await native.click();await page.waitForFunction(()=>window.__nativeShare!==undefined);
 const nativeResult=await page.evaluate(()=>window.__nativeShare);
 check('native-share-is-called-within-a-fresh-user-gesture',nativeResult.active===true);
 check('native-share-contains-only-public-title-and-link',Object.keys(nativeResult.payload).sort().join(',')==='title,url'&&nativeResult.payload.url===link&&!JSON.stringify(nativeResult.payload).includes('private-'));
 check('posting-actions-do-not-repeat-archive-acquisition',report.archiveRequests.length===count);
 await dialog.getByRole('button',{name:'Close sharing options'}).click();
 check('closing-restores-focus-to-the-original-share-control',await trigger.evaluate(element=>element===document.activeElement));

 scenario='failure';await trigger.click();await dialog.getByRole('button',{name:'Retry',exact:true}).waitFor();
 check('failed-preservation-keeps-sharing-disabled',await dialog.getByRole('button',{name:'Copy link',exact:true}).isDisabled()&&await dialog.locator('a').filter({hasText:/^Facebook$/}).getAttribute('href')===null);
 check('failure-explains-that-the-edition-was-not-preserved',await dialog.locator('[role=status]').innerText().then(text=>text.includes('could not be preserved')));
 scenario='success';await dialog.getByRole('button',{name:'Retry',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.share-dialog .primary')?.disabled===false);
 check('retry-recovers-without-creating-another-dialog',await page.locator('.share-dialog').count()===1&&await dialog.locator('[role=status]').innerText().then(text=>text.includes('Link ready')));
 await dialog.getByRole('button',{name:'Close sharing options'}).click();

 scenario='wrong-revision';await trigger.click();await dialog.getByRole('button',{name:'Retry',exact:true}).waitFor();
 check('a-success-response-for-another-revision-is-rejected',await dialog.getByRole('button',{name:'Copy link',exact:true}).isDisabled());
 await page.setViewportSize({width:390,height:844});
 check('sharing-dialog-remains-usable-on-mobile',await dialog.isVisible()&&await dialog.getByRole('button',{name:'Close sharing options'}).isVisible()&&await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 check('archive-request-carries-only-reference-and-no-account-or-preferences',report.archiveRequests.every(request=>request.method==='POST'&&new URL(request.url).pathname==='/api/share-archive'&&!new URL(request.url).search&&Object.keys(request.body).sort().join(',')==='id,revision'&&request.body.id===id&&request.body.revision===revision&&request.headers['x-dlkt-info-request']==='share-archive'&&request.headers.cookie===undefined&&request.headers.authorization===undefined&&!JSON.stringify(request.body).includes('private-')));
 check('no-page-errors',report.errors.length===0);
 writeFileSync('/tmp/dlkt-share-preservation-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.checks.filter(item=>item.passed).length,total:report.checks.length}));
}catch(error){writeFileSync('/tmp/dlkt-share-preservation-browser-report.json',JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
