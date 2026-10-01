import type { ReactNode } from 'react';
import { Platform, PlatformColor, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { NativeActionButton, usesNativeControls } from './native-controls';

// 原生系统背景随浅深色及窗口层级自动变化。
const systemBackground = Platform.OS === 'ios' ? PlatformColor('systemBackground') : undefined;

// 移动端语义色与设计稿尺寸。
export const themes = {
  light: {
    background: systemBackground ?? '#FFFFFF', onAccent: '#FFFFFF', surface: '#EFEFEF', raised: '#FFFFFF', label: '#1A1A1A',
    secondary: '#727272', muted: '#999999', border: '#E4E4E4', accent: '#0088FF',
    selection: '#C9E6FF', tab: '#F7F7F7', activeTab: '#E6E6E6',
    listCardSurface: '#D8D8D8', listCardBorder: 'rgba(0, 0, 0, 0.1)',
    scrim: 'rgba(0, 0, 0, 0.16)', danger: '#C62828',
  },
  dark: {
    background: systemBackground ?? '#121212', onAccent: '#121212', surface: '#242424', raised: '#2C2C2E', label: '#F2F2F2',
    secondary: '#AEAEAE', muted: '#8E8E93', border: '#38383A', accent: '#64B5FF',
    selection: '#173F60', tab: '#202020', activeTab: '#38383A',
    listCardSurface: '#242424', listCardBorder: 'rgba(255, 255, 255, 0.1)',
    scrim: 'rgba(0, 0, 0, 0.48)', danger: '#FF8A80',
  },
};

export type Theme = typeof themes.light;

export function IconButton({ label, onPress, children, theme, disabled, busy, selected, style, systemImage }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  theme: Theme;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  systemImage?: string;
}) {
  if (usesNativeControls && systemImage) {
    const size = StyleSheet.flatten(style)?.minWidth;
    return <NativeActionButton label={label} systemImage={systemImage} onPress={onPress}
      disabled={disabled} color={selected ? theme.accent : theme.label} iconOnly
      diameter={typeof size === 'number' ? Math.max(32, size) : 44} />;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, selected: !!selected, busy: !!busy }}
      disabled={disabled} onPress={onPress} hitSlop={8}
      style={({ pressed }) => [styles.iconButton, {
        backgroundColor: theme.tab, borderColor: theme.border,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      }, style]}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  iconButton: {
    minWidth: 44, minHeight: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4,
  },
});
