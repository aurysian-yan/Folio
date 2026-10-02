import { CloudIcon, CardsIcon, CaretRightIcon, DatabaseIcon, DownloadSimpleIcon, InfoIcon, PaintBrushIcon } from 'phosphor-react-native';
import { useTranslation } from 'react-i18next';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Theme } from './ui';

export type SettingsPageId = 'sync' | 'storage' | 'cards' | 'appearance' | 'import' | 'about';

// 设置主页：分组入口，点击进入对应二级页。
export function SettingsScreen({ theme, onOpenPage }: { theme: Theme; onOpenPage: (page: SettingsPageId) => void }) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const entries = [
    { id: 'sync', Icon: CloudIcon, title: t('settings.cloud'), description: t('settings.cloudDescription') },
    { id: 'storage', Icon: DatabaseIcon, title: t('settings.storage'), description: t('settings.storageDescription') },
    { id: 'cards', Icon: CardsIcon, title: t('settings.cards'), description: t('settings.cardsDescription') },
    { id: 'appearance', Icon: PaintBrushIcon, title: t('settings.appearance'), description: t('settings.appearanceDescription') },
    { id: 'import', Icon: DownloadSimpleIcon, title: t('settings.importing'), description: t('settings.importDescription') },
    { id: 'about', Icon: InfoIcon, title: t('settings.about'), description: t('mobile.settings.aboutDescription') },
  ] as const;

  return <ScrollView style={[styles.screen, { backgroundColor: theme.background }]}
    contentContainerStyle={[styles.content, {
      paddingTop: Platform.OS === 'android' ? inset.top + 16 : 16,
      paddingBottom: Platform.OS === 'android' ? inset.bottom + 96 : 32,
    }]}>
    <Text accessibilityRole="header" style={[styles.title, { color: theme.label }]}>{t('navigation.settings')}</Text>
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      {entries.map(({ id, Icon, title, description }, index) => (
        <Pressable key={id} accessibilityRole="button" accessibilityLabel={title} onPress={() => onOpenPage(id)}
          style={({ pressed }) => [styles.row, index < entries.length - 1 && {
            borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
          }, pressed && { backgroundColor: theme.raised }]}>
          <Icon size={22} color={theme.accent} />
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
            <Text style={[styles.rowDetail, { color: theme.secondary }]}>{description}</Text>
          </View>
          <CaretRightIcon size={16} color={theme.muted} />
        </Pressable>
      ))}
    </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  title: { fontSize: 32, fontWeight: '700', paddingHorizontal: 4 },
  card: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  rowDetail: { fontSize: 13, lineHeight: 18 },
});
