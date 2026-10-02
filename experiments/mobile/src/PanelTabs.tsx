import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Theme } from './ui';

export interface PanelTabsProps {
  label: string; value: string; options: { value: string; label: string; systemImage: string }[];
  theme: Theme; disabled: boolean; onChange: (value: string) => void;
}

// 安卓分段胶囊提供完整按钮边界和选中反馈。
export function PanelTabs({ label, value, options, theme, disabled, onChange }: PanelTabsProps) {
  return <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.track, { backgroundColor: theme.surface }]}>
    {options.map((option) => <Pressable key={option.value} accessibilityRole="tab" disabled={disabled}
      accessibilityState={{ selected: option.value === value, disabled }} onPress={() => onChange(option.value)}
      style={({ pressed }) => [styles.segment, { backgroundColor: option.value === value ? theme.accent : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Text style={[styles.label, { color: option.value === value ? theme.onAccent : theme.secondary }]}>{option.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', borderRadius: 24, padding: 4 },
  segment: { flex: 1, minHeight: 44, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  label: { fontSize: 16, fontWeight: '600' },
});
