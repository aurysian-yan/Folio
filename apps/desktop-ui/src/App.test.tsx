import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { family } from "./test/fixtures";
import App from "./App";
import { clearCatalogCache, getStorageUsage, getSyncProfile, getSyncStatus, listSyncConflicts, openSettings, queryLibrary, quitApp, rebuildSyncIndexes, recordRecent } from "./api";

vi.mock("./components/FontPreview", () => ({ FontPreview: ({ size, label, color }: { size: number; label: string; color?: string | null }) => <span data-testid="preview-font-size" data-size={size} data-color={color ?? "default"} aria-label={label} /> }));
vi.mock("@lisse/react", () => ({ useSmoothCorners: () => {}, SmoothCorners: ({ children }: { children: ReactNode }) => children }));
// 字符滚动由浏览器验证，单元测试检查字号传递与设置同步。
vi.mock("@scritto/react", () => ({ default: ({ value }: { value: number }) => <span data-testid="preview-size-readout" aria-hidden="true">{value}</span> }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const families = Array.from({ length: 300 }, (_, index) => family(String(index)));
  return {
    ...actual,
    queryLibrary: vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({ families: families.slice(offset, offset + limit), totalMatches: 300, facets: [], isLoading: false })),
    refreshLibrary: vi.fn(async () => ({ familyCount: 300, faceCount: 300, variableFamilyCount: 0, recentCount: 0, roots: [], fontStateCounts: {}, userFontGroups: [],
      health: { damagedFiles: 0, duplicateSources: 0, multipleRevisions: 0, metadataConflicts: 0 } })),
    recordRecent: vi.fn(async () => 1),
    openSettings: vi.fn(async () => {}),
    quitApp: vi.fn(async () => {}),
    listCollections: vi.fn(async () => []), listSmartFolders: vi.fn(async () => []),
    getSyncProfile: vi.fn(async () => null), listCloudFonts: vi.fn(async () => []), listSyncConflicts: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => ({ configured: false, running: false, phase: "", stage: "", percent: 0, stageCompleted: 0, stageTotal: 0,
      uploadedFiles: 0, downloadedFiles: 0, publishedEvents: 0, items: [], error: null })),
    getStorageUsage: vi.fn(async () => ({ databaseBytes: 2048, volumeTotalBytes: 224_000_000_000, volumeFreeBytes: 124_000_000_000, managedFontBytes: 4096, catalogCacheEntries: 3, catalogCacheEstimatedBytes: 1024 })),
    clearCatalogCache: vi.fn(async () => 3),
    rebuildSyncIndexes: vi.fn(async () => {}),
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(quitApp).mockClear();
  vi.mocked(clearCatalogCache).mockClear();
  vi.mocked(rebuildSyncIndexes).mockClear();
});
afterEach(() => { window.history.replaceState(null, "", "/"); });

it.each([null, "invalid"])("未设置或无效退出快捷键 %s 时默认使用 Ctrl+Q", async (stored) => {
  if (stored !== null) localStorage.setItem("folio-quit-shortcut", stored);
  window.history.replaceState(null, "", "?window=settings");
  const { getByRole } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "快捷键" }));
  expect(getByRole("button", { name: /退出应用快捷键/ }).textContent).toBe("Ctrl+Q");
  await waitFor(() => expect(localStorage.getItem("folio-quit-shortcut")).toBe("Control+Q"));
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(quitApp).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "q", ctrlKey: true });
  expect(quitApp).toHaveBeenCalledTimes(1);
});

