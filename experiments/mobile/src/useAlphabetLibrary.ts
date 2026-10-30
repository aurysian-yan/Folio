import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alphabetGroups, alphabetPages, alphabetPageSize } from './alphabet-index';
import type { AlphabetEntry, FontFamily, LibraryPage, LibraryQuery } from './library';
import { library } from './native';

interface AlphabetState {
  key: string;
  entries: AlphabetEntry[];
  cards: Map<string, FontFamily>;
  page: LibraryPage;
  loading: boolean;
  failed: boolean;
}
const emptyPage: LibraryPage = { totalMatches: 0, families: [], facets: [], unresolvedScopeItems: 0 };
const emptyState: AlphabetState = { key: '', entries: [], cards: new Map(), page: emptyPage, loading: false, failed: false };

// 完整轻量目录确定滚动范围，详情只读取可见位置附近的分页。
export function useAlphabetLibrary(enabled: boolean, request: LibraryQuery, version: number) {
  const key = JSON.stringify([enabled, request, version]);
  const [state, setState] = useState(emptyState);
  const worker = useRef<{ ensure: (index: number) => void; retry: () => void } | null>(null);
  const anchors = useRef(new Map<string, string>());
  const anchorKey = JSON.stringify(request);
  const anchor = useRef<string | null>(null);
  const visible = state.key === key ? state : { ...emptyState, loading: enabled };
  useEffect(() => {
    if (!enabled) { worker.current = null; return; }
    const [, query] = JSON.parse(key) as [boolean, LibraryQuery, number];
    anchor.current = anchors.current.get(JSON.stringify(query)) ?? null;
    const controller = new AbortController();
    let entries: AlphabetEntry[] = [];
    let wanted: number[] = [];
    let running = false;
    let lastIndex = 0;
    let revision = 0;
    let indexing = true;
    const loaded = new Set<number>();
    const failed = new Set<number>();
    async function drain() {
      if (running) return;
      running = true;
      try {
        while (!controller.signal.aborted) {
          const offset = wanted.find((page) => !loaded.has(page) && !failed.has(page));
          if (offset === undefined) break;
          const expectedRevision = revision;
          try {
            const page = await library.query({ ...query, alphabet: true, offset, limit: alphabetPageSize }, controller.signal);
            if (controller.signal.aborted) return;
            if (expectedRevision !== revision) continue;
            // 库内容变化时拒绝将另一份目录的卡片填入当前位置。
            if (page.totalMatches !== entries.length || page.families.some((family, i) => entries[offset + i]?.id !== family.id)) {
              throw new Error('alphabet-index-changed');
            }
            loaded.add(offset);
            setState((previous) => {
              if (previous.key !== key) return previous;
              const cards = new Map(previous.cards);
              for (const family of page.families) cards.set(family.id, family);
              return { ...previous, cards, page, loading: false, failed: failed.size > 0 };
            });
          } catch {
            if (controller.signal.aborted) return;
            if (expectedRevision !== revision) continue;
            failed.add(offset);
            setState((previous) => previous.key === key ? { ...previous, loading: false, failed: true } : previous);
          }
        }
      } finally { running = false; }
    }
    function ensure(index: number) {
      lastIndex = index;
      if (indexing) return;
      wanted = alphabetPages(index, entries.length);
      void drain();
    }
    async function readIndex() {
      const expectedRevision = ++revision;
      indexing = true; wanted = []; loaded.clear(); failed.clear();
      try {
        const result = await library.alphabetIndex(query, controller.signal);
        if (controller.signal.aborted || expectedRevision !== revision) return;
        entries = result;
        indexing = false;
        const restored = anchor.current ? entries.findIndex((entry) => entry.id === anchor.current) : -1;
        lastIndex = Math.max(0, restored);
        setState({ ...emptyState, key, entries, loading: entries.length > 0,
          page: { ...emptyPage, totalMatches: entries.length } });
        if (entries.length) ensure(lastIndex);
        else {
          const page = await library.query({ ...query, alphabet: true, offset: 0, limit: alphabetPageSize }, controller.signal);
          if (!controller.signal.aborted && expectedRevision === revision) setState({ ...emptyState, key, entries, page });
        }
      } catch {
        if (!controller.signal.aborted && expectedRevision === revision) setState({ ...emptyState, key, failed: true });
      }
    }
    worker.current = { ensure, retry: () => {
      setState((previous) => ({ ...previous, loading: true, failed: false }));
      void readIndex();
    } };
    void readIndex();
    return () => { controller.abort(); worker.current = null; };
  }, [enabled, key]);
  const ensure = useCallback((index: number) => worker.current?.ensure(index), []);
  const retry = useCallback(() => worker.current?.retry(), []);
  const setAnchor = useCallback((id: string) => { anchor.current = id; anchors.current.set(anchorKey, id); }, [anchorKey]);
  const items = useMemo(() => visible.entries.map((entry) => visible.cards.get(entry.id) ?? entry), [visible.entries, visible.cards]);
  const groups = useMemo(() => alphabetGroups(visible.entries), [visible.entries]);
  return { ...visible, items, groups, ensure, retry, anchor, setAnchor };
}
