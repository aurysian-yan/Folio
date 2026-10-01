import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native';
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

// 二级设置页统一使用返回头部与可滚动分组内容。
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
          <Text accessibilityRole="header" numberOfLines={1} style={[styles.headerTitle, { color: theme.label }]}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </SafeAreaView>
  </SafeAreaProvider>;
}

export function SettingsGroup({ theme, title, footer, children }: {
  theme: Theme; title?: string; footer?: string; children: ReactNode;
}) {
  return <View style={styles.group}>
    {!!title && <Text style={[styles.groupTitle, { color: theme.secondary }]}>{title}</Text>}
    <View style={[styles.groupCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>{children}</View>
    {!!footer && <Text style={[styles.groupFooter, { color: theme.secondary }]}>{footer}</Text>}
  </View>;
}

function RowShell({ theme, children, onPress, last, accessibilityLabel, accessibilityState }: {
  theme: Theme; children: ReactNode; onPress?: () => void; last?: boolean;
  accessibilityLabel?: string; accessibilityState?: { disabled?: boolean; selected?: boolean };
}) {
  const body = <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border }]}>{children}</View>;
  if (!onPress) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={accessibilityState}
    onPress={onPress} style={({ pressed }) => [pressed && { backgroundColor: theme.raised }]}>{body}</Pressable>;
}

export function SettingsNavRow({ icon, title, detail, value, theme, onPress, last }: {
  icon?: ReactNode; title: string; detail?: string; value?: string;
  theme: Theme; onPress: () => void; last?: boolean;
}) {
  return <RowShell theme={theme} onPress={onPress} last={last} accessibilityLabel={title}>
    {icon}
    <View style={styles.rowBody}>
      <Text numberOfLines={1} style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
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
      <Text numberOfLines={2} style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
      {!!detail && <Text numberOfLines={2} style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text>}
    </View>
    <Switch accessibilityLabel={title} value={value} disabled={disabled} onValueChange={onChange}
      trackColor={{ false: theme.border, true: theme.accent }} thumbColor={theme.raised} />
  </RowShell>;
}

export function SettingsChoiceRow<T extends string>({ title, detail, options, value, theme, onChange, last }: {
  title: string; detail?: string; options: { value: T; label: string }[];
  value: T; theme: Theme; onChange: (value: T) => void; last?: boolean;
}) {
  return <RowShell theme={theme} last={last}>
    <View style={styles.rowBody}>
      <Text style={[styles.rowTitle, { color: theme.label }]}>{title}</Text>
      {!!detail && <Text style={[styles.rowDetail, { color: theme.secondary }]}>{detail}</Text>}
      <View style={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return <Pressable key={option.value} accessibilityRole="radio" accessibilityLabel={option.label}
            accessibilityState={{ selected }} onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.choice, { backgroundColor: selected ? theme.accent : theme.raised,
              borderColor: selected ? theme.accent : theme.border, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.choiceLabel, { color: selected ? theme.onAccent : theme.label }]}>{option.label}</Text>
          </Pressable>;
        })}
      </View>
    </View>
  </RowShell>;
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
  return <RowShell theme={theme} onPress={disabled ? undefined : onPress} last={last}
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

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '600' },
  headerSpacer: { width: 44 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 24 },
  group: { gap: 8 },
  groupTitle: { fontSize: 13, fontWeight: '600', paddingHorizontal: 12 },
  groupCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  groupFooter: { fontSize: 13, lineHeight: 18, paddingHorizontal: 12 },
  row: { minHeight: 52, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  rowDetail: { fontSize: 13, lineHeight: 18 },
  rowValue: { fontSize: 15, maxWidth: 160, textAlign: 'right' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 },
  choice: { minHeight: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
  choiceLabel: { fontSize: 14, fontWeight: '500' },
  note: { fontSize: 13, lineHeight: 19 },
});
