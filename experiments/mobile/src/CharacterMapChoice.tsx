import { View } from 'react-native';
import { SettingsChoiceRow } from './settings-ui';
import type { Theme } from './ui';

export interface CharacterMapChoiceProps {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  theme: Theme;
  sourceId: string;
  triggerSize?: { width: number; height: number };
}

// 通用环境沿用设置页选择控件。
export function CharacterMapChoice({ label, options, value, onChange, theme }: CharacterMapChoiceProps) {
  return <View><SettingsChoiceRow title={label} options={options} value={value} onChange={onChange} theme={theme} hideTitle /></View>;
}
