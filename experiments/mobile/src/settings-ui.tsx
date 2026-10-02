import { CaretLeftIcon, CaretRightIcon } from './icons';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { IconButton, type Theme } from './ui';

// 字节数按存储页的量级展示，保留一位小数。
export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

// 二级设置页统一使用返回工具栏、大标题与分组卡片。
export function SettingsPage({ title, theme, onClose, children }: {
  title: string; theme: Theme; onClose: () => void; children: ReactNode;
}) {
  const { t } = useTranslation();
  return <SafeAreaProvider>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.screen, { backgroundColor: theme.background }]}>
      <View accessibilityViewIsModal style={styles.screen}>
        <View style={styles.header}>
          <IconButton theme={theme} label={t('mobile.backToSettings')} systemImage="chevron.left" onPress={onClose}>
            <CaretLeftIcon size={20} color={theme.label} />
          </IconButton>
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text accessibilityRole="header" style={[settingsLayout.title, { color: theme.label }]}>{title}</Text>
          {children}
        </ScrollView>
      </View>
    </SafeAreaView>
  </SafeAreaProvider>;
}

export function SettingsGroup({ theme, title, footer, children }: {
  theme: Theme; title?: string; footer?: string; children: ReactNode;
}) {
  return <View style={styles.group}>
    {!!title && <Text style={[styles.groupTitle, { color: theme.secondary }]}>{title}</Text>}
    <View style={[styles.groupCard, { backgroundColor: theme.surface }]}>{children}</View>
    {!!footer && <Text style={[styles.groupFooter, { color: theme.secondary }]}>{footer}</Text>}
  </View>;
}

function RowShell({ theme, children, onPress, accessibilityLabel, accessibilityState }: {
  theme: Theme; children: ReactNode; onPress?: () => void; last?: boolean;
  accessibilityLabel?: string; accessibilityState?: { disabled?: boolean; selected?: boolean };
}) {
  const body = <View style={styles.row}>{children}</View>;
  if (!onPress) return <View accessibilityState={accessibilityState}>{body}</View>;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}
    disabled={accessibilityState?.disabled} onPress={onPress}
    style={({ pressed }) => [pressed && { backgroundColor: theme.raised }]}>{body}</Pressable>;
}

export function SettingsNavRow({ icon, title, detail, value, theme, onPress, last }: {
  icon?: ReactNode; title: string; detail?: string; value?: string;
  theme: Theme; onPress: () => void; last?: boolean;
}) {
  return <RowShell theme={theme} onPress={onPress} last={last} accessibilityLabel={title}>
    {icon}
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
      {!!detail && <Text numberOfLines={2} style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text>}
    </View>
    {value !== undefined && <Text numberOfLines={1} style={[styles.rowValue, { color: theme.secondary }]}>{value}</Text>}
    <CaretRightIcon size={16} color={theme.muted} />
  </RowShell>;
}

export function SettingsSwitchRow({ icon, title, detail, value, theme, onChange, disabled, last }: {
  icon?: ReactNode; title: string; detail?: string; value: boolean;
  theme: Theme; onChange: (value: boolean) => void; disabled?: boolean; last?: boolean;
}) {
  return <RowShell theme={theme} last={last}>
    {icon}
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
      {!!detail && <Text numberOfLines={2} style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text>}
    </View>
    <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange}
      trackColor={{ false: theme.border, true: theme.accent }} ios_backgroundColor={theme.border} />
  </RowShell>;
}

export function SettingsChoiceRow<T extends string>({ title, detail, options, value, theme, onChange, hideTitle = false }: {
  title: string; detail?: string; options: { value: T; label: string; icon?: ReactNode }[];
  value: T; theme: Theme; onChange: (value: T) => void; last?: boolean; hideTitle?: boolean;
}) {
  return <View style={styles.choiceRow}>
    <View style={styles.rowBody}>
      {!hideTitle && <Text style={[styles.rowTitle, styles.choiceHeading, { color: theme.label }]}>{title}</Text>}
      {!!detail && <Text style={[styles.rowDetail, styles.choiceHeading, { color: theme.secondary }]}>{detail}</Text>}
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={[styles.choices, !hideTitle && styles.choicesWithTitle]}>
        {options.map((option) => {
          const selected = option.value === value;
          return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{ selected }} onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.choice, { backgroundColor: selected ? theme.accent : theme.raised,
              opacity: pressed ? 0.7 : 1 }]}>
            {option.icon}
            <Text style={[styles.choiceLabel, { color: selected ? theme.onAccent : theme.label }]}>{option.label}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </View>;
}

