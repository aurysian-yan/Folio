import { Host, Label, Picker, type LabelProps } from '@expo/ui/swift-ui';
import { accessibilityLabel, controlSize, disabled, frame, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import type { PanelTabsProps } from './PanelTabs';

// iOS 页签使用原生分段选择器，外观随系统更新。
export function PanelTabs({ label, value, options, theme, disabled: unavailable, onChange }: PanelTabsProps) {
  return <Host style={{ height: 52 }}>
    <Picker label={label} selection={value} onSelectionChange={onChange} modifiers={[
      pickerStyle('segmented'), controlSize('large'), frame({ minHeight: 44 }), tint(theme.accent),
      disabled(unavailable), accessibilityLabel(label),
    ]}>
      {options.map((option) => <Label key={option.value} title={option.label} systemImage={option.systemImage as LabelProps['systemImage']}
        modifiers={[tag(option.value)]} />)}
    </Picker>
  </Host>;
}
