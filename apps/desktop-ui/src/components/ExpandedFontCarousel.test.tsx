import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import { family } from "../test/fixtures";
import { ExpandedFontCarousel } from "./ExpandedFontCarousel";

vi.mock("./FontPreview", () => ({ FontPreview: () => null }));

const items = Array.from({ length: 8 }, (_, index) => family(String(index)));

function Example({ paged = false, wheelSpeed = 1.25, onLoadMore = vi.fn() }: { paged?: boolean; wheelSpeed?: number; onLoadMore?: () => void }) {
  const [selectedId, setSelectedId] = useState("0");
  const [families, setFamilies] = useState(paged ? items.slice(0, 1) : items);
  return <ExpandedFontCarousel families={families} selectedId={selectedId} styleKey={null} total={items.length} wheelSpeed={wheelSpeed}
    previewText="Aa" previewSize={48} showMetadata selectOnHover={false} hoverDelay={180}
    onSelect={(item) => setSelectedId(item.id)} onStyleChange={() => {}} onFavorite={() => {}}
    onLoadMore={() => { onLoadMore(); setFamilies(items.slice(0, 4)); }} />;
}

function JumpExample({ onRequestRange }: { onRequestRange: (offset: number, limit: number) => Promise<ReturnType<typeof family>[]> }) {
  const [selectedId, setSelectedId] = useState("0");
  return <ExpandedFontCarousel families={items.slice(0, 2)} selectedId={selectedId} styleKey={null} total={items.length} wheelSpeed={1.25}
    previewText="Aa" previewSize={48} showMetadata selectOnHover={false} hoverDelay={180}
    onSelect={(item) => setSelectedId(item.id)} onStyleChange={() => {}} onFavorite={() => {}}
    onRequestRange={onRequestRange} />;
}

it("展开卡片只渲染当前附近的卡片，按钮、方向键和位置滑块切换字族", async () => {
  const { container, getByRole } = render(<Example />);
  expect(container.querySelectorAll(".font-card").length).toBe(4);
  expect(getByRole("button", { name: "选择 字体 0" }).getAttribute("aria-pressed")).toBe("true");
  const height = getByRole("slider", { name: "调整卡片高度" });
  const previousHeight = Number(height.getAttribute("aria-valuenow"));
  fireEvent.keyDown(height, { key: "ArrowDown" });
  expect(Number(height.getAttribute("aria-valuenow"))).toBe(previousHeight + 5);
  fireEvent.click(getByRole("button", { name: "下一个字体" }));
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
  fireEvent.keyDown(getByRole("region", { name: "字体浏览" }), { key: "ArrowRight" });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 2" }).getAttribute("aria-pressed")).toBe("true"));
  const slider = getByRole("slider", { name: "字体位置" });
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyUp(slider, { key: "End" });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 7" }).getAttribute("aria-pressed")).toBe("true"));
  expect(container.querySelectorAll(".font-card").length).toBeLessThanOrEqual(4);
});

