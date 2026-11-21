import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const USER_ONE = '11111111-1111-4111-8111-111111111111';
const USER_TWO = '22222222-2222-4222-8222-222222222222';
const ENTITIES = Array.from({ length: 12 }, (_, index) => `Entity ${index + 1}`);
const TRUST = Object.freeze({
  minimumTrust: 'corroborated',
  conflictPolicy: 'exclude',
  authorityRequirement: 'primary',
  minimumSources: 2,
  maximumEvidenceAgeHours: 72,
  requireOfficialForHighImpact: true,
});
let db;

async function query(text, params = []) { return db.query(text, params); }
async function resetRole() {
  await db.exec('reset role;');
  await query("select set_config('request.jwt.claim.role', '', false), set_config('request.jwt.claim.sub', '', false)");
}
async function asRole(role, userId, operation) {
  await resetRole();
  await query("select set_config('request.jwt.claim.role', $1, false), set_config('request.jwt.claim.sub', $2, false)", [role, userId ?? '']);
  await db.exec(`set role ${role};`);
  try { return await operation(); } finally { await resetRole(); }
}
async function asUser(userId, operation) { return asRole('authenticated', userId, operation); }

function saveSql({ briefing = 'null::uuid', topics = "array['regulation','opportunities']::text[]", entities = '$1::text[]', timezone = "'Europe/Bucharest'", time = "time '06:30'", max = '25::integer', materiality = "'high'", actionable = 'true', trust = TRUST } = {}) {
  return `select public.dlkt_info_save_companion_configuration(
    ${briefing}, ${topics}, ${entities}, ${timezone}, ${time}, ${max}, ${materiality}, ${actionable},
    '${trust.minimumTrust}', '${trust.conflictPolicy}', '${trust.authorityRequirement}', ${trust.minimumSources}::integer,
    ${trust.maximumEvidenceAgeHours}::integer, ${trust.requireOfficialForHighImpact}
  ) as config`;
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
  await query(
    `insert into auth.users (id, raw_user_meta_data) values
     ($1, '{"locale":"en","timezone":"Europe/Bucharest"}'::jsonb),
     ($2, '{"locale":"en","timezone":"Europe/London"}'::jsonb)`,
    [USER_ONE, USER_TWO],
  );
});

after(async () => { await resetRole(); await db.close(); });

test('authenticated companion saves exact policy, more than eight entities and a card budget above twelve', async () => {
  const initial = await asUser(USER_ONE, () => query('select public.dlkt_info_read_companion_configuration() as config'));
  assert.equal(initial.rows[0].config.profile.timezone, 'Europe/Bucharest');
  assert.equal(initial.rows[0].config.briefing, null);
  assert.equal(initial.rows[0].config.trustPolicy, null);

  const saved = await asUser(USER_ONE, () => query(saveSql(), [ENTITIES]));
  const config = saved.rows[0].config;
  assert.equal(config.version, 'dlkt-info-persistence-2');
  assert.equal(config.briefing.status, 'active');
  assert.equal(config.briefing.maxCards, 25);
  assert.equal(config.briefing.deliveryLocalTime, '06:30');
  assert.deepEqual(config.rule.topics, ['regulation', 'opportunities']);
  assert.deepEqual(config.rule.entities, ENTITIES);
  assert.deepEqual(config.trustPolicy, TRUST);
  assert.equal(config.rule.onlyActionable, true);
  assert.ok(config.briefing.nextDeliveryAt);

  const counts = await query(
    `select
       (select count(*)::int from public.dlkt_info_briefings where owner_id = $1) as briefings,
       (select count(*)::int from public.dlkt_info_interest_rules where briefing_id = $2) as rules,
       (select count(*)::int from public.dlkt_info_briefing_targets where briefing_id = $2 and channel = 'web') as web_targets`,
    [USER_ONE, config.briefing.id],
  );
  assert.deepEqual(counts.rows, [{ briefings: 1, rules: 1, web_targets: 1 }]);
});

