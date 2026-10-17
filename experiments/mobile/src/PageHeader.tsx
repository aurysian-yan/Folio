import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Platform, StyleSheet, View,
  type NativeScrollEvent, type NativeSyntheticEvent, type ViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AndroidHeaderBackdrop } from './HeaderControls';
import { navigationContentInset } from './bottom-navigation';
import { usesNativeControls } from './native-controls';
import { PageHeaderText } from './PageHeaderText';
import { pageHeaderSnapTarget, pageTitleCollapsed, pageTitleDuration, pageTitleMotion, pageTitleRemainingDuration } from './page-header-motion';
import { HeaderScrollContext } from './HeaderButtonShadow';
import type { Theme } from './ui';

export const pageHeaderHeight = 64;
export const pageTitleInset = 12;

// 滚动标题共用安全区域、原生栏遮挡与减少动态效果设置。
export function usePageHeader({ collapseOffset = pageTitleMotion.collapseOffset, bottomTabs = true, sourceId: providedSourceId, onSnap }: {
  collapseOffset?: number; bottomTabs?: boolean; sourceId?: string;
  onSnap: (offset: number, animated: boolean) => void;
}) {
  const inset = useSafeAreaInsets();
  const generatedSourceId = useId();
  const [scrollOffset] = useState(() => new Animated.Value(0));
  const [restoreOffset] = useState(() => new Animated.Value(0));
  const [restoringTitle, setRestoringTitle] = useState(false);
  const restoring = useRef(false);
  const currentOffset = useRef(0);
  const scrollSample = useRef({ offset: 0, time: 0 });
  const onSnapRef = useRef(onSnap);
  const scrollY = restoringTitle ? restoreOffset : scrollOffset;
  const [collapsed, setCollapsed] = useState(false);
  const [titleCollapsed, setTitleCollapsed] = useState(false);
  const titleTarget = useRef(false);
  const [titleOffset] = useState(() => new Animated.Value(0));
  const [titleScale] = useState(() => new Animated.Value(pageTitleMotion.compactMinimumScale));
  const [reduceMotion, setReduceMotion] = useState(false);
  const [nativeInsets, setNativeInsets] = useState({ top: inset.top, bottom: 0, contentTop: 0 });
  useLayoutEffect(() => { onSnapRef.current = onSnap; }, [onSnap]);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    let transition: Animated.CompositeAnimation | undefined;
    let startedAt = 0;
    let deadline = 0;
    scrollSample.current = { offset: currentOffset.current, time: performance.now() };
    // 滚动开始即驱动标题上浮与模糊交接，时长统一受限。
    function update(value: number, force = false) {
      const time = performance.now();
      const sample = scrollSample.current;
      const velocity = (value - sample.offset) / Math.max(1, time - sample.time);
      scrollSample.current = { offset: value, time };
      currentOffset.current = value;
      setCollapsed(value >= collapseOffset);
      const target = reduceMotion ? value >= collapseOffset : pageTitleCollapsed(value, titleTarget.current);
      let duration: number;
      if (!force && target === titleTarget.current) {
        if (reduceMotion || time >= deadline || (target ? velocity <= 0 : velocity >= 0)) return;
        const remaining = pageTitleRemainingDuration(velocity, time - startedAt, deadline - startedAt, collapseOffset);
        if (remaining === null) return;
        duration = remaining;
      } else {
        startedAt = time;
        duration = pageTitleDuration(velocity, collapseOffset);
      }
      deadline = time + duration;
      titleTarget.current = target;
      setTitleCollapsed(target);
      transition?.stop();
      const offset = target ? pageTitleMotion.end : 0;
      const scale = target ? pageTitleMotion.compactScale : pageTitleMotion.compactMinimumScale;
      if (reduceMotion) { titleOffset.setValue(offset); titleScale.setValue(1); return; }
      transition = Animated.parallel([
        Animated.timing(titleOffset, { toValue: offset, duration, easing: Easing.out(Easing.cubic),
          useNativeDriver: true, isInteraction: false }),
        Animated.timing(titleScale, { toValue: scale, duration,
          easing: target ? Easing.out(Easing.back(1.2)) : Easing.out(Easing.cubic),
          useNativeDriver: true, isInteraction: false }),
      ]);
      transition.start();
    }
    update(currentOffset.current, true);
    const listener = scrollY.addListener(({ value }) => update(value));
    return () => { scrollY.removeListener(listener); transition?.stop(); };
  }, [collapseOffset, reduceMotion, scrollY, titleOffset, titleScale]);
  const onScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { y: scrollOffset } } }], { useNativeDriver: true },
  ), [scrollOffset]);
  // 内容收起期间独立驱动标题，避免原生滚动归零打断过渡。
  const restoreTitle = useCallback(() => {
    if (restoring.current) return;
    const offset = Math.max(0, Math.min(collapseOffset, currentOffset.current));
    if (reduceMotion || offset === 0) {
      onSnapRef.current(0, false); scrollOffset.setValue(0); return;
    }
    restoreOffset.setValue(offset); restoring.current = true; setRestoringTitle(true);
  }, [collapseOffset, reduceMotion, restoreOffset, scrollOffset]);
  useLayoutEffect(() => {
    if (!restoringTitle) return;
    let current = true;
    onSnapRef.current(0, false); scrollOffset.setValue(0);
    const transition = Animated.timing(restoreOffset, {
      toValue: 0, duration: reduceMotion ? 0 : pageTitleMotion.duration,
      easing: Easing.inOut(Easing.ease), useNativeDriver: true, isInteraction: false,
    });
    transition.start(({ finished }) => {
      if (current && finished) {
        currentOffset.current = 0; setCollapsed(false); restoring.current = false; setRestoringTitle(false);
      }
    });
    return () => { current = false; transition.stop(); };
  }, [reduceMotion, restoreOffset, restoringTitle, scrollOffset]);
  const interruptRestore = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollSample.current = { offset: event.nativeEvent.contentOffset.y, time: performance.now() };
    if (restoring.current) { restoring.current = false; setRestoringTitle(false); }
  }, []);
  const settleHeader = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const target = pageHeaderSnapTarget(contentOffset.y, Math.max(0, contentSize.height - layoutMeasurement.height), collapseOffset);
    if (target === null) return;
    onSnap(target, !reduceMotion);
  }, [collapseOffset, reduceMotion, onSnap]);
  const snapScrollProps = useMemo(() => ({
    snapToOffsets: [0, collapseOffset], snapToEnd: false,
    onScrollBeginDrag: interruptRestore,
    onMomentumScrollEnd: settleHeader,
    onScrollEndDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentSize, layoutMeasurement, velocity } = event.nativeEvent;
      if (contentSize.height - layoutMeasurement.height < collapseOffset || Math.abs(velocity?.y ?? 0) < 0.05) settleHeader(event);
    },
  }), [collapseOffset, interruptRestore, settleHeader]);
  const topInset = usesNativeControls ? Math.max(inset.top, nativeInsets.top) : inset.top;
  return {
    scrollY, titleOffset, titleScale, titleCollapsed, onScroll, collapsed, reduceMotion, topInset, snapScrollProps, restoreTitle,
    sourceId: providedSourceId ?? generatedSourceId,
    contentTop: Math.max(nativeInsets.contentTop, topInset + pageHeaderHeight + 16),
    contentBottom: bottomTabs ? usesNativeControls ? nativeInsets.bottom + 32 : navigationContentInset(inset.bottom)
      : inset.bottom + 32,
    onInsetsChange: (event: NativeSyntheticEvent<{ top: number; bottom: number; contentTop: number }>) => setNativeInsets(event.nativeEvent),
  };
}

