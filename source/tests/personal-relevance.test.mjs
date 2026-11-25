import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePersonalLocalProfile, selectPersonalLocal, PERSONAL_LOCAL_VERSION} from '../.build/iceo/personal-relevance.js';
const profile = {version: PERSONAL_LOCAL_VERSION, cityId:'683506', needs:['utilities','culture']};
test('confirmed profile is immutable and detached from input', () => {
  const input = {...profile, needs:[...profile.needs]};
  const parsed = parsePersonalLocalProfile(input);
  input.needs.push('weather');
  assert.deepEqual(parsed.needs, profile.needs);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.needs));
});
test('rejects unknown versions, needs, duplicates and extra private fields', () => {
  for (const input of [null, {...profile, version:'unknown'}, {...profile, cityId:'Bucharest'},
    {...profile, needs:['unknown']}, {...profile, needs:['culture','culture']},
    {...profile, address:'private'}]) {
    assert.throws(() => parsePersonalLocalProfile(input), /PERSONAL_LOCAL_PROFILE_INVALID/);
  }
});
test('selection fails closed on absent or invalid city and snapshot', () => {
  const city = {id:'683506',name:'Bucharest',countryCode:'RO',country:'Romania',region:'Bucharest',lat:44.43,lon:26.10,timezone:'Europe/Bucharest'};
  assert.deepEqual(selectPersonalLocal(profile, null, city, Date.now()), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, {...city,id:'123'}, Date.now()), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, city, NaN), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, null, Date.now()), []);
});
