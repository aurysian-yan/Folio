import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cloudSync } from './native';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsValueRow, formatBytes } from './settings-ui';
import type { CloudSyncController } from './useCloudSync';
import type { Theme } from './ui';

// 云端文件不进入本地预览、筛选与智慧匹配。
export function CloudScreen({ theme, controller, onConfigure }: { theme: Theme; controller: CloudSyncController; onConfigure: () => void }) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const { state, readError, actionError, busy, run } = controller;
  const status = state?.status;
  return <FlatList style={{ flex: 1, backgroundColor: theme.background }}
    contentContainerStyle={[styles.content, { paddingTop: inset.top + 16,
      paddingBottom: inset.bottom + 96 }]} data={readError ? [] : state?.fonts.filter((font) => !font.deleted) ?? []}
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
          disabled={busy || !state?.profile || (!status?.isRunning && (!!readError || !state.credentialAvailable))}
          busy={busy} onPress={() => { void run(status?.isRunning ? cloudSync.cancel : cloudSync.start); }} last />
      </SettingsGroup>
      {status && <SettingsNote theme={theme}>{t('cloud.uploadedCount', { count: status.uploadedFiles })} · {t('cloud.downloadedCount', { count: status.downloadedFiles })}</SettingsNote>}
      {!!status?.errorMessage && <SettingsNote theme={theme}>{status.errorMessage}</SettingsNote>}
      {!!state?.credentialError && <SettingsNote theme={theme}>{t('mobile.sync.credentialsError')}</SettingsNote>}
      {!!state?.profile && !state.credentialAvailable && <SettingsNote theme={theme}>{t('cloud.passwordUnavailable')}</SettingsNote>}
      {!!actionError && <SettingsNote theme={theme}>{t(actionError)}</SettingsNote>}
      {!!readError && <SettingsActionRow title={t('common.retry')} theme={theme} onPress={() => { void controller.refresh().catch(() => undefined); }} last />}
    </View>}
    ListEmptyComponent={!readError && state ? <SettingsNote theme={theme}>{t('cloud.emptyHint')}</SettingsNote> : null}
    renderItem={({ item }) => {
      const progress = status?.isRunning ? status.items.find((entry) => entry.fingerprint === item.fingerprint) : undefined;
      const action = t(progress?.action === 'upload' ? 'cloud.upload' : 'cloud.download');
      return <SettingsGroup theme={theme}>
        <SettingsValueRow title={item.displayName || item.filename} detail={item.filename} theme={theme} value={formatBytes(item.fileSize)} />
        <SettingsValueRow title={t('cloud.syncStatus')} theme={theme} value={progress ? t(progress.status === 'done' ? 'cloud.completed'
          : progress.status === 'running' ? 'cloud.running' : 'cloud.waiting', { action })
          : t(item.localAvailable ? 'cloud.availableLocally' : 'cloud.cloudOnly')} last />
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
