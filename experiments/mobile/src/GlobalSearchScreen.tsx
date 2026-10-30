import { useNavigationScroll } from './NavigationScroll';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { TextInput } from './UiTextInput';
import { FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MagnifyingGlassIcon, XIcon } from './icons';
import { FontCard } from './FontCard';
import { CollectionsPanel } from './CollectionsPanel';
import { FilterPanel } from './FilterPanel';
import { PanelAction } from './panel-content';
import { library } from './native';
import { NativeScrollContainer } from './native-controls';
import { navigationContentInset } from './bottom-navigation';
import { usePreferences } from './settings';
import { useOnlineSession } from './OnlineSession';
import { useBrowserData } from './BrowserDataProvider';
import { addSearch } from './browser-data';
import { searchCloud, searchProviders, searchSettings, type SearchScope, type SettingsSearchEntry } from './global-search';
import { savedConditions, type FacetOption, type FacetSelection, type FontFamily, type LibraryPage, type LibrarySnapshot, type LibraryTarget } from './library';
import type { OnlineProvider } from './online';
import type { CloudFont } from './sync';
import type { CloudSyncController } from './useCloudSync';
import { formatBytes } from './settings-ui';
import type { Theme } from './ui';

type Row = { id: string } & ({ kind: 'header'; scope: Exclude<SearchScope, 'all'>; count?: number; more: boolean }
  | { kind: 'font'; font: FontFamily } | { kind: 'cloud'; font: CloudFont } | { kind: 'online'; provider: OnlineProvider }
  | { kind: 'setting'; entry: SettingsSearchEntry } | { kind: 'message'; text: string; retry?: () => void });
const emptyPage: LibraryPage = { families: [], totalMatches: 0, facets: [], unresolvedScopeItems: 0 };

