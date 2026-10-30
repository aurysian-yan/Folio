import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useBrowserData } from './BrowserDataProvider';
import { browserHost, personalFolderId, type Bookmark } from './browser-data';
import { dashboardColumns, downloadProgress, recentDashboardEntries, type DashboardSection } from './browser-dashboard';
import { BookmarkPreview } from './BookmarkPreview';
import { usePreferences } from './settings';
import { SettingsChoiceRow, SettingsSwitchRow, formatBytes, settingsLayout } from './settings-ui';
import { useNavigationScroll } from './NavigationScroll';
import { ReorderableList, ReorderScrollContext, useReorderScroll } from './ReorderableList';
import { PanelAction } from './panel-content';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import { BookmarkIcon, ClockIcon, DownloadSimpleIcon } from './icons';
import type { OnlineJob, OnlineProvider } from './online';
import type { Theme } from './ui';

interface DashboardItem { id: string; title: string; url: string; providerId: string | null; bookmark?: Bookmark; job?: OnlineJob }
export function BrowserDashboard({ theme, providers, jobs, active, bottomInset, onOpen, onEditBookmark, onLibrary, onDownloads }: {
  theme: Theme; providers: OnlineProvider[]; jobs: OnlineJob[]; active: boolean; bottomInset: number;
  onOpen: (url: string, providerId?: string | null) => void; onEditBookmark: (item: Bookmark) => void;
  onLibrary: (tab: 'bookmarks' | 'history') => void; onDownloads: () => void;
}) {
  const { t } = useTranslation();
  const { data, ready, error, retry } = useBrowserData();
  const { preferences, update } = usePreferences();
  const { width, fontScale } = useWindowDimensions();
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [contentWidth, setContentWidth] = useState(width - 32);
  const normalColumns = dashboardColumns('normal', contentWidth, fontScale);
  const normalCardWidth = (contentWidth - (normalColumns - 1) * 12) / normalColumns;
  const normalIconSize = Math.min(normalCardWidth, 88);
  const normalCircleSize = Math.max(0, normalIconSize - 8);
  const scroll = useRef<ScrollView>(null);
  const reorder = useReorderScroll(scroll);
  const navigation = useNavigationScroll();
  const sections = preferences.browserDashboard.filter((section) => !section.id.startsWith('folder:') || data.folders.some((folder) => section.id === `folder:${folder.id}`));
  const choices = [{ id: 'personal', title: t('browser.personal') }, { id: 'recent', title: t('browser.recent') },
    ...data.folders.map((folder) => ({ id: `folder:${folder.id}`, title: folder.name })), { id: 'downloads', title: t('online.browser.downloads') }];
  const title = (section: { id: string }) => choices.find((choice) => choice.id === section.id)?.title ?? '';
  const patch = (id: string, change: Partial<DashboardSection>) => update({ browserDashboard: sections.map((section) => section.id === id ? { ...section, ...change } : section) });
  const rows = (section: DashboardSection): DashboardItem[] => {
    if (section.id === 'downloads') return jobs.filter((job) => job.state !== 'cancelled').map((job) => ({ id: job.id, title: job.name, url: job.origin.sourcePageUrl, providerId: job.origin.providerId, job }));
    if (section.id === 'recent') return recentDashboardEntries(data.history, providers, preferences.browserShowSourceHomes);
    const folderId = section.id === 'personal' ? personalFolderId : section.id.slice(7);
    return data.bookmarks.filter((item) => item.folderId === folderId).map((item) => ({ ...item, bookmark: item }));
  };
  return <ReorderScrollContext.Provider value={reorder.value}>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.content, { paddingBottom: bottomInset }]}
      contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false} scrollIndicatorInsets={{ bottom: bottomInset }}
      onLayout={({ nativeEvent }) => setContentWidth(Math.max(1, nativeEvent.layout.width - 32))}
      onScrollBeginDrag={({ nativeEvent }) => { if (!editing) navigation.begin(nativeEvent.contentOffset.y); }} onMomentumScrollEnd={navigation.end} onScrollEndDrag={({ nativeEvent }) => { if (Math.abs(nativeEvent.velocity?.y ?? 0) < 0.05) navigation.end(); }}
      onScroll={({ nativeEvent }) => { reorder.onScroll(nativeEvent.contentOffset.y); if (!editing) navigation.scroll(nativeEvent.contentOffset.y); }} scrollEventThrottle={16}>
      {error && <><Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('browser.saveError')}</Text><PanelAction theme={theme} label={t('common.retry')} onPress={retry} /></>}
      <ReorderableList items={sections} onChange={(browserDashboard) => update({ browserDashboard })} enabled={editing} theme={theme} label={title}
        renderItem={(section, handle) => {
          const items = rows(section);
          const columns = dashboardColumns(section.style, contentWidth, fontScale);
          const visible = expanded[section.id] ? items : items.slice(0, columns * section.rows);
          const cardWidth = (contentWidth - (columns - 1) * 12) / columns;
          const overflow = items.length > columns * section.rows;
          return <View style={styles.section}>
            <View style={styles.sectionHeader}>{handle}<Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.label }]}>{title(section)}</Text>
              {editing && <PanelAction theme={theme} label={t('common.remove')} onPress={() => update({ browserDashboard: sections.filter((item) => item.id !== section.id) })} />}</View>
            {editing && <View style={[styles.configuration, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]}>
              <SettingsChoiceRow theme={theme} title={t('browser.cardStyle')} value={section.style}
                options={(['normal', 'detailed', 'list'] as const).map((value) => ({ value, label: t(`browser.styles.${value}`) }))}
                onChange={(style) => patch(section.id, { style })} />
              <SettingsChoiceRow theme={theme} title={t('browser.collapsedRows')} value={String(section.rows)}
                options={[1, 2, 3, 4, 5, 6].map((value) => ({ value: String(value), label: t('browser.rowCount', { count: value }) }))}
                onChange={(value) => patch(section.id, { rows: Number(value) })} />
              {section.id === 'recent' && <SettingsSwitchRow theme={theme} title={t('browser.showSourceHomes')} value={preferences.browserShowSourceHomes}
                onChange={(browserShowSourceHomes) => update({ browserShowSourceHomes })} last />}
            </View>}
            {!!items.length && <View style={styles.grid}>{visible.map((item) => {
              const provider = providers.find((provider) => provider.id === item.providerId);
              const isList = section.style === 'list';
              const job = item.job;
              return <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={job ? `${item.title}，${t(`online.browser.states.${job.state}`)}` : item.title}
                disabled={editing} onPress={() => job ? onDownloads() : onOpen(item.url, item.providerId)}
                onLongPress={item.bookmark && !editing ? () => onEditBookmark(item.bookmark!) : undefined}
                style={({ pressed }) => [styles.card, { width: cardWidth, opacity: pressed ? 0.7 : 1 }, section.style === 'normal' ? styles.normalCard : [styles.surfaceCard, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }], isList && styles.list]}>
                {section.style === 'detailed' ? <BookmarkPreview active={active && !editing} url={item.url} title={item.title} provider={provider} theme={theme} afterTitle={job && <DownloadStatus job={job} theme={theme} />} /> : <>
                  <View style={[styles.iconSlot, isList ? styles.listIcon : { width: normalIconSize, height: normalIconSize }]}>
                    <View style={[styles.iconCard, {
                      width: isList ? 36 : normalCircleSize, height: isList ? 36 : normalCircleSize,
                      borderRadius: (isList ? 36 : normalCircleSize) / 2, backgroundColor: theme.surface,
                    }]}>
                      {job ? <DownloadSimpleIcon size={isList ? 24 : 38} color={theme.accent} /> : <OnlineSourceIcon provider={provider} theme={theme} size={isList ? 28 : 38} />}
                    </View>
                  </View>
                  <View style={[styles.itemBody, !isList && { width: '100%', alignItems: 'center' }]}>
                    <Text numberOfLines={2} style={{ color: theme.label, fontSize: 15, lineHeight: 20, textAlign: isList ? 'left' : 'center' }}>{item.title}</Text>
                    {job ? <DownloadStatus job={job} theme={theme} compact={!isList} /> : isList && <Text numberOfLines={1} style={{ color: theme.secondary }}>{browserHost(item.url)}</Text>}
                  </View>
                </>}
              </Pressable>;
            })}</View>}
            {!items.length && <View style={[styles.empty, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]}><Text style={{ color: theme.secondary }}>{t(section.id === 'downloads' ? 'online.browser.noDownloads' : section.id === 'recent' ? 'browser.noHistory' : section.id === 'personal' ? 'browser.noPersonal' : 'browser.noBookmarks')}</Text></View>}
            {overflow && <PanelAction theme={theme} label={t(expanded[section.id] ? 'common.collapse' : 'common.expand')} onPress={() => { navigation.end(); setExpanded((value) => ({ ...value, [section.id]: !value[section.id] })); }} />}
          </View>;
        }} />
      {editing && <View style={[styles.configuration, { backgroundColor: theme.surface, ...(theme.ui?.material ? { borderRadius: theme.ui.shapes.card } : {}) }]}>
        <Text accessibilityRole="header" style={[styles.sectionTitle, { color: theme.label }]}>{t('browser.addSection')}</Text>
        {choices.filter((choice) => !sections.some((section) => section.id === choice.id)).map((choice) => <PanelAction key={choice.id} theme={theme} label={choice.title}
          onPress={() => update({ browserDashboard: [...sections, { id: choice.id, rows: 2, style: 'normal' }] })} />)}
      </View>}
      <View style={styles.grid}>
        {[
          { id: 'bookmarks', label: t('browser.bookmarks'), Icon: BookmarkIcon, onPress: () => onLibrary('bookmarks') },
          { id: 'history', label: t('browser.history'), Icon: ClockIcon, onPress: () => onLibrary('history') },
          { id: 'downloads', label: t('online.browser.downloads'), Icon: DownloadSimpleIcon, onPress: onDownloads },
        ].map(({ id, label, Icon, onPress }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label}
          onPress={onPress} style={({ pressed }) => [styles.card, styles.normalCard, { width: normalCardWidth, opacity: pressed ? 0.7 : 1 }]}>
          <View style={[styles.iconSlot, { width: normalIconSize, height: normalIconSize }]}>
            <View style={[styles.iconCard, { width: normalCircleSize, height: normalCircleSize, borderRadius: normalCircleSize / 2, backgroundColor: theme.surface }]}>
              <Icon size={36} color={theme.accent} />
            </View>
          </View>
          <Text numberOfLines={2} style={[styles.shortcutLabel, { color: theme.label }]}>{label}</Text>
        </Pressable>)}
      </View>
      <View style={styles.editButton}>
        <PanelAction theme={theme} disabled={!ready} label={t(editing ? 'common.done' : 'common.edit')}
          onPress={() => { navigation.end(); setEditing(!editing); }} />
      </View>
    </ScrollView>
  </ReorderScrollContext.Provider>;
}
function DownloadStatus({ job, theme, compact = false }: { job: OnlineJob; theme: Theme; compact?: boolean }) {
  const { t } = useTranslation();
  const progress = downloadProgress(job.bytesDone, job.bytesTotal);
  return <View style={styles.status}>
    {job.state === 'transferring' && <View accessibilityRole="progressbar" accessibilityLabel={t('online.browser.download')}
      accessibilityValue={progress === null ? { text: t('online.browser.states.transferring') } : { min: 0, max: 100, now: Math.round(progress * 100) }}
      style={[styles.progress, { backgroundColor: theme.raised }]}>
      {progress === null ? <IndeterminateProgress theme={theme} /> : <View style={{ backgroundColor: theme.accent, width: `${progress * 100}%`, height: '100%' }} />}
    </View>}
    {!compact && <><Text style={{ color: theme.secondary }}>{t(`online.browser.states.${job.state}`)}</Text>
      <Text style={{ color: theme.secondary }}>{formatBytes(job.bytesDone)}{job.bytesTotal ? ` / ${formatBytes(job.bytesTotal)}` : ''}</Text></>}
  </View>;
}
function IndeterminateProgress({ theme }: { theme: Theme }) {
  const [progress] = useState(() => new Animated.Value(0));
  const [width, setWidth] = useState(0);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduced(value); });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { mounted = false; listener.remove(); };
  }, []);
  useEffect(() => {
    if (reduced) return;
    const animation = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: true }));
    animation.start(); return () => animation.stop();
  }, [progress, reduced]);
  return <View style={StyleSheet.absoluteFill} onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}>
    <Animated.View style={{ width: '35%', height: '100%', backgroundColor: theme.accent,
      transform: [{ translateX: reduced ? width * 0.325 : progress.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.35, width] }) }] }} />
  </View>;
}
const styles = StyleSheet.create({
  content: { padding: 16, gap: 16 }, sectionHeader: { paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  section: { gap: 12, paddingBottom: 24 }, sectionTitle: { fontSize: 20, lineHeight: 28, fontWeight: '600', flex: 1 }, grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { gap: 8 }, normalCard: { alignItems: 'center' }, surfaceCard: { ...settingsLayout.card, alignItems: 'stretch', padding: 12 }, list: { flexDirection: 'row', alignItems: 'center' },
  iconSlot: { alignItems: 'center', justifyContent: 'center' }, iconCard: { ...settingsLayout.card, alignItems: 'center', justifyContent: 'center' }, listIcon: { width: 44, height: 44 },
  itemBody: { flexShrink: 1, gap: 4 }, status: { gap: 4, alignSelf: 'stretch' }, progress: { width: '100%', height: 4, borderRadius: 2, overflow: 'hidden' },
  configuration: { ...settingsLayout.card, gap: 8, padding: 12 }, empty: { ...settingsLayout.card, padding: 16 },
  shortcutLabel: { fontSize: 15, lineHeight: 20, textAlign: 'center' }, editButton: { alignItems: 'center' },
});
