import test from 'node:test';
import assert from 'node:assert/strict';
import {commercialAreaFromSearch,commercialRequestUrl,prepareCommercialRequest,validCommercialBrief} from '../.build/src/iceo/commercial.js';
const brief={business:'Example business',city:'Torino',country:'Italia',offer:'Lunch menu EUR 12, weekdays only',destination:'https://example.com/offers/lunch?area=torino',validUntil:'2026-12-31'};
test('commercial request preserves city and country for any valid area without claiming live inventory',()=>{
 for(const area of [{city:'Torino',country:'Italia'},{city:'Funafuti',country:'Tuvalu'},{city:'東京',country:'日本'}]){
  const url=new URL(commercialRequestUrl(area,'ro'),'https://www.dlkt.ee');
  assert.equal(url.pathname,'/organizations');assert.equal(url.hash,'#advertise');
  assert.deepEqual(commercialAreaFromSearch(url.search),area);assert.equal(url.searchParams.get('lang'),'ro');
 }
 assert.equal(commercialAreaFromSearch('?city=Torino&city=Rome&country=Italia'),null);
 assert.equal(commercialAreaFromSearch('?city=Torino&country=Italia%0AInjected'),null);
});
test('a commercial enquiry is an encoded reviewable email draft with all offer conditions',()=>{
 const request=prepareCommercialRequest(brief);assert.ok(request);
 assert.ok(request.mailto.startsWith('mailto:office@dlkt.ee?subject='));
 assert.ok(request.mailto.includes('%20'));assert.ok(!request.mailto.includes('+'));
 const parsed=new URL(request.mailto);assert.equal(parsed.searchParams.get('body'),request.body);
 for(const value of Object.values(brief))assert.ok(request.body.includes(value));
 assert.match(request.body,/No advertising placement, payment or publication is authorized/);
 const literal=prepareCommercialRequest({...brief,offer:'A & B? subject=trial&bcc=elsewhere@example.com'});assert.ok(literal);
 assert.deepEqual([...new URL(literal.mailto).searchParams.keys()],['subject','body']);
});
test('commercial request rejects malformed, oversized or unsafe destinations without preparing a draft',()=>{
 for(const patch of [
  {business:'Company\nbcc:elsewhere@example.com'},{offer:'x'.repeat(601)},{destination:'javascript:alert(1)'},{destination:'http://example.com'},
  {destination:'https://user:secret@example.com'},{destination:'https://127.0.0.1/private'},{destination:'https://host.local'},{destination:'https://host.local./offer'},{destination:'https://shop.localhost/offer'},
  {validUntil:'2026-02-30'},{city:''},{country:'Italia\u202E'}, {unexpected:'value'},
 ]){
  const value={...brief,...patch};assert.equal(validCommercialBrief(value),false);assert.equal(prepareCommercialRequest(value),null);
 }
 assert.equal(prepareCommercialRequest(null),null);
});