it("保留已保存的退出快捷键，并同步后续设置变更", async () => {
  localStorage.setItem("folio-quit-shortcut", "Control+W");
  window.history.replaceState(null, "", "?window=settings");
  render(<App />);
  fireEvent.keyDown(window, { key: "q", ctrlKey: true });
  expect(quitApp).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(quitApp).toHaveBeenCalledTimes(1);
  fireEvent(window, new StorageEvent("storage", { key: "folio-quit-shortcut", newValue: "Control+Q" }));
  await waitFor(() => expect(localStorage.getItem("folio-quit-shortcut")).toBe("Control+Q"));
  fireEvent.keyDown(window, { key: "w", ctrlKey: true });
  expect(quitApp).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(window, { key: "q", ctrlKey: true });
  expect(quitApp).toHaveBeenCalledTimes(2);
});

it("选择后续页字体不查询列表、不丢失后续页或选中项", async () => {
  const { getByRole, queryByRole, queryByText, container } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" })).toBeTruthy());
  expect(queryByText(/显示 \d+\s*\/\s*\d+/)).toBeNull();
  expect(queryByRole("button", { name: "加载更多" })).toBeNull();
  expect(container.querySelector(".pagination-row")).toBeNull();
  const list = getByRole("region", { name: "字体浏览" });
  expect(list.contains(getByRole("heading", { level: 1 }))).toBe(true);
  expect(list.contains(getByRole("button", { name: /排序方式/ }))).toBe(true);
  expect(list.contains(container.querySelector(".preview-bar"))).toBe(false);
  list.scrollTop = 3500;
  fireEvent.scroll(list);
  await waitFor(() => expect(vi.mocked(queryLibrary).mock.calls.some(([request]) => request.offset === 120)).toBe(true));
  list.scrollTop = 6000;
  fireEvent.scroll(list);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 152" })).toBeTruthy());
  const queries = vi.mocked(queryLibrary).mock.calls.length;
  fireEvent.click(getByRole("button", { name: "选择 字体 152" }));
  await waitFor(() => expect(recordRecent).toHaveBeenCalledWith("152"));
  expect(vi.mocked(queryLibrary).mock.calls.length).toBe(queries);
  expect(list.scrollTop).toBe(6000);
  expect(container.querySelector('.font-card[data-family-id="152"]')?.classList.contains("selected")).toBe(true);
  expect(container.querySelectorAll(".font-card").length).toBeLessThan(40);
});

it("搜索结果数量不覆盖 Hero 全库统计，未连接提示保持简短", async () => {
  const { getByRole, getByText } = render(<App />);
  await waitFor(() => expect(getByRole("heading", { level: 1 }).textContent).toBe("现有 300 个字族，随时可用"));
  await waitFor(() => expect(getByText("未连接云端", { selector: ".library-hero-sync span" })).toBeTruthy());
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" })).toBeTruthy());
  vi.mocked(queryLibrary).mockResolvedValueOnce({ families: [family("0")], totalMatches: 1, facets: [], isLoading: false });
  fireEvent.change(getByRole("searchbox", { name: "搜索字体" }), { target: { value: "字体 0" } });
  await waitFor(() => expect(vi.mocked(queryLibrary).mock.calls.at(-1)?.[0].text).toBe("字体 0"));
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" })).toBeTruthy());
  expect(getByRole("heading", { level: 1 }).textContent).toBe("现有 300 个字族，随时可用");
});

it("主窗口读取字体同步冲突，Hero 操作打开同步设置", async () => {
  vi.mocked(getSyncProfile).mockResolvedValueOnce({ serverUrl: "https://webdav.123pan.com", remoteDirectory: "Folio", username: "", automatic: false });
  vi.mocked(getSyncStatus).mockResolvedValueOnce({ configured: true, running: false, phase: "", stage: "", percent: 0, stageCompleted: 0, stageTotal: 0, uploadedFiles: 0, downloadedFiles: 0, publishedEvents: 0, items: [], error: null });
  vi.mocked(listSyncConflicts).mockResolvedValueOnce([{ id: "revision", kind: "font_revision", title: "字体版本冲突", detail: "", localFingerprint: "a", remoteFingerprint: "b" }]);
  const { getByRole } = render(<App />);
  const action = await waitFor(() => getByRole("button", { name: "发现 1 个字体同步冲突，处理同步冲突" }));
  fireEvent.click(action);
  await waitFor(() => expect(openSettings).toHaveBeenCalled());
});

