import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const scope='html:is([data-reader-theme=prism],[data-reader-theme=night])';
const cards=':is(#discovery-cards,#home-local-cards,#world-cards,#cards)>.info-card.editorial-card';
const toneCards=':is(#discovery-cards,#home-local-cards,#world-cards,#cards,#daily-cards,#local-cards,#edition-content) .info-card';
const normalise=value=>value.replace(/\s+/gu,' ').trim();

// Read the shipped declarations; no second copy of the palette or its opacity values.
// These numeric checks complement browser verification of the actual cascade and geometry.
function selectors(value){
  const result=[];let depth=0,start=0;
  for(let index=0;index<value.length;index++){
    const character=value[index];
    if(character==='('||character==='[')depth++;
    else if(character===')'||character===']')depth--;
    else if(character===','&&depth===0){result.push(normalise(value.slice(start,index)));start=index+1;}
  }
  result.push(normalise(value.slice(start)));return result;
}
function readRules(file){
  const css=readFileSync(file,'utf8').replace(/\/\*[\s\S]*?\*\//gu,'');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(([,selector,body])=>({
    selectors:selectors(selector),
    declarations:Object.fromEntries(body.split(';').map(value=>value.trim()).filter(Boolean).map(value=>{
      const colon=value.indexOf(':');assert.ok(colon>0,`Invalid declaration in ${file}: ${value}`);
      return[value.slice(0,colon).trim(),value.slice(colon+1).trim().replace(/\s*!important\s*$/u,'')];
    })),
  }));
}
const themeRules=readRules('public/reader-theme.css');
const headerRules=readRules('public/header.css');
const cardRules=readRules('public/editorial-cards.css');
const readerRules=readRules('public/iceo.css');
const exploreRules=readRules('public/explore.css');
function declarations(rules,selector){
  const matching=rules.filter(rule=>rule.selectors.includes(normalise(selector)));
  assert.ok(matching.length,`Missing actual selector: ${selector}`);
  return Object.assign({},...matching.map(rule=>rule.declarations));
}
function optionalProperty(rules,selector,property){
  return rules.filter(rule=>rule.selectors.includes(normalise(selector))).map(rule=>rule.declarations[property]).filter(value=>value!==undefined).at(-1);
}
function property(rules,selector,name){
  const value=declarations(rules,selector)[name];assert.ok(value,`Missing ${name}: ${selector}`);return value;
}
function variables(theme){
  return Object.assign({},declarations(themeRules,`html[data-reader-theme=${theme}]`),declarations(themeRules,scope));
}
function resolve(value,vars,visited=[]){
  return value.replace(/var\((--[\w-]+)(?:,([^()]+))?\)/gu,(_match,key,fallback)=>{
    assert.ok(Object.hasOwn(vars,key)||fallback!==undefined,`Unknown color token ${key}`);assert.ok(!visited.includes(key),`Cyclic token ${key}`);
    return resolve(Object.hasOwn(vars,key)?vars[key]:fallback,vars,[...visited,key]);
  });
}
function color(value,vars){
  const resolved=resolve(value,vars).trim();
  if(resolved==='transparent')return{rgb:[0,0,0],alpha:0};
  const hex=/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu.exec(resolved);
  if(hex){
    const full=hex[1].length===3?[...hex[1]].map(character=>character+character).join(''):hex[1];
    return{rgb:[0,2,4].map(offset=>Number.parseInt(full.slice(offset,offset+2),16)/255),alpha:full.length===8?Number.parseInt(full.slice(6,8),16)/255:1};
  }
  const mix=/^color-mix\(\s*in srgb\s*,\s*(.+)\s+(\d+(?:\.\d+)?)%\s*,\s*transparent\s*\)$/u.exec(resolved);
  if(mix){
    const base=color(mix[1],vars),weight=Number(mix[2])/100;assert.ok(weight>=0&&weight<=1);
    return{rgb:base.rgb,alpha:base.alpha*weight};
  }
  assert.fail(`Unmodelled CSS color: ${resolved}`);
}
function over(foreground,background){
  assert.equal(background.alpha,1,'Contrast backdrop must be opaque');
  return{rgb:foreground.rgb.map((channel,index)=>channel*foreground.alpha+background.rgb[index]*(1-foreground.alpha)),alpha:1};
}
function luminance(value){
  assert.equal(value.alpha,1);
  const linear=value.rgb.map(channel=>channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4);
  return linear.reduce((sum,channel,index)=>sum+channel*[0.2126,0.7152,0.0722][index],0);
}
function contrast(foreground,background){
  const values=[luminance(over(foreground,background)),luminance(background)].sort((left,right)=>right-left);
  return(values[0]+0.05)/(values[1]+0.05);
}
function checks(t){
  const observed=[];
  return{
    add(label,foreground,background,minimum){
      const ratio=contrast(foreground,background);observed.push({label,ratio});
      assert.ok(ratio>=minimum,`${label}: ${ratio.toFixed(3)}:1, requires ${minimum}:1`);
    },
    report(){const lowest=observed.reduce((left,right)=>left.ratio<right.ratio?left:right);t.diagnostic(`${observed.length} color pairs; lowest ${lowest.label}: ${lowest.ratio.toFixed(3)}:1`);},
  };
}

