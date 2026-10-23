// 关闭标签页后回到最近使用的一个；多个来源各自保留自己的网页。
export function mostRecentTab<T extends { providerId: string; activatedAt: number }>(tabs: T[]): T | null {
  return tabs.reduce<T | null>((value, tab) =>
    !value || tab.activatedAt > value.activatedAt ? tab : value, null);
}
