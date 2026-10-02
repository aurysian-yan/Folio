import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PanelTabs } from './PanelTabs';
import type { LibrarySnapshot } from './library';
import type { CloudAction, CloudFont, SyncConflict, SyncResolution } from './sync';
import { cloudSync } from './native';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsValueRow, formatBytes } from './settings-ui';
import type { CloudSyncController } from './useCloudSync';
import type { Theme } from './ui';

// 云端文件不进入本地预览、筛选与智慧匹配。
export function CloudScreen({ theme, controller, snapshot, onConfigure }: { theme: Theme; controller: CloudSyncController; snapshot: LibrarySnapshot | null; onConfigure: () => void }) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const { state, readError, actionError, busy, run } = controller;
  const status = state?.status;
  const [section, setSection] = useState('fonts');
  const disabled = controller.blocked || !!readError || !state?.profile;
  function fontAction(font: CloudFont, action: CloudAction) {
    const execute = () => { void run(() => cloudSync.fontAction(font.fingerprint, action), true).then((success) => {
      if (success && action !== 'cloudOnly') controller.requestSync();
    }); };
    if (action === 'delete' || action === 'cloudOnly') {
      Alert.alert(t(action === 'delete' ? 'cloud.deleteConfirmTitle' : 'cloud.keepCloudOnly'),
        `${font.displayName || font.filename}\n${t(action === 'delete' ? 'cloud.deleteConfirmMessage' : 'cloud.cloudOnlyConfirmMessage')}`,
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
  return <FlatList style={{ flex: 1, backgroundColor: theme.background }}
    contentContainerStyle={[styles.content, { paddingTop: inset.top + 16,
      paddingBottom: inset.bottom + 96 }]} data={readError ? [] : state?.fonts.filter((font) => font.deleted === (section === 'deleted')) ?? []}
    keyExtractor={(font) => font.fingerprint}
    ListHeaderComponent={<View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{t('mobile.cloudFonts')}</Text>
      <SettingsGroup theme={theme}>
        <SettingsActionRow title={t('settings.cloud')} theme={theme} onPress={onConfigure} />
        <SettingsValueRow title={t('cloud.syncStatus')} theme={theme} value={readError ? t(readError)
          : !state ? t('mobile.sync.reading') : !state.profile ? t('cloud.notConnected')
            : status?.isRunning ? t('cloud.syncingPercent', { percent: status.percent })
              : t(phaseKey(status?.phase))} />
        {status?.isRunning && <SettingsValueRow title={t(stageKey(status.stage))} theme={theme}
          value={`${status.stageCompleted} / ${status.stageTotal}`} />}
        <SettingsActionRow title={status?.isRunning ? t('cloud.cancelSync') : t('cloud.syncNow')} theme={theme}
          disabled={(busy || (!status?.isRunning && controller.blocked)) || !state?.profile || (!status?.isRunning && (!!readError || !state.credentialAvailable))}
          busy={busy} onPress={() => { void (status?.isRunning ? controller.cancel() : controller.start()); }} last />
      </SettingsGroup>
      {status && <SettingsNote theme={theme}>{t('cloud.uploadedCount', { count: status.uploadedFiles })} · {t('cloud.downloadedCount', { count: status.downloadedFiles })}</SettingsNote>}
      {status?.phase === '同步失败' && <SettingsNote theme={theme}>{t(status.errorMessage?.includes('认证失败') ? 'mobile.sync.authenticationError' : 'cloud.syncIncomplete')}</SettingsNote>}
      {!!state?.credentialError && <SettingsNote theme={theme}>{t('mobile.sync.credentialsError')}</SettingsNote>}
      {!!state?.profile && !state.credentialAvailable && <SettingsNote theme={theme}>{t('cloud.passwordUnavailable')}</SettingsNote>}
      {!!actionError && <SettingsNote theme={theme}>{t(actionError)}</SettingsNote>}
      {!!readError && <SettingsActionRow title={t('common.retry')} theme={theme} onPress={() => { void controller.refresh().catch(() => undefined); }} last />}
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
      <PanelTabs label={t('mobile.cloudFonts')} value={section} theme={theme} disabled={false}
        options={[{ value: 'fonts', label: t('cloud.cloudFiles'), systemImage: 'cloud' },
          { value: 'deleted', label: t('cloud.recentlyDeleted'), systemImage: 'trash' }]} onChange={setSection} />
    </View>}
    ListEmptyComponent={!readError && state ? <SettingsNote theme={theme}>{t(section === 'deleted' ? 'cloud.deletedEmpty' : 'cloud.emptyHint')}</SettingsNote> : null}
    renderItem={({ item }) => {
      const progress = status?.isRunning ? status.items.find((entry) => entry.fingerprint === item.fingerprint) : undefined;
      const action = t(progress?.action === 'upload' ? 'cloud.upload' : 'cloud.download');
      return <SettingsGroup theme={theme}>
        <SettingsValueRow title={item.displayName || item.filename} detail={item.filename} theme={theme} value={formatBytes(item.fileSize)} />
        <SettingsValueRow title={t('cloud.syncStatus')} theme={theme} value={progress ? t(progress.status === 'done' ? 'cloud.completed'
          : progress.status === 'running' ? 'cloud.running' : 'cloud.waiting', { action })
          : t(item.deleted ? 'cloud.recentlyDeleted' : item.localAvailable ? 'cloud.availableLocally' : 'cloud.cloudOnly')} />
        {item.deleted ? <SettingsActionRow title={t('cloud.restore')} theme={theme} disabled={disabled}
          onPress={() => fontAction(item, 'restore')} last /> : <>
          <SettingsActionRow title={t(item.localAvailable ? 'cloud.keepCloudOnly' : 'cloud.downloadAgain')} theme={theme}
            disabled={disabled} onPress={() => fontAction(item, item.localAvailable ? 'cloudOnly' : 'download')} />
          <SettingsActionRow title={t('cloud.deleteEverywhere')} theme={theme} disabled={disabled} destructive
            onPress={() => fontAction(item, 'delete')} last />
        </>}
      </SettingsGroup>;
    }} />;
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
const styles = StyleSheet.create({ content: { paddingHorizontal: 16, gap: 16 }, header: { gap: 16 }, title: { fontSize: 32, fontWeight: '700', paddingHorizontal: 4 } });
