import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {authenticationEmailPreview,AUTHENTICATION_EMAIL_KATE} from '../source/.build/src/identity/email-template.js';
const locales=new Set(['ro','en','ar']);
/** Loopback-only synthetic email surface: no Auth call, recipient, token or delivery. */
export function syntheticEmailFixture(url){
  if(url.pathname!=='/__qa/auth-email')return null;
  if(url.searchParams.size!==1||!locales.has(url.searchParams.get('lang')))return {status:400,html:'Invalid synthetic locale'};
  const html=authenticationEmailPreview(url.searchParams.get('lang'),'0000000000');
  assert.equal(html.split(AUTHENTICATION_EMAIL_KATE).length-1,1);
  return {status:200,html:html.replace(AUTHENTICATION_EMAIL_KATE,'/kate-head.png')};
}

function syntheticCodeVisibility(){
 const code=[...document.querySelectorAll('p')].find(node=>node.textContent==='0000000000');if(!code)throw Error('AUTH_EMAIL_CODE_MISSING');
 const box=code.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(code);const text=range.getBoundingClientRect();
 let painted=true;for(let node=code;node;node=node.parentElement){const style=getComputedStyle(node);if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)<=0){painted=false;break;}}
 return {visible:painted&&box.width>0&&box.height>0&&text.width>0&&text.height>0,
  fits:text.left>=box.left-.5&&text.right<=box.right+.5&&text.top>=box.top-.5&&text.bottom<=box.bottom+.5&&text.left>=-.5&&text.right<=innerWidth+.5,
  width:box.width,height:box.height,textWidth:text.width,textHeight:text.height};
}

export async function verifyAuthenticationEmailPreview({call,origin,evaluate,loaded,outputDir,emitVisualPreview}){
  const observations=[];
  for(const language of ['ro','ar']){
    for(const width of [320,600]){
      await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await call('Page.navigate',{url:origin+'/__qa/auth-email?lang='+language});await loaded(call);
      const measured=await evaluate(call,`(()=>{
        const html=document.documentElement,body=document.body,image=document.querySelector('img'),heading=document.querySelector('h1');
        if(!image||!heading)throw Error('AUTH_EMAIL_PREVIEW_MISSING');
        const code=[...document.querySelectorAll('p')].find(node=>node.textContent==='0000000000');
        if(!code)throw Error('AUTH_EMAIL_CODE_MISSING');
        const r=code.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(code);
        const text=range.getBoundingClientRect(),paragraphs=[...document.querySelectorAll('p,h1')];
        const violations=paragraphs.filter(node=>{const box=node.getBoundingClientRect();return box.left<-.5||box.right>innerWidth+.5||node.scrollWidth>node.clientWidth+1;}).map(node=>node.tagName);
        return {width:innerWidth,documentWidth:Math.max(html.scrollWidth,body.scrollWidth),lang:html.lang,dir:html.dir,
          imageLoaded:image.complete&&image.naturalWidth>0&&image.naturalHeight>0,token:code.textContent,tokenDir:getComputedStyle(code).direction,
          tokenVisible:r.width>0&&r.height>0&&text.width>0&&text.height>0&&code.getClientRects().length>0&&getComputedStyle(code).visibility!=='hidden'&&getComputedStyle(code).display!=='none',tokenFits:text.left>=r.left-.5&&text.right<=r.right+.5,violations,heading:heading.textContent};
      })()`);
      assert.equal(measured.lang,language);assert.equal(measured.dir,language==='ar'?'rtl':'ltr');
      assert.ok(measured.documentWidth<=width+1);assert.equal(measured.imageLoaded,true);
      assert.equal(measured.token,'0000000000');assert.equal(measured.tokenDir,'ltr');assert.equal(measured.tokenFits,true);assert.equal(measured.tokenVisible,true);
      assert.deepEqual(measured.violations,[]);
      const codeWithImage=await evaluate(call,'('+syntheticCodeVisibility.toString()+')()');
      assert.equal(codeWithImage.visible,true);assert.equal(codeWithImage.fits,true);
      const screenshot='dlkt-auth-email-'+language+'-'+width+'.png';
      const data=(await call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false})).data;
      assert.ok(typeof data==='string'&&data.length>=1000);
      writeFileSync(join(outputDir,screenshot),Buffer.from(data,'base64'),{mode:0o600});
      if(width===320)await emitVisualPreview(call,'auth-email-'+language,width);
      const withoutImage=await evaluate(call,`(()=>{
        document.querySelector('img').style.display='none';
        const code=[...document.querySelectorAll('p')].find(node=>node.textContent==='0000000000');
        if(!code)throw Error('AUTH_EMAIL_CODE_MISSING_WITHOUT_IMAGE');
        const r=code.getBoundingClientRect(),range=document.createRange();range.selectNodeContents(code);const text=range.getBoundingClientRect(),style=getComputedStyle(code);
        return {text:document.body.textContent,heading:document.querySelector('h1').getBoundingClientRect().height>0,
          tokenVisible:r.width>0&&r.height>0&&text.width>0&&text.height>0&&code.getClientRects().length>0&&style.visibility!=='hidden'&&style.display!=='none',
          tokenFits:text.left>=r.left-.5&&text.right<=r.right+.5,
          width:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)};
      })()`);
      assert.ok(withoutImage.text.includes('0000000000'));assert.ok(withoutImage.heading);assert.ok(withoutImage.tokenVisible);assert.ok(withoutImage.tokenFits);assert.ok(withoutImage.width<=width+1);
      const codeWithoutImage=await evaluate(call,'('+syntheticCodeVisibility.toString()+')()');
      assert.equal(codeWithoutImage.visible,true);assert.equal(codeWithoutImage.fits,true);
      observations.push({...measured,screenshot,codeWithImage,codeWithoutImage,imagesHiddenCodeVisible:true});
    }
  }
  return {status:'SYNTHETIC_AUTH_EMAIL_PREVIEW_PASS',observations,
    limitations:['Chromium HTML preview, not an inbox or email-client delivery test. The synthetic code contains zeros only.',
      'The fixture replaces only the absolute Kate image URL with the identical built PNG on loopback; the hosted template retains the absolute production URL.',
      'The generated Go template still requires hosted settings readback. No real sign-in code or email is sent.']};
}
