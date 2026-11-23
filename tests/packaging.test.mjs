import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertSourcePath, copyVerifiedSource, createSourcePin, sha256, verifySource} from '../lib/source-integrity.mjs';
import {attestProduction, verifyDatabaseReadiness, requestDatabaseReadiness} from '../lib/production-attestation.mjs';
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dlkt-packaging-'));
  t.after(() => rmSync(root, {recursive: true, force: true}));
  const source = join(root, 'source'); mkdirSync(join(source, 'supabase/migrations'), {recursive: true});
  const migration = 'supabase/migrations/20261121080311_dlkt_info_continuous_refresh.sql';
  writeFileSync(join(source, migration), 'select 1;\n');
  writeFileSync(join(source, 'package.json'), JSON.stringify({version: '0.9.45'}));
  writeFileSync(join(source, 'RELEASE-0.9.45.json'), JSON.stringify({product: 'dlkt-info', version: '0.9.45', expectedSchemaFingerprint: 'a'.repeat(64), databaseReadinessMigration: '20261121080311_dlkt_info_continuous_refresh', files: {[migration]: sha256('select 1;\n')}}));
  return {root, source, pin: createSourcePin(source)};
}
test('verified copy retains every pinned byte and leaves original unchanged', t => {
  const {root, source, pin} = fixture(t); const target = join(root, 'build');
  copyVerifiedSource(source, target, pin);
  assert.deepEqual(createSourcePin(target), pin); assert.deepEqual(createSourcePin(source), pin);
});
test('changed source is rejected before any copy', t => {
  const {source, pin} = fixture(t); writeFileSync(join(source, 'package.json'), '{}');
  assert.throws(() => verifySource(source, pin), /SOURCE_INTEGRITY/);
});
test('unindexed source files are rejected', t => {
  const {source, pin} = fixture(t); writeFileSync(join(source, 'unexpected.txt'), 'extra');
  assert.throws(() => verifySource(source, pin), /SOURCE_FILE_SET/);
});
test('traversal, secret paths and generated paths cannot enter the pin', () => {
  for (const path of ['../outside', '/absolute', 'src/../../outside', 'src\\outside', 'C:/outside', '.env', 'src/.env.local', 'node_modules/file', '.git/config', 'supabase/.temp/ref']) assert.throws(() => assertSourcePath(path), /SOURCE_PATH/);
});
test('symlinks are refused even when their target matches a hash', t => {
  const {source, pin, root} = fixture(t); const path = join(source, 'package.json');
  const data = readFileSync(path); rmSync(path); writeFileSync(join(root, 'outside.json'), data); symlinkSync(join(root, 'outside.json'), path);
  assert.throws(() => verifySource(source, pin), /SOURCE_SYMLINK/);
});
test('release manifest cannot silently override the complete source index', t => {
  const {source} = fixture(t); const path = join(source, 'RELEASE-0.9.45.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8')); manifest.files['outside.txt'] = 'f'.repeat(64); writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifySource(source, createSourcePin(source)), /SOURCE_MANIFEST_FILE/);
});
test('pin tampering is rejected independently of source file content', t => {
  const {source, pin} = fixture(t); pin.files['package.json'] = 'f'.repeat(64);
  assert.throws(() => verifySource(source, pin), /SOURCE_INDEX_INTEGRITY/);
});
test('database readiness requires the exact release and verified receipt', () => {
  const instance = 'fixture-database-instance';
  const manifest = {expectedSchemaFingerprint: 'a'.repeat(64), databaseReadinessMigration: '20261121080311_dlkt_info_continuous_refresh'};
  const value = {ready: true, instanceId: instance, version: 'dlkt-info-database-readiness-2', schemaFingerprint: manifest.expectedSchemaFingerprint, schemaRevision: manifest.databaseReadinessMigration, automaticExecution: false, publicCardsEnabled: false,
    checks: Object.fromEntries(['rls', 'identity', 'policies', 'triggers', 'functions', 'relations', 'searchPath', 'privateSchema', 'privateTables', 'securityDefiner', 'noUnexpectedObjects', 'publicRpcPermissions', 'publicDataPermissions', 'privateFunctionPermissions'].map(key => [key, true])),
    activationReceipt: sha256(`${instance}:${manifest.expectedSchemaFingerprint}:${manifest.databaseReadinessMigration}`)};
  assert.doesNotThrow(() => verifyDatabaseReadiness(value, manifest, instance));
  for (const change of [{schemaFingerprint: 'b'.repeat(64)}, {instanceId: 'foreign-instance'}, {publicCardsEnabled: true}, {checks: {...value.checks, rls: false}}]) assert.throws(() => verifyDatabaseReadiness({...value, ...change}, manifest, instance), /BUILD_DATABASE_ATTESTATION_MISMATCH/);
  assert.throws(() => verifyDatabaseReadiness({...value, activationReceipt: 'f'.repeat(64)}, manifest, instance), /BUILD_DATABASE_RECEIPT/);
});
test('untrusted build identity fails before any database request', async () => {
  let requests = 0;
  await assert.rejects(attestProduction({}, {}, async () => {requests++; throw new Error('unexpected request');}), /BUILD_IDENTITY/);
  assert.equal(requests, 0);
});


test('readiness request retries an abort but never skips production schema checks', async () => {
  const endpoint='https://fixture.supabase.co/rest/v1/rpc/dlkt_info_read_database_readiness';
  let calls=0;
  const response=await requestDatabaseReadiness(async (url,options)=>{
    assert.equal(url,endpoint);
    assert.equal(options.method,'POST');
    assert.equal(options.cache,'no-store');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.apikey,'sb_publishable_fixture');
    assert.ok(options.signal);
    if (++calls===1) throw Object.assign(new Error('transient timeout'),{name:'TimeoutError'});
    return new Response('{"ready":true}',{status:200,headers:{'content-type':'application/json'}});
  },endpoint,'sb_publishable_fixture');
  assert.equal(calls,2);
  assert.equal((await response.json()).ready,true);
});

test('readiness temporary 503 retries but authorization and unsafe endpoints fail closed', async () => {
  const endpoint='https://fixture.supabase.co/rest/v1/rpc/dlkt_info_read_database_readiness';
  let count=0;
  const value=await requestDatabaseReadiness(async()=>{
    count++;return new Response(null,{status:count===1?503:200});
  },endpoint,'sb_publishable_fixture');
  assert.equal(value.status,200);assert.equal(count,2);
  await assert.rejects(requestDatabaseReadiness(async()=>{
    count++;return new Response(null,{status:403});
  },endpoint,'sb_publishable_fixture'),/BUILD_DATABASE_ATTESTATION_HTTP/);
  assert.equal(count,3);
  await assert.rejects(requestDatabaseReadiness(async()=>new Response(null,{status:200}),
    'http://127.0.0.1/rest/v1/rpc/dlkt_info_read_database_readiness','sb_publishable_fixture'),
    /BUILD_DATABASE_ATTESTATION_REQUEST_INVALID/);
});

test('readiness exhausts finite retries instead of declaring an unavailable database ready', async () => {
  const endpoint='https://fixture.supabase.co/rest/v1/rpc/dlkt_info_read_database_readiness';
  let count=0;
  await assert.rejects(requestDatabaseReadiness(async()=>{count++;throw Object.assign(new Error('network'),{name:'TimeoutError'});},
    endpoint,'sb_publishable_fixture'),/BUILD_DATABASE_ATTESTATION_UNAVAILABLE/);
  assert.equal(count,3);
});