test('identical saves are idempotent and policy or budget changes advance version', async () => {
  const current = await asUser(USER_ONE, () => query('select public.dlkt_info_read_companion_configuration() as config'));
  const id = current.rows[0].config.briefing.id;
  const beforeVersion = Number(current.rows[0].config.briefing.version);

  const repeated = await asUser(USER_ONE, () => query(saveSql({ briefing: '$1::uuid', entities: '$2::text[]' }), [id, ENTITIES]));
  assert.equal(repeated.rows[0].config.briefing.id, id);
  assert.equal(Number(repeated.rows[0].config.briefing.version), beforeVersion);

  const strict = { minimumTrust: 'confirmed', conflictPolicy: 'exclude', authorityRequirement: 'official', minimumSources: 2, maximumEvidenceAgeHours: 24, requireOfficialForHighImpact: true };
  const changed = await asUser(USER_ONE, () => query(saveSql({ briefing: '$1::uuid', entities: '$2::text[]', max: '40::integer', time: "time '08:15'", trust: strict }), [id, ENTITIES]));
  assert.equal(Number(changed.rows[0].config.briefing.version), beforeVersion + 1);
  assert.equal(changed.rows[0].config.briefing.maxCards, 40);
  assert.equal(changed.rows[0].config.briefing.deliveryLocalTime, '08:15');
  assert.deepEqual(changed.rows[0].config.trustPolicy, strict);
});

test('companion persistence isolates owners and rejects invalid topics, duplicate entities and invalid trust', async () => {
  const owner = await asUser(USER_ONE, () => query('select public.dlkt_info_read_companion_configuration() as config'));
  const ownerBriefing = owner.rows[0].config.briefing.id;

  await assert.rejects(
    asUser(USER_TWO, () => query(saveSql({ briefing: '$1::uuid', topics: "array['technology']::text[]", entities: "array['OpenAI']::text[]", timezone: "'Europe/London'", time: "time '09:00'", max: '15::integer', materiality: "'low'", actionable: 'false' }), [ownerBriefing])),
    /DLKT_INFO_BRIEFING_OWNERSHIP_INVALID/u,
  );
  await assert.rejects(
    asUser(USER_TWO, () => query(saveSql({ topics: "array['politics']::text[]", entities: "array['OpenAI']::text[]", timezone: "'Europe/London'", time: "time '09:00'", max: '15::integer', materiality: "'low'", actionable: 'false' }))),
    /DLKT_INFO_COMPANION_TOPICS_INVALID/u,
  );
  await assert.rejects(
    asUser(USER_TWO, () => query(saveSql({ topics: "array['technology']::text[]", entities: "array['OpenAI','openai']::text[]", timezone: "'Europe/London'", time: "time '09:00'", max: '15::integer', materiality: "'low'", actionable: 'false' }))),
    /DLKT_INFO_COMPANION_ENTITIES_INVALID/u,
  );
  await assert.rejects(
    asUser(USER_TWO, () => query(saveSql({ topics: "array['technology']::text[]", entities: "array['OpenAI']::text[]", timezone: "'Europe/London'", time: "time '09:00'", max: '15::integer', materiality: "'low'", actionable: 'false', trust: { ...TRUST, minimumTrust: 'invented' } }))),
    /DLKT_INFO_COMPANION_CONFIGURATION_INVALID/u,
  );
});

test('anonymous role cannot read or save companion configuration', async () => {
  await assert.rejects(
    asRole('anon', '', () => query('select public.dlkt_info_read_companion_configuration()')),
    /permission denied/u,
  );
  await assert.rejects(
    asRole('anon', '', () => query(saveSql({ topics: "array['technology']::text[]", entities: "array['OpenAI']::text[]", max: '15::integer', materiality: "'low'", actionable: 'false' }))),
    /permission denied/u,
  );
});
