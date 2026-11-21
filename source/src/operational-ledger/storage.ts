import {
  BlobPreconditionFailedError,
  get as blobGet,
  put as blobPut,
  type GetCommandOptions,
  type PutCommandOptions,
} from '@vercel/blob';
import { createHash } from 'node:crypto';
import type { OperationalLedgerAuth } from './configuration.js';
import type { OperationalLedgerRecord, OperationalLedgerStorage } from './contracts.js';

const MAX_BLOB_BYTES = 1_000_000;

export class OperationalLedgerConflictError extends Error {
  constructor(message = 'OPERATIONAL_LEDGER_CONFLICT') { super(message); }
}

const authOptions = (auth: OperationalLedgerAuth): Pick<PutCommandOptions, 'token' | 'oidcToken' | 'storeId'> =>
  auth.mode === 'oidc'
    ? { oidcToken: auth.oidcToken, storeId: auth.storeId }
    : { token: auth.token };

const readStream = async (stream: ReadableStream<Uint8Array>): Promise<string> => {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_BLOB_BYTES) throw new Error('OPERATIONAL_LEDGER_BLOB_TOO_LARGE');
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

const conflict = (error: unknown): never => {
  if (error instanceof BlobPreconditionFailedError
      || (error instanceof Error && /precondition|already exists|overwrite/iu.test(error.message))) {
    throw new OperationalLedgerConflictError();
  }
  throw error;
};

export class VercelBlobOperationalLedgerStorage implements OperationalLedgerStorage {
  readonly #auth: OperationalLedgerAuth;
  constructor(auth: OperationalLedgerAuth) { this.#auth = auth; }

  async read(pathname: string): Promise<OperationalLedgerRecord | null> {
    const options: GetCommandOptions = {
      access: 'private',
      useCache: false,
      abortSignal: AbortSignal.timeout(8_000),
      ...authOptions(this.#auth),
    };
    const result = await blobGet(pathname, options);
    if (result === null) return null;
    if (result.statusCode !== 200 || result.stream === null || result.blob.size > MAX_BLOB_BYTES) {
      throw new Error('OPERATIONAL_LEDGER_BLOB_READ_INVALID');
    }
    return Object.freeze({ pathname, body: await readStream(result.stream), etag: result.blob.etag });
  }

  async create(pathname: string, body: string): Promise<OperationalLedgerRecord> {
    try {
      const result = await blobPut(pathname, body, {
        access: 'private', addRandomSuffix: false, allowOverwrite: false,
        contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(8_000), ...authOptions(this.#auth),
      });
      return Object.freeze({ pathname, body, etag: result.etag });
    } catch (error) { return conflict(error); }
  }

  async compareAndSwap(pathname: string, body: string, expectedEtag: string): Promise<OperationalLedgerRecord> {
    try {
      const result = await blobPut(pathname, body, {
        access: 'private', addRandomSuffix: false, allowOverwrite: true, ifMatch: expectedEtag,
        contentType: 'application/json; charset=utf-8', cacheControlMaxAge: 60,
        abortSignal: AbortSignal.timeout(8_000), ...authOptions(this.#auth),
      });
      return Object.freeze({ pathname, body, etag: result.etag });
    } catch (error) { return conflict(error); }
  }
}

export class InMemoryOperationalLedgerStorage implements OperationalLedgerStorage {
  readonly #records = new Map<string, OperationalLedgerRecord>();
  readonly #beforeWrite: ((pathname: string) => void) | null;
  constructor(beforeWrite: ((pathname: string) => void) | null = null) { this.#beforeWrite = beforeWrite; }

  async read(pathname: string): Promise<OperationalLedgerRecord | null> {
    const record = this.#records.get(pathname);
    return record ? Object.freeze({ ...record }) : null;
  }

  async create(pathname: string, body: string): Promise<OperationalLedgerRecord> {
    this.#beforeWrite?.(pathname);
    if (this.#records.has(pathname)) throw new OperationalLedgerConflictError();
    return this.#write(pathname, body);
  }

  async compareAndSwap(pathname: string, body: string, expectedEtag: string): Promise<OperationalLedgerRecord> {
    this.#beforeWrite?.(pathname);
    const current = this.#records.get(pathname);
    if (!current || current.etag !== expectedEtag) throw new OperationalLedgerConflictError();
    return this.#write(pathname, body);
  }

  list(): readonly OperationalLedgerRecord[] {
    return Object.freeze([...this.#records.values()].map((record) => Object.freeze({ ...record })));
  }

  #write(pathname: string, body: string): OperationalLedgerRecord {
    const etag = createHash('sha256').update(`${pathname}\0${body}`).digest('hex');
    const record = Object.freeze({ pathname, body, etag });
    this.#records.set(pathname, record);
    return record;
  }
}
