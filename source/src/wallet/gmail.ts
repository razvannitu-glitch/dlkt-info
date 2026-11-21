/** Server-only, read-only integration code. No route activates this adapter in 0.9.43.
 * Contracts verified against Google's primary references on 2026-11-18:
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
 * gmail.metadata cannot use q. We therefore bound INBOX pagination and filter
 * internalDate locally; a truncated scan is explicitly partial.
 */
import {Buffer} from 'node:buffer';
import {isRecord, isUuid} from '../data/guards.js';
import {isWalletMailbox, validatePersonalEvent} from './events.js';
import type {PersonalActor, PersonalEvent} from './events.js';
import type {PersonalSourceReason, PersonalSourceResult} from './daily.js';

export const GMAIL_METADATA_SCOPE = 'https://www.googleapis.com/auth/gmail.metadata';
export const GMAIL_METADATA_HEADERS = Object.freeze(['From', 'Subject', 'Date'] as const);
const API_ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';
const MESSAGE_ID = /^[a-f0-9]{1,64}$/u;
const PAGE_TOKEN = /^[A-Za-z0-9._~+/-]{1,2048}={0,2}$/u;
const DAY_MS = 86_400_000;
const RESPONSE_MAX_BYTES = 65_536;

export interface GmailMetadataOptions {
  /** These three values must come from the same server-verified OAuth grant. */
  readonly ownerId: string;
  readonly connectionId: string;
  readonly accountEmail: string;
  readonly accessToken: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
  readonly maxPages?: number;
  readonly maxMessages?: number;
  readonly pageSize?: number;
  /** Total sync deadline, including streamed response bodies; not a per-message timeout. */
  readonly timeoutMs?: number;
}
export interface GmailMetadataSyncResult {
  readonly source: PersonalSourceResult;
  readonly inspectedMessages: number;
  readonly skippedMessages: number;
  readonly retryAfterSeconds: number | null;
}
type RequestReason = Exclude<PersonalSourceReason, 'limit' | 'not-configured'>;
export class GmailMetadataError extends Error {
  constructor(readonly code: RequestReason, readonly retryAfterSeconds: number | null = null) {
    super(`WALLET_GMAIL_${code.toUpperCase().replaceAll('-', '_')}`);
    this.name = 'GmailMetadataError';
  }
}
function invalid(): never { throw new GmailMetadataError('invalid-response'); }
function integer(value: number, minimum: number, maximum: number): boolean { return Number.isInteger(value) && value >= minimum && value <= maximum; }

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => undefined); throw new GmailMetadataError('timeout'); }
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { signal.removeEventListener('abort', aborted); reject(new GmailMetadataError('timeout')); };
    signal.addEventListener('abort', aborted, {once: true});
    operation.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, () => {
      signal.removeEventListener('abort', aborted);
      reject(new GmailMetadataError(signal.aborted ? 'timeout' : 'network'));
    });
  });
}

async function readJson(response: Response, signal: AbortSignal, maxBytes = RESPONSE_MAX_BYTES): Promise<unknown> {
  const advertised = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '') || (advertised !== null && (!/^\d+$/u.test(advertised) || Number(advertised) > maxBytes))) {
    await response.body?.cancel(); invalid();
  }
  const reader = response.body?.getReader();
  if (!reader) invalid();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) { await reader.cancel(); invalid(); }
      chunks.push(part.value);
    }
  } finally {
    if (signal.aborted) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))) as unknown; } catch { return invalid(); }
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get('retry-after');
  return value !== null && /^\d{1,4}$/u.test(value) && Number(value) <= 3_600 ? Number(value) : null;
}

function isRateError(value: unknown): boolean {
  return isRecord(value) && isRecord(value.error) && Array.isArray(value.error.errors) && value.error.errors.slice(0, 10).some((entry: unknown) => isRecord(entry) && ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(String(entry.reason)));
}

function headerText(value: string, limit: number): string {
  // RFC header folding is data, never an instruction or HTML execution surface.
  const unfolded = value.replace(/\r\n[ \t]+/gu, ' ').trim();
  if (/[\u0000-\u001f\u007f]/u.test(unfolded)) invalid();
  return unfolded.slice(0, limit);
}

function senderActor(from: string | undefined): PersonalActor | null {
  if (!from || from.length > 1_024) return null;
  const text = headerText(from, 1_024);
  let address = text, displayName: string | null = null;
  const match = /^(?:"([^"<>]{1,160})"|([^<>"\r\n]{1,160}))?\s*<([^<>]{1,254})>$/u.exec(text);
  if (match) { address = (match[3] ?? '').trim(); displayName = (match[1] ?? match[2] ?? '').trim() || null; }
  if (!isWalletMailbox(address)) return null;
  // Header addresses are provider-scoped claimed senders, never verified people.
  return {providerId: 'gmail', providerActorId: `email:${address.toLowerCase()}`, displayName, provenance: 'sender-header'};
}

