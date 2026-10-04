import { CloudIcon, CardsIcon, DatabaseIcon, DownloadSimpleIcon, InfoIcon, PaintBrushIcon } from './icons';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, AppState, Pressable, StyleSheet, Text, View, type ScrollView } from 'react-native';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { storage } from './native';
import { SettingsGroup, SettingsIcon, SettingsNavRow, formatBytes, settingsLayout, settingsTypography } from './settings-ui';
import { accentPresets, type Theme } from './ui';
import type { CloudSyncController } from './useCloudSync';
import { webdavSourceName } from './sync';

export type SettingsPageId = 'sync' | 'storage' | 'cards' | 'appearance' | 'import' | 'about';

// 设置主页显示真实概览；进入页面和回到前台时刷新存储用量。
export function SettingsScreen({ theme, active, sourceId, controller, onOpenPage }: {
  theme: Theme; active: boolean; sourceId: string; controller: CloudSyncController; onOpenPage: (page: SettingsPageId) => void;
}) {
  const { t } = useTranslation();
  const scrollView = useRef<ScrollView>(null);
  const header = usePageHeader({ sourceId, onSnap: (y, animated) => scrollView.current?.scrollTo({ y, animated }) });
  const [usage, setUsage] = useState<{ total: number; free: number } | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let request = 0;
    const refresh = async () => {
      const current = ++request;
      try {
        const [next, preview] = await Promise.all([storage.usage(), storage.previewBytes()]);
        if (!mounted || current !== request) return;
        setUsage({ total: next.databaseBytes + next.managedFontBytes + preview, free: next.volumeFreeBytes });
        setStorageError(false);
      } catch {
        if (mounted && current === request) { setUsage(null); setStorageError(true); }
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') void refresh(); });
    return () => { mounted = false; subscription.remove(); };
  }, [active]);
  const { state, readError } = controller;
  const mode = theme.dark ? 'dark' : 'light';
  const profile = readError ? null : state?.profile;
  const cloudDetail = readError ? t(readError) : !state ? t('mobile.sync.reading') : t('cloud.notConnected');
  const entries = [
    { id: 'cards', Icon: CardsIcon, color: accentPresets.purple[mode], title: t('settings.cards'), description: t('mobile.settings.cardsSummary') },
    { id: 'appearance', Icon: PaintBrushIcon, color: theme.accent, title: t('settings.appearance'), description: t('mobile.settings.appearanceSummary') },
    { id: 'import', Icon: DownloadSimpleIcon, color: accentPresets.green[mode], title: t('settings.importing'), description: t('mobile.settings.importSummary') },
    { id: 'about', Icon: InfoIcon, color: accentPresets.blue[mode], title: t('settings.about'), description: t('mobile.settings.aboutDescription') },
  ] as const;

  return <NativeScrollContainer hasHeader onInsetsChange={header.onInsetsChange}
    style={[styles.screen, { backgroundColor: theme.background }]}>
    <PageHeader {...header} theme={theme} active={active} title={t('navigation.settings')} />
    <NavigationBackdrop sourceId={sourceId} active={active} theme={theme} style={styles.screen}>
    <Animated.ScrollView ref={scrollView} {...header.snapScrollProps} onScroll={header.onScroll} scrollEventThrottle={16}
      contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
      scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom }}
      contentContainerStyle={[settingsLayout.content, { paddingTop: header.contentTop, paddingBottom: header.contentBottom }]}>
    <PageTitle {...header} title={t('navigation.settings')} theme={theme} style={settingsLayout.pageTitle} />
    <View style={styles.overviewCards}>
      <Pressable accessibilityRole="button" onPress={() => onOpenPage('sync')}
        style={({ pressed }) => [styles.overviewCard, { backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.cardHeader}>
          <SettingsIcon><CloudIcon size={22} color={accentPresets.blue[mode]} /></SettingsIcon>
          <Text style={[styles.cardTitle, { color: theme.label }]}>{t('settings.cloud')}</Text>
        </View>
        <View style={styles.cardBody}>
          {profile ? <>
            <Text numberOfLines={1} style={[styles.cardDetail, { color: theme.secondary }]}>{t('inspector.source')}</Text>
            <Text numberOfLines={1} style={[styles.cloudMetric, { color: theme.label }]}>{webdavSourceName(profile.serverUrl, t)}</Text>
            <Text numberOfLines={1} style={[styles.cardDetail, { color: theme.label }]}>{profile.remoteDirectory || '/'}</Text>
          </> : <>
            <Text style={[styles.cloudMetric, { color: readError ? theme.danger : theme.label }]}>{cloudDetail}</Text>
            <Text style={[styles.cardDetail, { color: theme.secondary }]}>{t('mobile.settings.cloudSummary')}</Text>
          </>}
        </View>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => onOpenPage('storage')}
        style={({ pressed }) => [styles.overviewCard, { backgroundColor: theme.surface, opacity: pressed ? 0.7 : 1 }]}>
        <View style={styles.cardHeader}>
          <SettingsIcon><DatabaseIcon size={22} color={theme.accent} /></SettingsIcon>
          <Text style={[styles.cardTitle, { color: theme.label }]}>{t('settings.storage')}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardDetail, { color: theme.secondary }]}>{t('storage.used')}</Text>
          <Text style={[styles.cardMetric, { color: storageError ? theme.danger : theme.label }, !usage && styles.cardDetail]}>
            {storageError ? t('mobile.settings.storageError') : usage ? formatBytes(usage.total) : t('storage.measuring')}
          </Text>
          <Text style={[styles.cardDetail, { color: theme.secondary }]}>
            {usage ? t('storage.freeSpace', { size: formatBytes(usage.free) }) : t('mobile.settings.storageSummary')}
          </Text>
        </View>
      </Pressable>
    </View>
    {[entries.slice(0, 2), entries.slice(2)].map((group, index) => <SettingsGroup key={index} theme={theme}
      title={index === 0 ? t('settings.display') : undefined}>
      {group.map(({ id, Icon, color, title, description }, row) => <SettingsNavRow key={id} theme={theme}
        icon={<SettingsIcon><Icon size={22} color={color} /></SettingsIcon>}
        title={title} detail={description} onPress={() => onOpenPage(id)} last={row === group.length - 1} />)}
    </SettingsGroup>)}
    </Animated.ScrollView>
    </NavigationBackdrop>
  </NativeScrollContainer>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overviewCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  overviewCard: { borderRadius: settingsLayout.card.borderRadius, flex: 1, minWidth: 144, aspectRatio: 1,
    padding: settingsLayout.section.paddingHorizontal, flexDirection: 'column', gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBody: { flexDirection: 'column', marginTop: 'auto', gap: 3 },
  cardTitle: { ...settingsTypography.body, flexShrink: 1 },
  cardMetric: { ...settingsTypography.metric },
  cloudMetric: { fontSize: 18, lineHeight: 22, fontWeight: '500' },
  cardDetail: { ...settingsTypography.detail, lineHeight: 16 },
});
