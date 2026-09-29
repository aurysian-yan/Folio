import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { family } from "./test/fixtures";
import App from "./App";
import { queryLibrary, recordRecent } from "./api";

vi.mock("./components/FontPreview", () => ({ FontPreview: ({ size, label }: { size: number; label: string }) => <span data-testid="preview-font-size" data-size={size} aria-label={label} /> }));
vi.mock("@lisse/react", () => ({ useSmoothCorners: () => {}, SmoothCorners: ({ children }: { children: ReactNode }) => children }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  const families = Array.from({ length: 300 }, (_, index) => family(String(index)));
  return {
    ...actual,
    queryLibrary: vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => ({ families: families.slice(offset, offset + limit), totalMatches: 300, facets: [], isLoading: false })),
    refreshLibrary: vi.fn(async () => ({ familyCount: 300, faceCount: 300, recentCount: 0, roots: [], fontStateCounts: {}, userFontGroups: [],
      health: { damagedFiles: 0, duplicateSources: 0, multipleRevisions: 0, metadataConflicts: 0 } })),
    recordRecent: vi.fn(async () => 1),
    listCollections: vi.fn(async () => []), listSmartFolders: vi.fn(async () => []),
    getSyncProfile: vi.fn(async () => null), listCloudFonts: vi.fn(async () => []),
    getSyncStatus: vi.fn(async () => ({ configured: false, running: false, phase: "", stage: "", percent: 0, stageCompleted: 0, stageTotal: 0,
      uploadedFiles: 0, downloadedFiles: 0, publishedEvents: 0, items: [], error: null })),
  };
});

beforeEach(() => { localStorage.clear(); });
afterEach(() => { window.history.replaceState(null, "", "/"); });

it("选择后续页字体不查询列表、不丢失后续页或选中项", async () => {
  const { getByRole, getByText, container } = render(<App />);
  await waitFor(() => expect(getByText("显示 120 / 300")).toBeTruthy());
  await waitFor(() => expect(getByRole("button", { name: "加载更多" }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(getByRole("button", { name: "加载更多" }));
  await waitFor(() => expect(getByText("显示 240 / 300")).toBeTruthy());
  const first = getByRole("button", { name: "选择 字体 0" });
  first.focus();
  fireEvent.keyDown(first, { key: "End" });
  await waitFor(() => expect(getByRole("button", { name: "选择 字体 239" })).toBeTruthy());
  const queries = vi.mocked(queryLibrary).mock.calls.length;
  fireEvent.click(getByRole("button", { name: "选择 字体 239" }));
  await waitFor(() => expect(recordRecent).toHaveBeenCalledWith("239"));
  expect(vi.mocked(queryLibrary).mock.calls.length).toBe(queries);
  expect(getByText("显示 240 / 300")).toBeTruthy();
  expect(container.querySelector('.font-card[data-family-id="239"]')?.classList.contains("selected")).toBe(true);
  expect(container.querySelectorAll(".font-card").length).toBeLessThan(40);
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
  for (const preview of container.querySelectorAll("[data-testid='preview-font-size']")) expect(preview.getAttribute("data-size")).toBe("49");
});

it("独立设置窗口读取保存的字号，并同步主窗口发来的更新", async () => {
  localStorage.setItem("folio-preview-size", "72");
  window.history.replaceState(null, "", "?window=settings");
  const { getByRole } = render(<App />);
  fireEvent.click(getByRole("tab", { name: "显示" }));
  const slider = getByRole("slider", { name: "预览字号" }) as HTMLInputElement;
  expect(slider.value).toBe("72");
  slider.focus();
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  fireEvent.keyUp(slider, { key: "ArrowRight" });
  await waitFor(() => expect(localStorage.getItem("folio-preview-size")).toBe("73"));
  fireEvent(window, new StorageEvent("storage", { key: "folio-preview-size", newValue: "48" }));
  await waitFor(() => expect(slider.value).toBe("48"));
});
