import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { storage } from './native';
import type { StorageUsage } from './storage';
import { SettingsActionRow, SettingsGroup, SettingsNote, SettingsPage, SettingsValueRow, formatBytes, settingsTypography } from './settings-ui';
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
        <Text style={[styles.measuringText, { color: theme.secondary }]}>{t(loading ? 'storage.measuring' : 'mobile.settings.storageError')}</Text>
      </View>
    </SettingsGroup> : <>
      <SettingsGroup theme={theme} footer={t('storage.totalNote')}>
        <View style={styles.overview}>
          <View style={styles.overviewHeader}>
            <Text style={[styles.overviewLabel, { color: theme.label }]}>{t('storage.folioUsage')}</Text>
            <Text style={[styles.overviewValue, { color: theme.label }]}>{formatBytes(total)}</Text>
          </View>
          <View accessible accessibilityRole="image" accessibilityLabel={t('storage.accessibilityUsage', {
            total: formatBytes(total), percent: percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`, other: formatBytes(otherUsed), free: formatBytes(usage.volumeFreeBytes),
          })} style={[styles.bar, { backgroundColor: theme.raised }]}>
            <View style={{ flex: total, backgroundColor: theme.accent }} />
            <View style={{ flex: otherUsed, backgroundColor: theme.secondary }} />
            <View style={{ flex: usage.volumeFreeBytes }} />
          </View>
          <Text style={[styles.overviewDisk, { color: theme.secondary }]}>
            {t('storage.diskOf', { used: formatBytes(total), total: formatBytes(usage.volumeTotalBytes) })}
          </Text>
          {[
            { label: t('storage.folioUsage'), value: formatBytes(total), color: theme.accent },
            { label: t('storage.otherApps'), value: formatBytes(otherUsed), color: theme.secondary },
            { label: t('desktop.availableSpace'), value: formatBytes(usage.volumeFreeBytes), color: theme.raised },
          ].map(({ label, value, color }) => <View key={label} style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: color, borderColor: theme.border }]} />
            <Text style={[styles.legendText, { color: theme.secondary }]}>{label}</Text>
            <Text style={[styles.legendValue, { color: theme.label }]}>{value}</Text>
          </View>)}
        </View>
      </SettingsGroup>

      <SettingsGroup theme={theme} title={t('storage.usageDetails')}>
        <SettingsValueRow theme={theme} title={t('storage.managedFonts')} detail={t('storage.managedFontsDetail')} value={formatBytes(usage.managedFontBytes)} />
        <SettingsValueRow theme={theme} title={t('storage.libraryDatabase')} detail={t('storage.libraryDatabaseDetail')} value={formatBytes(usage.databaseBytes)} last />
      </SettingsGroup>
      <SettingsGroup theme={theme} title={t('storage.clean')} footer={t('storage.cleanHint')}>
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
  overview: { padding: 20, gap: 16 },
  overviewHeader: { gap: 4 },
  overviewLabel: { ...settingsTypography.detail },
  overviewValue: { fontSize: 36, lineHeight: 44, fontWeight: '600', fontVariant: ['tabular-nums'] },
  bar: { height: 16, borderRadius: 8, overflow: 'hidden', flexDirection: 'row' },
  overviewDisk: { ...settingsTypography.detail },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 8, height: 8, borderRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  legendText: { ...settingsTypography.detail, flex: 1 },
  legendValue: { fontSize: 14, lineHeight: 20, fontWeight: '500', fontVariant: ['tabular-nums'] },
});
