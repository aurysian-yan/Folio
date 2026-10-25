export function reorderTo<T extends { id: string }>(items: T[], id: string, target: number): T[] {
  const from = items.findIndex((item) => item.id === id);
  if (from < 0) return items;
  const to = Math.max(0, Math.min(items.length - 1, target));
  if (from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
