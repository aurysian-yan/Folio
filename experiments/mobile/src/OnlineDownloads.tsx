import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { NativeFontPreview, online } from './native';
import { onlineErrorKey, type OnlineEntry } from './online';
import { useOnlineSession } from './OnlineSession';
import { BrowserLibrarySection, useBrowserLibraryScroll } from './BrowserLibrarySection';
import { DotsThreeIcon, FileTextIcon } from './icons';
import { historyDay, searchDownloadJobs } from './browser-data';
import { downloadProgress } from './browser-dashboard';
import { PanelAction } from './panel-content';
import { formatBytes } from './settings-ui';
import type { LibrarySnapshot } from './library';
import type { Theme } from './ui';

// 下载列表、字体检查与收录在聚合页面内切换，离开页面不影响原生任务。
export function OnlineDownloads({ theme, onSnapshotChange, onOpenUrl }: {
  theme: Theme; onSnapshotChange: (snapshot: LibrarySnapshot) => void; onOpenUrl: (url: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const scroll = useBrowserLibraryScroll();
  const content = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => content.current?.scrollTo({ y: 0, animated: false }), []);
  const { state, refresh } = useOnlineSession();
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [panel, setPanel] = useState<'downloads' | 'inspect'>('downloads');
  const backToDownloads = useCallback(() => setPanel('downloads'), []);
  const [entries, setEntries] = useState<OnlineEntry[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [inspectId, setInspectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const operation = useRef(false);
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (cause) { setError(onlineErrorKey(cause)); }
    finally { operation.current = false; setBusy(false); }
  }
  async function inspect(id: string) {
    await run(async () => {
      const value = await online.inspect(id);
      setEntries(value); setSelected(value.filter((item) => item.eligible && !item.duplicate).map((item) => item.id));
      setInspectId(id); setPreviewId(null); setPanel('inspect');
    });
  }
  const jobs = searchDownloadJobs(state?.jobs ?? [], query);
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  return (
    <Animated.ScrollView ref={content} onScroll={scroll.onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never"
      automaticallyAdjustsScrollIndicatorInsets={false} scrollIndicatorInsets={{ top: scroll.top, bottom: scroll.bottom }}
      contentContainerStyle={[styles.content, { paddingTop: scroll.top, paddingBottom: scroll.bottom }]} keyboardShouldPersistTaps="handled">
      <BrowserLibrarySection onSearch={scrollToTop} title={t(panel === 'inspect' ? 'online.browser.review' : 'online.browser.downloads')}
      onBack={panel === 'inspect' ? backToDownloads : undefined} theme={theme}
      search={panel === 'downloads' ? { value: query, onChange: setQuery, placeholder: t('browser.searchDownloads') } : undefined} />
        {errorNode}
        {notice && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{notice}</Text>}
        {!state && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await refresh(); })} />}

        {panel === 'downloads' && state && <>
          {!jobs.length && <Text style={{ color: theme.secondary }}>{t('online.browser.noDownloads')}</Text>}
          {jobs.map((job, index) => {
            const progress = downloadProgress(job.bytesDone, job.bytesTotal);
            return <View key={job.id} style={styles.job}>
            {!!job.createdAt && (index === 0 || historyDay(jobs[index - 1]?.createdAt ?? 0) !== historyDay(job.createdAt)) &&
              <Text accessibilityRole="header" style={[styles.date, { color: theme.secondary }]}>{new Date(job.createdAt).toLocaleDateString(i18n.language)}</Text>}
            <View style={styles.row}>
              <View style={[styles.fileIcon, { backgroundColor: theme.surface }]}><FileTextIcon size={24} color={theme.secondary} /></View>
              <View style={styles.jobBody}>
                <Text numberOfLines={2} style={[styles.jobName, { color: theme.label }]}>{job.name}</Text>
                <Text style={{ color: theme.secondary }}>{t(`online.browser.states.${job.state}`)} · {formatBytes(job.bytesDone)}{job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''}</Text>
                <Text numberOfLines={2} style={{ color: theme.secondary }}>{job.origin.providerName} · {job.origin.downloadHost}</Text>
                {job.state === 'transferring' && (progress === null ? <ActivityIndicator size="small" color={theme.accent} /> :
                  <View accessibilityRole="progressbar" accessibilityLabel={t('online.browser.download')} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                    style={[styles.progress, { backgroundColor: theme.surface }]}><View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.accent }} /></View>)}
                {job.errorKey && <Text style={{ color: theme.danger }}>{t(job.errorKey)}</Text>}
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.edit')} ${job.name}`} accessibilityState={{ expanded: menuId === job.id }}
                onPress={() => setMenuId(menuId === job.id ? null : job.id)} style={styles.more}><DotsThreeIcon size={24} color={theme.secondary} /></Pressable>
            </View>
            {menuId === job.id && <View style={[styles.row, styles.wrap]}>
              {['queued', 'transferring'].includes(job.state) && <PanelAction label={t('online.browser.pause')} theme={theme} disabled={busy} onPress={() => void run(async () => { await online.pause(job.id); await refresh(); })} />}
              <PanelAction label={t('online.browser.openSource')} theme={theme} disabled={busy} onPress={() => {
                onOpenUrl(job.origin.sourcePageUrl);
              }} />
              {job.state === 'ready' && <>{<PanelAction label={t('online.browser.review')} theme={theme} onPress={() => void inspect(job.id)} disabled={busy} />}{<PanelAction label={t('online.browser.saveFile')} theme={theme} onPress={() => void run(() => online.save(job.id))} disabled={busy} />}</>}
              {['failed', 'paused', 'needsUser'].includes(job.state) && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await online.retry(job.id); await refresh(); })} disabled={busy} />}
              {<PanelAction label={t(['queued', 'transferring'].includes(job.state) ? 'common.cancel' : 'common.remove')} theme={theme} onPress={() => void run(async () => { await online.cancel(job.id); await refresh(); })} disabled={busy} />}
            </View>}
          </View>; })}
        </>}
        {panel === 'inspect' && <>
          <Text style={{ color: theme.secondary }}>{t('online.browser.importNotice')}</Text>
          {!entries.length && <Text style={{ color: theme.secondary }}>{t('online.browser.noFonts')}</Text>}
          {entries.map((entry) => <View key={entry.id} style={[styles.job, { padding: 16, backgroundColor: theme.surface }]}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected.includes(entry.id), disabled: !entry.eligible || busy }} disabled={!entry.eligible || busy}
              onPress={() => setSelected((values) => values.includes(entry.id) ? values.filter((id) => id !== entry.id) : [...values, entry.id])}>
              <Text style={[styles.jobName, { color: theme.label }]}>{selected.includes(entry.id) ? '☑ ' : '☐ '}{entry.name}</Text>
              <Text style={{ color: theme.secondary }}>{formatBytes(entry.size)} · {t(!entry.eligible ? 'online.browser.invalidFont' : entry.duplicate ? 'online.browser.duplicate' : 'online.browser.available')}</Text>
              {entry.analysis?.faces.map((face, index) => <Text key={index} style={{ color: theme.secondary }}>{face.family} · {face.style}{face.conflict ? ` · ${t('online.browser.conflict')}` : ''}</Text>)}
            </Pressable>
            {entry.eligible && entry.previewPath && <PanelAction label={t('common.preview')} theme={theme} disabled={busy} onPress={() => setPreviewId(entry.id)} />}
            {previewId === entry.id && entry.previewPath && entry.analysis?.faces[0] && <NativeFontPreview style={styles.fontPreview}
              selection={{ sourcePath: entry.previewPath, faceIndex: entry.analysis.faces[0].faceIndex, revisionId: entry.analysis.fingerprint,
                axes: {}, text: entry.analysis.faces[0].family, fontSize: 28, foregroundColor: theme.label }} onStatus={() => {}} />}
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
    </Animated.ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wrap: { flexWrap: 'wrap' }, job: { gap: 12 }, jobBody: { flex: 1, minWidth: 0, gap: 4 },
  fileIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  more: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, date: { fontSize: 16, lineHeight: 24, fontWeight: '500', paddingVertical: 8 },
  progress: { height: 4, overflow: 'hidden', borderRadius: 2 },
  jobName: { fontSize: 16, fontWeight: '600' }, fontPreview: { height: 120 },
});
