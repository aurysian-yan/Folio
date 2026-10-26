import { browserId, type BookmarkDraft, type BrowserLibraryRequest, type BrowserLibraryTab } from './browser-data';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { online } from './native';
import type { OnlineState } from './online';

export interface OnlineOpenRequest { id: string; providerId: string; query: string }
export interface OnlineReviewRequest { id: string; jobId: string }
interface OnlineSessionValue {
  state: OnlineState | null; invalidate: () => Promise<OnlineState>; refresh: () => Promise<OnlineState>;
  libraryRequest: BrowserLibraryRequest | null; libraryOpen: boolean;
  openLibrary: (tab: BrowserLibraryTab, bookmark?: BookmarkDraft | null) => void;
  closeLibrary: () => void; dismissLibrary: () => void;
  setBrowsing: (active: boolean) => void;
  startDownload: (intentId: string) => Promise<void>;
  reviewRequest: OnlineReviewRequest | null; reviewOpen: boolean;
  openReview: (jobId: string) => void; closeReview: () => void; dismissReview: () => void;
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
  const [reviews, setReviews] = useState<(OnlineReviewRequest & { visible: boolean })[]>([]);
  const reviewDismissal = useRef<number | null>(null);
  const watched = useRef(new Set<string>());
  const openReview = useCallback((jobId: string) => {
    setReviews((values) => values.some((item) => item.jobId === jobId) ? values : [...values, { id: browserId(), jobId, visible: true }]);
  }, []);
  const closeReview = useCallback(() => setReviews((values) => values.map((item, index) => index === 0 ? { ...item, visible: false } : item)), []);
  const dismissReview = useCallback(() => {
    if (reviewDismissal.current !== null) return;
    setReviews((values) => values.map((item, index) => index === 0 ? { ...item, visible: false } : item));
    // 完成当前返回后再展示下一项，避免多个下载完成时重用上次转场状态。
    reviewDismissal.current = requestAnimationFrame(() => {
      reviewDismissal.current = null;
      setReviews((values) => values.slice(1));
    });
  }, []);
  useEffect(() => () => { if (reviewDismissal.current !== null) cancelAnimationFrame(reviewDismissal.current); }, []);
  const pending = useRef<Promise<OnlineState> | null>(null);
  const refresh = useCallback(() => {
    if (!pending.current) pending.current = online.state().then((value) => {
      setState(value);
      for (const job of value.jobs) {
        if (['queued', 'transferring', 'paused', 'needsUser', 'failed'].includes(job.state)) watched.current.add(job.id);
        else if (watched.current.delete(job.id) && job.state === 'ready') openReview(job.id);
      }
      return value;
    })
      .finally(() => { pending.current = null; });
    return pending.current;
  }, [openReview]);
  const invalidate = useCallback(async () => { await pending.current?.catch(() => {}); return refresh(); }, [refresh]);
  const startDownload = useCallback(async (intentId: string) => {
    const id = await online.download(intentId);
    watched.current.add(id);
    await invalidate();
  }, [invalidate]);
  const transferring = state?.jobs.some((job) => ['queued', 'transferring'].includes(job.state)) ?? false;
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => setForeground(value === 'active'));
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    if (!foreground || (!browsing && !libraryOpen && !transferring)) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh().catch(() => {});
      if (alive) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [foreground, browsing, libraryOpen, transferring, refresh]);
  return <Context.Provider value={{ state, refresh, invalidate, libraryRequest: libraryPage?.request ?? null, libraryOpen, openLibrary, closeLibrary, dismissLibrary, setBrowsing,
    startDownload, reviewRequest: reviews[0] ?? null, reviewOpen: reviews[0]?.visible ?? false, openReview, closeReview, dismissReview }}>{children}</Context.Provider>;
}
export function useOnlineSession() {
  const value = useContext(Context);
  if (!value) throw new Error('OnlineSessionProvider');
  return value;
}
