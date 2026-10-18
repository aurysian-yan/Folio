import { waitFor } from "@testing-library/react";
import { OverlayScrollbars } from "overlayscrollbars";
import { afterEach, expect, it, vi } from "vitest";
import { installAppScrollbars } from "./scrollbars";

const cleanup: (() => void)[] = [];
afterEach(() => { cleanup.splice(0).reverse().forEach((dispose) => dispose()); });

function setup(markup: string) {
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.append(root);
  cleanup.push(() => root.remove());
  cleanup.push(installAppScrollbars(root));
  return root;
}

it("覆盖页面与弹层滚动区域，保留滚动节点、位置和 React Aria 列表", () => {
  const root = setup(`<div class="font-grid"><div role="list"><button>字体</button></div></div>
    <article class="settings-page"></article><div class="inspector-inner"></div><div class="cloud-pane"></div>
    <div class="favorite-editor-body"></div><div class="facet-groups"></div><nav class="sidebar-scroll blur-preview-nav"></nav>
    <div class="select__popover"><div role="listbox"><button role="option">名称</button></div></div>
    <div class="dropdown__popover"></div><div class="color-picker__popover" style="overflow-x: hidden"></div>
    <div class="modal__body--scroll-inside"></div><div class="modal__backdrop"><div class="modal__container--scroll-outside"></div></div>`);
  const targets = root.querySelectorAll<HTMLElement>("[data-overlayscrollbars]");
  expect(targets).toHaveLength(12);
  for (const target of targets) {
    const instance = OverlayScrollbars(target)!;
    expect(instance.elements().viewport).toBe(target);
    expect(instance.elements().scrollOffsetElement).toBe(target);
    expect(target.querySelectorAll(":scope > .os-scrollbar")).toHaveLength(2);
    target.scrollTop = 200;
    instance.update();
    expect(target.scrollTop).toBe(200);
  }
  expect(root.querySelector(".font-grid > [role='list'] > button")?.textContent).toBe("字体");
  expect(root.querySelector(".select__popover > [role='listbox'] > [role='option']")?.textContent).toBe("名称");
  expect(OverlayScrollbars(root.querySelector<HTMLElement>(".color-picker__popover")!)?.options().overflow.x).toBe("hidden");
});

it("菜单打开后接管滚动，关闭后销毁，卸载后停止观察", async () => {
  const root = setup('<div class="font-grid"><button>字体</button></div>');
  const popover = document.createElement("div");
  popover.className = "select__popover";
  root.append(popover);
  await waitFor(() => expect(OverlayScrollbars(popover)).toBeTruthy());
  const instance = OverlayScrollbars(popover)!;
  popover.remove();
  await waitFor(() => expect(instance.state().destroyed).toBe(true));
  const dispose = cleanup.pop()!;
  dispose();
  expect(root.querySelector(".os-scrollbar")).toBeNull();
  expect(root.querySelector("button")?.textContent).toBe("字体");
  root.append(popover);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(OverlayScrollbars(popover)).toBeUndefined();
});

it("左栏留白随状态卡高度变化，预览导航不受影响，卸载恢复样式", () => {
  let statusHeight = 48;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("sidebar-status") ? statusHeight : 0;
  });
  const resizeCallbacks: (() => void)[] = [];
  const Observer = globalThis.ResizeObserver;
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(class extends Observer {
    private notify: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { super(callback); this.notify = callback; }
    observe(target: Element) {
      super.observe(target);
      if (target.classList.contains("sidebar-status")) resizeCallbacks.push(() => this.notify([], this));
    }
  });
  const root = setup('<div class="sidebar-inner"><nav class="sidebar-scroll" style="--sidebar-status-clearance: 72px"><button>字体健康</button></nav><div class="sidebar-status"></div></div><nav class="sidebar-scroll blur-preview-nav"></nav>');
  const sidebar = root.querySelector<HTMLElement>(".sidebar-inner .sidebar-scroll")!;
  const preview = root.querySelector<HTMLElement>(".blur-preview-nav")!;
  expect(sidebar.style.getPropertyValue("--sidebar-status-clearance")).toBe("56px");
  expect(preview.style.getPropertyValue("--sidebar-status-clearance")).toBe("");
  statusHeight = 80;
  resizeCallbacks.forEach((callback) => callback());
  expect(sidebar.style.getPropertyValue("--sidebar-status-clearance")).toBe("88px");
  const dispose = cleanup.pop()!;
  dispose();
  expect(sidebar.style.getPropertyValue("--sidebar-status-clearance")).toBe("72px");
});

