import { StyleSheet, Text, View } from 'react-native';
import { GlassSlider } from './GlassSlider';
import { settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

// 标题与数值布局共用，滑块交互由各平台原生控件承载。
export function DetailSlider({ label, value, minimum, maximum, step, formatValue, onChange, theme, accessibilityLabel }: {
  label: string; value: number; minimum: number; maximum: number; step: number;
  formatValue: (value: number) => string; onChange: (value: number) => void; theme: Theme; accessibilityLabel?: string;
}) {
  const display = formatValue(value);
  return <View style={styles.container}>
    <View style={styles.header}>
      <Text style={[styles.label, { color: theme.label }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.secondary }]}>{display}</Text>
    </View>
    <GlassSlider label={accessibilityLabel ?? label} value={value} minimum={minimum} maximum={maximum}
      step={step} valueText={display} onChange={onChange} theme={theme} />
    <View style={styles.footer}>
      <Text style={[styles.bound, { color: theme.secondary }]}>{formatValue(minimum)}</Text>
      <Text style={[styles.bound, { color: theme.secondary }]}>{formatValue(maximum)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { ...settingsLayout.row, gap: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { ...settingsTypography.body, flex: 1 },
  value: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
  footer: { flexDirection: 'row', justifyContent: 'space-between' },
  bound: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
});
