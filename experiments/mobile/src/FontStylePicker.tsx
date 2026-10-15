import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { CharacterMapChoice, type CharacterMapChoiceProps } from './CharacterMapChoice';
import type { FontFace } from './library';
import { settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

// 选择行由整行原生菜单接管触摸，文字不重复参与无障碍导航。
export function FontChoiceRow(props: CharacterMapChoiceProps) {
  const { label, options, value, theme } = props;
  const [size, setSize] = useState({ width: 0, height: 64 });
  const selected = options.find((item) => item.value === value)?.label ?? '';
  return <View onLayout={({ nativeEvent: { layout } }) => setSize({ width: layout.width, height: layout.height })} style={styles.row}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.labels}>
      <Text style={[settingsTypography.body, styles.label, { color: theme.label }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.value, settingsTypography.detail, { color: theme.secondary }]}>{selected}</Text>
    </View>
    {size.width > 0 && <View style={StyleSheet.absoluteFill}>
      <CharacterMapChoice {...props} triggerSize={size} />
    </View>}
  </View>;
}

// 详情与字符表共用受控字款选择。
export function FontStylePicker({ faces, selectedFaceId, onChange, theme, sourceId }: {
  faces: FontFace[]; selectedFaceId: string; onChange: (id: string) => void; theme: Theme; sourceId: string;
}) {
  const { t } = useTranslation();
  return <FontChoiceRow label={t('font.styles')} options={faces.map((face) => ({ value: face.id, label: face.styleName }))}
    value={selectedFaceId} onChange={onChange} theme={theme} sourceId={sourceId} />;
}

const styles = StyleSheet.create({
  row: { minHeight: 64, justifyContent: 'center' },
  labels: { ...settingsLayout.row, paddingRight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 },
  value: { flex: 1, minWidth: 0, textAlign: 'right' },
  label: { flexShrink: 1, maxWidth: '45%' },
});
