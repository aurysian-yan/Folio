import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { PanelContent, type LibraryPanelProps } from './panel-content';

// 安卓编辑器沿用桌面居中对话框，键盘和返回键由系统处理。
export function CollectionEditorDialog(props: LibraryPanelProps) {
  const { t } = useTranslation();
  const close = () => { if (!props.busy) props.onClose(); };
  return <Modal transparent visible={props.visible} animationType="none" onRequestClose={close}>
    <SafeAreaProvider><SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.overlay}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('desktop.closePanel')} onPress={close}
          style={[StyleSheet.absoluteFill, { backgroundColor: props.theme.scrim }]} />
        <View style={[styles.dialog, { backgroundColor: props.theme.background }]}>
          <PanelContent {...props} onClose={close} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView></SafeAreaProvider>
  </Modal>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 }, overlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  dialog: { width: '100%', maxWidth: 520, height: '80%', borderRadius: 24, overflow: 'hidden' },
});
