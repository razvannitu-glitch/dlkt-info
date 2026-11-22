import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDocument} from 'htmlparser2';
import {LEGAL_DOCUMENTS,COMPANY,footerHtml,renderLegalDocument} from '../.build/src/legal/documents.js';
import {renderSharedError} from '../.build/src/share/render.js';
import {NEWS_CATEGORIES} from '../.build/src/iceo/news-taxonomy.js';
import {NEWS_PUBLISHERS} from '../.build/src/iceo/news-sources.js';
function elements(html){const nodes=[];function walk(n){if(n.type==='tag')nodes.push(n);for(const c of n.children??[])walk(c);}walk(parseDocument(html));return nodes;}
test('all legal documents ship the exact shared renderer with a unique reading structure',()=>{
 assert.equal(LEGAL_DOCUMENTS.length,9);assert.equal(new Set(LEGAL_DOCUMENTS.map(d=>d.slug)).size,9);
 for(const doc of LEGAL_DOCUMENTS){const html=readFileSync(`public/${doc.slug}.html`,'utf8');assert.equal(html,renderLegalDocument(doc));const nodes=elements(html);assert.equal(nodes.filter(n=>n.name==='h1').length,1,doc.slug);const ids=nodes.map(n=>n.attribs.id).filter(Boolean);assert.equal(new Set(ids).size,ids.length,doc.slug);assert.ok(html.includes(footerHtml()));assert.ok(html.includes('Updated '+'22 November 2026'),doc.slug);}
});
test('footer and document links resolve to shipped pages and actual section anchors',()=>{
 const pages=new Map(LEGAL_DOCUMENTS.map(d=>['/'+d.slug,renderLegalDocument(d)]));pages.set('/',readFileSync('public/iceo.html','utf8'));pages.set('/organizations',readFileSync('public/organizations.html','utf8'));pages.set('/wallet',readFileSync('public/wallet.html','utf8'));pages.set('/account',readFileSync('public/account.html','utf8'));
 const routes=JSON.parse(readFileSync('vercel.public.json','utf8')).rewrites;for(const name of ['organizations','wallet','account'])assert.equal(routes.find(r=>r.source==='/'+name)?.destination,'/'+name+'.html');
 for(const [path,html] of pages){for(const a of elements(html).filter(n=>n.name==='a')){const href=a.attribs.href??'';if(!href.startsWith('/')&&!href.startsWith('#'))continue;const url=new URL(href,'https://www.dlkt.ee'+path);assert.ok(pages.has(url.pathname),`${path}: ${href}`);if(url.hash)assert.ok(elements(pages.get(url.pathname)).some(n=>n.attribs.id===decodeURIComponent(url.hash.slice(1))),`${path}: ${href}`);}}
});
test('legal clean URLs are explicitly routed and shared across homepage, account and card errors',()=>{
 const config=JSON.parse(readFileSync('vercel.public.json','utf8'));for(const d of LEGAL_DOCUMENTS)assert.equal(config.rewrites.find(r=>r.source==='/'+d.slug)?.destination,'/'+d.slug+'.html');
 for(const path of ['public/iceo.html','public/account.html','public/organizations.html','public/wallet.html']){const html=readFileSync(path,'utf8');assert.ok(html.includes(footerHtml()),path);assert.equal(elements(html).filter(n=>n.name==='footer'&&n.attribs.class==='site-footer').length,1);assert.ok(elements(html).some(n=>n.attribs.id==='top'));}
 const source=readFileSync('src/share/render.ts','utf8');assert.match(source,/footerHtml\(\)/u);assert.ok(renderSharedError('unavailable').includes(footerHtml()));
});
test('published company identifiers omit unrelated private registry fields and invented inboxes',()=>{
 assert.equal(COMPANY.registry,'17335744');assert.equal(COMPANY.email,'office@dlkt.ee');for(const d of LEGAL_DOCUMENTS){const html=renderLegalDocument(d);assert.doesNotMatch(html,/(?<!\d)[3-6]\d{10}(?!\d)|privacy@dlkt\.ee|legal@dlkt\.ee|GDPR certified|WCAG certified|fully GDPR compliant/iu);}
});

