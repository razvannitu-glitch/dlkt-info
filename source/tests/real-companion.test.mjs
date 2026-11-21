import assert from 'node:assert/strict';
import test from 'node:test';

const BASELINE_AT = '2026-11-13T15:49:44.186Z';
const GENERATED_AT = '2026-11-13T16:30:00.000Z';
const source = Object.freeze({ id: 'eurlex', name: 'EUR-Lex', authority: 'official', attributionRequired: true, termsUrl: 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html', rightsReviewExpiresAt: '2027-01-01T00:00:00.000Z' });
const card = (overrides = {}) => Object.freeze({
  id: 'eu:52026PC0313(01)', kind: 'new', feedId: 'eu-commission-proposals', feedKind: 'commission-proposals', feedLabel: 'Commission proposals and related documents',
  celexId: '52026PC0313(01)', title: 'Proposal regarding the European Investigation Order', creator: 'European Commission',
  sourceUrl: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:52026PC0313(01)', source, publishedAt: '2026-11-13T15:20:00.000Z', observedAt: GENERATED_AT,
  baselineAt: BASELINE_AT, previous: null, changedFields: [], stateLabel: 'New official listing', legalCaveat: 'Official listing only.', trust: 'official-source',
  deltaStatus: 'verified-against-release-baseline', aiInterpretation: false, ...overrides,
});
const delta = (cards = [card()], overrides = {}) => Object.freeze({
  version: 'dlkt-info-eu-release-delta-1', product: 'dlkt-info', productVersion: '0.8.8', pack: 'eu-official-change-radar', packVersion: '0.1.1', mode: 'release-baseline-delta',
  baselineVersion: 'dlkt-info-eu-release-baseline-1', baselineAt: BASELINE_AT, baselineHash: 'a'.repeat(64), generatedAt: GENERATED_AT, complete: true, partial: false,
  feeds: [], baselineEntryCount: 200, currentEntryCount: 201, newCount: cards.filter((entry) => entry.kind === 'new').length, changedCount: cards.filter((entry) => entry.kind === 'changed').length,
  unchangedCount: 200, rolledOffIgnoredCount: 0, availableCardCount: cards.length, returnedCardCount: cards.length, truncatedByPayloadBudget: false, cards,
  deltaAvailable: true, baselinePersistence: 'immutable-release-artifact', databaseUsed: false, persistenceUsed: true, databaseChanged: false,
  automaticPublication: false, publicCardsCreated: false, aiInterpretation: false, rolloffResolutionDisabled: true, legalBoundary: 'Official listing boundary.', ...overrides,
});
const live = (overrides = {}) => Object.freeze({
  version: 'dlkt-info-live-official-snapshot-1', product: 'dlkt-info', productVersion: '0.8.8', pack: 'eu-official-change-radar', packVersion: '0.1.1', mode: 'live-read-only',
  generatedAt: GENERATED_AT, complete: true, partial: false, deltaAvailable: false, databaseUsed: false, persistenceUsed: false, databaseChanged: false,
  automaticPublication: false, publicCardsCreated: false, aiInterpretation: false, availableCardCount: 200, returnedCardCount: 200, truncatedByPayloadBudget: false,
  feeds: [{ id: 'a', label: 'A', kind: 'commission-proposals', status: 'available', retrievedAt: GENERATED_AT, channelPublishedAt: GENERATED_AT, bodyHash: 'b'.repeat(64), entryCount: 100, authorizedClaimCount: 100, errorCode: null },
    { id: 'b', label: 'B', kind: 'parliament-council-legislation', status: 'available', retrievedAt: GENERATED_AT, channelPublishedAt: GENERATED_AT, bodyHash: 'c'.repeat(64), entryCount: 100, authorizedClaimCount: 100, errorCode: null }],
  cards: [], boundaries: [], ...overrides,
});
const query = ({ topics = 'regulation', entities = '', max = 6, actionable = '0' } = {}) => `?bridge=companion-v1&topics=${topics}&tz=Europe%2FBucharest&at=08%3A00&max=${max}&min=low&actionable=${actionable}${entities ? `&entities=${encodeURIComponent(entities)}` : ''}&trust=trust-v1&level=confirmed&conflicts=exclude&authority=official&sources=2&age=24&officialHigh=1`;
const sources = (deltaValue, liveValue = live(), errors = {}) => Object.freeze({ checkedAt: GENERATED_AT, baselineAt: BASELINE_AT, baselineHash: 'a'.repeat(64), delta: deltaValue, live: liveValue, deltaError: errors.delta ?? null, liveError: errors.live ?? null });

test('Real Companion projects an official delta card with deterministic inclusion reasons', async () => {
  const { parseRealCompanionDefinition, projectRealCompanion } = await import('../.build/src/real-companion/index.js');
  const snapshot = projectRealCompanion(parseRealCompanionDefinition(query({ entities: 'European Commission', max: 1 })), sources(delta()));
  assert.equal(snapshot.version, 'dlkt-info-real-companion-1');
  assert.equal(snapshot.resultState, 'ready');
  assert.equal(snapshot.sourceState, 'complete');
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0].celexId, '52026PC0313(01)');
  assert.deepEqual(snapshot.cards[0].matchedEntities, ['European Commission']);
  assert.equal(snapshot.cards[0].trustDecision.authoritativeSourceSufficient, true);
  assert.equal(snapshot.cards[0].trustDecision.included, true);
  assert.equal(snapshot.cards[0].materialityAssessment, 'unassessed');
  assert.equal(snapshot.cards[0].materialityFilterApplied, false);
  assert.equal(snapshot.cards[0].aiInterpretation, false);
  assert.equal(Object.prototype.hasOwnProperty.call(snapshot, 'synthetic'), false);
});

