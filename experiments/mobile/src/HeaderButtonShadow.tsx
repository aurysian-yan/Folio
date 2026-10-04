import { createContext, useContext, useEffect, useState } from 'react';
import type { Animated } from 'react-native';
import { pageTitleMotion } from './page-header-motion';
import type { Theme } from './ui';

export const HeaderScrollContext = createContext<Animated.Value | null>(null);

// 阴影只在顶栏滚动区间更新，不触发正文重新渲染。
export function useHeaderShadowProgress() {
  const scrollY = useContext(HeaderScrollContext);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    if (!scrollY) return;
    const listener = scrollY.addListener(({ value }) => setProgress(Math.max(0, Math.min(1, value / pageTitleMotion.end))));
    return () => scrollY.removeListener(listener);
  }, [scrollY]);
  return scrollY ? progress : 0;
}

export function headerShadowColor(theme: Theme, progress: number, pressed = false) {
  const color = Number.parseInt(theme.shadow.slice(1), 16);
  const opacity = Math.min(1, (pressed ? 1 : progress) * (theme.dark ? 0.6 : 0.2) * (pressed ? 2 : 1));
  return `rgba(${(color >> 16) & 255}, ${(color >> 8) & 255}, ${color & 255}, ${opacity})`;
}