it("保存并同步预览字号，主窗口卡片和侧边栏使用同一字号", async () => {
  localStorage.setItem("folio-preview-size", "64");
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" })).toBeTruthy());
  fireEvent.click(getByRole("button", { name: "选择 字体 0" }));
  await waitFor(() => expect(container.querySelector(".inspector-preview [data-testid='preview-font-size']")).toBeTruthy());
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("64");
  fireEvent(window, new StorageEvent("storage", { key: "folio-preview-size", newValue: "48" }));
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("48"));
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("48");
  const slider = getByRole("slider", { name: "预览字号" });
  slider.focus();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("49"));
  expect(container.querySelector(".preview-size-value")?.getAttribute("aria-label")).toBe("预览字号 49px");
  expect(container.querySelector("[data-testid='preview-size-readout']")?.textContent).toBe("49");
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("49");
});

it("独立设置窗口读取保存的字号，并同步主窗口发来的更新", async () => {
  localStorage.setItem("folio-preview-size", "72");
  window.history.replaceState(null, "", "?window=settings");
  const { getByRole, container } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "显示" }));
  const slider = getByRole("slider", { name: "预览字号" });
  expect(slider.getAttribute("aria-valuenow")).toBe("72");
  expect(slider.getAttribute("aria-valuemin")).toBe("18");
  expect(slider.getAttribute("aria-valuemax")).toBe("106");
  slider.focus();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("73"));
  fireEvent(window, new StorageEvent("storage", { key: "folio-preview-size", newValue: "48" }));
  await waitFor(() => expect(slider.getAttribute("aria-valuenow")).toBe("48"));
  expect(container.querySelector("[data-testid='preview-size-readout']")).toBeNull();
});

it("存储页统计占用并确认重建同步索引", async () => {
  window.history.replaceState(null, "", "?window=settings");
  vi.mocked(getStorageUsage).mockResolvedValueOnce({ databaseBytes: 1_617_000_000, volumeTotalBytes: 224_000_000_000, volumeFreeBytes: 124_000_000_000, managedFontBytes: 4096, catalogCacheEntries: 3, catalogCacheEstimatedBytes: 1024 });
  const { container, getByRole, getByText } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "存储" }));
  await waitFor(() => expect(getStorageUsage).toHaveBeenCalled());
  expect(getByRole("img", { name: /Folio 本地占用 1\.6 GB/ })).toBeTruthy();
  expect(getByRole("img", { name: /占用所在磁盘空间 0\.7%/ })).toBeTruthy();
  expect(container.querySelectorAll(".storage-volume-track")).toHaveLength(1);
  expect(container.querySelectorAll(".storage-volume-track span")).toHaveLength(4);
  expect(container.querySelector(".storage-volume-track span")?.classList.contains("storage-other")).toBe(true);
  expect(getByText(/其他应用与系统/)).toBeTruthy();
  expect(getByText(/可用空间/)).toBeTruthy();
  expect(getByText("98.4 GB")).toBeTruthy();
  expect(getByText("124.0 GB")).toBeTruthy();
  expect(getByText(/3 条记录/)).toBeTruthy();
  fireEvent.click(getByRole("button", { name: "清理目录缓存" }));
  await waitFor(() => expect(clearCatalogCache).toHaveBeenCalledTimes(1));
  fireEvent.click(getByRole("button", { name: "重建同步索引" }));
  expect(rebuildSyncIndexes).not.toHaveBeenCalled();
  fireEvent.click(within(getByRole("dialog", { name: "重建同步索引" })).getByRole("button", { name: "重建" }));
  await waitFor(() => expect(rebuildSyncIndexes).toHaveBeenCalledTimes(1));
});

