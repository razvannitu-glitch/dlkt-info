import {REVIEWED_PHOTOS} from '../.build/src/media/reviewed-photos.js';
import {CONTEXT_PHOTOS} from '../.build/src/media/context-photos.js';
import {copyFileSync,mkdirSync,readdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const PROJECT='prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P';
/** Curate the public surface in an isolated deployment directory, never the working repository. */
export function preparePublicRelease(root,authorization){
  if(authorization.projectId!==PROJECT||authorization.build!==true)throw new Error('PUBLIC_BUILD_IDENTITY_REQUIRED');
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  if(pkg.name!=='@dlkt/info-core'||pkg.version!=='0.9.46')throw new Error('PUBLIC_BUILD_SOURCE_MISMATCH');
  const dest=join(root,'public-launch');mkdirSync(dest,{recursive:true});
  for(const file of ['organizations.html','organizations.css','organization-setup.js','organization-browser.js','iceo.html','iceo.css','loading.css','header.css','topics.js','editorial-topics.js','editorial-categories.js','news-sources.js','editorial-ranking.js','editorial-relevance.js','live-edition.js','glance-weather-motion.js','weather-motion.css','personal-inbox.css','wallet-personal-inbox.js','context-photos.js','source-relevance.js','context.js','contextual.js','contextual-today.js','home-local.js','home-edition.js','loading.js','source-links.js','credits.js','card-guide.js','iceo.js','reader.js','insight-browser.js','insight-contracts.js','device-memory.js','comparison.js','return-brief.js','saved-updates.js','card-photo-catalog.js','card-photo-browser.js','reviewed-photos.js','card-validation.js','account.html','account-contracts.js','account-browser.js','wallet.html','wallet.css','connections-browser.js','connections-types.js','wallet-events.js','wallet-contracts.js','data-guards.js','wallet-providers.js','wallet-browser.js','wallet-home-browser.js','edition-browser.js','edition-artifact.js','edition-render.js','local-browser.js','local-news-policy.js','local-startup.js','local-contracts.js','local-memory.js','local-presentation.js','local-card-node.js','local-event-calendar.js','local-places.js','local-reference-places.js','local-discovery.js','entry-browser.js','entry-state.js', 'entry-header.js','daily-browser.js','daily-contracts.js','daily-selection.js','daily-reading.js','daily-interests.js','glance-browser.js','glance-contracts.js','glance-presentation.js','glance-preferences.js','glance-ticker.js','shared-card-link.js','shared-card-actions.js','shared-card-browser.js','favicon.svg','favicon-kate-fb7b2e60.png','favicon.ico','apple-touch-icon.png','kate-head.png','manifest.webmanifest','about.html','terms.html','privacy.html','cookies.html','disclaimer.html','sources.html','accessibility.html','company.html','contact.html'])copyFileSync(join(root,'public',file),join(dest,file==='iceo.html'?'index.html':file));
  mkdirSync(join(dest,'card-media'),{recursive:true});
  for(const photo of [...REVIEWED_PHOTOS,...CONTEXT_PHOTOS])copyFileSync(join(root,'public',photo.path.slice(1)),join(dest,photo.path.slice(1)));
  copyFileSync(join(dest,'index.html'),join(dest,'companion.html'));
  writeFileSync(join(dest,'robots.txt'),['facebookexternalhit','Facebot','Twitterbot'].map(agent=>`User-agent: ${agent}\nAllow: /card/\nAllow: /api/card-image\nDisallow: /\n`).join('\n')+'\nUser-agent: *\nDisallow: /\n');
  for(const file of readdirSync(join(root,'api'))){if(!['iceo.ts','iceo-refresh.ts','insight.ts','edition.ts','account.ts','account-session.ts','local.ts','places.ts','card.ts','glance.ts','card-image.ts','wallet.ts','connections.ts','share-archive.ts'].includes(file))rmSync(join(root,'api',file),{recursive:true,force:true});}
  copyFileSync(join(root,'vercel.public.json'),join(root,'vercel.json'));
  return {version:pkg.version,api:['/api/iceo','/api/iceo-refresh','/api/insight','/api/edition','/api/account','/api/account-session','/api/local','/api/places','/api/card','/api/glance','/api/card-image','/api/wallet','/api/connections','/api/share-archive'],automaticJobs:1,publicFiles:readdirSync(dest).sort()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.env.VERCEL!=='1'||process.env.VERCEL_PROJECT_ID!==PROJECT)throw new Error('PUBLIC_BUILD_CONTEXT_REQUIRED');
  console.log('ICEO_PUBLIC_SURFACE '+JSON.stringify(preparePublicRelease(process.cwd(),{projectId:process.env.VERCEL_PROJECT_ID,build:true})));
}
