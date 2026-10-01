import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PanelBody, type LibraryPanelProps } from './panel-content';

// 安卓面板使用原生 Modal，返回与遮罩点击统一关闭。
export function LibraryPanel(props: LibraryPanelProps) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  const inset = useSafeAreaInsets();
  const close = () => { if (!props.busy) props.onClose(); };
  return <Modal transparent visible={props.visible} animationType="none" onRequestClose={close}>
    <View style={styles.overlay}>
      <Pressable accessibilityLabel={t('desktop.closePanel')} onPress={close}
        style={[StyleSheet.absoluteFill, { backgroundColor: props.theme.scrim }]} />
      <View style={{ height: Math.max(0, height - inset.top) }}><PanelBody {...props} /></View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({ overlay: { flex: 1, justifyContent: 'flex-end' } });
