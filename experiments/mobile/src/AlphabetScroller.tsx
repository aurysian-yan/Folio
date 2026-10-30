import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Motion, { Easing, runOnJS, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { alphabetDragGroup, alphabetGroupAt, alphabetGroupCenter, type AlphabetGroup } from './alphabet-index';
import { CaretUpIcon, CaretDownIcon } from './icons';
import { monoFont } from './mono-font';
import { PanelBackdrop } from './PanelBackdrop';
import type { Theme } from './ui';

const thumbHeight = 48;
const thumbWidth = 20;
const thumbRight = 10;
const inset = 8;
const spring = { damping: 20, stiffness: 260 };

// 手势仅覆盖右侧轨道；卡片和列表共享同一个手势根容器。
export function AlphabetScroller({ groups, index, pageProgress, pageScrolling, height, top, right, theme, sourceId, reduceMotion, onSelect, onEditing }: {
  groups: AlphabetGroup[]; index: number; pageProgress: SharedValue<number>; pageScrolling: SharedValue<boolean>; height: number; top: number; right: number;
  theme: Theme; sourceId: string; reduceMotion: boolean;
  onSelect: (index: number) => void; onEditing: (editing: boolean) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState(0);
  const dragging = useSharedValue(false);
  const finger = useSharedValue(0);
  const currentGroup = useSharedValue(0);
  const press = useSharedValue(0);
  const deformation = useSharedValue(0);
  const usableHeight = Math.max(1, height - inset * 2);
  const current = alphabetGroupAt(groups, index);
  const select = (group: number) => { setSelected(group); onSelect(groups[group]!.index); };
  const start = (group: number) => { setExpanded(true); onEditing(true); select(group); };
  const finish = () => { setExpanded(false); onEditing(false); };
  const gesture = Gesture.Pan().minDistance(0).shouldCancelWhenOutside(false)
    .onStart((event) => {
      dragging.value = true;
      finger.value = Math.max(0, Math.min(usableHeight, event.y - inset));
      currentGroup.value = alphabetDragGroup(finger.value, usableHeight, groups.length);
      press.value = reduceMotion ? 0 : withSpring(1, spring);
      runOnJS(start)(currentGroup.value);
    }).onUpdate((event) => {
      const y = event.y - inset;
      finger.value = Math.max(0, Math.min(usableHeight, y));
      if (!reduceMotion) {
        const overflow = y - finger.value;
        deformation.value = Math.max(-1, Math.min(1, event.velocityY / 1600 + overflow / 40));
      }
      const group = alphabetDragGroup(y, usableHeight, groups.length);
      if (group !== currentGroup.value) { currentGroup.value = group; runOnJS(select)(group); }
    }).onFinalize(() => {
      dragging.value = false;
      press.value = reduceMotion ? 0 : withSpring(0, spring);
      deformation.value = reduceMotion ? 0 : withSpring(0, spring);
      runOnJS(finish)();
    });
  const center = useDerivedValue(() => {
    const target = dragging.value ? inset + finger.value
      : inset + thumbHeight / 2 + pageProgress.value * Math.max(0, usableHeight - thumbHeight);
    return dragging.value || reduceMotion ? target : withSpring(target, { damping: 30, stiffness: 320 });
  });
  const tucked = useDerivedValue(() => {
    if (dragging.value || reduceMotion) return 0;
    return withTiming(pageScrolling.value ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
  });
  const thumbStyle = useAnimatedStyle(() => {
    const stretch = Math.abs(deformation.value);
    const drawnHeight = thumbHeight + press.value * 10 + stretch * 8;
    return {
      top: Math.max(thumbHeight / 2 + inset, Math.min(height - thumbHeight / 2 - inset, center.value)) - drawnHeight / 2,
      width: thumbWidth + press.value * 14 - stretch * 2, height: drawnHeight,
      right: thumbRight - press.value * 5 + stretch,
      transform: [{ translateX: tucked.value * (right + thumbRight + thumbWidth / 2) }],
    };
  });
  const bubbleStyle = useAnimatedStyle(() => ({
    top: Math.max(0, Math.min(height - 60, inset + finger.value - 30)),
  }));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') return;
      dragging.value = false; press.value = 0; deformation.value = 0;
      setExpanded(false); onEditing(false);
    });
    return () => { subscription.remove(); onEditing(false); };
  }, [dragging, press, deformation, onEditing]);
  const label = groups[expanded ? selected : current]?.label ?? '#';
  const labelStep = Math.max(1, Math.ceil(groups.length * 16 / usableHeight));
  return <GestureDetector gesture={gesture}>
    <View collapsable={false} accessible accessibilityRole="adjustable" accessibilityLabel={t('mobile.alphabetIndex.label')}
      accessibilityHint={t('mobile.alphabetIndex.hint')} accessibilityValue={{ text: label, min: 1, max: groups.length, now: (expanded ? selected : current) + 1 }}
      accessibilityActions={[{ name: 'increment', label: t('mobile.alphabetIndex.next') }, { name: 'decrement', label: t('mobile.alphabetIndex.previous') }]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (!['increment', 'decrement'].includes(nativeEvent.actionName)) return;
        const next = Math.max(0, Math.min(groups.length - 1, current + (nativeEvent.actionName === 'increment' ? 1 : -1)));
        onSelect(groups[next]!.index);
      }} style={[styles.container, { top, right, height }]}>
      {expanded && <>
        <View pointerEvents="none" style={styles.track}>
          <PanelBackdrop navigationGlass continuousCapsule theme={theme} sourceId={sourceId} cornerRadius={999} style={StyleSheet.absoluteFill} />
        </View>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          {groups.map((group, i) => <Text key={group.label} accessible={false} style={[styles.letter, {
            top: inset + alphabetGroupCenter(i, usableHeight, groups.length) - 7,
            color: theme.label, opacity: i !== selected && (i % labelStep === 0 || i === groups.length - 1) ? 1 : 0,
          }]}>{group.label}</Text>)}
        </View>
        <Motion.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
          <PanelBackdrop navigationGlass continuousCapsule blurRadius={24} theme={theme} sourceId={sourceId} cornerRadius={999} style={StyleSheet.absoluteFill} />
          <Text accessible={false} style={[styles.bubbleText, { color: theme.label }]}>{label}</Text>
        </Motion.View>
      </>}
      <Motion.View pointerEvents="none" style={[styles.thumb, thumbStyle]}>
        {expanded ? <PanelBackdrop navigationGlass continuousCapsule liquid blurRadius={0.5}
          theme={theme} sourceId={sourceId} cornerRadius={999} style={StyleSheet.absoluteFill} />
          : <View style={[styles.collapsedSurface, { backgroundColor: theme.buttonSurface, borderColor: theme.border }]} />}
        {expanded ? <Text accessible={false} style={[styles.thumbLabel, { color: theme.accent }]}>{label}</Text> : <View>
          <CaretUpIcon size={12} color={theme.label} weight="fill" />
          <CaretDownIcon size={12} color={theme.label} weight="fill" />
        </View>}
      </Motion.View>
    </View>
  </GestureDetector>;
}

const styles = StyleSheet.create({
  container: { position: 'absolute', width: 44, zIndex: 3 },
  thumb: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', top: inset, bottom: inset, width: 18, right: 13 },
  collapsedSurface: { ...StyleSheet.absoluteFill, borderRadius: 999, borderCurve: 'continuous', borderWidth: StyleSheet.hairlineWidth, opacity: 0.75 },
  letter: { ...monoFont, position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 10, lineHeight: 14, fontWeight: '600' },
  bubble: { position: 'absolute', right: 52, width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  bubbleText: { ...monoFont, fontSize: 31, fontWeight: '600' },
  thumbLabel: { ...monoFont, fontSize: 13, fontWeight: '600' },
});
