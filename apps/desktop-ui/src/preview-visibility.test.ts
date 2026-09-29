import { afterEach, expect, it, vi } from "vitest";
import { observePreviewVisibility } from "./preview-visibility";

const original = globalThis.IntersectionObserver;
afterEach(() => { vi.stubGlobal("IntersectionObserver", original); });

it("共享可见区和邻近区观察器，跨边界时更新优先级，离开后清理观察", () => {
  const instances: { options?: IntersectionObserverInit; emit: (target: Element, visible: boolean) => void; observer: IntersectionObserver }[] = [];
  vi.stubGlobal("IntersectionObserver", vi.fn(function (callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(), takeRecords: () => [], root: options?.root ?? null, rootMargin: options?.rootMargin ?? "0px", thresholds: [0] };
    instances.push({ options, observer, emit: (target, visible) => callback([{ target, isIntersecting: visible } as IntersectionObserverEntry], observer) });
    return observer;
  }));
  const root = document.createElement("div");
  root.className = "font-grid";
  const first = document.createElement("span");
  const second = document.createElement("span");
  root.append(first, second);
  const watcher = vi.fn();
  const stopFirst = observePreviewVisibility(first, watcher);
  const stopSecond = observePreviewVisibility(second, () => {});
  expect(instances).toHaveLength(2);
  const nearby = instances.find((item) => item.options?.rootMargin)!;
  const visible = instances.find((item) => !item.options?.rootMargin)!;
  nearby.emit(first, true);
  expect(watcher).not.toHaveBeenCalled();
  visible.emit(first, false);
  visible.emit(first, true);
  nearby.emit(first, true);
  visible.emit(first, false);
  nearby.emit(first, false);
  expect(watcher.mock.calls.map(([value]) => value)).toEqual(["nearby", "visible", "nearby", null]);
  stopFirst();
  visible.emit(first, true);
  expect(watcher).toHaveBeenCalledTimes(4);
  for (const { observer } of instances) {
    expect(observer.unobserve).toHaveBeenCalledWith(first);
    expect(observer.disconnect).not.toHaveBeenCalled();
  }
  stopSecond();
  for (const { observer } of instances) expect(observer.disconnect).toHaveBeenCalledOnce();
});
