export type PrivateSnapshotCacheState = 'hit' | 'miss' | 'shared';

export interface PrivateSnapshotCacheResult<T> {
  readonly value: T;
  readonly state: PrivateSnapshotCacheState;
}

export interface PrivateSnapshotCache<T> {
  get(loader: () => Promise<T>, now?: number): Promise<PrivateSnapshotCacheResult<T>>;
  clear(): void;
}

export function createPrivateSnapshotCache<T>(ttlMilliseconds: number): PrivateSnapshotCache<T> {
  if (!Number.isSafeInteger(ttlMilliseconds) || ttlMilliseconds < 1) {
    throw new Error('PRIVATE_SNAPSHOT_CACHE_TTL_INVALID');
  }
  let cached: Readonly<{ value: T; expiresAt: number }> | null = null;
  let pending: Promise<T> | null = null;

  return Object.freeze({
    async get(loader: () => Promise<T>, now = Date.now()): Promise<PrivateSnapshotCacheResult<T>> {
      if (!Number.isFinite(now)) throw new Error('PRIVATE_SNAPSHOT_CACHE_CLOCK_INVALID');
      if (cached && cached.expiresAt > now) return Object.freeze({ value: cached.value, state: 'hit' });
      if (pending) return Object.freeze({ value: await pending, state: 'shared' });
      pending = loader();
      try {
        const value = await pending;
        cached = Object.freeze({ value, expiresAt: now + ttlMilliseconds });
        return Object.freeze({ value, state: 'miss' });
      } finally {
        pending = null;
      }
    },
    clear(): void { cached = null; pending = null; },
  });
}

export const OFFICIAL_API_CACHE_BOUNDARY_VERSION = 'dlkt-info-origin-safe-cache-1' as const;

export const officialApiCacheBoundaryContract = Object.freeze({
  version: OFFICIAL_API_CACHE_BOUNDARY_VERSION,
  responseCache: 'private-no-store' as const,
  serverMemoryCacheSeconds: 900,
  methodValidatedBeforeCache: true,
  queryValidatedBeforeCache: true,
  requestMarkerValidatedBeforeCache: true,
  originValidatedBeforeCache: true,
  etagRevalidation: true,
  intermediaryReuseAllowed: false,
  loaderFailuresCached: false,
  containsCredentials: false,
  containsUserData: false,
});
