import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const LIVE_ICEO_ORIGIN = 'https://www.dlkt.ee';
export const LIVE_ICEO_PATH = '/api/iceo';
export const LIVE_ICEO_MAX_AGE_MS = 10 * 60_000;
const FUTURE_SKEW_MS = 60_000;
const MAX_BYTES = 1_048_576;
const REQUEST_TIMEOUT_MS = 12_000;

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Read-only public health check. Source-check time and scheduled publication
 * time are separate facts: neither proves all cards were published today.
 * Ten minutes is an operational alert threshold, not the two-minute cadence.
 */
export function assessLiveIceo(sample, now = Date.now()) {
  if (!object(sample) || !object(sample.headers) || !Number.isFinite(now)) {
    throw new Error('DLKT_LIVE_ICEO_INPUT');
  }
  const failures = [];
  const check = (code, pass) => { if (!pass) failures.push(code); };
  const header = key => typeof sample.headers[key] === 'string' ? sample.headers[key] : '';
  const fresh = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
    && Date.parse(value) >= now - LIVE_ICEO_MAX_AGE_MS
    && Date.parse(value) <= now + FUTURE_SKEW_MS;
  let snapshot = null;
  try { snapshot = JSON.parse(sample.body); } catch { /* Block malformed public data. */ }
  const validSnapshot = object(snapshot) && snapshot.version === 'iceo-primary-mesh-1'
    && snapshot.product === 'dlkt-info' && ['ready', 'partial'].includes(snapshot.state)
    && Array.isArray(snapshot.sources) && Array.isArray(snapshot.cards);
  const sources = validSnapshot ? snapshot.sources : [];
  const cards = validSnapshot ? snapshot.cards : [];
  const revision = header('x-iceo-revision');
  const collection = header('x-iceo-collection-state');
  check('http-200', sample.status === 200 && sample.redirected !== true);
  check('json-response', /^application\/json\b/iu.test(header('content-type')) && validSnapshot);
  check('security-headers', header('x-content-type-options').toLowerCase() === 'nosniff'
    && header('set-cookie') === '');
  check('durable-revision', /^[1-9]\d{0,15}$/u.test(revision) && Number.isSafeInteger(Number(revision)));
  check('collection-state', collection === 'ready' || collection === 'refreshing');
  check('fresh-source-check', validSnapshot && fresh(snapshot.generatedAt)
    && header('x-iceo-source-checked-at') === snapshot.generatedAt);
  check('fresh-scheduled-publication', fresh(header('x-iceo-last-scheduled-success-at')));
  check('fresh-durable-readback', fresh(header('x-iceo-refreshed-at')));
  check('publication-order', Date.parse(header('x-iceo-last-scheduled-success-at'))
    >= Date.parse(header('x-iceo-source-checked-at')) - FUTURE_SKEW_MS);
  check('usable-card-catalog', cards.length > 0 && cards.length <= 5000 && sources.length > 0
    && sources.length <= 100 && sources.some(source => object(source)
      && ['verified', 'partial'].includes(source.state)));
  return Object.freeze({
    status: failures.length === 0 ? 'ICEO_LIVE_HEALTHY' : 'ICEO_LIVE_BLOCKED',
    checkedAt: new Date(now).toISOString(),
    revision: /^[1-9]\d{0,15}$/u.test(revision) ? Number(revision) : null,
    snapshotState: validSnapshot ? snapshot.state : null,
    sourceCheckedAt: validSnapshot ? snapshot.generatedAt : null,
    lastScheduledSuccessAt: header('x-iceo-last-scheduled-success-at') || null,
    cardCount: cards.length,
    publicationCount: cards.filter(card => object(card) && card.kind === 'publication').length,
    availableSourceCount: sources.filter(source => object(source)
      && ['verified', 'partial'].includes(source.state)).length,
    sourceCount: sources.length,
    failures: Object.freeze(failures),
  });
}

/**
 * Single credential-free GET, no URL parameters, no redirects or retries.
 * The monitor never invokes the authenticated acquisition route.
 */
export async function collectLiveIceo(fetcher = fetch) {
  const response = await fetcher(LIVE_ICEO_ORIGIN + LIVE_ICEO_PATH, {
    method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store',
    headers: {Accept: 'application/json'},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const names = ['content-type', 'x-content-type-options', 'set-cookie',
    'x-iceo-revision', 'x-iceo-collection-state', 'x-iceo-source-checked-at',
    'x-iceo-last-scheduled-success-at', 'x-iceo-refreshed-at'];
  const headers = Object.fromEntries(names.map(name => [name, response.headers.get(name) ?? '']));
  if (response.status !== 200 || response.redirected) {
    await response.body?.cancel();
    return {status: response.status, redirected: response.redirected, headers, body: ''};
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_BYTES)) {
    await response.body?.cancel();
    throw new Error('DLKT_LIVE_ICEO_RESPONSE_SIZE');
  }
  if (!response.body) throw new Error('DLKT_LIVE_ICEO_RESPONSE_EMPTY');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('DLKT_LIVE_ICEO_RESPONSE_SIZE');
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return {status: response.status, redirected: response.redirected,
    headers, body: Buffer.concat(chunks).toString('utf8')};
}

const invoked = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  try {
    const report = assessLiveIceo(await collectLiveIceo());
    console.log('DLKT_ICEO_LIVE_READ_ONLY ' + JSON.stringify(report));
    if (report.failures.length > 0) process.exitCode = 1;
  } catch (error) {
    const code = error instanceof Error
      && ['DLKT_LIVE_ICEO_RESPONSE_SIZE', 'DLKT_LIVE_ICEO_RESPONSE_EMPTY'].includes(error.message)
      ? error.message : 'DLKT_LIVE_ICEO_UNREACHABLE';
    console.error('DLKT_ICEO_LIVE_BLOCKED ' + code);
    process.exitCode = 1;
  }
}
