import {PROJECT_ID} from './production-attestation.mjs';

// Explicitly requested build-time connection check. Never performs a write,
// exposes an endpoint, enables collection, or prints a provider response.
export async function attestAudienceConnection(env, storage) {
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'production' ||
      env.VERCEL_PROJECT_ID !== PROJECT_ID || !env.VERCEL_OIDC_TOKEN ||
      env.DLKT_INFO_AUDIENCE_CONNECTION_CHECK !== '1') {
    throw new Error('AUDIENCE_ATTESTATION_BUILD_IDENTITY');
  }
  let config;
  try { config = storage.audienceStorageConfig(env); }
  catch { throw new Error('AUDIENCE_ATTESTATION_CONFIG'); }
  if (!config || !/^[A-Za-z0-9_-]{43}$/u.test(env.DLKT_INFO_AUDIENCE_TOKEN_SECRET ?? '') ||
      Buffer.from(env.DLKT_INFO_AUDIENCE_TOKEN_SECRET, 'base64url').toString('base64url') !== env.DLKT_INFO_AUDIENCE_TOKEN_SECRET) {
    throw new Error('AUDIENCE_ATTESTATION_CONFIG');
  }
  try {
    const store = new storage.SupabaseAudienceStore(config);
    if (await store.operationalReady() !== true) throw new Error('NOT_READY');
    // Use the same fixed RPC transport and strict response parser as Control.
    const snapshot = await store.snapshot(24);
    if (snapshot?.version !== 'dlkt-audience-1' || snapshot.retentionDays !== 90) throw new Error('SNAPSHOT');
  } catch {
    // No original errors, credentials, response bodies, or audience counts in logs.
    throw new Error('AUDIENCE_ATTESTATION_READ_FAILED');
  }
}
