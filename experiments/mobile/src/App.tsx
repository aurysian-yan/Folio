import { getDocumentAsync } from 'expo-document-picker';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import {
  MagnifyingGlassIcon, PlusIcon, XIcon,
} from 'phosphor-react-native';
import { useEffect, useId, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, FlatList, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet,
  Text, TextInput, useColorScheme, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontCard } from './FontCard';
import { FontDetails } from './FontDetails';
import { FontNavigation } from './FontNavigation';
import { ImportResults } from './ImportResults';
import { ViewModeMenu } from './ViewModeMenu';
import { AndroidHeaderBackdrop, AndroidHeaderControls } from './HeaderControls';
import { BottomNavigation, NavigationBackdrop, navigationContentInset, type MobileTab } from './bottom-navigation';
import { LibraryError, summarizeImport, type FontFamily, type ImportReport, type LibraryPage, type LibraryQuery, type LibrarySnapshot } from './library';
import { library } from './native';
import {
  NativeActionButton, NativeHeaderControls, NativeLibraryContent, NativeNavigation, NativeScrollContainer,
  usesNativeControls, usesNativeSidebar, type NativeDestination,
} from './native-controls';
import { IconButton, themes, type Theme } from './ui';

const pageSize = 40;
const emptyPage: LibraryPage = { totalMatches: 0, families: [] };
const LibraryList = Platform.OS === 'android' ? Animated.FlatList<FontFamily> : FlatList<FontFamily>;

