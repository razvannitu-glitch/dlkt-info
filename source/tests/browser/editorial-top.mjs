import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';

const base=process.env.ICEO_BASE??'http://127.0.0.1:3100/iceo.html';
const real=process.env.DLKT_REAL_PUBLIC==='1';
const report={base,checkedAt:new Date().toISOString(),mode:real?'live public deployment':'real acquired public snapshot in browser',checks:[],errors:[],views:[]};
const check=(name,passed)=>{report.checks.push({name,passed:Boolean(passed)});assert.ok(passed,name);};
await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
  const context=await browser.newContext({viewport:{width:1280,height:900},reducedMotion:'reduce'});
  if(!real){
    const {snapshot}=JSON.parse(readFileSync(process.env.DLKT_SNAPSHOT_PATH??'/vercel/sandbox/global-editorial-combined.json','utf8'));
    await context.route('**/api/iceo',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(snapshot)}));
    await context.route('**/api/share-archive',route=>{
      const {id,revision}=route.request().postDataJSON();
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({state:'preserved',path:'/card/'+id+'?v='+revision})});
    });
  }
  const page=await context.newPage();page.setDefaultTimeout(50000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(base,{waitUntil:'domcontentloaded'});
  await page.locator('#discovery-cards [data-editorial-category]').first().waitFor();
  const cards=page.locator('#discovery-cards [data-edition-part="first"]');
  const selected=await cards.evaluateAll(nodes=>nodes.map(node=>({id:node.dataset.cardId,category:node.dataset.editorialCategory,title:node.querySelector('h3')?.textContent,publisher:node.querySelector('.card-publisher')?.textContent})));
  report.selected=selected;
  check('twenty-to-forty-direct-public-cards',selected.length>=20&&selected.length<=40);
  check('all-twenty-categories-visible',new Set(selected.map(row=>row.category)).size===20);
  check('one-or-two-stories-per-category',Object.values(selected.reduce((counts,row)=>({...counts,[row.category]:(counts[row.category]??0)+1}),{})).every(count=>count>=1&&count<=2));
  check('distinct-public-card-identities',new Set(selected.map(row=>row.id)).size===selected.length);
  check('gaming-family-shopping-and-science-visible',['gaming','family','shopping','science'].every(category=>selected.some(row=>row.category===category)));
  check('public-coverage-count-is-honest',(await page.locator('#home-edition-end').innerText()).includes('20/20 categories'));
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:900});
    const noOverflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
    report.views.push({width,noOverflow});check('no-horizontal-overflow-'+width,noOverflow);
  }
  const first=cards.first();await first.locator('[data-save-card]').click();
  await page.waitForFunction(()=>document.querySelector('#memory-status')?.textContent.includes('Card saved'));
  const saved=await page.evaluate(async()=>{const{DeviceMemory}=await import('/device-memory.js');return new DeviceMemory().read();});
  check('new-publication-saves-with-original-identity',saved.cards.some(row=>row.card.id===selected[0].id));
  await first.locator('.share-source').click();
  const dialog=page.locator('.share-dialog');await dialog.waitFor();
  await page.waitForFunction(()=>document.querySelector('.share-dialog .primary')?.disabled===false);
  const sharePath=await dialog.getByRole('link',{name:'Open card',exact:true}).getAttribute('href');
  report.sharePath=sharePath;check('new-publication-share-preserves-exact-id',sharePath?.startsWith('/card/'+selected[0].id+'?v='));
  await page.setViewportSize({width:390,height:844});check('share-dialog-fits-mobile',await dialog.isVisible()&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await dialog.getByRole('button',{name:'Close sharing options'}).click();
  await page.screenshot({path:'/tmp/dlkt-editorial-mobile.webp',type:'webp',quality:65});
  check('no-browser-script-errors',report.errors.length===0);
  console.log(JSON.stringify({checks:report.checks.length,passed:report.checks.filter(row=>row.passed).length,cards:selected.length,categories:20,errors:report.errors.length}));
}finally{writeFileSync('/tmp/dlkt-editorial-browser-report.json',JSON.stringify(report,null,2));await browser.close();}
