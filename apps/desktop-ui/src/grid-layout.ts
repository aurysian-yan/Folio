import type { ViewMode } from "./components/FontCard";

export function gridGeometry(width: number, mode: ViewMode) {
  const gap = mode === "list" ? 8 : mode === "expanded" ? 16 : 10;
  const minimum = mode === "compact" ? 128 : mode === "large" ? 272 : 410;
  const columns = mode === "list" ? 1 : Math.max(1, Math.floor((width + gap) / (minimum + gap)));
  const cardWidth = Math.max(0, (width - (columns - 1) * gap) / columns);
  const cardHeight = mode === "list" ? 84 : cardWidth * (mode === "large" ? 164 / 272 : mode === "expanded" ? 280 / 410 : 1);
  return { columns, gap, cardWidth, cardHeight, stride: cardHeight + gap };
}

export function visibleRows(count: number, columns: number, stride: number, scrollTop: number, height: number, focusedIndex = -1) {
  const rows = Math.ceil(count / columns);
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / stride) - 2);
  const end = Math.min(rows, Math.ceil((Math.max(0, scrollTop) + height) / stride) + 2);
  const result = new Set<number>();
  for (let row = Math.min(start, Math.max(0, rows - 1)); row < end; row += 1) result.add(row);
  if (focusedIndex >= 0 && focusedIndex < count) result.add(Math.floor(focusedIndex / columns));
  return [...result].sort((a, b) => a - b);
}