it("翻到未加载字族时补页，并在数据到达后选中目标", async () => {
  const onLoadMore = vi.fn();
  const { getByRole } = render(<Example paged onLoadMore={onLoadMore} />);
  fireEvent.click(getByRole("button", { name: "下一个字体" }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
});

it("滚轮在卡片区域切换字体", async () => {
  const { container, getByRole } = render(<Example />);
  fireEvent.wheel(container.querySelector(".expanded-carousel-stage")!, { deltaY: 100 });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
});

it("触控板连续滚动跟随手势，并忽略松手时的反向噪声", async () => {
  const { container, getByRole } = render(<Example />);
  const stage = container.querySelector(".expanded-carousel-stage")!;
  fireEvent.wheel(stage, { deltaY: 16, deltaMode: 0 });
  fireEvent.wheel(stage, { deltaY: 16, deltaMode: 0 });
  await waitFor(() => expect(Number(container.querySelector('.expanded-carousel-card:has([data-family-id="0"])')?.getAttribute("data-depth"))).toBeGreaterThan(0));
  fireEvent.wheel(stage, { deltaY: -7, deltaMode: 0 });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
  fireEvent.wheel(stage, { deltaY: -18, deltaMode: 0 });
  await waitFor(() => expect(container.querySelector(".expanded-carousel-stage.is-moving")).toBeNull());
  expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true");
});

it("轻量滚动已带出下一张卡片时，松手后继续翻页", async () => {
  const { container, getByRole } = render(<Example />);
  fireEvent.wheel(container.querySelector(".expanded-carousel-stage")!, { deltaY: 10, deltaMode: 0 });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
});

it.each([[0.5, "1"], [2, "2"]])("滚动速度 %.2f× 改变同一手势的翻页距离", async (wheelSpeed, target) => {
  const { container, getByRole } = render(<Example wheelSpeed={wheelSpeed} />);
  fireEvent.wheel(container.querySelector(".expanded-carousel-stage")!, { deltaY: 250, deltaMode: 0 });
  await waitFor(() => expect(getByRole("button", { name: `选择 字体 ${target}` }).getAttribute("aria-pressed")).toBe("true"));
});

it("切页先保留旧卡片位置，再将新卡片平滑移入前景", async () => {
  const { container, getByRole } = render(<Example />);
  fireEvent.click(getByRole("button", { name: "下一个字体" }));
  expect(container.querySelector('.expanded-carousel-card:has([data-family-id="0"])')?.getAttribute("data-depth")).toBe("0");
  expect(container.querySelector('.expanded-carousel-card:has([data-family-id="1"])')?.getAttribute("data-depth")).toBe("-1");
  await waitFor(() => expect(container.querySelector(".expanded-carousel-stage.is-moving")).not.toBeNull());
  expect(container.querySelector('.expanded-carousel-card:has([data-family-id="1"])')?.getAttribute("data-depth")).toBe("0");
});

it("横向拖动当前卡片切换字体", async () => {
  const original = window.PointerEvent;
  class TestPointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, options: PointerEventInit) { super(type, options); this.pointerId = options.pointerId ?? 1; }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
  try {
    const { getByRole } = render(<Example />);
    const card = getByRole("button", { name: "选择 字体 0" });
    fireEvent.pointerDown(card, { pointerId: 1, clientX: 180, clientY: 80 });
    fireEvent.pointerUp(card, { pointerId: 1, clientX: 80, clientY: 82 });
    await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true"));
  } finally {
    Object.defineProperty(window, "PointerEvent", { configurable: true, value: original });
  }
});

it("位置滑块可按需读取完整目录中的远端字族", async () => {
  const onRequestRange = vi.fn(async (offset: number, limit: number) => items.slice(offset, offset + limit));
  const { getByRole } = render(<JumpExample onRequestRange={onRequestRange} />);
  const slider = getByRole("slider", { name: "字体位置" });
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyUp(slider, { key: "End" });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 7" }).getAttribute("aria-pressed")).toBe("true"));
  expect(onRequestRange).toHaveBeenCalledWith(5, 3);
  fireEvent.click(getByRole("button", { name: "下一个字体" }));
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" }).getAttribute("aria-pressed")).toBe("true"));
  fireEvent.click(getByRole("button", { name: "上一个字体" }));
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 7" }).getAttribute("aria-pressed")).toBe("true"));
});

it("位置滑块调整中直接快切到目标卡片，不等待松手或播放切页动画", async () => {
  const { container, getByRole } = render(<Example />);
  const slider = getByRole("slider", { name: "字体位置" });
  fireEvent.keyDown(slider, { key: "End" });
  expect(getByRole("button", { name: "选择 字体 7" }).getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector(".expanded-carousel-stage.is-moving")).toBeNull();
  expect(container.querySelector('.expanded-carousel-card:has([data-family-id="7"])')?.getAttribute("data-depth")).toBe("0");
  fireEvent.keyUp(slider, { key: "End" });
});

it("滑块拖动只预览中间位置，松手后确认一次访问记录", () => {
  const onCommit = vi.fn();
  function PreviewExample() {
    const [selectedId, setSelectedId] = useState("0");
    return <ExpandedFontCarousel families={items} selectedId={selectedId} styleKey={null} total={items.length} wheelSpeed={1.25}
      previewText="Aa" previewSize={48} showMetadata selectOnHover={false} hoverDelay={180}
      onPreviewSelect={(item) => setSelectedId(item.id)}
      onSelect={(item) => { setSelectedId(item.id); onCommit(item.id); }}
      onStyleChange={() => {}} onFavorite={() => {}} />;
  }
  const { getByRole } = render(<PreviewExample />);
  const slider = getByRole("slider", { name: "字体位置" });
  fireEvent.keyDown(slider, { key: "End" });
  expect(getByRole("button", { name: "选择 字体 7" }).getAttribute("aria-pressed")).toBe("true");
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.keyUp(slider, { key: "End" });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith("7");
});

it("指针拖动位置滑块时连续快切，松手确认最终卡片", () => {
  const onCommit = vi.fn();
  function PreviewExample() {
    const [selectedId, setSelectedId] = useState("0");
    return <ExpandedFontCarousel families={items} selectedId={selectedId} styleKey={null} total={items.length} wheelSpeed={1.25}
      previewText="Aa" previewSize={48} showMetadata selectOnHover={false} hoverDelay={180}
      onPreviewSelect={(item) => setSelectedId(item.id)}
      onSelect={(item) => { setSelectedId(item.id); onCommit(item.id); }}
      onStyleChange={() => {}} onFavorite={() => {}} />;
  }
  const { getByRole } = render(<PreviewExample />);
  const slider = getByRole("slider", { name: "字体位置" });
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 42 }));
  expect(getByRole("button", { name: "选择 字体 1" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent(slider, new MouseEvent("pointermove", { bubbles: true, clientX: 214 }));
  expect(getByRole("button", { name: "选择 字体 5" }).getAttribute("aria-pressed")).toBe("true");
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent(slider, new MouseEvent("pointerup", { bubbles: true, clientX: 214 }));
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith("5");
});

it("滑块快切请求只采用最后的位置，旧请求返回不回跳", async () => {
  const resolveRequests: Array<(value: ReturnType<typeof family>[]) => void> = [];
  const onRequestRange = vi.fn(() => new Promise<ReturnType<typeof family>[]>((resolve) => resolveRequests.push(resolve)));
  const { container, getByRole } = render(<JumpExample onRequestRange={onRequestRange} />);
  const slider = getByRole("slider", { name: "字体位置" });
  fireEvent.keyDown(slider, { key: "End" });
  fireEvent.keyUp(slider, { key: "End" });
  expect(onRequestRange).toHaveBeenCalledWith(5, 3);
  fireEvent.keyDown(slider, { key: "Home" });
  fireEvent.keyUp(slider, { key: "Home" });
  await act(async () => { resolveRequests.forEach((resolve) => resolve(items.slice(5, 8))); });
  expect(container.querySelector('.expanded-carousel-card:has([data-family-id="0"])')?.getAttribute("data-depth")).toBe("0");
  expect(getByRole("button", { name: "选择 字体 0" }).getAttribute("aria-pressed")).toBe("true");
});

it("快速拖过未加载位置时合并请求，只读取最后停留的字体", async () => {
  const onRequestRange = vi.fn(async (offset: number, limit: number) => items.slice(offset, offset + limit));
  const { getByRole } = render(<JumpExample onRequestRange={onRequestRange} />);
  const slider = getByRole("slider", { name: "字体位置" });
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 86 }));
  fireEvent(slider, new MouseEvent("pointermove", { bubbles: true, clientX: 129 }));
  fireEvent(slider, new MouseEvent("pointermove", { bubbles: true, clientX: 171 }));
  await waitFor(() => expect(onRequestRange).toHaveBeenCalledWith(2, 5));
  expect(onRequestRange.mock.calls.filter(([offset]) => offset !== 5)).toHaveLength(1);
  fireEvent(slider, new MouseEvent("pointerup", { bubbles: true, clientX: 171 }));
});
