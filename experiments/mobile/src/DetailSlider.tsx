import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { clampAxisValue, snapAxisValue } from './font-details';
import { settingsLayout, settingsTypography } from './settings-ui';
import type { Theme } from './ui';

const thumbSize = 28;
const trackHeight = 6;
const touchHeight = 44;

// 滑块只接管横向拖动，纵向手势由页面滚动处理。
export function DetailSlider({ label, value, minimum, maximum, step, formatValue, onChange, theme, accessibilityLabel }: {
  label: string; value: number; minimum: number; maximum: number; step: number;
  formatValue: (value: number) => string; onChange: (value: number) => void; theme: Theme; accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  const inputs = useRef({ width, minimum, maximum, step, onChange });
  const touch = useRef({ x: 0, y: 0, origin: 0 });
  useLayoutEffect(() => { inputs.current = { width, minimum, maximum, step, onChange }; }, [width, minimum, maximum, step, onChange]);
  const range = Math.max(0, maximum - minimum);
  const fraction = range > 0 ? clampAxisValue((value - minimum) / range, 0, 1) : 0;
  const trackWidth = Math.max(0, width - thumbSize);
  const center = thumbSize / 2 + fraction * trackWidth;
  const display = formatValue(value);

  function handlePosition(pageX: number) {
    const input = inputs.current;
    const available = input.width - thumbSize;
    if (available <= 0) return;
    const nextFraction = Math.min(1, Math.max(0, (pageX - touch.current.origin - thumbSize / 2) / available));
    input.onChange(snapAxisValue(input.minimum + nextFraction * (input.maximum - input.minimum),
      input.minimum, input.maximum, input.step));
  }

  // 仅注册手势回调，ref 在触摸事件中读取。
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderGrant: (event) => handlePosition(event.nativeEvent.pageX),
    onPanResponderMove: (_event, gesture) => handlePosition(gesture.moveX),
    onPanResponderTerminationRequest: () => true,
  }), []);

  return <View style={styles.container}>
    <View style={styles.header}>
      <Text style={[styles.label, { color: theme.label }]}>{label}</Text>
      <Text style={[styles.value, { color: theme.secondary }]}>{display}</Text>
    </View>
    <View style={styles.touchArea} onLayout={(event) => setWidth(event.nativeEvent.layout.width)} accessible
      accessibilityRole="adjustable" accessibilityLabel={accessibilityLabel ?? label}
      accessibilityValue={{ min: minimum, max: maximum, now: value, text: display }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => onChange(snapAxisValue(value + (event.nativeEvent.actionName === 'increment' ? step : -step), minimum, maximum, step))}
      onTouchStart={(event) => {
        const { pageX, pageY, locationX } = event.nativeEvent;
        touch.current = { x: pageX, y: pageY, origin: pageX - locationX };
      }}
      onTouchEnd={(event) => {
        if (Math.hypot(event.nativeEvent.pageX - touch.current.x, event.nativeEvent.pageY - touch.current.y) < 8) handlePosition(event.nativeEvent.pageX);
      }} {...responder.panHandlers}>
      <View pointerEvents="none" style={[styles.track, { backgroundColor: theme.border }]} />
      <View pointerEvents="none" style={[styles.fill, { width: fraction * trackWidth, backgroundColor: theme.accent }]} />
      <View pointerEvents="none" style={[styles.thumb, { left: center - thumbSize / 2, backgroundColor: theme.switchThumb, shadowColor: theme.shadow }]} />
    </View>
    <View style={styles.footer}>
      <Text style={[styles.bound, { color: theme.secondary }]}>{formatValue(minimum)}</Text>
      <Text style={[styles.bound, { color: theme.secondary }]}>{formatValue(maximum)}</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  container: { ...settingsLayout.row, gap: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { ...settingsTypography.body, flex: 1 },
  value: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
  touchArea: { height: touchHeight, justifyContent: 'center' },
  track: { height: trackHeight, borderRadius: trackHeight / 2, marginHorizontal: thumbSize / 2 },
  fill: { position: 'absolute', left: thumbSize / 2, height: trackHeight, borderRadius: trackHeight / 2 },
  thumb: { position: 'absolute', top: (touchHeight - thumbSize) / 2, width: thumbSize, height: thumbSize,
    borderRadius: thumbSize / 2, shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: thumbSize / 2 },
  bound: { ...settingsTypography.detail, fontVariant: ['tabular-nums'] },
});
