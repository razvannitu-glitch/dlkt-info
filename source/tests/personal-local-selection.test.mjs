import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPersonalLocalEdition, PERSONAL_LOCAL_VERSION} from '../.build/src/iceo/personal-relevance.js';
import {selectHomeLocal, selectLocalCandidates} from '../.build/src/iceo/home-local.js';
import {findCity} from '../.build/src/local/cities.js';
import {currentLocalSnapshot} from '../.build/src/local/contracts.js';
import {newsFeedsFor, newsGeographicAnchors, newsTopic} from '../.build/src/local/news-policy.js';

const now = Date.parse('2026-11-18T12:17:00.000Z'), checkedAt = new Date(now).toISOString();
const palma = findCity('2512989'), bucharest = findCity('683506'), london = findCity('2643743');
assert.ok(palma && bucharest && london);
const profile = (city, needs) => ({version: PERSONAL_LOCAL_VERSION, cityId: city.id, needs});
const forecast = city => ({
  id: 'weather:' + city.id, kind: 'forecast', title: 'Controlled next-hours forecast',
  text: 'Synthetic weather fixture.', publisher: 'MET Norway',
  sourceUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=' + city.lat.toFixed(4) + '&lon=' + city.lon.toFixed(4),
  sourceUpdatedAt: checkedAt, checkedAt, validFrom: '2026-11-18T13:00:00.000Z',
  validTo: '2026-11-18T19:00:00.000Z', facts: ['Synthetic values.'],
  boundary: 'City-centre forecast, not observed weather or official warnings.',
});
const event = index => ({
  id: 'culture-' + index, kind: 'event', title: 'Controlled culture record ' + index,
  text: 'Synthetic listing for selector verification.', publisher: 'PalmaCultura',
  sourceUrl: 'https://www.palmacultura.com/ca/noticia/12345/event-' + index,
  sourceUpdatedAt: null, checkedAt, validFrom: checkedAt,
  validTo: new Date(now + 300_000).toISOString(), facts: [], boundary: 'Controlled fixture; no live event claim.',
  context: {section: 'discover', place: 'Palma fixture venue', when: 'Fixture listed start',
    why: 'The source names the selected city.', action: 'Check the organiser.',
    sourceDate: '2026-11-18', startsAt: new Date(Date.parse('2026-11-18T13:00:00.000Z') + index * 60_000).toISOString(),
    status: 'scheduled', documentHash: 'a'.repeat(64),
    documentUrl: 'https://www.palmacultura.com/index.php?Idi=2'},
});
const cultureScope = (state = 'ready', extra = {}) => ({
  domain: 'events', state, checkedAt: state === 'unavailable' ? null : checkedAt,
  sourceUrl: 'https://www.palmacultura.com/index.php?Idi=2',
  note: 'Controlled accepted snapshot only; source acquisition limits and ticket availability remain outside this check.',
  ...extra,
});
const snapshot = (city, cards, extra = {}) => ({
  version: 'dlkt-local-1', city, checkedAt, state: cards.length ? 'partial' : 'unavailable',
  weatherState: cards.some(card => card.kind === 'forecast') ? 'ready' : 'unavailable',
  transportState: 'not-covered', cards, ...extra,
});
function valid(value, city, clock = now) {
  assert.equal(currentLocalSnapshot(value, city, clock), true, 'fixture must satisfy the existing local source contract');
  return value;
}
function cmteb(sector) {
  const sourceUrl = 'https://www.cmteb.ro/functionare_sistem_termoficare.php';
  return {...event(sector), id: 'bucharest:cmteb:sector-' + sector, kind: 'utility-notice',
    title: 'Controlled sector ' + sector + ' notice', publisher: 'Termoenergetica Bucuresti (CMTEB)', sourceUrl,
    context: {...event(sector).context, section: 'essential', place: 'Bucharest sector ' + sector,
      startsAt: null, status: 'operator-notice', documentUrl: sourceUrl},
    boundary: 'The operator record names a sector; it does not establish household impact.'};
}
const utilityScope = {
  domain: 'utilities', state: 'partial', checkedAt,
  sourceUrl: 'https://www.cmteb.ro/functionare_sistem_termoficare.php',
  note: 'CMTEB heating and hot-water records only; addresses and other utilities are not covered.',
};
const reportingHealth = (states = ['ready', 'ready'], count = 0) => newsFeedsFor(bucharest).map((source, index) => ({
  sourceId: source.id, publisher: source.publisher, feedUrl: source.endpoint, termsUrl: source.termsUrl,
  state: states[index], checkedAt: states[index] === 'unavailable' ? null : checkedAt,
  count: index === 0 ? count : 0, rejected: 0, error: states[index] === 'unavailable' ? 'FETCH_FAILED' : null,
}));
function localReport() {
  const source = newsFeedsFor(bucharest)[0];
  assert.ok(source);
  const title = 'Bucuresti: trafic modificat in zona centrala';
  const news = {
    id: 'local-news:' + bucharest.id + ':' + source.id + ':' + 'b'.repeat(24),
    sourceId: source.id, publisher: source.publisher, cityId: bucharest.id,
    title, url: 'https://b365.ro/fixture-bucuresti-123456/',
    publishedAt: new Date(now - 3_600_000).toISOString(), checkedAt,
    validUntil: new Date(now + 300_000).toISOString(), topic: newsTopic(title),
    geographyBasis: 'article-place-reference',
    geoAnchors: newsGeographicAnchors(title, undefined, source.id, bucharest),
    documentHash: 'c'.repeat(64), documentUrl: source.endpoint, attribution: source.attribution,
  };
  return {
    id: news.id, kind: 'local-news', title, text: 'Read the publisher report for the complete details.',
    publisher: source.publisher, sourceUrl: news.url, sourceUpdatedAt: null, checkedAt,
    validFrom: checkedAt, validTo: news.validUntil, facts: [], news,
    boundary: 'Attributed publisher report with a city reference, not household impact.',
    context: {section: 'context', place: bucharest.name, when: 'Published ' + news.publishedAt,
      why: 'The publisher names the selected city.', action: 'Read the complete original report.',
      sourceDate: news.publishedAt.slice(0, 10), startsAt: null, status: 'publisher-announcement',
      documentHash: news.documentHash, documentUrl: news.documentUrl},
  };
}