function LibraryScreen({ theme, bottomInset, active, sourceId = '', sidebar = false, scope = 'all', destination = 'local', onSnapshotChange, onOpenFamily }: {
  theme: Theme;
  bottomInset: number;
  active: boolean;
  sourceId?: string;
  sidebar?: boolean;
  scope?: LibraryQuery['scope'];
  destination?: NativeDestination;
  onSnapshotChange?: (snapshot: LibrarySnapshot) => void;
  onOpenFamily: (family: FontFamily, onFavorite: (family: FontFamily) => Promise<void>) => void;
}) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [brandOpacity] = useState(() => new Animated.Value(1));
  const [headerScrollOffset] = useState(() => new Animated.Value(0));
  const [searchText, setSearchText] = useState('');
  const [queryText, setQueryText] = useState('');
  const [pagination, setPagination] = useState({ scope, offset: 0 });
  const offset = pagination.scope === scope ? pagination.offset : 0;
  const [loadedQuery, setLoadedQuery] = useState({ key: '', request: '', page: emptyPage });
  const [importing, setImporting] = useState(false);
  const importInFlight = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [importDetailsOpen, setImportDetailsOpen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
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
  const scrollTopInset = nativeInsets.contentTop ?? nativeInsets.top + (sidebar ? 0 : headerHeight * 1.25);
  const androidContentTop = inset.top + headerHeight;
  const reservesWindowControls = usesNativeSidebar && !sidebar && Number(Platform.Version) >= 26;
  const queryKey = JSON.stringify([scope, queryText, revision, retry]);
  const requestKey = JSON.stringify([queryKey, offset]);
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
    let mounted = true;
    library.initialize().then((value) => {
      if (mounted) { setSnapshot(value); setReady(true); setError(null); }
    }).catch(() => {
      if (mounted) setError('无法打开字体库，请重试。');
    });
    return () => { mounted = false; };
  }, [retry]);

  useEffect(() => { if (snapshot) onSnapshotChange?.(snapshot); }, [snapshot, onSnapshotChange]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryText(searchText.trim());
      setPagination({ scope, offset: 0 });
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }, 180);
    return () => clearTimeout(timer);
  }, [searchText, scope]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    library.query({ text: queryText, scope, offset, limit: pageSize }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setLoadedQuery((previous) => {
          const families = offset > 0 && previous.key === queryKey
            ? Array.from(new Map([...previous.page.families, ...result.families].map((family) => [family.id, family])).values())
            : result.families;
          return { key: queryKey, request: requestKey, page: { ...result, families } };
        });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted && !(cause instanceof LibraryError && cause.code === 'cancelled')) {
          setError('暂时无法读取字体库，请重试。');
          setLoadedQuery((previous) => ({ key: queryKey, request: requestKey,
            page: previous.key === queryKey ? previous.page : emptyPage }));
        }
      });
    return () => controller.abort();
  }, [ready, queryText, scope, offset, queryKey, requestKey]);

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
      setSnapshot(report.snapshot);
      setPagination({ scope, offset: 0 });
      setRevision((value) => value + 1);
    } catch (cause: unknown) {
      setImportError(cause instanceof LibraryError ? cause.message : '无法完成导入，请确认文件可用、空间充足后重试。');
    } finally { importInFlight.current = false; setImporting(false); }
  }

  async function favorite(family: FontFamily) {
    await library.setFavorite([...new Set(family.faces.map((face) => face.identityId))], !family.isFavorite);
    setLoadedQuery((previous) => ({ ...previous, page: { ...previous.page,
      families: previous.page.families.map((item) => item.id === family.id ? { ...item, isFavorite: !family.isFavorite } : item) } }));
    if (scope === 'favorites') {
      setPagination({ scope, offset: 0 });
      setRevision((value) => value + 1);
    }
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchText('');
    Keyboard.dismiss();
  }

  function retryQuery() {
    setError(null);
    setPagination({ scope, offset: 0 });
    setRetry((value) => value + 1);
  }

  function loadMore() {
    if (loading || error || waitingForSearch || page.families.length === 0) return;
    if (offset + pageSize < page.totalMatches) {
      setPagination((value) => value.scope === scope && value.offset !== offset ? value : { scope, offset: offset + pageSize });
    }
  }

  const toggleSearch = () => { if (searchOpen) closeSearch(); else setSearchOpen(true); };
  const titles = { local: '全部字体', recent: '最近', favorites: '收藏', cloud: '云端字体', settings: '设置' };
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
              onOpen={() => { Keyboard.dismiss(); onOpenFamily(item, favorite); }} />
          </View>
        )}
        ListHeaderComponent={
          <View>
            {!queryText && scope === 'all' && (
              <View style={styles.hero}>
                <Image source={require('../assets/design/lasso.svg')} style={styles.lasso} contentFit="contain" />
                <Text accessibilityRole="header" style={[styles.heroTitle, { color: theme.label }]}>
                  {snapshot ? `现有 ${snapshot.familyCount} 个字体，\n随时可用` : '你的字体，\n随时可用'}
                </Text>
                {snapshot && <Text style={[styles.heroDetail, { color: theme.secondary }]}>
                  {snapshot.damagedCount} 个损坏字体 · {snapshot.variableFamilyCount} 个可变字体 · {snapshot.recentCount} 个最近加入
                </Text>}
              </View>
            )}
            {(queryText !== '' || scope !== 'all') && <Text accessibilityRole="header" style={[styles.searchSummary, { color: theme.secondary }]}>
              {loading && page.families.length === 0 ? '正在读取…' : `${page.totalMatches} 个${queryText ? '搜索结果' : '字体'}`}
            </Text>}
            {(importReport || importError) && <View style={[styles.notice, { backgroundColor: theme.surface }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: importError ? theme.danger : theme.secondary }]}>
                {importError ?? (importCounts && `成功 ${importCounts.imported} · 重复 ${importCounts.duplicate} · 失败 ${importCounts.failed}`)}
              </Text>
              {usesNativeControls ? <NativeActionButton label={importError ? '重新选择' : '查看详情'} color={theme.accent}
                onPress={importError ? importFont : () => setImportDetailsOpen(true)} disabled={importing} plain />
                : <Pressable accessibilityRole="button" disabled={importing}
                  onPress={importError ? importFont : () => setImportDetailsOpen(true)} style={styles.retry}>
                  <Text style={{ color: theme.accent }}>{importError ? '重新选择' : '查看详情'}</Text>
                </Pressable>}
            </View>}
            {error && <View style={[styles.notice, { backgroundColor: theme.surface }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: theme.danger }]}>{error}</Text>
              {usesNativeControls ? <NativeActionButton label="重试" color={theme.accent} onPress={retryQuery} plain />
                : <Pressable accessibilityRole="button" onPress={retryQuery} style={styles.retry}>
                <Text style={{ color: theme.accent }}>重试</Text>
              </Pressable>}
            </View>}
          </View>
        }
        ListEmptyComponent={
          !ready || loading || waitingForSearch ? (error ? null : <ActivityIndicator style={styles.empty} color={theme.accent} accessibilityLabel="正在读取字体库" />)
            : error ? null : <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: theme.label }]}>{queryText ? '没有找到匹配的字体'
                : scope === 'favorites' ? '还没有收藏字体' : scope === 'recent' ? '还没有最近加入的字体' : '从第一个字体开始'}</Text>
              <Text style={[styles.emptyDetail, { color: theme.secondary }]}>{queryText ? '试试其他名称或样式。'
                : scope === 'favorites' ? '收藏的字体会显示在这里。' : '多选 TTF、OTF、TTC、OTC 字体，或导入 ZIP 字体包。'}</Text>
              {!queryText && scope !== 'favorites' && (usesNativeControls ? <NativeActionButton label={importing ? '正在导入…' : '导入字体'}
                systemImage="plus" color={theme.accent} onPress={importFont} disabled={importing} prominent />
                : <Pressable accessibilityRole="button" disabled={importing} onPress={importFont}
                style={({ pressed }) => [styles.importButton, { backgroundColor: theme.accent, opacity: pressed || importing ? 0.6 : 1 }]}>
                {importing ? <ActivityIndicator color={theme.onAccent} /> : <PlusIcon size={18} color={theme.onAccent} />}
                <Text style={[styles.importLabel, { color: theme.onAccent }]}>{importing ? '正在导入…' : '导入字体'}</Text>
              </Pressable>)}
            </View>
        }
        ListFooterComponent={loading && page.families.length > 0
          ? <ActivityIndicator style={styles.loadingMore} color={theme.accent} accessibilityLabel="正在读取更多字体" /> : null}
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
            {snapshot ? `${snapshot.familyCount} 个本地字体` : '本地字体'}
          </Text>
        </Animated.View>}
        {Platform.OS === 'android' ? <AndroidHeaderControls theme={theme} sourceId={sourceId} active={active}
          mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
          ready={ready} importing={importing} onModeChange={setMode} onImport={importFont}
          onSearch={toggleSearch} onSearchTextChange={setSearchText} /> : usesNativeControls ? <NativeHeaderControls theme={theme} mode={mode} searchOpen={searchOpen}
          width={width - 52} searchText={searchText} onSearchTextChange={setSearchText}
          ready={ready} importing={importing} onModeChange={setMode} onImport={importFont}
          onSearch={toggleSearch} /> : searchOpen ? (
          <View style={[styles.search, { backgroundColor: theme.surface }]}>
            <MagnifyingGlassIcon size={20} color={theme.secondary} />
            <TextInput ref={searchInput} autoFocus accessibilityLabel="搜索字体" placeholder="搜索字体名称或样式"
              placeholderTextColor={theme.muted} selectionColor={theme.selection} cursorColor={theme.accent}
              selectionHandleColor={theme.accent} value={searchText} editable={ready}
              onChangeText={setSearchText} style={[styles.searchInput, { color: theme.label }]}
              autoCapitalize="none" autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} />
            {searchText.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel="清除搜索"
              hitSlop={10} onPress={() => { setSearchText(''); searchInput.current?.focus(); }}>
              <XIcon size={18} color={theme.secondary} />
            </Pressable>}
            <Pressable accessibilityRole="button" accessibilityLabel="关闭搜索" onPress={closeSearch} style={styles.cancelSearch}>
              <XIcon size={20} color={theme.label} />
            </Pressable>
          </View>
        ) : <View style={styles.headerActions}>
          <ViewModeMenu sourceId={sourceId} theme={theme} mode={mode} active={active && !importing} onModeChange={setMode} />
          <IconButton theme={theme} label="搜索字体" onPress={() => setSearchOpen(true)}>
            <MagnifyingGlassIcon size={20} color={theme.label} />
          </IconButton>
          <IconButton theme={theme} label={importing ? '正在导入…' : '导入字体'} disabled={!ready || importing} busy={importing} onPress={importFont}>
            {importing ? <ActivityIndicator size="small" color={theme.label} /> : <PlusIcon size={20} color={theme.label} />}
          </IconButton>
        </View>}
      </View>}
      {Platform.OS === 'android' ? <NavigationBackdrop sourceId={active ? sourceId : ''}
        active={active} style={[styles.screen, { backgroundColor: theme.background }]}>{fontList}</NavigationBackdrop> : fontList}
      <ImportResults report={importReport} visible={importDetailsOpen && active} theme={theme}
        onClose={() => setImportDetailsOpen(false)} />
    </NativeScrollContainer>
  );

  if (sidebar) {
    return <NativeLibraryContent theme={theme} title={titles[destination]} active={active}
      subtitle={snapshot ? `${scope === 'all' ? snapshot.familyCount : page.totalMatches} 个字体` : '字体库'}
      mode={mode} width={width - 52} searchOpen={searchOpen} searchText={searchText}
      ready={ready} importing={importing} onModeChange={setMode} onSearch={toggleSearch}
      onSearchTextChange={setSearchText} onImport={importFont}>
      {active ? content : <View style={[styles.screen, { backgroundColor: theme.background }]} />}
    </NativeLibraryContent>;
  }
  return content;
}

