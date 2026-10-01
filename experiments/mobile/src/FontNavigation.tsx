import { requireNativeView } from 'expo';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import type { Theme } from './ui';

export interface FontNavigationProps {
  children: ReactNode;
  detail: ReactNode | null;
  visible: boolean;
  theme: Theme;
  onDismissed: () => void;
}

interface NativeStackProps extends ViewProps {
  visible: boolean;
  onDismissed: () => void;
}

const NativeStack = requireNativeView<NativeStackProps>('FolioNavigation', 'FolioFontStackView');

// 安卓返回进度与转场由原生容器处理，上一页保持挂载。
export function FontNavigation({ children, detail, visible, theme, onDismissed }: FontNavigationProps) {
  return <NativeStack visible={visible} onDismissed={onDismissed}
    style={[styles.stack, { backgroundColor: theme.background }]}>
    <View collapsable={false} pointerEvents={detail ? 'none' : 'auto'} style={StyleSheet.absoluteFill}>
      {children}
    </View>
    {detail && <View collapsable={false} style={StyleSheet.absoluteFill}>{detail}</View>}
  </NativeStack>;
}

const styles = StyleSheet.create({ stack: { flex: 1 } });
