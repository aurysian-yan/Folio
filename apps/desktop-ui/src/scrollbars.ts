import { OverlayScrollbars } from "overlayscrollbars";
import { useLayoutEffect } from "react";

const scrollAreas = [
  ".character-map-grid",
  ".character-map-detail",
  ".sidebar-scroll",
  ".font-grid",
  ".inspector-inner",
  ".settings-page",
  ".about-license-scroll",
  ".facet-groups",
  ".favorite-editor-body",
  ".cloud-pane",
  ".select__popover",
  ".dropdown__popover",
  ".color-picker__popover",
  ".modal__body--scroll-inside",
  ".modal__backdrop:has(.modal__container--scroll-outside)",
].join(", ");

function trackSidebarScroll(target: HTMLElement) {
  if (!target.matches(".sidebar-scroll")) return () => {};
  const update = () => target.toggleAttribute("data-scrolled", target.scrollTop > 0);
  update();
  target.addEventListener("scroll", update, { passive: true });
  return () => {
    target.removeEventListener("scroll", update);
    target.removeAttribute("data-scrolled");
  };
}

// 仅设置预览自动往返滚动，用户接管后本次预览不再自动播放。
function autoScrollPreview(target: HTMLElement) {
  if (!target.matches(".blur-preview-nav")) return () => {};
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let stopped = false;
  let visible = false;
  let frame = 0;
  let elapsed = 0;
  let previousTime: number | null = null;
  const animate = (time: number) => {
    if (previousTime !== null) elapsed += Math.min(time - previousTime, 64);
    previousTime = time;
    const distance = Math.max(0, target.scrollHeight - target.clientHeight);
    const duration = Math.max(4000, distance / 40 * 1000);
    target.scrollTop = distance * (1 - Math.cos(Math.PI * elapsed / duration)) / 2;
    frame = window.requestAnimationFrame(animate);
  };
  const updateMotion = () => {
    window.cancelAnimationFrame(frame);
    previousTime = null;
    if (!stopped && visible && !reducedMotion.matches) {
      frame = window.requestAnimationFrame(animate);
    }
  };
  const stop = () => {
    stopped = true;
    updateMotion();
  };
  const interactionEvents = ["wheel", "pointerdown", "touchstart", "keydown"] as const;
  for (const event of interactionEvents) {
    target.addEventListener(event, stop, { capture: true, passive: true });
  }
  reducedMotion.addEventListener("change", updateMotion);
  const observer = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    updateMotion();
  });
  observer.observe(target);
  return () => {
    stop();
    observer.disconnect();
    reducedMotion.removeEventListener("change", updateMotion);
    for (const event of interactionEvents) target.removeEventListener(event, stop, true);
  };
}

function reserveSidebarStatus(target: HTMLElement, instance: OverlayScrollbars) {
  const status = target.closest(".sidebar-inner, .blur-preview-sidebar-inner")?.querySelector<HTMLElement>(".sidebar-status");
  if (!target.matches(".sidebar-scroll") || !status) return () => {};
  const previous = target.style.getPropertyValue("--sidebar-status-clearance");
  const measure = () => {
    if (!status.offsetHeight) return;
    const clearance = `${status.offsetHeight + 8}px`;
    if (target.style.getPropertyValue("--sidebar-status-clearance") === clearance) return;
    target.style.setProperty("--sidebar-status-clearance", clearance);
    instance.update();
  };
  measure();
  const observer = new ResizeObserver(measure);
  observer.observe(status);
  return () => {
    observer.disconnect();
    if (previous) target.style.setProperty("--sidebar-status-clearance", previous);
    else target.style.removeProperty("--sidebar-status-clearance");
  };
}

// 保持原元素作为视口，虚拟列表、React Aria 和滚动事件共用原有节点。
export function installAppScrollbars(root: HTMLElement) {
  const instances = new Map<HTMLElement, { instance: OverlayScrollbars; cleanup: () => void }>();
  let frame = 0;
  const scan = () => {
    frame = 0;
    for (const [target, { instance, cleanup }] of instances) {
      if (root.contains(target) && target.matches(scrollAreas)) continue;
      cleanup();
      instance.destroy();
      instances.delete(target);
    }
    for (const target of root.querySelectorAll<HTMLElement>(scrollAreas)) {
      if (instances.has(target)) continue;
      const css = getComputedStyle(target);
      target.setAttribute("data-overlayscrollbars-initialize", "");
      const instance = OverlayScrollbars({ target, elements: { viewport: target } }, {
        overflow: {
          x: css.overflowX === "hidden" || css.overflowX === "clip" ? "hidden" : "scroll",
          y: "scroll",
        },
        showNativeOverlaidScrollbars: false,
        scrollbars: {
          theme: "os-theme-folio",
          visibility: "auto",
          autoHide: "leave",
          autoHideDelay: 600,
          dragScroll: true,
          clickScroll: "instant",
        },
      });
      const cleanupStatus = reserveSidebarStatus(target, instance);
      const cleanupScroll = trackSidebarScroll(target);
      const cleanupAutoScroll = autoScrollPreview(target);
      instances.set(target, { instance, cleanup: () => { cleanupAutoScroll(); cleanupStatus(); cleanupScroll(); } });
    }
  };
  scan();
  // 同时接管 Portal 中新打开的菜单和弹窗，关闭后释放实例。
  const containsScrollArea = (node: Node) => node instanceof HTMLElement && (node.matches(scrollAreas) || node.querySelector(scrollAreas));
  const observer = new MutationObserver((records) => {
    if (!frame && records.some((record) => [...record.addedNodes, ...record.removedNodes].some(containsScrollArea))) {
      frame = window.requestAnimationFrame(scan);
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
    window.cancelAnimationFrame(frame);
    for (const { instance, cleanup } of instances.values()) {
      cleanup();
      instance.destroy();
    }
    instances.clear();
  };
}

export function useAppScrollbars() {
  useLayoutEffect(() => installAppScrollbars(document.documentElement), []);
}
