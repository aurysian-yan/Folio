import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator } from './UiActivityIndicator';
import { AppState, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { isReleaseUrl, type AppInfo } from '../../../shared/about/update';
import type { MobileUpdateResult } from '../../../shared/about/android-release';
import { getAboutInfo, updates } from './native';
import { ReleaseMirrorMenu } from './ReleaseMirrorMenu';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsPage, formatBytes, settingsLayout, settingsTypography } from './settings-ui';
import { checkMobileUpdate, downloadRequest, fastestMirror, MirrorSpeedSession, normalizeMirror, releaseMirrors, type MirrorSpeed, type ReleaseMirrorId, type UpdateDownload } from './update';
import { noteBlocks, noteSpans } from './update-markdown';
import type { Theme } from './ui';

const mirrorKey = 'folio.mobile.release-mirror.v1';
let mirrorWrites = Promise.resolve();
const idleDownload: UpdateDownload = { status: 'idle' };
function updateError(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : '';
  return /softwareUpdate\.errors\.[a-z]+/.exec(message)?.[0] ?? (/^softwareUpdate\.errors\.[a-z]+$/.test(code) ? code : 'softwareUpdate.errors.download');
}

export function SettingsUpdatePage({ theme, onClose, active = true, backLabel, required = false }: { theme: Theme; onClose: () => void; active?: boolean; backLabel?: string; required?: boolean }) {
  const { t, i18n } = useTranslation();
  const [app, setApp] = useState<AppInfo>();
  const [mirror, setMirror] = useState<ReleaseMirrorId>('direct');
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [update, setUpdate] = useState<MobileUpdateResult>({ status: 'idle' });
  const [download, setDownload] = useState(idleDownload);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [speeds, setSpeeds] = useState<Partial<Record<ReleaseMirrorId, MirrorSpeed>>>({});
  const [speedSession] = useState(() => new MirrorSpeedSession());
  const expanded = useRef(false);
  const alive = useRef(true);
  const operation = useRef(false);
  const sourceId = 'settings-release-update';
  const downloading = download.status === 'downloading' || download.status === 'paused';
  const locked = downloading || busy;

  useEffect(() => {
    alive.current = true;
    let mounted = true;
    void Promise.resolve().then(getAboutInfo).then((value) => { if (mounted) setApp(value); }).catch(() => { if (mounted) setError('softwareUpdate.errors.info'); });
    void AsyncStorage.getItem(mirrorKey).then((value) => { if (mounted) setMirror(normalizeMirror(value)); }).catch(() => {}).finally(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; alive.current = false; speedSession.close(); };
  }, [speedSession]);

  useEffect(() => {
    if (!loaded || !app || !active) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setUpdate({ status: 'checking' });
      const result = await checkMobileUpdate(app, mirror, controller.signal);
      if (!controller.signal.aborted) setUpdate(result);
    });
    return () => controller.abort();
  }, [app, mirror, loaded, attempt, active]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !active) return;
    let stopped = false; let polling = false; let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped || polling || AppState.currentState !== 'active') return;
      polling = true;
      try {
        const next = await updates.updateDownloadState();
        if (stopped) return;
        setDownload(next);
        if (next.status === 'ready' && next.autoInstall && !operation.current) {
          operation.current = true;
          try { await updates.installUpdate(true); }
          catch (cause) { if (!stopped) setError(updateError(cause)); }
          finally { operation.current = false; }
        }
      } catch (cause) { if (!stopped) setError(updateError(cause)); }
      polling = false;
      if (!stopped) timer = setTimeout(() => void poll(), 1000);
    };
    void poll();
    const subscription = AppState.addEventListener('change', (state) => {
      if (timer) clearTimeout(timer);
      speedSession.close(); expanded.current = false;
      if (state === 'active') void poll();
    });
    return () => { stopped = true; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [active, speedSession]);

  useEffect(() => {
    if (!active) { speedSession.close(); expanded.current = false; }
  }, [active, speedSession]);

  async function perform(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(undefined);
    try { await action(); }
    catch (cause) { if (alive.current) setError(updateError(cause)); }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  }
  async function openLink(url: string) {
    try {
      const value = new URL(url);
      if (value.protocol !== 'https:' || value.username || value.password) throw new Error();
      await Linking.openURL(url);
    } catch { if (alive.current) setError('softwareUpdate.errors.link'); }
  }
  function selectMirror(id: ReleaseMirrorId) {
    if (locked || !releaseMirrors.some((item) => item.id === id)) return;
    speedSession.close(); expanded.current = false;
    setMirror(id); setAttempt((value) => value + 1); setError(undefined);
    mirrorWrites = mirrorWrites.catch(() => {}).then(() => AsyncStorage.setItem(mirrorKey, id)).catch(() => { if (alive.current) setError('softwareUpdate.errors.preference'); });
  }
  function expandMenu(value: boolean) {
    if (expanded.current === value) return;
    expanded.current = value;
    if (!value || locked || !active) { speedSession.close(); return; }
    void speedSession.open(update.release?.version, (id, result) => setSpeeds((previous) => ({ ...previous, [id]: result })), app?.platform === 'android' && app.sdkInt !== undefined);
  }
  const best = fastestMirror(speeds);
  const release = update.release;
  const artifact = update.artifacts?.[0];
  const notes = release?.releaseNotes?.[i18n.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'];
  const progress = download.total ? Math.min(1, Math.max(0, (download.bytes ?? 0) / download.total)) : 0;
  const statusKey = update.status === 'variantRequired' ? 'softwareUpdate.variantRequired' : update.status === 'idle' ? 'about.checking' : `about.${update.status}`;
  const items = releaseMirrors.map((item) => {
    const speed = speeds[item.id];
    const detail = speed?.status === 'success' ? t('softwareUpdate.latency', { milliseconds: speed.milliseconds })
      : speed ? t(speed.status === 'testing' ? 'softwareUpdate.testing' : 'softwareUpdate.unreachable') : '';
    return { id: item.id, label: [item.name, detail, speed?.status === 'success' && best === item.id ? t('softwareUpdate.fastest') : ''].filter(Boolean).join(' · ') };
  });

  return <SettingsPage title={t('softwareUpdate.title')} theme={theme} onClose={onClose} backdropSourceId={sourceId} backLabel={backLabel}>
    {required && <SettingsNote theme={theme}>{t('softwareUpdate.compatibilityRequired')}</SettingsNote>}
    <SettingsGroup theme={theme}>
      <View style={styles.versionRow}>
        <View style={styles.flex}>
          <Text style={[settingsTypography.body, { color: theme.label }]}>{t('softwareUpdate.currentVersion')}</Text>
          <View accessibilityLiveRegion="polite" style={styles.status}>
            {update.status === 'checking' && <ActivityIndicator size="small" color={theme.accent} />}
            <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t(statusKey, { version: release?.version })}</Text>
          </View>
        </View>
        <Text numberOfLines={1} style={[styles.currentVersion, { color: theme.secondary }]}>
          {app ? t('macos.versionWithBuild', { version: app.version, build: app.build }) : t('common.unknownVersion')}
        </Text>
      </View>
    </SettingsGroup>
    <SettingsGroup theme={theme}>
      <View style={styles.mirrorRow}>
        <View style={styles.flex}>
          <Text style={[settingsTypography.body, { color: theme.label }]}>{t('softwareUpdate.mirror')}</Text>
          <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{releaseMirrors.find((item) => item.id === mirror)?.name}</Text>
        </View>
        <ReleaseMirrorMenu theme={theme} sourceId={sourceId} selectedId={mirror} disabled={locked} title={t('softwareUpdate.mirror')}
          items={items} onSelect={selectMirror} onExpandedChange={expandMenu} />
      </View>
    </SettingsGroup>
    {release && <SettingsGroup theme={theme}>
      <View style={styles.release}>
        <View style={styles.identity}>
          <Image source={require('../assets/design/icon.png')} style={styles.icon} accessible={false} />
          <View style={styles.flex}>
            <Text accessibilityRole="header" style={[settingsTypography.metric, { color: theme.label }]}>{t('softwareUpdate.version', { version: release.version })}</Text>
            {artifact && <Text style={[styles.packageSize, { color: theme.secondary }]}>{formatBytes(artifact.size)}</Text>}
          </View>
        </View>
        {notes ? noteBlocks(notes).map((block, index) => <Text key={index} selectable accessibilityRole={block.kind === 'heading' ? 'header' : undefined}
          style={[block.kind === 'heading' ? settingsTypography.body : styles.note, { color: theme.label }]}>
          {block.kind === 'list' ? '• ' : ''}{noteSpans(block.text).map((span, part) => span.url
            ? <Text key={part} accessibilityRole="link" style={{ color: theme.accent, textDecorationLine: 'underline' }} onPress={() => void openLink(span.url!)}>{span.text}</Text>
            : <Text key={part}>{span.text}</Text>)}
        </Text>) : <Text style={[styles.note, { color: theme.secondary }]}>{t('softwareUpdate.noNotes')}</Text>}
        <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('about.published', { date: new Date(release.publishedAt).toLocaleDateString(i18n.language) })}</Text>
      </View>
      {Platform.OS === 'android' && (update.status === 'newVersion' || update.status === 'variantRequired') && artifact && download.status !== 'ready' && !downloading && <View style={settingsLayout.controls}>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
          onPress={() => void perform(async () => { const next = await updates.startUpdateDownload(downloadRequest(release, artifact, mirror)); if (alive.current) setDownload(next); })}
          style={({ pressed }) => [styles.primary, settingsLayout.control, { backgroundColor: theme.accent, opacity: busy || pressed ? 0.6 : 1 }]}>
          {busy && <ActivityIndicator color={theme.onAccent} />}
          <Text style={[settingsTypography.body, { color: theme.onAccent }]}>{t('softwareUpdate.updateNow')}</Text>
        </Pressable>
      </View>}
      <SettingsActionRow theme={theme} title={t('softwareUpdate.learnMore')} onPress={() => { if (isReleaseUrl(release.releaseUrl)) void openLink(release.releaseUrl); }} last />
    </SettingsGroup>}
    {Platform.OS === 'android' && download.status !== 'idle' && <SettingsGroup theme={theme}>
      <View style={styles.release}>
        <Text style={[settingsTypography.body, { color: theme.label }]}>{t('softwareUpdate.version', { version: download.version })}</Text>
        <Text accessibilityLiveRegion="polite" style={[settingsTypography.detail, { color: theme.secondary }]}>{t(`softwareUpdate.downloadStatus.${download.status}`)}</Text>
        {downloading && <>
          <View accessibilityRole="progressbar" accessibilityLabel={t('softwareUpdate.downloadStatus.downloading')} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }} style={[styles.track, { backgroundColor: theme.border }]}>
            <View style={[styles.progress, { backgroundColor: theme.accent, width: `${progress * 100}%` }]} />
          </View>
          <Text style={[settingsTypography.detail, { color: theme.secondary }]}>{t('softwareUpdate.progress', { received: formatBytes(download.bytes ?? 0), total: formatBytes(download.total ?? 0) })}</Text>
        </>}
        {download.error && <Text style={[settingsTypography.detail, { color: theme.danger }]}>{t(download.error)}</Text>}
      </View>
      {download.status === 'ready' && <SettingsActionRow theme={theme} title={t('softwareUpdate.install')} disabled={busy} busy={busy}
        onPress={() => void perform(() => updates.installUpdate(false))} />}
      <SettingsActionRow theme={theme} title={t(downloading ? 'common.cancel' : 'softwareUpdate.removeDownload')} disabled={busy}
        onPress={() => void perform(async () => { const next = await updates.cancelUpdateDownload(); if (alive.current) setDownload(next); })} last />
    </SettingsGroup>}
    <SettingsGroup theme={theme}>
      <SettingsActionRow theme={theme} title={t('about.check')} disabled={!loaded || !app || update.status === 'checking'} busy={update.status === 'checking'} onPress={() => { setError(undefined); setAttempt((value) => value + 1); }} last />
    </SettingsGroup>
    {error && <SettingsNote theme={theme}>{t(error)}</SettingsNote>}
  </SettingsPage>;
}
const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0, gap: 4 },
  versionRow: { ...settingsLayout.row, minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12 },
  currentVersion: { fontSize: Math.round(14 * 0.8), lineHeight: Math.round(20 * 0.8), maxWidth: '45%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  packageSize: { ...settingsTypography.body, fontSize: Math.round(settingsTypography.body.fontSize * 0.8), lineHeight: Math.round(settingsTypography.body.lineHeight * 0.8) },
  mirrorRow: { ...settingsLayout.row, flexDirection: 'row', alignItems: 'center' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  release: { ...settingsLayout.row, gap: 16 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  icon: { width: 64, height: 64, borderRadius: settingsLayout.control.borderRadius },
  note: { ...settingsTypography.body, fontWeight: '400' },
  primary: { ...settingsLayout.row, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  track: { height: 4, overflow: 'hidden' },
  progress: { height: '100%' },
});