it("设置滑块保留步长、上下限与禁用行为", async () => {
  window.history.replaceState(null, "", "?window=settings");
  const { getByRole } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "显示" }));
  const blur = getByRole("slider", { name: "模糊度" });
  fireEvent.keyDown(blur, { key: "Home" });
  expect(blur.getAttribute("aria-valuenow")).toBe("1");
  fireEvent.keyDown(blur, { key: "ArrowLeft" });
  expect(blur.getAttribute("aria-valuenow")).toBe("1");
  fireEvent.keyDown(blur, { key: "End" });
  expect(blur.getAttribute("aria-valuenow")).toBe("12");
  fireEvent.keyDown(blur, { key: "ArrowRight" });
  expect(blur.getAttribute("aria-valuenow")).toBe("12");

  fireEvent.click(getByRole("tab", { name: "字体卡片" }));
  const delay = getByRole("slider", { name: "悬停选中延时" });
  expect(delay.getAttribute("aria-valuenow")).toBe("180");
  fireEvent.keyDown(delay, { key: "ArrowRight" });
  expect(delay.getAttribute("aria-valuenow")).toBe("190");
  expect(delay.getAttribute("aria-valuetext")).toBe("190 毫秒");
  await waitFor(() => expect(localStorage.getItem("folio-card-hover-delay")).toBe("190"));
  fireEvent.click(getByRole("switch", { name: "悬停时选中字体卡片" }));
  expect(delay.getAttribute("aria-disabled")).toBe("true");
  expect(delay.hasAttribute("tabindex")).toBe(false);
  fireEvent.keyDown(delay, { key: "ArrowRight" });
  expect(delay.getAttribute("aria-valuenow")).toBe("190");
});

it("滚轮速度与 SwiftUI 使用相同范围和步长，并同步到主窗口", async () => {
  localStorage.setItem("folio-expanded-card-wheel-speed", "1.7");
  window.history.replaceState(null, "", "?window=settings");
  const { getByRole, getByText } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "字体卡片" }));
  const speed = getByRole("slider", { name: "滚轮滚动速度" });
  expect(speed.getAttribute("aria-valuemin")).toBe("0.5");
  expect(speed.getAttribute("aria-valuemax")).toBe("2");
  expect(speed.getAttribute("aria-valuenow")).toBe("1.7");
  fireEvent.keyDown(speed, { key: "ArrowRight" });
  fireEvent.keyUp(speed, { key: "ArrowRight" });
  expect(speed.getAttribute("aria-valuenow")).toBe("1.75");
  expect(getByText("1.75×")).toBeTruthy();
  await waitFor(() => expect(localStorage.getItem("folio-expanded-card-wheel-speed")).toBe("1.75"));
  fireEvent(window, new StorageEvent("storage", { key: "folio-expanded-card-wheel-speed", newValue: "0.5" }));
  await waitFor(() => expect(speed.getAttribute("aria-valuenow")).toBe("0.5"));
});

it("两位字号补淡色零，三位字号不补零，并使用 SwiftUI 字号范围", async () => {
  localStorage.setItem("folio-preview-size", "99");
  const { container, getByRole } = render(<App />);
  const slider = getByRole("slider", { name: "预览字号" });
  expect(container.querySelector(".preview-size-padding")?.textContent).toBe("0");
  expect(container.querySelector(".preview-size-value")?.textContent).toBe("099px");
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(container.querySelector(".preview-size-padding")).toBeNull();
  expect(container.querySelector(".preview-size-value")?.textContent).toBe("100px");
  fireEvent.keyDown(slider, { key: "End" });
  expect(slider.getAttribute("aria-valuenow")).toBe("106");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider.getAttribute("aria-valuenow")).toBe("18");
  expect(container.querySelector(".preview-size-value")?.textContent).toBe("018px");
  fireEvent.keyUp(slider, { key: "Home" });
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("18"));
});

