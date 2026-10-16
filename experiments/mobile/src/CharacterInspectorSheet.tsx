import BottomSheet, { BottomSheetHandle, BottomSheetScrollView, type BottomSheetBackgroundProps, type BottomSheetHandleProps, type BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import Motion, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerShadowColor } from './HeaderButtonShadow';
import { PanelBackdrop } from './PanelBackdrop';
import { characterSheetLayout } from './character-map-layout';
import type { Theme } from './ui';

// 非模态卡片与网格分开采样，切换字款不卸载抽屉。
export function CharacterInspectorSheet({ summary, controls, theme, sourceId, height, topInset, onCollapsedHeight }: {
  summary: ReactNode; controls: ReactNode; theme: Theme; sourceId: string; height: number; topInset: number;
  onCollapsedHeight: (height: number) => void;
}) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const scroll = useRef<BottomSheetScrollViewMethods>(null);
  const [summaryHeight, setSummaryHeight] = useState(168);
  const [controlsHeight, setControlsHeight] = useState(128);
  const [index, setIndex] = useState(0);
  const bottom = Math.max(inset.bottom, 12);
  const position = useSharedValue(0);
  const backgroundStyle = useAnimatedStyle(() => ({ height: Math.max(0, height - bottom - position.value), bottom: undefined }));
  const contentStyle = useAnimatedStyle(() => ({ height: Math.max(0, height - bottom - position.value) }));
  const layout = characterSheetLayout(summaryHeight, controlsHeight, height, topInset, bottom);
  const resetScroll = useCallback(() => scroll.current?.scrollTo({ y: 0, animated: false }), []);
  useLayoutEffect(() => onCollapsedHeight(layout.collapsed + bottom), [layout.collapsed, bottom, onCollapsedHeight]);
  const background = useCallback((props: BottomSheetBackgroundProps) =>
    <Motion.View pointerEvents="none" style={[props.style, styles.background, backgroundStyle,
      Platform.OS === 'android' && { boxShadow: [{ offsetX: 0, offsetY: 4, blurRadius: 12, color: headerShadowColor(theme, 0.5) }] }]}>
      <PanelBackdrop style={StyleSheet.absoluteFill} theme={theme} sourceId={sourceId} cornerRadius={32} />
    </Motion.View>, [theme, sourceId, backgroundStyle]);
  const handle = useCallback((props: BottomSheetHandleProps) => <Pressable accessibilityRole="button" hitSlop={10}
    disabled={layout.snapPoints.length === 1}
    accessibilityLabel={t('characterMap.title')} accessibilityState={{ expanded: index > 0 || layout.snapPoints.length === 1, disabled: layout.snapPoints.length === 1 }}
    accessibilityHint={layout.snapPoints.length > 1 ? t(index > 0 ? 'common.collapse' : 'desktop.expand') : undefined}
    onPress={() => { Keyboard.dismiss(); sheet.current?.snapToIndex(index > 0 ? 0 : layout.snapPoints.length - 1); }}>
    <BottomSheetHandle {...props} indicatorStyle={{ backgroundColor: theme.secondary }} />
  </Pressable>, [index, layout.snapPoints.length, t, theme.secondary]);
  return <BottomSheet ref={sheet} index={0} snapPoints={layout.snapPoints} enableDynamicSizing={false}
    detached bottomInset={bottom} topInset={topInset} style={styles.sheet} animatedPosition={position} backgroundComponent={background}
    handleComponent={handle} enablePanDownToClose={false} animateOnMount={false}
    activeOffsetY={[-8, 8]} failOffsetX={[-12, 12]}
    keyboardBehavior="interactive" keyboardBlurBehavior="restore" enableBlurKeyboardOnGesture
    android_keyboardInputMode="adjustResize"
    onAnimate={(_from, to) => { if (to === 0) resetScroll(); }}
    onChange={(next) => { setIndex(next); if (next === 0) resetScroll(); }} accessible={false}>
    <Motion.View style={[styles.clip, contentStyle]}><BottomSheetScrollView ref={scroll} style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View onLayout={({ nativeEvent }) => setSummaryHeight(nativeEvent.layout.height)}>{summary}</View>
      <View onLayout={({ nativeEvent }) => setControlsHeight(nativeEvent.layout.height)}
        pointerEvents={index === 0 && layout.snapPoints.length > 1 ? 'none' : 'auto'}
        accessibilityElementsHidden={index === 0 && layout.snapPoints.length > 1}
        importantForAccessibility={index === 0 && layout.snapPoints.length > 1 ? 'no-hide-descendants' : 'auto'}
        style={styles.controls}>{controls}</View>
    </BottomSheetScrollView></Motion.View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 12 }, background: { borderRadius: 32 }, scroll: { flex: 1 },
  clip: { borderRadius: 32, overflow: 'hidden', transform: [{ translateY: -24 }] },
  content: { paddingTop: 24, paddingHorizontal: 8, paddingBottom: 8, gap: 8 }, controls: { gap: 16 },
});
