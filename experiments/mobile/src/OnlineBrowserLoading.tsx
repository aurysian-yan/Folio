import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Motion, {
  cancelAnimation, Easing, ReduceMotion, useAnimatedProps, useAnimatedStyle, useReducedMotion,
  useSharedValue, withRepeat, withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import Svg, { Circle, Path } from 'react-native-svg';
import { OnlineSourceIcon } from './OnlineSourceIcon';
import type { OnlineProvider } from './online';
import type { Theme } from './ui';

const AnimatedCircle = Motion.createAnimatedComponent(Circle);
const AnimatedPath = Motion.createAnimatedComponent(Path);
const ringSize = 72;
const ringRadius = 34;
const circumference = 2 * Math.PI * ringRadius;

// 加载遮罩持续覆盖原生网页，就绪后从来源图标中心展开圆形窗口。
export function OnlineBrowserLoading({ loading, failed, active, revealRequest, provider, theme, hint }: {
  loading: boolean; failed: boolean; active: boolean; revealRequest: string; provider: OnlineProvider | null; theme: Theme;
  hint?: string | null;
}) {
  const { t } = useTranslation();
  const initialReduceMotion = useReducedMotion();
  const [reduceMotion, setReduceMotion] = useState(initialReduceMotion);
  const [presentation, setPresentation] = useState({ loading, visible: loading });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const reveal = useSharedValue(0);
  const rotation = useSharedValue(0);
  const revision = useRef(0);
  const consumedRequest = useRef('');
  const revealingRequest = useRef('');
  if (presentation.loading !== loading || (!loading && failed && presentation.visible)) {
    setPresentation({ loading, visible: loading || (!failed && presentation.visible) });
  }
  const visible = loading || (!failed && presentation.visible);
  const centerX = size.width / 2;
  const centerY = Math.max(ringSize / 2, size.height / 2 - 32);
  const radius = Math.hypot(centerX, Math.max(centerY, size.height - centerY)) + 1;
  const finishReveal = useCallback((value: number) => {
    if (revision.current !== value) return;
    revealingRequest.current = '';
    setPresentation((state) => state.loading ? state : { ...state, visible: false });
  }, []);

  useEffect(() => {
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    const current = ++revision.current;
    cancelAnimation(reveal);
    if (loading) {
      revealingRequest.current = '';
      reveal.set(0);
    } else if (!failed && visible && active && size.width > 0 && size.height > 0) {
      // 顶部来源切换只消费一次动画请求，站内跳转不重新授权。
      const animate = revealRequest !== ''
        && (revealRequest !== consumedRequest.current || revealingRequest.current === revealRequest);
      if (animate) {
        consumedRequest.current = revealRequest;
        revealingRequest.current = revealRequest;
      }
      reveal.set(withTiming(1, {
        duration: animate && !reduceMotion ? 620 : 0,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        reduceMotion: ReduceMotion.System,
      }, (finished) => { if (finished) scheduleOnRN(finishReveal, current); }));
    }
    return () => { cancelAnimation(reveal); };
  }, [active, failed, finishReveal, loading, reduceMotion, reveal, revealRequest, size.height, size.width, visible]);

  useEffect(() => {
    if (visible && loading && active && !reduceMotion) {
      rotation.set(0);
      rotation.set(withRepeat(withTiming(1, {
        duration: 1800, easing: Easing.linear, reduceMotion: ReduceMotion.System,
      }), -1, false));
    } else {
      cancelAnimation(rotation);
    }
    return () => { cancelAnimation(rotation); };
  }, [active, loading, reduceMotion, rotation, visible]);

  const ring = useAnimatedProps(() => {
    const length = circumference * (0.12 + 0.58 * (1 - Math.cos(rotation.value * Math.PI * 2)) / 2);
    return { strokeDasharray: [length, circumference - length], strokeDashoffset: -circumference * rotation.value * 2 };
  });
  const cover = useAnimatedProps(() => {
    const r = loading ? 0.001 : Math.max(0.001, reveal.value * radius);
    return { d: `M0 0H${size.width}V${size.height}H0Z M${centerX - r} ${centerY}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z` };
  });
  const foreground = useAnimatedStyle(() => ({ opacity: loading ? 1 : Math.max(0, 1 - reveal.value * 5) }));

  if (!visible && !loading) return null;
  const label = [t('common.loading'), provider?.name, hint].filter(Boolean).join('，');
  return <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="box-only" onStartShouldSetResponder={() => true}
    accessible accessibilityRole="progressbar"
    accessibilityLabel={label} accessibilityState={{ busy: true }}
    onLayout={({ nativeEvent }) => {
      const { width, height } = nativeEvent.layout;
      setSize((value) => value.width === width && value.height === height ? value : { width, height });
    }}>
    {size.width > 0 ? <Svg width={size.width} height={size.height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <AnimatedPath fill={theme.background} fillRule="evenodd" animatedProps={cover} />
    </Svg> : <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]} />}
    <Motion.View pointerEvents="none" style={[styles.emblem, { left: centerX - ringSize / 2, top: centerY - ringSize / 2 }, foreground]}>
      <Svg width={ringSize} height={ringSize} style={StyleSheet.absoluteFill}>
        <Circle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} stroke={theme.border} strokeWidth={2} fill="none" />
        <AnimatedCircle cx={ringSize / 2} cy={ringSize / 2} r={ringRadius} stroke={theme.accent}
          strokeWidth={2} strokeLinecap="round" fill="none" animatedProps={ring} />
      </Svg>
      <OnlineSourceIcon provider={provider} theme={theme} size={48} />
    </Motion.View>
    <Motion.View pointerEvents="none" style={[styles.title, { top: centerY + ringSize / 2 + 24 }, foreground]}>
      <Text numberOfLines={2} style={[styles.name, { color: theme.label }]}>{provider?.name || t('online.title')}</Text>
      {hint ? <Text style={[styles.hint, { color: theme.secondary }]}>{hint}</Text> : null}
    </Motion.View>
  </View>;
}

const styles = StyleSheet.create({
  overlay: { zIndex: 2 },
  emblem: { position: 'absolute', width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' },
  title: { position: 'absolute', left: 16, right: 16 },
  name: { fontSize: 18, lineHeight: 26, textAlign: 'center', fontWeight: '500' },
  hint: { marginTop: 6, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
