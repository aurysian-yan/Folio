export const pageTitleMotion = { compactStart: 24, end: 64, blur: 8, minimumScale: 0.96, compactMinimumScale: 0.86, duration: 220 };

// 标题区间仅保留展开和收起位置，正文区间继续自由滚动。
export function pageHeaderSnapTarget(offset: number, maximumOffset: number, collapseOffset = pageTitleMotion.end) {
  if (offset <= 0.5 || offset >= collapseOffset - 0.5) return null;
  if (maximumOffset < collapseOffset) return 0;
  return offset >= collapseOffset / 2 ? collapseOffset : 0;
}

// 原生滚动回调与标题动画共用交接区间，回弹时保持清晰。
export function pageTitleBlur(offset: number, compact: boolean) {
  const start = compact ? pageTitleMotion.compactStart : 0;
  const progress = Math.max(0, Math.min(1, (offset - start) / (pageTitleMotion.end - start)));
  return pageTitleMotion.blur * (compact ? 1 - progress : progress);
}
