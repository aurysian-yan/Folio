export interface SyncProfile { serverUrl: string; remoteDirectory: string; username: string; automatic: boolean }
// 地址预设与桌面端保持一致，自定义地址仍可直接输入。
export const webdavPresets = [
  { id: 'none', label: 'macos.providerNone', url: '' },
  { id: 'pan123', label: 'macos.provider123', url: 'https://webdav.123pan.cn/webdav' },
  { id: 'jianguoyun', label: 'macos.providerJianguoyun', url: 'https://dav.jianguoyun.com/dav' },
] as const;
export type WebDAVPresetId = typeof webdavPresets[number]['id'];
export function matchingWebdavPreset(serverUrl: string): WebDAVPresetId {
  const normalized = serverUrl.trim().replace(/\/+$/, '').toLowerCase();
  return webdavPresets.find((preset) => preset.url.toLowerCase() === normalized)?.id ?? 'none';
}
export interface CloudFont {
  fingerprint: string; displayName: string; filename: string; fileSize: number;
  cloudOnly: boolean; deleted: boolean; localPath: string | null; localAvailable: boolean; identityIds: string[];
}
export interface SyncStatus {
  phase: string; stage: string; percent: number; stageCompleted: number; stageTotal: number;
  isRunning: boolean; uploadedFiles: number; downloadedFiles: number; uploadedBytes: number; downloadedBytes: number;
  completionGeneration: number; lastSyncedAtMs: number | null; errorMessage: string | null;
  items: { fingerprint: string; action: string; status: string }[];
}
export type SyncResolution = 'keepBoth' | 'useLocal' | 'useRemote';
export type CloudAction = 'cloudOnly' | 'download' | 'delete' | 'restore';
export interface SyncConflict { id: string; kind: string; title: string; detail: string; localFingerprint: string | null; remoteFingerprint: string | null }
export interface SyncState { profile: SyncProfile | null; credentialAvailable: boolean; credentialError: boolean; status: SyncStatus; fonts: CloudFont[]; conflicts: SyncConflict[] }
export interface SyncBridge {
  syncState(): Promise<SyncState>;
  testSyncConnection(profile: SyncProfile, password: string | null): Promise<void>;
  saveSyncConnection(profile: SyncProfile, password: string | null): Promise<void>;
  disconnectSync(): Promise<void>;
  startSync(): Promise<boolean>;
  cancelSync(): Promise<void>;
  cloudFontAction(fingerprint: string, action: CloudAction): Promise<void>;
  resolveSyncConflict(id: string, resolution: SyncResolution): Promise<void>;
}

// 只接受无内嵌凭据的 HTTPS 地址，空密码交由平台安全存储恢复。
export function validateProfile(profile: SyncProfile): SyncProfile {
  let url: URL;
  try { url = new URL(profile.serverUrl.trim()); } catch { throw new Error('ERR_FOLIO_PROFILE'); }
  const remoteDirectory = profile.remoteDirectory.trim();
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.search || url.hash
    || remoteDirectory.split('/').some((part) => part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error('ERR_FOLIO_PROFILE');
  }
  return { ...profile, serverUrl: url.toString(), remoteDirectory, username: profile.username.trim() };
}
export function createSyncClient(bridge: SyncBridge) {
  return {
    state: () => bridge.syncState(),
    test: (profile: SyncProfile, password: string) => bridge.testSyncConnection(validateProfile(profile), password || null),
    save: (profile: SyncProfile, password: string) => bridge.saveSyncConnection(validateProfile(profile), password || null),
    disconnect: () => bridge.disconnectSync(),
    start: () => bridge.startSync(),
    cancel: () => bridge.cancelSync(),
    fontAction: (fingerprint: string, action: CloudAction) => bridge.cloudFontAction(fingerprint, action),
    resolve: (id: string, resolution: SyncResolution) => bridge.resolveSyncConflict(id, resolution),
  };
}

export function syncErrorKey(error: unknown): string {
  const value = error instanceof Error ? error.message : '';
  if (value.includes('认证失败')) return 'mobile.sync.authenticationError';
  if (value.includes('ERR_FOLIO_BUSY')) return 'mobile.sync.busyHint';
  if (value.includes('ERR_FOLIO_PROFILE')) return 'mobile.sync.invalidProfile';
  if (value.includes('ERR_FOLIO_CREDENTIALS')) return 'cloud.passwordUnavailable';
  return 'mobile.sync.operationError';
}
