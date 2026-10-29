import type { ReactNode } from 'react';
import { SettingsChoiceRow, SettingsControlFocus } from './settings-ui';
import type { Theme } from './ui';

export interface AppearanceChoiceRowProps {
  kind: 'size' | 'view';
  title: string;
  options: { value: string; label: string; icon?: ReactNode; systemImage?: string }[];
  value: string;
  theme: Theme;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function AppearanceChoiceRow(props: AppearanceChoiceRowProps) {
  return <SettingsControlFocus title={props.title}><SettingsChoiceRow {...props} /></SettingsControlFocus>;
}
