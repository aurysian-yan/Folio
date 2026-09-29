import type { PreviewPriority } from "./preview-cache";

type Visibility = Exclude<PreviewPriority, "selected"> | null;
type Watcher = (visibility: Visibility) => void;
type Target = { watcher: Watcher; nearby: boolean | undefined; visible: boolean | undefined; last: Visibility | undefined };
const observers = new Map<Element | null, { nearby: IntersectionObserver; visible: IntersectionObserver; targets: Map<Element, Target> }>();

// 同一滚动区域共享观察器，离屏卡片取消需求，邻近卡片使用低优先级。
export function observePreviewVisibility(element: Element, watcher: Watcher) {
  const root = element.closest(".font-grid");
  let group = observers.get(root);
  if (!group) {
    const targets = new Map<Element, Target>();
    const update = (kind: "nearby" | "visible", entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const target = targets.get(entry.target);
        if (!target) continue;
        target[kind] = entry.isIntersecting;
        if (target.visible === undefined || target.nearby === undefined) continue;
        const next = target.visible ? "visible" : target.nearby ? "nearby" : null;
        if (target.last !== next) { target.last = next; target.watcher(next); }
      }
    };
    // 分别观察可见区和预加载区，跨边界时及时提升优先级，无需同步读取布局。
    const nearby = new IntersectionObserver((entries) => update("nearby", entries), { root, rootMargin: "100px 0px" });
    const visible = new IntersectionObserver((entries) => update("visible", entries), { root });
    group = { nearby, visible, targets };
    observers.set(root, group);
  }
  group.targets.set(element, { watcher, nearby: undefined, visible: undefined, last: undefined });
  group.nearby.observe(element);
  group.visible.observe(element);
  const acquired = group;
  return () => {
    acquired.targets.delete(element);
    acquired.nearby.unobserve(element);
    acquired.visible.unobserve(element);
    if (acquired.targets.size === 0) { acquired.nearby.disconnect(); acquired.visible.disconnect(); observers.delete(root); }
  };
}