function MobileApp() {
  const dark = useColorScheme() === 'dark';
  const theme = dark ? themes.dark : themes.light;
  const sourceId = useId();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // 紧凑窗口沿用 iPhone 导航，常规宽度启用原生侧栏。
  const sidebar = usesNativeSidebar && width >= 600;
  const [tab, setTab] = useState<MobileTab>('local');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [nativeDestination, setNativeDestination] = useState<NativeDestination>('local');
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [fontPage, setFontPage] = useState<{
    family: FontFamily;
    onFavorite: (family: FontFamily) => Promise<void>;
  } | null>(null);
  const [fontPageVisible, setFontPageVisible] = useState(false);
  const destination = !sidebar && nativeDestination === 'favorites' ? 'local' : nativeDestination;

  function openFamily(family: FontFamily, onFavorite: (family: FontFamily) => Promise<void>) {
    setFontPage({ family, onFavorite });
    setFontPageVisible(true);
  }

  async function favorite() {
    if (!fontPage) return;
    const { family, onFavorite } = fontPage;
    await onFavorite(family);
    setFontPage((current) => current?.family.id === family.id
      ? { ...current, family: { ...current.family, isFavorite: !family.isFavorite } } : current);
  }

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const content = usesNativeControls ? (
    <View style={[styles.app, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      <NativeNavigation theme={theme} sidebar={sidebar} destination={destination} snapshot={snapshot}
        onDestinationChange={(value) => { Keyboard.dismiss(); setNativeDestination(value); }}>
        <LibraryScreen theme={theme} bottomInset={0} sidebar={sidebar} destination={destination} onSnapshotChange={setSnapshot}
          scope={sidebar && destination === 'favorites' ? 'favorites'
            : sidebar && destination === 'recent' ? 'recent' : 'all'}
          active={destination === 'local' || (sidebar && (destination === 'recent' || destination === 'favorites'))}
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
          <LibraryScreen theme={theme} sourceId={sourceId} bottomInset={inset.bottom} active={tab === 'local'} onOpenFamily={openFamily} />
        </View>
        {tab !== 'local' && <NavigationBackdrop sourceId={sourceId} active={!keyboardVisible}
          style={[styles.screen, { backgroundColor: theme.background }]}><View style={styles.screen} /></NavigationBackdrop>}
      </View>
      {!keyboardVisible && <BottomNavigation sourceId={sourceId} selectedId={tab} dark={dark} theme={theme}
        bottomInset={inset.bottom} leftInset={inset.left} rightInset={inset.right}
        onSelectionChange={(id) => { Keyboard.dismiss(); setTab(id); }} />}
    </KeyboardAvoidingView>
  );

  return <FontNavigation visible={fontPageVisible} theme={theme}
    onDismissed={() => { setFontPageVisible(false); setFontPage(null); }}
    detail={fontPage && <FontDetails key={fontPage.family.id} family={fontPage.family} theme={theme}
      onClose={() => setFontPageVisible(false)} onFavorite={favorite} />}>
    {content}
  </FontNavigation>;
}

export default function App() {
  return <SafeAreaProvider><MobileApp /></SafeAreaProvider>;
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
  nativeBrand: { position: 'absolute', left: 26, right: 210 },
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