test('Real Companion returns truthful caught-up and no-match states without filler', async () => {
  const { parseRealCompanionDefinition, projectRealCompanion } = await import('../.build/src/real-companion/index.js');
  const caughtUp = projectRealCompanion(parseRealCompanionDefinition(query()), sources(delta([], { availableCardCount: 0, newCount: 0, changedCount: 0 })));
  assert.equal(caughtUp.resultState, 'caught-up');
  assert.equal(caughtUp.cards.length, 0);
  assert.match(caughtUp.caughtUpMessage, /Caught up/u);
  const noMatch = projectRealCompanion(parseRealCompanionDefinition(query({ entities: 'Unrelated Entity' })), sources(delta()));
  assert.equal(noMatch.resultState, 'no-match');
  assert.equal(noMatch.cards.length, 0);
  assert.equal(noMatch.counts.entityExcludedCount, 1);
});

test('Real Companion applies topic, card budget and partial source state deterministically', async () => {
  const { parseRealCompanionDefinition, projectRealCompanion } = await import('../.build/src/real-companion/index.js');
  const second = card({ id: 'eu:32026D2535', celexId: '32026D2535', title: 'Decision of the European Parliament and Council', feedId: 'eu-parliament-council-legislation', feedKind: 'parliament-council-legislation', feedLabel: 'Parliament and Council legislation', sourceUrl: 'https://eur-lex.europa.eu/legal-content/AUTO/?uri=CELEX:32026D2535' });
  const limited = projectRealCompanion(parseRealCompanionDefinition(query({ max: 1 })), sources(delta([card(), second]), live({ complete: false, partial: true, feeds: [live().feeds[0], { ...live().feeds[1], status: 'unavailable', entryCount: 0, authorizedClaimCount: 0, errorCode: 'SOURCE_HTTP_ERROR' }] })));
  assert.equal(limited.sourceState, 'partial');
  assert.equal(limited.cards.length, 1);
  assert.equal(limited.counts.eligibleBeforeBudgetCount, 2);
  assert.equal(limited.counts.truncatedByCardBudget, true);
  const wrongTopic = projectRealCompanion(parseRealCompanionDefinition(query({ topics: 'business' })), sources(delta()));
  assert.equal(wrongTopic.resultState, 'no-match');
  assert.equal(wrongTopic.counts.topicExcludedCount, 1);
});

test('Real Companion fails closed when Delta First is unavailable', async () => {
  const { parseRealCompanionDefinition, projectRealCompanion } = await import('../.build/src/real-companion/index.js');
  const snapshot = projectRealCompanion(parseRealCompanionDefinition(query()), sources(null, null, { delta: 'ALL_OFFICIAL_SOURCES_UNAVAILABLE', live: 'ALL_OFFICIAL_SOURCES_UNAVAILABLE' }));
  assert.equal(snapshot.resultState, 'unavailable');
  assert.equal(snapshot.sourceState, 'unavailable');
  assert.equal(snapshot.cards.length, 0);
  assert.equal(snapshot.automaticExecution, false);
  assert.equal(snapshot.publicCardsCreated, false);
});

test('Real Companion source builder shares the two official fetches between Delta and Live', async () => {
  const { buildRealCompanionSources } = await import('../.build/src/real-companion/index.js');
  let fetches = 0;
  const response = '<rss></rss>';
  const builder = async ({ fetchImplementation }) => { await fetchImplementation('https://eur-lex.europa.eu/a'); await fetchImplementation('https://eur-lex.europa.eu/b'); return delta([], { availableCardCount: 0, newCount: 0, changedCount: 0 }); };
  const liveBuilder = async ({ fetchImplementation }) => { await fetchImplementation('https://eur-lex.europa.eu/a'); await fetchImplementation('https://eur-lex.europa.eu/b'); return live(); };
  const result = await buildRealCompanionSources({ buildDelta: builder, buildLive: liveBuilder, fetchImplementation: async () => { fetches += 1; return new Response(response, { status: 200 }); } });
  assert.equal(fetches, 2);
  assert.ok(result.delta);
  assert.ok(result.live);
});

test('Real Companion prefers the operational ledger and does not rebuild the release delta when operational state exists', async () => {
  const { buildRealCompanionSources } = await import('../.build/src/real-companion/index.js');
  let releaseBuilds = 0;
  const operational = Object.freeze({
    ...delta([card({ deltaStatus: 'verified-between-operational-checkpoints' })], {
      version: 'dlkt-info-operational-delta-1', mode: 'operational-consecutive-delta',
      ledgerVersion: 'dlkt-info-operational-delta-ledger-1', ledgerInstanceId: '123e4567-e89b-42d3-a456-426614174000',
      sequence: 2, checkpointHash: 'b'.repeat(64), previousCheckpointHash: 'a'.repeat(64),
      baselineEstablished: false, baselinePersistence: 'private-content-addressed-ledger',
      blobUsed: true, automaticExecution: false,
    }),
  });
  const result = await buildRealCompanionSources({
    readOperational: async () => operational,
    buildDelta: async () => { releaseBuilds += 1; return delta(); },
    buildLive: async () => live(),
    now: () => Date.parse(GENERATED_AT),
  });
  assert.equal(result.deltaMode, 'operational-ledger');
  assert.equal(result.delta, operational);
  assert.equal(releaseBuilds, 0);
  const snapshot = (await import('../.build/src/real-companion/index.js')).projectRealCompanion(
    (await import('../.build/src/real-companion/index.js')).parseRealCompanionDefinition(query()),
    result,
  );
  assert.equal(snapshot.deltaMode, 'operational-ledger');
});