// 搜索状态独立于字体库，只有本地范围应用收藏夹和筛选条件。
export function GlobalSearchScreen({ initialError, onRetryInitialize, active, theme, snapshot, libraryVersion, controller, onSnapshotChange, onOpenFont, onOpenCloud, onOpenOnline, onOpenSettings }: {
  initialError: string | null; onRetryInitialize: () => void; active: boolean; theme: Theme; snapshot: LibrarySnapshot | null; libraryVersion: number; controller: CloudSyncController;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void; onOpenFont: (font: FontFamily, target: LibraryTarget) => void;
  onOpenCloud: (font: CloudFont) => void; onOpenOnline: (providerId: string, query: string) => void;
  onOpenSettings: (entry: SettingsSearchEntry) => void;
}) {
  const navigationScroll = useNavigationScroll();
  const { t } = useTranslation();
  const { preferences, ready: preferencesReady } = usePreferences();
  const { state: onlineState, refresh } = useOnlineSession();
  const { data, ready: historyReady, error: historyError, change, retry: retryHistory } = useBrowserData();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const [storedTarget, setTarget] = useState<LibraryTarget>({ scope: 'all' });
  const target: LibraryTarget = useMemo(() => (storedTarget.scope === 'collection' && snapshot && !snapshot.collections.some((item) => item.id === storedTarget.collectionId))
    || (storedTarget.scope === 'smart' && snapshot && !snapshot.smartFolders.some((item) => item.id === storedTarget.smartFolderId)) ? { scope: 'all' } : storedTarget, [storedTarget, snapshot]);
  const [facets, setFacets] = useState<FacetSelection[]>([]);
  const [locationFilter, setLocationFilter] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [providerError, setProviderError] = useState(false);
  type CachedResult = { key: string; request: string; version: number; page: LibraryPage; error: boolean };
  const [results, setResults] = useState<Partial<Record<'all' | 'local', CachedResult>>>({});
  const resultsRef = useRef(results);
  useLayoutEffect(() => { resultsRef.current = results; }, [results]);
  const [offsets, setOffsets] = useState({ all: 0, local: 0 });
  const [options, setOptions] = useState<FacetOption[]>([]);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsFor, setOptionsFor] = useState('');
  const [savedHideSystemFonts, setSavedHideSystemFonts] = useState(false);
  const list = useRef<FlatList<Row>>(null);
  const input = useRef<import('react-native').TextInput>(null);
  const focusedOnce = useRef(false);
  const positions = useRef<Partial<Record<SearchScope, number>>>({});
  const restorePending = useRef(false);
  const inset = useSafeAreaInsets();
  const group = scope === 'all' ? 'all' : 'local';
  const effectiveTarget = scope === 'local' ? target : { scope: 'all' as const };
  const key = JSON.stringify({ ...effectiveTarget, text: query, facets: scope === 'local' ? facets : [], locationFilter: scope === 'local' ? locationFilter : 'all', limit: scope === 'all' ? 3 : 40 });
  const loaded = results[group];
  const page = loaded?.key === key ? loaded.page : emptyPage;
  const offset = offsets[group];
  const requestKey = JSON.stringify([key, libraryVersion, offset, retry]);
  const queryActive = active && !!query && !!text.trim() && !!snapshot && (scope === 'all' || scope === 'local');
  const loading = queryActive && loaded?.request !== requestKey;
  const localError = loaded?.request === requestKey && loaded.error;
  function resetOffset() { setOffsets({ all: 0, local: 0 }); }
  useEffect(() => { const timer = setTimeout(() => setQuery(text.trim().replace(/\s+/g, ' ')), 200); return () => clearTimeout(timer); }, [text]);
  useEffect(() => {
    if (!active) { input.current?.blur(); return; }
    if (preferencesReady && preferences.searchAutoFocus && !focusedOnce.current) { focusedOnce.current = true; input.current?.focus(); }
  }, [active, preferencesReady, preferences.searchAutoFocus]);
  useEffect(() => {
    if (!active) return;
    let alive = true;
    void refresh().then(() => { if (alive) setProviderError(false); }).catch(() => { if (alive) setProviderError(true); });
    return () => { alive = false; };
  }, [active, refresh, retry]);
  useEffect(() => {
    if (!queryActive) return;
    const previous = resultsRef.current[group];
    if (previous?.request === requestKey) return;
    const abort = new AbortController();
    const start = previous?.key === key ? offset : 0;
    const request = JSON.parse(key) as Parameters<typeof library.query>[0];
    const limit = request.limit;
    void (async () => {
      const reload = previous?.key === key && previous.version !== libraryVersion;
      const result = await library.query({ ...request, offset: reload ? 0 : start }, abort.signal);
      if (reload) {
        for (let next = limit; next <= start && next < result.totalMatches; next += limit) {
          const more = await library.query({ ...request, offset: next }, abort.signal); result.families.push(...more.families);
        }
      } else if (start > 0 && previous?.key === key) result.families = Array.from(new Map([...previous.page.families, ...result.families].map((font) => [font.id, font])).values());
      if (!abort.signal.aborted) setResults((value) => ({ ...value, [group]: { key, request: requestKey, version: libraryVersion, page: result, error: false } }));
    })().catch(() => {
      if (!abort.signal.aborted) setResults((value) => ({ ...value, [group]: { key, request: requestKey, version: libraryVersion, page: previous?.key === key ? previous.page : emptyPage, error: true } }));
    });
    return () => abort.abort();
  }, [queryActive, group, key, requestKey, libraryVersion, offset]);
  useEffect(() => {
    if (!active || !filterOpen || !query || scope !== 'local') return;
    const abort = new AbortController();
    void Promise.all([
      library.query({ ...target, text: query, facets: [], offset: 0, limit: 1 }, abort.signal),
      target.scope === 'smart' ? library.getSmartFolder(target.smartFolderId) : Promise.resolve(null),
    ]).then(([value, folder]) => {
      if (!abort.signal.aborted) { setOptionsError(false); setOptionsFor(JSON.stringify([target, query, libraryVersion, retry])); setOptions(value.facets); setSavedHideSystemFonts(!!folder?.query.facets.some((facet) => facet.kind === 'hideSystemFonts' && facet.value === 'true')); }
    }).catch(() => { if (!abort.signal.aborted) setOptionsError(true); });
    return () => abort.abort();
  }, [active, filterOpen, query, scope, target, libraryVersion, retry]);
  useLayoutEffect(() => { restorePending.current = true; list.current?.scrollToOffset({ offset: positions.current[scope] ?? 0, animated: false }); }, [scope]);
  function updateText(value: string) {
    navigationScroll.end(); setText(value); resetOffset(); positions.current = {}; list.current?.scrollToOffset({ offset: 0, animated: false });
  }
  function record() { change((value) => ({ ...value, searches: addSearch(value.searches, text) })); Keyboard.dismiss(); }
  function changeScope(value: SearchScope) { navigationScroll.end(); setScope(value); Keyboard.dismiss(); }
  const clouds = useMemo(() => searchCloud(controller.state?.fonts ?? [], query), [controller.state?.fonts, query]);
  const providers = useMemo(() => searchProviders(onlineState?.providers ?? [], query), [onlineState?.providers, query]);
  const settings = useMemo(() => searchSettings(query, (key) => t(key), Platform.OS), [query, t]);
  const scopeTitle = target.scope === 'collection' ? snapshot?.collections.find((item) => item.id === target.collectionId)?.name
    : target.scope === 'smart' ? snapshot?.smartFolders.find((item) => item.id === target.smartFolderId)?.name
    : t(target.scope === 'favorites' ? 'mobile.starredCollections' : target.scope === 'recent' ? 'macos.recentVisits' : 'mobile.allFonts');
  const rows: Row[] = [];
  const message = (id: string, text: string, retryAction?: () => void) => rows.push({ id, kind: 'message', text, retry: retryAction });
  const retryQuery = () => setRetry((value) => value + 1);
  if (query && text.trim()) {
    if (scope === 'all' || scope === 'local') {
      if (page.totalMatches || scope === 'local') rows.push({ id: 'local', kind: 'header', scope: 'local', count: page.totalMatches, more: scope === 'all' && page.totalMatches > 3 });
      if (!snapshot) message('library-state', initialError ?? t('mobile.loading'), initialError ? onRetryInitialize : undefined);
      else if (localError) message('local-error', t('mobile.errorLibraryRead'), retryQuery);
      else if (loading && !page.families.length) message('local-loading', t('mobile.loading'));
      else if (!page.families.length && scope === 'local') message('local-empty', t('globalSearch.noResults'));
      rows.push(...page.families.map((font): Row => ({ id: `local:${font.id}`, kind: 'font', font })));
    }
    if (scope === 'all' || scope === 'cloud') {
      if (clouds.length || scope === 'cloud') rows.push({ id: 'cloud', kind: 'header', scope: 'cloud', count: clouds.length, more: scope === 'all' && clouds.length > 3 });
      if (controller.readError) message('cloud-error', t(controller.readError), () => { void controller.refresh(); });
      else if (!controller.state) message('cloud-loading', t('mobile.loading'));
      else if (!controller.state.profile) message('cloud-disconnected', t('globalSearch.cloudDisconnected'), () => onOpenSettings({ page: 'sync', titleKey: 'settings.cloud', pageKey: 'settings.cloud', keywords: [] }));
      else if (!controller.state.credentialAvailable) message('cloud-credentials', t('globalSearch.cloudCredentials'), () => onOpenSettings({ page: 'sync', titleKey: 'settings.cloud', pageKey: 'settings.cloud', keywords: [] }));
      if (controller.state?.profile) rows.push(...(scope === 'all' ? clouds.slice(0, 3) : clouds).map((font): Row => ({ id: `cloud:${font.fingerprint}`, kind: 'cloud', font })));
      if (scope === 'cloud' && !clouds.length && controller.state?.profile && !controller.readError) message('cloud-empty', t('globalSearch.noResults'));
    }
    if (scope === 'all' || scope === 'online') {
      if (providers.length || scope === 'online') rows.push({ id: 'online', kind: 'header', scope: 'online', more: scope === 'all' && providers.length > 3 });
      if (providerError) message('providers-error', t('common.operationFailed'), retryQuery);
      else if (!onlineState) message('providers-loading', t('mobile.loading'));
      else if (!providers.length) message('providers-empty', t('browser.noSources'));
      rows.push(...(scope === 'all' ? providers.slice(0, 3) : providers).map((provider): Row => ({ id: `online:${provider.id}`, kind: 'online', provider })));
    }
    if (scope === 'all' || scope === 'settings') {
      if (settings.length || scope === 'settings') rows.push({ id: 'settings', kind: 'header', scope: 'settings', more: scope === 'all' && settings.length > 3 });
      rows.push(...(scope === 'all' ? settings.slice(0, 3) : settings).map((entry): Row => ({ id: `settings:${entry.titleKey}`, kind: 'setting', entry })));
      if (!settings.length && scope === 'settings') message('settings-empty', t('globalSearch.noResults'));
    }
    if (scope === 'all' && snapshot && !loading && !localError && !page.totalMatches && !clouds.length && !settings.length) message('no-fonts', t('globalSearch.noFontsOrSettings'));
  }
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={styles.header}>
      <View style={[styles.search, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]}><MagnifyingGlassIcon size={20} color={theme.secondary} />
        <TextInput ref={input} style={[styles.input, { color: theme.label }]} value={text} onChangeText={updateText} autoCapitalize="none" autoCorrect={false}
          placeholder={t('globalSearch.placeholder')} placeholderTextColor={theme.muted} accessibilityLabel={t('globalSearch.placeholder')} returnKeyType="search" onSubmitEditing={record} />
        {!!text && <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.clearSearch')} onPress={() => { updateText(''); input.current?.focus(); }} style={styles.clear}><XIcon size={20} color={theme.secondary} /></Pressable>}
      </View>
      <View style={styles.scopes} accessibilityRole="tablist">{(['all', 'local', 'cloud', 'online', 'settings'] as const).map((value) => <Pressable accessibilityRole="tab" key={value} accessibilityState={{ selected: scope === value }} onPress={() => changeScope(value)} style={[styles.scope, { backgroundColor: scope === value ? theme.selection : theme.surface }]}>
        <Text style={{ color: scope === value ? theme.accent : theme.label }}>{t(`globalSearch.scope.${value}`)}</Text></Pressable>)}</View>
      {scope === 'local' && <View style={styles.tools}><PanelAction theme={theme} label={scopeTitle ?? t('mobile.allFonts')} onPress={() => { Keyboard.dismiss(); setCollectionsOpen(true); }} />
        <PanelAction theme={theme} label={`${t('library.filterFonts')}${facets.length ? ` (${facets.length})` : ''}`} disabled={!query} onPress={() => { Keyboard.dismiss(); setFilterOpen(true); }} /></View>}
    </View>
    <NativeScrollContainer style={styles.screen} hasHeader={false} onInsetsChange={() => {}}>
    <FlatList ref={list} data={rows} keyExtractor={(item) => item.id} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag"
      contentContainerStyle={[styles.content, { paddingBottom: navigationContentInset(inset.bottom, theme.ui?.material) }]}
      onScrollBeginDrag={({ nativeEvent }) => navigationScroll.begin(nativeEvent.contentOffset.y)} onMomentumScrollEnd={navigationScroll.end} onScrollEndDrag={({ nativeEvent }) => { if (Math.abs(nativeEvent.velocity?.y ?? 0) < 0.05) navigationScroll.end(); }}
      onScroll={({ nativeEvent }) => { positions.current[scope] = nativeEvent.contentOffset.y; navigationScroll.scroll(nativeEvent.contentOffset.y); }} scrollEventThrottle={16}
      onContentSizeChange={() => { if (restorePending.current) { restorePending.current = false; list.current?.scrollToOffset({ offset: positions.current[scope] ?? 0, animated: false }); } }}
      onEndReached={() => { if (scope === 'local' && queryActive && !loading && !localError && loaded?.key === key && page.families.length < page.totalMatches) setOffsets((value) => ({ ...value, local: page.families.length })); }} onEndReachedThreshold={0.4}
      ListEmptyComponent={!text.trim() ? <View style={styles.empty}>
        <Text style={{ color: theme.secondary }}>{t('globalSearch.hint')}</Text>
        {historyError && <><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('browser.saveError')}</Text><PanelAction theme={theme} label={t('common.retry')} onPress={retryHistory} /></>}
        <View style={styles.tools}><Text accessibilityRole="header" style={{ color: theme.label }}>{t('globalSearch.recent')}</Text><PanelAction theme={theme} label={t('globalSearch.clearRecent')} disabled={!historyReady || !data.searches.length} onPress={() => change((value) => ({ ...value, searches: [] }))} /></View>
        {data.searches.map((search) => <PanelAction key={search} theme={theme} label={search} onPress={() => updateText(search)} />)}
      </View> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={theme.accent} /> : null}
      renderItem={({ item }) => {
        switch (item.kind) {
          case 'header': return <View style={styles.section}><Text accessibilityRole="header" accessibilityLiveRegion="polite" style={[styles.heading, { color: theme.label }]}>{t(`globalSearch.scope.${item.scope}`)}{item.count !== undefined ? ` · ${item.count}` : ''}</Text>
            {item.more && <PanelAction theme={theme} label={t('browser.viewAll')} onPress={() => changeScope(item.scope)} />}</View>;
          case 'font': return <FontCard theme={theme} family={item.font} mode="list" onOpen={() => { record(); onOpenFont(item.font, scope === 'local' ? target : { scope: 'all' }); }} />;
          case 'cloud': return <Pressable accessibilityRole="button" style={[styles.result, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]} onPress={() => { record(); onOpenCloud(item.font); }}><Text style={{ color: theme.label }}>{item.font.displayName || item.font.filename}</Text><Text style={{ color: theme.secondary }}>{item.font.filename} · {formatBytes(item.font.fileSize)} · {t(item.font.localAvailable ? 'globalSearch.downloaded' : 'fontLocation.cloudOnly')}</Text></Pressable>;
          case 'online': return <Pressable accessibilityRole="button" style={[styles.result, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]} onPress={() => { record(); onOpenOnline(item.provider.id, query); }}><Text style={{ color: theme.label }}>{t('browser.searchIn', { name: item.provider.name, query })}</Text></Pressable>;
          case 'setting': return <Pressable accessibilityRole="button" style={[styles.result, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]} onPress={() => { record(); onOpenSettings(item.entry); }}><Text style={{ color: theme.label }}>{t(item.entry.titleKey)}</Text><Text style={{ color: theme.secondary }}>{t(item.entry.pageKey)}</Text></Pressable>;
          case 'message': return <View style={styles.result}><Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{item.text}</Text>{item.retry && <PanelAction theme={theme} label={t(item.id.startsWith('cloud-') && item.id !== 'cloud-error' ? 'common.openSettings' : 'common.retry')} onPress={item.retry} />}</View>;
        }
      }} />
    </NativeScrollContainer>
    <FilterPanel visible={filterOpen && active} theme={theme} options={optionsFor === JSON.stringify([target, query, libraryVersion, retry]) ? options : page.facets} counts={page.facets} selected={facets} savedHideSystemFonts={optionsFor === JSON.stringify([target, query, libraryVersion, retry]) && savedHideSystemFonts} loading={loading || (!optionsError && optionsFor !== JSON.stringify([target, query, libraryVersion, retry]))} error={optionsError ? t('mobile.errorFilters') : localError ? t('mobile.errorLibraryRead') : null} totalMatches={page.totalMatches} onChange={(value) => { setFacets(value); resetOffset(); }} onClose={() => setFilterOpen(false)} onRetry={retryQuery} locationFilter={locationFilter} onLocationChange={(value) => { setLocationFilter(value); resetOffset(); }} />
    <CollectionsPanel visible={collectionsOpen && active} theme={theme} target={target} snapshot={snapshot} currentConditions={savedConditions({ text, facets })} libraryVersion={libraryVersion} onSnapshot={onSnapshotChange} onSelect={(value) => { setTarget(value); resetOffset(); }} onClose={() => setCollectionsOpen(false)} />
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, header: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 }, search: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderRadius: 20, gap: 8 },
  input: { flex: 1, minHeight: 44, fontSize: 16 }, clear: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  scopes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, scope: { minHeight: 40, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 16 },
  content: { paddingHorizontal: 16, gap: 8 }, tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  section: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16 }, heading: { fontSize: 18, fontWeight: '600' },
  result: { padding: 12, gap: 4, minHeight: 44, borderRadius: 12 }, empty: { gap: 16, paddingVertical: 16 },
});
