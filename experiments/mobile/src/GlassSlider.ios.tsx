import { Host, Slider } from '@expo/ui/swift-ui';
import { accessibilityLabel, accessibilityValue, disabled, tint } from '@expo/ui/swift-ui/modifiers';
import { clampAxisValue, snapAxisValue } from './font-details';
import type { GlassSliderProps } from './GlassSlider';

// 系统负责 iOS 滑块的材质、按压、拖动与辅助功能行为。
export function GlassSlider({ label, value, minimum, maximum, step, valueText, theme, onChange }: GlassSliderProps) {
  const enabled = Number.isFinite(minimum) && Number.isFinite(maximum) && maximum > minimum;
  const lower = enabled ? minimum : 0;
  const upper = enabled ? maximum : 1;
  return <Host style={{ height: 44, width: '100%' }} colorScheme={theme.dark ? 'dark' : 'light'}>
    <Slider value={clampAxisValue(value, lower, upper)} min={lower} max={upper}
      step={Number.isFinite(step) && step > 0 ? step : undefined}
      modifiers={[tint(theme.accent), disabled(!enabled), accessibilityLabel(label), accessibilityValue(valueText)]}
      onValueChange={(next) => { if (enabled) onChange(snapAxisValue(next, minimum, maximum, step)); }} />
  </Host>;
}
