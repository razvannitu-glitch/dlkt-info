import {readPersistenceConfiguration} from '../persistence/config.js';
import type {PersistenceFetch} from '../persistence/contracts.js';
import {ArchiveError, archiveRecordFromRow, captureArchiveRecord, validArchiveReference, type ArchiveStore, type ArchivedCard} from './archive.js';
import type {CurrentCard} from './current-card.js';

const MAX_RESPONSE_BYTES = 65_536;
const WRITER_KEY = /^[A-Za-z0-9_-]{43,128}$/u;
const SELECT = 'id,revision,card,captured_at,source_check_expires_at,partial';

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok || !(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
    await response.body?.cancel();
    throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  }
  const reader = response.body?.getReader();
  if (reader === undefined) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE'); }
      parts.push(next.value);
    }
    return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}

/** Only server configuration is accepted. Never expose the additional writer key to a browser. */
export function createArchiveStore(environment: Readonly<Record<string,string | undefined>>, fetchImplementation: PersistenceFetch = fetch): ArchiveStore | null {
  const configuration = readPersistenceConfiguration(environment);
  if (configuration.state !== 'ready') return null;
  const supplied = environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY;
  const writerKey = supplied !== undefined && WRITER_KEY.test(supplied) ? supplied : null;
  const base = new URL('/rest/v1/', configuration.url);
  async function request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetchImplementation(new URL(path, base), {...init, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store'});
      return await boundedJson(response);
    } catch { throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE'); }
    finally { clearTimeout(timeout); }
  }
  return Object.freeze({
    writable: writerKey !== null,
    async read(id: string, revision: string | null): Promise<ArchivedCard | null> {
      if (!validArchiveReference(id, revision)) throw new ArchiveError('SHARE_ARCHIVE_INVALID');
      const query = new URLSearchParams({select: SELECT, id: `eq.${id}`, order: 'captured_at.desc,revision.desc', limit: '1'});
      if (revision !== null) query.set('revision', `eq.${revision}`);
      const value = await request(`dlkt_info_shared_cards?${query.toString()}`, {method: 'GET', headers: {apikey: configuration.publishableKey, Accept: 'application/json'}});
      if (!Array.isArray(value) || value.length > 1) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
      if (value.length === 0) return null;
      const record = archiveRecordFromRow(value[0]);
      if (record.card.id !== id || (revision !== null && record.card.contentHash !== revision)) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
      return record;
    },
    async capture(current: CurrentCard, now: number): Promise<ArchivedCard> {
      if (writerKey === null) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
      const record = captureArchiveRecord(current, now);
      const value = await request('rpc/dlkt_info_capture_shared_card', {method: 'POST',
        headers: {apikey: configuration.publishableKey, Accept: 'application/json', 'Content-Type': 'application/json', 'x-dlkt-share-write': writerKey},
        body: JSON.stringify({p_card: record.card, p_captured_at: record.capturedAt, p_source_check_expires_at: record.sourceCheckExpiresAt, p_partial: record.partial})});
      const stored = archiveRecordFromRow(value);
      if (stored.card.id !== record.card.id || stored.card.contentHash !== record.card.contentHash) throw new ArchiveError('SHARE_ARCHIVE_UNAVAILABLE');
      return stored;
    },
  });
}
