import { getDocumentAsync } from 'expo-document-picker';
import { Image } from 'expo-image';
import { StatusBar } from 'expo-status-bar';
import {
  CaretDownIcon, CheckIcon, ClockIcon, CloudIcon, GearIcon, ListIcon,
  MagnifyingGlassIcon, PlusIcon, SquaresFourIcon, TextAaIcon, XIcon,
} from 'phosphor-react-native';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet,
  Text, TextInput, useColorScheme, useWindowDimensions, View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontCard } from './FontCard';
import { LibraryError, type FontFamily, type LibraryPage, type LibrarySnapshot } from './library';
import { library } from './native';
import { NativeActionButton, NativeHeaderControls, NativeTabs, usesNativeControls } from './native-controls';
import { IconButton, themes, type Theme } from './ui';

const pageSize = 40;
const emptyPage: LibraryPage = { totalMatches: 0, families: [] };
const tabs = [
  { id: 'local', label: '本地', icon: TextAaIcon },
  { id: 'recent', label: '最近', icon: ClockIcon },
  { id: 'cloud', label: '云端', icon: CloudIcon },
  { id: 'settings', label: '设置', icon: GearIcon },
] as const;
type Tab = typeof tabs[number]['id'];

function LibraryScreen({ theme, bottomInset, active }: { theme: Theme; bottomInset: number; active: boolean }) {
  const [snapshot, setSnapshot] = useState<LibrarySnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [queryText, setQueryText] = useState('');
  const [offset, setOffset] = useState(0);
  const [loadedQuery, setLoadedQuery] = useState({ key: '', request: '', page: emptyPage });
  const [importing, setImporting] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null);
  const [mode, setMode] = useState<'grid' | 'list'>('grid');
  const [menuOpen, setMenuOpen] = useState(false);
  const searchInput = useRef<TextInput>(null);
  const list = useRef<FlatList<FontFamily>>(null);
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const queryKey = JSON.stringify([queryText, revision, retry]);
  const requestKey = JSON.stringify([queryKey, offset]);
  const loading = ready && loadedQuery.request !== requestKey;
  const page = loadedQuery.key === queryKey ? loadedQuery.page : emptyPage;
  const waitingForSearch = searchText.trim() !== queryText;

  useEffect(() => {
    let mounted = true;
    library.initialize().then((value) => {
      if (mounted) { setSnapshot(value); setReady(true); setError(null); }
    }).catch(() => {
      if (mounted) setError('无法打开字体库，请重试。');
    });
    return () => { mounted = false; };
  }, [retry]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQueryText(searchText.trim());
      setOffset(0);
      setSelectedFamily(null);
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }, 180);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    library.query({ text: queryText, scope: 'all', offset, limit: pageSize }, controller.signal)
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
  }, [ready, queryText, offset, queryKey, requestKey]);

  async function importFont() {
    setMenuOpen(false);
    setImporting(true);
    setError(null);
    try {
      const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
      const asset = result.assets?.[0];
      if (result.canceled || !asset) return;
      setSnapshot(await library.importFont(asset.uri));
      setOffset(0);
      setSelectedFamily(null);
      setRevision((value) => value + 1);
    } catch {
      setError('无法导入此文件，请选择可读取的 TTF、OTF、TTC 或 OTC 字体。');
    } finally { setImporting(false); }
  }

  async function favorite(family: FontFamily) {
    try {
      await library.setFavorite([...new Set(family.faces.map((face) => face.identityId))], !family.isFavorite);
      setLoadedQuery((previous) => ({ ...previous, page: { ...previous.page,
        families: previous.page.families.map((item) => item.id === family.id ? { ...item, isFavorite: !family.isFavorite } : item) } }));
    } catch { setError('无法更新收藏，请重试。'); }
  }

  function closeSearch() {
    setSearchOpen(false);
    setSearchText('');
    Keyboard.dismiss();
  }

  function retryQuery() {
    setError(null);
    setOffset(0);
    setRetry((value) => value + 1);
  }

  function loadMore() {
    if (loading || error || waitingForSearch || page.families.length === 0) return;
    if (offset + pageSize < page.totalMatches) setOffset((value) => value === offset ? value + pageSize : value);
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {!searchOpen && <View style={[styles.brand, usesNativeControls && styles.nativeBrand]}>
          <Image source={require('../assets/design/folio.svg')} style={styles.logo}
            tintColor={theme.label} contentFit="contain" accessibilityLabel="Folio" />
          <Text numberOfLines={1} style={[styles.libraryCount, { color: theme.muted }]}>
            {snapshot ? `${snapshot.familyCount} 个本地字体` : '本地字体'}
          </Text>
        </View>}
        {usesNativeControls ? <NativeHeaderControls theme={theme} mode={mode} searchOpen={searchOpen}
          width={width - inset.left - inset.right - 52} searchText={searchText} onSearchTextChange={setSearchText}
          ready={ready} importing={importing} onModeChange={setMode} onImport={importFont}
          onSearch={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }} /> : searchOpen ? (
          <View style={[styles.search, { backgroundColor: theme.surface }]}>
            <MagnifyingGlassIcon size={20} color={theme.secondary} />
            <TextInput ref={searchInput} autoFocus accessibilityLabel="搜索字体" placeholder="搜索字体名称或样式"
              placeholderTextColor={theme.muted} value={searchText} editable={ready}
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
          <IconButton theme={theme} label="视图选项" selected={menuOpen} onPress={() => { Keyboard.dismiss(); setMenuOpen(true); }}
            style={styles.viewButton}>
            {mode === 'grid' ? <SquaresFourIcon size={20} color={theme.label} /> : <ListIcon size={20} color={theme.label} />}
            <CaretDownIcon size={10} color={theme.label} />
          </IconButton>
          <IconButton theme={theme} label="搜索字体" onPress={() => setSearchOpen(true)}>
            <MagnifyingGlassIcon size={20} color={theme.label} />
          </IconButton>
          <IconButton theme={theme} label={importing ? '正在导入…' : '导入字体'} disabled={!ready || importing} onPress={importFont}>
            <PlusIcon size={20} color={theme.label} />
          </IconButton>
        </View>}
      </View>
      <FlatList ref={list} key={mode} data={page.families} keyExtractor={(family) => family.id}
        numColumns={mode === 'grid' ? 2 : 1} columnWrapperStyle={mode === 'grid' ? styles.columns : undefined}
        contentContainerStyle={[styles.content, { paddingBottom: usesNativeControls ? 24 : bottomInset + 96 }]}
        keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"
        initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
        onEndReached={loadMore} onEndReachedThreshold={0.4}
        renderItem={({ item }) => (
          <View style={mode === 'grid' ? { width: (width - inset.left - inset.right - 32) / 2 } : styles.listItem}>
            <FontCard family={item} selected={selectedFamily === item.id} mode={mode} theme={theme}
              onSelect={() => setSelectedFamily((current) => current === item.id ? null : item.id)}
              onFavorite={() => favorite(item)} />
          </View>
        )}
        ListHeaderComponent={
          <View>
            {!queryText && (
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
            {queryText !== '' && <Text accessibilityRole="header" style={[styles.searchSummary, { color: theme.secondary }]}>
              {loading && page.families.length === 0 ? '正在搜索…' : `${page.totalMatches} 个搜索结果`}
            </Text>}
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
              <Text style={[styles.emptyTitle, { color: theme.label }]}>{queryText ? '没有找到匹配的字体' : '从第一个字体开始'}</Text>
              <Text style={[styles.emptyDetail, { color: theme.secondary }]}>{queryText ? '试试其他名称或样式。' : '导入 TTF、OTF、TTC 或 OTC 字体。'}</Text>
              {!queryText && (usesNativeControls ? <NativeActionButton label={importing ? '正在导入…' : '导入字体'}
                systemImage="plus" color={theme.accent} onPress={importFont} disabled={importing} prominent />
                : <Pressable accessibilityRole="button" disabled={importing} onPress={importFont}
                style={({ pressed }) => [styles.importButton, { backgroundColor: theme.accent, opacity: pressed || importing ? 0.6 : 1 }]}>
                {importing ? <ActivityIndicator color={theme.background} /> : <PlusIcon size={18} color={theme.background} />}
                <Text style={[styles.importLabel, { color: theme.background }]}>{importing ? '正在导入…' : '导入字体'}</Text>
              </Pressable>)}
            </View>
        }
        ListFooterComponent={loading && page.families.length > 0
          ? <ActivityIndicator style={styles.loadingMore} color={theme.accent} accessibilityLabel="正在读取更多字体" /> : null}
      />
      <Modal transparent visible={!usesNativeControls && menuOpen && active} animationType="none" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.menuOverlay}>
          <Pressable accessibilityLabel="关闭视图选项" onPress={() => setMenuOpen(false)}
            style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }]} />
          <View accessibilityViewIsModal style={[styles.menu, {
            top: inset.top + 62, right: Math.max(22, inset.right + 10),
            backgroundColor: theme.raised, borderColor: theme.border,
          }]}>
            <Text style={[styles.menuTitle, { color: theme.secondary }]}>视图</Text>
            {(['grid', 'list'] as const).map((value) => (
              <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: mode === value }}
                onPress={() => { setMode(value); setMenuOpen(false); }}
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: theme.surface }]}>
                {value === 'grid' ? <SquaresFourIcon size={20} color={theme.label} /> : <ListIcon size={20} color={theme.label} />}
                <Text style={[styles.menuLabel, { color: theme.label }]}>{value === 'grid' ? '网格视图' : '列表视图'}</Text>
                {mode === value && <CheckIcon size={18} color={theme.accent} />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function MobileApp() {
  const theme = useColorScheme() === 'dark' ? themes.dark : themes.light;
  const inset = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('local');
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [nativeLocalActive, setNativeLocalActive] = useState(true);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => setKeyboardVisible(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  if (usesNativeControls) {
    return <View style={[styles.app, { backgroundColor: theme.background }]}>
      <StatusBar style="auto" />
      <NativeTabs theme={theme} onTabChange={(local) => { Keyboard.dismiss(); setNativeLocalActive(local); }}>
        <LibraryScreen theme={theme} bottomInset={0} active={nativeLocalActive} />
      </NativeTabs>
    </View>;
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.app, { backgroundColor: theme.background, paddingTop: inset.top,
      paddingLeft: inset.left, paddingRight: inset.right }]}>
      <StatusBar style="auto" />
      <View style={[styles.screen, tab !== 'local' && styles.hidden]}>
        <LibraryScreen theme={theme} bottomInset={inset.bottom} active={tab === 'local'} />
      </View>
      {tab !== 'local' && <View style={styles.screen} />}
      {!keyboardVisible && <View style={[styles.tabDock, { bottom: inset.bottom + 8, left: inset.left + 20, right: inset.right + 20 }]}>
        <View accessibilityRole="tablist" style={[styles.tabBar, { backgroundColor: theme.tab, borderColor: theme.border }]}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <Pressable key={id} accessibilityRole="tab" accessibilityLabel={label}
              accessibilityState={{ selected: id === tab }} onPress={() => { Keyboard.dismiss(); setTab(id); }}
              style={({ pressed }) => [styles.tab, {
                backgroundColor: id === tab ? theme.activeTab : 'transparent',
                opacity: pressed ? 0.6 : 1,
              }]}>
              <Icon size={27} color={id === tab ? theme.accent : theme.label} />
              <Text style={[styles.tabLabel, { color: id === tab ? theme.accent : theme.label }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
      </View>}
    </KeyboardAvoidingView>
  );
}

export default function App() {
  return <SafeAreaProvider><MobileApp /></SafeAreaProvider>;
}

const styles = StyleSheet.create({
  app: { flex: 1 }, screen: { flex: 1 }, hidden: { display: 'none' },
  header: { minHeight: 64, paddingHorizontal: 26, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flex: 1, gap: 8 }, logo: { width: 45.011, height: 16 },
  nativeBrand: { position: 'absolute', left: 26, right: 210 },
  libraryCount: { fontSize: 14, lineHeight: 16, fontWeight: '500' },
  headerActions: { flexDirection: 'row', gap: 10, alignItems: 'center' }, viewButton: { paddingHorizontal: 12 },
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
  menuOverlay: { flex: 1 },
  menu: { position: 'absolute', width: 220, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, paddingVertical: 6, overflow: 'hidden' },
  menuTitle: { fontSize: 12, paddingHorizontal: 16, paddingVertical: 8 },
  menuItem: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  menuLabel: { flex: 1, fontSize: 16 },
  tabDock: { position: 'absolute' },
  tabBar: { minHeight: 64, borderRadius: 32, borderWidth: StyleSheet.hairlineWidth, padding: 4, flexDirection: 'row', alignItems: 'center' },
  tab: { flex: 1, minHeight: 54, borderRadius: 27, justifyContent: 'center', alignItems: 'center', gap: 3, paddingVertical: 4 },
  tabLabel: { fontSize: 10, fontWeight: '600', lineHeight: 13 },
});
