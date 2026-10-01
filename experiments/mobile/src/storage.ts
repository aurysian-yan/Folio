// 存储管理使用的原生桥接：用量统计与可重建缓存的清理。
export interface StorageUsage {
  databaseBytes: number;
  managedFontBytes: number;
  volumeTotalBytes: number;
  volumeFreeBytes: number;
  catalogCacheEntries: number;
  catalogCacheEstimatedBytes: number;
}

export interface StorageBridge {
  storageUsage(): Promise<StorageUsage>;
  clearCatalogCache(): Promise<number>;
  previewCacheBytes(): Promise<number>;
  clearPreviewCache(): Promise<number>;
  rebuildSyncIndexes(): Promise<void>;
}

export function createStorageClient(bridge: StorageBridge) {
  return {
    usage: () => bridge.storageUsage(),
    clearCatalogCache: () => bridge.clearCatalogCache(),
    previewBytes: () => bridge.previewCacheBytes(),
    clearPreviewCache: () => bridge.clearPreviewCache(),
    rebuildSyncIndexes: () => bridge.rebuildSyncIndexes(),
  };
}

export type StorageClient = ReturnType<typeof createStorageClient>;
