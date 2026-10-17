import { requireNativeView } from 'expo';
import { useState } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { GlassSliderProps } from './GlassSlider';
import { clampAxisValue, snapAxisValue } from './font-details';

interface NativeSliderProps extends ViewProps {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  step: number;
  valueText: string;
  enabled: boolean;
  dark: boolean;
  accentColor: string;
  trackColor: string;
  thumbColor: string;
  surfaceColor: string;
  mostRecentEventCount: number;
  onEditingChanged?: (event: NativeSyntheticEvent<{ isEditing: boolean }>) => void;
  onValueChange: (event: NativeSyntheticEvent<{ value: number; eventCount: number }>) => void;
}

const NativeSlider = requireNativeView<NativeSliderProps>('FolioNavigation', 'FolioGlassSliderView');

// 事件计数阻止迟到的受控值覆盖当前拖动位置。
export function GlassSlider({ label, value, minimum, maximum, step, valueText, theme, onChange, onEditingChanged }: GlassSliderProps) {
  const [eventCount, setEventCount] = useState(0);
  const enabled = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum;
  return <NativeSlider label={label} value={enabled ? clampAxisValue(value, minimum, maximum) : 0}
    minimum={enabled ? minimum : 0} maximum={enabled ? maximum : 1}
    step={Number.isFinite(step) && step > 0 ? step : 0} valueText={valueText} enabled={enabled} dark={theme.dark}
    accentColor={theme.accent} trackColor={theme.border} thumbColor={theme.switchThumb} surfaceColor={theme.surface}
    mostRecentEventCount={eventCount} style={{ width: '100%', height: 44, opacity: enabled ? 1 : 0.4 }}
    onEditingChanged={({ nativeEvent }) => onEditingChanged?.(nativeEvent.isEditing)}
    onValueChange={({ nativeEvent }) => {
      setEventCount(nativeEvent.eventCount);
      if (enabled) onChange(snapAxisValue(nativeEvent.value, minimum, maximum, step));
    }} />;
}
