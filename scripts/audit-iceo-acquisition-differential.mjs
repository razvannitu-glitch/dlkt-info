import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const [baselinePath,candidatePath,...extra]=process.argv.slice(2);
assert.ok(baselinePath&&candidatePath&&extra.length===0);
const load=async(root)=>{
 const module=name=>import(pathToFileURL(resolve(root,'source/.build/src/iceo',name+'.js')).href);
 const [discovery,editorial,sources,validation]=await Promise.all(['news-discovery','editorial-categories','news-sources','card-validation'].map(module));
 return {discovery,editorial,sources,validation};
};
const [base,candidate]=await Promise.all([load(baselinePath),load(candidatePath)]);
const now=Date.parse('2026-11-28T12:00:00.000Z'),stamp=new Date(now).toISOString();
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const specs=[
 ['https://www.theguardian.com/technology/fixture-','New artificial intelligence software launches for laptops'],
 ['https://www.theguardian.com/health/fixture-','Hospital care standards improve after clinical trial'],
 ['https://www.digi24.ro/stiri/actualitate/fixture-','Guvernul anunta noi masuri pentru cetateni'],
 ['https://hotnews.ro/fixture-','O noua etapa incepe maine la ora noua'],
 ['https://www.dw.com/en/fixture-','Leaders sign a ceasefire agreement after peace talks'],
 ['https://www.dw.com/de/fixture-','Neue Regeln fuer Schulen und Bildung'],
 ['https://www.france24.com/fr/fixture-','Le gouvernement annonce de nouvelles mesures'],
 ['https://www.reuters.com/world/fixture-','Leaders sign a ceasefire agreement after peace talks'],
 ['https://www.pcgamer.com/fixture-','New video game launches for PlayStation consoles'],
 ['https://globalvoices.org/2026/11/27/controlled-','A controlled global editorial language fixture','/'],
];
function fixture(size){
 const rows=Array.from({length:size},(_,i)=>{
  const [origin,headline,suffix='']=specs[i%specs.length];
  const sourceUrl=origin+String(i).padStart(6,'0')+suffix;
  const publisher=base.sources.publisherForNewsUrl(sourceUrl)?.label;
  assert.ok(publisher,'reviewed origin fixture: '+sourceUrl);
  const title=headline+' '+i;
  const row=Object.freeze({sourceUrl,title,publisher,indexedAt:new Date(now-(i%60)*1000).toISOString(),category:base.editorial.classifyNewsHeadline(title,sourceUrl)});
  assert.ok(base.discovery.validateNewsCandidate(row,now),'valid fixture: '+sourceUrl);
  return row;
 });
 assert.ok(rows.some(x=>base.sources.sourceLanguage(x.sourceUrl)===null));
 assert.ok(new Set(rows.map(x=>base.sources.sourceLanguage(x.sourceUrl)).filter(x=>x!==null)).size>=3);
 return Object.freeze(rows);
}
function retainedFor(rows){
 const cards=rows.slice(0,Math.min(80,rows.length)).map(row=>{
  const data={identity:row.sourceUrl,title:row.title,sourceUrl:row.sourceUrl,date:new Date(now-60_000).toISOString(),dateLabel:'Published',publisher:row.publisher,deadline:null,version:null};
  return Object.freeze({...data,id:digest(data.identity).slice(0,24),contentHash:digest(base.validation.cardContent(data)),
   topic:row.category===null?'other':base.editorial.EDITORIAL_CATEGORY_TOPICS[row.category],kind:'publication',
   sourceIds:Object.freeze([row.category===null?'news-unclassified':'news-'+row.category]),observedAt:stamp,
   boundary:'Original source metadata checked.',attribution:'Source: '+row.publisher+'.',sourceState:'verified'});
 });
 assert.ok(cards.every(x=>base.validation.validCard(x)));
 return Object.freeze(cards);
}
function measure(fn){
 const before=process.cpuUsage(),started=performance.now(),value=fn(),elapsed=performance.now()-started,cpu=process.cpuUsage(before);
 return {value,wallMs:elapsed,cpuMs:(cpu.user+cpu.system)/1000};
}
const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const summarize=samples=>({wallMs:samples.map(x=>Number(x.wallMs.toFixed(3))),cpuMs:samples.map(x=>Number(x.cpuMs.toFixed(3))),medianWallMs:Number(median(samples.map(x=>x.wallMs)).toFixed(3)),medianCpuMs:Number(median(samples.map(x=>x.cpuMs)).toFixed(3))});
const roundtrip=(mod,scenario)=>{
 const merged=mod.discovery.mergeNewsCandidates(scenario.rows,scenario.time);
 const selected=mod.discovery.newsAcquisitionOrder(merged,scenario.limit,scenario.time,scenario.featured,scenario.retained);
 assert.ok(selected.length<=scenario.limit);
 assert.equal(new Set(selected.map(x=>x.sourceUrl)).size,selected.length);
 assert.ok(selected.every(x=>merged.includes(x)),'selected object references preserved');
 return {merged,selected};
};
const cases=[
 {size:200,limit:12,slot:0,retained:false,reverse:false},
 {size:1000,limit:60,slot:1,retained:true,reverse:true},
 {size:5000,limit:80,slot:2,retained:true,reverse:false},
];
const results=[];
for(const c of cases){
 const original=fixture(c.size);
 const rows=Object.freeze([...(c.reverse?[...original].reverse():original),...original.slice(0,10)]);
 const scenario={...c,rows,time:now+c.slot*base.discovery.NEWS_ACQUISITION_ROTATION_MS,featured:new Set(original.filter((_,i)=>i%97===0).map(x=>x.sourceUrl)),retained:c.retained?retainedFor(original):Object.freeze([])};
 const expected=roundtrip(base,scenario);
 assert.deepEqual(roundtrip(candidate,scenario),expected,'exact merged and selected records and ordering');
 const timings={baseline:[],candidate:[]};
 for(let i=0;i<3;i++){
  const order=i%2===0?[['baseline',base],['candidate',candidate]]:[['candidate',candidate],['baseline',base]];
  for(const [name,mod] of order){
   const measured=measure(()=>roundtrip(mod,scenario));
   assert.deepEqual(measured.value,expected,'timed result parity: '+name);
   timings[name].push(measured);
  }
 }
 results.push({poolSize:c.size,inputRows:rows.length,budget:c.limit,slot:c.slot,retained:scenario.retained.length,featured:scenario.featured.size,
  merged:expected.merged.length,selected:expected.selected.length,outputSha256:digest(expected),baseline:summarize(timings.baseline),candidate:summarize(timings.candidate)});
}
console.log('DLKT_ICEO_ACQUISITION_DIFFERENTIAL '+JSON.stringify({status:'PASS',baselineSha:'ab84af3578888b43dccbd8598883f6feeb75b570',candidateSha:'88173bde62695418d872be7c5ce642f46e412443',scope:'synthetic offline exact selection/merge parity, same runner; three paired timings per case, no network/production measurement',results}));