test('home and personal matching retain every eligible accepted record while personal needs remain filtered', () => {
  const weather = forecast(palma), events = Array.from({length: 14}, (_, index) => event(index));
  const value = valid(snapshot(palma, [weather, ...events], {coverage: [cultureScope()]}), palma);
  const before = JSON.stringify(value);
  const home = selectHomeLocal(value, palma, now);
  assert.deepEqual(home.cards.map(card => card.id), [weather.id, ...events.map(card => card.id)]);
  assert.equal(home.expiresAt, now + 300_000);
  const edition = selectPersonalLocalEdition(profile(palma, ['culture']), value, palma, now);
  assert.equal(edition.state, 'ready');
  assert.deepEqual(edition.matches.map(match => match.card), events);
  assert.equal(edition.coverage[0].matchedCount, 14);
  assert.equal(edition.coverage[0].note, value.coverage[0].note);
  assert.equal(JSON.stringify(value), before);
});

test('homepage sector grouping stays unchanged while personal matches retain original operator records', () => {
  const first = cmteb(1), sixth = cmteb(6), weather = forecast(bucharest);
  const value = valid(snapshot(bucharest, [first, weather, sixth], {coverage: [utilityScope]}), bucharest);
  const home = selectHomeLocal(value, bucharest, now);
  assert.deepEqual(home.cards.map(card => card.id), ['bucharest:cmteb:overview', weather.id]);
  assert.deepEqual(home.cards[0].facts, [first.title, sixth.title]);
  assert.equal(home.expiresAt, now + 300_000);
  const edition = selectPersonalLocalEdition(profile(bucharest, ['utilities']), value, bucharest, now);
  assert.equal(edition.state, 'partial');
  assert.deepEqual(edition.matches.map(match => match.card), [first, sixth]);
  assert.ok(edition.matches.every(match => match.applicability === 'city-context-only'));
  assert.equal(edition.coverage[0].note, utilityScope.note);
});

