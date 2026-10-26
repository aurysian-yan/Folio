import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { online } from './native';
import { onlineErrorKey } from './online';
import { useOnlineSession } from './OnlineSession';
import { BrowserLibrarySection, useBrowserLibraryScroll } from './BrowserLibrarySection';
import { DotsThreeIcon, FileTextIcon } from './icons';
import { historyDay, searchDownloadJobs } from './browser-data';
import { downloadProgress } from './browser-dashboard';
import { PanelAction } from './panel-content';
import { formatBytes } from './settings-ui';
import type { Theme } from './ui';

// 下载列表保留原生任务状态，字体收录进入独立页面。
export function OnlineDownloads({ theme, onOpenUrl }: {
  theme: Theme; onOpenUrl: (url: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const scroll = useBrowserLibraryScroll();
  const content = useRef<ScrollView>(null);
  const scrollToTop = useCallback(() => content.current?.scrollTo({ y: 0, animated: false }), []);
  const { state, refresh, openReview } = useOnlineSession();
  const [query, setQuery] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef(false);
  async function run(action: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError(null);
    try { await action(); } catch (cause) { setError(onlineErrorKey(cause)); }
    finally { operation.current = false; setBusy(false); }
  }
  const jobs = searchDownloadJobs(state?.jobs ?? [], query);
  const errorNode = error && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t(error)}</Text>;
  return (
    <Animated.ScrollView ref={content} onScroll={scroll.onScroll} scrollEventThrottle={16} contentInsetAdjustmentBehavior="never"
      automaticallyAdjustsScrollIndicatorInsets={false} scrollIndicatorInsets={{ top: scroll.top, bottom: scroll.bottom }}
      contentContainerStyle={[styles.content, { paddingTop: scroll.top, paddingBottom: scroll.bottom }]} keyboardShouldPersistTaps="handled">
      <BrowserLibrarySection onSearch={scrollToTop} title={t('online.browser.downloads')} theme={theme}
        search={{ value: query, onChange: setQuery, placeholder: t('browser.searchDownloads') }} />
        {errorNode}
        {!state && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await refresh(); })} />}

        {state && <>
          {!jobs.length && <Text style={{ color: theme.secondary }}>{t('online.browser.noDownloads')}</Text>}
          {jobs.map((job, index) => {
            const progress = downloadProgress(job.bytesDone, job.bytesTotal);
            return <View key={job.id} style={styles.job}>
            {!!job.createdAt && (index === 0 || historyDay(jobs[index - 1]?.createdAt ?? 0) !== historyDay(job.createdAt)) &&
              <Text accessibilityRole="header" style={[styles.date, { color: theme.secondary }]}>{new Date(job.createdAt).toLocaleDateString(i18n.language)}</Text>}
            <View style={styles.row}>
              <View style={[styles.fileIcon, { backgroundColor: theme.surface }]}><FileTextIcon size={24} color={theme.secondary} /></View>
              <Pressable style={styles.jobBody} accessibilityRole={job.state === 'ready' ? 'button' : undefined}
                accessibilityLabel={job.state === 'ready' ? `${t('online.browser.review')} ${job.name}` : undefined}
                disabled={busy || job.state !== 'ready'} onPress={() => openReview(job.id)}>
                <Text numberOfLines={2} style={[styles.jobName, { color: theme.label }]}>{job.name}</Text>
                <Text style={{ color: theme.secondary }}>{t(`online.browser.states.${job.state}`)} · {formatBytes(job.bytesDone)}{job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''}</Text>
                <Text numberOfLines={2} style={{ color: theme.secondary }}>{job.origin.providerName} · {job.origin.downloadHost}</Text>
                {job.state === 'transferring' && (progress === null ? <ActivityIndicator size="small" color={theme.accent} /> :
                  <View accessibilityRole="progressbar" accessibilityLabel={t('online.browser.download')} accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                    style={[styles.progress, { backgroundColor: theme.surface }]}><View style={{ height: '100%', width: `${progress * 100}%`, backgroundColor: theme.accent }} /></View>)}
                {job.errorKey && <Text style={{ color: theme.danger }}>{t(job.errorKey)}</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`${t('common.edit')} ${job.name}`} accessibilityState={{ expanded: menuId === job.id }}
                onPress={() => setMenuId(menuId === job.id ? null : job.id)} style={styles.more}><DotsThreeIcon size={24} color={theme.secondary} /></Pressable>
            </View>
            {menuId === job.id && <View style={[styles.row, styles.wrap]}>
              {['queued', 'transferring'].includes(job.state) && <PanelAction label={t('online.browser.pause')} theme={theme} disabled={busy} onPress={() => void run(async () => { await online.pause(job.id); await refresh(); })} />}
              <PanelAction label={t('online.browser.openSource')} theme={theme} disabled={busy} onPress={() => {
                onOpenUrl(job.origin.sourcePageUrl);
              }} />
              {job.state === 'ready' && <>{<PanelAction label={t('online.browser.review')} theme={theme} onPress={() => openReview(job.id)} disabled={busy} />}{<PanelAction label={t('online.browser.saveFile')} theme={theme} onPress={() => void run(() => online.save(job.id))} disabled={busy} />}</>}
              {['failed', 'paused', 'needsUser'].includes(job.state) && <PanelAction label={t('common.retry')} theme={theme} onPress={() => void run(async () => { await online.retry(job.id); await refresh(); })} disabled={busy} />}
              {<PanelAction label={t(['queued', 'transferring'].includes(job.state) ? 'common.cancel' : 'common.remove')} theme={theme} onPress={() => void run(async () => { await online.cancel(job.id); await refresh(); })} disabled={busy} />}
            </View>}
          </View>; })}
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
  jobName: { fontSize: 16, fontWeight: '600' },
});
