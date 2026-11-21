import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {weatherCard,weatherUrl} from '../.build/src/local/weather.js';
import {validWeatherSymbol,validWeatherSymbols,validLocalSnapshot,currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {weatherVisual,weatherPresentation,weatherMotionNode} from '../.build/src/glance/weather-motion.js';

const hour=3600000,now=Date.parse('2026-11-21T08:20:00Z'),floor=Math.floor(now/hour)*hour,stamp=at=>new Date(at).toISOString();
const city={id:'2988507',name:'Paris',countryCode:'FR',country:'France',region:'Ile-de-France',lat:48.85,lon:2.35,timezone:'Europe/Paris'};
function payload(){return {type:'Feature',geometry:{type:'Point',coordinates:[city.lon,city.lat,0]},properties:{meta:{updated_at:stamp(now-600000),units:{air_temperature:'celsius',wind_speed:'m/s',precipitation_amount:'mm'}},timeseries:Array.from({length:9},(_,i)=>({time:stamp(floor+i*hour),data:{instant:{details:{air_temperature:10+i,wind_speed:2}},next_1_hours:{summary:{symbol_code:i===0?'rain':'clearsky_day'},details:{precipitation_amount:i===0?1:0}}}}))}};}
const forecast=()=>weatherCard(payload(),city,stamp(now),now);
const snapshot=card=>({version:'dlkt-local-1',city,checkedAt:stamp(now),state:'ready',weatherState:'ready',transportState:'not-covered',cards:[card]});

test('adapter preserves current-hour and six upcoming publisher symbols without changing numeric forecast identity',()=>{
 const card=forecast();assert.equal(card.weatherSymbols.length,7);assert.equal(card.weatherSymbols[0].at,stamp(floor));assert.equal(card.weatherSymbols[0].symbol,'rain');assert.equal(card.weatherSymbols.at(-1).at,stamp(floor+6*hour));
 assert.equal(card.id,`weather:${city.id}:${floor+hour}`);assert.equal(card.validFrom,stamp(floor+hour));assert.equal(card.validTo,stamp(floor+7*hour));assert.equal(card.facts.length,6);assert.ok(currentLocalSnapshot(snapshot(card),city,now));
 const original=payload();for(const row of original.properties.timeseries)delete row.data.next_1_hours.summary;
 const without=weatherCard(original,city,stamp(now),now);assert.equal(without.weatherSymbols,undefined);for(const field of ['id','text','validFrom','validTo'])assert.equal(card[field],without[field]);
});
test('unsupported symbols and duplicate current-hour observations cannot invent a condition',()=>{
 const input=payload();input.properties.timeseries[0].data.next_1_hours.summary.symbol_code='sunny_night<script>';
 const card=weatherCard(input,city,stamp(now),now);assert.equal(card.weatherSymbols.length,6);assert.equal(weatherPresentation(card,now).state,'unavailable');
 const duplicate=payload();duplicate.properties.timeseries.unshift(structuredClone(duplicate.properties.timeseries[0]));
 assert.equal(weatherPresentation(weatherCard(duplicate,city,stamp(now),now),now).state,'unavailable');
});
test('weather metadata contract is bounded, exact, ordered and forecast-only',()=>{
 const card=forecast();assert.ok(validWeatherSymbols(card.weatherSymbols,card.validFrom,card.validTo));
 for(const symbols of [[],Array(8).fill(card.weatherSymbols[0]),[card.weatherSymbols[0],card.weatherSymbols[0]],[{...card.weatherSymbols[0],private:'x'}],[{at:stamp(floor-2*hour),symbol:'rain'}],[{at:stamp(floor+7*hour),symbol:'rain'}],[{at:stamp(floor+1),symbol:'rain'}],[{at:stamp(floor),symbol:'clearsky_unknown'}]]){
  assert.equal(validWeatherSymbols(symbols,card.validFrom,card.validTo),false);assert.equal(validLocalSnapshot(snapshot({...card,weatherSymbols:symbols}),city.id),false);
 }
 const nonforecast={...card,kind:'transport',sourceUrl:'https://tfl.gov.uk/tube-dlr-overground/status/'};assert.equal(validLocalSnapshot(snapshot(nonforecast),city.id),false);
});
test('day, night and polar twilight remain the source variants rather than clock guesses',()=>{
 assert.equal(weatherVisual('clearsky_day').light,'day');assert.equal(weatherVisual('clearsky_night').light,'night');assert.equal(weatherVisual('fair_polartwilight').light,'twilight');assert.equal(weatherVisual('cloudy').light,'unspecified');
 const card=forecast();card.weatherSymbols[0].symbol='clearsky_night';assert.equal(weatherPresentation(card,now).light,'night');
 for(const value of ['clear','sunny','clearsky','rain_day','fog_night','rain;url(x)',null,''])assert.equal(weatherVisual(value).condition,'unknown');
});
test('official precipitation and thunder variants map distinctly, including documented MET spelling',()=>{
 const cases={clearsky_day:'clear',fair_night:'fair',partlycloudy_day:'partly-cloudy',cloudy:'cloudy',fog:'fog',lightrain:'rain',heavyrainshowers_night:'rain',snow:'snow',lightsleet:'sleet',rainandthunder:'thunder',lightssnowshowersandthunder_night:'thunder',lightssleetshowersandthunder_day:'thunder'};
 for(const [symbol,condition]of Object.entries(cases)){assert.ok(validWeatherSymbol(symbol));assert.equal(weatherVisual(symbol).condition,condition);}
 assert.equal(weatherVisual('lightssleetshowersandthunder_day').precipitation,'sleet');assert.match(weatherVisual('heavysnow').label,/Heavy snow/);
});
test('only an interval covering now can animate; future, expired and unrechecked records stay neutral',()=>{
 const card=forecast();assert.equal(weatherPresentation(card,now).condition,'rain');assert.equal(weatherPresentation(card,floor+hour).condition,'clear');assert.equal(weatherPresentation(card,now).nextAt,floor+hour);
 assert.equal(weatherPresentation({...card,weatherSymbols:card.weatherSymbols.slice(1)},now).state,'unavailable');
 assert.equal(weatherPresentation(card,Date.parse(card.validTo)).state,'expired');assert.equal(weatherPresentation({...card,checkedAt:stamp(now-19*hour)},now).state,'expired');
 assert.equal(weatherPresentation({...card,sourceUpdatedAt:stamp(now-19*hour)},now).state,'expired');assert.equal(weatherPresentation({...card,checkedAt:stamp(now+6000)},now).state,'unavailable');
 assert.equal(weatherPresentation(null,now).condition,'unknown');assert.equal(weatherPresentation({...card,weatherSymbols:undefined},now).condition,'unknown');
});
test('weather renderer is local, scoped, pausable and has a static reduced-motion mode',()=>{
 const source=readFileSync('src/glance/weather-motion.ts','utf8'),css=readFileSync('public/weather-motion.css','utf8');
 assert.doesNotMatch(source,/\bfetch\s*\(|innerHTML|outerHTML|setInterval|Math\.random|navigator\.geolocation/u);assert.doesNotMatch(css,/@import|url\s*\(/u);
 assert.match(source,/visibilityState==='visible'/u);assert.match(source,/dialog\[open\]/u);assert.match(source,/if\(!element\.isConnected\)\{mounted\.delete/u);assert.match(css,/@media\(prefers-reduced-motion:reduce\)/u);assert.match(css,/animation:none!important/u);assert.match(css,/data-active=false/u);
 assert.match(readFileSync('src/local/card-node.ts','utf8'),/if\(card\.kind==='forecast'\)body\.append\(weatherMotionNode/u);
 assert.equal(weatherUrl(city),'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=48.8500&lon=2.3500');
});

test('real motion controller pauses on reduced motion, hidden page/panel and modal cover; detached nodes stop scheduling',async t=>{
 class ElementFixture extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.dataset={};this.attributes={};this.parent=null;this.shown=true;this.textContent='';}
  append(...children){for(const child of children){child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const child of this.children)child.parent=null;this.children=[];this.append(...children);}
  setAttribute(name,value){assert.notEqual(name,'style','Weather must render under the production policy that rejects inline styles');this.attributes[name]=value;}
  get isConnected(){return this===doc.body||Boolean(this.parent?.isConnected);}
  getBoundingClientRect(){return{top:10,bottom:90};}
  getClientRects(){return this.shown?[{}]:[];}
  contains(child){return child===this||this.children.some(node=>node.contains(child));}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(child=>child!==this);this.parent=null;}
 }
 const doc=new EventTarget(),win=new EventTarget(),media=new EventTarget();let dialogs=[],mutation,clock=now,timerCalls=0;
 doc.body=new ElementFixture('body');doc.visibilityState='visible';doc.createElement=tag=>new ElementFixture(tag);doc.createElementNS=(_ns,tag)=>new ElementFixture(tag);doc.querySelectorAll=()=>dialogs;media.matches=false;
 const globals={document:doc,window:win,matchMedia:()=>media,innerHeight:900,MutationObserver:class{constructor(callback){mutation=callback;}observe(){}}};
 for(const [key,value]of Object.entries(globals)){const old=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});t.after(()=>old?Object.defineProperty(globalThis,key,old):delete globalThis[key]);}
 t.mock.method(Date,'now',()=>clock);t.mock.method(globalThis,'setTimeout',()=>{timerCalls++;return 1;});t.mock.method(globalThis,'clearTimeout',()=>{});
 const motion=weatherMotionNode(forecast(),now);doc.body.append(motion);await Promise.resolve();assert.equal(motion.dataset.active,'true');assert.equal(motion.dataset.condition,'rain');
 media.matches=true;media.dispatchEvent(new Event('change'));await Promise.resolve();assert.equal(motion.dataset.active,'false');
 media.matches=false;doc.visibilityState='hidden';doc.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(motion.dataset.active,'false');
 const hiddenCalls=timerCalls;doc.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(timerCalls,hiddenCalls);
 doc.visibilityState='visible';doc.dispatchEvent(new Event('visibilitychange'));await Promise.resolve();assert.equal(motion.dataset.active,'true');
 dialogs=[new ElementFixture('dialog')];mutation();await Promise.resolve();assert.equal(motion.dataset.active,'false');
 dialogs=[];motion.shown=false;mutation();await Promise.resolve();assert.equal(motion.dataset.active,'false');
 motion.shown=true;clock=floor+hour;mutation();await Promise.resolve();assert.equal(motion.dataset.condition,'clear');assert.equal(motion.dataset.light,'day');assert.equal(motion.dataset.active,'true');
 motion.remove();const detachedCalls=timerCalls;mutation();await Promise.resolve();assert.equal(timerCalls,detachedCalls);
});
