import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDocument,DomUtils} from 'htmlparser2';
import {DEFAULT_ORGANIZATION_SETUP as initial,ORGANIZATION_STORAGE_KEY as key,ORGANIZATION_TOPICS,organizationFocusUrl,organizationSetupFromHash,organizationReadingSettings,validOrganizationSetup,rememberOrganizationSetup,restoreOrganizationSetup,forgetOrganizationSetup,organizationPilotRequest} from '../.build/src/organizations/setup.js';
const read=p=>readFileSync(p,'utf8');
const store=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('organization preview round-trips exact supported choices without exposing organization identity',()=>{
 for(const plan of ['local','teams','public'])for(const budget of [6,12]){
  const s={...initial,plan,budget,query:'🌍 energy & climate + "EU" #updates / 2026'};
  const url=organizationFocusUrl(s);assert.ok(url.startsWith('/#org='));assert.deepEqual(organizationSetupFromHash(url.slice(1)),s);
  assert.deepEqual(organizationReadingSettings(s),{topics:s.topics,query:s.query,budget,mode:'briefing'});
 }
});
test('untrusted hash cannot widen topic access, carry entitlements or hide duplicate parameters',()=>{
 const good=organizationFocusUrl(initial).slice(1);
 const invalid=[good+'&org=public',good+'&paid=true',good.replace('org=teams','org=__proto__'),good.replace('cards=6','cards=0'),good.replace('cards=6','cards=999999'),good.replace('topics=business%2Cregulation%2Copportunities','topics=technology'),good.replace('topics=business%2Cregulation%2Copportunities','topics='),good.replace('topics=business%2Cregulation%2Copportunities','topics=business%2Cbusiness'),good.replace('query=','query=%0d%0a'),good.replace('query=','query='+'a'.repeat(201)),good.replace('&query=','&unknown='),'#briefing-topic=business','#org='+('a'.repeat(1600))];
 for(const hash of invalid)assert.equal(organizationSetupFromHash(hash),null,hash);
 assert.equal(ORGANIZATION_TOPICS.some(t=>t.id==='technology'),false);
});
test('setup validation rejects foreign keys, malformed types, nested values and invisible control characters',()=>{
 for(const value of [null,[],{}, {...initial,subscription:true},{...initial,topics:'business'},{...initial,topics:[{}]},{...initial,topics:[]},{...initial,budget:'6'},{...initial,query:' hidden '},{...initial,query:'abc\u0000def'},{...initial,query:'\ud800'},{...initial,plan:'constructor'}])assert.equal(validOrganizationSetup(value),false);
 assert.throws(()=>organizationFocusUrl({...initial,topics:[]}),/INVALID/);
});
test('organization setup is saved only on explicit write and stays separate from other browser data',()=>{
 const s=store();s.setItem('dlkt-personal-focus','unchanged');assert.deepEqual(restoreOrganizationSetup(()=>s),{state:'empty'});
 assert.equal(rememberOrganizationSetup(()=>s,initial),'saved');assert.deepEqual(restoreOrganizationSetup(()=>s),{state:'saved',setup:initial});
 assert.equal(forgetOrganizationSetup(()=>s),'cleared');assert.equal(s.getItem(key),null);assert.equal(s.getItem('dlkt-personal-focus'),'unchanged');
});
test('corrupt, oversized, blocked and silently rejected storage never reports a successful save',()=>{
 const s=store();for(const value of ['not json',JSON.stringify({...initial,email:'private@example.com'}),'x'.repeat(4097)]){s.setItem(key,value);assert.equal(restoreOrganizationSetup(()=>s).state,'invalid');}
 const blocked=()=>{throw Error('blocked');};assert.equal(restoreOrganizationSetup(blocked).state,'blocked');assert.equal(rememberOrganizationSetup(blocked,initial),'blocked');assert.equal(forgetOrganizationSetup(blocked),'blocked');
 const silent={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};assert.equal(rememberOrganizationSetup(()=>silent,initial),'blocked');
 const cannotClear={getItem:()=>JSON.stringify(initial),setItem:()=>{},removeItem:()=>{}};assert.equal(forgetOrganizationSetup(()=>cannotClear),'blocked');
});
test('pilot request has fixed recipient, encoded content and explicit non-purchase terms',()=>{
 const s={...initial,query:'<img src=x> & test@example.com?x=1'};const name='A&B <Organization> #1';const draft=organizationPilotRequest(s,name);
 assert.ok(draft.mailto.startsWith('mailto:office@dlkt.ee?'));
 const params=new URLSearchParams(draft.mailto.split('?')[1]);assert.deepEqual([...params.keys()],['subject','body']);assert.equal(params.get('body'),draft.body);assert.ok(draft.body.includes(name));assert.match(draft.body,/Final scope, taxes and terms to be agreed before payment/);assert.match(draft.body,/does not create an account/);
 assert.throws(()=>organizationPilotRequest(initial,'A\r\nBcc: victim@example.com'),/INVALID/);assert.throws(()=>organizationPilotRequest(initial,'x'.repeat(101)),/INVALID/);assert.throws(()=>organizationPilotRequest(initial,'\udfff'),/INVALID/);
 assert.equal(organizationPilotRequest(initial,'').body.includes('Organization:'),false);
});
test('organization form has explicit save, live reader preview and review-before-email actions',()=>{
 const doc=parseDocument(read('public/organizations.html'));const nodes=DomUtils.findAll(()=>true,doc.children);const byId=id=>nodes.find(n=>n.attribs?.id===id);
 for(const id of ['organization-setup','organization-topics','organization-remember','organization-continue','organization-forget','organization-prepare','organization-request-text','organization-email'])assert.ok(byId(id),id);
 assert.ok(Object.hasOwn(byId('organization-request').attribs,'hidden'));assert.ok(Object.hasOwn(byId('organization-request-text').attribs,'readonly'));assert.equal(byId('organization-email').attribs.href,undefined);
 assert.match(read('public/organizations.html'),/not active subscriptions/);assert.match(read('public/organizations.html'),/No message has been sent/);
 const browser=read('src/organizations/browser.ts');assert.doesNotMatch(browser,/fetch\(|XMLHttpRequest|sendBeacon|innerHTML|outerHTML|eval\(|setInterval/u);assert.match(browser,/form.addEventListener\('input',invalidateRequest\)/);
});
test('organization public scripts exactly match reviewed compiled TypeScript',()=>{
 for(const file of ['setup','browser'])assert.equal(read(`public/organization-${file}.js`),read(`.build/src/organizations/${file}.js`).replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./setup.js'","'./organization-setup.js'").replaceAll("'../iceo/","'./"));
});