test('account notices separate conditional sign-in, private storage and separately authorized connections',()=>{
 const document=slug=>LEGAL_DOCUMENTS.find(d=>d.slug===slug);
 const section=(slug,id)=>document(slug).sections.find(s=>s.id===id).paragraphs.join(' ');
 for(const slug of ['about','privacy','cookies']){
  const html=renderLegalDocument(document(slug));
  assert.match(html,/When account sign-in is available/u,slug);
  assert.doesNotMatch(html,/no activated account sign-in|Accounts, cross-device memory and timed delivery are not activated yet|screen does not collect a profile/u,slug);
 }
 const account=section('privacy','account'),wallet=section('privacy','wallet'),providers=section('privacy','recipients'),retention=section('privacy','retention');
 assert.match(account,/Supabase Auth.*linked base profile/u);
 assert.match(account,/Requesting a code also sends your browser timezone.*UTC as a fallback.*initial language setting, English/u);
 assert.match(account,/Import from this browser.*Restore in this browser/u);
 assert.match(account,/not automatic background sync or a merge/u);
 assert.match(account,/Delete account reader copy.*without deleting your sign-in account, Wallet preferences or existing browser copy/u);
 assert.match(wallet,/Save profile.*optional Wallet preferences/u);
 assert.match(wallet,/Delete Wallet preferences.*does not delete the sign-in account/u);
 assert.match(wallet,/Connection availability is shown in Wallet/u);
 assert.match(wallet,/Signing in or saving a profile does not grant access to an external account/u);
 assert.match(wallet,/separate OAuth authorization/u);
 assert.match(providers,/Resend delivers transactional authentication emails/u);
 assert.match(providers,/recipient address, message content and delivery information/u);
 assert.match(retention,/Signing out or clearing browser data does not delete server-side account records/u);
 const cookies=section('cookies','session-cookies');
 assert.match(cookies,/__Host-dlkt_info_at.*up to 1 hour.*60 and 3600 seconds/u);
 assert.match(cookies,/__Host-dlkt_info_rt.*30 days/u);
 assert.match(cookies,/Secure, HttpOnly and SameSite=Lax.*Path=\/ and no Domain attribute/u);
 assert.match(cookies,/not a guarantee that the server will accept the session/u);
 assert.match(cookies,/does not sign out every other device or delete saved account data/u);
 assert.match(section('about','wallet'),/Info Wallet shows the current availability of account sign-in, private profile saving and optional email or social connections/u);
 assert.match(section('about','wallet'),/An available connection requires your separate authorization/u);
 assert.match(section('about','control'),/scheduled briefing emails and background alerts are not activated/u);
 const connections=section('privacy','connections');
 assert.match(connections,/encrypted server-side before storage in Supabase/u);
 assert.match(connections,/not returned to page JavaScript or saved in browser storage/u);
 assert.match(connections,/Check updates performs a bounded read/u);
 assert.match(connections,/does not request message bodies or attachments/u);
 assert.match(connections,/homepage can also recheck about every sixty seconds while visible and focused/u);
 assert.match(connections,/at most five recent metadata updates/u);
 assert.match(connections,/does not collect personal activity while the page is closed/u);
 assert.match(connections,/Instagram’s comment permission also permits moderation.*only to read comments/u);
 assert.match(connections,/does not save the returned email metadata or comment content to the account database or browser storage/u);
 assert.match(connections,/last-check timestamp is stored separately/u);
 assert.match(connections,/Disconnect removes the saved connection record and its encrypted credentials/u);
 assert.match(connections,/where this cannot be confirmed.*remove DLKT access in the provider/u);
 assert.match(connections,/does not delete the original emails or comments.*provider logs and backups/u);
 const authorizationCookies=section('cookies','connection-cookies');
 for(const suffix of ['gmail','outlook','instagram','facebook_pages']) assert.ok(authorizationCookies.includes('__Host-dlkt_connection_'+suffix));
 assert.match(authorizationCookies,/Max-Age=600.*10 minutes.*Secure, HttpOnly and SameSite=Lax.*Path=\/ and no Domain attribute/u);
 assert.match(authorizationCookies,/does not contain the provider access token/u);
 assert.match(authorizationCookies,/does not delete an existing server-side connection/u);
 for(const slug of ['about','privacy','cookies']) assert.doesNotMatch(renderLegalDocument(document(slug)),/External email and social connections are not activated|Each future connection|Future external account connections/u);
});

