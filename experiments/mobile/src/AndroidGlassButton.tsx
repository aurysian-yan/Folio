import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { Theme } from './ui';

export const usesGlasmioControls = false;
export interface AndroidGlassButtonProps {
  label: string; onPress: () => void; children: ReactNode; theme: Theme;
  disabled?: boolean; busy?: boolean; selected?: boolean; style?: StyleProp<ViewStyle>;
  systemImage?: string; primary?: boolean;
}
export function AndroidGlassButton(_props: AndroidGlassButtonProps) { return null; }
