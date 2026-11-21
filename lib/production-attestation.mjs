import {sha256} from './source-integrity.mjs';

export const PROJECT_ID = 'prj_3JKAWw8EvzWKNPqFNFxk4iDL2l7P';
const INSTANCE_HASH = 'dde1fa6adb698002cf3b41d27af1c9f7cac7739cdfeae658b5c249d747facecc';
const PROJECT_REF_HASH = 'c4360dddeb055473b133dcf35896346c765f9e459a5b20e5fd691507eea54059';
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
  const response = await request(`${expected.DLKT_INFO_SUPABASE_URL}/rest/v1/rpc/dlkt_info_read_database_readiness`, {
    method: 'POST', headers: {apikey: env.DLKT_INFO_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json'},
    body: '{}', signal: AbortSignal.timeout(15000), redirect: 'error',
  });
  if (!response.ok) throw new Error('BUILD_DATABASE_ATTESTATION_HTTP');
  const value = await response.json();
  verifyDatabaseReadiness(value, manifest, instanceId);
}
export function verifyDatabaseReadiness(value, manifest, instanceId) {
  const checks = ['rls', 'identity', 'policies', 'triggers', 'functions', 'relations', 'searchPath', 'privateSchema', 'privateTables', 'securityDefiner', 'noUnexpectedObjects', 'publicRpcPermissions', 'publicDataPermissions', 'privateFunctionPermissions'];
  if (value?.ready !== true || value.instanceId !== instanceId || value.version !== 'dlkt-info-database-readiness-2' ||
      value.schemaFingerprint !== manifest.expectedSchemaFingerprint || value.schemaRevision !== manifest.databaseReadinessMigration ||
      value.automaticExecution !== false || value.publicCardsEnabled !== false || checks.some(key => value.checks?.[key] !== true)) throw new Error('BUILD_DATABASE_ATTESTATION_MISMATCH');
  if (value.activationReceipt !== sha256(`${instanceId}:${manifest.expectedSchemaFingerprint}:${manifest.databaseReadinessMigration}`)) throw new Error('BUILD_DATABASE_RECEIPT');
}
