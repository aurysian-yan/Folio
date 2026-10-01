import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { storage } from './native';
import type { StorageUsage } from './storage';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsPage, SettingsValueRow, formatBytes } from './settings-ui';
import type { Theme } from './ui';

// 存储管理：真实用量统计与可重建缓存清理。
export function SettingsStoragePage({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [previewBytes, setPreviewBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await storage.usage();
    const preview = await storage.previewBytes();
    setUsage(next);
    setPreviewBytes(preview);
  }, []);

  useEffect(() => {
    let mounted = true;
    storage.usage()
      .then((next) => storage.previewBytes().then((preview) => {
        if (!mounted) return;
        setUsage(next);
        setPreviewBytes(preview);
      }))
      .catch(() => { if (mounted) setMessage(t('mobile.settings.storageError')); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [t]);

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setMessage(null);
    try { const result = await action(); await refresh(); setMessage(result); }
    catch { setMessage(t('mobile.settings.storageError')); }
    finally { setBusy(null); }
  }

  const total = usage ? usage.databaseBytes + usage.managedFontBytes + previewBytes : 0;
  const used = usage ? Math.max(0, usage.volumeTotalBytes - usage.volumeFreeBytes) : 0;
  const otherUsed = Math.max(0, used - total);
  const percent = usage && usage.volumeTotalBytes > 0 ? (total / usage.volumeTotalBytes) * 100 : 0;

  return <SettingsPage title={t('settings.storage')} theme={theme} onClose={onClose}>
    {!usage ? <SettingsGroup theme={theme}>
      <View style={styles.measuring}>
        {loading && <ActivityIndicator color={theme.accent} />}
        <Text style={[styles.measuringText, { color: theme.secondary }]}>{t('storage.measuring')}</Text>
      </View>
    </SettingsGroup> : <>
      <SettingsGroup theme={theme} title={t('storage.space')} footer={t('storage.totalNote')}>
        <View style={styles.overview}>
          <View style={styles.overviewHeader}>
            <Text style={[styles.overviewLabel, { color: theme.label }]}>{t('storage.folioUsage')}</Text>
            <Text style={[styles.overviewValue, { color: theme.label }]}>{formatBytes(total)}</Text>
          </View>
          <View style={[styles.bar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            {total > 0 && <View style={{ flex: otherUsed, backgroundColor: theme.secondary }} />}
            <View style={{ flex: usage.managedFontBytes, backgroundColor: theme.accent }} />
            <View style={{ flex: usage.databaseBytes, backgroundColor: theme.label }} />
            <View style={{ flex: previewBytes, backgroundColor: theme.muted }} />
            <View style={{ flex: usage.volumeFreeBytes, backgroundColor: 'transparent' }} />
          </View>
          <Text style={[styles.overviewDisk, { color: theme.secondary }]}>
            {t('storage.diskOf', { used: formatBytes(total), total: formatBytes(usage.volumeTotalBytes) })}
          </Text>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: theme.accent }]} />
            <Text style={[styles.legendText, { color: theme.secondary }]}>{t('storage.folioUsage')} {percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`}</Text>
            <View style={[styles.legendDot, { backgroundColor: theme.secondary }]} />
            <Text style={[styles.legendText, { color: theme.secondary }]}>{t('storage.otherApps')} {formatBytes(otherUsed)}</Text>
            <View style={[styles.legendDot, { backgroundColor: theme.surface, borderColor: theme.border }]} />
            <Text style={[styles.legendText, { color: theme.secondary }]}>{t('storage.freeSpace', { size: formatBytes(usage.volumeFreeBytes) })}</Text>
          </View>
        </View>
      </SettingsGroup>

      <SettingsGroup theme={theme} title={t('storage.usageDetails')} footer={t('storage.cleanHint')}>
        <SettingsValueRow theme={theme} title={t('storage.managedFonts')} detail={t('storage.managedFontsDetail')} value={formatBytes(usage.managedFontBytes)} />
        <SettingsValueRow theme={theme} title={t('storage.libraryDatabase')} detail={t('storage.libraryDatabaseDetail')} value={formatBytes(usage.databaseBytes)} />
        <SettingsValueRow theme={theme} title={t('storage.catalogCache')}
          detail={t('storage.catalogCacheDetail', { count: usage.catalogCacheEntries })}
          value={formatBytes(usage.catalogCacheEstimatedBytes)} />
        <SettingsActionRow theme={theme} title={t('storage.cleanCatalogCache')} busy={busy === 'catalog'} disabled={busy !== null}
          onPress={() => run('catalog', async () => t('storage.catalogCleaned', { count: await storage.clearCatalogCache() }))} />
        <SettingsValueRow theme={theme} title={t('storage.onlinePreviewCache')} detail={t('storage.onlinePreviewCacheDetail')} value={formatBytes(previewBytes)} />
        <SettingsActionRow theme={theme} title={t('storage.cleanPreviewCache')} busy={busy === 'preview'} disabled={busy !== null}
          onPress={() => run('preview', async () => t('storage.previewCleaned', { size: formatBytes(await storage.clearPreviewCache()) }))} last />
      </SettingsGroup>

      <SettingsGroup theme={theme} title={t('cloud.syncIndex')} footer={t('storage.syncIndexDetail')}>
        <SettingsActionRow theme={theme} title={t('storage.rebuildIndex')} busy={busy === 'index'} disabled={busy !== null}
          onPress={() => run('index', async () => { await storage.rebuildSyncIndexes(); return t('cloud.rebuildDone'); })} last />
      </SettingsGroup>
    </>}
    {!!message && <SettingsNote theme={theme}>
      <Text accessibilityRole="alert" style={{ color: theme.secondary }}>{message}</Text>
    </SettingsNote>}
  </SettingsPage>;
}

const styles = StyleSheet.create({
  measuring: { minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 8 },
  measuringText: { fontSize: 14 },
  overview: { padding: 14, gap: 10 },
  overviewHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  overviewLabel: { fontSize: 15 },
  overviewValue: { fontSize: 22, fontWeight: '600' },
  bar: { height: 18, borderRadius: 9, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', flexDirection: 'row' },
  overviewDisk: { fontSize: 13 },
  legend: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent' },
  legendText: { fontSize: 12, marginRight: 8 },
});
