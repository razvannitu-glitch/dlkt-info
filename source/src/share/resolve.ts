import type {IceoSnapshot} from '../iceo/contracts.js';
import type {ArchiveStore, ArchivedCard} from './archive.js';
import type {CardReference} from './link.js';
import {currentCard, type CurrentCard, PublicCardError} from './current-card.js';

export interface SharedResolution {
  readonly current: CurrentCard;
  readonly archived: ArchivedCard | null;
  readonly reason: 'shared-edition' | 'current-unavailable' | null;
}

/** An exact archived link is independently readable when the live source is unavailable. */
export async function resolveShare(
  ref: CardReference,
  load: () => Promise<IceoSnapshot>,
  archive: ArchiveStore | null,
  clock: () => number,
  exactRevision = false,
): Promise<SharedResolution> {
  let storageFailed = false;
  const historical = async (revision: string | null): Promise<ArchivedCard | null> => {
    if (!archive) return null;
    try { return await archive.read(ref.id, revision); }
    catch { storageFailed = true; return null; }
  };
  const fromArchive = (record: ArchivedCard, reason: 'shared-edition' | 'current-unavailable'): SharedResolution => ({
    current: {card: record.card, partial: record.partial, validUntil: Date.parse(record.sourceCheckExpiresAt)},
    archived: record, reason,
  });
  if (ref.revision !== null) {
    const record = await historical(ref.revision);
    if (record) return fromArchive(record, 'shared-edition');
  }
  try {
    return {current: currentCard(await load(), ref, clock(), exactRevision), archived: null, reason: null};
  } catch (error) {
    if (ref.revision === null) {
      const record = await historical(null);
      if (record) return fromArchive(record, 'current-unavailable');
    }
    if (storageFailed) throw new PublicCardError(503, 'CARD_ARCHIVE_UNAVAILABLE');
    throw error;
  }
}
