import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { navigationItems, type MobileTab } from './bottom-navigation';

// 切页期间保留前后两页，字体库与搜索页始终保留浏览状态。
export function TabScenes({ selectedId, scenes }: {
  selectedId: MobileTab;
  scenes: Record<MobileTab, ReactNode>;
}) {
  const [opacity] = useState(() => Object.fromEntries(navigationItems.map(({ id }) =>
    [id, new Animated.Value(id === selectedId ? 1 : 0)])) as Record<MobileTab, Animated.Value>);
  const [pages, setPages] = useState({ selectedId, displayed: [selectedId] as MobileTab[] });
  const [reduceMotion, setReduceMotion] = useState(false);

  if (pages.selectedId !== selectedId) {
    setPages({ selectedId, displayed: pages.displayed.includes(selectedId) ? pages.displayed : [...pages.displayed, selectedId] });
  }

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);

  useLayoutEffect(() => {
    let current = true;
    const transition = Animated.parallel(navigationItems.map(({ id }) => Animated.timing(opacity[id], {
      toValue: id === selectedId ? 1 : 0,
      duration: reduceMotion ? 0 : 220,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
      isInteraction: false,
    })));
    transition.start(({ finished }) => {
      if (current && finished) setPages((previous) => previous.selectedId === selectedId
        ? { selectedId, displayed: [selectedId] } : previous);
    });
    return () => { current = false; transition.stop(); };
  }, [opacity, reduceMotion, selectedId]);

  return <View style={styles.container}>
    {navigationItems.map(({ id }) => {
      const active = id === selectedId;
      const visible = active || pages.displayed.includes(id);
      return <Animated.View key={id} pointerEvents={active ? 'auto' : 'none'}
        accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
        style={[StyleSheet.absoluteFill, { opacity: opacity[id] }, !visible && styles.hidden]}>
        {(visible || id === 'local' || id === 'search') && scenes[id]}
      </Animated.View>;
    })}
  </View>;
}

const styles = StyleSheet.create({ container: { flex: 1 }, hidden: { display: 'none' } });
