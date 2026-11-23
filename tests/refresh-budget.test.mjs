import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root=fileURLToPath(new URL('..',import.meta.url));
const read=path=>readFileSync(join(root,path),'utf8');
test('Vercel refresh maximum duration matches the fenced lease and entire publication budget',()=>{
 const publicConfig=JSON.parse(read('source/vercel.public.json'));
 const liveConfig=JSON.parse(read('vercel.json'));
 assert.deepEqual(liveConfig,{...publicConfig,installCommand:'npm ci --ignore-scripts --no-audit --no-fund'});
 const fn=publicConfig.functions['api/iceo-refresh.ts'];
 assert.equal(fn.maxDuration,80);
 const source=read('source/src/iceo/refresh-ledger.ts');
 const sql=read('source/scripts/continuous-refresh-store.sql');
 const corpus=read('source/src/iceo/news-corpus-store.ts');
 assert.match(source,/CONTINUOUS_REFRESH_DEADLINE_MS\s*=\s*45_000/u);
 assert.match(source,/REFRESH_LEDGER_TIMEOUT_MS\s*=\s*3_000/u);
 assert.match(corpus,/TIMEOUT_MS=8000/u);
 assert.match(sql,/lease_expires_at=n\+interval '90 seconds'/u);
 // Collection 45s + stage 8s + publish 3s + snapshot read 3s +
 // corpus read 8s <= 67s, leaving >= 13s to complete before 80s.
 assert.ok(fn.maxDuration*1000-(45_000+8_000+3_000+3_000+8_000)>=13_000);
 assert.ok(fn.maxDuration*1000<90_000);
 assert.deepEqual(Object.keys(publicConfig.schedules),['iceo-daily-top']);
 const scheduled=publicConfig.schedules['iceo-daily-top'];
 assert.equal(scheduled.schedule,'*/2 * * * *');
 assert.equal(scheduled.path,'/api/iceo-refresh');
 assert.equal(scheduled.requestMethod,'GET');
 assert.equal(publicConfig.crons,undefined,'never introduce a second scheduler');
});
