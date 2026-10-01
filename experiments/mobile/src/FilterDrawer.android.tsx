import BottomSheet, { BottomSheetBackdrop, BottomSheetFlatList, BottomSheetHandle, type BottomSheetBackdropProps,
  type BottomSheetHandleProps } from '@gorhom/bottom-sheet';
import { useCallback, useRef } from 'react';
import { Modal, StyleSheet, type FlatListProps } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { PanelContent, type LibraryPanelProps } from './panel-content';

const snapPoints = ['100%'];

// 底部安全区放入内容留白，滚动视口延伸到系统导航区。
export function FilterList<T>(props: FlatListProps<T>) {
  const inset = useSafeAreaInsets();
  const bottomPadding = StyleSheet.flatten(props.contentContainerStyle)?.paddingBottom;
  return <BottomSheetFlatList {...props} contentContainerStyle={[props.contentContainerStyle,
    { paddingBottom: (typeof bottomPadding === 'number' ? bottomPadding : 0) + inset.bottom }]} />;
}

// 安卓抽屉复用现成手势与滚动组件，内容沿用应用主题。
export function FilterDrawer(props: LibraryPanelProps) {
  const sheet = useRef<BottomSheet>(null);
  const inset = useSafeAreaInsets();
  const close = () => { if (!props.busy) sheet.current?.close(); };
  const handle = useCallback((handleProps: BottomSheetHandleProps) =>
    <BottomSheetHandle {...handleProps} accessibilityLabel="筛选面板拖动柄"
      accessibilityHint="向下拖动关闭筛选面板，也可点击完成"
      indicatorStyle={{ backgroundColor: props.theme.secondary }} />, [props.theme.secondary]);
  const backdrop = useCallback((backdropProps: BottomSheetBackdropProps) =>
    <BottomSheetBackdrop {...backdropProps} appearsOnIndex={0} disappearsOnIndex={-1}
      opacity={1} pressBehavior={props.busy ? 'none' : 'close'}
      accessibilityLabel="关闭筛选面板" accessibilityHint="关闭后返回字体库"
      style={[backdropProps.style, { backgroundColor: props.theme.scrim }]} />,
  [props.busy, props.theme.scrim]);
  if (!props.visible) return null;

  return <Modal transparent visible animationType="none" statusBarTranslucent navigationBarTranslucent
    onRequestClose={close}>
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.screen}>
        <BottomSheet ref={sheet} index={0} snapPoints={snapPoints} topInset={inset.top}
          enableDynamicSizing={false} enablePanDownToClose={!props.busy}
          enableContentPanningGesture={!props.busy} enableHandlePanningGesture={!props.busy}
          backdropComponent={backdrop} handleComponent={handle} onClose={props.onClose} accessible={false}
          backgroundStyle={{ backgroundColor: props.theme.background }}>
          <SafeAreaView edges={['left', 'right']} style={styles.screen}>
            <PanelContent {...props} onClose={close} />
          </SafeAreaView>
        </BottomSheet>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
