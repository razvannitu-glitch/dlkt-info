import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Numeric guard for the actual shipped opaque card surfaces, including the
// reading panel below a photo. Browser checks separately establish the cascade.
const css=readFileSync('public/reader-theme.css','utf8').replace(/\/\*[\s\S]*?\*\//gu,'');
const rules=[...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)];
function variables(theme){
 const vars={};
 for(const [,selector,body]of rules){
  if(selector.trim()!==`html[data-reader-theme=${theme}]`)continue;
  for(const item of body.split(';')){
   const split=item.indexOf(':');if(split<0)continue;
   vars[item.slice(0,split).trim()]=item.slice(split+1).trim();
  }
 }
 return vars;
}
function rgb(value){
 assert.match(value,/^#[\da-f]{6}$/iu,'The tested paint must be an opaque six-digit color');
 return [1,3,5].map(offset=>parseInt(value.slice(offset,offset+2),16)/255);
}
function luminance(value){
 return rgb(value).map(channel=>channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4)
  .reduce((sum,channel,index)=>sum+channel*[.2126,.7152,.0722][index],0);
}
function contrast(ink,surface){
 const [lighter,darker]=[luminance(ink),luminance(surface)].sort((a,b)=>b-a);
 return(lighter+.05)/(darker+.05);
}

for(const theme of ['prism','night'])test(`${theme}: every category surface keeps text, captions, badges and controls readable`,t=>{
 const vars=variables(theme);
 const tones=Object.keys(vars).filter(key=>/^--reader-card-[a-z]+-surface$/u.test(key));
 assert.ok(tones.length>0,'No shipped category palette found');
 const observations=[];
 const check=(name,ink,surface,minimum)=>{
  const ratio=contrast(ink,surface);observations.push({name,ratio,minimum});
  assert.ok(ratio>=minimum,`${theme} ${name}: ${ratio.toFixed(3)}:1, requires ${minimum}:1`);
 };
 for(const token of tones){
  const surface=vars[token],tone=token.slice('--reader-card-'.length,-'-surface'.length);
  for(const role of ['ink','muted','link'])check(`${tone} ${role}`,vars[`--reader-${role}`],surface,4.5);
  for(const role of ['edge','action','focus','selected-edge'])check(`${tone} ${role}`,vars[`--reader-${role}`],surface,3);
  // A label's background is independent of the category border/dot.
  const badge=vars[`--reader-card-${tone}-badge`]??vars[`--reader-card-${tone}-accent`];
  const badgeInk=vars[`--reader-card-${tone}-badge-ink`]??vars['--reader-card-badge-ink'];
  check(`${tone} photo topic badge`,badgeInk,badge,4.5);
  check(`${tone} category accent`,vars[`--reader-card-${tone}-accent`],surface,3);
 }
 const text=observations.filter(item=>item.minimum===4.5).sort((a,b)=>a.ratio-b.ratio)[0];
 const control=observations.filter(item=>item.minimum===3).sort((a,b)=>a.ratio-b.ratio)[0];
 t.diagnostic(`${tones.length} category tones, ${observations.length} pairs; lowest text ${text.name} ${text.ratio.toFixed(3)}:1; lowest control ${control.name} ${control.ratio.toFixed(3)}:1`);
});

const themeScope='html:is([data-reader-theme=prism],[data-reader-theme=night])';
const readingRoots=':is(#discovery-cards,#world-cards,#cards,#daily-cards,#local-cards,#edition-content)';
const prismCard=`html[data-reader-theme=prism] ${readingRoots} .info-card`;
function selectorList(value){
 const result=[];let depth=0,start=0;
 for(let index=0;index<value.length;index++){
  if(value[index]==='('||value[index]==='[')depth++;
  else if(value[index]===')'||value[index]===']')depth--;
  else if(value[index]===','&&depth===0){result.push(value.slice(start,index).replace(/\s+/gu,' ').trim());start=index+1;}
 }
 result.push(value.slice(start).replace(/\s+/gu,' ').trim());return result;
}
function customDeclarations(selector){
 const output={};
 for(const [,selectors,body]of rules)if(selectorList(selectors).includes(selector)){
  for(const item of body.split(';')){const colon=item.indexOf(':');if(colon<0)continue;const name=item.slice(0,colon).trim();if(name.startsWith('--'))output[name]=item.slice(colon+1).trim();}
 }
 return output;
}
function resolve(value,vars,seen=[]){
 return value.replace(/var\((--[\w-]+)\)/gu,(_match,key)=>{
  assert.ok(Object.hasOwn(vars,key),`Missing role ${key}`);assert.ok(!seen.includes(key),`Cyclic role ${key}`);
  return resolve(vars[key],vars,[...seen,key]);
 });
}
// Hover fills may be pink or paper; the actual opaque border retains the control boundary.
const primaryHoverSelector='html[data-reader-theme=prism] :is(.primary,.focus-button,.entry-field>button,.source-link):not(:disabled):not([aria-disabled=true]):hover';
const primaryHoverBorder=rules.filter(([,selectors])=>selectorList(selectors).includes(primaryHoverSelector))
 .flatMap(([, ,body])=>body.split(';').map(item=>item.trim()).filter(item=>item.startsWith('border-color:')))
 .at(-1)?.slice('border-color:'.length).replace(/\s*!important\s*$/u,'').trim();
assert.ok(primaryHoverBorder,'The shipped primary hover must retain a visible border');
const approvedSurfaces={paper:'#F0EDE5',ivory:'#D8D6CD',coral:'#F66061',berry:'#142D44',wine:'#7D969B',gold:'#B7C4C3'};
const rootVariables=Object.assign(variables('prism'),customDeclarations(themeScope));
function cardVariables(name,inherited){
 // Custom properties are computed on the parent before inheritance, including
 // when that parent is another card inside a Daily disclosure.
 const computedParent=Object.fromEntries(Object.entries(inherited).map(([key,value])=>[key,resolve(value,inherited)]));
 return Object.assign(computedParent,customDeclarations(`${themeScope} ${readingRoots} .info-card`),customDeclarations(prismCard),
  customDeclarations(`${prismCard}[data-reader-surface]`),customDeclarations(`${prismCard}[data-reader-surface=${name}]`));
}
for(const [name,expected]of Object.entries(approvedSurfaces))test(`Prism ${name}: exact selected surface and all nested reading/action roles remain accessible`,t=>{
 // CSS aliases inherited from html have already computed there. A missing local
 // rebinding must expose the original dark ink, rather than spuriously resolving white.
 const vars=cardVariables(name,rootVariables);
 const paint=role=>{assert.ok(Object.hasOwn(vars,role),role);return resolve(vars[role],vars);};
 const surface=paint('--card-tone-surface');assert.equal(surface,expected);
 for(const role of ['--reader-page','--reader-surface','--reader-panel','--white','--soft','--card-bg'])assert.equal(paint(role),surface,`${name} nested surface ${role}`);
 const measured=[];
 const check=(label,ink,background,minimum)=>{const ratio=contrast(ink,background);measured.push({label,ratio,minimum});assert.ok(ratio>=minimum,`${name} ${label}: ${ratio.toFixed(3)}:1, requires ${minimum}:1`);};
 for(const role of ['--reader-ink','--reader-muted','--reader-link','--black','--muted','--card-ink','--card-title','--card-muted','--reader-photo-link'])check(role,paint(role),surface,4.5);
 for(const [label,ink,background]of [
  ['primary','--reader-action-ink','--reader-action'],['primary hover','--reader-action-hover-ink','--reader-action-hover'],
  ['legacy primary','--card-action-ink','--card-action'],['saved','--reader-selected-ink','--reader-selected'],
  ['saved hover','--reader-action-hover-ink','--reader-action-hover'],
  ['secondary hover','--reader-secondary-hover-ink','--reader-secondary-hover'],['legacy hover','--card-hover-ink','--card-hover'],
  ['topic badge','--card-tone-badge-ink','--card-tone-badge'],
 ])check(label,paint(ink),paint(background),4.5);
 check('photo kind label',surface,paint('--reader-ink'),4.5);
 for(const role of ['--reader-edge','--reader-rule','--reader-action','--reader-selected-edge','--reader-focus','--reader-photo-focus','--card-tone-accent'])check(role,paint(role),surface,3);
 check('primary hover boundary',resolve(primaryHoverBorder,vars),surface,3);
 for(const [label,normal,hover]of [['primary','--reader-action','--reader-action-hover'],['saved','--reader-selected','--reader-action-hover']])
  if(luminance(paint(normal))<.1)check(`${label} dark-to-hover state change`,paint(hover),paint(normal),3);
 const text=measured.filter(value=>value.minimum===4.5).sort((a,b)=>a.ratio-b.ratio)[0];
 const control=measured.filter(value=>value.minimum===3).sort((a,b)=>a.ratio-b.ratio)[0];
 t.diagnostic(`${measured.length} real role pairs; minimum text ${text.ratio.toFixed(3)}:1, minimum control ${control.ratio.toFixed(3)}:1`);
});

test('all 36 nested surface pairs reset semantic paints after inheriting a computed parent',()=>{
 for(const parent of Object.keys(approvedSurfaces))for(const child of Object.keys(approvedSurfaces)){
  const standalone=cardVariables(child,rootVariables),nested=cardVariables(child,cardVariables(parent,rootVariables));
  const paint=role=>resolve(nested[role],nested),surface=paint('--card-tone-surface');
  assert.equal(surface,approvedSurfaces[child]);
  // Every role used by text, actions, photos and legacy selectors must depend on
  // this card's surface, never the color of an enclosing Daily context card.
  for(const role of Object.keys(standalone).filter(key=>/^--(?:reader-|card-|black$|white$|muted$|line$|soft$)/u.test(key)))
   assert.equal(paint(role),resolve(standalone[role],standalone),`${parent} > ${child}: inherited ${role}`);
  for(const role of ['--reader-ink','--reader-muted','--reader-link','--black','--muted','--card-ink','--card-title','--card-muted','--reader-photo-link'])
   assert.ok(contrast(paint(role),surface)>=4.5,`${parent} > ${child}: ${role} requires 4.5:1`);
  for(const role of ['--reader-edge','--reader-action','--reader-selected-edge','--reader-focus','--reader-photo-focus','--card-tone-accent'])
   assert.ok(contrast(paint(role),surface)>=3,`${parent} > ${child}: ${role} requires 3:1`);
  assert.ok(contrast(resolve(primaryHoverBorder,nested),surface)>=3,`${parent} > ${child}: actual hover border requires 3:1`);
 }
});
