import type { FontFace, VariableAxis } from './library';

// 详情预览的字号范围与默认值，按视觉考虑保持够大的基准。
export const detailPreviewSize = { minimum: 16, maximum: 64, defaultValue: 36 };

// 可变轴按范围选择步进，避免拖动时产生无意义的微小变化。
export function axisStep(minimum: number, maximum: number) {
  const range = maximum - minimum;
  if (!Number.isFinite(range) || range <= 0) return 0.01;
  if (range >= 200) return 1;
  if (range >= 20) return 0.5;
  if (range >= 2) return 0.05;
  return 0.01;
}

export function clampAxisValue(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

// 以最小值锚定步进并收敛到合法区间。
export function snapAxisValue(value: number, minimum: number, maximum: number, step: number) {
  if (!Number.isFinite(step) || step <= 0) return clampAxisValue(value, minimum, maximum);
  const snapped = minimum + Math.round((value - minimum) / step) * step;
  return clampAxisValue(Number(snapped.toFixed(4)), minimum, maximum);
}

// 最多保留两位小数，去掉无意义的尾随零。
export function formatAxisValue(value: number) {
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toFixed(2)));
}

export function defaultAxisValues(face: FontFace | null | undefined): Record<string, number> {
  if (!face) return {};
  return Object.fromEntries(face.axes.map((axis) => [axis.tag, axis.defaultValue]));
}

// 只展示可调节的轴，忽略上下限相等或数值非法的轴。
export function adjustableAxes(face: FontFace | null | undefined): VariableAxis[] {
  return face?.axes.filter((axis) => Number.isFinite(axis.minimum) && Number.isFinite(axis.maximum)
    && Number.isFinite(axis.defaultValue) && axis.maximum > axis.minimum) ?? [];
}

// 上/下一个字款，到达两端时保持当前选择。
export function stepFaceId(faces: FontFace[], currentId: string | undefined, delta: number) {
  if (faces.length === 0) return currentId;
  const index = faces.findIndex((face) => face.id === currentId);
  const base = index < 0 ? 0 : index;
  const next = Math.min(faces.length - 1, Math.max(0, base + delta));
  return faces[next]?.id ?? currentId;
}
