// 旧偏好与连续拖动共用范围，小数字号在重启后保持精度。
export function sanitizePreviewScale(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(48, Math.max(12, value)) : fallback;
}
