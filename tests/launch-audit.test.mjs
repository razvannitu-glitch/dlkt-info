import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {assessLaunchSurface} from '../scripts/verify-launch-surface.mjs';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const read=path=>readFileSync(join(root,path),'utf8');
const pkg=JSON.parse(read('source/package.json'));
const manifestText=read('source/RELEASE-'+pkg.version+'.json');
const manifest=JSON.parse(manifestText);
const css=['iceo.css','header.css','reader-theme.css','knowledge.css','editorial-cards.css'].map(n=>read('source/public/'+n)).join('\n');
const receipt={
 format:'dlkt-info-public-build-1',product:'dlkt-info',version:manifest.version,revision:manifest.revision,
 manifestSha256:createHash('sha256').update(manifestText).digest('hex'),gitCommitSha:null,
 indexability:'prelaunch-noindex',runtimeVerification:'not-attested-by-receipt',
};
const fixture=()=>({
 html:read('source/public/iceo.html'),css,manifestText,receipt,config:JSON.parse(read('vercel.json')),
 robots:'User-agent: *\nDisallow: /\n',phase:'prelaunch',
 atlasPage:'<section id="iceo-source-atlas">Research only</section>',
 assetAvailable:path=>path.startsWith('/')&&existsSync(join(root,'source/public',path.slice(1))),
});

test('current official reader source passes static prelaunch navigation and accessibility contracts',()=>{
 const result=assessLaunchSurface(fixture());
 assert.deepEqual(result.failures,[],JSON.stringify(result.failures));
 assert.equal(result.code,'STATIC_PREFLIGHT_PASS');
 assert.ok(result.unverified.some(x=>x.includes('mobile/desktop')));
 assert.ok(result.unverified.some(x=>x.includes('exact deployment')));
});
test('public launch fails closed while robots and X-Robots-Tag block discovery',()=>{
 const candidate=fixture();candidate.phase='public';
 const result=assessLaunchSurface(candidate);
 assert.ok(result.failures.includes('publication-phase-seo'));
 assert.ok(result.failures.includes('exact-build-manifest'));
});
test('tampering with source receipt fails release identity check',()=>{
 const candidate=fixture();candidate.receipt={...candidate.receipt,manifestSha256:'0'.repeat(64)};
 assert.ok(assessLaunchSurface(candidate).failures.includes('exact-build-manifest'));
});
test('missing static asset or accessible anchor fails before release',()=>{
 const candidate=fixture();candidate.assetAvailable=()=>false;
 assert.ok(assessLaunchSurface(candidate).failures.includes('same-origin-public-assets'));
 candidate.assetAvailable=fixture().assetAvailable;
 candidate.html=candidate.html.replace('href="#briefing"','href="#nonexistent-section"');
 assert.ok(assessLaunchSurface(candidate).failures.includes('keyboard-and-motion'));
 assert.ok(assessLaunchSurface(candidate).failures.includes('working-hash-navigation'));
});
test('missing brand assets or responsive safeguards fail prelaunch audit',()=>{
 const candidate=fixture();candidate.css='body{color:black}';
 assert.ok(assessLaunchSurface(candidate).failures.includes('responsive-structure'));
 assert.ok(assessLaunchSurface(candidate).failures.includes('keyboard-and-motion'));
 candidate.css=css;candidate.html=candidate.html.replaceAll('Daily Life. Key Things.','Daily Random Words');
 assert.ok(assessLaunchSurface(candidate).failures.includes('document-identity'));
});
