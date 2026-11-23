import {sha256} from './source-integrity.mjs';

export const PROJECT_ID = 'prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P';
const INSTANCE_HASH = 'dde1fa6adb698002cf3b41d27af1c9f7cac7739cdfeae658b5c249d747facecc';
const PROJECT_REF_HASH = 'c4360dddeb055473b133dcf35896346c765f9e459a5b20e5fd691507eea54059';

/**
 * The production readiness RPC is read-only and idempotent. Retry only
 * transient connectivity failures or temporary HTTP responses. Security,
 * identity, permission, schema and receipt failures are never retried or waived.
 */
const TRANSPORT_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT','ESOCKETTIMEDOUT','ECONNREFUSED',
  'ECONNRESET','ENETUNREACH','EHOSTUNREACH','EAI_AGAIN','ENOTFOUND',
  'CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
/**
 * Safe bounded diagnosis for deployment logs. Never prints URL, credential,
 * original exception text, hostname, connection address or nested cause body.
 */
export function classifyReadinessTransport(error) {
  if (error?.name==='TimeoutError'||error?.name==='AbortError') return 'ABORT_TIMEOUT';
  const pending=[error],visited=new Set();
  for (let inspected=0; pending.length&&inspected<8; inspected++) {
    const entry=pending.shift();
    if (!entry||typeof entry!=='object'||visited.has(entry))continue;
    visited.add(entry);
    const code=typeof entry.code==='string'&&TRANSPORT_CODES.has(entry.code)?entry.code:null;
    if (code)return code;
    if (entry.cause&&typeof entry.cause==='object')pending.push(entry.cause);
    if (entry instanceof AggregateError)pending.push(...entry.errors.slice(0,4));
  }
  return 'UNCLASSIFIED_TRANSPORT';
}

// A transient gateway outage must not silently turn into an unverified release.
// Bounded spaced retries avoid bursts while keeping a hard final failure.
const READINESS_TIMEOUTS_MS = Object.freeze([15_000,20_000,30_000,35_000]);
const RETRY_DELAYS_MS = Object.freeze([0,1_500,4_000,8_000]);
const RETRYABLE_STATUS = new Set([408,429,500,502,503,504]);
const ENDPOINT = /^https:\/\/[a-z0-9-]+\.supabase\.co\/rest\/v1\/rpc\/dlkt_info_read_database_readiness$/u;
export async function requestDatabaseReadiness(request,url,publishableKey,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))) {
  if (typeof request !== 'function' || typeof url !== 'string' || !ENDPOINT.test(url) ||
      typeof publishableKey !== 'string' || !publishableKey.startsWith('sb_publishable_') || typeof sleep !== 'function') {
    throw new Error('BUILD_DATABASE_ATTESTATION_REQUEST_INVALID');
  }
  for (let i=0; i<READINESS_TIMEOUTS_MS.length; i++) {
    if (RETRY_DELAYS_MS[i]>0) await sleep(RETRY_DELAYS_MS[i]);
    let response;
    try {
      response=await request(url,{
        method:'POST',
        headers:{apikey:publishableKey,'Content-Type':'application/json'},
        body:'{}',
        signal:AbortSignal.timeout(READINESS_TIMEOUTS_MS[i]),
        redirect:'error',
        cache:'no-store',
      });
    } catch(error) {
      if (!(error instanceof TypeError) && error?.name!=='TimeoutError' && error?.name!=='AbortError') {
        throw new Error('BUILD_DATABASE_ATTESTATION_TRANSPORT');
      }
      if (i===READINESS_TIMEOUTS_MS.length-1) {
        console.warn('DLKT_DATABASE_READINESS_BLOCKED','TRANSPORT',classifyReadinessTransport(error));
        throw new Error('BUILD_DATABASE_ATTESTATION_UNAVAILABLE');
      }
      console.warn('DLKT_DATABASE_READINESS_RETRY',i+1,'TRANSPORT',classifyReadinessTransport(error));
      continue;
    }
    if (response.ok) return response;
    await response.body?.cancel();
    if (!RETRYABLE_STATUS.has(response.status)) throw new Error('BUILD_DATABASE_ATTESTATION_HTTP');
    if (i===READINESS_TIMEOUTS_MS.length-1) throw new Error('BUILD_DATABASE_ATTESTATION_UNAVAILABLE');
    console.warn('DLKT_DATABASE_READINESS_RETRY',i+1,'TEMPORARY_HTTP');
  }
  throw new Error('BUILD_DATABASE_ATTESTATION_UNAVAILABLE');
}

