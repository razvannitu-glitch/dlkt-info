import {readFileSync,writeFileSync} from 'node:fs';
// A synchronous classic script applies an explicit appearance choice before reader CSS paints.
// NodeNext emits only an empty module marker for this self-contained controller.
const theme=readFileSync('.build/src/theme/browser.js','utf8')
 .replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replace(/^export \{\};\r?\n?/gmu,'');
if(/^\s*(?:import|export)\b/mu.test(theme))throw Error('READER_THEME_CLASSIC_SCRIPT_REQUIRED');
writeFileSync('public/reader-theme.js',theme);
/** Ship the exact compiled strict-TypeScript controller without source map disclosure. */
for(const [name,target] of [['editorial-presentation','editorial-presentation'],['story-grouping','story-grouping'],['follow-stories','follow-stories'],['category-follow','category-follow'],['follow-browser','follow-browser'],['editorial-subject-semantics','editorial-subject-semantics'],['live-edition','live-edition'],['editorial-relevance','editorial-relevance'],['news-sources','news-sources'],['editorial-categories','editorial-categories'],['editorial-ranking','editorial-ranking'],['source-relevance','source-relevance'],['editorial-topics','editorial-topics'],['context','context'],['contextual','contextual'],['contextual-today','contextual-today'],['home-local','home-local'],['home-edition','home-edition'],['loading','loading'],['card-guide','card-guide'],['source-links','source-links'],['credits','credits'],['topics','topics'],['browser','iceo'],['reader','reader'],['insight-browser','insight-browser'],['insight-contracts','insight-contracts'],['device-memory','device-memory'],['comparison','comparison'],['return-brief','return-brief'],['saved-updates','saved-updates'],['card-validation','card-validation']]){
 const compiled=readFileSync(`.build/src/iceo/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 writeFileSync(`public/${target}.js`,compiled);
}

for(const [source,target] of [['account/contracts','account-contracts'],['account/browser','account-browser'],['edition/browser','edition-browser'],['edition/artifact-contracts','edition-artifact'],['edition/render','edition-render']]){
 let compiled=readFileSync(`.build/src/${source}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 compiled=compiled.replaceAll('../iceo/','./').replaceAll("'./artifact-contracts.js'","'./edition-artifact.js'").replaceAll("'./render.js'","'./edition-render.js'");
 if(source==='account/browser')compiled=compiled.replaceAll("'./contracts.js'","'./account-contracts.js'");
 writeFileSync(`public/${target}.js`,compiled);
}
const main=readFileSync('public/iceo.js','utf8').replaceAll("'../edition/browser.js'","'./edition-browser.js'").replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll("'../local/card-node.js'","'./local-card-node.js'").replaceAll("'../local/presentation.js'","'./local-presentation.js'").replaceAll("'../explore/browser.js'","'./explore-browser.js'");writeFileSync('public/iceo.js',main);
for(const name of ['state','selection','geography','browser']){
 const compiled=readFileSync(`.build/src/explore/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'')
  .replaceAll('../iceo/','./').replaceAll("'../local/contracts.js'","'./local-contracts.js'")
  .replaceAll("'./state.js'","'./explore-state.js'").replaceAll("'./selection.js'","'./explore-selection.js'").replaceAll("'./geography.js'","'./explore-geography.js'");
 writeFileSync(`public/explore-${name}.js`,compiled);
}
const homeLocal=readFileSync('public/home-local.js','utf8').replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll("'../local/news-policy.js'","'./local-news-policy.js'");writeFileSync('public/home-local.js',homeLocal);

for(const name of ['browser','contracts','memory','presentation','card-node','event-calendar','places','discovery','reference-places','news-policy','startup']){
 const compiled=readFileSync(`.build/src/local/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./contracts.js'","'./local-contracts.js'").replaceAll("'./news-policy.js'","'./local-news-policy.js'").replaceAll("'./startup.js'","'./local-startup.js'").replaceAll("'./memory.js'","'./local-memory.js'").replaceAll("'./presentation.js'","'./local-presentation.js'").replaceAll("'./places.js'","'./local-places.js'").replaceAll("'./reference-places.js'","'./local-reference-places.js'").replaceAll("'./discovery.js'","'./local-discovery.js'").replaceAll("'./card-node.js'","'./local-card-node.js'").replaceAll("'./event-calendar.js'","'./local-event-calendar.js'").replaceAll('../iceo/','./').replaceAll("'../glance/weather-motion.js'","'./glance-weather-motion.js'").replaceAll("'../media/browser.js'","'./card-photo-browser.js'");
 writeFileSync(`public/local-${name}.js`,compiled);
}

for(const name of ['browser','state','header']){
 const compiled=readFileSync(`.build/src/entry/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll("'../local/presentation.js'","'./local-presentation.js'").replaceAll("'./state.js'","'./entry-state.js'").replaceAll("'./header.js'","'./entry-header.js'");
 writeFileSync(`public/entry-${name}.js`,compiled);
}

for(const name of ['contracts','selection','reading','interests','browser']){
 let compiled=readFileSync(`.build/src/daily/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 compiled=compiled.replaceAll('../iceo/','./').replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll("'../local/presentation.js'","'./local-presentation.js'").replaceAll("'../local/memory.js'","'./local-memory.js'").replaceAll("'../local/news-policy.js'","'./local-news-policy.js'").replaceAll("'./contracts.js'","'./daily-contracts.js'").replaceAll("'./selection.js'","'./daily-selection.js'").replaceAll("'./reading.js'","'./daily-reading.js'").replaceAll("'./interests.js'","'./daily-interests.js'");
 writeFileSync(`public/daily-${name}.js`,compiled);
}
for(const name of ['device-memory','saved-updates']){
 const compiled=readFileSync(`public/${name}.js`,'utf8').replaceAll("'../daily/contracts.js'","'./daily-contracts.js'");writeFileSync(`public/${name}.js`,compiled);
}

for(const [source,target] of [['link','shared-card-link'],['actions','shared-card-actions'],['page-browser','shared-card-browser']]){
 const compiled=readFileSync(`.build/src/share/${source}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll('../iceo/','./').replaceAll("'./link.js'","'./shared-card-link.js'");
 writeFileSync(`public/${target}.js`,compiled);
}
for(const name of ['iceo','daily-browser','entry-browser','follow-browser']){
 const js=readFileSync(`public/${name}.js`,'utf8').replaceAll("'../share/actions.js'","'./shared-card-actions.js'").replaceAll("'../share/link.js'","'./shared-card-link.js'");
 writeFileSync(`public/${name}.js`,js);
}

for(const name of ['contracts','presentation','preferences','ticker','weather-motion','browser']){
 let compiled=readFileSync(`.build/src/glance/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'');
 compiled=compiled.replaceAll("'./contracts.js'","'./glance-contracts.js'").replaceAll("'./presentation.js'","'./glance-presentation.js'").replaceAll("'./preferences.js'","'./glance-preferences.js'").replaceAll("'./ticker.js'","'./glance-ticker.js'").replaceAll("'./weather-motion.js'","'./glance-weather-motion.js'").replaceAll("'../local/contracts.js'","'./local-contracts.js'").replaceAll('../iceo/','./');
 writeFileSync(`public/glance-${name}.js`,compiled);
}

for(const name of ['setup','browser']){
 const compiled=readFileSync(`.build/src/organizations/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./setup.js'","'./organization-setup.js'");
 writeFileSync(`public/organization-${name}.js`,compiled);
}
for(const name of ['entry-browser','iceo']){
 const compiled=readFileSync(`public/${name}.js`,'utf8').replaceAll("'../organizations/setup.js'","'./organization-setup.js'");
 writeFileSync(`public/${name}.js`,compiled);
}
await import('./generate-legal-pages.mjs');

for(const [name,target]of [['catalog','card-photo-catalog'],['reviewed-photos','reviewed-photos'],['context-photos','context-photos'],['browser','card-photo-browser']]){
 const js=readFileSync(`.build/src/media/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll('../iceo/','./').replaceAll("'./catalog.js'","'./card-photo-catalog.js'");
 writeFileSync(`public/${target}.js`,js);
}
for(const name of ['iceo','daily-browser','shared-card-browser']){
 const js=readFileSync(`public/${name}.js`,'utf8').replaceAll("'../media/browser.js'","'./card-photo-browser.js'");writeFileSync(`public/${name}.js`,js);
}

// Only browser-safe Wallet contracts and controllers enter the public bundle.
for(const [source,target] of [['contracts','wallet-contracts'],['providers','wallet-providers'],['events','wallet-events'],['browser','wallet-browser'],['home-browser','wallet-home-browser'],['personal-inbox','wallet-personal-inbox']]){
 const compiled=readFileSync(`.build/src/wallet/${source}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./contracts.js'","'./wallet-contracts.js'").replaceAll("'./providers.js'","'./wallet-providers.js'").replaceAll("'../daily/contracts.js'","'./daily-contracts.js'").replaceAll("'../iceo/topics.js'","'./topics.js'").replaceAll("'../data/guards.js'","'./data-guards.js'").replaceAll("'../connections/browser.js'","'./connections-browser.js'").replaceAll("'./personal-inbox.js'","'./wallet-personal-inbox.js'").replaceAll("'./events.js'","'./wallet-events.js'");
 writeFileSync(`public/${target}.js`,compiled);
}

for(const [source,target] of [['browser','connections-browser'],['types','connections-types']]){
 const compiled=readFileSync(`.build/src/connections/${source}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll("'./types.js'","'./connections-types.js'").replaceAll("'../wallet/providers.js'","'./wallet-providers.js'").replaceAll("'../wallet/events.js'","'./wallet-events.js'").replaceAll("'../data/guards.js'","'./data-guards.js'");
 writeFileSync(`public/${target}.js`,compiled);
}

writeFileSync('public/data-guards.js',readFileSync('.build/src/data/guards.js','utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,''));

for(const name of ['catalog','locale','browser','reading-messages']){
 const compiled=readFileSync(`.build/src/i18n/${name}.js`,'utf8').replace(/^\/\/# sourceMappingURL=.*\r?\n?/gmu,'').replaceAll('../iceo/','./').replaceAll("'./reading-messages.js'","'./i18n-reading-messages.js'").replaceAll("'./catalog.js'","'./i18n-catalog.js'").replaceAll("'./locale.js'","'./i18n-locale.js'");
 writeFileSync(`public/i18n-${name}.js`,compiled);
}
for(const name of ['iceo','explore-browser','follow-browser','daily-browser']){
 const js=readFileSync(`public/${name}.js`,'utf8').replaceAll("'../i18n/browser.js'","'./i18n-browser.js'").replaceAll("'../i18n/locale.js'","'./i18n-locale.js'");writeFileSync(`public/${name}.js`,js);
}