it("拖动字号固定当前卡片，松手后才更新其余卡片并保存", async () => {
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" })).toBeTruthy());
  fireEvent.click(getByRole("button", { name: "选择 字体 1" }));
  const slider = getByRole("slider", { name: "预览字号" });
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const sizeOf = (id: string) => container.querySelector(`.font-card[data-family-id="${id}"] [data-testid="preview-font-size"]`)?.getAttribute("data-size");
  fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 }));
  expect(sizeOf("1")).toBe("106");
  expect(sizeOf("0")).toBe("48");
  expect(sizeOf("2")).toBe("48");
  expect(localStorage.getItem("folio-preview-size")).toBe("48");
  fireEvent.click(getByRole("button", { name: "选择 字体 2" }));
  fireEvent(slider, new MouseEvent("pointermove", { bubbles: true, clientX: 0 }));
  expect(sizeOf("1")).toBe("18");
  expect(sizeOf("2")).toBe("48");
  fireEvent(slider, new MouseEvent("pointerup", { bubbles: true, button: 0, clientX: 0 }));
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("18");
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("18"));
});

it("未选中卡片时只在首张卡片精调，键盘松开或窗口失焦后同步", async () => {
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" })).toBeTruthy());
  const slider = getByRole("slider", { name: "预览字号" });
  fireEvent.keyDown(slider, { key: "End" });
  expect(container.querySelector('.font-card[data-family-id="0"] [data-size="106"]')).toBeTruthy();
  expect(container.querySelector('.font-card[data-family-id="1"] [data-size="48"]')).toBeTruthy();
  fireEvent(window, new Event("blur"));
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("106");
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("106"));
});

it("文字色与卡片透明度只精调当前卡片，完成后同步并可恢复默认", async () => {
  localStorage.setItem("folio-preview-text-color", "#ff0000ff");
  localStorage.setItem("folio-preview-background-color", "#ffffff80");
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" })).toBeTruthy());
  fireEvent.click(getByRole("button", { name: "选择 字体 1" }));
  fireEvent.click(getByRole("button", { name: "文字颜色" }));
  const hue = await waitFor(() => getByRole("slider", { name: "色相" }));
  hue.focus();
  fireEvent.keyDown(hue, { key: "ArrowRight", keyCode: 39 });
  const colorOf = (id: string) => container.querySelector(`.font-card[data-family-id="${id}"] [data-testid="preview-font-size"]`)?.getAttribute("data-color");
  expect(colorOf("1")).not.toBe("#ff0000ff");
  expect(colorOf("0")).toBe("#ff0000ff");
  expect(localStorage.getItem("folio-preview-text-color")).toBe("#ff0000ff");
  fireEvent.keyUp(hue, { key: "ArrowRight", keyCode: 39 });
  expect(colorOf("0")).toBe(colorOf("1"));
  await waitFor(() => expect(localStorage.getItem("folio-preview-text-color")).toBe(colorOf("1")));
  fireEvent.click(getByRole("button", { name: "恢复默认文字颜色" }));
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-color")).toBe("default");
  await waitFor(() => expect(localStorage.getItem("folio-preview-text-color")).toBeNull());
  fireEvent.keyDown(getByRole("dialog", { name: "文字颜色" }), { key: "Escape" });
  await waitFor(() => expect(container.querySelector(".preview-color-trigger[aria-expanded='true']")).toBeNull());
  fireEvent.click(getByRole("button", { name: "卡片颜色" }));
  const opacity = await waitFor(() => getByRole("slider", { name: "透明度" }));
  opacity.focus();
  fireEvent.keyDown(opacity, { key: "ArrowLeft", keyCode: 37 });
  expect(container.querySelector<HTMLElement>('.font-card[data-family-id="1"]')?.style.backgroundColor).not.toBe("rgba(255, 255, 255, 0.5)");
  expect(container.querySelector<HTMLElement>('.font-card[data-family-id="0"]')?.style.backgroundColor).toBe("rgba(255, 255, 255, 0.5)");
  expect(localStorage.getItem("folio-preview-background-color")).toBe("#ffffff80");
  fireEvent.keyUp(opacity, { key: "ArrowLeft", keyCode: 37 });
  const background = container.querySelector<HTMLElement>('.font-card[data-family-id="1"]')?.style.backgroundColor;
  for (const card of container.querySelectorAll<HTMLElement>(".font-card")) expect(card.style.backgroundColor).toBe(background);
  await waitFor(() => expect(localStorage.getItem("folio-preview-background-color")?.toLowerCase()).toBe("#ffffff73"));
});

