import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { syncSession } from './native';
import type { LibrarySnapshot } from './library';

// React 仅订阅单实例调度器，页面切换不创建新的同步任务。
export function useCloudSync(ready: boolean, onSnapshot: (snapshot: LibrarySnapshot) => void) {
  const [view, setView] = useState(syncSession.view);
  useEffect(() => {
    const unsubscribe = syncSession.subscribe((next, snapshot) => {
      setView(next); if (snapshot) onSnapshot(snapshot);
    });
    if (ready) syncSession.setActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (value) => {
      syncSession.setActive(ready && value === 'active');
    });
    return () => { unsubscribe(); subscription.remove(); syncSession.setActive(false); };
  }, [ready, onSnapshot]);
  return { ...view, blocked: syncSession.blocked, refresh: () => syncSession.refresh(),
    run: (action: () => Promise<unknown>, changed = false) => syncSession.run(action, changed),
    requestSync: () => syncSession.requestSync(), start: () => syncSession.start(), cancel: () => syncSession.cancel() };
}
export type CloudSyncController = ReturnType<typeof useCloudSync>;
