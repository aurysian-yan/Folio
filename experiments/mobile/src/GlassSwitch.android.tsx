import { requireNativeView } from 'expo';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { GlassSwitchProps } from './GlassSwitch';
import { useGlassControl } from './GlassControlScope';

interface NativeSwitchProps extends ViewProps {
  sourceId: string;
  controlId: string;
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

// 安卓玻璃开关复用应用语义色和页面背景源。
export function GlassSwitch({ label, value, disabled = false, theme, onChange, sourceId }: GlassSwitchProps) {
  const control = useGlassControl(sourceId);
  const enabled = !disabled && control.active;
  return <NativeSwitch sourceId={control.sourceId} controlId={control.controlId} label={label} checked={value} enabled={enabled} dark={theme.dark}
    accentColor={theme.accent} trackColor={theme.switchTrack} thumbColor={theme.switchThumb} surfaceColor={theme.surface}
    style={{ width: 72, height: 48, opacity: disabled ? 0.4 : 1 }}
    onValueChange={({ nativeEvent }) => { if (enabled) onChange(nativeEvent.value); }} />;
}
