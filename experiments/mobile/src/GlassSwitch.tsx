import { Switch } from 'react-native';
import type { Theme } from './ui';

export interface GlassSwitchProps {
  label: string;
  value: boolean;
  disabled?: boolean;
  theme: Theme;
  onChange: (value: boolean) => void;
}

export function GlassSwitch({ label, value, disabled, theme, onChange }: GlassSwitchProps) {
  return <Switch accessibilityLabel={label} value={value} disabled={disabled} onValueChange={onChange}
    trackColor={{ false: theme.activeTab, true: theme.accent }} ios_backgroundColor={theme.activeTab} />;
}
