import { getDocumentAsync } from 'expo-document-picker';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  CaretDownIcon, FunnelSimpleIcon, MagnifyingGlassIcon, PlusIcon, XIcon,
} from 'phosphor-react-native';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo, ActivityIndicator, Animated, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
  Text, TextInput, useColorScheme, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CollectionsPanel } from './CollectionsPanel';
import { FilterPanel } from './FilterPanel';
import { PanelAction } from './panel-content';
import { FontCard } from './FontCard';
import { FontDetails } from './FontDetails';
import { FontNavigation } from './FontNavigation';
import { ImportResults } from './ImportResults';
import { ViewModeMenu } from './ViewModeMenu';
import { AndroidHeaderBackdrop, AndroidHeaderControls } from './HeaderControls';
import { BottomNavigation, NavigationBackdrop, navigationContentInset, type MobileTab } from './bottom-navigation';
import { LibraryError, summarizeImport, targetKey, type FacetOption, type FacetSelection, type FontFamily, type ImportReport, type LibraryPage, type LibrarySnapshot, type LibraryTarget } from './library';
import { library } from './native';
import {
  NativeActionButton, NativeHeaderControls, NativeLibraryContent, NativeNavigation, NativeScrollContainer,
  usesNativeControls, usesNativeSidebar, type NativeDestination,
} from './native-controls';
import { PreferencesProvider, usePreferences } from './settings';
import { SettingsAboutPage } from './SettingsAboutPage';
import { SettingsAppearancePage } from './SettingsAppearancePage';
import { SettingsCardsPage } from './SettingsCardsPage';
import { SettingsImportPage } from './SettingsImportPage';
import { SettingsScreen, type SettingsPageId } from './SettingsScreen';
import { SettingsStoragePage } from './SettingsStoragePage';
import { createTheme, IconButton, type Theme } from './ui';

const pageSize = 40;
const emptyPage: LibraryPage = { totalMatches: 0, families: [], facets: [], unresolvedScopeItems: 0 };
const emptyBrowse = { searchText: '', searchOpen: false, facets: [] as FacetSelection[] };
const LibraryList = Platform.OS === 'android' ? Animated.FlatList<FontFamily> : FlatList<FontFamily>;

