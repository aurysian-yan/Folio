import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MagnifyingGlassIcon, XIcon } from './icons';
import { NativeFontPreview, NativeOnlineBrowser, online } from './native';
import {
  buildWebThemeScript, extractSearchQuery, isPageFailureKey, onlineErrorKey, providerCustomCss, providerThemeEnabled,
  type BrowserState, type OnlineEntry, type OnlineProvider, type OnlineState, type WebPalette,
} from './online';
import { providerRegionRisk } from './online-region';
import { mostRecentTab } from './online-tabs';
import { useOnlineRegion } from './useOnlineRegion';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction } from './panel-content';
import { formatBytes } from './settings-ui';
import { usePreferences } from './settings';
import { type Theme } from './ui';
import { navigationBarTopInset, navigationCompactBarFrame, NavigationBackdrop } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import type { LibrarySnapshot } from './library';
import { OnlineHeader } from './OnlineHeader';
import { OnlineBrowserBar } from './OnlineBrowserBar';
import { OnlineBrowserLoading } from './OnlineBrowserLoading';
import { OnlineBrowserFailure } from './OnlineBrowserFailure';

const emptyBrowser: BrowserState = { url: '', title: '', loading: true, canGoBack: false, canGoForward: false, errorKey: null };

// 每个来源保留独立标签页；切换来源只切换可见网页，不重新导航。
interface OnlineTab {
  providerId: string;
  provider: OnlineProvider;
  address: string;
  browser: BrowserState;
  command: string;
  revealRequest: string;
  activatedAt: number;
}