it("图标预设菜单显示选中标记，选取样例或输入文字后更新当前类型", async () => {
  const { getByRole } = render(<App />);
  fireEvent.click(getByRole("button", { name: "预览文字类型" }));
  const selected = await waitFor(() => getByRole("menuitemradio", { name: "全字母句" }));
  expect(selected.getAttribute("aria-checked")).toBe("true");
  fireEvent.click(getByRole("menuitemradio", { name: "数字" }));
  const input = getByRole("textbox", { name: "自定义预览文字" });
  expect((input as HTMLInputElement).value).toBe("0123456789");
  fireEvent.change(input, { target: { value: "Folio" } });
  fireEvent.click(getByRole("button", { name: "预览文字类型" }));
  expect((await waitFor(() => getByRole("menuitemradio", { name: "自定义" }))).getAttribute("aria-checked")).toBe("true");
});

it("成熟拾色面板拖动时仅更新当前卡片，面板外松手仍提交最后颜色", async () => {
  localStorage.setItem("folio-preview-text-color", "#ff0000ff");
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 1" })).toBeTruthy());
  fireEvent.click(getByRole("button", { name: "选择 字体 1" }));
  fireEvent.click(getByRole("button", { name: "文字颜色" }));
  const hue = await waitFor(() => getByRole("slider", { name: "色相" }));
  vi.spyOn(hue, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 20 } as DOMRect);
  const colorOf = (id: string) => container.querySelector(`.font-card[data-family-id="${id}"] [data-testid="preview-font-size"]`)?.getAttribute("data-color");
  fireEvent.pointerDown(hue);
  fireEvent.mouseDown(hue, { clientX: 50, clientY: 10, buttons: 1 });
  expect(colorOf("1")?.toLowerCase()).not.toBe("#ff0000ff");
  expect(colorOf("0")).toBe("#ff0000ff");
  fireEvent.mouseMove(window, { clientX: 75, clientY: 10, buttons: 1 });
  const finalColor = colorOf("1");
  expect(colorOf("0")).toBe("#ff0000ff");
  expect(localStorage.getItem("folio-preview-text-color")).toBe("#ff0000ff");
  fireEvent.mouseUp(window);
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-color")).toBe(finalColor);
  await waitFor(() => expect(localStorage.getItem("folio-preview-text-color")).toBe(finalColor));
});

it.each(["pointercancel", "lostpointercapture"])("字号拖动发生 %s 时提交最后值", async (eventName) => {
  const { container, getByRole } = render(<App />);
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 0" })).toBeTruthy());
  const slider = getByRole("slider", { name: "预览字号" });
  slider.setPointerCapture = vi.fn();
  slider.releasePointerCapture = vi.fn();
  fireEvent(slider, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 500 }));
  expect(container.querySelector('.font-card[data-family-id="1"] [data-size="48"]')).toBeTruthy();
  fireEvent(slider, new MouseEvent(eventName, { bubbles: true }));
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("106");
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("106"));
});

it.each([["17", "18"], ["120", "106"]])("保存的字号 %s 按 SwiftUI 范围裁剪为 %s", async (stored, expected) => {
  localStorage.setItem("folio-preview-size", stored);
  const { getByRole } = render(<App />);
  const slider = getByRole("slider", { name: "预览字号" });
  expect(slider.getAttribute("aria-valuenow")).toBe(expected);
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe(expected));
});
