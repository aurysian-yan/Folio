import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Platform, StyleSheet, View,
  type NativeScrollEvent, type NativeSyntheticEvent, type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AndroidHeaderBackdrop } from './HeaderControls';
import { navigationContentInset } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import { PageHeaderText } from './PageHeaderText';
import { pageHeaderSnapTarget, pageTitleMotion } from './page-header-motion';
import { HeaderScrollContext } from './HeaderButtonShadow';
import type { Theme } from './ui';

export const pageHeaderHeight = 64;

// 滚动标题共用安全区域、原生栏遮挡与减少动态效果设置。
export function usePageHeader({ collapseOffset = pageTitleMotion.end, bottomTabs = true, sourceId: providedSourceId, onSnap }: {
  collapseOffset?: number; bottomTabs?: boolean; sourceId?: string;
  onSnap: (offset: number, animated: boolean) => void;
}) {
  const inset = useSafeAreaInsets();
  const generatedSourceId = useId();
  const [scrollY] = useState(() => new Animated.Value(0));
  const [collapsed, setCollapsed] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const [nativeInsets, setNativeInsets] = useState({ top: inset.top, bottom: 0, contentTop: 0 });
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const listener = scrollY.addListener(({ value }) => setCollapsed(value >= collapseOffset));
    return () => scrollY.removeListener(listener);
  }, [collapseOffset, scrollY]);
  const onScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true },
  ), [scrollY]);
  const settleHeader = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const target = pageHeaderSnapTarget(contentOffset.y, Math.max(0, contentSize.height - layoutMeasurement.height), collapseOffset);
    if (target === null) return;
    onSnap(target, !reduceMotion);
  }, [collapseOffset, reduceMotion, onSnap]);
  const snapScrollProps = useMemo(() => ({
    snapToOffsets: [0, collapseOffset], snapToEnd: false,
    onMomentumScrollEnd: settleHeader,
    onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentSize, layoutMeasurement, velocity } = event.nativeEvent;
      if (contentSize.height - layoutMeasurement.height < collapseOffset || Math.abs(velocity?.y ?? 0) < 0.05) settleHeader(event);
    },
  }), [collapseOffset, settleHeader]);
  const topInset = usesNativeControls ? Math.max(inset.top, nativeInsets.top) : inset.top;
  return {
    scrollY, onScroll, collapsed, reduceMotion, topInset, snapScrollProps,
    sourceId: providedSourceId ?? generatedSourceId,
    contentTop: Math.max(nativeInsets.contentTop, topInset + pageHeaderHeight + 16),
    contentBottom: bottomTabs ? usesNativeControls ? nativeInsets.bottom + 32 : navigationContentInset(inset.bottom)
      : inset.bottom + 32,
    onInsetsChange: (event: NativeSyntheticEvent<{ top: number; bottom: number; contentTop: number }>) => setNativeInsets(event.nativeEvent),
  };
}

// 两处标题按同一滚动区间交接，减少动态效果时直接切换。
function useTitleTransition(scrollY: Animated.Value, compact: boolean, reduceMotion: boolean) {
  return useMemo(() => {
    const inputRange = reduceMotion ? [pageTitleMotion.end - 0.01, pageTitleMotion.end]
      : [compact ? pageTitleMotion.compactStart : 0, pageTitleMotion.end];
    const interpolate = (outputRange: number[]) => scrollY.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
    return {
      opacity: interpolate(compact ? [0, 1] : [1, 0]),
      scale: reduceMotion ? 1 : interpolate(compact ? [pageTitleMotion.compactMinimumScale, 1] : [1, pageTitleMotion.minimumScale]),
      blurRadius: reduceMotion ? 0 : interpolate(compact ? [pageTitleMotion.blur, 0] : [0, pageTitleMotion.blur]),
    };
  }, [scrollY, compact, reduceMotion]);
}

// 一级与二级页面复用主页的渐进模糊和浮动操作栏。
export function PageHeader({ theme, scrollY, topInset, sourceId, active = true, title,
  collapsed = false, reduceMotion = false, leading, actions, children, style, onLayout }: {
  theme: Theme; scrollY: Animated.Value; topInset: number; sourceId: string; active?: boolean;
  title?: string; collapsed?: boolean; reduceMotion?: boolean;
  leading?: ReactNode; actions?: ReactNode; children?: ReactNode;
} & ViewProps) {
  const compact = useTitleTransition(scrollY, true, reduceMotion);
  return <>
    {Platform.OS === 'android' && <Animated.View pointerEvents="none"
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.backdrop, { height: topInset + pageHeaderHeight + 34,
        opacity: scrollY.interpolate({ inputRange: [0, 56], outputRange: [0, 1], extrapolate: 'clamp' }) }]}>
      <AndroidHeaderBackdrop sourceId={sourceId} active={active} theme={theme} style={styles.fill} />
    </Animated.View>}
    <View collapsable={false} pointerEvents="box-none" onLayout={onLayout}
      style={[styles.header, { top: topInset,
        backgroundColor: Platform.OS === 'ios' && Number(Platform.Version) < 26 ? theme.background : undefined }, style]}>
      <HeaderScrollContext.Provider value={scrollY}>{children ?? <>
        <View style={styles.leading}>{leading}</View>
        <Animated.View accessibilityElementsHidden={!collapsed} importantForAccessibility={collapsed ? 'auto' : 'no-hide-descendants'}
          style={[styles.compactTitle, { opacity: compact.opacity, transform: [{ scale: compact.scale }],
            ...(Platform.OS === 'android' ? { filter: [{ blur: compact.blurRadius }] } : {}) }]}>
          <PageHeaderText title={title} theme={theme} compact scrollY={scrollY} reduceMotion={reduceMotion} style={styles.smallTitle} />
        </Animated.View>
        <View style={styles.actions}>{actions}</View>
      </>}</HeaderScrollContext.Provider>
    </View>
  </>;
}

// 反向抵消正文位移，大标题保持原位并逐渐缩小、模糊和淡出。
export function PageTitle({ title, theme, scrollY, collapsed, reduceMotion = false }: {
  title: string; theme: Theme; scrollY: Animated.Value; collapsed: boolean; reduceMotion?: boolean;
}) {
  const expanded = useTitleTransition(scrollY, false, reduceMotion);
  return <Animated.View pointerEvents="none" accessibilityElementsHidden={collapsed}
    importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
    style={[styles.contentTitle, { opacity: expanded.opacity,
      transform: [{ translateY: scrollY }],
      ...(Platform.OS === 'android' ? { filter: [{ blur: expanded.blurRadius }] } : {}) }]}>
    <PageHeaderText title={title} theme={theme} scrollY={scrollY} reduceMotion={reduceMotion} style={styles.largeTitle} />
  </Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { position: 'absolute', left: 0, right: 0, zIndex: 2, minHeight: pageHeaderHeight,
    paddingHorizontal: 26, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  leading: { minWidth: 44 }, actions: { minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactTitle: { flex: 1, paddingVertical: 8 }, smallTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  largeTitle: { fontSize: 34, lineHeight: 44, fontWeight: '600' },
  contentTitle: { paddingHorizontal: 12, paddingVertical: 8, zIndex: 1 },
});
