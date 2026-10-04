import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Platform, StyleSheet, View,
  type NativeSyntheticEvent, type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AndroidHeaderBackdrop } from './HeaderControls';
import { navigationContentInset } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import type { Theme } from './ui';

export const pageHeaderHeight = 64;

// 滚动标题共用安全区域、原生栏遮挡与减少动态效果设置。
export function usePageHeader({ collapseOffset = 52, bottomTabs = true, sourceId: providedSourceId }: {
  collapseOffset?: number; bottomTabs?: boolean; sourceId?: string;
} = {}) {
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
  const topInset = usesNativeControls ? Math.max(inset.top, nativeInsets.top) : inset.top;
  return {
    scrollY, onScroll, collapsed, reduceMotion, topInset,
    sourceId: providedSourceId ?? generatedSourceId,
    contentTop: Math.max(nativeInsets.contentTop, topInset + pageHeaderHeight + 16),
    contentBottom: bottomTabs ? usesNativeControls ? nativeInsets.bottom + 32 : navigationContentInset(inset.bottom)
      : inset.bottom + 32,
    onInsetsChange: (event: NativeSyntheticEvent<{ top: number; bottom: number; contentTop: number }>) => setNativeInsets(event.nativeEvent),
  };
}

// 一级与二级页面复用主页的渐变、渐进模糊和浮动操作栏。
export function PageHeader({ theme, scrollY, topInset, sourceId, active = true, title,
  expandedTitleInHeader = false, collapsed = false, reduceMotion = false, leading, actions, children, style, onLayout }: {
  theme: Theme; scrollY: Animated.Value; topInset: number; sourceId: string; active?: boolean;
  title?: string; expandedTitleInHeader?: boolean; collapsed?: boolean; reduceMotion?: boolean;
  leading?: ReactNode; actions?: ReactNode; children?: ReactNode;
} & ViewProps) {
  const compactOpacity = scrollY.interpolate({
    inputRange: reduceMotion ? [51.99, 52] : [24, 52], outputRange: [0, 1], extrapolate: 'clamp',
  });
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
      {children ?? <>
        <View style={styles.leading}>{leading}</View>
        <Animated.View accessibilityElementsHidden={!collapsed} importantForAccessibility={collapsed ? 'auto' : 'no-hide-descendants'}
          style={[styles.compactTitle, { opacity: compactOpacity }]}>
          <TextTitle title={title} theme={theme} compact />
        </Animated.View>
        <View style={styles.actions}>{actions}</View>
        {expandedTitleInHeader && <Animated.View pointerEvents="none" accessibilityElementsHidden={collapsed}
          importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
          style={[styles.expandedTitle, { opacity: scrollY.interpolate({
            inputRange: reduceMotion ? [51.99, 52] : [0, 32], outputRange: [1, 0], extrapolate: 'clamp',
          }), transform: [{ translateY: scrollY.interpolate({
            inputRange: [0, 52], outputRange: reduceMotion ? [0, 0] : [0, -8], extrapolate: 'clamp',
          }) }] }]}>
          <TextTitle title={title} theme={theme} />
        </Animated.View>}
      </>}
    </View>
  </>;
}

function TextTitle({ title, theme, compact = false }: { title?: string; theme: Theme; compact?: boolean }) {
  return <Animated.Text accessibilityRole="header" numberOfLines={compact ? 1 : 2}
    style={[compact ? styles.smallTitle : styles.largeTitle, { color: theme.label }]}>{title}</Animated.Text>;
}

// 二级页大标题随正文滚出，工具栏接续显示小标题。
export function PageTitle({ title, theme, collapsed }: { title: string; theme: Theme; collapsed: boolean }) {
  return <View accessibilityElementsHidden={collapsed} importantForAccessibility={collapsed ? 'no-hide-descendants' : 'auto'}
    style={styles.contentTitle}><TextTitle title={title} theme={theme} /></View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { position: 'absolute', left: 0, right: 0, zIndex: 2, minHeight: pageHeaderHeight,
    paddingHorizontal: 26, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  leading: { minWidth: 44 }, actions: { minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactTitle: { flex: 1 }, smallTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  expandedTitle: { position: 'absolute', left: 26, right: 26 },
  largeTitle: { fontSize: 28, lineHeight: 36, fontWeight: '600' },
  contentTitle: { paddingHorizontal: 12, paddingVertical: 8 },
});
