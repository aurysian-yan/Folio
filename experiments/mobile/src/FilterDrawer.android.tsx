import BottomSheet, { BottomSheetFlatList, BottomSheetHandle, BottomSheetScrollView, BottomSheetTextInput,
  type BottomSheetHandleProps } from '@gorhom/bottom-sheet';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, useWindowDimensions, type FlatListProps, type ScrollViewProps } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Motion, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PanelHeader, type LibraryPanelProps } from './panel-content';
import { screenCornerRadius } from './native';
import { settingsLayout } from './settings-ui';

const snapPoints = ['100%'];
export { BottomSheetTextInput as FilterTextInput };

// 编辑内容复用抽屉滚动手势，并避开底部系统区域。
export function FilterScrollView(props: ScrollViewProps) {
  const inset = useSafeAreaInsets();
  const bottomPadding = StyleSheet.flatten(props.contentContainerStyle)?.paddingBottom;
  return <BottomSheetScrollView {...props} style={[styles.screen, props.style, { marginLeft: inset.left, marginRight: inset.right }]} contentContainerStyle={[props.contentContainerStyle,
    { paddingBottom: (typeof bottomPadding === 'number' ? bottomPadding : 0) + inset.bottom }]}>{props.children}</BottomSheetScrollView>;
}

// 底部安全区放入内容留白，滚动视口延伸到系统导航区。
export function FilterList<T>(props: FlatListProps<T>) {
  const inset = useSafeAreaInsets();
  const bottomPadding = StyleSheet.flatten(props.contentContainerStyle)?.paddingBottom;
  return <BottomSheetFlatList {...props} style={[props.style, { marginLeft: inset.left, marginRight: inset.right }]} contentContainerStyle={[props.contentContainerStyle,
    { paddingBottom: (typeof bottomPadding === 'number' ? bottomPadding : 0) + inset.bottom }]} />;
}

// 安卓抽屉复用现成手势与滚动组件，内容沿用应用主题。
export function FilterDrawer(props: LibraryPanelProps) {
  const sheet = useRef<BottomSheet>(null);
  const inset = useSafeAreaInsets();
  const { t } = useTranslation();
  const ownIndex = useSharedValue(-1);
  const animatedIndex = props.nested && props.stackIndex ? props.stackIndex : ownIndex;
  const { nested, stackIndex, visible } = props;
  // 二级抽屉的实时位置驱动上一级缩放，拖动和开合共用同一进度。
  const stackStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (!nested && stackIndex ? Math.min(1, Math.max(0, stackIndex.value + 1)) * 0.05 : 0) }],
  }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: Math.min(1, Math.max(0, animatedIndex.value + 1)) }));
  useEffect(() => {
    if (!nested || !stackIndex) return;
    return () => { stackIndex.value = -1; };
  }, [nested, stackIndex, visible]);
  // 窗口尺寸变化时重新读取圆角，兼容旋转与分屏。
  useWindowDimensions();
  const close = useCallback(() => { if (!props.busy) sheet.current?.close(); }, [props.busy]);
  // 固定操作区计入拖动柄高度，正文直接使用抽屉滚动组件。
  const handle = useCallback((handleProps: BottomSheetHandleProps) =>
    <><BottomSheetHandle {...handleProps} accessibilityLabel={t('desktop.filterDrawerHandle')}
      accessibilityHint={t('mobile.dragCloseFilterPanel')}
      indicatorStyle={{ backgroundColor: props.theme.secondary }} />
      <SafeAreaView edges={['left', 'right']}><PanelHeader {...props} onClose={close} />{props.headerAccessory}</SafeAreaView>
    </>, [close, props, t]);
  if (!props.visible) return null;
  const borderRadius = Math.min(42, Math.max(settingsLayout.card.borderRadius + 8, screenCornerRadius()));

  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
    onRequestClose={props.onBack ?? close}>
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.screen}>
        <Motion.View style={[StyleSheet.absoluteFill, backdropStyle]}>
          <Pressable style={[styles.screen, { backgroundColor: props.theme.scrim }]} onPress={close}
            accessibilityRole="button" accessibilityLabel={t('desktop.closeFilterPanel')}
            accessibilityHint={t('mobile.closeReturnsLibrary')} disabled={props.busy} />
        </Motion.View>
        <Motion.View pointerEvents="box-none" style={[styles.screen, { transformOrigin: ['50%', inset.top, 0] }, stackStyle]}>
          <BottomSheet ref={sheet} index={0} snapPoints={snapPoints} topInset={inset.top + (props.nested ? 24 : 0)}
            animatedIndex={animatedIndex}
            keyboardBehavior="extend" keyboardBlurBehavior="restore" enableBlurKeyboardOnGesture android_keyboardInputMode="adjustResize"
            enableDynamicSizing={false} enablePanDownToClose={!props.busy}
            enableContentPanningGesture={!props.busy} enableHandlePanningGesture={!props.busy}
            handleComponent={handle} onClose={props.onClose} accessible={false}
            backgroundStyle={{ backgroundColor: props.theme.background, borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }}>
            {props.children}
          </BottomSheet>
        </Motion.View>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
