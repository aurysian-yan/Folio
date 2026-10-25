import { useDialogs } from './Dialogs';
import { BrowserDashboard } from './BrowserDashboard';
import { useNavigationScroll } from './NavigationScroll';
import { FilterScrollView, FilterTextInput } from './FilterDrawer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeOnlineBrowser, online } from './native';
import { buildWebThemeScript, extractSearchQuery, isPageFailureKey, onlineErrorKey, providerCustomCss, providerThemeEnabled, type BrowserState, type BrowserVisit, type OnlineProvider, type WebPalette } from './online';
import { providerRegionRisk } from './online-region';
import { mostRecentTab } from './online-tabs';
import { useOnlineRegion } from './useOnlineRegion';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction } from './panel-content';
import { usePreferences } from './settings';
import type { Theme } from './ui';
import { navigationBarTopInset, navigationCompactBarFrame, NavigationBackdrop } from './bottom-navigation';
import { usesNativeSidebar } from './native-controls';
import { OnlineHeader } from './OnlineHeader';
import { OnlineBrowserBar } from './OnlineBrowserBar';
import { OnlineBrowserLoading } from './OnlineBrowserLoading';
import { OnlineBrowserFailure } from './OnlineBrowserFailure';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import type { BookmarkDraft } from './browser-data';
import { useBrowserData } from './BrowserDataProvider';
import { browserAddress, browserHost, browserId, downloadBadge, matchingProvider, personalFolderId, applyBrowserVisit } from './browser-data';
import { useOnlineSession, type OnlineOpenRequest } from './OnlineSession';

const emptyBrowser: BrowserState = { url: '', title: '', loading: true, canGoBack: false, canGoForward: false, errorKey: null };
interface OnlineTab {
  id: string; providerId: string; kind: 'provider' | 'web'; provider: OnlineProvider | null;
  address: string; browser: BrowserState; command: string; revealRequest: string; activatedAt: number; submittedQuery: string;
}

