import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlobeIcon } from './icons';
import { NativeFontPreview, NativeOnlineBrowser, online } from './native';
import {
  buildWebThemeScript, extractSearchQuery, onlineErrorKey, providerCustomCss, providerThemeEnabled,
  type BrowserState, type OnlineEntry, type OnlineProvider, type OnlineState, type WebPalette,
} from './online';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction } from './panel-content';
import { formatBytes } from './settings-ui';
import { usePreferences } from './settings';
import { type Theme } from './ui';
import { navigationBarTopInset, navigationCompactBarFrame } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import type { LibrarySnapshot } from './library';
import { OnlineHeader } from './OnlineHeader';
import { OnlineBrowserBar } from './OnlineBrowserBar';

const emptyBrowser: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, errorKey: null };

// 页面只控制浏览与确认，下载和导入由原生服务持有。
export function OnlineFontsScreen({ theme, active, webPalette, sourceId = '', navigationCollapsed = false, onSnapshotChange, onOpenSettings }: {
  theme: Theme; active: boolean; webPalette: WebPalette;
  sourceId?: string; navigationCollapsed?: boolean;
  onSnapshotChange: (snapshot: LibrarySnapshot) => void; onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const { preferences } = usePreferences();
  const inset = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<OnlineState | null>(null);
  const [providerId, setProviderId] = useState('');
  const [lastProvider, setLastProvider] = useState<OnlineProvider | null>(null);
  const [query, setQuery] = useState('');
  const [address, setAddress] = useState('');
  const [browser, setBrowser] = useState(emptyBrowser);
  const [command, setCommand] = useState('');
  const [opened, setOpened] = useState(false);
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
  const operation = useRef(false);
  const provider = state?.providers.find((item) => item.id === providerId) ?? lastProvider;
  const enabledProviders = state?.providers.filter((item) => item.enabled) ?? [];
  const send = useCallback((action: string, url?: string) => {
    setCommand(JSON.stringify({ id: String(++serial.current), action, url }));
  }, []);
  const refresh = useCallback(async () => {
    const value = await online.state();
    if (mounted.current) setState(value);
    return value;
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
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
    if (!active || !opened) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (panel) { if (!operation.current) setPanel(null); return true; }
      if (browser.canGoBack) send('back'); else setOpened(false);
      return true;
    });
    return () => subscription.remove();
  }, [active, browser.canGoBack, opened, panel, send]);

  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { if (mounted.current) setError(onlineErrorKey(cause)); }
    finally { operation.current = false; if (mounted.current) setBusy(false); }
  }
  async function visit(item: OnlineProvider, search = query) {
    await run(async () => {
      const url = await online.search(item.id, search.trim());
      Keyboard.dismiss(); setProviderId(item.id); setLastProvider(item); setAddress(url); setBrowser(emptyBrowser);
      setSearchOpen(false); setOpened(true); send('navigate', url);
    });
  }
  function selectProvider(item: OnlineProvider) {
    Keyboard.dismiss();
    setSearchOpen(false);
    void visit(item, query);
  }
  function submitSearch() {
    const item = provider?.enabled ? provider : enabledProviders[0];
    if (item) void visit(item, query);
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
  const themeEnabled = provider ? providerThemeEnabled(preferences.onlineTheme[provider.id], provider.id) : false;
  const customCss = provider ? providerCustomCss(preferences.onlineCss[provider.id], provider.id) : '';
  const webTheme = useMemo(() => buildWebThemeScript({
    palette: webPalette, dark: theme.dark, enabled: themeEnabled, customCss,
  }), [customCss, theme.dark, themeEnabled, webPalette]);
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  const feedback = (error || notice) ? <View style={styles.feedback}>
    {errorNode}{notice && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{notice}</Text>}
  </View> : null;
  const barBottom = usesNativeControls ? inset.bottom + 8 : navigationBarTopInset(inset.bottom) + 8;
  const browserBottom = Platform.OS === 'android'
    ? navigationCompactBarFrame(inset.bottom, width - inset.left - inset.right).bottom + 64
    : opened ? barBottom + 64 : barBottom;

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    {state?.accepted && <OnlineHeader theme={theme} providers={enabledProviders} selectedId={providerId}
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
          {opened ? <NativeOnlineBrowser style={styles.screen} active={active && panel === null}
            provider={JSON.stringify(provider ?? {})} command={command} webTheme={webTheme} accentColor={theme.accent}
            onBrowserState={({ nativeEvent }) => {
              setBrowser(nativeEvent);
              if (nativeEvent.url.startsWith('https://')) setAddress(nativeEvent.url);
              if (nativeEvent.errorKey) setError(nativeEvent.errorKey);
              const next = provider ? extractSearchQuery(provider, nativeEvent.url) : null;
              if (next && !searchOpen && next !== query) setQuery(next);
            }}
            onDownloadIntent={({ nativeEvent }) => confirmDownload(nativeEvent)} />
            : <View style={styles.content}>
              <GlobeIcon size={28} color={theme.secondary} />
              <Text style={[styles.text, { color: theme.secondary }]}>{t('online.browser.chooseSource')}</Text>
              <PanelAction label={t('online.browser.sources')} theme={theme} onPress={onOpenSettings} />
            </View>}
        </View>
        {opened && <OnlineBrowserBar theme={theme} provider={provider} browser={browser} address={address}
          sourceId={sourceId} compact={Platform.OS === 'android' && navigationCollapsed}
          bottom={barBottom} onAddressChange={setAddress} onNavigate={() => { Keyboard.dismiss(); send('navigate', address.trim()); }}
          onBack={() => send('back')} onForward={() => send('forward')} onClose={() => { send('stop'); setOpened(false); setPanel(null); }} />}
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
                setProviderId(item.id); setLastProvider(item); setAddress(job.origin.sourcePageUrl); setOpened(true); setPanel(null); send('navigate', job.origin.sourcePageUrl);
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
  browserArea: { flex: 1 },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  wrap: { flexWrap: 'wrap' },
  text: { fontSize: 16, lineHeight: 24 },
  feedback: { paddingHorizontal: 16, paddingVertical: 6, gap: 4 },
  fontPreview: { height: 120 },
  job: { padding: 16, gap: 8 }, jobName: { fontSize: 16, fontWeight: '600' },
});
