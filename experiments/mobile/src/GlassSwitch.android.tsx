import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { GlassSwitchProps } from './GlassSwitch';

interface NativeSwitchProps extends ViewProps {
  label: string;
  checked: boolean;
  enabled: boolean;
  dark: boolean;
  accentColor: string;
  trackColor: string;
  thumbColor: string;
  surfaceColor: string;
  onValueChange: (event: NativeSyntheticEvent<{ value: boolean }>) => void;
}

const NativeSwitch = requireNativeView<NativeSwitchProps>('FolioNavigation', 'FolioGlassSwitchView');

// 安卓玻璃开关仅使用应用语义色，不读取系统 Monet 配色。
export function GlassSwitch({ label, value, disabled = false, theme, onChange }: GlassSwitchProps) {
  return <NativeSwitch label={label} checked={value} enabled={!disabled} dark={theme.dark}
    accentColor={theme.accent} trackColor={theme.switchTrack} thumbColor={theme.switchThumb} surfaceColor={theme.surface}
    style={{ width: 72, height: 48, opacity: disabled ? 0.4 : 1 }}
    onValueChange={({ nativeEvent }) => { if (!disabled) onChange(nativeEvent.value); }} />;
}