// 起始页与网页标签独立，编辑地址和浏览资料时保留所有原生网页实例。
export function OnlineFontsScreen({ theme, active, webPalette, sourceId = '', navigationCollapsed = false, onOpenSettings,
  openRequest, onRequestConsumed, urlRequest, onUrlConsumed }: {
  theme: Theme; active: boolean; webPalette: WebPalette; sourceId?: string; navigationCollapsed?: boolean;
  onOpenSettings: () => void;
  openRequest: OnlineOpenRequest | null; onRequestConsumed: (id: string) => void;
  urlRequest: { id: string; url: string } | null; onUrlConsumed: (id: string) => void;
}) {
  const { alert } = useDialogs();
  const { t } = useTranslation();
  const { begin: beginNavigationScroll, end: endNavigationScroll, scroll: reportNavigationScroll } = useNavigationScroll();
  const { preferences } = usePreferences();
  const { state, refresh, openLibrary: showLibrary, libraryOpen } = useOnlineSession();
  const { data, ready, change } = useBrowserData();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [tabs, setTabs] = useState<OnlineTab[]>([]);
  const [activeId, setActiveId] = useState('start');
  const [editing, setEditing] = useState(false);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) { setWasActive(active); if (!active) setEditing(false); }
  const [draft, setDraft] = useState('');
  const [startDraft, setStartDraft] = useState('');
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const afterAddressClose = useRef<(() => void) | null>(null);
  const serial = useRef(0);
  const order = useRef(0);
  const latestQuery = useRef('');
  const navigationRequest = useRef(0);
  const tabsRef = useRef<OnlineTab[]>([]);
  const pendingVisits = useRef<{ tab: OnlineTab; visit: BrowserVisit }[]>([]);
  const visited = useRef(new Map<string, { id: string; url: string }>());
  const processed = useRef('');
  const operation = useRef(false);
  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null;
  const enabledProviders = useMemo(() => state?.providers.filter((item) => item.enabled) ?? [], [state?.providers]);
  const activeProvider = activeTab?.provider ? state?.providers.find((item) => item.id === activeTab.providerId) ?? activeTab.provider : null;
  const regionKind = useOnlineRegion(!!preferences.onlineRegionHints && active && !!state?.accepted && enabledProviders.some(providerRegionRisk));
  const badge = downloadBadge(state?.jobs ?? []);
  useLayoutEffect(() => { tabsRef.current = tabs; }, [tabs]);
  useEffect(() => {
    if (active && !state) void refresh().catch((cause) => setError(onlineErrorKey(cause)));
  }, [active, state, refresh]);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardTop(event.endCoordinates.screenY));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardTop(null));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const sendTo = useCallback((id: string, action: string, url?: string) => {
    const command = JSON.stringify({ id: String(++serial.current), action, url });
    setTabs((values) => values.map((tab) => tab.id === id ? { ...tab, command,
      browser: { ...tab.browser, loading: true, errorKey: null }, address: url ?? tab.address } : tab));
  }, []);
  const finishEditing = useCallback(() => { setEditing(false); Keyboard.dismiss(); }, []);
  const activateTab = useCallback((id: string) => {
    navigationRequest.current += 1;
    endNavigationScroll();
    finishEditing(); setActiveId(id); setError(null);
    setTabs((values) => values.map((tab) => tab.id === id ? { ...tab, activatedAt: ++order.current } : tab));
  }, [finishEditing, endNavigationScroll]);
  function closeTab(id: string) {
    const remaining = tabsRef.current.filter((tab) => tab.id !== id);
    tabsRef.current = remaining; setTabs(remaining);
    const next = mostRecentTab(remaining);
    activateTab(next?.id ?? 'start');
    visited.current.delete(id);
  }
  useEffect(() => {
    if (!active) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) { if (keyboardTop !== null) Keyboard.dismiss(); else finishEditing(); return true; }
      if (!activeTab) return false;
      if (activeTab.browser.canGoBack) sendTo(activeTab.id, 'back'); else closeTab(activeTab.id);
      return true;
    });
    return () => subscription.remove();
  });
  const run = useCallback(async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(onlineErrorKey(cause)); }
    finally { operation.current = false; setBusy(false); }
  }, []);
  const openPage = useCallback((item: OnlineProvider | null, url: string, query = '', reveal = false) => {
    const current = item ? tabsRef.current.find((tab) => tab.kind === 'provider' && tab.providerId === item.id)
      : tabsRef.current.find((tab) => tab.kind === 'web' && (tab.browser.url || tab.address) === url);
    if (current && (current.browser.url || current.address) === url && !current.browser.errorKey) { activateTab(current.id); return; }
    const id = current?.id ?? item?.id ?? `web:${browserId()}`;
    const commandId = String(++serial.current);
    const next: OnlineTab = { id, providerId: item?.id ?? id, provider: item, kind: item ? 'provider' : 'web', address: url,
      browser: { ...(current?.browser ?? emptyBrowser), loading: true, errorKey: null },
      command: JSON.stringify({ id: commandId, action: 'navigate', url, reveal }), revealRequest: reveal ? commandId : '',
      activatedAt: ++order.current, submittedQuery: query || current?.submittedQuery || '' };
    tabsRef.current = current ? tabsRef.current.map((tab) => tab.id === id ? next : tab) : [...tabsRef.current, next];
    setTabs(tabsRef.current); setActiveId(id); setError(null); finishEditing();
  }, [activateTab, finishEditing]);
  const visit = useCallback(async (item: OnlineProvider, query: string, reveal = false) => {
    if (operation.current) return;
    const request = ++navigationRequest.current;
    await run(async () => {
      const url = await online.search(item.id, query.trim());
      if (request !== navigationRequest.current) return;
      if (query.trim()) latestQuery.current = query.trim();
      openPage(item, url, query.trim(), reveal);
    });
  }, [run, openPage]);
  const openUrl = useCallback((value: string, preferred?: string | null) => {
    const url = browserAddress(value);
    if (!url) { setError('online.browser.invalidSource'); return; }
    navigationRequest.current += 1;
    openPage(matchingProvider(enabledProviders, url, preferred), url);
  }, [enabledProviders, openPage]);
  useEffect(() => {
    if (!active || !state?.accepted || operation.current) return;
    if (openRequest && processed.current !== openRequest.id) {
      processed.current = openRequest.id;
      const item = state.providers.find((provider) => provider.id === openRequest.providerId && provider.enabled);
      if (item) void visit(item, openRequest.query);
      else {
        // 一次性外部请求失效时同步展示可恢复的来源错误。
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setError('online.browser.invalidSource');
      }
      onRequestConsumed(openRequest.id);
    } else if (urlRequest && processed.current !== urlRequest.id) {
      processed.current = urlRequest.id; openUrl(urlRequest.url); onUrlConsumed(urlRequest.id);
    }
  }, [active, state, busy, openRequest, urlRequest, onRequestConsumed, onUrlConsumed, visit, openUrl]);
  function selectProvider(item: OnlineProvider) {
    if (tabsRef.current.some((tab) => tab.id === item.id)) activateTab(item.id);
    else void visit(item, preferences.onlineInheritSearchQuery ? latestQuery.current : '', true);
  }
  function beginEditing(query?: string) {
    setDraft(query ?? (activeTab ? activeTab.browser.url || activeTab.address : startDraft)); setEditing(true);
  }
  function submit() {
    const url = browserAddress(draft);
    if (url) {
      if (activeTab) { navigationRequest.current += 1; sendTo(activeTab.id, 'navigate', url); finishEditing(); }
      else openUrl(url);
    } else if (/^[a-z][a-z\d+.-]*:/i.test(draft.trim())) setError('online.browser.invalidSource');
    Keyboard.dismiss();
  }
  const recordVisit = useCallback((tab: OnlineTab, visit: BrowserVisit) => {
    if (!browserAddress(visit.url)) return;
    if (!ready) { pendingVisits.current = [...pendingVisits.current, { tab, visit }].slice(-1000); return; }
    const previous = visited.current.get(tab.id);
    if (previous?.id === visit.id && previous.url === visit.url) return;
    visited.current.set(tab.id, { id: visit.id, url: visit.url });
    const providerId = matchingProvider(enabledProviders, visit.url, tab.provider?.id)?.id ?? null;
    change((value) => applyBrowserVisit(value, visit, providerId, previous?.url));
  }, [ready, enabledProviders, change]);
  useEffect(() => {
    if (!ready) return;
    const visits = pendingVisits.current; pendingVisits.current = [];
    for (const event of visits) recordVisit(event.tab, event.visit);
  }, [ready, recordVisit]);
  function confirmDownload(intent: { id: string; name: string }) {
    alert(t('online.browser.download'), intent.name, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('online.browser.download'), onPress: () => void run(async () => { await online.download(intent.id); await refresh(); showLibrary('downloads'); }) },
    ]);
  }
  function addressDismissed() { const next = afterAddressClose.current; afterAddressClose.current = null; next?.(); }
  function closeAddressThen(action: () => void) {
    if (!editing) { action(); return; }
    afterAddressClose.current = action; finishEditing();
    if (Platform.OS !== 'ios') requestAnimationFrame(addressDismissed);
  }
  function openLibrary(tab: 'bookmarks' | 'history', bookmark: BookmarkDraft | null = null) {
    closeAddressThen(() => showLibrary(tab, bookmark));
  }
  const barBottom = usesNativeSidebar && width >= 600 ? inset.bottom + 8 : navigationBarTopInset(inset.bottom) + 8;
  const browserBottom = Platform.OS === 'android' && navigationCollapsed ? navigationCompactBarFrame(inset.bottom, width - inset.left - inset.right).bottom + 64 : barBottom + 64;
  const address = browserAddress(draft);
  const restricted = activeProvider && providerRegionRisk(activeProvider) && preferences.onlineRegionHints;
  const hint = restricted && regionKind === 'CN' ? t('online.browser.regionHint', { name: activeProvider.name }) : null;
  const failed = !!activeTab && !activeTab.browser.loading && isPageFailureKey(activeTab.browser.errorKey);
  const bookmark = data.bookmarks.find((item) => item.url === activeTab?.browser.url);
  const orderedProviders = [...enabledProviders].sort((a, b) => Number(b.id === activeProvider?.id) - Number(a.id === activeProvider?.id));
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  const startContent = <BrowserDashboard bottomInset={barBottom + 64} theme={theme} providers={state?.providers ?? []} jobs={state?.jobs ?? []} active={active}
    onOpen={openUrl} onEditBookmark={(item) => openLibrary('bookmarks', item)} onLibrary={openLibrary} onDownloads={() => showLibrary('downloads')} />;
  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    {state?.accepted && <OnlineHeader theme={theme} selectedId={activeId} providers={enabledProviders}
      webTabs={tabs.filter((tab) => tab.kind === 'web' || !enabledProviders.some((item) => item.id === tab.id)).map((tab) => ({ id: tab.id, title: tab.browser.title || browserHost(tab.address) }))}
      onStart={() => activateTab('start')} onSelect={selectProvider} onWebTab={activateTab} />}
    {!state ? <View style={styles.content}>{errorNode ?? <ActivityIndicator color={theme.accent} />}
      {error && <PanelAction theme={theme} label={t('common.retry')} onPress={() => void run(async () => { await refresh(); })} />}</View>
      : !state.accepted ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={{ color: theme.label }}>{t('online.browser.disclaimer')}</Text>{errorNode}
        <PanelAction primary theme={theme} label={t('online.browser.accept')} disabled={busy} onPress={() => void run(async () => { await online.accept(); await refresh(); })} />
      </ScrollView> : <>
        {errorNode && <View style={styles.feedback}>{errorNode}</View>}
        <View style={styles.screen}>
          {/* 起始页铺满内容区域，折叠导航只移动浮层，不改变滚动视口。 */}
          <View style={[StyleSheet.absoluteFill, { bottom: activeTab ? browserBottom : 0 }]}>
            <NavigationBackdrop sourceId={active ? sourceId : ''} active={active} theme={theme} compositingLayer style={styles.screen}>
              {tabs.map((tab) => {
                const visible = tab.id === activeId;
                const item = tab.provider;
                return <NativeOnlineBrowser key={tab.id} style={[StyleSheet.absoluteFill, { opacity: visible ? 1 : 0, zIndex: visible ? 1 : 0 }]}
                  pointerEvents={visible && !editing ? 'auto' : 'none'} accessibilityElementsHidden={!visible || editing} importantForAccessibility={visible && !editing ? 'auto' : 'no-hide-descendants'}
                  active={active && visible && !editing && !libraryOpen} provider={JSON.stringify(item ?? {})} command={tab.command}
                  webTheme={item ? buildWebThemeScript({ palette: webPalette, dark: theme.dark, enabled: providerThemeEnabled(preferences.onlineTheme[item.id], item.id), customCss: providerCustomCss(preferences.onlineCss[item.id], item.id) }) : ''}
                  accentColor={theme.accent} onPageScroll={({ nativeEvent }) => {
                    if (!active || !visible || editing || libraryOpen) return;
                    if (nativeEvent.reset) { beginNavigationScroll(nativeEvent.offset); endNavigationScroll(); }
                    else reportNavigationScroll(nativeEvent.offset, true);
                  }} onVisit={({ nativeEvent }) => recordVisit(tab, nativeEvent)}
                  onBrowserState={({ nativeEvent }) => {
                    const query = item ? extractSearchQuery(item, nativeEvent.url) : null;
                    setTabs((values) => values.map((value) => value.id === tab.id ? { ...value, browser: nativeEvent,
                      address: nativeEvent.url.startsWith('https://') ? nativeEvent.url : value.address,
                      submittedQuery: query || value.submittedQuery } : value));
                    if (tab.id === activeId && query && !nativeEvent.loading) latestQuery.current = query;
                    if (!nativeEvent.loading && !nativeEvent.errorKey && nativeEvent.title && visited.current.get(tab.id)?.url === nativeEvent.url) {
                      change((value) => {
                        const entry = value.history.find((item) => item.url === nativeEvent.url);
                        return entry && entry.title !== nativeEvent.title ? { ...value, history: value.history.map((item) => item.id === entry.id ? { ...item, title: nativeEvent.title } : item) } : value;
                      });
                    }
                    if (tab.id === activeId && nativeEvent.errorKey && !isPageFailureKey(nativeEvent.errorKey)) setError(nativeEvent.errorKey);
                  }} onDownloadIntent={({ nativeEvent }) => confirmDownload(nativeEvent)} />;
              })}
              {!activeTab && startContent}
              {activeTab && <OnlineBrowserLoading key={activeId} loading={activeTab.browser.loading} failed={failed} hint={hint}
                active={active && !editing} revealRequest={activeTab.revealRequest} provider={activeProvider} theme={theme} />}
              {activeTab && failed && <OnlineBrowserFailure theme={theme} provider={activeProvider} errorKey={activeTab.browser.errorKey}
                url={activeTab.browser.url || activeTab.address} hint={hint} onRetry={() => sendTo(activeTab.id, 'navigate', activeTab.browser.url || activeTab.address)} onSwitchSource={() => activateTab('start')} />}
            </NavigationBackdrop>
          </View>
        </View>
        <OnlineBrowserBar theme={theme} provider={activeProvider} browser={activeTab?.browser ?? emptyBrowser} address={activeTab?.address ?? ''}
          start={!activeTab} badge={badge.count} attention={badge.attention} sourceId={sourceId}
          compact={Platform.OS === 'android' && navigationCollapsed} bottom={barBottom} onEdit={() => beginEditing()} />
      </>}
    <LibraryPanel visible={editing} title={t('browser.pageTools')} theme={theme} onClose={finishEditing} onDismissed={addressDismissed}>
      <FilterScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <FilterTextInput accessibilityLabel={t('browser.searchOrAddress')} placeholder={t('browser.searchOrAddress')} placeholderTextColor={theme.muted}
          value={draft} autoCapitalize="none" autoCorrect={false} selectTextOnFocus={!!activeTab} returnKeyType={address ? 'go' : 'search'}
          style={[styles.addressInput, { color: theme.label, backgroundColor: theme.surface }]} onSubmitEditing={submit}
          onChangeText={(value) => { setDraft(value); if (!activeTab) setStartDraft(value); }} />
        {errorNode}
        {address ? <PanelAction theme={theme} label={t('browser.goTo', { host: browserHost(address) })} onPress={submit} /> : !!draft.trim() && <>
          <Text accessibilityRole="header" style={[styles.heading, { color: theme.label }]}>{t('browser.chooseSource')}</Text>
          {orderedProviders.map((item) => <Pressable accessibilityRole="button" key={item.id} disabled={busy} style={styles.suggestion} onPress={() => void visit(item, draft)}>
            <OnlineSourceIcon provider={item} theme={theme} /><Text style={{ color: theme.label, flex: 1 }}>{t('browser.searchIn', { name: item.name, query: draft.trim() })}</Text>
          </Pressable>)}
          {!enabledProviders.length && <Text style={{ color: theme.secondary }}>{t('browser.noSources')}</Text>}
        </>}
        {activeTab && <View style={styles.links}>
          <PanelAction theme={theme} label={t('common.back')} disabled={!activeTab.browser.canGoBack} onPress={() => { finishEditing(); sendTo(activeTab.id, 'back'); }} />
          <PanelAction theme={theme} label={t('online.browser.forward')} disabled={!activeTab.browser.canGoForward} onPress={() => { finishEditing(); sendTo(activeTab.id, 'forward'); }} />
        </View>}
        {activeProvider && <PanelAction theme={theme} label={t('browser.siteSearch', { name: activeProvider.name })} onPress={() => beginEditing(activeTab?.submittedQuery ?? '')} />}
        {activeTab && !activeTab.browser.loading && !activeTab.browser.errorKey && browserAddress(activeTab.browser.url) && <PanelAction theme={theme} disabled={!ready} label={t(bookmark ? 'browser.editBookmark' : 'browser.addBookmark')} onPress={() => openLibrary('bookmarks', bookmark ?? { title: activeTab.browser.title || browserHost(activeTab.browser.url), url: activeTab.browser.url, folderId: personalFolderId, providerId: activeProvider?.id ?? null })} />}
        <PanelAction theme={theme} label={t('browser.library')} onPress={() => openLibrary('bookmarks')} />
        <PanelAction theme={theme} label={t('online.browser.downloads')} onPress={() => closeAddressThen(() => showLibrary('downloads'))} />
        {!activeTab && <PanelAction theme={theme} label={t('online.browser.sources')} onPress={() => closeAddressThen(onOpenSettings)} />}
        {activeTab && <PanelAction theme={theme} destructive label={t('online.browser.closePage')} onPress={() => closeTab(activeTab.id)} />}
      </FilterScrollView>
    </LibraryPanel>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, content: { padding: 16, gap: 16 }, feedback: { paddingHorizontal: 16, paddingVertical: 8 },
  addressInput: { minHeight: 48, padding: 12, borderRadius: 12, fontSize: 16, fontWeight: '400' },
  heading: { fontSize: 20, fontWeight: '600' }, links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
});
