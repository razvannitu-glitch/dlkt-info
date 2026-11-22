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
  check(`${tone} photo topic badge`,vars['--reader-card-badge-ink'],vars[`--reader-card-${tone}-accent`],4.5);
  check(`${tone} category accent`,vars[`--reader-card-${tone}-accent`],surface,3);
 }
 const text=observations.filter(item=>item.minimum===4.5).sort((a,b)=>a.ratio-b.ratio)[0];
 const control=observations.filter(item=>item.minimum===3).sort((a,b)=>a.ratio-b.ratio)[0];
 t.diagnostic(`${tones.length} category tones, ${observations.length} pairs; lowest text ${text.name} ${text.ratio.toFixed(3)}:1; lowest control ${control.name} ${control.ratio.toFixed(3)}:1`);
});
