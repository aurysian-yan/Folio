import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import { interactiveDismissDisabled, presentationDetents, presentationDragIndicator } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';
import { PanelBody, type LibraryPanelProps } from './panel-content';

// 系统两档 Sheet 保留半屏玻璃材质与原生展开、关闭行为。
export function LibraryPanel(props: LibraryPanelProps) {
  return <Host style={styles.anchor}>
    <BottomSheet isPresented={props.visible} onIsPresentedChange={(presented) => {
      if (!presented && !props.busy) props.onClose();
    }}>
      <Group modifiers={[presentationDetents(['medium', 'large']), presentationDragIndicator('visible'), interactiveDismissDisabled(!!props.busy)]}>
        <RNHostView><PanelBody {...props} /></RNHostView>
      </Group>
    </BottomSheet>
  </Host>;
}

const styles = StyleSheet.create({ anchor: { position: 'absolute', width: 0, height: 0 } });
