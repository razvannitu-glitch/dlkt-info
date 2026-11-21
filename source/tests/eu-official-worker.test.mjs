import assert from 'node:assert/strict';
import test from 'node:test';

const NOW = Date.parse('2026-11-11T20:00:00.000Z');
const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
const BATCH_ID = '22222222-2222-4222-8222-222222222222';
const feedBody = (title) => `<?xml version="1.0"?><rss version="2.0"><channel xmlns:dc="http://purl.org/dc/elements/1.1/"><title>4 - Commission proposals and related documents</title><pubDate>Wed, 11 Nov 2026 20:30:00 +0100</pubDate><description>x</description><language>en</language><link>https://eur-lex.europa.eu/homepage.html</link><item><title>CELEX:52026PC0001: ${title}</title><description/><link>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELEX:52026PC0001</link><guid>https://eur-lex.europa.eu/./legal-content/AUTO/?uri=CELLAR:9502bac6-dcf8-11f1-8501-01aa75ed71a1</guid><category>Lex Alerts</category><dc:creator>European Commission</dc:creator></item></channel></rss>`;

const state = (sourceKey, checkpointVersion, checkpoint, bodyHash, overrides = {}) => ({
  sourceKey, checkpointVersion, checkpoint, bodyHash, etag: null, lastModified: null,
  lastAttemptAt: new Date(NOW).toISOString(), lastSuccessAt: new Date(NOW).toISOString(),
  nextEligibleAt: new Date(NOW + 1_800_000).toISOString(), attemptsToday: 1,
  totalAttempts: 1, consecutiveFailures: 0, lastErrorCode: null, ...overrides,
});

const createPort = (sourceKey) => {
  let checkpoint = null;
  let checkpointVersion = 0;
  const commits = [];
  const completions = [];
  return {
    commits,
    completions,
    get checkpoint() { return checkpoint; },
    get checkpointVersion() { return checkpointVersion; },
    reserve: async () => ({
      allowed: true, reason: 'reserved', attemptId: ATTEMPT_ID, sourceKey, attemptNo: 1,
      checkpointVersion, checkpoint, bodyHash: checkpoint?.bodyHash ?? null,
      etag: checkpoint?.etag ?? null, lastModified: checkpoint?.lastModified ?? null,
      leaseExpiresAt: new Date(NOW + 120_000).toISOString(),
    }),
    commitModified: async (input) => {
      commits.push(input);
      checkpoint = input.checkpoint;
      checkpointVersion = input.checkpointVersion;
      return {
        ...state(sourceKey, checkpointVersion, checkpoint, input.bodyHash),
        batchId: BATCH_ID,
        claimCount: input.claims.length,
        insertedClaims: input.claims.length,
        existingClaims: 0,
      };
    },
    complete: async (input) => {
      completions.push(input);
      return state(sourceKey, checkpointVersion, checkpoint, checkpoint?.bodyHash ?? null);
    },
  };
};

test('worker persists a private baseline then appends one changed claim without exposing feed content', async () => {
  const { EU_OFFICIAL_FEEDS, EuOfficialAcquisitionWorker } = await import('../.build/src/packs/eu-official/index.js');
  const definition = EU_OFFICIAL_FEEDS[0];
  const port = createPort(definition.sourceId);
  let body = feedBody('Synthetic first title');
  const worker = new EuOfficialAcquisitionWorker({
    port,
    workerId: 'worker:eu:one',
    fetchImplementation: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } }),
  });

  const baseline = await worker.acquire(definition, NOW);
  assert.deepEqual({ status: baseline.status, reason: baseline.reason, checkpointVersion: baseline.checkpointVersion,
    entryCount: baseline.entryCount, ingestedClaimCount: baseline.ingestedClaimCount, insertedClaimCount: baseline.insertedClaimCount },
  { status: 'modified', reason: 'baseline-established', checkpointVersion: 1, entryCount: 1, ingestedClaimCount: 1, insertedClaimCount: 1 });
  assert.equal(port.commits[0].baseline, true);
  assert.equal(port.commits[0].claims[0].changeKind, 'baseline');
  assert.equal(port.commits[0].claims[0].supersedesExternalKey, null);

  body = feedBody('Synthetic amended title');
  const changed = await worker.acquire(definition, NOW + 1_000);
  assert.equal(changed.status, 'modified');
  assert.equal(changed.reason, 'checkpoint-advanced');
  assert.equal(changed.checkpointVersion, 2);
  assert.equal(changed.ingestedClaimCount, 1);
  assert.equal(port.commits[1].baseline, false);
  assert.equal(port.commits[1].claims[0].changeKind, 'changed');
  assert.match(port.commits[1].claims[0].supersedesExternalKey, /^eu-source-claim:[a-f0-9]{64}$/u);
  assert.doesNotMatch(JSON.stringify(changed), /Synthetic amended title/u);
});

