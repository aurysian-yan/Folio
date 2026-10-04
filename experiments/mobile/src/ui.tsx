import { Children, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, PlatformColor, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { NativeActionButton, usesNativeControls } from './native-controls';
import type { AccentId } from './settings';
import { headerShadowColor, useHeaderShadowProgress } from './HeaderButtonShadow';

// 原生系统背景随浅深色及窗口层级自动变化。
const systemBackground = Platform.OS === 'ios' ? PlatformColor('systemBackground') : undefined;

// 移动端语义色与设计稿尺寸。
export const themes = {
  light: {
    dark: false,
    background: systemBackground ?? '#FFFFFF', onAccent: '#FFFFFF', surface: '#EFEFEF', raised: '#FFFFFF', label: '#1A1A1A',
    secondary: '#727272', muted: '#999999', border: '#E4E4E4', accent: '#F06835',
    backButtonBorder: '#E4E4E4',
    selection: 'rgba(240, 104, 53, 0.2)', tab: '#F7F7F7', activeTab: '#E6E6E6',
    switchTrack: '#D8D8DC', switchThumb: '#FFFFFF',
    buttonPressed: '#FFFFFF', buttonPressedLabel: '#1A1A1A',
    listCardSurface: '#D8D8D8', listCardBorder: 'rgba(0, 0, 0, 0.1)',
    scrim: 'rgba(0, 0, 0, 0.16)', shadow: '#000000', danger: '#C62828',
  },
  dark: {
    dark: true,
    background: systemBackground ?? '#121212', onAccent: '#121212', surface: '#242424', raised: '#2C2C2E', label: '#F2F2F2',
    secondary: '#AEAEAE', muted: '#8E8E93', border: '#38383A', accent: '#FF8758',
    backButtonBorder: '#38383A',
    selection: 'rgba(255, 135, 88, 0.25)', tab: '#202020', activeTab: '#38383A',
    switchTrack: '#606064', switchThumb: '#FFFFFF',
    buttonPressed: '#38383A', buttonPressedLabel: '#F2F2F2',
    listCardSurface: '#242424', listCardBorder: 'rgba(255, 255, 255, 0.1)',
    scrim: 'rgba(0, 0, 0, 0.48)', shadow: '#000000', danger: '#FF8A80',
  },
};

export type Theme = typeof themes.light;

// 安卓浅色使用灰底白卡，深色使用黑底灰卡。
const androidColors = {
  light: {
    background: '#F3F3F3', surface: '#FFFFFF', raised: '#EDEDED', label: '#000000',
    secondary: '#666666', backButtonBorder: '#CCCCCC',
    listCardSurface: '#FFFFFF', listCardBorder: 'rgba(0, 0, 0, 0.06)',
  },
  dark: {
    background: '#000000', surface: '#242424', raised: '#303030', label: '#F4F4F4',
    secondary: '#929292', muted: '#8C8C8C', border: '#363636',
    listCardSurface: '#242424', listCardBorder: 'rgba(255, 255, 255, 0.08)',
  },
};

// 外观页可选主题色，浅深色各自使用对应色值。
export const accentPresets: Record<AccentId, { light: string; dark: string }> = {
  folio: { light: '#F06835', dark: '#FF8758' },
  blue: { light: '#0A84FF', dark: '#4CA6FF' },
  green: { light: '#2FA84F', dark: '#4CD07A' },
  purple: { light: '#8E5CF7', dark: '#B18CFF' },
};

function withAlpha(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

// 按平台、浅深色与主题色派生界面语义色。
export function createTheme(dark: boolean, accent: AccentId): Theme {
  const base = dark ? themes.dark : themes.light;
  const accentValue = accentPresets[accent][dark ? 'dark' : 'light'];
  return { ...base, ...(Platform.OS === 'android' ? androidColors[dark ? 'dark' : 'light'] : {}),
    accent: accentValue, selection: withAlpha(accentValue, dark ? 0.25 : 0.2) };
}

export function IconButton({ label, onPress, children, theme, disabled, busy, selected, style, systemImage, primary = false }: {
  label: string;
  onPress: () => void;
  children: ReactNode;
  theme: Theme;
  disabled?: boolean;
  busy?: boolean;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
  systemImage?: string;
  primary?: boolean;
}) {
  const shadowProgress = useHeaderShadowProgress();
  const [pressScale] = useState(() => new Animated.Value(1));
  const [dragTranslation] = useState(() => new Animated.ValueXY());
  const [dragStretch] = useState(() => new Animated.ValueXY());
  const [buttonSize, setButtonSize] = useState({ width: 44, height: 44 });
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const draggable = Platform.OS === 'android' && systemImage === 'chevron.left';
  const lightBackButton = draggable && !theme.dark;
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    if (disabled || reduceMotion) {
      pressScale.stopAnimation(); pressScale.setValue(1);
      dragTranslation.stopAnimation(); dragTranslation.setValue({ x: 0, y: 0 });
      dragStretch.stopAnimation(); dragStretch.setValue({ x: 0, y: 0 });
    }
    return () => { pressScale.stopAnimation(); dragTranslation.stopAnimation(); dragStretch.stopAnimation(); };
  }, [disabled, reduceMotion, pressScale, dragTranslation, dragStretch]);
  const animatePress = useCallback((pressed: boolean) => {
    if (disabled || reduceMotion) return;
    Animated.spring(pressScale, { toValue: pressed ? 1.12 : 1,
      stiffness: 360, damping: 14, mass: 1, overshootClamping: false,
      useNativeDriver: true }).start();
  }, [disabled, reduceMotion, pressScale]);
  // 返回按钮沿用原生操作区的位移、形变比例与拖动取消点击。
  const finishDrag = useCallback(() => {
    setDragging(false);
    animatePress(false);
    if (disabled || reduceMotion) {
      dragTranslation.setValue({ x: 0, y: 0 });
      dragStretch.setValue({ x: 0, y: 0 });
      return;
    }
    const spring = { toValue: { x: 0, y: 0 }, stiffness: 300, damping: 17, mass: 1, useNativeDriver: true };
    Animated.parallel([Animated.spring(dragTranslation, spring), Animated.spring(dragStretch, spring)]).start();
  }, [disabled, reduceMotion, animatePress, dragTranslation, dragStretch]);
  const beginDrag = useCallback(() => {
    setDragging(true);
    dragTranslation.stopAnimation(); dragStretch.stopAnimation();
    animatePress(true);
  }, [animatePress, dragTranslation, dragStretch]);
  const dragResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      draggable && !disabled && !reduceMotion && Math.hypot(gesture.dx, gesture.dy) > 8,
    onPanResponderGrant: beginDrag,
    onPanResponderMove: (_event, { dx, dy }) => {
      const width = Math.max(1, buttonSize.width);
      const height = Math.max(1, buttonSize.height);
      const limit = Math.min(width, height);
      dragTranslation.setValue({ x: limit * Math.tanh(0.05 * dx / limit), y: limit * Math.tanh(0.05 * dy / limit) });
      dragStretch.setValue({ x: 4 / height * Math.min(1, Math.abs(dx) / width), y: 4 / height * Math.min(1, Math.abs(dy) / height) });
    },
    onPanResponderRelease: finishDrag,
    onPanResponderTerminate: finishDrag,
    onPanResponderTerminationRequest: () => true,
  }), [draggable, disabled, reduceMotion, buttonSize, beginDrag, finishDrag, dragTranslation, dragStretch]);
  const scaleX = useMemo(() => Animated.add(pressScale, dragStretch.x), [pressScale, dragStretch]);
  const scaleY = useMemo(() => Animated.add(pressScale, dragStretch.y), [pressScale, dragStretch]);
  const activeDrag = dragging && !disabled && !reduceMotion;
  if (usesNativeControls && systemImage) {
    const size = StyleSheet.flatten(style)?.minWidth;
    return <NativeActionButton label={label} systemImage={systemImage} onPress={onPress}
      disabled={disabled} color={primary || selected ? theme.accent : theme.label} foregroundColor={primary ? theme.onAccent : undefined} prominent={primary} iconOnly
      diameter={typeof size === 'number' ? Math.max(32, size) : 44} shadowColor={headerShadowColor(theme, shadowProgress)} />;
  }
  return (
    <Animated.View {...(draggable ? {
      ...dragResponder.panHandlers,
      onResponderGrant: (event) => {
        draggingRef.current = true;
        return dragResponder.panHandlers.onResponderGrant?.(event);
      },
      onResponderRelease: (event) => {
        draggingRef.current = false;
        dragResponder.panHandlers.onResponderRelease?.(event);
      },
      onResponderTerminate: (event) => {
        draggingRef.current = false;
        dragResponder.panHandlers.onResponderTerminate?.(event);
      },
    } : {})}
      onLayout={({ nativeEvent: { layout } }) => setButtonSize((previous) => previous.width === layout.width && previous.height === layout.height
        ? previous : { width: layout.width, height: layout.height })}
      style={{ transform: [{ translateX: dragTranslation.x }, { translateY: dragTranslation.y }, { scaleX }, { scaleY }], transformOrigin: 'center' }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: !!disabled, selected: !!selected, busy: !!busy }}
        disabled={disabled} onPress={onPress} onPressIn={() => animatePress(true)}
        onPressOut={() => { if (!draggingRef.current) animatePress(false); }} hitSlop={8}
        style={({ pressed }) => [styles.iconButton, {
          backgroundColor: (pressed || activeDrag) && !disabled ? theme.buttonPressed
            : primary ? theme.accent : lightBackButton ? theme.surface : theme.tab,
          borderColor: primary ? theme.accent : lightBackButton ? theme.backButtonBorder : theme.border,
          opacity: disabled ? 0.4 : 1,
        }, style, { boxShadow: [{ offsetX: 0, offsetY: 2, blurRadius: 32,
          color: headerShadowColor(theme, shadowProgress, (pressed || activeDrag) && !disabled) }] }]}>
        {({ pressed }) => <View pointerEvents="none" style={styles.iconContent}>
          {(pressed || activeDrag) && !disabled ? Children.map(children, (child) =>
            isValidElement<{ color?: string }>(child) && 'color' in child.props
              ? cloneElement(child, { color: theme.buttonPressedLabel }) : child) : children}
        </View>}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  iconContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  iconButton: {
    minWidth: 44, minHeight: 44, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth * 1.2,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4,
  },
});