test('a fresh successful empty selected-source check is distinct from unavailable and partial coverage', () => {
  const empty = valid(snapshot(palma, [], {coverage: [cultureScope()]}), palma);
  const ready = selectPersonalLocalEdition(profile(palma, ['culture']), empty, palma, now);
  assert.equal(ready.state, 'no-match');
  assert.equal(ready.coverage[0].state, 'ready');
  assert.equal(ready.matches.length, 0);
  assert.equal(ready.checkedAt, checkedAt);
  assert.equal(ready.expiresAt, now + 300_000);
  const partial = valid({...empty, coverage: [cultureScope('partial')]}, palma);
  assert.equal(selectPersonalLocalEdition(profile(palma, ['culture']), partial, palma, now).state, 'partial');
  const unavailable = valid({...empty, coverage: [cultureScope('unavailable')]}, palma);
  assert.equal(selectPersonalLocalEdition(profile(palma, ['culture']), unavailable, palma, now).state, 'unavailable');
});

test('null profile, empty needs and unconnected source capabilities stay distinct', () => {
  const value = valid(snapshot(palma, []), palma);
  assert.equal(selectPersonalLocalEdition(null, value, palma, now).state, 'not-configured');
  assert.equal(selectPersonalLocalEdition(profile(palma, []), value, palma, now).state, 'not-configured');
  const unconnected = selectPersonalLocalEdition(profile(palma, ['utilities']), value, palma, now);
  assert.equal(unconnected.state, 'unavailable');
  assert.equal(unconnected.coverage[0].state, 'not-covered');
  assert.equal(unconnected.matches.length, 0);
});

test('one unavailable selected need does not erase another current need or become an all-clear', () => {
  const weather = forecast(palma);
  const value = valid(snapshot(palma, [weather], {coverage: [cultureScope('unavailable')]}), palma);
  const edition = selectPersonalLocalEdition(profile(palma, ['weather', 'culture']), value, palma, now);
  assert.equal(edition.state, 'partial');
  assert.deepEqual(edition.matches.map(match => match.card), [weather]);
  assert.deepEqual(edition.coverage.map(item => [item.need, item.state, item.matchedCount]),
    [['weather', 'ready', 1], ['culture', 'unavailable', 0]]);
  assert.equal(edition.coverage[0].checkedAt, weather.checkedAt);
});

test('missing publication coverage remains partial for accepted legacy records and unavailable for an empty check', () => {
  const card = event(1);
  const value = valid(snapshot(palma, [card]), palma);
  const partial = selectPersonalLocalEdition(profile(palma, ['culture']), value, palma, now);
  assert.equal(partial.state, 'partial');
  assert.equal(partial.matches[0].card, card);
  assert.match(partial.coverage[0].note, /receipt.*missing/);
  const empty = valid(snapshot(palma, []), palma);
  assert.equal(selectPersonalLocalEdition(profile(palma, ['culture']), empty, palma, now).state, 'unavailable');
});

test('a wrong publication coverage source cannot justify personal matches', () => {
  const value = valid(snapshot(palma, [event(1)], {
    coverage: [cultureScope('ready', {sourceUrl: 'https://www.tib.org/es/avisos'})],
  }), palma);
  const edition = selectPersonalLocalEdition(profile(palma, ['culture']), value, palma, now);
  assert.equal(edition.state, 'unavailable');
  assert.equal(edition.matches.length, 0);
  assert.equal(edition.coverage[0].state, 'unavailable');
  assert.deepEqual(edition.coverage[0].sourceUrls, ['https://www.palmacultura.com/index.php?Idi=2']);
});