/** Requires a real access token supplied by the future server OAuth/token-vault layer.
 * Construction does not contact Google, persist data, schedule work or enable UI.
 */
export class GmailMetadataAdapter {
  readonly #ownerId: string;
  readonly #connectionId: string;
  readonly #accountEmail: string;
  readonly #accessToken: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;
  readonly #maxPages: number;
  readonly #maxMessages: number;
  readonly #pageSize: number;
  readonly #timeoutMs: number;
  #syncing = false;

  constructor(options: GmailMetadataOptions) {
    if (typeof window !== 'undefined') throw new Error('WALLET_GMAIL_SERVER_ONLY');
    if (!isUuid(options.ownerId) || !isUuid(options.connectionId) || !isWalletMailbox(options.accountEmail) || typeof options.accessToken !== 'string' || !/^[A-Za-z0-9._~+/-]{20,4096}={0,2}$/u.test(options.accessToken)) throw new Error('WALLET_GMAIL_CONFIGURATION_INVALID');
    const maxPages = options.maxPages ?? 3, maxMessages = options.maxMessages ?? 50, pageSize = options.pageSize ?? 20, timeoutMs = options.timeoutMs ?? 10_000;
    if (!integer(maxPages, 1, 3) || !integer(maxMessages, 1, 50) || !integer(pageSize, 1, 50) || !integer(timeoutMs, 100, 20_000)) throw new Error('WALLET_GMAIL_CONFIGURATION_INVALID');
    this.#ownerId = options.ownerId; this.#connectionId = options.connectionId; this.#accountEmail = options.accountEmail.toLowerCase();
    this.#accessToken = options.accessToken; this.#fetch = options.fetchImpl ?? fetch; this.#now = options.now ?? (() => new Date());
    this.#maxPages = maxPages; this.#maxMessages = maxMessages; this.#pageSize = pageSize; this.#timeoutMs = timeoutMs;
  }

