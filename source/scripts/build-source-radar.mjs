import {writeFileSync} from 'node:fs';
import {worldSourceAtlas} from '../.build/src/iceo/world-source-atlas.js';

/** Deterministic, read-only public catalog from existing operator-owned definitions. */
const entries=worldSourceAtlas().map(({id,name,origin,vertical,scope,countryCode,status,acquisition,rights})=>
 ({id,name,origin,vertical,scope,countryCode,status,acquisition,rights}));
if(entries.length<100||entries.length>1000)throw Error('SOURCE_RADAR_CATALOG_SIZE');
const ids=new Set(entries.map(e=>e.id));
if(ids.size!==entries.length)throw Error('SOURCE_RADAR_DUPLICATE_ID');
const json=JSON.stringify({version:'dlkt-source-radar-1',entries},null,2)+'\n';
writeFileSync(new URL('../public/source-radar-data.json',import.meta.url),json);
console.log('DLKT_SOURCE_RADAR_GENERATED',entries.length);
