import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { library, cloudSync } from './native';
import type { LibrarySnapshot } from './library';
import { syncErrorKey, type SyncState } from './sync';

// 单实例轮询真实 Rust 状态；后台暂停读取，前台恢复时重新读取。
export function useCloudSync(ready: boolean, onSnapshot: (snapshot: LibrarySnapshot) => void) {
  const [state, setState] = useState<SyncState | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionInFlight = useRef(false);
  const generation = useRef<number | null>(null);
  const refresh = useCallback(async () => {
    try {
      const next = await cloudSync.state();
      if (generation.current !== null && next.status.completionGeneration !== generation.current) {
        onSnapshot(await library.snapshot());
      }
      generation.current = next.status.completionGeneration;
      setState(next);
      setReadError(null);
      return next;
    } catch (error) {
      setReadError(syncErrorKey(error) === 'cloud.passwordUnavailable' ? 'cloud.passwordUnavailable' : 'cloud.readStatusError');
      throw error;
    }
  }, [onSnapshot]);
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let reading = false;
    const poll = async () => {
      if (stopped || reading || AppState.currentState !== 'active') return;
      reading = true;
      let running = false;
      try { running = (await refresh()).status.isRunning; } catch { /* 读取错误由页面显示。 */ }
      finally {
        reading = false;
        if (!stopped) timer = setTimeout(() => { void poll(); }, running ? 500 : 5000);
      }
    };
    void poll();
    const subscription = AppState.addEventListener('change', (value) => {
      clearTimeout(timer);
      if (value === 'active') void poll();
    });
    return () => { stopped = true; clearTimeout(timer); subscription.remove(); };
  }, [ready, refresh]);
  async function run(action: () => Promise<unknown>) {
    if (actionInFlight.current) return false;
    actionInFlight.current = true;
    setBusy(true); setActionError(null);
    try { await action(); await refresh(); return true; }
    catch (error) { setActionError(syncErrorKey(error)); return false; }
    finally { actionInFlight.current = false; setBusy(false); }
  }
  return { state, readError, actionError, busy, refresh, run };
}
export type CloudSyncController = ReturnType<typeof useCloudSync>;
