import i18n from "./i18n";
import { createLibraryHero as createPresentation, heroConnectionName as connectionName, type HeroInput as SharedHeroInput } from "../../../shared/library-hero";
import type { CloudFontDto, LibrarySnapshotDto, SyncConflictDto, SyncProfileDto, SyncStatusDto } from "./types";

export type { FontSyncSummary, HeroAction, HeroKind, HeroPresentation, HeroSyncState } from "../../../shared/library-hero";

export interface HeroInput extends SharedHeroInput {
  snapshot: LibrarySnapshotDto | null;
  profile: SyncProfileDto | null;
  status: SyncStatusDto | null;
  fonts: CloudFontDto[];
  conflicts: SyncConflictDto[];
}

export function heroConnectionName(profile: SyncProfileDto): string {
  return connectionName(profile, (key, values) => i18n.t(key, values));
}

export function createLibraryHero(input: HeroInput) {
  return createPresentation(input, (key, values) => i18n.t(key, values));
}