// 两处标题共用有界时长的交接进度，减少动态效果时直接切换。
function useTitleTransition(scrollY: Animated.Value, compact: boolean, reduceMotion: boolean) {
  return useMemo(() => {
    const inputRange = reduceMotion ? [pageTitleMotion.end - 0.01, pageTitleMotion.end]
      : [0, pageTitleMotion.end];
    const interpolate = (outputRange: number[]) => scrollY.interpolate({ inputRange, outputRange, extrapolate: 'clamp' });
    return {
      opacity: interpolate(compact ? [0, 1] : [1, 0]),
      scale: reduceMotion ? 1 : interpolate(compact ? [pageTitleMotion.compactMinimumScale, pageTitleMotion.compactScale] : [1, pageTitleMotion.minimumScale]),
      blurRadius: reduceMotion ? 0 : interpolate(compact ? [pageTitleMotion.blur, 0] : [0, pageTitleMotion.blur]),
    };
  }, [scrollY, compact, reduceMotion]);
}

// 一级与二级页面复用主页的渐进模糊和浮动操作栏。
export function PageHeader({ theme, scrollY, titleOffset = scrollY, titleScale, topInset, sourceId, active = true, title, subtitle, fixed = false,
  collapsed = false, titleCollapsed = collapsed, reduceMotion = false, leading, actions, children, style, onLayout }: {
  theme: Theme; scrollY: Animated.Value; topInset: number; sourceId: string; active?: boolean;
  title?: string; subtitle?: string; fixed?: boolean; collapsed?: boolean; titleCollapsed?: boolean; reduceMotion?: boolean;
  titleOffset?: Animated.Value; titleScale?: Animated.Value;
  leading?: ReactNode; actions?: ReactNode; children?: ReactNode;
} & ViewProps) {
  const compact = useTitleTransition(titleOffset, true, reduceMotion);
  const [leadingWidth, setLeadingWidth] = useState(44);
  const [actionsWidth, setActionsWidth] = useState(44);
  const horizontalInset = StyleSheet.flatten([styles.header, style]).paddingHorizontal ?? 26;
  const titleInset = Number(horizontalInset) + Math.max(leadingWidth, actionsWidth) + 12;
  const titleVisible = fixed || titleCollapsed;
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
        <View onLayout={({ nativeEvent }) => setLeadingWidth(nativeEvent.layout.width)} style={styles.leading}>{leading}</View>
        <Animated.View pointerEvents="none" accessibilityElementsHidden={!titleVisible} importantForAccessibility={titleVisible ? 'auto' : 'no-hide-descendants'}
          style={[styles.compactTitle, { left: titleInset, right: titleInset, opacity: fixed ? 1 : compact.opacity,
            transform: [{ scale: fixed || reduceMotion ? 1 : titleScale ?? compact.scale }],
            ...(Platform.OS === 'android' && !fixed ? { filter: [{ blur: compact.blurRadius }] } : {}) }]}>
          <PageHeaderText title={title} theme={theme} compact scrollY={titleOffset} reduceMotion={reduceMotion || fixed} style={styles.smallTitle} />
          {!!subtitle && <PageHeaderText title={subtitle} theme={theme} compact secondary scrollY={titleOffset}
            reduceMotion={reduceMotion || fixed} style={styles.smallSubtitle} />}
        </Animated.View>
        <View onLayout={({ nativeEvent }) => setActionsWidth(nativeEvent.layout.width)} style={styles.actions}>{actions}</View>
      </>}</HeaderScrollContext.Provider>
    </View>
  </>;
}

