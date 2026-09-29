let revision = 0;
const listeners = new Set<() => void>();

export function previewCacheRevision() { return revision; }

export function subscribePreviewCache(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function invalidatePreviewCache() {
  revision += 1;
  for (const listener of listeners) listener();
}
