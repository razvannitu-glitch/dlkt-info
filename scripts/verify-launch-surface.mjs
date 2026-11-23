import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DomUtils,parseDocument} from 'htmlparser2';

const OFFICIAL='https://www.dlkt.ee';
const SELECTED_ROUTES=['/','/about','/sources','/organizations','/contact','/company','/accessibility','/terms','/privacy','/cookies','/disclaimer','/wallet','/account'];
const NON_AUTOMATABLE=Object.freeze([
 'Measured mobile/desktop layout at 320, 390, 768 and 1440 px',
 'Keyboard, touch and assistive-technology journeys in a real browser',
 'Verified actual source freshness and accurate event geography',
 'Official-domain alias and exact deployment SHA read-back',
 'Database runtime attestation, backup/restore rehearsal and performance under load',
 'GDPR, copyright, editorial corrections and consumer legal review',
 'Real sign-in, cross-device persistence and optional paid checkout end-to-end',
]);

const attr=(node,name)=>node.attribs?.[name]??null;
const has=(node,name)=>Object.hasOwn(node.attribs??{},name);
const text=(node)=>DomUtils.textContent(node).replace(/\s+/gu,' ').trim();
const elements=(document,tag)=>DomUtils.getElementsByTagName(tag,document,true);
const isObject=(v)=>typeof v==='object'&&v!==null&&!Array.isArray(v);

