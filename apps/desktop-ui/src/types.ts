export interface SourceDto {
  path: string;
  faceIndex: number;
}

export interface FaceDto {
  id: string;
  identityId: string;
  styleName: string;
  postscriptName: string | null;
  format: string;
  isVariable: boolean;
  weight: number | null;
  width: number | null;
  sources: SourceDto[];
}

export interface FamilyDto {
  id: string;
  displayName: string;
  faces: FaceDto[];
  matchedFaceIds: string[];
  isFavorite: boolean;
  isCollectionMember: boolean;
  collectionIds: string[];
  isVariable: boolean;
}

export interface CollectionDto {
  id: string;
  name: string;
  icon: string;
  color: string;
  memberCount: number;
}

export interface SmartFolderDto {
  id: string;
  name: string;
  icon: string;
  color: string;
  queryJson: string;
  queryText: string | null;
  facets: Record<string, string[]>;
  matchCount: number;
}

export interface LibraryPageDto {
  totalMatches: number;
  families: FamilyDto[];
  isLoading: boolean;
  facets: FacetOptionDto[];
}

export interface HealthDto {
  damagedFiles: number;
  duplicateSources: number;
  multipleRevisions: number;
  metadataConflicts: number;
}

export interface LibrarySnapshotDto {
  familyCount: number;
  faceCount: number;
  recentCount: number;
  roots: string[];
  fontStateCounts: Record<string, number>;
  health: HealthDto;
}

export interface FacetOptionDto {
  kind: string;
  value: string;
  label: string;
  familyCount: number;
}

export interface FontPreviewDto {
  faceId: string;
  dataUrl: string | null;
  error: string | null;
}

export interface SyncProfileDto {
  serverUrl: string;
  remoteDirectory: string;
  username: string;
  automatic: boolean;
}

export interface SyncStatusDto {
  configured: boolean;
  running: boolean;
  phase: string;
  stage: string;
  percent: number;
  stageCompleted: number;
  stageTotal: number;
  uploadedFiles: number;
  downloadedFiles: number;
  publishedEvents: number;
  items: SyncItemDto[];
  error: string | null;
}

export interface SyncItemDto {
  fingerprint: string;
  action: "upload" | "download";
  status: "pending" | "running" | "done";
}

export interface CloudFontDto {
  fingerprint: string;
  displayName: string;
  filename: string;
  fileSize: number;
  cloudOnly: boolean;
  deleted: boolean;
  localPath: string | null;
}

export interface SyncConflictDto {
  id: string;
  kind: string;
  title: string;
  detail: string;
  localFingerprint: string | null;
  remoteFingerprint: string | null;
}
