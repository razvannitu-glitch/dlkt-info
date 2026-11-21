import type {
  CommitModifiedSourceAcquisitionInput,
  CompleteSourceAcquisitionInput,
  CommittedSourceAcquisition,
  SourceAcquisitionReservation,
  SourceAcquisitionState,
} from '../../data/contracts.js';
import type { EuOfficialCheckpoint, EuOfficialFeedDefinition } from './contracts.js';
import { readEuOfficialCheckpoint } from './checkpoint.js';
import { fetchEuOfficialFeed } from './feed.js';
import { prepareEuOfficialFeed } from './runner.js';

export interface EuOfficialAcquisitionPort {
  reserve(input: Readonly<{ sourceKey: string; workerId: string; now: string; leaseSeconds?: number }>): Promise<SourceAcquisitionReservation>;
  complete(input: CompleteSourceAcquisitionInput): Promise<SourceAcquisitionState>;
  commitModified(input: CommitModifiedSourceAcquisitionInput): Promise<CommittedSourceAcquisition>;
}

export interface EuOfficialAcquisitionResult {
  readonly feedId: string;
  readonly sourceKey: string;
  readonly status: 'blocked' | 'modified' | 'not_modified';
  readonly reason: string;
  readonly checkpointVersion: number;
  readonly entryCount: number;
  readonly ingestedClaimCount: number;
  readonly insertedClaimCount: number;
}

const failureCode = (error: unknown): string => {
  if (error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name)) return 'PROVIDER_TIMEOUT';
  const message = error instanceof Error ? error.message : '';
  if (/^EU_RSS_HTTP_/u.test(message)) return 'PROVIDER_HTTP_ERROR';
  if (/BODY|CONTENT_TYPE|XML|DOCUMENT|SHAPE|ITEM|LINK|CELEX|CELLAR|CHANNEL|LANGUAGE/u.test(message)) return 'PROVIDER_PAYLOAD_INVALID';
  if (/CHECKPOINT/u.test(message)) return 'CHECKPOINT_INVALID';
  return 'ACQUISITION_FAILED';
};

export class EuOfficialAcquisitionWorker {
  readonly #port: EuOfficialAcquisitionPort;
  readonly #fetch: typeof fetch;
  readonly #workerId: string;

  constructor(input: Readonly<{ port: EuOfficialAcquisitionPort; workerId: string; fetchImplementation?: typeof fetch }>) {
    this.#port = input.port;
    this.#fetch = input.fetchImplementation ?? fetch;
    this.#workerId = input.workerId;
  }

  async acquire(definition: EuOfficialFeedDefinition, now = Date.now()): Promise<EuOfficialAcquisitionResult> {
    const nowIso = new Date(now).toISOString();
    const reservation = await this.#port.reserve({
      sourceKey: definition.sourceId,
      workerId: this.#workerId,
      now: nowIso,
      leaseSeconds: 120,
    });
    if (!reservation.allowed || !reservation.attemptId) {
      return Object.freeze({
        feedId: definition.id,
        sourceKey: definition.sourceId,
        status: 'blocked',
        reason: reservation.reason,
        checkpointVersion: reservation.checkpointVersion,
        entryCount: reservation.checkpoint && Array.isArray(reservation.checkpoint.entries)
          ? reservation.checkpoint.entries.length : 0,
        ingestedClaimCount: 0,
        insertedClaimCount: 0,
      });
    }

    const previous: EuOfficialCheckpoint | null = reservation.checkpointVersion === 0
      ? null : readEuOfficialCheckpoint(reservation.checkpoint, definition);
    let completionStarted = false;
    try {
      const fetched = await fetchEuOfficialFeed({
        definition,
        previousEtag: reservation.etag,
        previousLastModified: reservation.lastModified,
        fetchImplementation: this.#fetch,
        now: () => now,
      });
      if (fetched.status === 'not-modified' || (previous !== null && fetched.bodyHash === previous.bodyHash)) {
        if (!previous) throw new Error('EU_CHECKPOINT_REQUIRED_FOR_304');
        completionStarted = true;
        const state = await this.#port.complete({
          sourceKey: definition.sourceId,
          attemptId: reservation.attemptId,
          workerId: this.#workerId,
          outcome: 'not_modified',
          checkpointVersion: null,
          checkpoint: null,
          bodyHash: null,
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          errorCode: null,
          now: nowIso,
        });
        return Object.freeze({
          feedId: definition.id,
          sourceKey: definition.sourceId,
          status: 'not_modified',
          reason: 'not_modified',
          checkpointVersion: state.checkpointVersion,
          entryCount: previous.entries.length,
          ingestedClaimCount: 0,
          insertedClaimCount: 0,
        });
      }

      const prepared = prepareEuOfficialFeed({ definition, result: fetched, previousCheckpoint: previous });
      completionStarted = true;
      const state = await this.#port.commitModified({
        sourceKey: definition.sourceId,
        attemptId: reservation.attemptId,
        workerId: this.#workerId,
        checkpointVersion: reservation.checkpointVersion + 1,
        checkpoint: prepared.checkpoint as unknown as Readonly<Record<string, unknown>>,
        bodyHash: prepared.checkpoint.bodyHash,
        etag: prepared.checkpoint.etag,
        lastModified: prepared.checkpoint.lastModified,
        baseline: prepared.baselineEstablished,
        claims: prepared.ingestClaims,
        now: nowIso,
      });
      return Object.freeze({
        feedId: definition.id,
        sourceKey: definition.sourceId,
        status: 'modified',
        reason: prepared.baselineEstablished ? 'baseline-established' : 'checkpoint-advanced',
        checkpointVersion: state.checkpointVersion,
        entryCount: prepared.checkpoint.entries.length,
        ingestedClaimCount: state.claimCount,
        insertedClaimCount: state.insertedClaims,
      });
    } catch (error) {
      if (!completionStarted) {
        try {
          await this.#port.complete({
            sourceKey: definition.sourceId,
            attemptId: reservation.attemptId,
            workerId: this.#workerId,
            outcome: 'failed',
            checkpointVersion: null,
            checkpoint: null,
            bodyHash: null,
            etag: null,
            lastModified: null,
            errorCode: failureCode(error),
            now: nowIso,
          });
        } catch {
          throw new Error('EU_ACQUISITION_COMPLETION_FAILED', { cause: error });
        }
      }
      throw new Error('EU_ACQUISITION_FAILED', { cause: error });
    }
  }
}
