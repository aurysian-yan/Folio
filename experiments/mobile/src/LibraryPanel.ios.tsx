import { BottomSheet, Group, Host, RNHostView } from '@expo/ui/swift-ui';
import { interactiveDismissDisabled, presentationDetents } from '@expo/ui/swift-ui/modifiers';
import { StyleSheet } from 'react-native';
import { PanelBody, type LibraryPanelProps } from './panel-content';

// iOS 面板使用系统 Sheet，并保留系统拖动关闭行为。
export function LibraryPanel(props: LibraryPanelProps) {
  return <Host style={styles.anchor}>
    <BottomSheet isPresented={props.visible} onIsPresentedChange={(presented) => {
      if (!presented && !props.busy) props.onClose();
    }}>
      <Group modifiers={[presentationDetents(['large']), interactiveDismissDisabled(!!props.busy)]}>
        <RNHostView><PanelBody {...props} /></RNHostView>
      </Group>
    </BottomSheet>
  </Host>;
}

const styles = StyleSheet.create({ anchor: { position: 'absolute', width: 0, height: 0 } });
