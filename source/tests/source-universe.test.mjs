import test from 'node:test';
import assert from 'node:assert/strict';
import {WORLD_SOURCE_CANDIDATES,WORLD_SOURCE_CANDIDATE_COUNT,WORLD_SOURCE_SECTORS,validateWorldSourceDirectory} from '../.build/src/iceo/source-universe.js';

test('source universe is a discovery inventory across global and local sectors, not a live ingestion claim',()=>{
 assert.ok(WORLD_SOURCE_CANDIDATE_COUNT>=100);
 assert.ok(WORLD_SOURCE_SECTORS.length>=12);
 assert.equal(validateWorldSourceDirectory(WORLD_SOURCE_CANDIDATES).length,WORLD_SOURCE_CANDIDATE_COUNT);
 assert.ok(WORLD_SOURCE_CANDIDATES.every(item=>item.status==='discovery-only'&&item.ingestionEnabled===false&&item.rights==='unreviewed'));
 assert.ok(WORLD_SOURCE_CANDIDATES.some(item=>item.scale==='city'));
 assert.ok(WORLD_SOURCE_CANDIDATES.some(item=>item.sector==='charity-causes'));
 assert.ok(WORLD_SOURCE_CANDIDATES.some(item=>item.id==='gdelt'));
});

test('unknown or unsafe source candidates cannot be granted access by a discovery directory',()=>{
 const source=WORLD_SOURCE_CANDIDATES[0];
 for(const mutation of [
  {...source,ingestionEnabled:true},{...source,rights:'cleared'},
  {...source,homepage:'http://example.org/'},{...source,homepage:'https://example.org/?url=https://evil.example'},
  {...source,id:'../secret'},{...source,label:''},
 ]) assert.throws(()=>validateWorldSourceDirectory([mutation]),/WORLD_SOURCE_/u);
 assert.throws(()=>validateWorldSourceDirectory([source,source]),/WORLD_SOURCE_CANDIDATE_INVALID/u);
});
