import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { emptyBrowserData, readBrowserData, type BrowserData } from './browser-data';

const key = 'folio.mobile.browser.v1';
interface BrowserDataContextValue {
  data: BrowserData; ready: boolean; error: boolean;
  change: (update: (data: BrowserData) => BrowserData) => void; retry: () => void;
}
const BrowserDataContext = createContext<BrowserDataContextValue | null>(null);

// 单实例持有浏览资料，串行写入保证多个入口不会互相覆盖。
export function BrowserDataProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<BrowserData>(emptyBrowserData);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const current = useRef(data);
  const queue = useRef(Promise.resolve());
  const mounted = useRef(false);
  const loaded = useRef(false);
  const load = useCallback(() => {
    void AsyncStorage.getItem(key).then((raw) => {
      const value = readBrowserData(raw);
      if (!mounted.current) return;
      current.current = value; loaded.current = true; setData(value); setReady(true); setError(false);
    }).catch(() => { if (mounted.current) setError(true); });
  }, []);
  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);
  const persist = useCallback((value: BrowserData) => {
    const raw = JSON.stringify(value);
    queue.current = queue.current.catch(() => {}).then(() => AsyncStorage.setItem(key, raw)).then(() => {
      if (mounted.current && current.current === value) setError(false);
    }).catch(() => { if (mounted.current) setError(true); });
  }, []);
  const change = useCallback((update: (data: BrowserData) => BrowserData) => {
    if (!loaded.current) return;
    const next = update(current.current);
    if (next === current.current) return;
    current.current = next; setData(next); persist(next);
  }, [persist]);
  const retry = useCallback(() => { if (loaded.current) persist(current.current); else load(); }, [load, persist]);
  return <BrowserDataContext.Provider value={{ data, ready, error, change, retry }}>{children}</BrowserDataContext.Provider>;
}
export function useBrowserData() {
  const value = useContext(BrowserDataContext);
  if (!value) throw new Error('BrowserDataProvider');
  return value;
}
