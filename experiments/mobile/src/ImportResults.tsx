import { useTranslation } from 'react-i18next';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { summarizeImport, type ImportReport } from './library';
import { NativeActionButton, usesNativeControls } from './native-controls';
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
  return <Modal visible={visible} presentationStyle="pageSheet" animationType="none" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <View accessibilityViewIsModal style={styles.screen}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{t('import.importResults')}</Text>
          {usesNativeControls ? <NativeActionButton label={t('common.done')} color={theme.accent} onPress={onClose} plain />
            : <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}>
              <Text style={{ color: theme.accent }}>{t('common.done')}</Text>
            </Pressable>}
        </View>
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
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '600' },
  action: { minHeight: 44, justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingBottom: 16 },
  summary: { fontSize: 14, paddingVertical: 12 },
  item: { paddingVertical: 12, gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, lineHeight: 22 },
  detail: { fontSize: 14, lineHeight: 20 },
});
