import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePersonalLocalProfile, selectPersonalLocal, PERSONAL_LOCAL_VERSION} from '../.build/src/iceo/personal-relevance.js';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {weatherCard} from '../.build/src/local/weather.js';

const now = Date.parse('2026-11-18T12:17:00.000Z');
const checkedAt = new Date(now).toISOString();
const palma = findCity('2512989');
const bucharest = findCity('683506');
const london = findCity('2643743');
assert.ok(palma && bucharest && london);
const profile = {version: PERSONAL_LOCAL_VERSION, cityId: bucharest.id, needs: ['utilities', 'culture']};
const forCity = (city, needs) => ({version: PERSONAL_LOCAL_VERSION, cityId: city.id, needs});

function forecast(city) {
  const start = Math.ceil(now / 3_600_000) * 3_600_000;
  return weatherCard({
    type: 'Feature',
    geometry: {coordinates: [city.lon, city.lat]},
    properties: {
      meta: {updated_at: checkedAt, units: {
        air_temperature: 'celsius', wind_speed: 'm/s', precipitation_amount: 'mm',
      }},
      timeseries: Array.from({length: 7}, (_, index) => ({
        time: new Date(start + index * 3_600_000).toISOString(),
        data: {
          instant: {details: {air_temperature: 10 + index, wind_speed: 2}},
          next_1_hours: {details: {precipitation_amount: 0.1}},
        },
      })),
    },
  }, city, checkedAt, now);
}

const event = id => ({
  id, kind: 'event', title: 'Fixture event ' + id, text: 'Synthetic official-listing fixture.',
  publisher: 'PalmaCultura',
  sourceUrl: 'https://www.palmacultura.com/ca/noticia/12345/event-' + id,
  sourceUpdatedAt: null, checkedAt, validFrom: checkedAt,
  validTo: new Date(now + 300_000).toISOString(), facts: ['Fixture admission terms.'],
  boundary: 'Fixture only; not a live event.',
  context: {
    section: 'discover', place: 'Palma fixture venue', when: '18 November, listed start',
    why: 'Scheduled in the selected city.', action: 'Check the organiser.',
    sourceDate: '2026-11-18', startsAt: '2026-11-18T13:00:00.000Z',
    status: 'scheduled', documentHash: 'a'.repeat(64),
    documentUrl: 'https://www.palmacultura.com/index.php?Idi=2',
  },
});

function transportNotice() {
  const card = event('transport');
  const sourceUrl = 'https://www.tib.org/es/w/fixture-notice';
  return {...card, kind: 'transport-notice', publisher: 'TIB', sourceUrl,
    context: {...card.context, section: 'essential', startsAt: null,
      status: 'operator-notice', documentUrl: sourceUrl}};
}

function announcement() {
  const card = event('announcement');
  const sourceUrl = 'https://noticies.palma.es/-/fixture-announcement';
  return {...card, kind: 'municipal-news', publisher: 'Palma council', sourceUrl,
    context: {...card.context, section: 'context', startsAt: null,
      status: 'publisher-announcement', documentUrl: sourceUrl}};
}

const snapshot = (city, cards) => ({
  version: 'dlkt-local-1', city, checkedAt, state: 'partial',
  weatherState: cards.some(card => card.kind === 'forecast') ? 'ready' : 'unavailable',
  transportState: 'not-covered', cards,
});
function verifiedFixture(value, city) {
  assert.equal(currentLocalSnapshot(value, city, now), true,
    'fixture must satisfy the existing local source contract');
  return value;
}

test('confirmed profile is immutable and detached from input', () => {
  const input = {...profile, needs: [...profile.needs]};
  const parsed = parsePersonalLocalProfile(input);
  input.needs.push('weather');
  assert.deepEqual(parsed.needs, profile.needs);
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.needs));
});

test('rejects unknown versions, needs, duplicates and extra private fields', () => {
  for (const input of [null, {...profile, version: 'unknown'}, {...profile, cityId: 'Bucharest'},
    {...profile, needs: ['unknown']}, {...profile, needs: ['culture', 'culture']},
    {...profile, address: 'private'}]) {
    assert.throws(() => parsePersonalLocalProfile(input), /PERSONAL_LOCAL_PROFILE_INVALID/);
  }
});

test('rejects inherited profile fields, unrelated own keys and sparse needs', () => {
  const inherited = Object.assign(Object.create({
    version: PERSONAL_LOCAL_VERSION, cityId: bucharest.id, needs: ['weather'],
  }), {address: 'private', a: 1, b: 2});
  assert.throws(() => parsePersonalLocalProfile(inherited), /PERSONAL_LOCAL_PROFILE_INVALID/);
  assert.throws(() => parsePersonalLocalProfile({...profile, needs: new Array(1)}),
    /PERSONAL_LOCAL_PROFILE_INVALID/);
});

test('selection fails closed on absent or invalid city and snapshot', () => {
  assert.deepEqual(selectPersonalLocal(profile, null, bucharest, now), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, {...bucharest, id: '123'}, now), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, bucharest, NaN), []);
  assert.deepEqual(selectPersonalLocal(profile, {}, null, now), []);
});

