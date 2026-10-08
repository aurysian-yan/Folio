import { getDocumentAsync } from 'expo-document-picker';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import {
  CaretDownIcon, FunnelSimpleIcon, MagnifyingGlassIcon, PlusIcon, XIcon,
} from './icons';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator, Animated, AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
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
import { AndroidHeaderControls } from './HeaderControls';
import { PageHeader, usePageHeader } from './PageHeader';
import { HeaderScrollContext } from './HeaderButtonShadow';
import { BottomNavigation, NavigationBackdrop, navigationContentInset, type MobileTab } from './bottom-navigation';
import { LibraryError, representativeFace, savedConditions, summarizeImport, targetKey, type FacetOption, type FacetSelection, type FontFamily, type ImportReport, type LibraryPage, type LibrarySnapshot, type LibraryTarget } from './library';
import { cloudSync, library, materialPalette, syncSession, wallpaperSeed } from './native';
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
import { SettingsSyncPage } from './SettingsSyncPage';
import { CloudScreen } from './CloudScreen';
import { LibraryHero } from './LibraryHero';
import { createLibraryHero, type HeroAction } from './library-hero';
import { useCloudSync, type CloudSyncController } from './useCloudSync';
import { SettingsStoragePage } from './SettingsStoragePage';
import { TabScenes } from './TabScenes';
import { createTheme, IconButton, resolveAccentColor, type Theme } from './ui';

const pageSize = 40;
const emptyPage: LibraryPage = { totalMatches: 0, families: [], facets: [], unresolvedScopeItems: 0 };
const emptyBrowse = { searchText: '', locationFilter: 'all', facets: [] as FacetSelection[] };
const LibraryList = Animated.FlatList<FontFamily>;

