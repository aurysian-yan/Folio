import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { invalidatePreviewCache } from "../preview-cache-events";
import { currentPreviewStyle, coversCodepoint, previewStyles } from "../font-preview";
import { family } from "../test/fixtures";
import { FontPreview } from "./FontPreview";
import { loadPreviewFont, renderPreviews } from "../api";

vi.mock("../api", () => ({
  loadPreviewFont: vi.fn(async () => ({ bytes: new Uint8Array([0, 1, 0, 0]), coverage: [[32, 126]], sample: "Aa" })),
  renderPreviews: vi.fn(async () => [{ dataUrl: "data:image/png;base64,AA==" }]),
}));

beforeEach(() => { invalidatePreviewCache(); vi.mocked(loadPreviewFont).mockClear(); vi.mocked(renderPreviews).mockClear(); });

it("卡片和检查器共享真实字体，坐标或字号变化不重新传输", async () => {
  const value = family("shared");
  const style = currentPreviewStyle(value);
  const { container, rerender } = render(<><FontPreview style={style} text="Aa" size={48} lines={2} label="卡片" />
    <FontPreview style={style} text="Aa" size={48} lines={6} label="检查器" priority="selected" /></>);
  await waitFor(() => expect(container.querySelectorAll(".font-preview-text")).toHaveLength(2));
  expect(loadPreviewFont).toHaveBeenCalledTimes(1);
  rerender(<><FontPreview style={style && { ...style, coordinates: { wght: 700 } }} text="Aa 中文" size={64} lines={2} label="卡片" />
    <FontPreview style={style} text="Aa" size={48} lines={6} label="检查器" priority="selected" /></>);
  await waitFor(() => expect(container.textContent).toContain("Aa □□"));
  expect(loadPreviewFont).toHaveBeenCalledTimes(1);
  expect(previewStyles(value)).toBe(previewStyles(value));
});

it("卡片和侧边栏首次显示严格使用设置字号，长文本和窄容器不触发布局缩放", async () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(() => { throw new Error("不应测量字体宽度"); });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => { throw new Error("不应测量字体高度"); });
  const style = currentPreviewStyle(family("fixed-size"));
  const text = "Folio preview with a long sample that exceeds the available area";
  const { container, rerender } = render(<><FontPreview style={style} text={text} size={48} lines={2} label="字体卡片" />
    <div className="inspector-preview"><FontPreview style={style} text={text} size={48} lines={6} label="侧边栏" priority="selected" /></div></>);
  await waitFor(() => expect(container.querySelectorAll(".font-preview-text")).toHaveLength(2));
  const previews = [...container.querySelectorAll<HTMLElement>(".font-preview")];
  for (const preview of previews) Object.defineProperty(preview, "clientWidth", { get: () => 100 });
  for (const span of container.querySelectorAll<HTMLElement>(".font-preview-text")) {
    expect(span.style.fontSize).toBe("48px");
    expect(span.textContent).toBe(text);
  }
  rerender(<><FontPreview style={style} text={text} size={64} lines={2} label="字体卡片" />
    <div className="inspector-preview"><FontPreview style={style} text={text} size={64} lines={6} label="侧边栏" priority="selected" /></div></>);
  await act(async () => { await new Promise<void>((done) => window.requestAnimationFrame(() => done())); });
  for (const span of container.querySelectorAll<HTMLElement>(".font-preview-text")) expect(span.style.fontSize).toBe("64px");
  expect(loadPreviewFont).toHaveBeenCalledTimes(1);
});

it("离开页面后在途字体不再构造或注册", async () => {
  let resolve!: (font: Awaited<ReturnType<typeof loadPreviewFont>>) => void;
  vi.mocked(loadPreviewFont).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const construct = vi.spyOn(globalThis, "FontFace");
  const { unmount } = render(<FontPreview style={currentPreviewStyle(family("old"))} text="Aa" size={48} lines={2} label="旧字体" />);
  await waitFor(() => expect(loadPreviewFont).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => resolve({ bytes: new Uint8Array([0, 1, 0, 0]), coverage: [[32, 126]], sample: "Aa" }));
  expect(construct).not.toHaveBeenCalled();
});

it("浏览器拒绝字体后共享原生预览，缺字不使整个预览失败", async () => {
  vi.spyOn(FontFace.prototype, "load").mockRejectedValue(new Error("拒绝字体"));
  const style = currentPreviewStyle(family("fallback"));
  const { container, unmount } = render(<><FontPreview style={style} text="Aa 中文" size={48} lines={2} label="一" />
    <FontPreview style={style} text="Aa 中文" size={48} lines={2} label="二" /></>);
  await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
  expect(renderPreviews).toHaveBeenCalledTimes(1);
  unmount();
  const again = render(<FontPreview style={style} text="Aa 中文" size={48} lines={2} label="再次预览" />);
  await waitFor(() => expect(again.container.querySelectorAll("img")).toHaveLength(1));
  expect(loadPreviewFont).toHaveBeenCalledTimes(1);
  expect(renderPreviews).toHaveBeenCalledTimes(1);
});

it("字符覆盖二分查找包含区间边界与非 BMP 字符", () => {
  const ranges: [number, number][] = [[32, 126], [0x1f600, 0x1f601]];
  for (const value of [32, 126, 0x1f600, 0x1f601]) expect(coversCodepoint(ranges, value)).toBe(true);
  for (const value of [31, 127, 0x4e2d, 0x1f602]) expect(coversCodepoint(ranges, value)).toBe(false);
});