for(const theme of ['prism','night']){
  test(`${theme}: actual text, muted text, links and action states meet 4.5:1`,t=>{
    const vars=variables(theme),check=checks(t);
    for(const foreground of ['ink','muted','link'])for(const background of ['page','surface','panel']){
      check.add(`${foreground} / ${background}`,color(`var(--reader-${foreground})`,vars),color(`var(--reader-${background})`,vars),4.5);
    }
    const states=[
      ['primary',`${scope} :is(.primary,.focus-button,.entry-field>button)`],
      ['primary hover',`${scope} :is(.primary,.focus-button,.entry-field>button,.source-link):not(:disabled):not([aria-disabled=true]):hover`],
      ['secondary',`${scope} :is(.secondary,.save-card,.share-source,.insight-load)`],
      ['saved',`${scope} .save-card[aria-pressed=true]`],
      ['secondary hover',`${scope} :is(button,a.source-link,.more-menu a,.reader-more>summary,.footer-link,.legal-toc a):not(:disabled):not([aria-disabled=true]):hover`],
      ['appearance action',`${scope} #reader-theme-toggle`],
    ];
    for(const [label,selector]of states){
      check.add(label,color(property(themeRules,selector,'color'),vars),color(property(themeRules,selector,'background'),vars),4.5);
    }
    for(const [label,selector]of [
      ['keyboard secondary',':root :is(button,a.primary,a.secondary,a.focus-button,a.text-button,a.source-link,.more-menu a,.reader-more>summary,.footer-link,.legal-toc a):not(:disabled):not([aria-disabled=true]):focus-visible'],
      ['keyboard primary',':root :is(.primary,.focus-button,.entry-field>button,.source-link,button[aria-pressed=true],button[aria-expanded=true],[aria-current=page]):not(:disabled):not([aria-disabled=true]):focus-visible'],
    ])check.add(label,color(property(headerRules,selector,'color'),vars),color(property(headerRules,selector,'background'),vars),4.5);
    check.report();
  });

  test(`${theme}: visible control edges, selected boundaries and focus meet 3:1 against adjacent surfaces`,t=>{
    const vars=variables(theme),check=checks(t);
    for(const boundary of ['edge','selected-edge','action','focus'])for(const background of ['page','surface','panel']){
      check.add(`${boundary} / ${background}`,color(`var(--reader-${boundary})`,vars),color(`var(--reader-${background})`,vars),3);
    }
    check.report();
  });

  test(`${theme}: nested labels retain readable colors on hovered and selected controls`,t=>{
    const vars=variables(theme),check=checks(t);
    const hover=`${scope} :is(button,a.source-link,.more-menu a,.reader-more>summary,.footer-link,.legal-toc a):not(:disabled):not([aria-disabled=true]):hover`;
    const parent=property(themeRules,hover,'color'),background=color(property(themeRules,hover,'background'),vars);
    const cases=[
      ['city suggestion',exploreRules,'.world-city-results button span','.world-city-results button:not(:disabled):hover span'],
      ['daily interest',readerRules,'.daily-interest small','.daily-interest:not(:disabled):hover small'],
      ['daily length',readerRules,'.daily-lengths small','.daily-lengths button:not(:disabled):hover small'],
      ['selected daily length',themeRules,`${scope} .daily-lengths button[aria-pressed=true] small`,'.daily-lengths button:not(:disabled):hover small'],
      ['signal label',readerRules,'.glance-label','.glance-tile:not(:disabled):hover :is(.glance-label,small)'],
      ['signal detail',readerRules,'.glance-tile small','.glance-tile:not(:disabled):hover :is(.glance-label,small)'],
    ];
    for(const [label,baseRules,baseSelector,hoverSelector]of cases){
      // Use the real nested rule when present; removing it exposes the real resting color.
      const value=optionalProperty(themeRules,`${scope} ${hoverSelector}`,'color')??property(baseRules,baseSelector,'color');
      check.add(label,color(value==='inherit'?parent:value,vars),background,4.5);
    }
    check.report();
  });

  test(`${theme}: real photo headline, hover, focus and badges pass over the brightest possible image`,t=>{
    const themeCardSelector=`html[data-reader-theme=${theme}] ${toneCards}`;
    const themeCardRules=themeRules.filter(rule=>rule.selectors.includes(themeCardSelector)).map(rule=>rule.declarations);
    const vars=Object.assign(variables(theme),declarations(themeRules,`${scope} ${toneCards}`),...themeCardRules,declarations(themeRules,`${scope} .photo-editorial:not(.photo-unavailable) .card-photo-visual`));
    const check=checks(t),white=color('#fff',{});
    const panelSelector=`${scope} ${toneCards} .photo-editorial .card-photo-headline`;
    const panel=color(property(themeRules,panelSelector,'background'),vars);assert.equal(panel.alpha,1,'Both themes use an opaque reading panel below the complete photo');
    const background=over(panel,white);
    const title=color(property(themeRules,panelSelector,'color'),vars);
    const hover=color(property(themeRules,`${scope} ${cards} .card-title-link:not(:disabled):hover`,'color'),vars);
    const focus=color(property(themeRules,`${scope} ${cards} .photo-editorial:not(.photo-unavailable) .card-photo-headline a:focus-visible`,'outline-color'),vars);
    check.add('photo title',title,background,4.5);check.add('photo title hover',hover,background,4.5);check.add('photo focus',focus,background,3);
    const longBackground=background;
    check.add('long photo title',title,longBackground,4.5);check.add('long photo title hover',hover,longBackground,4.5);check.add('long photo focus',focus,longBackground,3);
    const scopedLabel=`${themeCardSelector} .card-photo-label`;
    const imageLabel=optionalProperty(themeRules,scopedLabel,'background')===undefined?`${scope} .card-photo-label`:scopedLabel;
    for(const [label,rules,selector]of [['image label',themeRules,imageLabel],['topic badge',themeRules,`${scope} ${toneCards} .photo-editorial .card-topic`]]){
      check.add(label,color(property(rules,selector,'color'),vars),over(color(property(rules,selector,'background'),vars),white),4.5);
    }
    t.diagnostic(`Headline opacity ${(panel.alpha*100).toFixed(0)}%; image pixels cannot change headline contrast. The photo label is additionally checked over a white image.`);
    check.report();
  });
}
