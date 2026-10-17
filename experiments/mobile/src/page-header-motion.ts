export const pageTitleMotion = {
  start: 1, end: 64, collapseOffset: 20, blur: 8, minimumScale: 0.96,
  compactMinimumScale: 0.96, compactScale: 1.03,
  duration: 220, minimumDuration: 180, maximumDuration: 720,
};

// 开始滚动即交接标题，顶部保留回差以避免抖动。
export function pageTitleCollapsed(offset: number, collapsed: boolean) {
  return offset >= pageTitleMotion.start * (collapsed ? 0.5 : 1);
}

// 滚动速度只调整交接时长，极快与极慢手势均受限。
export function pageTitleDuration(velocity: number, distance = pageTitleMotion.collapseOffset) {
  const duration = Number.isFinite(velocity) && velocity !== 0 ? distance / Math.abs(velocity) : pageTitleMotion.duration;
  return Math.round(Math.max(pageTitleMotion.minimumDuration, Math.min(pageTitleMotion.maximumDuration, duration)));
}

// 加速只提前本轮结束时间，不重计完整时长或因减速延长动画。
export function pageTitleRemainingDuration(velocity: number, elapsed: number, duration: number, distance = pageTitleMotion.collapseOffset) {
  const nextDuration = pageTitleDuration(velocity, distance);
  return nextDuration < Math.round(duration) ? Math.max(0, nextDuration - elapsed) : null;
}

// 标题区间仅保留展开和收起位置，正文区间继续自由滚动。
export function pageHeaderSnapTarget(offset: number, maximumOffset: number, collapseOffset = pageTitleMotion.collapseOffset) {
  if (offset <= 0.5 || offset >= collapseOffset - 0.5) return null;
  if (maximumOffset < collapseOffset) return 0;
  return offset >= collapseOffset / 2 ? collapseOffset : 0;
}

// 原生滚动回调与标题动画共用交接区间，回弹时保持清晰。
export function pageTitleBlur(offset: number, compact: boolean) {
  const progress = Math.max(0, Math.min(1, offset / pageTitleMotion.end));
  return pageTitleMotion.blur * (compact ? 1 - progress : progress);
}