export function SettingsValueRow({ title, detail, value, theme, last }: {
  title: string; detail?: string; value: string; theme: Theme; last?: boolean;
}) {
  return <RowShell theme={theme} last={last}>
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
      {!!detail && <Text style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text>}
    </View>
    <Text numberOfLines={1} style={[styles.rowValue, { color: theme.secondary }]}>{value}</Text>
  </RowShell>;
}

export function SettingsActionRow({ icon, title, theme, onPress, destructive = false, disabled, busy, last }: {
  icon?: ReactNode; title: string; theme: Theme; onPress: () => void;
  destructive?: boolean; disabled?: boolean; busy?: boolean; last?: boolean;
}) {
  const color = destructive ? theme.danger : theme.accent;
  return <RowShell theme={theme} onPress={onPress} last={last}
    accessibilityLabel={title} accessibilityState={{ disabled: !!disabled }}>
    {icon}
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, { color, opacity: disabled ? 0.4 : 1 }]}>{title}</Text>
    </View>
    {busy && <ActivityIndicator size="small" color={color} />}
  </RowShell>;
}

export function SettingsNote({ theme, children }: { theme: Theme; children: ReactNode }) {
  return <Text style={[styles.note, { color: theme.secondary }]}>{children}</Text>;
}

export function SettingsIcon({ children }: { children: ReactNode }) {
  return <View style={styles.icon}>{children}</View>;
}

// 设置与云端共用五级文字尺度，文字块间距统一使用八点节奏。
export const settingsTypography = StyleSheet.create({
  title: { fontSize: 32, lineHeight: 40, fontWeight: '500' },
  section: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  detail: { fontSize: 13, lineHeight: 18 },
  metric: { fontSize: 28, lineHeight: 34, fontWeight: '600', fontVariant: ['tabular-nums'] },
});

// 内嵌控件缩进八点，内圆角与外圆角保持相同圆心。
const cardRadius = 24;
const controlInset = 8;
export const settingsLayout = StyleSheet.create({
  title: { ...settingsTypography.title, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  content: { paddingHorizontal: 12, gap: 24 },
  card: { borderRadius: cardRadius, overflow: 'hidden' },
  controls: { padding: controlInset },
  control: { borderRadius: cardRadius - controlInset },
  insetControl: { marginHorizontal: controlInset, marginBottom: controlInset, borderRadius: cardRadius - controlInset },
});

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  content: { ...settingsLayout.content, paddingBottom: 32 },
  group: { gap: 8 },
  groupTitle: { ...settingsTypography.section, paddingHorizontal: 20 },
  groupCard: { ...settingsLayout.card },
  groupFooter: { ...settingsTypography.detail, paddingHorizontal: 20 },
  row: { minHeight: 64, paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBody: { flex: 1, minWidth: 0, gap: 4 },
  rowTitle: { ...settingsTypography.body },
  rowDetail: { ...settingsTypography.detail },
  rowValue: { fontSize: 14, lineHeight: 20, maxWidth: '45%', textAlign: 'right', fontVariant: ['tabular-nums'] },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choiceRow: { ...settingsLayout.controls },
  choiceHeading: { marginHorizontal: 12 },
  choicesWithTitle: { paddingTop: 8 },
  choice: { ...settingsLayout.control, flex: 1, minWidth: 64, minHeight: 44, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  choiceLabel: { fontSize: 14, lineHeight: 20, fontWeight: '500', textAlign: 'center' },
  icon: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  note: { ...settingsTypography.detail, paddingHorizontal: 20 },
});
