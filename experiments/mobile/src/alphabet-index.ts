import type { AlphabetEntry } from './library.ts';

export interface AlphabetGroup { label: string; index: number }
export const alphabetPageSize = 40;

export function alphabetGroups(entries: AlphabetEntry[]): AlphabetGroup[] {
  return entries.flatMap((entry, index) => index === 0 || entries[index - 1]!.group !== entry.group
    ? [{ label: entry.group, index }] : []);
}

export function alphabetGroupAt(groups: AlphabetGroup[], index: number) {
  let selected = 0;
  for (let i = 1; i < groups.length && groups[i]!.index <= index; i++) selected = i;
  return selected;
}

export function alphabetPages(index: number, total: number) {
  if (total <= 0) return [];
  const page = Math.floor(Math.max(0, Math.min(total - 1, index)) / alphabetPageSize) * alphabetPageSize;
  return [page, page + alphabetPageSize, page - alphabetPageSize].filter((offset) => offset >= 0 && offset < total);
}

// 每个字母占据相同的轨道长度，点击、拖动与标签共用同一坐标。
export function alphabetDragGroup(y: number, height: number, count: number) {
  'worklet';
  if (count < 2 || height <= 0) return 0;
  return Math.max(0, Math.min(count - 1, Math.floor(y * count / height)));
}

export function alphabetGroupCenter(group: number, height: number, count: number) {
  'worklet';
  return count > 0 ? (group + 0.5) * height / count : height / 2;
}

// 使用窗口实测位置校正滚动，避免分页估算与顶部栏高度导致偏移。
export function alphabetAlignedOffset(offset: number, rowTop: number, listTop: number, targetTop: number, maximumOffset = Infinity) {
  return Math.min(Math.max(0, maximumOffset), Math.max(0, offset + rowTop - listTop - targetTop));
}

export function alphabetPageProgress(offset: number, contentHeight: number, viewportHeight: number) {
  const range = contentHeight - viewportHeight;
  return range > 0 ? Math.max(0, Math.min(1, offset / range)) : 0;
}
