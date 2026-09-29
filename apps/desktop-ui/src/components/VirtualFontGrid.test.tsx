import { fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { family } from "../test/fixtures";
import { VirtualFontGrid } from "./VirtualFontGrid";

vi.mock("./FontPreview", () => ({ FontPreview: () => null }));

const families = Array.from({ length: 1000 }, (_, index) => family(String(index)));
const props = { families, total: 1000, mode: "compact" as const, previewText: "Aa", previewSize: 48, styleKey: null,
  showMetadata: true, selectOnHover: false, hoverDelay: 200, onSelect: vi.fn(), onStyleChange: vi.fn(), onFavorite: vi.fn() };

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
  const list = getByRole("list", { name: "字体列表" });
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
  expect(getByRole("list", { name: "字体列表" }).scrollTop).toBeGreaterThan(80000);
});
