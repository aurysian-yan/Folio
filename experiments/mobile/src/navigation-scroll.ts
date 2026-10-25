export interface NavigationScrollState { offset: number; distance: number; direction: number }
export const initialNavigationScroll: NavigationScrollState = { offset: 0, distance: 0, direction: 0 };

// 方向累计超过阈值后切换，忽略边界回弹和微小抖动。
export function trackNavigationScroll(state: NavigationScrollState, offset: number) {
  const next = Math.max(0, offset);
  const delta = next - state.offset;
  const direction = Math.sign(delta);
  if (Math.abs(delta) < 1) return { state: { ...state, offset: next }, collapsed: null };
  const distance = direction === state.direction ? state.distance + Math.abs(delta) : Math.abs(delta);
  const collapsed = distance >= 32 ? direction > 0 : null;
  return { state: { offset: next, direction, distance: collapsed === null ? distance : 0 }, collapsed };
}
