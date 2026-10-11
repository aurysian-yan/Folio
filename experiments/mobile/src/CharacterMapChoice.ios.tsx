import { Host, Image, Label, Menu, Picker } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, disabled, frame, menuIndicator, menuStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import type { CharacterMapChoiceProps } from './CharacterMapChoice';

// iOS 沿用现有选择菜单与系统选中标记。
export function CharacterMapChoice({ label, options, value, onChange, theme }: CharacterMapChoiceProps) {
  return <Host style={{ width: 44, height: 44 }} colorScheme={theme.dark ? 'dark' : 'light'}>
    <Menu label={<Image systemName="chevron.down" size={18} color={theme.secondary} modifiers={[frame({ width: 44, height: 44 })]} />}
      modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), tint(theme.label),
        disabled(options.length < 2), accessibilityLabel(label)]}>
      <Picker label={label} selection={value || 'all'} onSelectionChange={(id) => {
        const option = options.find((item) => (item.value || 'all') === id);
        if (option) onChange(option.value);
      }}>
        {options.map((option) => <Label key={option.value} title={option.label} modifiers={[tag(option.value || 'all')]} />)}
      </Picker>
    </Menu>
  </Host>;
}
