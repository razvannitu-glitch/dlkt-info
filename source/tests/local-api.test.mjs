import{test,before,after}from'node:test';import assert from'node:assert/strict';import{createServer}from'node:http';import{once}from'node:events';
import{handlePlaces}from'../.build/api/places.js';import{handleLocal}from'../.build/api/local.js';
let server,base,calls=0;
before(async()=>{server=createServer(async(req,res)=>{try{if(req.url.startsWith('/api/places'))await handlePlaces(req,res);else await handleLocal(req,res,{snapshot:async city=>{calls++;return{version:'dlkt-local-1',city,checkedAt:new Date().toISOString(),state:'unavailable',weatherState:'unavailable',transportState:'not-covered',cards:[]};}});}catch{res.statusCode=500;res.end('unexpected');}}).listen(0,'127.0.0.1');await once(server,'listening');base='http://127.0.0.1:'+server.address().port;});
after(()=>new Promise(resolve=>server.close(resolve)));
const post=data=>fetch(base+'/api/places',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-DLKT-Info-Request':'local-place-1'},body:JSON.stringify(data)});
test('city search returns canonical labelled candidates and no-cache hint',async()=>{const r=await fetch(base+'/api/places?q=B');const d=await r.json();assert.equal(r.status,200);assert.ok(d.cities.length>0&&d.cities.length<=8);assert.ok(d.cities.every(c=>c.country&&c.region&&c.id));assert.match(r.headers.get('cache-control'),/private, no-store/);});
test('malformed or duplicate query parameters cannot trigger arbitrary lookup',async()=>{for(const q of ['?q=B&q=C','?url=https://evil.test','?q='+('a'.repeat(101)),'?city=683506&x=1','']){assert.equal((await fetch(base+'/api/places'+q)).status,400);}});
test('unknown canonical city returns 404 rather than changing cities',async()=>{assert.equal((await fetch(base+'/api/places?id=000000000')).status,404);const prior=calls;assert.equal((await fetch(base+'/api/local?city=000000000')).status,404);assert.equal(calls,prior);});
test('location hint is only an estimate even when platform headers match',async()=>{const r=await fetch(base+'/api/places?hint=1',{headers:{'x-vercel-ip-city':'Bucharest','x-vercel-ip-country':'RO'}});const d=await r.json();assert.equal(d.city.id,'683506');assert.equal(d.estimated,true);assert.match(r.headers.get('cache-control'),/no-store/);});
test('malformed location hint does not break manual city search',async()=>{const r=await fetch(base+'/api/places?hint=1',{headers:{'x-vercel-ip-city':'%ZZ','x-vercel-ip-country':'RO'}});assert.equal(r.status,200);assert.equal((await r.json()).city,null);});
test('coarse current coordinates give suggestions without storing or returning coordinates of the user',async()=>{const r=await post({lat:44.43,lon:26.11,accuracy:100,timestamp:Date.now()});const d=await r.json();assert.equal(r.status,200);assert.ok(d.nearby.some(r=>r.city.id==='683506'));assert.equal(d.estimated,true);assert.equal(d.lat,undefined);assert.equal(r.headers.get('set-cookie'),null);});
test('location POST requires same origin and explicit request marker',async()=>{for(const headers of [{Origin:'https://evil.test','X-DLKT-Info-Request':'local-place-1'},{Origin:base}]){const r=await fetch(base+'/api/places',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);}});
test('old, future, inaccurate, out-of-range and extra location fields are rejected',async()=>{const source={lat:44.43,lon:26.11,accuracy:100,timestamp:Date.now()};for(const change of [{timestamp:Date.now()-130000},{timestamp:Date.now()+60000},{accuracy:6000},{lat:100},{url:'https://evil.test'},{lon:null}])assert.equal((await post({...source,...change})).status,400);});
test('local forecast endpoint accepts only canonical city and never arbitrary lat/lon or source URLs',async()=>{const before=calls;for(const q of ['?lat=44&lon=26','?city=683506&city=2643743','?url=https://api.met.no','?city=683506&lat=44',''])assert.equal((await fetch(base+'/api/local'+q)).status,400);assert.equal(calls,before);});
test('unsupported methods are denied before reading or collecting data',async()=>{for(const path of ['/api/local?city=683506','/api/places?q=B'])assert.equal((await fetch(base+path,{method:'DELETE'})).status,405);});
test('source failure remains explicit and retry cache is short',async()=>{const r=await fetch(base+'/api/local?city=683506');const d=await r.json();assert.equal(r.status,200);assert.equal(d.state,'unavailable');assert.equal(d.cards.length,0);assert.match(r.headers.get('cache-control'),/s-maxage=15/);});


test('Explore country catalog and native city aliases are public bounded reference metadata',async()=>{
 const countryResponse=await fetch(base+'/api/places?countries=1');const catalog=await countryResponse.json();
 assert.equal(countryResponse.status,200);assert.equal(countryResponse.headers.get('set-cookie'),null);
 assert.ok(catalog.countries.length>150&&catalog.countries.length<=300);
 assert.ok(catalog.countries.some(country=>country.code==='JP'&&country.name==='Japan'));
 assert.equal(new Set(catalog.countries.map(country=>country.code)).size,catalog.countries.length);
 const place=await fetch(base+'/api/places?id=2988507');const value=await place.json();
 assert.equal(value.cities[0].id,'2988507');assert.ok(value.cityAliases.length<=32);assert.ok(value.cityAliases.includes('パリ'));assert.equal(value.cityAliases.includes('ハリ'),false);
 assert.equal((await fetch(base+'/api/places?countries=1&country=JP')).status,400);
});
