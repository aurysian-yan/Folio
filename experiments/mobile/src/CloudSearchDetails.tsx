import { FilterScrollView } from './FilterDrawer';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Text } from 'react-native';
import { LibraryPanel } from './LibraryPanel';
import { PanelAction } from './panel-content';
import { cloudSync, library } from './native';
import type { FontFamily } from './library';
import type { CloudFont } from './sync';
import type { CloudSyncController } from './useCloudSync';
import { formatBytes } from './settings-ui';
import type { Theme } from './ui';

// 云端文件没有本地预览时先显示信息，下载必须由用户明确触发。
export function CloudSearchDetails({ font, theme, controller, libraryVersion, onClose, onOpen, onConfigure }: {
  font: CloudFont | null; theme: Theme; controller: CloudSyncController; libraryVersion: number;
  onClose: () => void; onOpen: (family: FontFamily) => void; onConfigure: () => void;
}) {
  const { t } = useTranslation();
  const [families, setFamilies] = useState<FontFamily[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const fingerprint = font?.fingerprint;
  const current = controller.state?.fonts.find((item) => item.fingerprint === fingerprint) ?? font;
  useEffect(() => {
    if (!fingerprint) return;
    const abort = new AbortController();
    // 文件或本地版本变化时清除上一轮结果，避免打开其他文件的详情。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setError(false); setFamilies([]);
    void (async () => {
      const found: FontFamily[] = [];
      for (let offset = 0; ; offset += 100) {
        const page = await library.query({ scope: 'all', text: '', fileFingerprint: fingerprint, offset, limit: 100 }, abort.signal);
        found.push(...page.families);
        if (!page.families.length || found.length >= page.totalMatches) break;
      }
      if (!abort.signal.aborted) setFamilies(found);
    })().catch(() => { if (!abort.signal.aborted) setError(true); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [fingerprint, libraryVersion, retry, current?.localAvailable]);
  return <LibraryPanel visible={!!font} title={t('globalSearch.cloudFile')} theme={theme} onClose={onClose}>
    <FilterScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      {current && <><Text style={{ color: theme.label }}>{current.displayName || current.filename}</Text><Text style={{ color: theme.secondary }}>{current.filename} · {formatBytes(current.fileSize)}</Text>
        <Text style={{ color: theme.secondary }}>{t(current.localAvailable ? 'globalSearch.downloaded' : 'fontLocation.cloudOnly')}</Text>
        {loading && <ActivityIndicator color={theme.accent} />}
        {(error || controller.actionError) && <Text accessibilityRole="alert" style={{ color: theme.danger }}>{t('common.operationFailed')}</Text>}
        {error && <PanelAction theme={theme} label={t('common.retry')} onPress={() => setRetry((value) => value + 1)} />}
        {families.map((family) => <PanelAction key={family.id} theme={theme} label={family.displayName} onPress={() => { onClose(); onOpen(family); }} />)}
        {!current.localAvailable && (controller.state?.profile && controller.state.credentialAvailable
          ? <PanelAction theme={theme} label={t('cloud.downloadAgain')} disabled={controller.busy || controller.blocked || !!controller.state?.status.isRunning} onPress={() => {
            void controller.run(async () => { await cloudSync.fontAction(current.fingerprint, 'download'); controller.requestSync(); await controller.refresh(); });
          }} /> : <PanelAction theme={theme} label={t('common.openSettings')} onPress={() => { onClose(); onConfigure(); }} />)}
        {controller.state?.status.isRunning && <Text accessibilityLiveRegion="polite" style={{ color: theme.secondary }}>{t('cloud.syncingPercent', { percent: controller.state.status.percent })}</Text>}
      </>}
    </FilterScrollView>
  </LibraryPanel>;
}
