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
  if (!report) return null;
  const counts = summarizeImport(report.items);
  const labels = { imported: '已导入', duplicate: '已跳过重复文件', failed: '导入失败' };
  return <Modal visible={visible} presentationStyle="pageSheet" animationType="none" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <View accessibilityViewIsModal style={styles.screen}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>导入结果</Text>
          {usesNativeControls ? <NativeActionButton label="完成" color={theme.accent} onPress={onClose} plain />
            : <Pressable accessibilityRole="button" onPress={onClose} style={styles.action}>
              <Text style={{ color: theme.accent }}>完成</Text>
            </Pressable>}
        </View>
        <FlatList data={report.items} keyExtractor={(_, index) => String(index)}
          contentContainerStyle={styles.content} initialNumToRender={12}
          ListHeaderComponent={<Text style={[styles.summary, { color: theme.secondary }]}>
            {`成功 ${counts.imported} · 重复 ${counts.duplicate} · 失败 ${counts.failed}`}
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
