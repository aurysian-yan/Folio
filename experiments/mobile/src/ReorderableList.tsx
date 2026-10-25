import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type ScrollView } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ArrowsVerticalIcon } from './icons';
import { reorderTo } from './reorder';
import type { Theme } from './ui';

interface ScrollPort { offset: number; drag: (y: number | null) => void }
export const ReorderScrollContext = createContext<ScrollPort>({ offset: 0, drag: () => {} });

// 拖动到滚动容器边缘时连续滚动，松手和卸载均停止。
export function useReorderScroll(ref: RefObject<ScrollView | null>) {
  const [offset, setOffset] = useState(0);
  const currentOffset = useRef(0);
  const pointer = useRef<number | null>(null);
  const viewport = useRef({ top: 0, bottom: 0 });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; }, []);
  useEffect(() => stop, [stop]);
  const drag = useCallback((y: number | null) => {
    pointer.current = y;
    if (y === null) { stop(); return; }
    if (timer.current) return;
    ref.current?.getNativeScrollRef()?.measureInWindow((_x, top, _width, height) => { viewport.current = { top, bottom: top + height }; });
    timer.current = setInterval(() => {
      const y = pointer.current;
      if (y === null) return;
      const { top, bottom } = viewport.current;
      const speed = y < top + 64 ? -Math.min(14, (top + 64 - y) / 4) : y > bottom - 64 ? Math.min(14, (y - bottom + 64) / 4) : 0;
      if (speed) ref.current?.scrollTo({ y: Math.max(0, currentOffset.current + speed), animated: false });
    }, 16);
  }, [ref, stop]);
  const onScroll = useCallback((y: number) => { currentOffset.current = y; setOffset(y); }, []);
  return { value: { offset, drag }, onScroll };
}

interface Layout { y: number; height: number }
interface Drag { id: string; dy: number; initialOffset: number; target: number }
export function ReorderableList<T extends { id: string }>({ items, onChange, renderItem, theme, enabled = true, label }: {
  items: T[]; onChange: (items: T[]) => void; renderItem: (item: T, handle: ReactNode) => ReactNode;
  theme: Theme; enabled?: boolean; label: (item: T) => string;
}) {
  const { t } = useTranslation();
  const port = useContext(ReorderScrollContext);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [layouts, setLayouts] = useState(new Map<string, Layout>());
  const latest = useRef({ items, port, onChange, drag, layouts });
  useLayoutEffect(() => { latest.current = { items, port, onChange, drag, layouts }; }, [items, port, onChange, drag, layouts]);
  useEffect(() => () => latest.current.port.drag(null), []);
  const targetFor = (id: string, dy: number, initialOffset: number) => {
    const { items, port, layouts } = latest.current;
    const source = layouts.get(id);
    if (!source) return items.findIndex((item) => item.id === id);
    const center = source.y + source.height / 2 + dy + port.offset - initialOffset;
    let target = 0;
    for (const item of items) {
      const layout = layouts.get(item.id);
      if (item.id !== id && layout && center > layout.y + layout.height / 2) target += 1;
    }
    return target;
  };
  const activeSource = drag ? layouts.get(drag.id) : null;
  const activeCenter = drag && activeSource ? activeSource.y + activeSource.height / 2 + drag.dy + port.offset - drag.initialOffset : 0;
  const activeTarget = drag ? items.filter((item) => item.id !== drag.id && layouts.has(item.id) && activeCenter > layouts.get(item.id)!.y + layouts.get(item.id)!.height / 2).length : 0;
  const activeDrag = drag ? { ...drag, target: activeTarget } : null;
  const ordered = activeDrag ? reorderTo(items, activeDrag.id, activeDrag.target) : items;
  let nextY = 0;
  const positions = new Map<string, number>();
  for (const item of ordered) { positions.set(item.id, nextY); nextY += layouts.get(item.id)?.height ?? 0; }
  return <View>{items.map((item, index) => {
    const source = layouts.get(item.id);
    const translation = activeDrag ? activeDrag.id === item.id ? activeDrag.dy + port.offset - activeDrag.initialOffset
      : (positions.get(item.id) ?? source?.y ?? 0) - (source?.y ?? 0) : 0;
    const handle = enabled ? <DragHandle label={label(item)} theme={theme}
      onBegin={() => setDrag({ id: item.id, dy: 0, initialOffset: latest.current.port.offset, target: index })}
      onMove={(dy, y) => { latest.current.port.drag(y); setDrag((value) => value ? { ...value, dy } : null); }}
      onEnd={(cancelled) => {
        const value = latest.current.drag;
        latest.current.port.drag(null);
        if (value && !cancelled) latest.current.onChange(reorderTo(latest.current.items, item.id, targetFor(item.id, value.dy, value.initialOffset)));
        setDrag(null);
      }}
      onAccessibilityMove={(direction) => onChange(reorderTo(items, item.id, index + direction))}
      hint={t('browser.dragToReorder')} /> : null;
    return <View key={item.id} onLayout={({ nativeEvent: { layout } }) => setLayouts((values) => {
      const previous = values.get(item.id);
      return previous?.y === layout.y && previous.height === layout.height ? values : new Map(values).set(item.id, layout);
    })}
      style={{ transform: [{ translateY: translation }], zIndex: activeDrag?.id === item.id ? 1 : 0, opacity: activeDrag && activeDrag.id !== item.id ? 0.7 : 1 }}>
      {renderItem(item, handle)}
    </View>;
  })}</View>;
}
function DragHandle({ label, hint, theme, onBegin, onMove, onEnd, onAccessibilityMove }: {
  label: string; hint: string; theme: Theme; onBegin: () => void; onMove: (dy: number, y: number) => void; onEnd: (cancelled: boolean) => void; onAccessibilityMove: (direction: number) => void;
}) {
  const { t } = useTranslation();
  const latest = useRef({ onBegin, onMove, onEnd });
  useLayoutEffect(() => { latest.current = { onBegin, onMove, onEnd }; }, [onBegin, onMove, onEnd]);
  const begin = useCallback(() => latest.current.onBegin(), []);
  const move = useCallback((dy: number, y: number) => latest.current.onMove(dy, y), []);
  const end = useCallback((cancelled: boolean) => latest.current.onEnd(cancelled), []);
  // 手势构造器只登记回调，不在渲染期执行。
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: begin,
    onPanResponderMove: (_event, gesture) => move(gesture.dy, gesture.moveY),
    onPanResponderRelease: () => end(false),
    onPanResponderTerminate: () => end(true),
    onPanResponderTerminationRequest: () => false,
  }), [begin, move, end]);
  return <Pressable {...responder.panHandlers} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityActions={[{ name: 'increment', label: t('online.browser.moveDown') }, { name: 'decrement', label: t('online.browser.moveUp') }]}
    onAccessibilityAction={({ nativeEvent }) => onAccessibilityMove(nativeEvent.actionName === 'increment' ? 1 : -1)} style={styles.handle}>
    <ArrowsVerticalIcon size={24} color={theme.secondary} />
  </Pressable>;
}
const styles = StyleSheet.create({ handle: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' } });
