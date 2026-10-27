import { compareVersions, validateManifest, type AppInfo, type Artifact, type ReleaseManifest, type UpdateStatus } from './update.ts';

export type AndroidVariant = 'legacy' | 'glasmio';
export interface AndroidArtifact extends Artifact {
  platform: 'android';
  androidVariant: AndroidVariant;
  minSdk: number;
  maxSdk?: number;
  versionCode: number;
}
export type ReleaseArtifact = Artifact | AndroidArtifact;
export interface ReleaseManifestV2 extends Omit<ReleaseManifest, 'schemaVersion' | 'artifacts'> {
  schemaVersion: 2;
  artifacts: ReleaseArtifact[];
}
export type MobileManifest = ReleaseManifest | ReleaseManifestV2;
export interface MobileUpdateResult {
  status: UpdateStatus | 'variantRequired';
  release?: MobileManifest;
  artifacts?: ReleaseArtifact[];
}

export function requiredAndroidVariant(sdkInt: number): AndroidVariant {
  if (!Number.isInteger(sdkInt) || sdkInt < 30) throw new Error('failed');
  return sdkInt >= 33 ? 'glasmio' : 'legacy';
}

export function androidCompatibilityStatus(app: AppInfo): 'ready' | 'required' {
  if (app.platform !== 'android') return 'ready';
  const required = requiredAndroidVariant(app.sdkInt ?? 0);
  if (!['legacy', 'glasmio'].includes(app.androidVariant ?? '') || !/^\d+$/.test(app.build)) throw new Error('failed');
  if (app.androidVariant === 'glasmio' && required !== 'glasmio') throw new Error('failed');
  return app.androidVariant !== required && app.requiresVariantUpdate !== false ? 'required' : 'ready';
}

export function validateAndroidManifest(input: unknown, expectedVersion?: string): ReleaseManifestV2 {
  if (!input || typeof input !== 'object') throw new Error('failed');
  const value = input as ReleaseManifestV2;
  if (value.schemaVersion !== 2 || !Array.isArray(value.artifacts) || !value.artifacts.length || value.artifacts.length > 32) throw new Error('failed');
  const seen = new Set<string>();
  const builds = new Map<string, number>();
  for (const item of value.artifacts) {
    validateManifest({ ...value, schemaVersion: 1, artifacts: [item] }, expectedVersion);
    let tier = '';
    if (item.platform === 'android') {
      const android = item as AndroidArtifact;
      tier = android.androidVariant;
      if (!['legacy', 'glasmio'].includes(tier) || !Number.isSafeInteger(android.versionCode)
        || android.versionCode <= 0 || android.versionCode > 2_100_000_000
        || android.minSdk !== (tier === 'legacy' ? 30 : 33)
        || (tier === 'legacy' ? android.maxSdk !== 32 : android.maxSdk !== undefined)
        || android.versionCode % 10 !== (tier === 'legacy' ? 1 : 2)) throw new Error('failed');
      const suffix = tier === 'glasmio' ? '-glasmio' : '';
      if (!android.url.endsWith(`/Folio-v${value.version}-android${suffix}-${android.arch}.apk`)) throw new Error('failed');
      const previous = builds.get(tier);
      if (previous !== undefined && previous !== android.versionCode) throw new Error('failed');
      builds.set(tier, android.versionCode);
    }
    const key = `${item.platform}/${item.arch}/${item.format}/${tier}`;
    if (seen.has(key)) throw new Error('failed');
    seen.add(key);
  }
  if (builds.has('legacy') && builds.has('glasmio') && builds.get('glasmio') !== builds.get('legacy')! + 1) throw new Error('failed');
  return value;
}

export function matchingAndroidArtifacts(manifest: ReleaseManifestV2, app: AppInfo): AndroidArtifact[] {
  const required = requiredAndroidVariant(app.sdkInt ?? 0);
  const matches = manifest.artifacts.filter((item): item is AndroidArtifact => item.platform === 'android'
    && item.arch === app.arch && 'androidVariant' in item && item.androidVariant === required
    && app.sdkInt! >= item.minSdk && (item.maxSdk === undefined || app.sdkInt! <= item.maxSdk));
  if (matches.length > 1) throw new Error('failed');
  return matches;
}

export function androidUpdateResult(release: ReleaseManifestV2, app: AppInfo): MobileUpdateResult {
  const artifacts = matchingAndroidArtifacts(release, app);
  const artifact = artifacts[0];
  if (!/^\d+$/.test(app.build)) throw new Error('failed');
  const comparison = compareVersions(release.version, app.version);
  const higherBuild = artifact !== undefined && BigInt(artifact.versionCode) > BigInt(app.build);
  const migration = app.androidVariant === 'legacy' && requiredAndroidVariant(app.sdkInt ?? 0) === 'glasmio';
  const status = comparison < 0 || !artifact ? 'unavailable'
    : migration ? higherBuild ? 'variantRequired' : 'unavailable'
    : comparison > 0 && higherBuild ? 'newVersion' : 'latest';
  return { status, release, artifacts: status === 'newVersion' || status === 'variantRequired' ? artifacts : [] };
}