test('worker treats identical 200 and 304 as not modified and writes no claims', async () => {
  const { EU_OFFICIAL_FEEDS, EuOfficialAcquisitionWorker } = await import('../.build/src/packs/eu-official/index.js');
  const definition = EU_OFFICIAL_FEEDS[0];
  const port = createPort(definition.sourceId);
  const body = feedBody('Stable synthetic title');
  const baseline = new EuOfficialAcquisitionWorker({ port, workerId: 'worker:eu:one',
    fetchImplementation: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } }) });
  await baseline.acquire(definition, NOW);

  const identical = new EuOfficialAcquisitionWorker({ port, workerId: 'worker:eu:one',
    fetchImplementation: async () => new Response(body, { status: 200, headers: { 'content-type': 'application/xml' } }) });
  const identicalResult = await identical.acquire(definition, NOW + 1_000);
  assert.equal(identicalResult.status, 'not_modified');
  assert.equal(identicalResult.ingestedClaimCount, 0);

  const cached = new EuOfficialAcquisitionWorker({ port, workerId: 'worker:eu:one',
    fetchImplementation: async () => new Response(null, { status: 304 }) });
  const cachedResult = await cached.acquire(definition, NOW + 2_000);
  assert.equal(cachedResult.status, 'not_modified');
  assert.equal(cachedResult.ingestedClaimCount, 0);
  assert.deepEqual(port.completions.map((input) => input.outcome), ['not_modified', 'not_modified']);
  assert.equal(port.commits.length, 1);
});

test('worker records bounded failures and blocked reservations never fetch', async () => {
  const { EU_OFFICIAL_FEEDS, EuOfficialAcquisitionWorker } = await import('../.build/src/packs/eu-official/index.js');
  const definition = EU_OFFICIAL_FEEDS[0];
  const completions = [];
  let fetched = 0;
  const failedPort = {
    reserve: async () => ({ allowed: true, reason: 'reserved', attemptId: ATTEMPT_ID,
      sourceKey: definition.sourceId, attemptNo: 1, checkpointVersion: 0, checkpoint: null,
      bodyHash: null, etag: null, lastModified: null, leaseExpiresAt: new Date(NOW + 120_000).toISOString() }),
    commitModified: async () => { throw new Error('UNEXPECTED_COMMIT'); },
    complete: async (input) => { completions.push(input); return state(definition.sourceId, 0, null, null); },
  };
  const failed = new EuOfficialAcquisitionWorker({ port: failedPort, workerId: 'worker:eu:one',
    fetchImplementation: async () => { fetched += 1; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); } });
  await assert.rejects(() => failed.acquire(definition, NOW), /EU_ACQUISITION_FAILED/u);
  assert.equal(fetched, 1);
  assert.equal(completions[0].outcome, 'failed');
  assert.equal(completions[0].errorCode, 'PROVIDER_PAYLOAD_INVALID');

  const blocked = new EuOfficialAcquisitionWorker({ port: {
    reserve: async () => ({ allowed: false, reason: 'interval', attemptId: null, sourceKey: definition.sourceId,
      attemptNo: 1, checkpointVersion: 0, checkpoint: null, bodyHash: null, etag: null, lastModified: null, leaseExpiresAt: null }),
    commitModified: async () => { throw new Error('UNEXPECTED_COMMIT'); },
    complete: async () => { throw new Error('UNEXPECTED_COMPLETE'); },
  }, workerId: 'worker:eu:one', fetchImplementation: async () => { fetched += 1; throw new Error('UNEXPECTED_FETCH'); } });
  const result = await blocked.acquire(definition, NOW);
  assert.deepEqual({ status: result.status, reason: result.reason, ingestedClaimCount: result.ingestedClaimCount },
    { status: 'blocked', reason: 'interval', ingestedClaimCount: 0 });
  assert.equal(fetched, 1);
});