export function assessLaunchSurface(input){
 if(!isObject(input)||typeof input.html!=='string'||typeof input.atlasPage!=='string'||
  typeof input.manifestText!=='string'||typeof input.robots!=='string'||
  typeof input.css!=='string'||!isObject(input.receipt)||!isObject(input.config)||
  typeof input.assetAvailable!=='function'||!['prelaunch','public'].includes(input.phase))throw Error('DLKT_LAUNCH_AUDIT_INPUT');
 const failures=[],checks=[];
 const verify=(code,valid)=>{checks.push(Object.freeze({code,pass:Boolean(valid)}));if(!valid)failures.push(code)};
 let manifest;
 try{manifest=JSON.parse(input.manifestText)}catch{manifest=null}
 const document=parseDocument(input.html,{decodeEntities:true});
 const html=elements(document,'html')[0],main=elements(document,'main'),headers=elements(document,'header');
 const navs=elements(document,'nav'),buttons=elements(document,'button'),links=elements(document,'link');
 const anchors=elements(document,'a'),images=elements(document,'img'),scripts=elements(document,'script');
 const ids=elements(document,'*').map(node=>attr(node,'id')).filter(Boolean);
 const knownIds=new Set(ids);
 const canonical=links.filter(link=>attr(link,'rel')?.split(/\s+/u).includes('canonical')).map(link=>attr(link,'href'));
 const descriptions=elements(document,'meta').filter(node=>attr(node,'name')==='description').map(node=>attr(node,'content'));
 const viewport=elements(document,'meta').find(node=>attr(node,'name')==='viewport');
 verify('document-identity',attr(html,'lang')==='en'&&/DLKT INFO/u.test(input.html)&&/Daily Life\. Key Things\./u.test(input.html));
 verify('search-canonical',canonical.length===1&&canonical[0]===OFFICIAL+'/'&&descriptions.length===1&&typeof descriptions[0]==='string'&&descriptions[0].length>=60);
 verify('responsive-structure',main.length===1&&headers.length>0&&Boolean(viewport)&&/width=device-width/u.test(attr(viewport,'content')??'')
   &&/@media\s*\(\s*max-width\s*:\s*(?:600|700)px\s*\)/u.test(input.css)&&/@media\s*\(\s*max-width\s*:\s*360px\s*\)/u.test(input.css));
 verify('keyboard-and-motion',input.css.includes(':focus-visible')&&input.css.includes('prefers-reduced-motion')&&
   anchors.some(a=>(attr(a,'class')??'').split(/\s+/u).includes('skip')&&knownIds.has((attr(a,'href')??'').slice(1)))&&
   navs.some(n=>attr(n,'aria-label')==='Main'));
 verify('semantic-identity',knownIds.has('entry-title')&&knownIds.has('discovery-cards')&&knownIds.has('briefing')&&
   knownIds.has('header-navigation')&&knownIds.has('place-dialog')&&knownIds.has('card-template')&&
   elements(document,'template').length>=1);
 verify('unique-element-ids',ids.length===knownIds.size);
 verify('accessible-static-controls',
  buttons.every(b=>has(b,'hidden')||Boolean(attr(b,'aria-label')||attr(b,'aria-labelledby')||text(b)))&&
  images.every(i=>has(i,'alt')));
 const internalRefs=[];
 for(const el of [...scripts,...links,...images]){
  const value=attr(el,el.name==='script'||el.name==='img'?'src':'href');
  if(!value||!value.startsWith('/'))continue;
  if(el.name==='link'&&!['stylesheet','icon','shortcut icon','apple-touch-icon','manifest'].includes(attr(el,'rel')))continue;
  internalRefs.push(value);
 }
 verify('same-origin-public-assets',scripts.every(s=>{const x=attr(s,'src');return x===null||x.startsWith('/')})&&
  internalRefs.length>=15&&internalRefs.every(x=>input.assetAvailable(x.split(/[?#]/u)[0])));
 const brokenTargets=anchors.filter(a=>(attr(a,'href')??'').startsWith('#')&&!knownIds.has(attr(a,'href').slice(1)));
 verify('working-hash-navigation',brokenTargets.length===0);
 const routes=new Set((Array.isArray(input.config.rewrites)?input.config.rewrites:[]).map(x=>x.source));
 verify('core-route-coverage',SELECTED_ROUTES.every(route=>route==='/'||routes.has(route))&&
  anchors.filter(a=>attr(a,'href')?.startsWith('/')&&!attr(a,'href')?.startsWith('//')).every(a=>{
   const href=attr(a,'href');const u=new URL(href,OFFICIAL);
   return SELECTED_ROUTES.includes(u.pathname)||u.pathname.startsWith('/card/');
  }));
 verify('attributed-card-reading',input.html.includes('class="source-link"')&&
  input.html.includes('class="card-attribution"')&&input.html.includes('class="card-boundary"')&&
  input.html.includes('class="save-card"')&&input.html.includes('class="share-source"')&&
  input.html.includes('id="discovery-refresh"'));
 verify('legal-and-source-directory',SELECTED_ROUTES.filter(x=>['/terms','/privacy','/cookies','/disclaimer','/sources','/accessibility'].includes(x))
  .every(p=>anchors.some(a=>attr(a,'href')===p))&&
  input.atlasPage.includes('id="iceo-source-atlas"'));
 const headerValues=(Array.isArray(input.config.headers)?input.config.headers:[]).flatMap(x=>x.headers??[]);
 const headerValue=name=>headerValues.find(x=>typeof x.key==='string'&&x.key.toLowerCase()===name.toLowerCase())?.value??null;
 verify('security-response-headers',headerValue('Content-Security-Policy')?.includes("default-src 'none'")&&
  headerValue('X-Content-Type-Options')==='nosniff'&&headerValue('Referrer-Policy')==='no-referrer');
 const noindex=/\bnoindex\b/iu.test(headerValue('X-Robots-Tag')??'');
 const nofollow=/\bnofollow\b/iu.test(headerValue('X-Robots-Tag')??'');
 const disallow=/User-agent:\s*\*[\s\S]*?Disallow:\s*\/(?:\s|$)/iu.test(input.robots);
 const allowed=input.phase==='prelaunch'?noindex&&nofollow&&disallow:!noindex&&!disallow;
 verify('publication-phase-seo',allowed);
 const proof=input.receipt;
 verify('exact-build-manifest',isObject(manifest)&&manifest.product==='dlkt-info'&&
  proof.format==='dlkt-info-public-build-1'&&proof.product===manifest.product&&
  proof.version===manifest.version&&proof.revision===manifest.revision&&
  proof.manifestSha256===createHash('sha256').update(input.manifestText).digest('hex')&&
  (proof.gitCommitSha===null||typeof proof.gitCommitSha==='string'&&/^[a-f0-9]{40}$/u.test(proof.gitCommitSha))&&
  proof.runtimeVerification==='not-attested-by-receipt'&&
  proof.indexability===(input.phase==='prelaunch'?'prelaunch-noindex':'public-indexable'));
 const result={phase:input.phase,code:failures.length===0?'STATIC_PREFLIGHT_PASS':'STATIC_PREFLIGHT_FAIL',
  passed:checks.length-failures.length,failed:failures.length,checks:Object.freeze(checks),
  failures:Object.freeze(failures),unverified:NON_AUTOMATABLE};
 return Object.freeze(result);
}

export function checkBuiltLaunch(root,phase='prelaunch'){
 const source=join(root,'source'),surface=join(root,'.dlkt-local-build','public-launch');
 if(!existsSync(surface))throw Error('DLKT_LAUNCH_BUILD_REQUIRED');
 const pkg=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
 const html=readFileSync(join(surface,'index.html'),'utf8');
 if(html!==readFileSync(join(source,'public','iceo.html'),'utf8'))throw Error('DLKT_LAUNCH_WRONG_HOMEPAGE');
 const manifestText=readFileSync(join(source,'RELEASE-'+pkg.version+'.json'),'utf8');
 const receipt=JSON.parse(readFileSync(join(surface,'release.json'),'utf8'));
 const css=['iceo.css','header.css','reader-theme.css','knowledge.css','editorial-cards.css']
  .map(name=>readFileSync(join(surface,name),'utf8')).join('\n');
 return assessLaunchSurface({html,css,manifestText,receipt,phase,
  robots:readFileSync(join(surface,'robots.txt'),'utf8'),
  atlasPage:readFileSync(join(surface,'sources.html'),'utf8'),
  config:JSON.parse(readFileSync(join(root,'vercel.json'),'utf8')),
  assetAvailable:url=>url.startsWith('/')&&!url.includes('..')&&existsSync(join(surface,url.slice(1))),
 });
}
const invoked=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
 const phase=process.argv[2]==='--public'?'public':process.argv.length<=2?'prelaunch':null;
 if(!phase)throw Error('DLKT_LAUNCH_PHASE_INVALID');
 const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
 const report=checkBuiltLaunch(root,phase);
 console.log('DLKT_LAUNCH_STATIC_AUDIT '+JSON.stringify(report));
 if(report.failed>0)process.exitCode=1;
}