test('Sources describes the complete language-filtered stream and exact-article photo previews',()=>{
 const doc=LEGAL_DOCUMENTS.find(value=>value.slug==='sources');assert.ok(doc);
 const section=id=>doc.sections.find(value=>value.id===id).paragraphs.join(' ');
 const top=section('daily-top'),local=section('local-reporting'),photos=section('photographs'),publishers=section('news-publishers');
 assert.equal(doc.updated,'22 November 2026');assert.equal(NEWS_CATEGORIES.length,17);
 for(const category of NEWS_CATEGORIES)assert.ok(top.includes(category.iptcLabel),category.id);
 assert.match(top,/editorial inference, not an IPTC certification/u);
 assert.match(top,/Each active category contributes one article before the next round starts/u);
 assert.match(top,/When another category is available, the first article of a new round differs in category/u);
 assert.match(top,/when only one remains, all its remaining articles stay available/u);
 assert.match(top,/category order stays stable for the displayed edition while more cards load/u);
 assert.match(top,/category filter shows a projection of that same order/u);
 assert.match(top,/selected country gives available national-edition articles priority within each category/u);
 assert.match(top,/English remains an explicit option/u);assert.match(top,/does not translate other-language articles/u);
 assert.match(top,/every eligible, unique article/u);assert.match(top,/next group of up to twenty automatically/u);assert.match(top,/button remains available for manual loading/u);
 assert.match(top,/Other topics/u);assert.match(top,/original observation timestamps and content hashes/u);
 assert.match(local,/distinct original articles remain available even when their headlines match/iu);
 assert.match(photos,/exact article/u);assert.match(photos,/original publisher metadata/u);
 assert.match(photos,/does not substitute a category image, stock photograph, contextual picture or unrelated portrait/u);
 assert.match(photos,/does not invent an author or infer a photo licence/u);assert.match(photos,/title and source actions remain visible/u);
 assert.ok(publishers.includes(NEWS_PUBLISHERS.length+' publisher families'));
 assert.match(publishers,/does not mean every publisher was available in the latest check/u);
 const visible=doc.sections.flatMap(value=>value.paragraphs).join(' ');
 assert.doesNotMatch(visible,/up to six eligible primary reports|opening Global selection|After the opening selection|monitors twenty editorial categories|standard target of thirty|maximum of forty|At most eight press reports|Other cards use a separately reviewed contextual photograph|does not republish article bodies or photographs/u);
});

test('the compact footer preserves accessible operator and legal information without a second platform',()=>{
 const footer=footerHtml();assert.doesNotMatch(footer,/world\.dlkt\.ee|DLKT World|Registry|17335744|Estonia/iu);
 assert.match(footer,/© 2026 DLKT Group OÜ/u);
 for(const route of ['company','terms','privacy','cookies','disclaimer','sources'])assert.ok(footer.includes('href="/'+route+'"'));
 const doc=slug=>renderLegalDocument(LEGAL_DOCUMENTS.find(value=>value.slug===slug));
 assert.match(doc('company'),/17335744/u);assert.match(doc('company'),/Sepapaja tn 6/u);
 assert.match(doc('terms'),/platform at www\.dlkt\.ee/u);
 for(const value of LEGAL_DOCUMENTS)assert.doesNotMatch(renderLegalDocument(value),/info\.dlkt\.ee|world\.dlkt\.ee|DLKT World/u);
});
test('country, account, subscription and analytics notices describe the enabled release',()=>{
 const section=(slug,id)=>LEGAL_DOCUMENTS.find(d=>d.slug===slug).sections.find(s=>s.id===id).paragraphs.join(' ');
 assert.match(section('sources','country-coverage'),/publisher editions.*not a count of independently verified events/iu);
 assert.match(section('sources','country-coverage'),/missing|shortfall/u);
 assert.match(section('sources','country-coverage'),/One connected national publisher does not constitute complete coverage/u);
 assert.match(section('privacy','wallet'),/My profile and Info Wallet use the same optional private preference record/u);
 assert.match(section('privacy','wallet'),/preserves the fields it does not edit/u);
 assert.match(section('privacy','audience-measurement'),/does not activate a visitor-analytics collector/u);
 assert.match(section('terms','operator'),/does not start a subscription or a trial/u);
 assert.match(section('terms','operator'),/before an explicit purchase/u);
 assert.doesNotMatch(section('accessibility','features'),/starts moving automatically/u);
});
