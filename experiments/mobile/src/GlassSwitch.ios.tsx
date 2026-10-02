import { Host, Toggle } from '@expo/ui/swift-ui';
import { accessibilityLabel, disabled, labelsHidden, tint, toggleStyle } from '@expo/ui/swift-ui/modifiers';
import type { GlassSwitchProps } from './GlassSwitch';

// iOS 使用系统开关，iOS 26 的玻璃拨片与交互由 SwiftUI 提供。
export function GlassSwitch({ label, value, disabled: unavailable = false, theme, onChange }: GlassSwitchProps) {
  return <Host style={{ width: 64, height: 48 }} colorScheme={theme.dark ? 'dark' : 'light'}>
    <Toggle label={label} isOn={value} onIsOnChange={onChange}
      modifiers={[toggleStyle('switch'), labelsHidden(), tint(theme.accent), disabled(unavailable), accessibilityLabel(label)]} />
  </Host>;
}