export async function attestProduction(manifest, env = process.env, request = fetch) {
  if (env.VERCEL !== '1' || env.VERCEL_PROJECT_ID !== PROJECT_ID || env.VERCEL_ENV !== 'production' || !env.VERCEL_OIDC_TOKEN) throw new Error('BUILD_IDENTITY');
  const instanceId = env.DLKT_INFO_DATABASE_INSTANCE_ID ?? '';
  const projectRef = env.DLKT_INFO_SUPABASE_PROJECT_REF ?? '';
  if (sha256(instanceId) !== INSTANCE_HASH || sha256(projectRef) !== PROJECT_REF_HASH) throw new Error('PRODUCTION_IDENTITY_MISMATCH');
  const expected = {
    DLKT_INFO_SUPABASE_URL: `https://${projectRef}.supabase.co`,
    DLKT_INFO_DATA_FOUNDATION_READY: '1', DLKT_INFO_AUTH_ENABLED: '1',
    DLKT_INFO_ACCOUNT_BRIDGE_ENABLED: '1', DLKT_INFO_AUTH_EMAIL_READY: '1',
    DLKT_INFO_REAL_DATA_ENABLED: '0', DLKT_INFO_SOURCE_ACQUISITION_ENABLED: '0', DLKT_INFO_DELIVERY_WORKERS_ENABLED: '0',
  };
  if (Object.entries(expected).some(([key, value]) => env[key] !== value) || !env.DLKT_INFO_SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_')) throw new Error('PRODUCTION_CONFIG_MISMATCH');
  if (env.DLKT_INFO_CONNECTIONS_ORIGIN !== 'https://www.dlkt.ee' || !/^[A-Za-z0-9_-]{43}$/u.test(env.DLKT_INFO_CONNECTIONS_TOKEN_KEY ?? '')) throw new Error('CONNECTION_CONFIG');
  for (const provider of ['GMAIL', 'OUTLOOK', 'INSTAGRAM', 'FACEBOOK_PAGES']) {
    if (env[`DLKT_INFO_${provider}_ENABLED`] === '1' || env[`DLKT_INFO_${provider}_PUBLIC_READY`] === '1') throw new Error('EXTERNAL_PROVIDER_NOT_YET_VERIFIED');
  }
  const response = await requestDatabaseReadiness(request,`${expected.DLKT_INFO_SUPABASE_URL}/rest/v1/rpc/dlkt_info_read_database_readiness`,env.DLKT_INFO_SUPABASE_PUBLISHABLE_KEY);
  let value;
  try { value = await response.json(); } catch { throw new Error('BUILD_DATABASE_ATTESTATION_RESPONSE'); }
  verifyDatabaseReadiness(value, manifest, instanceId);
}
export function verifyDatabaseReadiness(value, manifest, instanceId) {
  const checks = ['rls', 'identity', 'policies', 'triggers', 'functions', 'relations', 'searchPath', 'privateSchema', 'privateTables', 'securityDefiner', 'noUnexpectedObjects', 'publicRpcPermissions', 'publicDataPermissions', 'privateFunctionPermissions'];
  if (value?.ready !== true || value.instanceId !== instanceId || value.version !== 'dlkt-info-database-readiness-2' ||
      value.schemaFingerprint !== manifest.expectedSchemaFingerprint || value.schemaRevision !== manifest.databaseReadinessMigration ||
      value.automaticExecution !== false || value.publicCardsEnabled !== false || checks.some(key => value.checks?.[key] !== true)) throw new Error('BUILD_DATABASE_ATTESTATION_MISMATCH');
  if (value.activationReceipt !== sha256(`${instanceId}:${manifest.expectedSchemaFingerprint}:${manifest.databaseReadinessMigration}`)) throw new Error('BUILD_DATABASE_RECEIPT');
}
