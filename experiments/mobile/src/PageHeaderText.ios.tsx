import { Host, Text } from '@expo/ui/swift-ui';
import { accessibilityAddTraits, blur, font, foregroundStyle, frame, lineLimit, scaleEffect } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import type { PageHeaderTextProps } from './PageHeaderText';
import { pageTitleBlur, pageTitleMotion } from './page-header-motion';

// iOS 复用现有 SwiftUI 文本模糊，仅订阅标题交接区间的半径变化。
export function PageHeaderText({ title, theme, compact = false, scrollY, reduceMotion, style }: PageHeaderTextProps) {
  const [offset, setOffset] = useState(0);
  const { fontScale } = useWindowDimensions();
  const typography = StyleSheet.flatten(style);
  const size = (typography?.fontSize ?? 34) * fontScale;
  const lineHeight = (typography?.lineHeight ?? 44) * fontScale;
  useEffect(() => {
    if (reduceMotion) return;
    const listener = scrollY.addListener(({ value }) => setOffset(Math.max(0, Math.min(pageTitleMotion.end, value))));
    return () => scrollY.removeListener(listener);
  }, [scrollY, compact, reduceMotion]);
  return <Host matchContents={{ vertical: true }} ignoreSafeArea="all" pointerEvents="none"
    colorScheme={theme.dark ? 'dark' : 'light'} style={{ width: '100%', minHeight: lineHeight }}>
    <Text modifiers={[font({ size, weight: 'semibold' }), foregroundStyle(theme.label),
      lineLimit(compact ? 1 : 2),
      scaleEffect(reduceMotion || compact ? 1 : 1 + (pageTitleMotion.minimumScale - 1) * offset / pageTitleMotion.end),
      frame({ maxWidth: Infinity, minHeight: lineHeight, alignment: compact ? 'center' : 'leading' }),
      accessibilityAddTraits(['isHeader']), blur(reduceMotion ? 0 : pageTitleBlur(offset, compact))]}>{title}</Text>
  </Host>;
}
