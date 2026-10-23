// 底部导航外边距自适应：圆角占六成，屏幕尺寸占四成。
// 缩减量在 6–12dp 之间，圆角或屏幕越大越保留呼吸空间。
export const minNavigationMarginReduction = 6;
export const maxNavigationMarginReduction = 12;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function navigationMarginReduction(shortestSide: number, cornerRadius: number) {
  const size = clamp01((shortestSide - 360) / 240);
  const corner = clamp01((cornerRadius - 8) / 24);
  const factor = size * 0.4 + corner * 0.6;
  return maxNavigationMarginReduction - (maxNavigationMarginReduction - minNavigationMarginReduction) * factor;
}

export function navigationSideMargin(availableWidth: number, reduction: number) {
  return Math.max(8, Math.max(0, availableWidth * 0.08 - 4) - reduction);
}

export function navigationBottomOffset(bottomInset: number, reduction: number) {
  const base = Math.max(32, bottomInset + 16);
  // 不侵入系统手势区。
  return Math.max(bottomInset + 4, base - reduction);
}
