import test from 'node:test';
import assert from 'node:assert/strict';
import {AudienceBrowser,classifySource,readChoice} from '../.build/src/audience/browser.js';
const id='00000000-0000-4000-8000-000000000001';
function fixture(initial=null){
 let choice=initial,now=1_000_000,visible=true,privacy=false,uuidCalls=0,writeAllowed=true;
 const calls=[];let handler=async action=>({status:200,value:action.action==='enable'?{enabled:true}:action.action==='withdraw'?{enabled:false}:action.action==='status'?{available:true,hasToken:false}:{result:'accepted'}});
 const d={read:()=>choice,write:v=>{if(!writeAllowed)return false;choice=v;return true;},request:a=>{calls.push(a);return handler(a);},visible:()=>visible,privacy:()=>privacy,now:()=>now,uuid:()=>{uuidCalls++;return id;},source:()=> 'search'};
 return {client:new AudienceBrowser(d),calls,choice:()=>choice,change:v=>{choice=v;},tick:n=>{now+=n;},visible:v=>{visible=v;},privacy:v=>{privacy=v;},handler:h=>{handler=h;},uuidCalls:()=>uuidCalls,writeAllowed:v=>{writeAllowed=v;}};
}
test('no opt-in means no event, identifier, or status probe in reader mode',async()=>{
 const f=fixture();f.client.interaction();await f.client.pageview();await f.client.presence();assert.equal(f.calls.length,0);assert.equal(f.uuidCalls(),0);
 assert.equal(readChoice('anything'),null);
});
test('explicit opt-in is the only route to a pageview and duplicates in one document are blocked',async()=>{
 const f=fixture();assert.equal(await f.client.enable(),true);assert.equal(f.choice(),'allow');await f.client.pageview();await f.client.pageview();
 assert.deepEqual(f.calls,[{action:'enable'},{action:'event',event:{kind:'pageview',id,source:'search'}}]);assert.equal(f.uuidCalls(),1);
});
test('presence requires foreground visibility, recent interaction, and a two minute interval',async()=>{
 const f=fixture('allow');await f.client.pageview();f.tick(120001);await f.client.presence();assert.equal(f.calls.length,1);
 f.client.interaction();f.visible(false);await f.client.presence();assert.equal(f.calls.length,1);
 f.visible(true);await f.client.presence();assert.deepEqual(f.calls.at(-1),{action:'event',event:{kind:'presence'}});
 await f.client.presence();assert.equal(f.calls.length,2);
 f.tick(120001);f.privacy(true);f.client.interaction();await f.client.presence();assert.equal(f.calls.length,2);
});
test('withdrawal immediately stops measurement even when server deletion fails',async()=>{
 const f=fixture('allow');await f.client.pageview();f.handler(async()=>({status:503,value:null}));assert.equal(await f.client.withdraw(),false);
 assert.equal(f.choice(),'withdraw');f.tick(180000);f.client.interaction();await f.client.presence();assert.equal(f.calls.length,2);
 f.handler(async()=>({status:200,value:{enabled:false}}));assert.equal(await f.client.withdraw(),true);assert.equal(f.choice(),'deny');
});
test('unconfirmed opt-in triggers compensating withdrawal instead of collecting',async()=>{
 const f=fixture();f.handler(async a=>a.action==='enable'?{status:0,value:null}:{status:200,value:{enabled:false}});
 assert.equal(await f.client.enable(),false);assert.equal(f.choice(),'deny');await f.client.pageview();assert.deepEqual(f.calls,[{action:'enable'},{action:'withdraw'}]);
});
test('cross-tab refusal during opt-in cannot be overwritten by a delayed success',async()=>{
 const f=fixture();let complete;
 f.handler(a=>a.action==='enable'?new Promise(resolve=>{complete=resolve;}):Promise.resolve({status:200,value:{enabled:false}}));
 const pending=f.client.enable();f.change('withdraw');complete({status:200,value:{enabled:true}});
 assert.equal(await pending,false);assert.equal(f.choice(),'deny');await f.client.pageview();assert.equal(f.calls.length,2);
});
test('privacy controls and inaccessible local storage fail closed',async()=>{
 const f=fixture();f.privacy(true);assert.equal(await f.client.enable(),false);assert.equal(f.calls.length,0);
 f.privacy(false);f.writeAllowed(false);assert.equal(await f.client.enable(),false);assert.equal(f.calls.length,0);
});
test('expired token does not silently re-enable or generate retries',async()=>{
 const f=fixture('allow');f.handler(async()=>({status:401,value:null}));await f.client.pageview();assert.equal(f.choice(),'deny');await f.client.pageview();assert.equal(f.calls.length,1);
});
test('referrer classification returns only a coarse source class, never the URL',()=>{
 const origin='https://www.dlkt.ee';assert.equal(classifySource('',origin),'direct');assert.equal(classifySource(origin+'/private',origin),'direct');
 assert.equal(classifySource('https://www.google.ro/search?q=private',origin),'search');assert.equal(classifySource('https://evil-google.com/',origin),'referral');
 assert.equal(classifySource('https://m.facebook.com/private',origin),'social');assert.equal(classifySource('https://example.test/secret?email=private',origin),'referral');
 assert.equal(classifySource('invalid',origin),'unknown');
});
