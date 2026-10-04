import { Button, Host, HStack, Image, Menu } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, contentShape, controlSize, disabled, frame, glassEffect, menuIndicator, menuStyle, shadow, shapes, tint } from '@expo/ui/swift-ui/modifiers';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform } from 'react-native';
import { headerShadowColor, useHeaderShadowProgress } from './HeaderButtonShadow';
import type { FontActionsMenuProps } from './FontActionsMenu';

// 收藏操作使用主页同款系统玻璃菜单。
export function FontActionsMenu({ theme, favorite, favoritePending, onFavorite, onAddToCollection }: FontActionsMenuProps) {
  const { t } = useTranslation();
  const glass = Number(Platform.Version) >= 26;
  const shadowProgress = useHeaderShadowProgress();
  return <Host style={{ width: 64, height: 44 }} colorScheme={theme.dark ? 'dark' : 'light'}>
    <Menu label={<HStack spacing={6} modifiers={[frame({ width: 64, height: 44 }), contentShape(shapes.capsule())]}>
      <Image systemName="ellipsis" size={20} color={theme.label} />
      <Image systemName="chevron.down" size={10} color={theme.secondary} />
    </HStack>} modifiers={[menuStyle('button'), buttonStyle(glass ? 'plain' : 'bordered'), controlSize('large'),
      menuIndicator('hidden'), tint(theme.label), accessibilityLabel(t('font.operations')), frame({ width: 64, height: 44 }),
      ...(glass ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })] : []),
      shadow({ radius: 32, y: 2, color: headerShadowColor(theme, shadowProgress) })]}>
      <Button label={t(favorite ? 'collection.unfavorite' : 'collection.favorite')} systemImage={favorite ? 'star.fill' : 'star'}
        modifiers={[disabled(favoritePending)]} onPress={() => { Keyboard.dismiss(); onFavorite(); }} />
      <Button label={t('collection.addTo')} systemImage="folder.badge.plus"
        onPress={() => { Keyboard.dismiss(); onAddToCollection(); }} />
    </Menu>
  </Host>;
}