// 上浮、模糊和淡出共用交接进度，抵消正文位移以限制上浮距离。
export function PageTitle({ title, subtitle, theme, scrollY, titleOffset = scrollY, collapsed, titleCollapsed = collapsed, reduceMotion = false, style }: {
  title: string; theme: Theme; scrollY: Animated.Value; collapsed: boolean; reduceMotion?: boolean;
  subtitle?: string; titleOffset?: Animated.Value; titleCollapsed?: boolean;
} & Pick<ViewProps, 'style'>) {
  const expanded = useTitleTransition(titleOffset, false, reduceMotion);
  const translateY = useMemo(() => reduceMotion ? scrollY : Animated.subtract(scrollY, titleOffset.interpolate({
    inputRange: [0, pageTitleMotion.end], outputRange: [0, pageTitleMotion.collapseOffset], extrapolate: 'clamp',
  })), [reduceMotion, scrollY, titleOffset]);
  return <Animated.View pointerEvents="none" accessibilityElementsHidden={titleCollapsed}
    importantForAccessibility={titleCollapsed ? 'no-hide-descendants' : 'auto'}
    style={[styles.contentTitle, { opacity: expanded.opacity,
      transform: [{ translateY }],
      ...(Platform.OS === 'android' ? { filter: [{ blur: expanded.blurRadius }] } : {}) }, style]}>
    <PageHeaderText title={title} theme={theme} scrollY={titleOffset} reduceMotion={reduceMotion} style={styles.largeTitle} />
    {!!subtitle && <PageHeaderText title={subtitle} theme={theme} secondary scrollY={titleOffset}
      reduceMotion={reduceMotion} style={styles.largeSubtitle} />}
  </Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { position: 'absolute', left: 0, right: 0, zIndex: 2, minHeight: pageHeaderHeight,
    paddingHorizontal: 26, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 },
  leading: { minWidth: 44 }, actions: { minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  compactTitle: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center', paddingVertical: 8, gap: 4 }, smallTitle: { fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center' },
  smallSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '400', textAlign: 'center' },
  largeTitle: { fontSize: 34, lineHeight: 44, fontWeight: '600' },
  largeSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  contentTitle: { paddingHorizontal: pageTitleInset, paddingVertical: 8, gap: 8, zIndex: 1 },
});
