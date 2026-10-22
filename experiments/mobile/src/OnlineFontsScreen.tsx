import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocumentAsync } from 'expo-document-picker';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, AppState, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowClockwiseIcon, CaretLeftIcon, CaretRightIcon, DownloadSimpleIcon, GearIcon, XIcon } from './icons';
import { NativeFontPreview, NativeOnlineBrowser, online } from './native';
import { onlineErrorKey, type BrowserState, type OnlineEntry, type OnlineProvider, type OnlineState } from './online';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction } from './panel-content';
import { SettingsSwitchRow, formatBytes } from './settings-ui';
import { IconButton, type Theme } from './ui';
import { navigationContentInset } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import type { LibrarySnapshot } from './library';
import { OnlineSourceIcon } from './OnlineSourceIcon';

const emptyBrowser: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, errorKey: null };

// 页面只控制浏览与确认，下载和导入由原生服务持有。
export function OnlineFontsScreen({ theme, active, onSnapshotChange }: {
  theme: Theme; active: boolean; onSnapshotChange: (snapshot: LibrarySnapshot) => void;
}) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const [state, setState] = useState<OnlineState | null>(null);
  const [providerId, setProviderId] = useState('');
  const [lastProvider, setLastProvider] = useState<OnlineProvider | null>(null);
  const [browserKey, setBrowserKey] = useState(0);
  const [query, setQuery] = useState('');
  const [address, setAddress] = useState('');
  const [browser, setBrowser] = useState(emptyBrowser);
  const [command, setCommand] = useState('');
  const [opened, setOpened] = useState(false);
  const [panel, setPanel] = useState<'sources' | 'downloads' | 'inspect' | null>(null);
  const [draft, setDraft] = useState<OnlineProvider | null>(null);
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
      const url = await online.search(item.id, search);
      Keyboard.dismiss(); setProviderId(item.id); setLastProvider(item); setAddress(url); setBrowser(emptyBrowser);
      setOpened(true); send('navigate', url);
    });
  }
  async function saveProviders(values: OnlineProvider[]) { await online.saveProviders(values); await refresh(); }
  async function chooseIcon() {
    if (!draft) return;
    const id = draft.id;
    await run(async () => {
      const result = await getDocumentAsync({ type: ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'], copyToCacheDirectory: true, multiple: false });
      if (result.canceled) return;
      const file = result.assets[0];
      if (!file || (file.size ?? 0) > 8 * 1024 * 1024) throw new Error('online.browser.invalidIcon');
      const icon = await online.importIcon(file.uri);
      setDraft((value) => value?.id === id ? { ...value, icon: { kind: 'custom', assetId: icon.assetId }, iconUri: icon.uri } : value);
    });
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
  const inputStyle = [styles.input, { color: theme.label, backgroundColor: theme.raised }];
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;

  return <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{t('online.title')}</Text>
      {state?.accepted && <>
        <IconButton theme={theme} label={t('online.browser.sources')} systemImage="gear" onPress={() => { setDraft(null); setPanel('sources'); }}>
          <GearIcon size={22} color={theme.label} />
        </IconButton>
        <IconButton theme={theme} label={t('online.browser.downloads')} systemImage="arrow.down.circle" onPress={() => setPanel('downloads')}>
          <DownloadSimpleIcon size={22} color={theme.label} />
        </IconButton>
      </>}
    </View>
    {!state ? <View style={styles.content}>{errorNode ?? <ActivityIndicator color={theme.accent} />}
      {error && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await refresh(); })} disabled={busy} />}</View>
      : !state.accepted ? <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.text, { color: theme.label }]}>{t('online.browser.disclaimer')}</Text>
        {errorNode}
        <PanelAction primary label={t('online.browser.accept')} theme={theme} disabled={busy}
          onPress={() => void run(async () => { await online.accept(); await refresh(); })} />
      </ScrollView> : <>
        <ScrollView horizontal style={styles.sources} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
          {state.providers.filter((item) => item.enabled).map((item) => <Pressable key={item.id} accessibilityRole="button"
            accessibilityState={{ selected: providerId === item.id, disabled: busy }} disabled={busy} onPress={() => void visit(item, '')}
            style={[styles.source, { backgroundColor: providerId === item.id ? theme.selection : theme.surface }]}>
            <OnlineSourceIcon provider={item} theme={theme} />
            <Text style={{ color: providerId === item.id ? theme.accent : theme.label }}>{item.name}</Text>
          </Pressable>)}
        </ScrollView>
        <View style={styles.row}>
          <TextInput style={[inputStyle, styles.flex]} value={query} onChangeText={setQuery} placeholderTextColor={theme.secondary}
            placeholder={t('online.search')} accessibilityLabel={t('online.search')} returnKeyType="search"
            onSubmitEditing={() => { const item = provider?.enabled ? provider : state.providers.find((item) => item.enabled); if (item) void visit(item); }} />
          {<PanelAction label={t('common.search')} theme={theme} onPress={() => { const item = provider?.enabled ? provider : state.providers.find((item) => item.enabled); if (item) void visit(item); }} disabled={busy || (!state.providers.some((item) => item.enabled))} />}
        </View>
        <View style={styles.feedback}>{errorNode}{notice && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{notice}</Text>}</View>
        {opened ? <>
          <View style={styles.row}>
            <TextInput style={[inputStyle, styles.flex]} value={address} onChangeText={setAddress} accessibilityLabel={t('online.browser.address')}
              autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go"
              onSubmitEditing={() => { Keyboard.dismiss(); send('navigate', address.trim()); }} />
            <IconButton theme={theme} label={t('common.close')} systemImage="xmark" onPress={() => { send('stop'); setOpened(false); }}><XIcon size={20} color={theme.label} /></IconButton>
          </View>
          <View style={styles.browser}>
            <NativeOnlineBrowser key={browserKey} style={styles.screen} active={active && panel === null} provider={JSON.stringify(provider ?? {})} command={command}
              onBrowserState={({ nativeEvent }) => { setBrowser(nativeEvent); if (nativeEvent.url.startsWith('https://')) setAddress(nativeEvent.url); if (nativeEvent.errorKey) setError(nativeEvent.errorKey); }}
              onDownloadIntent={({ nativeEvent }) => confirmDownload(nativeEvent)} />
          </View>
          <View style={[styles.browserActions, { paddingBottom: usesNativeControls ? 8 : navigationContentInset(inset.bottom) }]}>
            <IconButton theme={theme} label={t('common.back')} systemImage="chevron.left" disabled={!browser.canGoBack} onPress={() => send('back')}><CaretLeftIcon size={22} color={theme.label} /></IconButton>
            <OnlineSourceIcon provider={provider} theme={theme} />
            <Text numberOfLines={1} style={[styles.flex, { color: theme.secondary }]}>{browser.title || provider?.name}</Text>
            {browser.loading && <ActivityIndicator color={theme.accent} />}
            <IconButton theme={theme} label={t('online.browser.reload')} systemImage="arrow.clockwise" onPress={() => send('reload')}><ArrowClockwiseIcon size={22} color={theme.label} /></IconButton>
            <IconButton theme={theme} label={t('online.browser.forward')} systemImage="chevron.right" disabled={!browser.canGoForward} onPress={() => send('forward')}><CaretRightIcon size={22} color={theme.label} /></IconButton>
          </View>
        </> : <View style={styles.content}><Text style={[styles.text, { color: theme.secondary }]}>{t('online.browser.chooseSource')}</Text></View>}
      </>}
    <LibraryPanel visible={panel !== null} title={t(panel === 'sources' ? 'online.browser.sources' : panel === 'inspect' ? 'online.browser.review' : 'online.browser.downloads')}
      theme={theme} busy={busy} onClose={() => { setPanel(null); setDraft(null); }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {errorNode}
        {panel === 'sources' && state && (draft ? <>
          <View style={[styles.row, styles.wrap]}>
            <OnlineSourceIcon provider={draft} theme={theme} size={32} />
            <PanelAction label={t('online.browser.chooseIcon')} theme={theme} disabled={busy} onPress={() => void chooseIcon()} />
            <PanelAction label={t('online.browser.automaticIcon')} theme={theme} disabled={busy || !draft.icon} onPress={() => setDraft({ ...draft, icon: null, iconUri: null })} />
          </View>
          <Text style={{ color: theme.secondary }}>{t('online.browser.iconHelp')}</Text>
          <TextInput accessibilityLabel={t('common.name')} placeholder={t('common.name')} placeholderTextColor={theme.secondary} style={inputStyle} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          <TextInput accessibilityLabel={t('online.browser.homepage')} placeholder={t('online.browser.homepage')} placeholderTextColor={theme.secondary} style={inputStyle} value={draft.homepage} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={(homepage) => setDraft({ ...draft, homepage })} />
          <TextInput accessibilityLabel={t('online.browser.template')} placeholder={t('online.browser.template')} placeholderTextColor={theme.secondary} style={inputStyle} value={draft.searchTemplate} autoCapitalize="none" autoCorrect={false} keyboardType="url" onChangeText={(searchTemplate) => setDraft({ ...draft, searchTemplate })} />
          <Text style={{ color: theme.secondary }}>{t('online.browser.templateHelp')}</Text>
          <View style={styles.row}>{<PanelAction label={t('common.cancel')} theme={theme} onPress={() => setDraft(null)} disabled={busy} />}
            {<PanelAction label={t('common.save')} theme={theme} onPress={() => void run(async () => {
              const values = state.providers.some((item) => item.id === draft.id) ? state.providers.map((item) => item.id === draft.id ? draft : item) : [...state.providers, draft];
              await saveProviders(values); setDraft(null);
            })} disabled={busy} />}</View>
        </> : <>
          {state.providers.map((item, index) => <View key={item.id} style={{ backgroundColor: theme.surface }}>
            <SettingsSwitchRow title={item.name} detail={item.homepage} icon={<OnlineSourceIcon provider={item} theme={theme} />} theme={theme} disabled={busy} value={item.enabled}
              onChange={(enabled) => void run(() => saveProviders(state.providers.map((value) => value.id === item.id ? { ...value, enabled } : value)))} />
            <View style={[styles.row, styles.wrap]}>
              {<PanelAction label={t('common.edit')} theme={theme} onPress={() => setDraft({ ...item })} disabled={busy} />}
              {<PanelAction label={t('online.browser.moveUp')} theme={theme} onPress={() => void run(async () => {
                const values = [...state.providers]; [values[index - 1], values[index]] = [values[index]!, values[index - 1]!]; await saveProviders(values);
              })} disabled={busy || (index === 0)} />}
              {item.builtin && <PanelAction label={t('common.reset')} theme={theme} disabled={busy} onPress={() => void run(async () => {
                const original = state.defaultProviders.find((value) => value.id === item.id);
                if (original) await saveProviders(state.providers.map((value) => value.id === item.id ? { ...original, enabled: item.enabled } : value));
              })} />}
              {!item.builtin && <PanelAction label={t('common.delete')} theme={theme} onPress={() => void run(() => saveProviders(state.providers.filter((value) => value.id !== item.id)))} disabled={busy} />}
            </View>
          </View>)}
          {<PanelAction label={t('online.browser.addSource')} theme={theme} onPress={() => setDraft({ id: `custom-${Date.now()}`, name: '', homepage: '', searchTemplate: '', enabled: true, builtin: false })} disabled={busy} />}
          {<PanelAction label={t('online.browser.clearData')} theme={theme} onPress={() => Alert.alert(t('online.browser.clearData'), t('online.browser.clearDataNotice'), [
            { text: t('common.cancel'), style: 'cancel' }, { text: t('common.delete'), style: 'destructive', onPress: () => { setBrowserKey((value) => value + 1); send('clear'); setOpened(true); setPanel(null); setAddress(''); setBrowser(emptyBrowser); } },
          ])} disabled={busy} />}
        </>)}
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
  screen: { flex: 1 }, flex: { flex: 1 },
  heading: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, gap: 8 },
  title: { flex: 1, fontSize: 28, fontWeight: '700', paddingVertical: 16 },
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  wrap: { flexWrap: 'wrap' }, sources: { flexGrow: 0, maxHeight: 64 },
  source: { padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }, input: { minHeight: 44, paddingHorizontal: 12, fontSize: 16 },
  text: { fontSize: 16, lineHeight: 24 }, feedback: { paddingHorizontal: 16 },
  browser: { flex: 1 }, browserActions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16 },
  fontPreview: { height: 120 },
  job: { padding: 16, gap: 8 }, jobName: { fontSize: 16, fontWeight: '600' },
});
