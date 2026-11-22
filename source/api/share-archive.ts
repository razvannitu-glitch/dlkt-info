import type {IncomingMessage, ServerResponse} from 'node:http';
import {bodyJson, noQuery, sameOrigin} from '../src/account/http.js';
import type {IceoSnapshot} from '../src/iceo/contracts.js';
import {publicIceoSnapshot} from '../src/iceo/daily-cache.js';
import {PublicCardError} from '../src/share/current-card.js';
import {validArchiveReference, type ArchiveStore} from '../src/share/archive.js';
import {createArchiveStore} from '../src/share/archive-rest.js';
import {cardPath} from '../src/share/link.js';
import {resolveCurrentCard} from '../src/share/corpus-card.js';
import {createNewsCorpusStore,type NewsCorpusStore} from '../src/iceo/news-corpus-store.js';

const pending = new Map<string, Promise<string>>();

/** Only a reference to server-verified public content is accepted, never client-supplied facts. */
export async function handleShareArchive(
  req: IncomingMessage,
  res: ServerResponse,
  load: () => Promise<IceoSnapshot> = publicIceoSnapshot,
  archive: ArchiveStore | null = createArchiveStore(process.env),
  clock: () => number = Date.now,
  corpus: Pick<NewsCorpusStore,'lookup'> | null = createNewsCorpusStore(process.env),
): Promise<void> {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const send = (status: number, value: unknown): void => {
    res.statusCode = status;
    if (status === 503) res.setHeader('Retry-After', '30');
    res.end(JSON.stringify(value));
  };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(405, {error: 'METHOD_NOT_ALLOWED'}); return; }
  if (!sameOrigin(req, 'share-archive') || !noQuery(req)) { send(403, {error: 'REQUEST_NOT_ALLOWED'}); return; }
  let value: unknown;
  try { value = await bodyJson(req, 256); } catch { send(400, {error: 'REFERENCE_INVALID'}); return; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) { send(400, {error: 'REFERENCE_INVALID'}); return; }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2 || typeof input.id !== 'string' || typeof input.revision !== 'string'
    || !validArchiveReference(input.id, input.revision)) { send(400, {error: 'REFERENCE_INVALID'}); return; }
  if (!archive) { send(503, {error: 'SHARE_ARCHIVE_UNAVAILABLE'}); return; }
  const ref = {id: input.id, revision: input.revision};
  const key = ref.id + ':' + ref.revision;
  let work = pending.get(key);
  if (!work) {
    if (pending.size >= 4) { send(503, {error: 'SHARE_ARCHIVE_BUSY'}); return; }
    work = (async (): Promise<string> => {
      const existing = await archive.read(ref.id, ref.revision);
      if (existing) return cardPath(existing.card);
      if (!archive.writable) throw Error('SHARE_ARCHIVE_UNAVAILABLE');
      const current = await resolveCurrentCard(load, ref, clock, true, corpus);
      const stored = await archive.capture(current, clock());
      return cardPath(stored.card);
    })().finally(() => pending.delete(key));
    pending.set(key, work);
  }
  try { send(200, {state: 'preserved', path: await work}); }
  catch (error) {
    const status = error instanceof PublicCardError ? error.status : 503;
    send(status, {error: status === 410 ? 'CARD_REVISION_CHANGED' : status === 404 ? 'CARD_NOT_FOUND' : 'SHARE_ARCHIVE_UNAVAILABLE'});
  }
}
export default handleShareArchive;
