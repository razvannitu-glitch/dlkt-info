import test from 'node:test';
import assert from 'node:assert/strict';
import {accountText,applyAccountPresentation} from '../.build/src/account/presentation.js';
const stamp='2026-11-25T10:00:00.000Z';
test('account dynamic copy is translated without changing original values',()=>{
 const cases=[
  ['Profile updated: '+stamp+'.','Profil actualizat: '+stamp+'.'],
  ['2 saved cards. A remembered focus. No comparison check.','2 carduri salvate. Cu preferinta memorata. Fara comparatie salvata.'],
  ['1 saved cards. No remembered focus. A comparison check.','1 card salvat. Fara preferinta memorata. Cu o comparatie salvata.'],
 ];
 for(const [english,romanian]of cases){assert.equal(accountText(english,'ro'),romanian);assert.equal(accountText(english,'en'),english);assert.equal(accountText(english,'ar'),english);}
 assert.match(accountText('Account copy updated: '+stamp+'. Saved cards are dated copies, not fresh source checks.','ro'),/^Selectie actualizata in cont:/u);
 assert.match(accountText('Replace the account reader copy with 2 saved cards, your remembered focus and no comparison from this browser? Existing account data will be replaced; browser data stays intact.','ro'),/^Inlocuiesti selectia din cont cu 2 carduri salvate/u);
 assert.equal(accountText('constructor','ro'),'constructor');
});
test('existing dynamic account text follows language changes without re-rendering unsaved profile fields',t=>{
 const keys=['document','window','navigator','Node'],prior=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 t.after(()=>{for(const [key,descriptor]of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
 const root={},profileName={value:'Unsaved local edit'},sourceTitle={textContent:'Science'},value={};
 const nodes=[
  {dataset:{accountCopy:'No profile has been saved in this account. These starting values are saved only when you choose Save profile.'}},
  {dataset:{accountCopy:'Profile updated: '+stamp+'.'}},
  {dataset:{accountCopy:'2 saved cards. A remembered focus. No comparison check.'}},
 ];
 const document={querySelector:selector=>selector==='main.account-page'?root:null,
  querySelectorAll:selector=>selector==='[data-account-copy]'?nodes:[],
  getElementById:id=>id==='account-value'?value:id==='account-profile-name'?profileName:null};
 const location={href:'https://www.dlkt.ee/account?lang=ro'};
 for(const [key,value]of Object.entries({document,window:{location},navigator:{languages:['en']},Node:{TEXT_NODE:3}}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
 applyAccountPresentation();assert.equal(root.lang,'ro');assert.ok(nodes.every(node=>node.lang==='ro'));
 assert.equal(nodes[1].textContent,'Profil actualizat: '+stamp+'.');assert.match(nodes[2].textContent,/carduri salvate/u);
 location.href='https://www.dlkt.ee/account?lang=en';applyAccountPresentation();
 assert.equal(root.lang,'en');for(const node of nodes)assert.equal(node.textContent,node.dataset.accountCopy);
 location.href='https://www.dlkt.ee/account?lang=ar';applyAccountPresentation();
 assert.equal(root.lang,'en');assert.equal(root.dir,'ltr');assert.equal(value.lang,'ar');assert.equal(value.dir,'rtl');
 assert.equal(profileName.value,'Unsaved local edit');assert.equal(sourceTitle.textContent,'Science');
});
