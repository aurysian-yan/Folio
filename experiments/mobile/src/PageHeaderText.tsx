import { useMemo } from 'react';
import { Animated, type StyleProp, type TextStyle } from 'react-native';
import { pageTitleMotion } from './page-header-motion';
import type { Theme } from './ui';

export interface PageHeaderTextProps {
  title?: string;
  theme: Theme;
  compact?: boolean;
  scrollY: Animated.Value;
  reduceMotion: boolean;
  style: StyleProp<TextStyle>;
}

// 大标题以文字边界的中心缩放，模糊由外层原生动画滤镜处理。
export function PageHeaderText({ title, theme, compact = false, scrollY, reduceMotion, style }: PageHeaderTextProps) {
  const scale = useMemo(() => scrollY.interpolate({ inputRange: [0, pageTitleMotion.end],
    outputRange: [1, pageTitleMotion.minimumScale], extrapolate: 'clamp' }), [scrollY]);
  return <Animated.Text accessibilityRole="header" numberOfLines={compact ? 1 : 2}
    style={[style, { color: theme.label }, !compact && { alignSelf: 'flex-start', maxWidth: '100%',
      transformOrigin: 'center', transform: [{ scale: reduceMotion ? 1 : scale }] }]}>{title}</Animated.Text>;
}
