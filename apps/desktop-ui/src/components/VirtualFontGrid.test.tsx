import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { family } from "../test/fixtures";
import { VirtualFontGrid } from "./VirtualFontGrid";

vi.mock("./FontPreview", () => ({ FontPreview: () => null }));

const families = Array.from({ length: 1000 }, (_, index) => family(String(index)));
const props = { families, total: 1000, mode: "compact" as const, previewText: "Aa", previewSize: 48, styleKey: null,
  showMetadata: true, selectOnHover: false, hoverDelay: 200, wheelSpeed: 1.25, onSelect: vi.fn(), onStyleChange: vi.fn(), onFavorite: vi.fn() };

it("长列表挂载有界，End/Home 可跨虚拟行聚焦", async () => {
  const { container, getByRole } = render(<VirtualFontGrid {...props} />);
  expect(container.querySelectorAll(".font-card").length).toBeLessThan(40);
  const first = getByRole("button", { name: "选择 字体 0" });
  first.focus();
  fireEvent.keyDown(first, { key: "End" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 999"));
  expect(container.querySelectorAll(".font-card").length).toBeLessThan(40);
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 0"));
});

it("滚动保留离屏焦点行，Tab 不跳过未挂载字族", async () => {
  const { container, getByRole } = render(<VirtualFontGrid {...props} />);
  const first = getByRole("button", { name: "选择 字体 0" });
  first.focus();
  const list = getByRole("region", { name: "字体浏览" });
  list.scrollTop = 20000;
  fireEvent.scroll(list);
  await waitFor(() => expect(container.querySelector('[data-family-id="4"]')).toBeNull());
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab" });
  expect(document.activeElement).toBe(first);
  const lastPinned = getByRole("button", { name: "选择 字体 3" });
  lastPinned.focus();
  fireEvent.keyDown(lastPinned, { key: "Tab" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 4"));
});

it("切换视图保持滚动锚点和当前键盘焦点", async () => {
  const { getByRole, rerender } = render(<VirtualFontGrid {...props} />);
  const first = getByRole("button", { name: "选择 字体 0" });
  first.focus();
  fireEvent.keyDown(first, { key: "End" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 999"));
  rerender(<VirtualFontGrid {...props} mode="list" />);
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 999"));
  expect(getByRole("region", { name: "字体浏览" }).scrollTop).toBeGreaterThan(80000);
});

it("提前两屏自动补页，重复滚动不重复请求，追加保留位置和焦点", async () => {
  const onLoadMore = vi.fn();
  const firstPage = families.slice(0, 120);
  const { container, getByRole, rerender } = render(<VirtualFontGrid {...props} families={firstPage} onLoadMore={onLoadMore} />);
  const list = getByRole("region", { name: "字体浏览" });
  const first = getByRole("button", { name: "选择 字体 0" });
  act(() => first.focus());
  const height = parseFloat((container.querySelector(".font-grid-rows") as HTMLElement).style.height);
  expect(onLoadMore).not.toHaveBeenCalled();
  list.scrollTop = height - list.clientHeight * 3 - 10;
  fireEvent.scroll(list);
  await waitFor(() => expect(container.querySelector('[data-family-id="4"]')).toBeNull());
  expect(onLoadMore).not.toHaveBeenCalled();
  list.scrollTop += 20;
  fireEvent.scroll(list);
  await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  const scrollTop = list.scrollTop;
  fireEvent.scroll(list);
  rerender(<VirtualFontGrid {...props} families={firstPage} onLoadMore={onLoadMore} isLoading />);
  rerender(<VirtualFontGrid {...props} families={families.slice(0, 240)} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  expect(list.scrollTop).toBe(scrollTop);
  expect(document.activeElement).toBe(first);
  expect(container.querySelectorAll(".font-card").length).toBeLessThan(40);
});

it("短页自动填充，等待在途请求，全部加载后停止补页", async () => {
  const onLoadMore = vi.fn();
  const { rerender } = render(<VirtualFontGrid {...props} families={families.slice(0, 4)} total={12} onLoadMore={onLoadMore} isLoading />);
  expect(onLoadMore).not.toHaveBeenCalled();
  rerender(<VirtualFontGrid {...props} families={families.slice(0, 4)} total={12} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  rerender(<VirtualFontGrid {...props} families={families.slice(0, 8)} total={12} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(2);
  rerender(<VirtualFontGrid {...props} families={families.slice(0, 12)} total={12} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(2);
});

it("无新增字族不循环补页，刷新首屏后可重新加载", () => {
  const onLoadMore = vi.fn();
  const firstPage = families.slice(0, 4);
  const { rerender } = render(<VirtualFontGrid {...props} families={firstPage} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  rerender(<VirtualFontGrid {...props} families={firstPage} onLoadMore={onLoadMore} isLoading />);
  rerender(<VirtualFontGrid {...props} families={[...firstPage]} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  rerender(<VirtualFontGrid {...props} families={firstPage.map((item) => ({ ...item }))} onLoadMore={onLoadMore} />);
  expect(onLoadMore).toHaveBeenCalledTimes(2);
});

it("Hero 共用滚动区域，其高度计入预取和键盘定位，更新高度后保留锚点", async () => {
  let headerHeight = 200;
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.classList.contains("font-grid-header") ? headerHeight : 0;
  });
  const resizeCallbacks: (() => void)[] = [];
  const Observer = globalThis.ResizeObserver;
  vi.spyOn(globalThis, "ResizeObserver").mockImplementation(class extends Observer {
    constructor(callback: ResizeObserverCallback) {
      super(callback);
      resizeCallbacks.push(() => callback([], this));
    }
  });
  const onLoadMore = vi.fn();
  const { container, getByRole, rerender } = render(<VirtualFontGrid {...props} families={families.slice(0, 120)}
    header={<h1>字体库</h1>} onLoadMore={onLoadMore} />);
  const scroll = getByRole("region", { name: "字体浏览" });
  expect(scroll.contains(getByRole("heading", { name: "字体库" }))).toBe(true);
  expect(getByRole("list", { name: "字体列表" }).contains(getByRole("heading", { name: "字体库" }))).toBe(false);
  const height = parseFloat((container.querySelector(".font-grid-rows") as HTMLElement).style.height);
  scroll.scrollTop = height + headerHeight - scroll.clientHeight * 3 - 10;
  fireEvent.scroll(scroll);
  await waitFor(() => expect(container.querySelector('[data-family-id="0"]')).toBeNull());
  expect(onLoadMore).not.toHaveBeenCalled();
  scroll.scrollTop += 20;
  fireEvent.scroll(scroll);
  await waitFor(() => expect(onLoadMore).toHaveBeenCalledTimes(1));
  const card = container.querySelector<HTMLButtonElement>(".font-card-select")!;
  act(() => card.focus());
  fireEvent.keyDown(card, { key: "End" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 119"));
  expect(scroll.scrollTop).toBe(height + headerHeight - scroll.clientHeight);
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 0"));
  expect(scroll.scrollTop).toBe(headerHeight);
  headerHeight = 320;
  act(() => resizeCallbacks.forEach((callback) => callback()));
  expect(scroll.scrollTop).toBe(headerHeight);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("选择 字体 0");
  scroll.scrollTop = 0;
  fireEvent.scroll(scroll);
  rerender(<VirtualFontGrid {...props} families={families.slice(0, 120)} header={<h1>字体库</h1>} mode="list" onLoadMore={onLoadMore} />);
  expect(scroll.scrollTop).toBe(0);
});
