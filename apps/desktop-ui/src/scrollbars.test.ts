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
