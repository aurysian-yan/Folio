import { createLibraryHero as createPresentation } from '../../../shared/library-hero.ts';
import type { LibrarySnapshot } from './library.ts';
import type { SyncState } from './sync.ts';
import i18n from './i18n/instance.ts';

export type { HeroAction, HeroKind, HeroPresentation } from '../../../shared/library-hero.ts';

export function createLibraryHero(snapshot: LibrarySnapshot | null, state: SyncState | null, readError: string | null) {
  return createPresentation({
    snapshot: snapshot ? { ...snapshot, health: snapshot.health ?? {
      damagedFiles: snapshot.damagedCount, multipleRevisions: 0, metadataConflicts: 0,
    } } : null,
    profile: state?.profile ?? null,
    status: state ? { running: state.status.isRunning, percent: state.status.percent, stage: state.status.stage,
      error: state.status.errorMessage, items: state.status.items } : null,
    fonts: state?.fonts ?? [], conflicts: state?.conflicts ?? [],
    cloudLoaded: state !== null || readError !== null, cloudReadError: readError !== null,
  }, (key, values) => i18n.t(key, values));
}
