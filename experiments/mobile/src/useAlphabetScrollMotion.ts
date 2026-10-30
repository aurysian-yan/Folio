import { useCallback, useEffect, useRef } from 'react';
import { AppState, type NativeScrollEvent } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';
import { alphabetPageProgress } from './alphabet-index';

// 仅跟踪手动滚动及其惯性，字母跳转和位置校正不触发侧边收起。
export function useAlphabetScrollMotion(active: boolean) {
  const progress = useSharedValue(0);
  const scrolling = useSharedValue(false);
  const tracking = useRef(false);
  const fingerDown = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    tracking.current = false; fingerDown.current = false;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    scrolling.set(false);
  }, [scrolling]);
  const settleWhenIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      if (!fingerDown.current) tracking.current = false;
      scrolling.set(false);
    }, 160);
  }, [scrolling]);
  const onScroll = useCallback((offset: number, event: NativeScrollEvent) => {
    progress.set(alphabetPageProgress(offset, event.contentSize.height, event.layoutMeasurement.height));
    if (!tracking.current) return;
    scrolling.set(true);
    settleWhenIdle();
  }, [progress, scrolling, settleWhenIdle]);
  const onBeginDrag = useCallback(() => {
    tracking.current = true; fingerDown.current = true;
    scrolling.set(true);
    settleWhenIdle();
  }, [scrolling, settleWhenIdle]);
  const onEndDrag = useCallback(() => {
    fingerDown.current = false;
    settleWhenIdle();
  }, [settleWhenIdle]);
  useEffect(() => {
    if (!active) stop();
    const subscription = AppState.addEventListener('change', (state) => { if (state !== 'active') stop(); });
    return () => { subscription.remove(); stop(); };
  }, [active, stop]);
  return { progress, scrolling, onScroll, onBeginDrag, onEndDrag, stop };
}
