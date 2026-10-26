import { Button, Host, Image, HStack, Text, VStack } from '@expo/ui/swift-ui';
import { accessibilityLabel, buttonStyle, font, foregroundStyle, frame, glassEffect, lineLimit, padding } from '@expo/ui/swift-ui/modifiers';
import { useCallback, useContext, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform } from 'react-native';
import { browserHost } from './browser-data';
import { browserPageTitle } from './online';
import { NativeBrowserAccessoryContext } from './NativeBrowserAccessory';
import type { OnlineBrowserBarProps } from './OnlineBrowserBar';

// 地址入口交给系统附加栏，在展开和行内布局之间保留同一个原生控件。
export function OnlineBrowserBar({ theme, provider, browser, address, bottom, start, badge, attention, onEdit }: OnlineBrowserBarProps) {
  const { t } = useTranslation();
  const { enabled, setAccessory } = useContext(NativeBrowserAccessoryContext);
  const edit = useRef(onEdit);
  useLayoutEffect(() => { edit.current = onEdit; }, [onEdit]);
  const onPress = useCallback(() => edit.current(), []);
  const url = (browser.url || address).replace(/^https:\/\//, '');
  const title = start ? t('browser.searchOrAddress')
    : browserPageTitle(browser.title, provider, browser.url || address) || provider?.name || browserHost(browser.url || address) || t('online.title');
  const label = `${title}，${t('browser.pageTools')}${badge ? `，${t('browser.downloading', { count: badge })}` : attention ? `，${t('browser.needsAttention')}` : ''}`;
  useLayoutEffect(() => {
    if (!enabled) return;
    setAccessory({ title, address: url, label, start, badge, attention, onPress });
    return () => setAccessory(null);
  }, [enabled, setAccessory, title, url, label, start, badge, attention, onPress]);
  if (enabled) return null;
  return <Host style={{ position: 'absolute', left: 12, right: 12, bottom, height: 56 }}>
    <Button onPress={onPress} modifiers={[buttonStyle('plain'), accessibilityLabel(label),
      ...(Number(Platform.Version) >= 26 ? [glassEffect({ glass: { variant: 'regular', interactive: true }, shape: 'capsule' })] : [])]}>
      <HStack spacing={8} modifiers={[padding({ horizontal: 12 }), frame({ height: 56 })]}>
        <Image systemName={start ? 'magnifyingglass' : 'globe'} color={theme.secondary} size={20} />
        <VStack>
          <Text modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(theme.label), lineLimit(1)]}>{title}</Text>
          {!start && <Text modifiers={[font({ textStyle: 'caption2' }), foregroundStyle(theme.secondary), lineLimit(1)]}>{url}</Text>}
        </VStack>
        {(badge > 0 || attention) && <Text modifiers={[foregroundStyle(theme.accent)]}>{badge ? String(badge) : '•'}</Text>}
      </HStack>
    </Button>
  </Host>;
}
