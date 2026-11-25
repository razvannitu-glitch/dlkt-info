import {before, beforeEach, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

let db;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REV = '33333333-3333-4333-8333-333333333333';
const NEXT = '44444444-4444-4444-8444-444444444444';
const base = {version: 'dlkt-info-wallet-profile-2', revision: REV, updatedAt: '2026-11-18T12:00:00.000Z', value: {displayName: null, locale: 'ro-RO', timezone: 'Europe/Bucharest', briefingTime: '08:30', interests: ['technology'], personalPriority: 'balanced', cityId: '683506', localNeeds: ['weather', 'utilities']}};
const ownedState = id => ({...base, value: {...base.value, displayName: id === A ? 'Alice' : 'Bob', cityId: id === A ? '683506' : '2995469', localNeeds: id === A ? ['weather', 'utilities'] : ['mobility']}});

async function user(id, operation) {
  await db.query("select set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
  try {return await operation();}
  finally {
    await db.exec('reset role');
    await db.exec("select set_config('request.jwt.claim.role','',false),set_config('request.jwt.claim.sub','',false)");
  }
}

before(async () => {
  db = new PGlite();
  await db.waitReady;
  await db.exec(`create role anon noinherit;
    create role authenticated noinherit;
    create role service_role noinherit bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select nullif(current_setting('request.jwt.claim.role',true),'')$$;
    grant usage on schema auth to anon,authenticated,service_role;
    grant execute on function auth.uid(),auth.role() to anon,authenticated,service_role;`);
  await db.exec(await readFile('supabase/migrations/20261111184500_dlkt_info_data_delivery_foundation.sql', 'utf8'));
  await db.query('insert into auth.users(id) values ($1),($2)', [A, B]);
});

beforeEach(async () => {
  for (const id of [A, B]) {
    await user(id, () => db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values ($1,'wallet-profile-v1','preference',$2::jsonb) on conflict(owner_id,memory_key) do update set state=excluded.state", [id, JSON.stringify(ownedState(id))]));
  }
});

after(async () => {if (db) await db.close();});

test('wallet profiles remain owner-private under the actual SQL RLS policies', async () => {
  for (const id of [A, B]) {
    await user(id, async () => {
      const rows = await db.query("select owner_id,state->'value'->>'displayName' as name,state->'value'->>'cityId' as city_id,state->'value'->'localNeeds' as local_needs from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
      assert.deepEqual(rows.rows, [{owner_id: id, name: id === A ? 'Alice' : 'Bob', city_id: ownedState(id).value.cityId, local_needs: ownedState(id).value.localNeeds}]);
      const foreign = await db.query("select state from public.dlkt_info_user_memory where owner_id=$1 and memory_key='wallet-profile-v1'", [id === A ? B : A]);
      assert.deepEqual(foreign.rows, []);
    });
  }
});

test('wallet table uses FORCE RLS and has no anonymous access', async () => {
  const table = await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='public.dlkt_info_user_memory'::regclass");
  assert.deepEqual(table.rows, [{relrowsecurity: true, relforcerowsecurity: true}]);
  await db.exec('set role anon');
  try {
    await assert.rejects(db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'"), /permission denied/);
  } finally {await db.exec('reset role');}
});

test('a wallet owner cannot insert or transfer a profile into another account', async () => {
  await user(A, async () => {
    await assert.rejects(db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values ($1,'wallet-injected-v1','preference',$2::jsonb)", [B, JSON.stringify(base)]), /row-level security/);
    await assert.rejects(db.query("update public.dlkt_info_user_memory set owner_id=$1 where memory_key='wallet-profile-v1'", [B]), /row-level security/);
  });
});

test('profile create is insert-only and an existing owner key cannot be silently replaced', async () => {
  await user(A, async () => {
    await assert.rejects(db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values ($1,'wallet-profile-v1','preference',$2::jsonb)", [A, JSON.stringify({...base, revision: NEXT})]), /duplicate key/);
    const rows = await db.query("select state->>'revision' as revision from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(rows.rows, [{revision: REV}]);
  });
});

test('competing v2 profile writes admit one complete city-and-needs winner', async () => {
  await user(A, async () => {
    const sql = "update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1' and memory_type='preference' and state->>'revision'=$3 returning state";
    const otherRevision = '55555555-5555-4555-8555-555555555555';
    const choices = [
      {...ownedState(A), revision: NEXT, value: {...ownedState(A).value, cityId: '2995469', localNeeds: ['culture']}},
      {...ownedState(A), revision: otherRevision, value: {...ownedState(A).value, cityId: '683506', localNeeds: ['administration', 'local-reporting']}},
    ];
    const results = await Promise.all(choices.map(choice => db.query(sql, [JSON.stringify(choice), A, REV])));
    assert.deepEqual(results.map(result => result.rows.length).sort(), [0, 1]);
    const winner = results.flatMap(result => result.rows)[0].state;
    const stored = await db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(stored.rows, [{state: winner}]);
    assert.deepEqual(winner, choices.find(choice => choice.revision === winner.revision));
  });
});

test('cross-owner profile update and deletion cannot match another account', async () => {
  await user(A, async () => {
    const update = await db.query("update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1' returning owner_id", [JSON.stringify({...base, revision: NEXT}), B]);
    const deletion = await db.query("delete from public.dlkt_info_user_memory where owner_id=$1 and memory_key='wallet-profile-v1' returning owner_id", [B]);
    assert.deepEqual(update.rows, []);
    assert.deepEqual(deletion.rows, []);
  });
  await user(B, async () => {
    const rows = await db.query("select state->>'revision' as revision from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(rows.rows, [{revision: REV}]);
  });
});

test('profile deletion respects revision and leaves the reader account namespace intact', async () => {
  await user(A, async () => {
    await db.query("insert into public.dlkt_info_user_memory(owner_id,memory_key,memory_type,state) values ($1,'reader-account-v1','preference','{}')", [A]);
    const stale = await db.query("delete from public.dlkt_info_user_memory where owner_id=$1 and memory_key='wallet-profile-v1' and state->>'revision'=$2 returning owner_id", [A, NEXT]);
    assert.equal(stale.rows.length, 0);
    const exact = await db.query("delete from public.dlkt_info_user_memory where owner_id=$1 and memory_key='wallet-profile-v1' and state->>'revision'=$2 returning owner_id", [A, REV]);
    assert.deepEqual(exact.rows, [{owner_id: A}]);
    const remaining = await db.query('select memory_key from public.dlkt_info_user_memory');
    assert.deepEqual(remaining.rows, [{memory_key: 'reader-account-v1'}]);
  });
});


test('legacy v1 data and explicit v2 upgrades use one private owner namespace', async () => {
  const {cityId: _city, localNeeds: _needs, ...oldValue} = ownedState(A).value;
  const legacy = {...base, version: 'dlkt-info-wallet-profile-1', value: oldValue};
  const upgraded = {...base, revision: NEXT, value: {...oldValue, cityId: null, localNeeds: []}};
  await user(A, async () => {
    await db.query("update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1'", [JSON.stringify(legacy), A]);
    const old = await db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(old.rows, [{state: legacy}]);
    const changed = await db.query("update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1' and state->>'revision'=$3 returning state", [JSON.stringify(upgraded), A, REV]);
    assert.deepEqual(changed.rows, [{state: upgraded}]);
    const saved = await db.query("select memory_key,memory_type,state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(saved.rows, [{memory_key: 'wallet-profile-v1', memory_type: 'preference', state: upgraded}]);
  });
  await user(B, async () => {
    const unchanged = await db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(unchanged.rows, [{state: ownedState(B)}]);
  });
});

test('explicit clearing persists null city and empty needs without changing other preferences or owner B', async () => {
  const cleared = {...ownedState(A), revision: NEXT, value: {...ownedState(A).value, cityId: null, localNeeds: []}};
  await user(A, async () => {
    const changed = await db.query("update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1' and state->>'revision'=$3 returning state", [JSON.stringify(cleared), A, REV]);
    assert.deepEqual(changed.rows, [{state: cleared}]);
    const stale = await db.query("update public.dlkt_info_user_memory set state=$1::jsonb where owner_id=$2 and memory_key='wallet-profile-v1' and state->>'revision'=$3 returning state", [JSON.stringify(ownedState(A)), A, REV]);
    assert.deepEqual(stale.rows, []);
    const restored = await db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(restored.rows, [{state: cleared}]);
  });
  await user(B, async () => {
    const own = await db.query("select state from public.dlkt_info_user_memory where memory_key='wallet-profile-v1'");
    assert.deepEqual(own.rows, [{state: ownedState(B)}]);
  });
});
