import { Host, HStack, Image, Label, Menu, Picker, Spacer } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, contentShape, disabled, frame, menuIndicator, menuStyle, padding, shapes, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { Keyboard } from 'react-native';
import type { CharacterMapChoiceProps } from './CharacterMapChoice';

// iOS 沿用现有选择菜单与系统选中标记。
export function CharacterMapChoice({ label, options, value, onChange, theme, triggerSize }: CharacterMapChoiceProps) {
  const size = triggerSize ?? { width: 44, height: 44 };
  return <Host style={size} colorScheme={theme.dark ? 'dark' : 'light'}>
    <Menu label={<HStack modifiers={[padding({ trailing: triggerSize ? 16 : 0 }), frame(size), contentShape(shapes.rectangle())]}>
      {triggerSize && <Spacer />}
      <Image systemName="chevron.down" size={18} color={theme.secondary} />
    </HStack>}
      modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), tint(theme.label),
        disabled(options.length < 2), accessibilityLabel(`${label} · ${options.find((option) => option.value === value)?.label ?? ''}`)]}>
      <Picker label={label} selection={value || 'all'} onSelectionChange={(id) => {
        Keyboard.dismiss();
        const option = options.find((item) => (item.value || 'all') === id);
        if (option) onChange(option.value);
      }}>
        {options.map((option) => <Label key={option.value} title={option.label} modifiers={[tag(option.value || 'all')]} />)}
      </Picker>
    </Menu>
  </Host>;
}
