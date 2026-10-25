import { Host, Image, Label, Picker, type LabelProps, type ImageProps } from '@expo/ui/swift-ui';
import { accessibilityLabel, controlSize, disabled, environment, font, frame, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import type { PanelTabsProps } from './PanelTabs';

// iOS 页签使用原生分段选择器，外观随系统更新。
export function PanelTabs({ label, value, options, theme, disabled: unavailable, onChange, iconOnly = false }: PanelTabsProps) {
  return <Host colorScheme={theme.dark ? 'dark' : 'light'} style={{ width: iconOnly ? options.length * 44 + 8 : undefined, height: iconOnly ? 68 : 52 }}>
    <Picker label={label} selection={value} onSelectionChange={onChange} modifiers={[
      pickerStyle('segmented'), controlSize('large'), frame({ minHeight: 44, ...(iconOnly ? { height: 44 } : {}) }), tint(theme.accent),
      disabled(unavailable), accessibilityLabel(label),
    ]}>
      {options.map((option) => iconOnly ? <Image key={option.value} systemName={option.systemImage as ImageProps['systemName']}
        modifiers={[tag(option.value), font({ size: 20 }), accessibilityLabel(option.label), environment('locale', 'en')]} /> : <Label key={option.value} title={option.label} systemImage={option.systemImage as LabelProps['systemImage']}
        modifiers={[tag(option.value)]} />)}
    </Picker>
  </Host>;
}
