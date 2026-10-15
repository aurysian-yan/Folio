import BottomSheet, { BottomSheetHandle, BottomSheetScrollView, type BottomSheetBackgroundProps, type BottomSheetHandleProps } from '@gorhom/bottom-sheet';
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PanelBackdrop } from './PanelBackdrop';
import { characterSheetLayout } from './character-map-layout';
import { settingsLayout } from './settings-ui';
import type { Theme } from './ui';

// 非模态卡片与网格分开采样，切换字款不卸载抽屉。
export function CharacterInspectorSheet({ summary, controls, theme, sourceId, height, topInset, onCollapsedHeight }: {
  summary: ReactNode; controls: ReactNode; theme: Theme; sourceId: string; height: number; topInset: number;
  onCollapsedHeight: (height: number) => void;
}) {
  const { t } = useTranslation();
  const inset = useSafeAreaInsets();
  const sheet = useRef<BottomSheet>(null);
  const [summaryHeight, setSummaryHeight] = useState(168);
  const [controlsHeight, setControlsHeight] = useState(128);
  const [index, setIndex] = useState(0);
  const bottom = inset.bottom + 16;
  const layout = characterSheetLayout(summaryHeight, controlsHeight, height, topInset, bottom);
  useLayoutEffect(() => onCollapsedHeight(layout.collapsed + bottom), [layout.collapsed, bottom, onCollapsedHeight]);
  const background = useCallback((props: BottomSheetBackgroundProps) =>
    <PanelBackdrop style={props.style} theme={theme} sourceId={sourceId} />, [theme, sourceId]);
  const handle = useCallback((props: BottomSheetHandleProps) => <Pressable accessibilityRole="button" hitSlop={10}
    disabled={layout.snapPoints.length === 1}
    accessibilityLabel={t('characterMap.title')} accessibilityState={{ expanded: index > 0 || layout.snapPoints.length === 1, disabled: layout.snapPoints.length === 1 }}
    accessibilityHint={layout.snapPoints.length > 1 ? t(index > 0 ? 'common.collapse' : 'desktop.expand') : undefined}
    onPress={() => { Keyboard.dismiss(); sheet.current?.snapToIndex(index > 0 ? 0 : layout.snapPoints.length - 1); }}>
    <BottomSheetHandle {...props} indicatorStyle={{ backgroundColor: theme.secondary }} />
  </Pressable>, [index, layout.snapPoints.length, t, theme.secondary]);
  return <BottomSheet ref={sheet} index={0} snapPoints={layout.snapPoints} enableDynamicSizing={false}
    detached bottomInset={bottom} topInset={topInset} style={styles.sheet} backgroundComponent={background}
    handleComponent={handle} enablePanDownToClose={false} animateOnMount={false}
    activeOffsetY={[-8, 8]} failOffsetX={[-12, 12]}
    keyboardBehavior="interactive" keyboardBlurBehavior="restore" enableBlurKeyboardOnGesture
    android_keyboardInputMode="adjustResize" onChange={setIndex} accessible={false}>
    <BottomSheetScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View onLayout={({ nativeEvent }) => setSummaryHeight(nativeEvent.layout.height)}>{summary}</View>
      <View onLayout={({ nativeEvent }) => setControlsHeight(nativeEvent.layout.height)}
        accessibilityElementsHidden={index === 0 && layout.snapPoints.length > 1}
        importantForAccessibility={index === 0 && layout.snapPoints.length > 1 ? 'no-hide-descendants' : 'auto'}
        style={styles.controls}>{controls}</View>
    </BottomSheetScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  sheet: { marginHorizontal: 12, borderRadius: settingsLayout.card.borderRadius, overflow: 'hidden' },
  content: { paddingBottom: 16 }, controls: { paddingHorizontal: 8, gap: 16 },
});