test('a newer snapshot receipt cannot renew an expired underlying source check', () => {
  const sourceCheckedAt = new Date(now - 299_000).toISOString();
  const value = valid(snapshot(palma, [], {coverage: [cultureScope('ready', {checkedAt: sourceCheckedAt})]}), palma);
  const before = selectPersonalLocalEdition(profile(palma, ['culture']), value, palma, now);
  assert.equal(before.state, 'no-match');
  assert.equal(before.expiresAt, now + 1_000);
  const refreshed = valid({...value, checkedAt: new Date(now + 1_000).toISOString()}, palma, now + 1_000);
  const after = selectPersonalLocalEdition(profile(palma, ['culture']), refreshed, palma, now + 1_000);
  assert.equal(after.state, 'unavailable');
  assert.equal(after.coverage[0].state, 'unavailable');
  assert.equal(after.matches.length, 0);
});

test('local reporting uses original publisher checks and preserves selected records', () => {
  const card = localReport();
  const value = valid(snapshot(bucharest, [card], {newsSources: reportingHealth(['ready', 'ready'], 1)}), bucharest);
  const edition = selectPersonalLocalEdition(profile(bucharest, ['local-reporting']), value, bucharest, now);
  assert.equal(edition.state, 'ready');
  assert.equal(edition.matches[0].card, card);
  assert.equal(edition.matches[0].need, 'local-reporting');
  assert.equal(edition.matches[0].reason, 'confirmed-city-and-declared-need');
  assert.deepEqual(edition.coverage[0].sourceUrls, newsFeedsFor(bucharest).map(source => source.endpoint));
  assert.equal(edition.expiresAt, now + 300_000);
});

test('empty local reporting is no-match only when every connected publisher check is current and successful', () => {
  const complete = valid(snapshot(bucharest, [], {newsSources: reportingHealth()}), bucharest);
  assert.equal(selectPersonalLocalEdition(profile(bucharest, ['local-reporting']), complete, bucharest, now).state, 'no-match');
  const partial = valid({...complete, newsSources: reportingHealth(['ready', 'unavailable'])}, bucharest);
  assert.equal(selectPersonalLocalEdition(profile(bucharest, ['local-reporting']), partial, bucharest, now).state, 'partial');
  const failed = valid({...complete, newsSources: reportingHealth(['unavailable', 'unavailable'])}, bucharest);
  assert.equal(selectPersonalLocalEdition(profile(bucharest, ['local-reporting']), failed, bucharest, now).state, 'unavailable');
});

test('missing, invalid, stale and geographically mismatched snapshots cannot masquerade as a successful empty check', () => {
  const value = valid(snapshot(palma, [forecast(palma)], {coverage: [cultureScope()]}), palma);
  const cases = [
    [null, palma, now], [{}, palma, now], [value, palma, now + 300_000],
    [value, london, now], [value, {...palma, lat: palma.lat + 1}, now],
    [{...value, cards: [{...value.cards[0], sourceUrl: 'https://attacker.invalid/weather'}]}, palma, now],
  ];
  for (const [candidate, city, clock] of cases) {
    const edition = selectPersonalLocalEdition(profile(palma, ['weather', 'culture']), candidate, city, clock);
    assert.equal(edition.state, 'unavailable');
    assert.equal(edition.matches.length, 0);
    assert.equal(edition.checkedAt, null);
    assert.equal(edition.expiresAt, null);
  }
  assert.equal(selectLocalCandidates(value, palma, now + 300_000).state, 'stale');
});

test('expiry removes the affected match while preserving other selected records and their explanation', () => {
  const weather = forecast(palma), culture = {...event(1), validTo: new Date(now + 45_000).toISOString()};
  const value = valid(snapshot(palma, [weather, culture], {coverage: [cultureScope()]}), palma);
  const before = selectPersonalLocalEdition(profile(palma, ['weather', 'culture']), value, palma, now);
  assert.equal(before.expiresAt, now + 45_000);
  const after = selectPersonalLocalEdition(profile(palma, ['weather', 'culture']), value, palma, now + 45_000);
  assert.equal(after.state, 'partial');
  assert.deepEqual(after.matches.map(match => match.card), [weather]);
  assert.equal(after.matches[0].reason, 'confirmed-city-and-declared-need');
  assert.equal(after.coverage.find(item => item.need === 'culture').state, 'unavailable');
  assert.ok(Object.isFrozen(after));
  assert.ok(Object.isFrozen(after.coverage));
});