  async #request(url: URL, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw new GmailMetadataError('timeout');
    if (url.origin !== 'https://gmail.googleapis.com' || url.href.includes(this.#accessToken)) invalid();
    const response = await abortable(this.#fetch(url, {method: 'GET', headers: {Authorization: `Bearer ${this.#accessToken}`, Accept: 'application/json'}, redirect: 'error', cache: 'no-store', credentials: 'omit', signal}).then(result => {
      if (signal.aborted) { void result.body?.cancel().catch(() => undefined); throw new GmailMetadataError('timeout'); }
      return result;
    }), signal);
    if (response.redirected || (response.url && (new URL(response.url).origin !== url.origin || new URL(response.url).pathname !== url.pathname)) || (response.status >= 300 && response.status < 400)) { await response.body?.cancel(); invalid(); }
    if (response.status === 429) { const retry = retryAfter(response); await response.body?.cancel(); throw new GmailMetadataError('rate-limited', retry); }
    if (response.status === 403) {
      const body = await readJson(response, signal, 8_192);
      throw new GmailMetadataError(isRateError(body) ? 'rate-limited' : 'authorization', retryAfter(response));
    }
    if (!response.ok) { await response.body?.cancel(); throw new GmailMetadataError(response.status === 401 ? 'authorization' : 'upstream'); }
    return readJson(response, signal);
  }

  #event(value: unknown, expectedId: string, expectedThread: string, now: string): PersonalEvent | null {
    if (!isRecord(value) || value.id !== expectedId || value.threadId !== expectedThread || typeof value.internalDate !== 'string' || !/^\d{1,16}$/u.test(value.internalDate) || !isRecord(value.payload) || !Array.isArray(value.payload.headers) || value.payload.headers.length > 16) invalid();
    const timestamp = Number(value.internalDate), observed = Date.parse(now);
    if (!Number.isSafeInteger(timestamp) || timestamp > observed + 60_000 || timestamp < 0) invalid();
    // internalDate is Gmail's received/order timestamp. The sender-controlled Date
    // header does not replace it, even when it contains a much newer/future date.
    const labels: unknown = value.labelIds ?? [];
    if (!Array.isArray(labels) || labels.length > 100 || labels.some((label: unknown) => typeof label !== 'string' || label.length > 128 || /[\u0000-\u001f\u007f]/u.test(label))) invalid();
    const headers = new Map<string, string>();
    for (const entry of value.payload.headers) {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.value !== 'string' || entry.value.length > 8_192) invalid();
      const name = entry.name.toLowerCase();
      if (!['from', 'subject', 'date'].includes(name) || headers.has(name)) invalid();
      headers.set(name, headerText(entry.value, 8_192));
    }
    if (timestamp < observed - DAY_MS || !labels.includes('INBOX')) return null;
    const url = new URL('https://mail.google.com/mail/');
    url.searchParams.set('authuser', this.#accountEmail);
    url.hash = `all/${expectedThread}`;
    try {
      return validatePersonalEvent({ownerId: this.#ownerId, connectionId: this.#connectionId, providerId: 'gmail', providerEventId: expectedId, providerThreadId: expectedThread, kind: 'email.received', occurredAt: new Date(timestamp).toISOString(), observedAt: now, actor: senderActor(headers.get('from')), title: headerText(headers.get('subject') ?? '', 240) || 'Message without a subject', excerpt: null, sourceUrl: url.href, sourceUrlOrigin: 'provider-generated', unread: labels.includes('UNREAD'), importance: labels.includes('IMPORTANT') ? 'source-important' : 'normal', metrics: [], visibility: 'private'}, {ownerId: this.#ownerId, connectionId: this.#connectionId, providerId: 'gmail', now});
    } catch { return invalid(); }
  }

  async sync(): Promise<GmailMetadataSyncResult> {
    if (this.#syncing) throw new Error('WALLET_GMAIL_SYNC_IN_PROGRESS');
    const date = this.#now();
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('WALLET_GMAIL_CONFIGURATION_INVALID');
    const now = date.toISOString(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    this.#syncing = true;
    const events: PersonalEvent[] = [], seen = new Map<string, string>(), tokens = new Set<string>();
    let inspectedMessages = 0, skippedMessages = 0, pageToken: string | null = null, complete = false;
    let reason: PersonalSourceReason | null = null, retryAfterSeconds: number | null = null;
    try {
      for (let page = 0; page < this.#maxPages && seen.size < this.#maxMessages; page += 1) {
        const pageSize = Math.min(this.#pageSize, this.#maxMessages - seen.size);
        const url = new URL(API_ROOT);
        url.searchParams.set('maxResults', String(pageSize));
        url.searchParams.set('labelIds', 'INBOX');
        url.searchParams.set('includeSpamTrash', 'false');
        url.searchParams.set('fields', 'messages(id,threadId),nextPageToken,resultSizeEstimate');
        if (pageToken !== null) url.searchParams.set('pageToken', pageToken);
        const body = await this.#request(url, controller.signal);
        if (!isRecord(body) || !(body.messages === undefined || Array.isArray(body.messages)) || (body.resultSizeEstimate !== undefined && (!Number.isSafeInteger(body.resultSizeEstimate) || typeof body.resultSizeEstimate !== 'number' || body.resultSizeEstimate < 0))) invalid();
        const messages: unknown[] = body.messages ?? [];
        if (messages.length > pageSize) invalid();
        const next = body.nextPageToken;
        if (next !== undefined && (typeof next !== 'string' || !PAGE_TOKEN.test(next) || next.includes(this.#accessToken) || tokens.has(next))) invalid();
        if (typeof next === 'string') tokens.add(next);
        for (const message of messages) {
          if (!isRecord(message) || typeof message.id !== 'string' || !MESSAGE_ID.test(message.id) || typeof message.threadId !== 'string' || !MESSAGE_ID.test(message.threadId)) invalid();
          const previousThread = seen.get(message.id);
          if (previousThread !== undefined) { if (previousThread !== message.threadId) invalid(); continue; }
          seen.set(message.id, message.threadId);
          const detailUrl = new URL(`${API_ROOT}/${message.id}`);
          detailUrl.searchParams.set('format', 'metadata');
          for (const header of GMAIL_METADATA_HEADERS) detailUrl.searchParams.append('metadataHeaders', header);
          detailUrl.searchParams.set('fields', 'id,threadId,labelIds,internalDate,payload(headers)');
          const detail = await this.#request(detailUrl, controller.signal);
          const event = this.#event(detail, message.id, message.threadId, now);
          inspectedMessages += 1;
          if (event) events.push(event); else skippedMessages += 1;
        }
        if (typeof next !== 'string') { complete = true; break; }
        pageToken = next;
      }
      if (!complete) reason = 'limit';
    } catch (error: unknown) {
      reason = error instanceof GmailMetadataError ? error.code : controller.signal.aborted ? 'timeout' : 'network';
      retryAfterSeconds = error instanceof GmailMetadataError ? error.retryAfterSeconds : null;
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.#syncing = false;
    }
    const state = complete && reason === null ? 'success' : reason === 'limit' || events.length > 0 ? 'partial' : 'failed';
    const source: PersonalSourceResult = Object.freeze({ownerId: this.#ownerId, connectionId: this.#connectionId, providerId: 'gmail', state, checkedAt: now, events: Object.freeze(events), reason});
    return Object.freeze({source, inspectedMessages, skippedMessages, retryAfterSeconds});
  }
}
