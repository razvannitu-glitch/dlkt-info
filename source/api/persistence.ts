import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseCompanionPreferences } from '../src/companion/index.js';
import { parseTrustPolicy } from '../src/trust/index.js';
import { isUuid } from '../src/data/guards.js';
import {
  PERSISTENCE_REQUEST_MARKER,
  SupabaseUserRpcTransport,
  readCompanionPersistenceProjection,
  readPersistenceConfiguration,
  type PersistenceFetch,
} from '../src/persistence/index.js';
import { resolveIdentitySession } from '../src/identity/index.js';
import { projectProvisioningControl, type ProvisioningProjection } from '../src/provisioning/index.js';

const MAX_BODY_BYTES = 262_144;
const HOST = /^[a-z0-9.-]+(?::\d+)?$/iu;
const PROTOCOL = /^(?:https|http)$/u;
const BODY_KEYS = new Set([
  'briefingId', 'topics', 'entities', 'timezone', 'deliveryLocalTime',
  'maxCards', 'minMateriality', 'onlyActionable', 'trustPolicy',
]);

const firstHeader = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? '') : (value ?? '').split(',')[0]?.trim() ?? '';

function trustedFetchMetadata(req: IncomingMessage): boolean {
  return firstHeader(req.headers['sec-fetch-site']).toLowerCase() === 'same-origin'
    && ['cors', 'same-origin'].includes(firstHeader(req.headers['sec-fetch-mode']).toLowerCase())
    && firstHeader(req.headers['sec-fetch-dest']).toLowerCase() === 'empty';
}

function isSameOrigin(req: IncomingMessage): boolean {
  const marker = firstHeader(req.headers['x-dlkt-info-request']);
  const host = firstHeader(req.headers['x-forwarded-host']) || firstHeader(req.headers.host);
  const protocol = (firstHeader(req.headers['x-forwarded-proto']) || 'https').toLowerCase();
  if (marker !== PERSISTENCE_REQUEST_MARKER || !HOST.test(host) || !PROTOCOL.test(protocol)) return false;
  const origin = firstHeader(req.headers.origin);
  if (!origin) return trustedFetchMetadata(req);
  try {
    return new URL(origin).origin === `${protocol}://${host}`;
  } catch {
    return false;
  }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  if (size === 0) throw new Error('BODY_EMPTY');
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Origin');
  res.end(JSON.stringify(body));
}

function readSaveInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('BODY_INVALID');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BODY_KEYS.has(key))) throw new Error('BODY_INVALID');
  const briefingId = record.briefingId === null || record.briefingId === undefined
    ? null
    : record.briefingId;
  if (briefingId !== null && !isUuid(briefingId)) throw new Error('BODY_INVALID');
  const preferences = parseCompanionPreferences({
    topics: record.topics,
    entities: record.entities,
    timezone: record.timezone,
    deliveryLocalTime: record.deliveryLocalTime,
    maxCards: record.maxCards,
    minMateriality: record.minMateriality,
    onlyActionable: record.onlyActionable,
  });
  const trustPolicy = parseTrustPolicy(record.trustPolicy);
  return Object.freeze({ briefingId, ...preferences, trustPolicy });
}

function upstreamStatus(error: unknown): { status: number; code: string } {
  const message = error instanceof Error ? error.message : '';
  if (message === 'DLKT_INFO_SUPABASE_RPC_HTTP_401') return { status: 401, code: 'SESSION_INVALID' };
  if (message === 'DLKT_INFO_SUPABASE_RPC_HTTP_403') return { status: 403, code: 'SESSION_FORBIDDEN' };
  if (message.includes('TIMEOUT') || message.includes('Abort')) return { status: 504, code: 'PERSISTENCE_TIMEOUT' };
  return { status: 502, code: 'PERSISTENCE_UPSTREAM_FAILED' };
}

export async function handlePersistenceRequest(
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
    readonly fetch?: PersistenceFetch;
    readonly provisioning?: ProvisioningProjection;
  } = {},
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('Allow', 'GET, PUT');
    respond(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  if (!isSameOrigin(req)) {
    respond(res, 403, { error: 'INVALID_REQUEST_ORIGIN' });
    return;
  }
  const environment = dependencies.environment ?? process.env;
  const configuration = readPersistenceConfiguration(environment);
  const provisioning = dependencies.provisioning ?? await projectProvisioningControl({
    environment,
    fetch: dependencies.fetch ?? fetch,
  });
  if (configuration.state !== 'ready' || !provisioning.capabilities.persistence) {
    const reason = configuration.state === 'missing'
      ? 'DEDICATED_SUPABASE_PROJECT_REQUIRED'
      : configuration.state === 'invalid'
        ? configuration.code
        : provisioning.blocker ?? 'DLKT_INFO_DATABASE_IDENTITY_REQUIRED';
    respond(res, 503, { error: 'PERSISTENCE_NOT_PROVISIONED', reason });
    return;
  }

  let session;
  try {
    session = await resolveIdentitySession(req, res, configuration, dependencies.fetch ?? fetch);
  } catch {
    respond(res, 502, { error: 'IDENTITY_PROVIDER_UNAVAILABLE' });
    return;
  }
  if (!session) {
    respond(res, 401, { error: 'AUTHENTICATION_REQUIRED' });
    return;
  }

  const transport = new SupabaseUserRpcTransport(configuration, dependencies.fetch ?? fetch);
  try {
    if (req.method === 'GET') {
      const projection = readCompanionPersistenceProjection(
        await transport.call('dlkt_info_read_companion_configuration', {}, session.accessToken),
      );
      respond(res, 200, projection);
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(firstHeader(req.headers['content-type']))) {
      respond(res, 415, { error: 'CONTENT_TYPE_REQUIRED' });
      return;
    }
    const input = readSaveInput(await readJson(req));
    const projection = readCompanionPersistenceProjection(await transport.call('dlkt_info_save_companion_configuration', {
      p_briefing_id: input.briefingId,
      p_topics: input.topics,
      p_entities: input.entities,
      p_timezone: input.timezone,
      p_delivery_local_time: input.deliveryLocalTime,
      p_max_cards: input.maxCards,
      p_min_materiality: input.minMateriality,
      p_only_actionable: input.onlyActionable,
      p_minimum_trust: input.trustPolicy.minimumTrust,
      p_conflict_policy: input.trustPolicy.conflictPolicy,
      p_authority_requirement: input.trustPolicy.authorityRequirement,
      p_minimum_sources: input.trustPolicy.minimumSources,
      p_maximum_evidence_age_hours: input.trustPolicy.maximumEvidenceAgeHours,
      p_require_official_for_high_impact: input.trustPolicy.requireOfficialForHighImpact,
    }, session.accessToken));
    respond(res, 200, projection);
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof Error && ['BODY_TOO_LARGE', 'BODY_EMPTY', 'BODY_INVALID', 'COMPANION_INPUT_INVALID', 'COMPANION_INPUT_UNKNOWN_FIELD', 'TRUST_POLICY_INVALID'].includes(error.message))) {
      respond(res, 400, { error: 'INVALID_CONFIGURATION' });
      return;
    }
    const failure = upstreamStatus(error);
    respond(res, failure.status, { error: failure.code });
  }
}

export default async function persistence(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handlePersistenceRequest(req, res);
}