function LibraryScreen({ theme, bottomInset, active, sourceId = '', sidebar = false, searchPage = false, target, destination = 'local',
  snapshot, libraryVersion, initialError, defaultMode, preferencesReady, showImportResults, syncBlocked,
  onSnapshotChange, onRetryInitialize, onTargetChange, onOpenFamily, syncController, onHeroAction, cloudFile }: {
  cloudFile?: import('./sync').CloudFont | null;
  theme: Theme;
  bottomInset: number;
  active: boolean;
  sourceId?: string;
  sidebar?: boolean;
  searchPage?: boolean;
  target: LibraryTarget;
  destination?: NativeDestination;
  snapshot: LibrarySnapshot | null;
  libraryVersion: number;
  initialError: string | null;
  defaultMode: 'grid' | 'list';
  preferencesReady: boolean;
  showImportResults: boolean;
  syncBlocked: boolean;
  syncController: CloudSyncController;
  onHeroAction: (action: HeroAction) => void;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void;
  onRetryInitialize: () => void;
  onTargetChange: (target: LibraryTarget) => void;
  onOpenFamily: (family: FontFamily) => void;
}) {
  const { t } = useTranslation();
  const { scope } = target;
  const collectionId = target.scope === 'collection' ? target.collectionId : undefined;
  const smartFolderId = target.scope === 'smart' ? target.smartFolderId : undefined;
  const fileFingerprint = cloudFile?.fingerprint;
  const scopeKey = `${targetKey(target)}:${fileFingerprint ?? ''}`;
  const ready = snapshot !== null;
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [browseStates, setBrowseStates] = useState<Record<string, typeof emptyBrowse>>({});
  const browse = browseStates[scopeKey] ?? emptyBrowse;
  const { searchText, locationFilter, facets: selectedFacets } = browse;
  const searchOpen = searchPage;
  const updateBrowse = (change: Partial<typeof emptyBrowse>) => setBrowseStates((previous) => ({
    ...previous, [scopeKey]: { ...(previous[scopeKey] ?? emptyBrowse), ...change },
  }));
  const setSearchText = (value: string) => updateBrowse({ searchText: value });
  const [filterOpen, setFilterOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [facetOptions, setFacetOptions] = useState<{ key: string; options: FacetOption[] }>({ key: '', options: [] });
  const [facetFailure, setFacetFailure] = useState<{ key: string; message: string } | null>(null);
  const [heroHeight, setHeroHeight] = useState(128);
  const list = useRef<Animated.FlatList<FontFamily>>(null);
  const header = usePageHeader({ collapseOffset: heroHeight, sourceId,
    onSnap: (offset, animated) => list.current?.scrollToOffset({ offset, animated }) });
  const headerScrollOffset = header.scrollY;
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
  const queryKey = JSON.stringify([scope, collectionId, smartFolderId, queryText, selectedFacets, locationFilter, fileFingerprint, retry]);
  const offset = pagination.key === queryKey && loadedQuery.key === queryKey ? pagination.offset : 0;
  const requestKey = JSON.stringify([queryKey, offset, libraryVersion]);
  const optionsKey = JSON.stringify([scopeKey, queryText, libraryVersion, retry]);
  const facetError = facetFailure?.key === optionsKey ? facetFailure.message : null;
  const optionsLoading = ready && facetOptions.key !== optionsKey && !facetError;
  const shownError = initialError ?? error;
  const hasConditions = !!queryText || selectedFacets.length > 0;
  const scopeTitle = scope === 'collection' ? snapshot?.collections.find((item) => item.id === collectionId)?.name ?? t('collection.collection')
    : scope === 'smart' ? snapshot?.smartFolders.find((item) => item.id === smartFolderId)?.name ?? t('navigation.smartCollections')
    : scope === 'favorites' ? t('mobile.starredCollections') : scope === 'recent' ? t('macos.recentVisits') : t('mobile.allFonts');
  const loading = ready && loadedQuery.request !== requestKey;
  const page = loadedQuery.key === queryKey ? loadedQuery.page : emptyPage;
  const waitingForSearch = searchText.trim() !== queryText;
  const importCounts = importReport ? summarizeImport(importReport.items) : null;

  useEffect(() => {
    headerScrollOffset.setValue(0);
  }, [headerScrollOffset, mode, scopeKey]);

  useEffect(() => {
    if (usesNativeControls || Platform.OS === 'android' || !searchPage) return;
    if (active && ready) searchInput.current?.focus();
    else searchInput.current?.blur();
  }, [active, ready, searchPage]);

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
    const queryTarget: LibraryTarget = smartFolderId ? { scope: 'smart', smartFolderId }
      : collectionId ? { scope: 'collection', collectionId } : { scope: scope as 'all' | 'favorites' | 'recent' };
    library.query({ ...queryTarget, text: queryText, facets: [], offset: 0, limit: 1 }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setFacetOptions({ key: optionsKey, options: result.facets });
      }).catch(() => {
        if (!controller.signal.aborted) setFacetFailure({ key: optionsKey, message: t('mobile.errorFilters') });
      });
    return () => controller.abort();
  }, [ready, scope, collectionId, smartFolderId, queryText, optionsKey, t]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const queryTarget: LibraryTarget = smartFolderId ? { scope: 'smart', smartFolderId }
      : collectionId ? { scope: 'collection', collectionId } : { scope: scope as 'all' | 'favorites' | 'recent' };
    const previous = loadedQueryRef.current;
    const reloading = previous.key === queryKey && previous.version !== libraryVersion;
    async function readPage() {
      const request = { ...queryTarget, text: queryText, facets: selectedFacets, locationFilter, fileFingerprint, limit: pageSize };
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
  }, [ready, queryText, scope, collectionId, smartFolderId, selectedFacets, locationFilter, fileFingerprint, offset, queryKey, requestKey, libraryVersion, t]);

  async function importFont() {
    if (!ready || syncBlocked || importInFlight.current) return;
    const releaseImport = syncSession.reserveImport();
    if (!releaseImport) return;
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
    } finally { releaseImport(); importInFlight.current = false; setImporting(false); }
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

  const title = searchPage ? t('common.search') : active || !usesNativeControls ? scopeTitle
    : destination === 'cloud' ? t('mobile.cloudFonts') : t('common.settings');
  const openFilter = () => { Keyboard.dismiss(); setFilterOpen(true); };
  const openCollections = () => { Keyboard.dismiss(); setCollectionsOpen(true); };
  const showsHero = !searchPage && !hasConditions && scope === 'all';
  const brandProgress = headerScrollOffset.interpolate({
    inputRange: showsHero ? [Math.max(0, heroHeight - (header.reduceMotion ? 0.01 : 44)), heroHeight] : [-1, 0],
    outputRange: [0, 1], extrapolate: 'clamp',
  });
  const localCountLabel = snapshot ? t('mobile.localFamilyCount', { count: snapshot.familyCount }) : t('mobile.localFonts');
  const fontList = (
      <LibraryList ref={list}
        {...(showsHero ? header.snapScrollProps : {})} key={mode} data={page.families} keyExtractor={(family) => family.id}
        numColumns={mode === 'grid' ? 2 : 1} columnWrapperStyle={mode === 'grid' ? styles.columns : undefined}
        contentContainerStyle={[styles.content, {
          paddingTop: Platform.OS === 'android' ? androidContentTop : usesNativeControls ? scrollTopInset : 0,
          paddingBottom: usesNativeControls ? nativeInsets.bottom + 24 : navigationContentInset(bottomInset),
        }]}
        contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
        scrollIndicatorInsets={usesNativeControls ? { top: scrollTopInset, bottom: nativeInsets.bottom } : undefined}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        onScroll={header.onScroll} scrollEventThrottle={16}
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
            {showsHero && (
              <LibraryHero theme={theme} presentation={cloudFile ? {kind:'normal', title:cloudFile.filename, subtitle:t('library.familyCountLabel',{total:page.totalMatches}), sync:createLibraryHero(snapshot,syncController.state,syncController.readError).sync} : createLibraryHero(snapshot, syncController.state, syncController.readError)}
                onAction={onHeroAction} onLayout={({ nativeEvent }) => setHeroHeight(nativeEvent.layout.height)} />
            )}
            <View style={styles.libraryTools}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.scopeSwitch', { scope: scopeTitle })}
                disabled={!ready} onPress={openCollections} style={styles.rangeButton}>
                <Text numberOfLines={1} style={[styles.rangeTitle, { color: theme.label }]}>{scopeTitle}</Text>
                <CaretDownIcon size={16} color={theme.secondary} />
              </Pressable>
            </View>
            {(searchPage || hasConditions || scope !== 'all') && <Text accessibilityRole="header" style={[styles.searchSummary, { color: theme.secondary }]}>
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
                onPress={importError ? importFont : () => setImportDetailsOpen(true)} disabled={importing || (syncBlocked && !!importError)} />
                : <Pressable accessibilityRole="button" disabled={importing || (syncBlocked && !!importError)}
                  onPress={importError ? importFont : () => setImportDetailsOpen(true)} style={styles.retry}>
                  <Text style={{ color: theme.accent }}>{importError ? t('mobile.reselect') : t('mobile.viewDetails')}</Text>
                </Pressable>}
            </View>}
            {shownError && <View style={[styles.notice, { backgroundColor: theme.surface }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: theme.danger }]}>{shownError}</Text>
              {usesNativeControls ? <NativeActionButton label={t('common.retry')} color={theme.accent} onPress={retryQuery} />
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
                : page.unresolvedScopeItems > 0 ? t('mobile.noFonts') : scope === 'favorites' ? t('mobile.noFavorites') : scope === 'collection' || scope === 'smart' ? t('collection.empty') : scope === 'recent' ? t('mobile.noRecent') : t('mobile.startFromFirst')}</Text>
              <Text style={[styles.emptyDetail, { color: theme.secondary }]}>{hasConditions ? t('mobile.adjustSearch')
                : page.unresolvedScopeItems > 0 ? t('collection.keepMembersNote') : scope === 'favorites' ? t('collection.emptyHint') : scope === 'collection' ? t('collection.favoriteInDetails') : scope === 'smart' ? t('filters.smartHint') : scope === 'recent' ? t('mobile.recentHint') : t('mobile.importHint')}</Text>
              {selectedFacets.length > 0 && <PanelAction label={t('mobile.clearFilters')} theme={theme} onPress={() => updateBrowse({ facets: [] })} />}
              {!searchPage && !hasConditions && scope === 'all' && (usesNativeControls ? <NativeActionButton label={importing ? t('mobile.loadingImport') : t('import.importFonts')}
                systemImage="plus" color={theme.accent} onPress={importFont} disabled={importing || syncBlocked} prominent />
                : <Pressable accessibilityRole="button" disabled={importing || syncBlocked} onPress={importFont}
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
      {!sidebar && <PageHeader scrollY={headerScrollOffset} theme={theme} sourceId={sourceId} active={active}
        topInset={Platform.OS === 'android' ? inset.top : usesNativeControls ? nativeInsets.top : 0}
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}>
        {!searchOpen && <View
          style={[styles.brand, (usesNativeControls || Platform.OS === 'android') && [styles.nativeBrand, {
            right: 26 + (width - 52 < 44 * 7 ? 152 : 172) + 12,
          }]]}>
          <Animated.View style={{ transform: [{ translateY: brandProgress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
            <Image source={require('../assets/design/folio.svg')} style={styles.logo}
              tintColor={theme.label} contentFit="contain" accessibilityLabel="Folio" />
          </Animated.View>
          <Animated.View collapsable={false} style={{ opacity: brandProgress }} pointerEvents={!showsHero || header.collapsed ? 'auto' : 'none'}
            accessibilityElementsHidden={showsHero && !header.collapsed}
            importantForAccessibility={showsHero && !header.collapsed ? 'no-hide-descendants' : 'auto'}>
            <Pressable accessibilityRole="button" accessibilityLabel={`${localCountLabel}, ${t('mobile.scopeSwitch', { scope: scopeTitle })}`}
              disabled={!ready} onPress={openCollections} hitSlop={8}>
              <Text numberOfLines={1} style={[styles.libraryCount, { color: theme.muted }]}>
                {localCountLabel}
              </Text>
            </Pressable>
          </Animated.View>
        </View>}
        {Platform.OS === 'android' ? <AndroidHeaderControls theme={theme} sourceId={sourceId} active={active}
          mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
          ready={ready} importing={importing} importBlocked={syncBlocked} onModeChange={setMode} onImport={importFont}
          onSearchTextChange={setSearchText} onFilter={openFilter} filterCount={selectedFacets.length} /> : usesNativeControls ? <NativeHeaderControls theme={theme} active={active} mode={mode} searchOpen={searchOpen}
          width={width - 52} searchText={searchText} onSearchTextChange={setSearchText}
          ready={ready} importing={importing} importBlocked={syncBlocked} onModeChange={setMode} onImport={importFont}
          onFilter={openFilter} filterCount={selectedFacets.length} /> : searchOpen ? (
          <View style={[styles.search, { backgroundColor: theme.surface }]}>
            <MagnifyingGlassIcon size={20} color={theme.secondary} />
            <TextInput ref={searchInput} accessibilityLabel={t('mobile.searchFonts')} placeholder={t('mobile.searchPlaceholder')}
              placeholderTextColor={theme.muted} selectionColor={theme.selection} cursorColor={theme.accent}
              selectionHandleColor={theme.accent} value={searchText} editable={ready && active}
              onChangeText={setSearchText} style={[styles.searchInput, { color: theme.label }]}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
            {searchText.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.clearSearch')}
              hitSlop={10} onPress={() => { setSearchText(''); searchInput.current?.focus(); }}>
              <XIcon size={18} color={theme.secondary} />
            </Pressable>}
            <IconButton theme={theme} label={t('library.filterFonts')} disabled={!ready} selected={selectedFacets.length > 0} onPress={openFilter}>
              <FunnelSimpleIcon size={20} color={selectedFacets.length > 0 ? theme.accent : theme.label} />
            </IconButton>
          </View>
        ) : <View style={styles.headerActions}>
          <IconButton theme={theme} label={t('library.filterFonts')} disabled={!ready} selected={selectedFacets.length > 0} onPress={openFilter}>
            <FunnelSimpleIcon size={20} color={selectedFacets.length > 0 ? theme.accent : theme.label} />
          </IconButton>
          <ViewModeMenu sourceId={sourceId} theme={theme} mode={mode} active={active && !importing} onModeChange={setMode} />
          <IconButton theme={theme} label={importing ? t('mobile.loadingImport') : t('import.importFonts')} disabled={!ready || importing || syncBlocked} busy={importing} onPress={importFont}>
            {importing ? <ActivityIndicator size="small" color={theme.label} /> : <PlusIcon size={20} color={theme.label} />}
          </IconButton>
        </View>}
      </PageHeader>}
      {Platform.OS === 'android' ? <NavigationBackdrop sourceId={active ? sourceId : ''}
        active={active} theme={theme} style={styles.screen}>{fontList}</NavigationBackdrop> : fontList}
      <FilterPanel locationFilter={locationFilter} onLocationChange={(locationFilter) => updateBrowse({locationFilter})} visible={filterOpen && active} theme={theme}
        options={facetOptions.key === optionsKey ? facetOptions.options : page.facets} counts={page.facets}
        selected={selectedFacets} loading={loading || optionsLoading || waitingForSearch} error={shownError ?? facetError}
        totalMatches={page.totalMatches} onChange={(facets) => updateBrowse({ facets })}
        onClose={() => setFilterOpen(false)} onRetry={retryQuery} />
      <CollectionsPanel visible={collectionsOpen && active} theme={theme} target={target} snapshot={snapshot}
        currentConditions={savedConditions({ text: searchText, facets: selectedFacets })} libraryVersion={libraryVersion}
        onSnapshot={onSnapshotChange} onSelect={onTargetChange} onClose={() => setCollectionsOpen(false)} />
      <ImportResults report={importReport} visible={importDetailsOpen && active} theme={theme}
        onClose={() => setImportDetailsOpen(false)} />
    </NativeScrollContainer>
  );

  if (sidebar) {
    return <HeaderScrollContext.Provider value={headerScrollOffset}><NativeLibraryContent theme={theme} title={title} active={active}
      subtitle={snapshot ? t('mobile.familyCount', { count: scope === 'all' ? snapshot.familyCount : page.totalMatches }) : t('library.title')}
      mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
      ready={ready} importing={importing} importBlocked={syncBlocked} onModeChange={setMode}
      onSearchTextChange={setSearchText} onImport={importFont} onFilter={openFilter} filterCount={selectedFacets.length}>
      {content}
    </NativeLibraryContent></HeaderScrollContext.Provider>;
  }
  return content;
}

// 设置二级页按入口类型分流，统一由原生详情导航承载。
function settingsPageNode(page: SettingsPageId, theme: Theme, onClose: () => void, controller: CloudSyncController) {
  switch (page) {
    case 'sync': return <SettingsSyncPage theme={theme} onClose={onClose} controller={controller} />;
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
  const dark = useColorScheme() === 'dark';
  const [wallpaperAccent, setWallpaperAccent] = useState<string | null>(() => (Platform.OS === 'android' ? wallpaperSeed() : null));
  // 壁纸更换后进入前台重新读取，确保配色生效。
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setWallpaperAccent(wallpaperSeed());
    });
    return () => subscription.remove();
  }, []);
  const theme = useMemo(() => {
    if (Platform.OS !== 'android') return createTheme(dark, preferences.accent);
    const materialRoles = preferences.materialTheme
      ? materialPalette(resolveAccentColor(preferences.accent, dark, wallpaperAccent ?? undefined), dark)
      : undefined;
    return createTheme(dark, preferences.accent, { materialRoles, wallpaperAccent: wallpaperAccent ?? undefined });
  }, [dark, preferences.accent, preferences.materialTheme, wallpaperAccent]);
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
  const [searchTarget, setSearchTarget] = useState<LibraryTarget>({ scope: 'all' });
  const [fontPage, setFontPage] = useState<FontFamily | null>(null);
  const [focusedCloudFile, setFocusedCloudFile] = useState<import('./sync').CloudFont | null>(null);
  const recentAttempt = useRef(0);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [fontPageCollectionId, setFontPageCollectionId] = useState<string | undefined>();
  const [fontPageVisible, setFontPageVisible] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPageId | null>(null);
  const [settingsPageVisible, setSettingsPageVisible] = useState(false);
  const destination: NativeDestination = sidebar && nativeDestination === 'local'
    ? libraryTarget.scope === 'favorites' ? 'favorites'
      : libraryTarget.scope === 'collection' ? `collection:${libraryTarget.collectionId}`
        : libraryTarget.scope === 'smart' ? `smart:${libraryTarget.smartFolderId}` : 'local'
    : nativeDestination;
  const screenTarget = libraryTarget;
  const libraryActive = nativeDestination === 'local';

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
    setLibraryTarget((target) => (target.scope === 'collection' && !value.collections.some((item) => item.id === target.collectionId))
      || (target.scope === 'smart' && !value.smartFolders.some((item) => item.id === target.smartFolderId)) ? { scope: 'all' } : target);
    setSearchTarget((target) => (target.scope === 'collection' && !value.collections.some((item) => item.id === target.collectionId))
      || (target.scope === 'smart' && !value.smartFolders.some((item) => item.id === target.smartFolderId)) ? { scope: 'all' } : target);
  }, []);

  const syncController = useCloudSync(snapshot !== null, applySnapshot);

  const displayedFamilyId = fontPage?.id;
  const displayedFamilyName = fontPage?.displayName;
  const displayedIdentity = fontPage?.faces[0]?.identityId;
  const displayedFingerprint = fontPage?.faces[0]?.location?.files[0]?.fingerprint;
  useEffect(() => {
    if (!fontPageVisible || !displayedFamilyId || !displayedFamilyName) return;
    const abort = new AbortController();
    void (async () => {
      let offset = 0;
      while (!abort.signal.aborted) {
        const page = await library.query({ scope: 'all', text: displayedFingerprint ? '' : displayedFamilyName, fileFingerprint: displayedFingerprint, offset, limit: 100 }, abort.signal);
        const family = page.families.find((item) => item.id === displayedFamilyId || item.faces.some((face) => face.identityId === displayedIdentity));
        if (family) { setFontPage(family); return; }
        offset += page.families.length;
        if (!page.families.length || offset >= page.totalMatches) { setFontPageVisible(false); return; }
      }
    })().catch(() => { /* 查询错误不使用旧路径重新创建预览。 */ });
    return () => abort.abort();
  }, [libraryVersion, displayedFamilyId, displayedFamilyName, displayedIdentity, displayedFingerprint, fontPageVisible]);

  function selectTarget(target: LibraryTarget) { setFocusedCloudFile(null); setLibraryTarget(target); setNativeDestination('local'); }
  function navigate(value: NativeDestination) {
    Keyboard.dismiss();
    setFocusedCloudFile(null);
    if (value === 'favorites') selectTarget({ scope: 'favorites' });
    else if (value.startsWith('collection:')) selectTarget({ scope: 'collection', collectionId: value.slice('collection:'.length) });
    else if (value.startsWith('smart:')) selectTarget({ scope: 'smart', smartFolderId: value.slice('smart:'.length) });
    else {
      setNativeDestination(value);
      if (value === 'local' && sidebar) setLibraryTarget({ scope: 'all' });
    }
  }
  async function recordVisit(family: FontFamily) {
    const attempt = ++recentAttempt.current;
    const face = representativeFace(family);
    if (!face) return;
    try { applySnapshot(await library.recordRecent(face.identityId)); if (attempt === recentAttempt.current) setRecentError(null); }
    catch { if (attempt === recentAttempt.current) setRecentError(t('mobile.errorRecent')); }
  }
  function openFamily(family: FontFamily, target: LibraryTarget = libraryTarget) {
    setFontPageCollectionId(target.scope === 'collection' ? target.collectionId : undefined);
    setRecentError(null); setFontPage(family); setFontPageVisible(true); void recordVisit(family);
  }

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
  const openCloudFont = async (font: import('./sync').CloudFont) => {
    try {
      const result = await library.query({scope:'all',text:'',fileFingerprint:font.fingerprint,offset:0,limit:100});
      if (result.families.length === 1) { setFontPage(result.families[0]!); setFontPageVisible(true); }
      else if (result.families.length > 1) {
        setFocusedCloudFile(font); setLibraryTarget({scope:'all'}); setNativeDestination('local'); setTab('local');
      }
    } catch { setRecentError(t('common.operationFailed')); }
  };
  const cloudContent = <CloudScreen onOpenFont={(font) => void openCloudFont(font)} theme={theme} sourceId={sourceId}
    active={(usesNativeControls ? nativeDestination === 'cloud' : tab === 'cloud') && !settingsPageVisible}
    snapshot={snapshot} controller={syncController} onConfigure={() => openSettingsPage('sync')} />;
  const settingsContent = <SettingsScreen theme={theme} sourceId={sourceId} controller={syncController}
    active={(usesNativeControls ? nativeDestination === 'settings' : tab === 'settings') && !settingsPageVisible}
    onOpenPage={openSettingsPage} />;
  const onHeroAction = (action: HeroAction) => {
    if (action === 'cloudSettings') openSettingsPage('sync');
    else if (action === 'cloudFonts') navigate('cloud');
  };
  const searchContent = <LibraryScreen syncController={syncController} onHeroAction={onHeroAction} syncBlocked={syncController.blocked} theme={theme} sourceId={sourceId} bottomInset={usesNativeControls ? 0 : inset.bottom}
    sidebar={sidebar} searchPage destination="search" target={searchTarget} snapshot={snapshot} libraryVersion={libraryVersion}
    initialError={initialError} defaultMode={preferences.defaultViewMode} preferencesReady={preferencesReady}
    showImportResults={preferences.importShowResults} onSnapshotChange={applySnapshot} onOpenFamily={(family) => openFamily(family, searchTarget)}
    onTargetChange={setSearchTarget} onRetryInitialize={() => setInitializeRetry((value) => value + 1)}
    active={usesNativeControls ? nativeDestination === 'search' : tab === 'search'} />;
  const content = usesNativeControls ? (
    <View style={[styles.app, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      <NativeNavigation theme={theme} sidebar={sidebar} destination={destination} snapshot={snapshot}
        settings={settingsContent} search={searchContent} cloud={cloudContent} onDestinationChange={navigate}>
        <LibraryScreen cloudFile={focusedCloudFile} syncController={syncController} onHeroAction={onHeroAction} syncBlocked={syncController.blocked} theme={theme} bottomInset={0} sidebar={sidebar} destination={destination} onSnapshotChange={applySnapshot}
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
      <TabScenes selectedId={tab} scenes={{
        local: <LibraryScreen cloudFile={focusedCloudFile} syncController={syncController} onHeroAction={onHeroAction} syncBlocked={syncController.blocked} theme={theme} sourceId={sourceId} bottomInset={inset.bottom} active={tab === 'local'} onOpenFamily={openFamily}
            target={libraryTarget} snapshot={snapshot} libraryVersion={libraryVersion} initialError={initialError}
            defaultMode={preferences.defaultViewMode} preferencesReady={preferencesReady} showImportResults={preferences.importShowResults}
            onSnapshotChange={applySnapshot} onTargetChange={selectTarget}
            onRetryInitialize={() => setInitializeRetry((value) => value + 1)} />,
        search: searchContent,
        cloud: cloudContent,
        settings: settingsContent,
      }} />
      <BottomNavigation sourceId={sourceId} selectedId={tab} dark={dark} theme={theme} hidden={keyboardVisible}
        bottomInset={inset.bottom} leftInset={inset.left} rightInset={inset.right}
        onSelectionChange={(id) => { Keyboard.dismiss(); setFocusedCloudFile(null); setTab(id); }} />
    </KeyboardAvoidingView>
  );

  const detail = fontPage ? (
    <FontDetails key={fontPage.id} family={fontPage} theme={theme}
      recentError={recentError} onRetryRecent={() => { if (fontPage) void recordVisit(fontPage); }}
      onFileAction={async (fingerprint,action) => {
        if (action === 'download') {
          await cloudSync.fontAction(fingerprint, action);
          syncController.requestSync();
          await syncController.refresh();
        } else {
          const success = await syncController.run(() => cloudSync.fontAction(fingerprint,action),true);
          if (success && action === 'includeUpload') syncController.requestSync();
        }
      }}
      snapshot={snapshot} collectionId={fontPageCollectionId}
      onSnapshotChange={applySnapshot} onClose={() => setFontPageVisible(false)} onFavorite={favorite} />
  ) : settingsPage ? settingsPageNode(settingsPage, theme, () => setSettingsPageVisible(false), syncController) : null;

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
  app: { flex: 1 }, screen: { flex: 1 },
  // 紧凑 iPad 窗口为系统控制按钮保留标准工具栏高度。
  windowControlsInset: { paddingTop: 44 },
  brand: { flex: 1, gap: 8, height: 44 }, logo: { width: 45.011, height: 16 },
  nativeBrand: { position: 'absolute', left: 26, zIndex: 1 },
  libraryTools: { paddingHorizontal: 16, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  rangeTitle: { fontSize: 16, fontWeight: '500', flexShrink: 1 },
  libraryCount: { fontSize: 14, lineHeight: 16, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  search: { flex: 1, paddingHorizontal: 12, minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 44, fontSize: 15, paddingVertical: 8 },
  content: { paddingHorizontal: 10, gap: 12 }, columns: { gap: 12 }, listItem: { width: '100%' },
  searchSummary: { fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
  notice: { marginVertical: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 }, retry: { minHeight: 44, justifyContent: 'center' },
  empty: { marginTop: 48, paddingHorizontal: 22, alignItems: 'center', gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '600' }, emptyDetail: { fontSize: 14, lineHeight: 22, textAlign: 'center' },
  importButton: { marginTop: 8, paddingHorizontal: 20, minHeight: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 6 },
  importLabel: { fontSize: 15, fontWeight: '600' }, loadingMore: { paddingVertical: 16 },
});
