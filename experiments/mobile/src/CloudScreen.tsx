import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { CloudIcon, CaretRightIcon } from './icons';
import { ActivityIndicator, Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { NavigationBackdrop } from './bottom-navigation';
import { NativeScrollContainer } from './native-controls';
import { PageHeader, PageTitle, usePageHeader } from './PageHeader';
import { CloudPanelTabs } from './CloudPanelTabs';
import { CloudFontCard } from './CloudFontCard';
import type { LibrarySnapshot } from './library';
import type { CloudAction, CloudFont, SyncConflict, SyncResolution } from './sync';
import { matchingWebdavPreset, webdavPresets } from './sync';
import { cloudSync } from './native';
import { SettingsActionRow, SettingsGroup, SettingsIcon, SettingsNote, SettingsValueRow, settingsLayout, settingsTypography } from './settings-ui';
import type { CloudSyncController } from './useCloudSync';
import type { Theme } from './ui';

// 云端文件管理复用统一字体详情入口。
export function CloudScreen({ theme, active, sourceId, controller, snapshot, onConfigure, onOpenFont }: {
  theme: Theme; active: boolean; sourceId: string; controller: CloudSyncController; snapshot: LibrarySnapshot | null; onConfigure: () => void; onOpenFont: (font: CloudFont) => void;
}) {
  const { t } = useTranslation();
  const list = useRef<Animated.FlatList<CloudFont>>(null);
  const header = usePageHeader({ sourceId, onSnap: (offset, animated) => list.current?.scrollToOffset({ offset, animated }) });
  const { state, readError, actionError, busy, run } = controller;
  const status = state?.status;
  const provider = !readError && state?.profile
    ? webdavPresets.find((preset) => preset.id === matchingWebdavPreset(state.profile!.serverUrl)) : undefined;
  const [section, setSection] = useState('fonts');
  const openSwipe = useRef<SwipeableMethods | null>(null);
  const disabled = busy || controller.blocked || !!readError || !state?.profile || !state.credentialAvailable;
  const syncLabel = readError ? t(readError) : !state ? t('mobile.sync.reading') : !state.profile ? t('cloud.notConnected')
    : status?.isRunning ? t('cloud.syncingPercent', { percent: status.percent }) : t(phaseKey(status?.phase));
  const syncDisabled = busy || (!state && !readError) || (!readError && !!state?.profile
    && ((!status?.isRunning && controller.blocked) || (!status?.isRunning && !state.credentialAvailable)));
  function fontAction(font: CloudFont, action: CloudAction) {
    if (action === 'download') {
      void cloudSync.fontAction(font.fingerprint, action).then(async () => { controller.requestSync(); await controller.refresh(); }).catch(() => { void controller.refresh(); });
      return;
    }
    const execute = () => { void run(() => cloudSync.fontAction(font.fingerprint, action), true).then((success) => {
      if (success && action !== 'cloudOnly') controller.requestSync();
    }); };
    if (action === 'delete' || action === 'cloudOnly') {
      Alert.alert(t(action === 'delete' ? 'fontLocation.deleteTitle' : 'fontLocation.removeDownload'),
        `${font.displayName || font.filename}\n${t(action === 'delete' ? 'fontLocation.deleteHint' : 'cloud.cloudOnlyConfirmMessage')}`,
        [{ text: t('common.cancel'), style: 'cancel' },
          { text: t(action === 'delete' ? 'cloud.deleteEverywhere' : 'cloud.keepCloudOnly'), style: 'destructive', onPress: execute }]);
    } else execute();
  }
  function resolve(conflict: SyncConflict, resolution: SyncResolution) {
    const execute = () => { void run(() => cloudSync.resolve(conflict.id, resolution), true).then((success) => {
      if (success) controller.requestSync();
    }); };
    if (resolution === 'keepBoth') execute();
    else Alert.alert(t('cloud.conflictConfirmTitle'), t('cloud.conflictConfirmMessage'),
      [{ text: t('common.cancel'), style: 'cancel' },
        { text: t(resolution === 'useLocal' ? 'cloud.useLocal' : 'cloud.useRemote'), style: 'destructive', onPress: execute }]);
  }
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <NativeScrollContainer hasHeader onInsetsChange={header.onInsetsChange} style={{ flex: 1, backgroundColor: theme.background }}>
    <PageHeader {...header} theme={theme} active={active} title={t('mobile.cloudFonts')} />
    <NavigationBackdrop sourceId={sourceId} active={active} theme={theme} style={{ flex: 1 }}>
    <Animated.FlatList ref={list} {...header.snapScrollProps} style={{ flex: 1 }} onScroll={header.onScroll} scrollEventThrottle={16}
    contentInsetAdjustmentBehavior="never" automaticallyAdjustsScrollIndicatorInsets={false}
    scrollIndicatorInsets={{ top: header.contentTop, bottom: header.contentBottom }}
    contentContainerStyle={[styles.content, { paddingTop: header.contentTop,
      paddingBottom: header.contentBottom }]} data={readError ? [] : state?.fonts.filter((font) => font.deleted === (section === 'deleted')) ?? []}
    onScrollBeginDrag={() => openSwipe.current?.close()}
    keyExtractor={(font) => font.fingerprint}
    ListHeaderComponent={<View style={styles.header}>
      <PageTitle {...header} title={t('mobile.cloudFonts')} theme={theme} />
      <SettingsGroup theme={theme}>
        <Pressable accessibilityRole="button" onPress={onConfigure}
          style={({ pressed }) => [styles.connection, { opacity: pressed ? 0.7 : 1 }]}>
          <SettingsIcon><CloudIcon size={22} color={theme.accent} /></SettingsIcon>
          <View style={styles.connectionBody}>
            <Text numberOfLines={1} style={[styles.connectionTitle, { color: theme.label }]}>{t(provider?.url ? provider.label : 'settings.cloud')}</Text>
          </View>
          <CaretRightIcon size={18} color={theme.muted} />
        </Pressable>
        <View style={styles.syncOverview}>
          <Text accessibilityLiveRegion="polite" style={[styles.syncTitle, { color: readError ? theme.danger : theme.label }]}>{syncLabel}</Text>
          {!readError && status && !!state?.profile && <Text style={[styles.connectionDetail, { color: theme.secondary }]}>
            {t('cloud.uploadedCount', { count: status.uploadedFiles })} · {t('cloud.downloadedCount', { count: status.downloadedFiles })}
          </Text>}
          {!readError && status?.isRunning && <>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: status.percent }}
              accessibilityLabel={t('cloud.syncStatus')} style={[styles.progress, { backgroundColor: theme.raised }]}>
              <View style={{ width: `${Math.max(0, Math.min(100, status.percent))}%`, height: '100%', backgroundColor: theme.accent }} />
            </View>
            <Text style={[styles.connectionDetail, { color: theme.secondary }]}>
              {t(stageKey(status.stage))} · {status.stageCompleted} / {status.stageTotal}
            </Text>
          </>}
        </View>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: syncDisabled, busy }} disabled={syncDisabled}
          style={({ pressed }) => [styles.syncButton, { backgroundColor: status?.isRunning ? theme.raised : theme.accent,
            opacity: syncDisabled ? 0.4 : pressed ? 0.7 : 1 }]} onPress={() => {
            if (readError) { void controller.refresh().catch(() => undefined); }
            else if (!state?.profile) onConfigure();
            else { void (status?.isRunning ? controller.cancel() : controller.start()); }
          }}>
          {busy && <ActivityIndicator size="small" color={status?.isRunning ? theme.accent : theme.onAccent} />}
          <Text style={[styles.syncButtonLabel, { color: status?.isRunning ? theme.accent : theme.onAccent }]}>
            {t(readError ? 'common.retry' : !state?.profile ? 'cloud.connectTitle' : status?.isRunning ? 'cloud.cancelSync' : 'cloud.syncNow')}
          </Text>
        </Pressable>
      </SettingsGroup>
      {status?.phase === '同步失败' && <SettingsNote theme={theme}>{t(status.errorMessage?.includes('认证失败') ? 'mobile.sync.authenticationError' : 'cloud.syncIncomplete')}</SettingsNote>}
      {!!state?.credentialError && <SettingsNote theme={theme}>{t('mobile.sync.credentialsError')}</SettingsNote>}
      {!!state?.profile && !state.credentialAvailable && <SettingsNote theme={theme}>{t('cloud.passwordUnavailable')}</SettingsNote>}
      {!!actionError && <SettingsNote theme={theme}>{t(actionError)}</SettingsNote>}
      {!!state?.conflicts.length && <SettingsGroup theme={theme} title={t('cloud.conflicts')}>
        {state.conflicts.map((conflict) => <View key={conflict.id}>
          <SettingsValueRow title={t(`cloud.conflictKinds.${conflict.kind}`)} theme={theme}
            value={[...(snapshot?.collections ?? []), ...(snapshot?.smartFolders ?? [])].find((item) => conflict.id.endsWith(item.id))?.name ?? ''} />
          {!!conflict.localFingerprint && <SettingsValueRow title={t('cloud.useLocal')} theme={theme}
            value={state.fonts.find((font) => font.fingerprint === conflict.localFingerprint)?.filename ?? ''} />}
          {!!conflict.remoteFingerprint && <SettingsValueRow title={t('cloud.useRemote')} theme={theme}
            value={state.fonts.find((font) => font.fingerprint === conflict.remoteFingerprint)?.filename ?? ''} />}
          {(['keepBoth', 'useLocal', 'useRemote'] as const).map((resolution) => <SettingsActionRow key={resolution}
            title={t(`cloud.${resolution}`)} theme={theme} disabled={disabled} destructive={resolution !== 'keepBoth'}
            onPress={() => resolve(conflict, resolution)} last={resolution === 'useRemote'} />)}
        </View>)}
      </SettingsGroup>}
      <CloudPanelTabs label={t('mobile.cloudFonts')} value={section} theme={theme} disabled={false}
        options={[{ value: 'fonts', label: t('cloud.cloudFiles'), systemImage: 'cloud' },
          { value: 'deleted', label: t('cloud.recentlyDeleted'), systemImage: 'trash' }]} onChange={(value) => {
            openSwipe.current?.close(); setSection(value);
          }} />
    </View>}
    ListEmptyComponent={!readError && state ? <SettingsNote theme={theme}>{t(section === 'deleted' ? 'cloud.deletedEmpty'
      : !state.profile ? 'cloud.connectInSettingsHint' : 'cloud.emptyHint')}</SettingsNote> : null}
    renderItem={({ item }) => {
      const progress = status?.items.find((entry) => entry.fingerprint === item.fingerprint);
      const action = t(progress?.action === 'upload' ? 'cloud.upload' : 'cloud.download');
      return <CloudFontCard canDownload={!busy && !readError && !!state?.profile && !!state.credentialAvailable} onDetails={() => onOpenFont(item)} font={item} theme={theme} disabled={disabled} status={progress ? t(progress.status === 'failed' ? 'fontLocation.transfer.failed' : progress.status === 'cancelled' ? 'fontLocation.transfer.cancelled' : progress.status === 'done' ? 'cloud.completed'
          : progress.status === 'running' ? 'cloud.running' : 'cloud.waiting', { action })
          : item.deleted ? t('cloud.recentlyDeleted') : ''}
        onAction={(next) => fontAction(item, next)} onOpen={(methods) => {
          if (openSwipe.current !== methods) openSwipe.current?.close();
          openSwipe.current = methods;
        }} />;
    }} />
    </NavigationBackdrop>
    </NativeScrollContainer>
  </GestureHandlerRootView>;
}
function phaseKey(phase?: string) {
  if (phase === '已同步') return 'mobile.sync.synced';
  if (phase === '同步失败') return 'cloud.syncIncomplete';
  if (phase === '已取消') return 'cloud.syncCancelled';
  return 'mobile.sync.pending';
}
function stageKey(stage: string) {
  return ({ '连接云端': 'mobile.sync.connecting', '检查本地改动': 'mobile.sync.scanning', '上传字体': 'mobile.sync.uploading',
    '接收云端变更': 'mobile.sync.receiving', '下载字体': 'mobile.sync.downloading', '收尾处理': 'mobile.sync.finishing' } as Record<string, string>)[stage] ?? 'cloud.syncing';
}
const styles = StyleSheet.create({
  content: { ...settingsLayout.content, gap: 12 }, header: { gap: 24 },
  connection: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
  connectionBody: { flex: 1, gap: 4 }, connectionTitle: { ...settingsTypography.body },
  connectionDetail: { ...settingsTypography.detail },
  syncOverview: { paddingHorizontal: 20, paddingBottom: 16, gap: 8 },
  syncTitle: { fontSize: 22, lineHeight: 30, fontWeight: '500' },
  progress: { height: 8, borderRadius: 4, overflow: 'hidden' },
  syncButton: { ...settingsLayout.insetControl, marginHorizontal: 16, marginBottom: 16, borderRadius: 8, minHeight: 44,
    paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  syncButtonLabel: { fontSize: 14, lineHeight: 20, fontWeight: '600', textAlign: 'center' },
});