function LibraryScreen({ theme, bottomInset, active, sourceId = '', sidebar = false, target, destination = 'local',
  snapshot, libraryVersion, initialError, defaultMode, preferencesReady, showImportResults,
  onSnapshotChange, onRetryInitialize, onTargetChange, onOpenFamily }: {
  theme: Theme;
  bottomInset: number;
  active: boolean;
  sourceId?: string;
  sidebar?: boolean;
  target: LibraryTarget;
  destination?: NativeDestination;
  snapshot: LibrarySnapshot | null;
  libraryVersion: number;
  initialError: string | null;
  defaultMode: 'grid' | 'list';
  preferencesReady: boolean;
  showImportResults: boolean;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void;
  onRetryInitialize: () => void;
  onTargetChange: (target: LibraryTarget) => void;
  onOpenFamily: (family: FontFamily) => void;
}) {
  const { t } = useTranslation();
  const { scope } = target;
  const collectionId = target.scope === 'collection' ? target.collectionId : undefined;
  const scopeKey = targetKey(target);
  const ready = snapshot !== null;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [browseStates, setBrowseStates] = useState<Record<string, typeof emptyBrowse>>({});
  const browse = browseStates[scopeKey] ?? emptyBrowse;
  const { searchText, searchOpen, facets: selectedFacets } = browse;
  const updateBrowse = (change: Partial<typeof emptyBrowse>) => setBrowseStates((previous) => ({
    ...previous, [scopeKey]: { ...(previous[scopeKey] ?? emptyBrowse), ...change },
  }));
  const setSearchText = (value: string) => updateBrowse({ searchText: value });
  const setSearchOpen = (value: boolean) => updateBrowse({ searchOpen: value });
  const [filterOpen, setFilterOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [facetOptions, setFacetOptions] = useState<{ key: string; options: FacetOption[] }>({ key: '', options: [] });
  const [facetFailure, setFacetFailure] = useState<{ key: string; message: string } | null>(null);
  const [brandOpacity] = useState(() => new Animated.Value(1));
  const [headerScrollOffset] = useState(() => new Animated.Value(0));
  const [debouncedSearch, setDebouncedSearch] = useState({ key: scopeKey, text: '' });
  const queryText = debouncedSearch.key === scopeKey ? debouncedSearch.text : searchText.trim();
  const [pagination, setPagination] = useState({ key: '', offset: 0 });
  const [loadedQuery, setLoadedQuery] = useState({ key: '', request: '', version: -1, page: emptyPage });
  const loadedQueryRef = useRef(loadedQuery);
  useEffect(() => { loadedQueryRef.current = loadedQuery; }, [loadedQuery]);
  const [importing, setImporting] = useState(false);
  const importInFlight = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importDetailsOpen, setImportDetailsOpen] = useState(false);
  const [mode, setMode] = useState<'grid' | 'list'>(defaultMode);
  const modeInitialized = useRef(false);
  const searchInput = useRef<TextInput>(null);
  const list = useRef<FlatList<FontFamily>>(null);
  const inset = useSafeAreaInsets();
  const [nativeInsets, setNativeInsets] = useState<{ top: number; bottom: number; contentTop?: number }>({
    top: sidebar ? 0 : inset.top, bottom: 0,
  });
  const [headerHeight, setHeaderHeight] = useState(64);
  const { width: windowWidth } = useWindowDimensions();
  const [contentWidth, setContentWidth] = useState(0);
  const width = contentWidth || windowWidth - inset.left - inset.right;
  const scrollTopInset = Math.max(nativeInsets.contentTop ?? 0, nativeInsets.top + (sidebar ? 0 : headerHeight * 1.25));
  const androidContentTop = inset.top + headerHeight;
  const reservesWindowControls = usesNativeSidebar && !sidebar && Number(Platform.Version) >= 26;
  const queryKey = JSON.stringify([scope, collectionId, queryText, selectedFacets, retry]);
  const offset = pagination.key === queryKey && loadedQuery.key === queryKey ? pagination.offset : 0;
  const requestKey = JSON.stringify([queryKey, offset, libraryVersion]);
  const optionsKey = JSON.stringify([scopeKey, queryText, libraryVersion, retry]);
  const facetError = facetFailure?.key === optionsKey ? facetFailure.message : null;
  const optionsLoading = ready && facetOptions.key !== optionsKey && !facetError;
  const shownError = initialError ?? error;
  const hasConditions = !!queryText || selectedFacets.length > 0;
  const scopeTitle = scope === 'collection' ? snapshot?.collections.find((item) => item.id === collectionId)?.name ?? t('collection.collection')
    : scope === 'favorites' ? t('mobile.starredCollections') : scope === 'recent' ? t('mobile.recentTitle') : t('mobile.allFonts');
  const loading = ready && loadedQuery.request !== requestKey;
  const page = loadedQuery.key === queryKey ? loadedQuery.page : emptyPage;
  const waitingForSearch = searchText.trim() !== queryText;
  const importCounts = importReport ? summarizeImport(importReport.items) : null;

  useEffect(() => {
    if (Platform.OS === 'android') headerScrollOffset.setValue(0);
  }, [headerScrollOffset, mode]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    let mounted = true;
    let transition: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!mounted) return;
      transition = Animated.timing(brandOpacity, { toValue: searchOpen ? 0 : 1,
        duration: reduced ? 0 : 180, useNativeDriver: true });
      transition.start();
    });
    return () => { mounted = false; transition?.stop(); };
  }, [brandOpacity, searchOpen]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch({ key: scopeKey, text: searchText.trim() }), 180);
    return () => clearTimeout(timer);
  }, [searchText, scopeKey]);

  useEffect(() => {
    list.current?.scrollToOffset({ offset: 0, animated: false });
  }, [queryKey]);

  // 本地偏好读取完成后应用一次默认视图，之后不再覆盖用户的手动切换。
  useEffect(() => {
    if (modeInitialized.current || !preferencesReady) return;
    modeInitialized.current = true;
    setMode(defaultMode);
  }, [defaultMode, preferencesReady]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const queryTarget: LibraryTarget = collectionId ? { scope: 'collection', collectionId }
      : { scope: scope as 'all' | 'favorites' | 'recent' };
    library.query({ ...queryTarget, text: queryText, facets: [], offset: 0, limit: 1 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFacetOptions({ key: optionsKey, options: result.facets });
      }).catch(() => {
        if (!controller.signal.aborted) setFacetFailure({ key: optionsKey, message: t('mobile.errorFilters') });
      });
    return () => controller.abort();
  }, [ready, scope, collectionId, queryText, optionsKey, t]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const queryTarget: LibraryTarget = collectionId ? { scope: 'collection', collectionId }
      : { scope: scope as 'all' | 'favorites' | 'recent' };
    const previous = loadedQueryRef.current;
    const reloading = previous.key === queryKey && previous.version !== libraryVersion;
    async function readPage() {
      const request = { ...queryTarget, text: queryText, facets: selectedFacets, limit: pageSize };
      const result = await library.query({ ...request, offset: reloading ? 0 : offset }, controller.signal);
      // 用户状态变化后重读已加载窗口，保留详情返回时的浏览位置。
      if (reloading) {
        for (let start = pageSize; start <= offset && start < result.totalMatches; start += pageSize) {
          const next = await library.query({ ...request, offset: start }, controller.signal);
          result.families.push(...next.families);
        }
      }
      return result;
    }
    readPage().then((result) => {
      if (controller.signal.aborted) return;
      if (previous.key !== queryKey) setPagination({ key: queryKey, offset: 0 });
      setLoadedQuery((previous) => {
        const families = offset > 0 && !reloading && previous.key === queryKey
          ? Array.from(new Map([...previous.page.families, ...result.families].map((family) => [family.id, family])).values())
          : result.families;
        return { key: queryKey, request: requestKey, version: libraryVersion, page: { ...result, families } };
      });
      setError(null);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && !(cause instanceof LibraryError && cause.code === 'cancelled')) {
        setError(t('mobile.errorLibraryRead'));
        setLoadedQuery((previous) => ({ key: queryKey, request: requestKey, version: previous.version,
          page: previous.key === queryKey ? previous.page : emptyPage }));
      }
    });
    return () => controller.abort();
  }, [ready, queryText, scope, collectionId, selectedFacets, offset, queryKey, requestKey, libraryVersion, t]);

  async function importFont() {
    if (!ready || importInFlight.current) return;
    importInFlight.current = true;
    setImporting(true);
    setImportError(null);
    try {
      const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: true });
      if (result.canceled || result.assets.length === 0) return;
      setImportReport(null);
      const report = await library.importFonts(result.assets.map(({ uri, name }) => ({ uri, name })));
      setImportReport(report);
      if (showImportResults) setImportDetailsOpen(true);
      onSnapshotChange(report.snapshot);
      setPagination({ key: queryKey, offset: 0 });
      list.current?.scrollToOffset({ offset: 0, animated: false });
    } catch (cause: unknown) {
      setImportError(cause instanceof LibraryError ? cause.message : t('mobile.errorImport'));
    } finally { importInFlight.current = false; setImporting(false); }
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchText('');
    Keyboard.dismiss();
  }

  function retryQuery() {
    setError(null);
    setPagination({ key: queryKey, offset: 0 });
    setRetry((value) => value + 1);
    if (!ready) onRetryInitialize();
  }

  function loadMore() {
    if (loading || shownError || waitingForSearch || page.families.length === 0) return;
    if (offset + pageSize < page.totalMatches) {
      setPagination((value) => value.key === queryKey && value.offset !== offset ? value : { key: queryKey, offset: offset + pageSize });
    }
  }

  const toggleSearch = () => { if (searchOpen) closeSearch(); else setSearchOpen(true); };
  const title = active ? scopeTitle : destination === 'cloud' ? t('mobile.cloudFonts') : destination === 'settings' ? t('common.settings') : t('mobile.recentTitle');
  const openFilter = () => { Keyboard.dismiss(); setFilterOpen(true); };
  const openCollections = () => { Keyboard.dismiss(); setCollectionsOpen(true); };
  const fontList = (
      <LibraryList ref={list} key={mode} data={page.families} keyExtractor={(family) => family.id}
        numColumns={mode === 'grid' ? 2 : 1} columnWrapperStyle={mode === 'grid' ? styles.columns : undefined}
        contentContainerStyle={[styles.content, {
          paddingTop: Platform.OS === 'android' ? androidContentTop : usesNativeControls ? scrollTopInset : 0,
          paddingBottom: usesNativeControls ? nativeInsets.bottom + 24 : navigationContentInset(bottomInset),
        }]}
        contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={usesNativeControls ? { top: scrollTopInset, bottom: nativeInsets.bottom } : undefined}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        onScroll={Platform.OS === 'android' ? Animated.event(
          [{ nativeEvent: { contentOffset: { y: headerScrollOffset } } }], { useNativeDriver: true },
        ) : undefined}
        scrollEventThrottle={Platform.OS === 'android' ? 16 : undefined}
        initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
        onEndReached={loadMore} onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <View style={mode === 'grid' ? { width: (width - 32) / 2 } : styles.listItem}>
            <FontCard family={item} mode={mode} theme={theme}
              onOpen={() => { Keyboard.dismiss(); onOpenFamily(item); }} />
          </View>
        )}
        ListHeaderComponent={
          <View>
            <View style={styles.libraryTools}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.scopeSwitch', { scope: scopeTitle })}
                disabled={!ready} onPress={openCollections} style={styles.rangeButton}>
                <Text numberOfLines={1} style={[styles.rangeTitle, { color: theme.label }]}>{scopeTitle}</Text>
                <CaretDownIcon size={16} color={theme.secondary} />
              </Pressable>
              {(searchOpen || selectedFacets.length > 0) && <PanelAction label={selectedFacets.length ? t('mobile.filterCount', { count: selectedFacets.length }) : t('mobile.filter')} theme={theme} onPress={openFilter} />}
            </View>
            {!hasConditions && scope === 'all' && (
              <View style={styles.hero}>
                <Image source={require('../assets/design/lasso.svg')} style={styles.lasso} contentFit="contain" />
                <Text accessibilityRole="header" style={[styles.heroTitle, { color: theme.label }]}>
                  {snapshot ? t('mobile.heroSubtitle', { count: snapshot.familyCount }) : t('mobile.heroTitle')}
                </Text>
                {snapshot && <Text style={[styles.heroDetail, { color: theme.secondary }]}>
                  {t('library.summaryDamaged', { damaged: snapshot.damagedCount, variable: snapshot.variableFamilyCount, recent: snapshot.recentCount })}
                </Text>}
              </View>
            )}
            {(hasConditions || scope !== 'all') && <Text accessibilityRole="header" style={[styles.searchSummary, { color: theme.secondary }]}>
              {loading && page.families.length === 0 ? t('mobile.loading') : queryText ? t('mobile.searchResultCount', { total: page.totalMatches }) : t('mobile.familyCount', { count: page.totalMatches })}
            </Text>}
            {page.unresolvedScopeItems > 0 && <Text style={[styles.searchSummary, { color: theme.secondary }]}>
              {t('mobile.unresolvedMembers', { count: page.unresolvedScopeItems })}
            </Text>}
            {(importReport || importError) && <View style={[styles.notice, { backgroundColor: theme.surface }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: importError ? theme.danger : theme.secondary }]}>
                {importError ?? (importCounts && t('mobile.importSummary', { imported: importCounts.imported, duplicate: importCounts.duplicate, failed: importCounts.failed }))}
              </Text>
              {usesNativeControls ? <NativeActionButton label={importError ? t('mobile.reselect') : t('mobile.viewDetails')} color={theme.accent}
                onPress={importError ? importFont : () => setImportDetailsOpen(true)} disabled={importing} plain />
                : <Pressable accessibilityRole="button" disabled={importing}
                  onPress={importError ? importFont : () => setImportDetailsOpen(true)} style={styles.retry}>
                  <Text style={{ color: theme.accent }}>{importError ? t('mobile.reselect') : t('mobile.viewDetails')}</Text>
                </Pressable>}
            </View>}
            {shownError && <View style={[styles.notice, { backgroundColor: theme.surface }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: theme.danger }]}>{shownError}</Text>
              {usesNativeControls ? <NativeActionButton label={t('common.retry')} color={theme.accent} onPress={retryQuery} plain />
                : <Pressable accessibilityRole="button" onPress={retryQuery} style={styles.retry}>
                <Text style={{ color: theme.accent }}>{t('common.retry')}</Text>
              </Pressable>}
            </View>}
          </View>
        }
        ListEmptyComponent={
          !ready || loading || waitingForSearch ? (shownError ? null : <ActivityIndicator style={styles.empty} color={theme.accent} accessibilityLabel={t('mobile.loadingLibrary')} />)
            : shownError ? null : <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.label }]}>{hasConditions ? t('mobile.noMatch')
                : page.unresolvedScopeItems > 0 ? t('mobile.noFonts') : scope === 'favorites' ? t('mobile.noFavorites') : scope === 'collection' ? t('collection.empty') : scope === 'recent' ? t('mobile.noRecent') : t('mobile.startFromFirst')}</Text>
              <Text style={[styles.emptyDetail, { color: theme.secondary }]}>{hasConditions ? t('mobile.adjustSearch')
                : page.unresolvedScopeItems > 0 ? t('collection.keepMembersNote') : scope === 'favorites' ? t('collection.emptyHint') : scope === 'collection' ? t('collection.favoriteInDetails') : t('mobile.importHint')}</Text>
              {selectedFacets.length > 0 && <PanelAction label={t('mobile.clearFilters')} theme={theme} onPress={() => updateBrowse({ facets: [] })} />}
              {!hasConditions && scope === 'all' && (usesNativeControls ? <NativeActionButton label={importing ? t('mobile.loadingImport') : t('import.importFonts')}
                systemImage="plus" color={theme.accent} onPress={importFont} disabled={importing} prominent />
                : <Pressable accessibilityRole="button" disabled={importing} onPress={importFont}
                style={({ pressed }) => [styles.importButton, { backgroundColor: theme.accent, opacity: pressed || importing ? 0.6 : 1 }]}>
                {importing ? <ActivityIndicator color={theme.onAccent} /> : <PlusIcon size={18} color={theme.onAccent} />}
                <Text style={[styles.importLabel, { color: theme.onAccent }]}>{importing ? t('mobile.loadingImport') : t('import.importFonts')}</Text>
              </Pressable>)}
            </View>
        }
        ListFooterComponent={loading && page.families.length > 0
          ? <ActivityIndicator style={styles.loadingMore} color={theme.accent} accessibilityLabel={t('mobile.loadingMore')} /> : null}
      />
  );
  const content = (
    <NativeScrollContainer hasHeader={!sidebar}
      onInsetsChange={(event) => setNativeInsets(event.nativeEvent)}
      style={[styles.screen, { backgroundColor: theme.background }, reservesWindowControls && styles.windowControlsInset]}
      onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
      {Platform.OS === 'android' && !sidebar && <Animated.View pointerEvents="none"
        accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.headerBackdrop, { height: androidContentTop + 34,
          opacity: headerScrollOffset.interpolate({ inputRange: [0, 56], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
        <AndroidHeaderBackdrop sourceId={sourceId} active={active} theme={theme} style={styles.screen} />
      </Animated.View>}
      {!sidebar && <View collapsable={false} onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
        style={[styles.header, (usesNativeControls || Platform.OS === 'android') && [styles.floatingHeader, {
          top: Platform.OS === 'android' ? inset.top : nativeInsets.top,
          backgroundColor: Platform.OS === 'ios' && Number(Platform.Version) < 26 ? theme.background : undefined }],
          Platform.OS === 'android' && styles.androidHeader]}>
        {(!searchOpen || Platform.OS === 'android') && <Animated.View pointerEvents={searchOpen ? 'none' : 'auto'}
          style={[styles.brand, (usesNativeControls || Platform.OS === 'android') && styles.nativeBrand,
            Platform.OS === 'android' && { opacity: brandOpacity }]}>
          <Image source={require('../assets/design/folio.svg')} style={styles.logo}
            tintColor={theme.label} contentFit="contain" accessibilityLabel="Folio" />
          <Text numberOfLines={1} style={[styles.libraryCount, { color: theme.muted }]}>
            {snapshot ? t('mobile.localFamilyCount', { count: snapshot.familyCount }) : t('mobile.localFonts')}
          </Text>
        </Animated.View>}
        {Platform.OS === 'android' ? <AndroidHeaderControls theme={theme} sourceId={sourceId} active={active}
          mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
          ready={ready} importing={importing} onModeChange={setMode} onImport={importFont}
          onSearch={toggleSearch} onSearchTextChange={setSearchText} onFilter={openFilter} filterCount={selectedFacets.length} /> : usesNativeControls ? <NativeHeaderControls theme={theme} mode={mode} searchOpen={searchOpen}
          width={width - 52} searchText={searchText} onSearchTextChange={setSearchText}
          ready={ready} importing={importing} onModeChange={setMode} onImport={importFont}
          onSearch={toggleSearch} onFilter={openFilter} filterCount={selectedFacets.length} /> : searchOpen ? (
          <View style={[styles.search, { backgroundColor: theme.surface }]}>
            <MagnifyingGlassIcon size={20} color={theme.secondary} />
            <TextInput ref={searchInput} autoFocus accessibilityLabel={t('mobile.searchFonts')} placeholder={t('mobile.searchPlaceholder')}
              placeholderTextColor={theme.muted} selectionColor={theme.selection} cursorColor={theme.accent}
              selectionHandleColor={theme.accent} value={searchText} editable={ready}
              onChangeText={setSearchText} style={[styles.searchInput, { color: theme.label }]}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
            {searchText.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.clearSearch')}
              hitSlop={10} onPress={() => { setSearchText(''); searchInput.current?.focus(); }}>
              <XIcon size={18} color={theme.secondary} />
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.closeSearch')} onPress={closeSearch} style={styles.cancelSearch}>
              <XIcon size={20} color={theme.label} />
            </Pressable>
          </View>
        ) : <View style={styles.headerActions}>
          <IconButton theme={theme} label={t('library.filterFonts')} disabled={!ready} selected={selectedFacets.length > 0} onPress={openFilter}>
            <FunnelSimpleIcon size={20} color={selectedFacets.length > 0 ? theme.accent : theme.label} />
          </IconButton>
          <ViewModeMenu sourceId={sourceId} theme={theme} mode={mode} active={active && !importing} onModeChange={setMode} />
          <IconButton theme={theme} label={t('mobile.searchFonts')} onPress={() => setSearchOpen(true)}>
            <MagnifyingGlassIcon size={20} color={theme.label} />
          </IconButton>
          <IconButton theme={theme} label={importing ? t('mobile.loadingImport') : t('import.importFonts')} disabled={!ready || importing} busy={importing} onPress={importFont}>
            {importing ? <ActivityIndicator size="small" color={theme.label} /> : <PlusIcon size={20} color={theme.label} />}
          </IconButton>
        </View>}
      </View>}
      {Platform.OS === 'android' ? <NavigationBackdrop sourceId={active ? sourceId : ''}
        active={active} style={[styles.screen, { backgroundColor: theme.background }]}>{fontList}</NavigationBackdrop> : fontList}
      <FilterPanel visible={filterOpen && active} theme={theme}
        options={facetOptions.key === optionsKey ? facetOptions.options : page.facets} counts={page.facets}
        selected={selectedFacets} loading={loading || optionsLoading || waitingForSearch} error={shownError ?? facetError}
        totalMatches={page.totalMatches} onChange={(facets) => updateBrowse({ facets })}
        onClose={() => setFilterOpen(false)} onRetry={retryQuery} />
      <CollectionsPanel visible={collectionsOpen && active} theme={theme} target={target} snapshot={snapshot}
        onSnapshot={onSnapshotChange} onSelect={onTargetChange} onClose={() => setCollectionsOpen(false)} />
      <ImportResults report={importReport} visible={importDetailsOpen && active} theme={theme}
        onClose={() => setImportDetailsOpen(false)} />
    </NativeScrollContainer>
  );

  if (sidebar) {
    return <NativeLibraryContent theme={theme} title={title} active={active}
      subtitle={snapshot ? t('mobile.familyCount', { count: scope === 'all' ? snapshot.familyCount : page.totalMatches }) : t('library.title')}
      mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
      ready={ready} importing={importing} onModeChange={setMode} onSearch={toggleSearch}
      onSearchTextChange={setSearchText} onImport={importFont} onFilter={openFilter} filterCount={selectedFacets.length}>
      {active ? content : <View style={[styles.screen, { backgroundColor: theme.background }]} />}
    </NativeLibraryContent>;
  }
  return content;
}

// 设置二级页按入口类型分流，统一由原生详情导航承载。
function settingsPageNode(page: SettingsPageId, theme: Theme, onClose: () => void) {
  switch (page) {
    case 'storage': return <SettingsStoragePage theme={theme} onClose={onClose} />;
    case 'cards': return <SettingsCardsPage theme={theme} onClose={onClose} />;
    case 'appearance': return <SettingsAppearancePage theme={theme} onClose={onClose} />;
    case 'import': return <SettingsImportPage theme={theme} onClose={onClose} />;
    case 'about': return <SettingsAboutPage theme={theme} onClose={onClose} />;
  }
}

function MobileApp() {
  const { t } = useTranslation();
  const { preferences, ready: preferencesReady } = usePreferences();
  const systemDark = useColorScheme() === 'dark';
  const dark = preferences.appearance === 'system' ? systemDark : preferences.appearance === 'dark';
  const theme = useMemo(() => createTheme(dark, preferences.accent), [dark, preferences.accent]);
  const sourceId = useId();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // 紧凑窗口沿用 iPhone 导航，常规宽度启用原生侧栏。
  const sidebar = usesNativeSidebar && width >= 600;
  const [tab, setTab] = useState<MobileTab>('local');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [nativeDestination, setNativeDestination] = useState<NativeDestination>('local');
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [initializeRetry, setInitializeRetry] = useState(0);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [libraryTarget, setLibraryTarget] = useState<LibraryTarget>({ scope: 'all' });
  const [fontPage, setFontPage] = useState<FontFamily | null>(null);
  const [fontPageVisible, setFontPageVisible] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId | null>(null);
  const [settingsPageVisible, setSettingsPageVisible] = useState(false);
  const destination: NativeDestination = sidebar && nativeDestination === 'local'
    ? libraryTarget.scope === 'favorites' ? 'favorites'
      : libraryTarget.scope === 'collection' ? `collection:${libraryTarget.collectionId}` : 'local'
    : nativeDestination;
  const screenTarget: LibraryTarget = sidebar && nativeDestination === 'recent' ? { scope: 'recent' } : libraryTarget;
  const libraryActive = nativeDestination === 'local' || (sidebar && nativeDestination === 'recent');

  useEffect(() => {
    let mounted = true;
    library.initialize().then((value) => {
      if (mounted) { setSnapshot(value); setInitialError(null); }
    }).catch(() => { if (mounted) setInitialError(t('mobile.errorLibrary')); });
    return () => { mounted = false; };
  }, [initializeRetry, t]);

  const applySnapshot = useCallback((value: LibrarySnapshot) => {
    setSnapshot(value);
    setLibraryVersion((version) => version + 1);
    setLibraryTarget((target) => target.scope === 'collection' && !value.collections.some((item) => item.id === target.collectionId)
      ? { scope: 'all' } : target);
  }, []);

  function selectTarget(target: LibraryTarget) { setLibraryTarget(target); setNativeDestination('local'); }
  function navigate(value: NativeDestination) {
    Keyboard.dismiss();
    if (value === 'favorites') selectTarget({ scope: 'favorites' });
    else if (value.startsWith('collection:')) selectTarget({ scope: 'collection', collectionId: value.slice('collection:'.length) });
    else {
      setNativeDestination(value);
      if (value === 'local' && sidebar) setLibraryTarget({ scope: 'all' });
    }
  }
  function openFamily(family: FontFamily) { setFontPage(family); setFontPageVisible(true); }

  async function favorite() {
    if (!fontPage) return;
    const family = fontPage;
    applySnapshot(await library.setFavorite([...new Set(family.identityIds)], !family.isFavorite));
    setFontPage((current) => current?.id === family.id ? { ...current, isFavorite: !family.isFavorite } : current);
  }

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  function openSettingsPage(page: SettingsPageId) { setSettingsPage(page); setSettingsPageVisible(true); }
  const settingsContent = <SettingsScreen theme={theme} onOpenPage={openSettingsPage} />;
  const content = usesNativeControls ? (
    <View style={[styles.app, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      <NativeNavigation theme={theme} sidebar={sidebar} destination={destination} snapshot={snapshot}
        settings={settingsContent} onDestinationChange={navigate}>
        <LibraryScreen theme={theme} bottomInset={0} sidebar={sidebar} destination={destination} onSnapshotChange={applySnapshot}
          target={screenTarget} snapshot={snapshot} libraryVersion={libraryVersion} initialError={initialError}
          defaultMode={preferences.defaultViewMode} preferencesReady={preferencesReady} showImportResults={preferences.importShowResults}
          onTargetChange={selectTarget} onRetryInitialize={() => setInitializeRetry((value) => value + 1)}
          active={libraryActive}
          onOpenFamily={openFamily} />
      </NativeNavigation>
    </View>
  ) : (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.app, { backgroundColor: theme.background, paddingTop: Platform.OS === 'android' ? 0 : inset.top,
      paddingLeft: inset.left, paddingRight: inset.right }]}>
      <StatusBar style="auto" />
      <View style={styles.screen}>
        <View style={[styles.screen, tab !== 'local' && styles.hidden]}>
          <LibraryScreen theme={theme} sourceId={sourceId} bottomInset={inset.bottom} active={tab === 'local'} onOpenFamily={openFamily}
            target={libraryTarget} snapshot={snapshot} libraryVersion={libraryVersion} initialError={initialError}
            defaultMode={preferences.defaultViewMode} preferencesReady={preferencesReady} showImportResults={preferences.importShowResults}
            onSnapshotChange={applySnapshot} onTargetChange={setLibraryTarget}
            onRetryInitialize={() => setInitializeRetry((value) => value + 1)} />
        </View>
        {tab !== 'local' && <NavigationBackdrop sourceId={sourceId} active={!keyboardVisible}
          style={[styles.screen, { backgroundColor: theme.background }]}>
          {tab === 'settings' ? settingsContent : <View style={styles.screen} />}
        </NavigationBackdrop>}
      </View>
      {!keyboardVisible && <BottomNavigation sourceId={sourceId} selectedId={tab} dark={dark} theme={theme}
        bottomInset={inset.bottom} leftInset={inset.left} rightInset={inset.right}
        onSelectionChange={(id) => { Keyboard.dismiss(); setTab(id); }} />}
    </KeyboardAvoidingView>
  );

  const detail = fontPage ? (
    <FontDetails key={fontPage.id} family={fontPage} theme={theme}
      snapshot={snapshot} collectionId={screenTarget.scope === 'collection' ? screenTarget.collectionId : undefined}
      onSnapshotChange={applySnapshot} onClose={() => setFontPageVisible(false)} onFavorite={favorite} />
  ) : settingsPage ? settingsPageNode(settingsPage, theme, () => setSettingsPageVisible(false)) : null;

  return <FontNavigation visible={fontPageVisible || settingsPageVisible} theme={theme}
    onDismissed={() => { setFontPageVisible(false); setFontPage(null); setSettingsPageVisible(false); setSettingsPage(null); }}
    detail={detail}>
    {content}
  </FontNavigation>;
}

export default function App() {
  // 原生导航完成挂载后移除启动画面。
  useEffect(() => { SplashScreen.hide(); }, []);
  return <SafeAreaProvider><PreferencesProvider><MobileApp /></PreferencesProvider></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  app: { flex: 1 }, screen: { flex: 1 }, hidden: { display: 'none' },
  // 紧凑 iPad 窗口为系统控制按钮保留标准工具栏高度。
  windowControlsInset: { paddingTop: 44 },
  header: { minHeight: 64, paddingHorizontal: 26, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  floatingHeader: { position: 'absolute', left: 0, right: 0, zIndex: 1 },
  androidHeader: { zIndex: 2 },
  headerBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  brand: { flex: 1, gap: 8 }, logo: { width: 45.011, height: 16 },
  nativeBrand: { position: 'absolute', left: 26, right: 254 },
  libraryTools: { paddingHorizontal: 12, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeTitle: { fontSize: 16, fontWeight: '500', flexShrink: 1 },
  libraryCount: { fontSize: 14, lineHeight: 16, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  search: { flex: 1, paddingHorizontal: 12, minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, paddingVertical: 8 },
  cancelSearch: { minWidth: 32, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  content: { paddingHorizontal: 10, gap: 12 }, columns: { gap: 12 }, listItem: { width: '100%' },
  hero: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 8 }, lasso: { width: 32, height: 32 },
  heroTitle: { fontSize: 30, fontWeight: '600', lineHeight: 36 },
  heroDetail: { fontSize: 16, fontWeight: '500', lineHeight: 22 },
  searchSummary: { fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  notice: { marginVertical: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 }, retry: { minHeight: 44, justifyContent: 'center' },
  empty: { marginTop: 48, paddingHorizontal: 22, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600' }, emptyDetail: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  importButton: { marginTop: 8, paddingHorizontal: 20, minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  importLabel: { fontSize: 15, fontWeight: '600' }, loadingMore: { paddingVertical: 16 },
});
