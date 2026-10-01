import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { LibraryPanel } from './LibraryPanel';
import { summarizeImport, type ImportReport } from './library';
import type { Theme } from './ui';

// 批量导入汇总与文件明细。
export function ImportResults({ report, visible, theme, onClose }: {
  report: ImportReport | null;
  visible: boolean;
  theme: Theme;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!report) return null;
  const counts = summarizeImport(report.items);
  const labels = { imported: t('mobile.imported'), duplicate: t('mobile.skippedDuplicates'), failed: t('mobile.importFailed') };
  return <LibraryPanel visible={visible} title={t('import.importResults')} theme={theme} onClose={onClose}>
        <FlatList data={report.items} keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.content} initialNumToRender={12}
          ListHeaderComponent={<Text style={[styles.summary, { color: theme.secondary }]}>
            {t('mobile.importSummary', { imported: counts.imported, duplicate: counts.duplicate, failed: counts.failed })}
          </Text>}
          renderItem={({ item }) => <View style={[styles.item, { borderColor: theme.border }]}>
            <Text selectable style={[styles.name, { color: theme.label }]}>
              {item.archiveName ? `${item.archiveName}／${item.name}` : item.name}
            </Text>
            <Text style={[styles.detail, { color: item.status === 'failed' ? theme.danger : theme.secondary }]}>
              {item.message ?? labels[item.status]}
            </Text>
          </View>} />
  </LibraryPanel>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  summary: { fontSize: 14, paddingVertical: 12 },
  item: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, lineHeight: 22 },
  detail: { fontSize: 14, lineHeight: 20 },
});
