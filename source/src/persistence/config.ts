import {
  PERSISTENCE_ADAPTER_VERSION,
  type PersistenceConfiguration,
  type PersistenceRuntimeProjection,
  type ReadyPersistenceConfiguration,
} from './contracts.js';

const PROJECT_REF = /^[a-z0-9]{20}$/u;
const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]{20,240}$/u;

type Environment = Readonly<Record<string, string | undefined>>;

const clean = (value: string | undefined): string | undefined => {
  if (value === undefined || value === '') return undefined;
  return value === value.trim() ? value : '__INVALID_WHITESPACE__';
};

type FlagResult = { readonly ok: true; readonly value: boolean } | { readonly ok: false; readonly code: string };

function readFlag(value: string | undefined, code: string): FlagResult {
  const normalized = clean(value);
  if (normalized === undefined || normalized === '0') return { ok: true, value: false };
  if (normalized === '1') return { ok: true, value: true };
  return { ok: false, code };
}

function exactProjectUrl(projectRef: string, value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === `${projectRef}.supabase.co`
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && (url.pathname === '' || url.pathname === '/')
      && url.search === ''
      && url.hash === '';
  } catch {
    return false;
  }
}

export function readPersistenceConfiguration(environment: Environment): PersistenceConfiguration {
  const projectRef = clean(environment.DLKT_INFO_SUPABASE_PROJECT_REF);
  const url = clean(environment.DLKT_INFO_SUPABASE_URL);
  const publishableKey = clean(environment.DLKT_INFO_SUPABASE_PUBLISHABLE_KEY);
  const configuredValues = [projectRef, url, publishableKey].filter((value) => value !== undefined).length;

  if (configuredValues === 0) {
    return Object.freeze({ state: 'missing', code: 'DLKT_INFO_SUPABASE_NOT_CONFIGURED' });
  }
  if (configuredValues !== 3) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SUPABASE_CONFIG_PARTIAL' });
  }
  if (!projectRef || !PROJECT_REF.test(projectRef)) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SUPABASE_PROJECT_REF_INVALID' });
  }
  if (!url || !exactProjectUrl(projectRef, url)) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SUPABASE_URL_PROJECT_MISMATCH' });
  }
  if (!publishableKey || !PUBLISHABLE_KEY.test(publishableKey) || publishableKey.startsWith('sb_secret_')) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_SUPABASE_PUBLISHABLE_KEY_INVALID' });
  }

  const foundationFlag = readFlag(environment.DLKT_INFO_DATA_FOUNDATION_READY, 'DLKT_INFO_FOUNDATION_FLAG_INVALID');
  const authFlag = readFlag(environment.DLKT_INFO_AUTH_ENABLED, 'DLKT_INFO_AUTH_FLAG_INVALID');
  const realDataFlag = readFlag(environment.DLKT_INFO_REAL_DATA_ENABLED, 'DLKT_INFO_REAL_DATA_FLAG_INVALID');
  const acquisitionFlag = readFlag(environment.DLKT_INFO_SOURCE_ACQUISITION_ENABLED, 'DLKT_INFO_ACQUISITION_FLAG_INVALID');
  const workersFlag = readFlag(environment.DLKT_INFO_DELIVERY_WORKERS_ENABLED, 'DLKT_INFO_WORKERS_FLAG_INVALID');
  if (!foundationFlag.ok) return Object.freeze({ state: 'invalid', code: foundationFlag.code });
  if (!authFlag.ok) return Object.freeze({ state: 'invalid', code: authFlag.code });
  if (!realDataFlag.ok) return Object.freeze({ state: 'invalid', code: realDataFlag.code });
  if (!acquisitionFlag.ok) return Object.freeze({ state: 'invalid', code: acquisitionFlag.code });
  if (!workersFlag.ok) return Object.freeze({ state: 'invalid', code: workersFlag.code });
  const foundationReady = foundationFlag.value;
  const authEnabled = authFlag.value;
  const realDataEnabled = realDataFlag.value;
  const sourceAcquisitionEnabled = acquisitionFlag.value;
  const deliveryWorkersEnabled = workersFlag.value;
  if (authEnabled && !foundationReady) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_AUTH_REQUIRES_FOUNDATION' });
  }
  if (realDataEnabled && !foundationReady) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_REAL_DATA_REQUIRES_FOUNDATION' });
  }
  if (sourceAcquisitionEnabled && (!foundationReady || !realDataEnabled)) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_ACQUISITION_REQUIRES_REAL_DATA' });
  }
  if (deliveryWorkersEnabled && (!foundationReady || !realDataEnabled)) {
    return Object.freeze({ state: 'invalid', code: 'DLKT_INFO_WORKERS_REQUIRE_REAL_DATA' });
  }

  return Object.freeze({
    state: 'ready',
    projectRef,
    url,
    publishableKey,
    foundationReady,
    authEnabled,
    realDataEnabled,
    sourceAcquisitionEnabled,
    deliveryWorkersEnabled,
  } satisfies ReadyPersistenceConfiguration);
}

export function persistenceRuntimeProjection(configuration: PersistenceConfiguration): PersistenceRuntimeProjection {
  if (configuration.state === 'missing') {
    return Object.freeze({
      adapterVersion: PERSISTENCE_ADAPTER_VERSION,
      configuration: 'missing',
      configured: false,
      provisioned: false,
      authEnabled: false,
      realDataEnabled: false,
      sourceAcquisitionEnabled: false,
      deliveryWorkersEnabled: false,
      blocker: 'DEDICATED_SUPABASE_PROJECT_REQUIRED',
    });
  }
  if (configuration.state === 'invalid') {
    return Object.freeze({
      adapterVersion: PERSISTENCE_ADAPTER_VERSION,
      configuration: 'invalid',
      configured: false,
      provisioned: false,
      authEnabled: false,
      realDataEnabled: false,
      sourceAcquisitionEnabled: false,
      deliveryWorkersEnabled: false,
      blocker: configuration.code,
    });
  }
  return Object.freeze({
    adapterVersion: PERSISTENCE_ADAPTER_VERSION,
    configuration: 'ready',
    configured: true,
    provisioned: configuration.foundationReady,
    authEnabled: configuration.authEnabled,
    realDataEnabled: configuration.realDataEnabled,
    sourceAcquisitionEnabled: configuration.sourceAcquisitionEnabled,
    deliveryWorkersEnabled: configuration.deliveryWorkersEnabled,
    blocker: configuration.foundationReady ? null : 'DATA_FOUNDATION_NOT_APPLIED',
  });
}