// 页面只控制浏览与确认，下载和导入由原生服务持有。
export function OnlineFontsScreen({ theme, active, webPalette, sourceId = '', navigationCollapsed = false, onSnapshotChange, onOpenSettings, onOpenedChange }: {
  theme: Theme; active: boolean; webPalette: WebPalette;
  sourceId?: string; navigationCollapsed?: boolean;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void; onOpenSettings: () => void;
  onOpenedChange?: (opened: boolean) => void;
}) {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<OnlineState | null>(null);
  const [tabs, setTabs] = useState<OnlineTab[]>([]);
  const [activeId, setActiveId] = useState('');
  const [lastProvider, setLastProvider] = useState<OnlineProvider | null>(null);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [panel, setPanel] = useState<'downloads' | 'inspect' | null>(null);
  const [entries, setEntries] = useState<OnlineEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const serial = useRef(0);
  const order = useRef(0);
  const operation = useRef(false);
  const navigationRequest = useRef(0);
  const tabsRef = useRef<OnlineTab[]>([]);
  const activeTab = tabs.find((tab) => tab.providerId === activeId) ?? null;
  const enabledProviders = state?.providers.filter((item) => item.enabled) ?? [];
  const regionSensitive = enabledProviders.some(providerRegionRisk);
  const regionKind = useOnlineRegion(!!preferences.onlineRegionHints && active && !!state?.accepted && regionSensitive);

  function providerFor(tab: OnlineTab | null) {
    if (!tab) return null;
    return state?.providers.find((item) => item.id === tab.providerId) ?? tab.provider;
  }
  const activeProvider = providerFor(activeTab);
  const provider = activeProvider ?? lastProvider;
  const opened = activeTab !== null;

  const updateTab = useCallback((id: string, update: (tab: OnlineTab) => OnlineTab) => {
    setTabs((values) => values.map((tab) => tab.providerId === id ? update(tab) : tab));
  }, []);
  const sendTo = useCallback((id: string, action: string, url?: string, reveal = false) => {
    const commandId = String(++serial.current);
    setTabs((values) => values.map((tab) => tab.providerId === id ? {
      ...tab,
      address: action === 'navigate' && url ? url : tab.address,
      command: JSON.stringify({ id: commandId, action, url, reveal }),
      revealRequest: reveal ? commandId : '',
      browser: ['navigate', 'back', 'forward', 'reload'].includes(action)
        ? { ...tab.browser, loading: true, errorKey: null } : tab.browser,
    } : tab));
  }, []);
  const closeTab = useCallback((id: string) => {
    navigationRequest.current += 1;
    const remaining = tabsRef.current.filter((tab) => tab.providerId !== id);
    const next = mostRecentTab(remaining);
    tabsRef.current = remaining;
    setTabs(remaining);
    setActiveId(next?.providerId ?? '');
    setError(null);
    if (!next) {
      setPanel(null);
      return;
    }
    setLastProvider(next.provider);
    const value = extractSearchQuery(next.provider, next.browser.url);
    if (value) setQuery(value);
  }, []);
  const refresh = useCallback(async () => {
    const value = await online.state();
    if (mounted.current) setState(value);
    return value;
  }, []);

  useLayoutEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // 只有真正打开网页后才收拢底栏，未进入页面时保持展开。
  useEffect(() => { onOpenedChange?.(opened); }, [onOpenedChange, opened]);
  useEffect(() => {
    if (!active) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try { await refresh(); } catch (cause) { if (current) setError(onlineErrorKey(cause)); }
      if (current) timer = setTimeout(() => void poll(), 1500);
    };
    void poll();
    const subscription = AppState.addEventListener('change', (value) => { if (value === 'active') void refresh().catch(() => {}); });
    return () => { current = false; clearTimeout(timer); subscription.remove(); };
  }, [active, refresh]);
  useEffect(() => {
    if (!active || !activeTab) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) { if (!operation.current) setPanel(null); return true; }
      if (activeTab.browser.canGoBack) sendTo(activeTab.providerId, 'back');
      else closeTab(activeTab.providerId);
      return true;
    });
    return () => subscription.remove();
  }, [active, activeTab, closeTab, panel, sendTo]);

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { if (mounted.current) setError(onlineErrorKey(cause)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  function openPage(item: OnlineProvider, url: string, reveal: boolean) {
    navigationRequest.current += 1;
    const commandId = String(++serial.current);
    const activatedAt = ++order.current;
    const command = JSON.stringify({ id: commandId, action: 'navigate', url, reveal });
    const revealRequest = reveal ? commandId : '';
    setTabs((values) => {
      const current = values.find((tab) => tab.providerId === item.id);
      if (current) {
        return values.map((tab) => tab.providerId === item.id ? {
          ...tab, provider: item, address: url, command, revealRequest, activatedAt,
          browser: { ...tab.browser, loading: true, errorKey: null },
        } : tab);
      }
      return [...values, {
        providerId: item.id, provider: item, address: url, command, revealRequest, activatedAt,
        browser: emptyBrowser,
      }];
    });
    setActiveId(item.id);
    setLastProvider(item);
    setSearchOpen(false);
    Keyboard.dismiss();
  }
  async function visit(item: OnlineProvider, search = query, reveal = false) {
    const request = ++navigationRequest.current;
    await run(async () => {
      const url = await online.search(item.id, search.trim());
      if (request !== navigationRequest.current) return;
      openPage(item, url, reveal);
    });
  }
  function activateTab(id: string) {
    navigationRequest.current += 1;
    const tab = tabs.find((value) => value.providerId === id);
    if (!tab) return;
    const activatedAt = ++order.current;
    setActiveId(id);
    setTabs((values) => values.map((value) => value.providerId === id ? { ...value, activatedAt } : value));
    const item = providerFor(tab) ?? tab.provider;
    setLastProvider(item);
    setSearchOpen(false);
    setError(null);
    Keyboard.dismiss();
    const next = extractSearchQuery(item, tab.browser.url);
    if (next) setQuery(next);
  }
  function selectProvider(item: OnlineProvider) {
    Keyboard.dismiss();
    setSearchOpen(false);
    if (tabs.some((tab) => tab.providerId === item.id)) activateTab(item.id);
    else void visit(item, query, true);
  }
  function submitSearch() {
    const item = activeProvider ?? lastProvider ?? enabledProviders[0];
    if (item) void visit(item, query, false);
  }
  async function inspect(id: string) {
    await run(async () => {
      const value = await online.inspect(id);
      setEntries(value); setSelected(value.filter((item) => item.eligible && !item.duplicate).map((item) => item.id));
      setInspectId(id); setPreviewId(null); setPanel('inspect');
    });
  }
  function confirmDownload(intent: { id: string; name: string }) {
    Alert.alert(t('online.browser.download'), intent.name, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('online.browser.download'), onPress: () => void run(async () => {
        await online.download(intent.id); await refresh(); setPanel('downloads');
      }) },
    ]);
  }
  function retryPage() {
    if (!activeTab) return;
    const target = (activeTab.browser.url || activeTab.address).trim();
    if (!target) return;
    setError(null);
    sendTo(activeTab.providerId, 'navigate', target);
  }
  function switchSource() {
    if (activeTab) closeTab(activeTab.providerId);
  }
  function webThemeFor(item: OnlineProvider) {
    return buildWebThemeScript({
      palette: webPalette, dark: theme.dark,
      enabled: providerThemeEnabled(preferences.onlineTheme[item.id], item.id),
      customCss: providerCustomCss(preferences.onlineCss[item.id], item.id),
    });
  }
  const providerRestricted = !!provider && providerRegionRisk(provider);
  const regionHint = providerRestricted && provider && preferences.onlineRegionHints
    ? regionKind === 'CN'
      ? t('online.browser.regionHint', { name: provider.name })
      : regionKind === 'UNKNOWN' ? t('online.browser.regionHintSoft', { name: provider.name }) : null
    : null;
  const loadingHint = regionKind === 'CN' ? regionHint : null;
  const browserFailure = !!activeTab && !activeTab.browser.loading && isPageFailureKey(activeTab.browser.errorKey);
  const failureHint = activeTab && (activeTab.browser.errorKey === 'online.browser.unreachable'
    || activeTab.browser.errorKey === 'online.browser.loadError') ? regionHint : null;
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  const feedback = (error || notice) ? <View style={styles.feedback}>
    {errorNode}{notice && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{notice}</Text>}
  </View> : null;
  const barBottom = usesNativeControls ? inset.bottom + 8 : navigationBarTopInset(inset.bottom) + 8;
  // 未进入网页时按展开导航留白，让搜索框在内容区垂直居中；进入后固定为紧凑控件高度。
  const browserBottom = Platform.OS === 'android'
    ? opened
      ? navigationCompactBarFrame(inset.bottom, width - inset.left - inset.right).bottom + 64
      : navigationBarTopInset(inset.bottom)
    : opened ? barBottom + 64 : barBottom;

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    {state?.accepted && <OnlineHeader theme={theme} providers={enabledProviders} selectedId={activeId}
      searchOpen={searchOpen} searchText={query} onSelect={selectProvider}
      onSearchChange={setQuery} onSearchOpen={() => { setSearchOpen(true); Keyboard.dismiss(); }}
      onSearchClose={() => { setSearchOpen(false); Keyboard.dismiss(); }} onSearchSubmit={submitSearch}
      onDownloads={() => setPanel('downloads')} />}
    {!state ? <View style={styles.content}>{errorNode ?? <ActivityIndicator color={theme.accent} />}
      {error && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await refresh(); })} disabled={busy} />}</View>
      : !state.accepted ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.text, { color: theme.label }]}>{t('online.browser.disclaimer')}</Text>
        {errorNode}
        <PanelAction primary label={t('online.browser.accept')} theme={theme} disabled={busy}
          onPress={() => void run(async () => { await online.accept(); await refresh(); })} />
      </ScrollView> : <>
        {feedback}
        <View style={[styles.browserArea, { paddingBottom: browserBottom }]}>
          {activeTab ? <NavigationBackdrop sourceId={active ? sourceId : ''} active={active} theme={theme}
            compositingLayer style={styles.screen}>
            {tabs.map((tab) => {
              const isActive = tab.providerId === activeId;
              const item = providerFor(tab) ?? tab.provider;
              return <NativeOnlineBrowser key={tab.providerId}
                style={[styles.tab, { backgroundColor: theme.background, zIndex: isActive ? 1 : 0 }]}
                active={active && panel === null && isActive}
                pointerEvents={isActive ? 'auto' : 'none'}
                provider={JSON.stringify(item)} command={tab.command} webTheme={webThemeFor(item)} accentColor={theme.accent}
                onBrowserState={({ nativeEvent }) => {
                  updateTab(tab.providerId, (value) => ({
                    ...value,
                    browser: nativeEvent,
                    address: nativeEvent.url.startsWith('https://') ? nativeEvent.url : value.address,
                  }));
                  if (tab.providerId !== activeId) return;
                  // 整页失败由失败页展示，其他错误仍走顶部提示。
                  if (nativeEvent.errorKey) {
                    if (!isPageFailureKey(nativeEvent.errorKey)) setError(nativeEvent.errorKey);
                  } else {
                    setError((value) => value && isPageFailureKey(value) ? null : value);
                  }
                  const next = extractSearchQuery(item, nativeEvent.url);
                  if (next && !searchOpen && next !== query) setQuery(next);
                }}
                onDownloadIntent={({ nativeEvent }) => confirmDownload(nativeEvent)} />;
            })}
            <OnlineBrowserLoading key={activeId} loading={activeTab.browser.loading} failed={browserFailure} hint={loadingHint}
              active={active && panel === null} revealRequest={activeTab.revealRequest} provider={activeProvider} theme={theme} />
            {browserFailure && <OnlineBrowserFailure key={`failure-${activeId}`} theme={theme} provider={activeProvider} errorKey={activeTab.browser.errorKey}
              url={activeTab.browser.url || activeTab.address} hint={failureHint} preferSwitch={!!failureHint}
              onRetry={retryPage} onSwitchSource={switchSource} />}
          </NavigationBackdrop>
            : <View style={styles.start}>
              <View style={[styles.startSearch, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <MagnifyingGlassIcon size={20} color={theme.secondary} />
                <TextInput value={query} onChangeText={setQuery} onSubmitEditing={submitSearch}
                  placeholder={t('online.search')} placeholderTextColor={theme.muted} selectionColor={theme.selection}
                  returnKeyType="search" autoCapitalize="none" autoCorrect={false}
                  accessibilityLabel={t('online.search')} style={[styles.startInput, { color: theme.label }]} />
                {query.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={t('mobile.clearSearch')}
                  hitSlop={10} onPress={() => setQuery('')}>
                  <XIcon size={16} color={theme.secondary} />
                </Pressable>}
              </View>
              <Pressable accessibilityRole="button" onPress={onOpenSettings}
                style={({ pressed }) => [styles.startSources, { opacity: pressed ? 0.6 : 1 }]}>
                <Text style={[styles.startSourcesLabel, { color: theme.secondary }]}>{t('online.browser.sources')}</Text>
              </Pressable>
            </View>}
        </View>
        {activeTab && <OnlineBrowserBar theme={theme} provider={activeProvider} browser={activeTab.browser} address={activeTab.address}
          sourceId={sourceId} compact={Platform.OS === 'android' && navigationCollapsed}
          bottom={barBottom}
          onAddressChange={(value) => updateTab(activeTab.providerId, (tab) => ({ ...tab, address: value }))}
          onNavigate={() => { Keyboard.dismiss(); const target = activeTab.address.trim(); if (target) sendTo(activeTab.providerId, 'navigate', target); }}
          onBack={() => sendTo(activeTab.providerId, 'back')} onForward={() => sendTo(activeTab.providerId, 'forward')}
          onClose={() => closeTab(activeTab.providerId)} />}
      </>}
    <LibraryPanel visible={panel !== null} title={t(panel === 'inspect' ? 'online.browser.review' : 'online.browser.downloads')}
      theme={theme} busy={busy} onClose={() => setPanel(null)}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {errorNode}
        {panel === 'downloads' && state && <>
          {!state.jobs.some((job) => job.state !== 'cancelled') && <Text style={{ color: theme.secondary }}>{t('online.browser.noDownloads')}</Text>}
          {state.jobs.filter((job) => job.state !== 'cancelled').map((job) => <View key={job.id} style={[styles.job, { backgroundColor: theme.surface }]}>
            <Text style={[styles.jobName, { color: theme.label }]}>{job.name}</Text>
            <Text style={{ color: theme.secondary }}>{t(`online.browser.states.${job.state}`)} · {formatBytes(job.bytesDone)}{job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''}</Text>
            <Text numberOfLines={2} style={{ color: theme.secondary }}>{job.origin.providerName} · {job.origin.downloadHost}</Text>
            {job.errorKey && <Text style={{ color: theme.danger }}>{t(job.errorKey)}</Text>}
            <View style={[styles.row, styles.wrap]}>
              {['queued', 'transferring'].includes(job.state) && <PanelAction label={t('online.browser.pause')} theme={theme} disabled={busy} onPress={() => void run(async () => { await online.pause(job.id); await refresh(); })} />}
              <PanelAction label={t('online.browser.openSource')} theme={theme} disabled={busy} onPress={() => {
                const item = state.providers.find((value) => value.id === job.origin.providerId) ?? { id: job.origin.providerId ?? 'history', name: job.origin.providerName, homepage: job.origin.sourcePageUrl, searchTemplate: '', enabled: false, builtin: false };
                openPage(item, job.origin.sourcePageUrl, false);
                setPanel(null);
              }} />
              {job.state === 'ready' && <>{<PanelAction label={t('online.browser.review')} theme={theme} onPress={() => void inspect(job.id)} disabled={busy} />}{<PanelAction label={t('online.browser.saveFile')} theme={theme} onPress={() => void run(() => online.save(job.id))} disabled={busy} />}</>}
              {['failed', 'paused', 'needsUser'].includes(job.state) && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await online.retry(job.id); await refresh(); })} disabled={busy} />}
              {<PanelAction label={t(['queued', 'transferring'].includes(job.state) ? 'common.cancel' : 'common.remove')} theme={theme} onPress={() => void run(async () => { await online.cancel(job.id); await refresh(); })} disabled={busy} />}
            </View>
          </View>)}
        </>}
        {panel === 'inspect' && <>
          <Text style={{ color: theme.secondary }}>{t('online.browser.importNotice')}</Text>
          {!entries.length && <Text style={{ color: theme.secondary }}>{t('online.browser.noFonts')}</Text>}
          {entries.map((entry) => <View key={entry.id} style={[styles.job, { backgroundColor: theme.surface }]}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(entry.id), disabled: !entry.eligible || busy }} disabled={!entry.eligible || busy}
              onPress={() => setSelected((values) => values.includes(entry.id) ? values.filter((id) => id !== entry.id) : [...values, entry.id])}>
              <Text style={[styles.jobName, { color: theme.label }]}>{selected.includes(entry.id) ? '☑ ' : '☐ '}{entry.name}</Text>
              <Text style={{ color: theme.secondary }}>{formatBytes(entry.size)} · {t(!entry.eligible ? 'online.browser.invalidFont' : entry.duplicate ? 'online.browser.duplicate' : 'online.browser.available')}</Text>
              {entry.analysis?.faces.map((face, index) => <Text key={index} style={{ color: theme.secondary }}>{face.family} · {face.style}{face.conflict ? ` · ${t('online.browser.conflict')}` : ''}</Text>)}
            </Pressable>
            {entry.eligible && entry.previewPath && <PanelAction label={t('common.preview')} theme={theme} disabled={busy} onPress={() => setPreviewId(entry.id)} />}
            {previewId === entry.id && entry.previewPath && entry.analysis?.faces[0] && <NativeFontPreview style={styles.fontPreview}
              selection={{ sourcePath: entry.previewPath, faceIndex: entry.analysis.faces[0].faceIndex, revisionId: entry.analysis.fingerprint,
                axes: {}, text: query || entry.analysis.faces[0].family, fontSize: 28, foregroundColor: theme.label }} onStatus={() => {}} />}
          </View>)}
          <PanelAction primary label={t('online.browser.collect', { count: selected.length })} disabled={busy || !selected.length} theme={theme}
            onPress={() => void run(async () => {
              const result = await online.collect(inspectId, selected); onSnapshotChange(result.snapshot); await refresh();
              const failed = result.items.filter((item) => item.status === 'failed' || item.status === 'unprocessed');
              if (failed.length) { setError('online.browser.importError'); setEntries(await online.inspect(inspectId)); }
              else { setNotice(t('online.browser.collected')); setPanel('downloads'); }
            })} />
        </>}
        {busy && <ActivityIndicator color={theme.accent} />}
      </ScrollView>
    </LibraryPanel>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  tab: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  browserArea: { flex: 1 },
  start: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28, paddingBottom: 16, gap: 14 },
  startSearch: { width: '100%', maxWidth: 420, minHeight: 52, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  startInput: { flex: 1, minHeight: 52, fontSize: 16, paddingVertical: 8 },
  startSources: { paddingHorizontal: 12, paddingVertical: 6 },
  startSourcesLabel: { fontSize: 13, fontWeight: '500' },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  wrap: { flexWrap: 'wrap' },
  text: { fontSize: 16, lineHeight: 24 },
  feedback: { paddingHorizontal: 16, paddingVertical: 6, gap: 4 },
  fontPreview: { height: 120 },
  job: { padding: 16, gap: 8 }, jobName: { fontSize: 16, fontWeight: '600' },
});
