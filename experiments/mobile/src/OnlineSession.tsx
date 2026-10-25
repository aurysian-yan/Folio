import { browserId, type BookmarkDraft, type BrowserLibraryRequest, type BrowserLibraryTab } from './browser-data';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { online } from './native';
import type { OnlineState } from './online';

export interface OnlineOpenRequest { id: string; providerId: string; query: string }
interface OnlineSessionValue {
  state: OnlineState | null; invalidate: () => Promise<OnlineState>; refresh: () => Promise<OnlineState>;
  libraryRequest: BrowserLibraryRequest | null; libraryOpen: boolean;
  openLibrary: (tab: BrowserLibraryTab, bookmark?: BookmarkDraft | null) => void;
  closeLibrary: () => void; dismissLibrary: () => void;
  setBrowsing: (active: boolean) => void;
}
const Context = createContext<OnlineSessionValue | null>(null);

// 来源快照与下载轮询全局共用，后台传输仍由原生服务持有。
export function OnlineSessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnlineState | null>(null);
  const [libraryPage, setLibraryPage] = useState<{ request: BrowserLibraryRequest; visible: boolean } | null>(null);
  const libraryOpen = libraryPage?.visible ?? false;
  const openLibrary = useCallback((tab: BrowserLibraryTab, bookmark: BookmarkDraft | null = null) => {
    setLibraryPage({ request: { id: browserId(), tab, bookmark }, visible: true });
  }, []);
  const closeLibrary = useCallback(() => setLibraryPage((value) => value ? { ...value, visible: false } : null), []);
  const dismissLibrary = useCallback(() => setLibraryPage(null), []);
  const [browsing, setBrowsing] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const pending = useRef<Promise<OnlineState> | null>(null);
  const refresh = useCallback(() => {
    if (!pending.current) pending.current = online.state().then((value) => { setState(value); return value; })
      .finally(() => { pending.current = null; });
    return pending.current;
  }, []);
  const invalidate = useCallback(async () => { await pending.current?.catch(() => {}); return refresh(); }, [refresh]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!foreground || (!browsing && !libraryOpen)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh().catch(() => {});
      if (alive) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [foreground, browsing, libraryOpen, refresh]);
  return <Context.Provider value={{ state, refresh, invalidate, libraryRequest: libraryPage?.request ?? null, libraryOpen, openLibrary, closeLibrary, dismissLibrary, setBrowsing }}>{children}</Context.Provider>;
}
export function useOnlineSession() {
  const value = useContext(Context);
  if (!value) throw new Error('OnlineSessionProvider');
  return value;
}
