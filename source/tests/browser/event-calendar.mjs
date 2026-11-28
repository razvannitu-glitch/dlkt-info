import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createBrowserArtifacts} from './qa-artifacts.mjs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import chromium from '@sparticuz/chromium';
import {chromium as playwright} from 'playwright-core';
import {setupLambdaEnvironment} from './node_modules/@sparticuz/chromium/build/helper.js';
import {inflate} from './node_modules/@sparticuz/chromium/build/lambdafs.js';

const artifacts=createBrowserArtifacts('event-calendar');
console.log(JSON.stringify({artifactDirectory:artifacts.directory}));
const base=process.env.ICEO_BASE??'http://127.0.0.1:3100',sourceRoot=process.env.DLKT_SOURCE;
assert.ok(sourceRoot,'DLKT_SOURCE must identify the compiled source under review');
const [publications,arcub,cities]=await Promise.all(['publications','arcub','cities'].map(name=>import(pathToFileURL(join(sourceRoot,'.build/src/local/'+name+'.js')).href)));
const now=Date.parse('2026-11-20T12:00:00Z'),checkedAt=new Date(now).toISOString();
const palma=cities.findCity('2512989'),bucharest=cities.findCity('683506');
const palmaCard=publications.parseCulture({checkedAt,body:'<div class="box"><h3><a href="https://www.palmacultura.com/es/noticia/12478/concert">Concert in Palma</a></h3><p>Fecha: 20 noviembre de 2026<br>Hora: 18 h<br>Lugar: Es Gremi<br>Dirección: c. Gremi de Porgadors, 16<br>Precio: entrada libre con reserva previa (aforo limitado)</p></div>'},now).cards[0];
function arcubCard(slug,when,body){
 const url='https://arcub.ro/eveniment/'+slug,title='ARCUB '+slug;
 const agenda=arcub.parseArcubAgenda({checkedAt,body:`<div class="pgrid-item"><a href="${url}"><h3>${title}</h3><div class="meta"><span>${when}</span><span>ARCUB - Hanul Gabroveni</span></div></a></div>`},now).cards[0];
 return arcub.parseArcubDetail({url,checkedAt,body:`<div class="phead"><h1 class="title">${title}</h1><table class="feat"><tr><td class="lbl">Când</td><td class="val">${when}</td></tr><tr><td class="lbl">Unde</td><td class="val">ARCUB - Hanul Gabroveni</td></tr></table><div class="content"><p>${body}</p></div></div>`},agenda,now);
}
const minuteCard=arcubCard('concert','21 noiembrie','21 noiembrie 2026, ora 19:30.'),dayCard=arcubCard('exhibition','21 - 22 noiembrie','21–22 noiembrie 2026.');
assert.ok(palmaCard&&minuteCard&&dayCard);assert.equal(minuteCard.context.datePrecision,'minute');assert.equal(dayCard.context.datePrecision,'day');
const report={base,checkedAt:new Date().toISOString(),fixtureTime:checkedAt,environment:'real parsers and localCardNode, real browser downloads, fixed browser clock',checks:[],errors:[],downloads:[]};
const check=(name,pass)=>{report.checks.push({name,passed:Boolean(pass)});assert.ok(pass,name);};
await inflate(process.cwd()+'/node_modules/@sparticuz/chromium/bin/al2023.tar.br');setupLambdaEnvironment('/tmp/al2023/lib');
const browser=await playwright.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:true});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},acceptDownloads:true,reducedMotion:'reduce'});
 await context.route('**/__calendar_test__',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/iceo.css"><link rel="stylesheet" href="/header.css"></head><body><main class="reader-shell"><section id="fixture-cards" class="feed"></section></main></body></html>'}));
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));let downloadCount=0;page.on('download',()=>downloadCount++);
 await page.clock.setFixedTime(new Date(now));await page.goto(new URL('/__calendar_test__',base).href,{waitUntil:'networkidle'});
 await page.evaluate(async data=>{const{localCardNode}=await import('/local-card-node.js');const host=document.querySelector('#fixture-cards');for(const[card,city]of data)host.append(localCardNode(card,city,Date.now()));},[[palmaCard,palma],[minuteCard,bucharest],[dayCard,bucharest]]);
 const nodeFor=card=>page.locator('[data-local-id="'+card.id+'"]');
 check('real-renderer-exposes-only-two-verified-minute-actions',await page.locator('[data-calendar-event]').count()===2&&await nodeFor(dayCard).getByRole('button',{name:'Add to calendar',exact:true}).count()===0);
 for(const [label,card,start]of [['palma',palmaCard,'20261120T170000Z'],['arcub',minuteCard,'20261121T173000Z']]){
  const waiting=page.waitForEvent('download');await nodeFor(card).getByRole('button',{name:'Add to calendar',exact:true}).click();const download=await waiting;
  const stream=await download.createReadStream();assert.ok(stream);const chunks=[];for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks),content=bytes.toString('utf8'),plain=content.replace(/\r\n[ \t]/gu,'');
  check(label+'-download-has-correct-filename',download.suggestedFilename()==='dlkt-'+card.id.replaceAll(':','-')+'.ics');
  check(label+'-download-preserves-source-utc-start-and-no-inferred-duration',plain.includes('DTSTART:'+start+'\r\n')&&plain.includes('URL:'+card.sourceUrl+'\r\n')&&!/^DTEND:|^DURATION:/mu.test(plain));
  check(label+'-download-is-one-validly-framed-event',plain.startsWith('BEGIN:VCALENDAR\r\n')&&plain.endsWith('END:VCALENDAR\r\n')&&(plain.match(/^BEGIN:VEVENT\r?$/gmu)??[]).length===1);
  if(label==='palma')check('reservation-and-capacity-conditions-survive-real-download',plain.includes('entrada libre con reserva previa (aforo limitado)'));
  check(label+'-download-does-not-claim-booking-or-confirmed-status',plain.includes('not a booking')&&!/^STATUS:CONFIRMED/mu.test(plain));
  check(label+'-ui-describes-preparation-without-claiming-calendar-import',await nodeFor(card).locator('[role=status]').innerText().then(text=>text.includes('Calendar file prepared')&&text.includes('Open it in your calendar')));
  artifacts.write('dlkt-event-calendar-'+label+'.ics',bytes);report.downloads.push({label,filename:download.suggestedFilename(),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 await page.clock.setFixedTime(new Date(now+300000));await nodeFor(palmaCard).getByRole('button',{name:'Add to calendar',exact:true}).click();
 check('expired-source-check-stops-a-late-click',await nodeFor(palmaCard).getByRole('button',{name:'Add to calendar',exact:true}).isDisabled()&&await nodeFor(palmaCard).locator('[role=status]').innerText().then(text=>text.includes('fresh check'))&&downloadCount===2);
 await page.setViewportSize({width:390,height:844});
 check('calendar-control-and-feedback-remain-readable-on-mobile',await nodeFor(palmaCard).locator('[role=status]').isVisible()&&await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
 check('no-page-errors',report.errors.length===0);
 artifacts.write('dlkt-event-calendar-browser-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.checks.filter(item=>item.passed).length,total:report.checks.length,downloads:report.downloads.length}));
}catch(error){artifacts.write('dlkt-event-calendar-browser-failure.json',JSON.stringify(report,null,2));throw error;}finally{await browser.close();}