it("侧栏遮罩随滚动位置显示，顶部和回弹时隐藏，卸载后停止监听", () => {
  const root = document.createElement("div");
  root.innerHTML = '<nav class="sidebar-scroll"></nav><nav class="sidebar-scroll blur-preview-nav"></nav><div class="font-grid"></div>';
  const sidebar = root.querySelector<HTMLElement>(".sidebar-scroll")!;
  const preview = root.querySelector<HTMLElement>(".blur-preview-nav")!;
  sidebar.scrollTop = 40;
  document.body.append(root);
  cleanup.push(() => root.remove());
  const dispose = installAppScrollbars(root);
  cleanup.push(dispose);
  expect(sidebar.hasAttribute("data-scrolled")).toBe(true);
  expect(preview.hasAttribute("data-scrolled")).toBe(false);
  for (const top of [0, -5, 1, 120, 0]) {
    sidebar.scrollTop = top;
    sidebar.dispatchEvent(new Event("scroll"));
    expect(sidebar.hasAttribute("data-scrolled")).toBe(top > 0);
  }
  preview.scrollTop = 20;
  preview.dispatchEvent(new Event("scroll"));
  expect(preview.hasAttribute("data-scrolled")).toBe(true);
  expect(root.querySelector(".font-grid")?.hasAttribute("data-scrolled")).toBe(false);
  cleanup.pop()!();
  expect(preview.hasAttribute("data-scrolled")).toBe(false);
  sidebar.scrollTop = 20;
  sidebar.dispatchEvent(new Event("scroll"));
  expect(sidebar.hasAttribute("data-scrolled")).toBe(false);
});

it("设置预览侧栏根据底部云同步卡片高度预留空间", () => {
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("sidebar-status") ? 52 : 0;
  });
  const root = setup('<div class="blur-preview-sidebar-inner"><nav class="sidebar-scroll blur-preview-nav"></nav><div class="sidebar-status"></div></div>');
  const preview = root.querySelector<HTMLElement>(".blur-preview-nav")!;
  expect(preview.style.getPropertyValue("--sidebar-status-clearance")).toBe("60px");
  cleanup.pop()!();
  expect(preview.style.getPropertyValue("--sidebar-status-clearance")).toBe("");
});

async function setupAutoPreview() {
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(680);
  const root = setup('<nav class="sidebar-scroll blur-preview-nav"><button>字体</button></nav><nav class="sidebar-scroll"></nav>');
  await Promise.resolve();
  return {
    preview: root.querySelector<HTMLElement>(".blur-preview-nav")!,
    sidebar: root.querySelector<HTMLElement>(".sidebar-scroll:not(.blur-preview-nav)")!,
  };
}

it("只有设置预览自动平滑往返滚动，卸载后停止", async () => {
  const { preview, sidebar } = await setupAutoPreview();
  vi.advanceTimersByTime(2500);
  expect(preview.scrollTop).toBeGreaterThan(80);
  expect(preview.scrollTop).toBeLessThan(120);
  expect(sidebar.scrollTop).toBe(0);
  vi.advanceTimersByTime(2500);
  expect(preview.scrollTop).toBeCloseTo(200, 1);
  vi.advanceTimersByTime(5000);
  expect(preview.scrollTop).toBeCloseTo(0, 1);
  cleanup.pop()!();
  preview.scrollTop = 75;
  vi.advanceTimersByTime(5000);
  expect(preview.scrollTop).toBe(75);
});

it.each(["wheel", "pointerdown", "touchstart", "keydown"])("用户通过 %s 接管后不再自动滚动，保留手动位置", async (event) => {
  const { preview } = await setupAutoPreview();
  vi.advanceTimersByTime(2000);
  expect(preview.scrollTop).toBeGreaterThan(0);
  preview.querySelector("button")!.dispatchEvent(new Event(event, { bubbles: true }));
  preview.scrollTop = 60;
  vi.advanceTimersByTime(12000);
  expect(preview.scrollTop).toBe(60);
});

it("减少动态效果时不自动滚动", async () => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
  const { preview } = await setupAutoPreview();
  vi.advanceTimersByTime(12000);
  expect(preview.scrollTop).toBe(0);
});
