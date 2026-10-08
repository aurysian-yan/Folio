// 字体位置文案与数据契约由各端复用。
export interface FontLocation {
  state: 'both' | 'cloudOnly' | 'pendingUpload' | 'excluded';
  localAvailable: boolean;
  cloudAvailable: boolean;
  cloudConfirmedAtMs: number | null;
  metadataComplete: boolean;
  files: FontFileLocation[];
}
export interface FontFamilyLocation {
  state: FontLocation['state'] | 'partial';
  localFaceCount: number;
  totalFaceCount: number;
}
export interface FontFileLocation {
  fingerprint: string;
  filename: string;
  fileSize: number;
  faceIndex: number;
  localSources: { path: string; kind: string; previewSource: boolean }[];
  cloudAvailable: boolean;
  uploadExcluded: boolean;
  downloadPolicy: string;
  transferAction: string | null;
  transferStatus: string | null;
  transferError: string | null;
}
export const locationFilters = ['all', 'local', 'cloudOnly', 'both', 'pendingUpload', 'excluded'] as const;
type LocatedFace = { location?: FontLocation; sources?: unknown[]; sourcePath?: string | null };
export function locallyAvailable(face: LocatedFace) { return face.location?.localAvailable ?? !!(face.sourcePath || face.sources?.length); }
export function locationLabel(faces: LocatedFace[], selected: LocatedFace | undefined, t: (key: string, values?: Record<string, number>) => string, family?: FontFamilyLocation) {
  const local = family?.localFaceCount ?? faces.filter(locallyAvailable).length;
  const total = family?.totalFaceCount ?? faces.length;
  if (!selected && local > 0 && local < total) return t('fontLocation.partial', { local, total });
  if (!selected && family) return t(`fontLocation.${family.state}`);
  const face = selected ?? faces.find(locallyAvailable) ?? faces[0];
  return t(`fontLocation.${face?.location?.state ?? 'excluded'}`);
}
export function transferLabel(file: FontFileLocation, t: (key: string) => string) {
  return file.transferStatus && file.transferStatus !== 'done' ? `${t(`fontLocation.${file.transferAction ?? 'download'}`)} · ${t(`fontLocation.transfer.${file.transferStatus}`)}` : '';
}
