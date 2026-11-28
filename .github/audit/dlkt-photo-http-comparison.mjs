/** Audit-only instrumentation of the exact existing offline browser QA.
 * The application, fixtures, assertions and response behavior remain unchanged.
 * Counts reflect the controlled run only, not production volume/cost or latency.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const [role,repo,sha,tree]=process.argv.slice(2);
assert.ok(['baseline','candidate'].includes(role));
assert.ok(/^[a-f0-9]{40}$/u.test(sha)&&/^[a-f0-9]{40}$/u.test(tree));
const cwd=resolve(repo),src=join(cwd,'scripts','qa-browser.mjs'),copy=join(cwd,'scripts','.qa-photo-request-count.mjs');
const git=args=>{const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:15000});assert.equal(r.status,0);return r.stdout.trim();};
assert.equal(git(['rev-parse','HEAD']),sha);
assert.equal(git(['rev-parse','HEAD^{tree}']),tree);
assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
const st=lstatSync(src);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=262144);
const original=readFileSync(src,'utf8');
const digest=createHash('sha256').update(original,'utf8').digest('hex');
function exactReplace(s,anchor,after){
 assert.equal(s.split(anchor).length,2,'exact instrumentation anchor');
 return s.replace(anchor,after);
}
let patched=exactReplace(original,'const localPhotoPixels=localPhotoRaster();',
 'const localPhotoPixels=localPhotoRaster();\nconst auditPhotoCounts={total:0,image:0,other:0,image200:0,image404:0,other200:0,other404:0,globalImage:0,localImage:0};\nconst auditImageIdentities=new Set();');
patched=exactReplace(patched,'   const photo=fixture.photo(url);',
 "   const photo=fixture.photo(url);\n   auditPhotoCounts.total++;\n   if(req.method==='GET'&&req.headers['sec-fetch-dest']==='image'){\n    auditPhotoCounts.image++;auditPhotoCounts[photo?'image200':'image404']++;\n    auditPhotoCounts[url.searchParams.has('city')?'localImage':'globalImage']++;\n    auditImageIdentities.add(url.searchParams.get('id')??'');\n   }else{auditPhotoCounts.other++;auditPhotoCounts[photo?'other200':'other404']++;}");
patched=exactReplace(patched,"  console.log('DLKT_UI_BROWSER_QA '+JSON.stringify(result));",
 "  console.log('DLKT_UI_BROWSER_QA '+JSON.stringify(result));\n  assert.equal(auditPhotoCounts.image,auditPhotoCounts.globalImage+auditPhotoCounts.localImage);\n  assert.equal(auditPhotoCounts.image,auditPhotoCounts.image200+auditPhotoCounts.image404);\n  assert.equal(auditPhotoCounts.other,auditPhotoCounts.other200+auditPhotoCounts.other404);\n  assert.equal(auditPhotoCounts.total,auditPhotoCounts.image+auditPhotoCounts.other);\n  assert.ok(auditPhotoCounts.image>0&&auditPhotoCounts.image200>0,'real image requests and successful local fixture image observed');\n  console.log('DLKT_PHOTO_LOOPBACK '+JSON.stringify({status:'CONTROLLED_BROWSER_PASS',scope:'existing loopback reader QA only',role:process.env.DLKT_PHOTO_AUDIT_ROLE,commit:process.env.DLKT_PHOTO_AUDIT_SHA,tree:process.env.DLKT_PHOTO_AUDIT_TREE,qaScriptSha256:process.env.DLKT_PHOTO_AUDIT_SCRIPT,fixture:result.fixture,counts:auditPhotoCounts,distinctImageIdentities:auditImageIdentities.size,productionMeasurement:false}));");
try{
 writeFileSync(copy,patched,{flag:'wx',mode:0o600});
 const result=spawnSync(process.execPath,[copy],{
  cwd,env:{...process.env,DLKT_PHOTO_AUDIT_ROLE:role,DLKT_PHOTO_AUDIT_SHA:sha,DLKT_PHOTO_AUDIT_TREE:tree,DLKT_PHOTO_AUDIT_SCRIPT:digest},
  stdio:'inherit',timeout:540000
 });
 assert.equal(result.status,0,'existing browser QA and aggregate instrumentation passed');
}finally{
 // Only remove the exact audit copy created by this invocation.
 try{if(readFileSync(copy,'utf8')===patched)rmSync(copy);}catch{}
}
assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
console.log('DLKT_PHOTO_AUDIT_TRACKED_CHECKOUT_UNCHANGED');