test('selects only declared needs and retains exact source cards with a bounded rationale', () => {
  const weather = forecast(palma), culture = event('culture'), mobility = transportNotice();
  const value = verifiedFixture(snapshot(palma, [weather, culture, mobility, announcement()]), palma);
  const input = forCity(palma, ['weather', 'culture']);
  const selected = selectPersonalLocal(input, value, palma, now);
  assert.deepEqual(selected.map(match => match.need), ['weather', 'culture']);
  assert.equal(selected[0].card, weather);
  assert.equal(selected[1].card, culture);
  assert.equal(selected.some(match => match.card === mobility), false);
  for (const match of selected) {
    assert.equal(match.reason, 'confirmed-city-and-declared-need');
    assert.equal(match.applicability, 'city-context-only');
  }
});

test('retains a real weather-card forecast that starts at the next full hour', () => {
  const card = forecast(palma);
  assert.equal(card.validFrom, '2026-11-18T13:00:00.000Z');
  assert.ok(Date.parse(card.validFrom) > now);
  const value = verifiedFixture(snapshot(palma, [card]), palma);
  const selected = selectPersonalLocal(forCity(palma, ['weather']), value, palma, now);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].card, card);
  assert.equal(selected[0].card.validFrom, card.validFrom);
  assert.match(selected[0].card.boundary, /forecast, not measured conditions/);
});

test('mobility and administration use the selected source kinds without opting into culture', () => {
  const mobility = transportNotice(), administration = announcement();
  const value = verifiedFixture(snapshot(palma, [event('culture'), administration, mobility]), palma);
  const selected = selectPersonalLocal(forCity(palma, ['mobility', 'administration']), value, palma, now);
  assert.deepEqual(selected.map(match => match.card), [mobility, administration]);
  assert.deepEqual(selected.map(match => match.need), ['mobility', 'administration']);
});

test('an empty declared selection does not infer needs from available cards', () => {
  const value = verifiedFixture(snapshot(palma, [forecast(palma), event('culture')]), palma);
  assert.deepEqual(selectPersonalLocal(forCity(palma, []), value, palma, now), []);
});

test('a checked utility notice remains city context rather than a household impact claim', () => {
  const sourceUrl = 'https://www.cmteb.ro/functionare_sistem_termoficare.php';
  const card = {
    ...event('utility'), id: 'bucharest:cmteb:sector-6', kind: 'utility-notice',
    title: 'Fixture sector service notice', publisher: 'Termoenergetica Bucuresti (CMTEB)', sourceUrl,
    context: {
      ...event('utility').context, section: 'essential', place: 'Bucharest sector 6',
      when: 'Fixture operator list checked today', startsAt: null, status: 'operator-notice',
      documentUrl: sourceUrl,
    },
  };
  const value = verifiedFixture({
    ...snapshot(bucharest, [forecast(bucharest), card]),
    coverage: [{domain: 'utilities', state: 'partial', checkedAt, sourceUrl,
      note: 'Synthetic CMTEB document fixture only.'}],
  }, bucharest);
  const selected = selectPersonalLocal(forCity(bucharest, ['utilities']), value, bucharest, now);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].card, card);
  assert.equal(selected[0].need, 'utilities');
  assert.equal(selected[0].applicability, 'city-context-only');
  assert.equal(selected[0].reason, 'confirmed-city-and-declared-need');
});

test('rejects a different selected city and a snapshot with altered city coordinates', () => {
  const value = verifiedFixture(snapshot(palma, [forecast(palma)]), palma);
  assert.deepEqual(selectPersonalLocal(forCity(palma, ['weather']), value, london, now), []);
  assert.deepEqual(selectPersonalLocal(forCity(london, ['weather']), value, london, now), []);
  assert.deepEqual(selectPersonalLocal(forCity(palma, ['weather']), value,
    {...palma, lon: palma.lon + 1}, now), []);
});

test('stale, future-checked and tampered source snapshots cannot produce personal matches', () => {
  const card = forecast(palma);
  const value = verifiedFixture(snapshot(palma, [card]), palma);
  const input = forCity(palma, ['weather']);
  for (const [candidate, clock] of [
    [value, now + 300_000],
    [value, now - 6_000],
    [{...value, cards: [{...card, sourceUrl: 'https://attacker.invalid/weather'}]}, now],
  ]) {
    assert.deepEqual(selectPersonalLocal(input, candidate, palma, clock), []);
  }
});

test('an expiring event disappears at its boundary while the valid forecast remains', () => {
  const weather = forecast(palma);
  const culture = {...event('short'), validTo: new Date(now + 45_000).toISOString()};
  const value = verifiedFixture(snapshot(palma, [weather, culture]), palma);
  const input = forCity(palma, ['weather', 'culture']);
  assert.deepEqual(selectPersonalLocal(input, value, palma, now).map(match => match.card), [weather, culture]);
  assert.deepEqual(selectPersonalLocal(input, value, palma, now + 45_000).map(match => match.card), [weather]);
});

test('selection does not mutate profile or source snapshot and freezes its own results', () => {
  const value = verifiedFixture(snapshot(palma, [forecast(palma), event('culture')]), palma);
  const input = forCity(palma, ['weather', 'culture']);
  const before = JSON.stringify({input, value});
  const selected = selectPersonalLocal(input, value, palma, now);
  assert.equal(selected.length, 2);
  assert.equal(JSON.stringify({input, value}), before);
  assert.ok(Object.isFrozen(selected));
  assert.ok(selected.every(match => Object.isFrozen(match)));
});
