import { Host, Image, Label, Menu, Picker } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, disabled, frame, menuIndicator, menuStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';
import { matchingWebdavPreset, webdavPresets } from './sync';
import type { WebDAVPresetMenuProps } from './WebDAVPresetMenu';

// iOS 使用系统菜单，直接填入与桌面一致的地址预设。
export function WebDAVPresetMenu({ theme, serverUrl, disabled: isDisabled, onChange }: WebDAVPresetMenuProps) {
  const { t } = useTranslation();
  const selected = matchingWebdavPreset(serverUrl);
  return <Host style={{ width: 44, height: 44 }}>
    <Menu label={<Image systemName="chevron.down" size={20} color={theme.secondary} modifiers={[frame({ width: 44, height: 44 })]} />}
      modifiers={[menuStyle('button'), buttonStyle('plain'), menuIndicator('hidden'), tint(theme.label),
      disabled(isDisabled), accessibilityLabel(t('cloud.provider'))]}>
      <Picker label={t('cloud.provider')} selection={selected} onSelectionChange={(id) => onChange(webdavPresets.find((preset) => preset.id === id)!.url)}>
        {webdavPresets.map((preset) => <Label key={preset.id} title={t(preset.label)} modifiers={[tag(preset.id)]} />)}
      </Picker>
    </Menu>
  </Host>;
}
