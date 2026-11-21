import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
async function query(text, params = []) { return db.query(text, params); }
async function resetRole() {
  await db.exec('reset role;');
  await query("select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
}
async function asRole(role, operation) {
  await resetRole();
  await query("select set_config('request.jwt.claim.role', $1, false)", [role]);
  await db.exec(`set role ${role};`);
  try { return await operation(); } finally { await resetRole(); }
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`
    create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
  `);
  const files = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
});

after(async () => { await resetRole(); await db.close(); });

test('anon can read only the non-secret exact DLKT system identity', async () => {
  const result = await asRole('anon', () => query('select public.dlkt_info_read_system_identity() as identity'));
  const identity = result.rows[0].identity;
  assert.deepEqual(Object.keys(identity).sort(), [
    'automaticExecution', 'dataFoundationVersion', 'dataRegion', 'dedicated', 'engineId',
    'instanceId', 'persistenceVersion', 'productId', 'publicCardsEnabled', 'schemaRevision', 'version',
  ].sort());
  assert.equal(identity.version, 'dlkt-info-system-identity-1');
  assert.match(identity.instanceId, /^[0-9a-f-]{36}$/u);
  assert.equal(identity.productId, 'dlkt-info');
  assert.equal(identity.engineId, 'dlkt-info-inphocore-engine-orchestra');
  assert.equal(identity.dataRegion, 'eu-central-1');
  assert.equal(identity.schemaRevision, '20261113115256_dlkt_info_provisioning_identity_guard');
  assert.equal(identity.dedicated, true);
  assert.equal(identity.automaticExecution, false);
  assert.equal(identity.publicCardsEnabled, false);
  await assert.rejects(
    asRole('anon', () => query('select * from dlkt_info_private.system_identity')),
    /permission denied/u,
  );
});

test('reapplying identity migration preserves the database instance binding', async () => {
  const before = await query('select public.dlkt_info_read_system_identity() as identity');
  const migration = await readFile('supabase/migrations/20261113115256_dlkt_info_provisioning_identity_guard.sql', 'utf8');
  await db.exec(migration);
  const afterResult = await query('select public.dlkt_info_read_system_identity() as identity');
  assert.equal(afterResult.rows[0].identity.instanceId, before.rows[0].identity.instanceId);
});
