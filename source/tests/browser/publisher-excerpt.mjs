import assert from 'node:assert/strict';
import {createBrowserArtifacts} from './qa-artifacts.mjs';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';

const artifacts=createBrowserArtifacts('publisher-excerpt');
console.log(JSON.stringify({artifactDirectory:artifacts.directory}));
const base=process.env.ICEO_BASE??'http://127.0.0.1:3100';
const report={base,checkedAt:new Date().toISOString(),environment:'controlled source records in a real browser',checks:[],errors:[]};
const check=(name,pass)=>{report.checks.push({name,passed:Boolean(pass)});assert.ok(pass,name);};
const excerpt='Applications require the complete documents listed in the notice; submitting an application does not establish eligibility or guarantee an award.';
function snapshot(){
 const stamp=new Date().toISOString();
 const common={publisher:'European Central Bank',date:stamp,dateLabel:'Published',observedAt:stamp,boundary:'Official publisher listing. Verify the current procedure and eligibility in the original notice.',version:null,attribution:'Source: European Central Bank.',sourceState:'verified'};
 const procurement={...common,id:'a'.repeat(24),identity:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',title:'Contract notice: supplied services',topic:'opportunities',kind:'procurement-notice',sourceUrl:'https://www.ecb.europa.eu/ecb/jobsproc/tenders/html/example.en.html',sourceIds:['ecb-procurement'],contentHash:'b'.repeat(64),deadline:new Date(Date.now()+5*86400000).toISOString().slice(0,10),summary:excerpt};
 const publication={...common,id:'c'.repeat(24),identity:'https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html',title:'ECB publication fixture',topic:'business',kind:'publication',sourceUrl:'https://www.ecb.europa.eu/press/pr/date/2026/html/example.en.html',sourceIds:['ecb-news'],contentHash:'d'.repeat(64),deadline:null,summary:'The publisher describes the reporting period and its limitations.'};
 const sources=[['ecb-procurement','opportunities'],['ecb-news','business']].map(([id,topic])=>({id,topic,label:id,publisher:'European Central Bank',state:'verified',checkedAt:stamp,verifiedAt:stamp,count:1,rejected:0,error:null,retryAt:null,scope:'Controlled official listing fixture.',termsUrl:'https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html',windowed:true}));
 return{version:'iceo-primary-mesh-1',product:'dlkt-info',productVersion:'0.9.46',mode:'current-official-records',generatedAt:stamp,state:'ready',sources,cards:[procurement,publication],conflictCount:0,duplicateCount:0,deltaAvailable:false,scheduledDelivery:false,accountPersistence:false,coverage:['opportunities','business']};
}

await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},reducedMotion:'reduce'});
 await context.route('**/api/iceo',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot())}));
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
 await page.goto(base,{waitUntil:'networkidle'});
 const procurement=page.locator('#discovery-cards [data-card-id="'+ 'a'.repeat(24)+'"]');
 const publication=page.locator('#discovery-cards [data-card-id="'+ 'c'.repeat(24)+'"]');
 await procurement.waitFor();
 check('complete-publisher-excerpt-visible-on-procurement-card',await procurement.locator('.publisher-excerpt').innerText()==='Publisher excerpt: '+excerpt);
 check('procurement-status-and-eligibility-boundary-remain-separate',await procurement.locator('.card-context').first().innerText().then(text=>text.includes('Confirm the current procedure status and eligibility')));
 check('future-deadline-label-is-retained',await procurement.locator('.card-kind:not(.contextual-reason)').innerText().then(text=>text.includes('Future deadline')));
 check('ordinary-publication-excerpt-is-not-repeated',await publication.locator('.publisher-excerpt').count()===0&&await publication.locator('.card-context').first().innerText()==='The publisher describes the reporting period and its limitations.');
 await page.setViewportSize({width:390,height:844});
 check('excerpt-remains-readable-on-mobile',await procurement.locator('.publisher-excerpt').isVisible()&&await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 check('no-page-errors',report.errors.length===0);
 artifacts.write('dlkt-publisher-excerpt-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.checks.filter(item=>item.passed).length,total:report.checks.length}));
}catch(error){artifacts.write('dlkt-publisher-excerpt-browser-failure.json',JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
