import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n from "../i18n";

// 测试固定使用简体中文，保持既有断言中的中文文案稳定。
localStorage.setItem("folio.language", "zh-CN");
await i18n.changeLanguage("zh-CN");

afterEach(() => { cleanup(); vi.useRealTimers(); });

class TestResizeObserver implements ResizeObserver {
  constructor(callback: ResizeObserverCallback) { this.callback = callback; }
  private callback: ResizeObserverCallback;
  observe(target: Element) {
    this.callback([{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry], this);
  }
  unobserve() {}
  disconnect() {}
}

class TestIntersectionObserver implements IntersectionObserver {
  constructor(callback: IntersectionObserverCallback) { this.callback = callback; }
  private callback: IntersectionObserverCallback;
  readonly root = null;
  readonly rootMargin = "100px 0px";
  readonly thresholds = [0];
  observe(target: Element) {
    queueMicrotask(() => this.callback([{ target, isIntersecting: true, boundingClientRect: target.getBoundingClientRect() } as IntersectionObserverEntry], this));
  }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
}

vi.stubGlobal("ResizeObserver", TestResizeObserver);
vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
Object.defineProperty(document, "fonts", { configurable: true, value: new Set() });
vi.stubGlobal("FontFace", class {
  constructor(family: string) { this.family = family; }
  family: string;
  load() { return Promise.resolve(this); }
});
Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn((query: string) => ({
  matches: false, media: query, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
})) });

Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get() { return 640; } });
Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get() { return 480; } });
