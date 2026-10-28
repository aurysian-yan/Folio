import { androidPageBackdropProps } from './android-glass';
import { requireNativeView } from 'expo';
import { useRef, useState } from 'react';
import type { NativeSyntheticEvent, ViewProps } from 'react-native';
import type { GlassSliderProps } from './GlassSlider';
import { clampAxisValue, snapAxisValue } from './font-details';
import { useGlassControl } from './GlassControlScope';

interface NativeSliderProps extends ViewProps {
  sourceId: string;
  controlId: string;
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
export function GlassSlider({ label, value, minimum, maximum, step, valueText, theme, onChange, onEditingChanged, sourceId }: GlassSliderProps) {
  const control = useGlassControl(sourceId);
  const [eventCount, setEventCount] = useState(0);
  const lastEventCount = useRef(0);
  const validRange = Number.isFinite(value) && Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum;
  const enabled = validRange && control.active;
  return <NativeSlider {...androidPageBackdropProps(theme)} sourceId={control.sourceId} controlId={control.controlId} label={label} value={validRange ? clampAxisValue(value, minimum, maximum) : 0}
    minimum={validRange ? minimum : 0} maximum={validRange ? maximum : 1}
    step={Number.isFinite(step) && step > 0 ? step : 0} valueText={valueText} enabled={enabled} dark={theme.dark}
    accentColor={theme.accent} trackColor={theme.border} thumbColor={theme.switchThumb} surfaceColor={theme.surface}
    mostRecentEventCount={eventCount} style={{ width: '100%', height: 44, opacity: enabled ? 1 : 0.4 }}
    onEditingChanged={({ nativeEvent }) => onEditingChanged?.(nativeEvent.isEditing)}
    onValueChange={({ nativeEvent }) => {
      if (!Number.isFinite(nativeEvent.value) || !Number.isSafeInteger(nativeEvent.eventCount) || nativeEvent.eventCount <= lastEventCount.current) return;
      lastEventCount.current = nativeEvent.eventCount;
      setEventCount(nativeEvent.eventCount);
      if (enabled) onChange(snapAxisValue(nativeEvent.value, minimum, maximum, step));
    }} />;
}
