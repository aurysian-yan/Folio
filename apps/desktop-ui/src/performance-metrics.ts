type Metric = "selection-feedback" | "preview-ready" | "font-ipc" | "font-decode" | "font-face-load" | "query-library" | "longtask";
const enabled = import.meta.env.DEV || import.meta.env.VITE_FOLIO_PERFORMANCE === "1";
const samples = new Map<Metric, number[]>();

function record(name: Metric, duration: number) {
  if (!enabled) return;
  const values = samples.get(name) ?? [];
  values.push(duration);
  if (values.length > 1000) values.shift();
  samples.set(name, values);
}

export function startMetric(name: Metric) {
  if (!enabled) return () => {};
  const start = performance.now();
  let finished = false;
  return () => { if (!finished) { finished = true; record(name, performance.now() - start); } };
}

// 指标仅保存在本机内存；开发构建默认启用，发布采样需显式开启构建变量。
export function installPerformanceMetrics(cacheStats: () => unknown) {
  if (!enabled) return;
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) record("longtask", entry.duration);
    }).observe({ type: "longtask", buffered: true });
  }
  const metrics = {
    reset: () => samples.clear(),
    snapshot: () => ({
      metrics: Object.fromEntries([...samples].map(([name, values]) => {
        const ordered = [...values].sort((a, b) => a - b);
        return [name, { count: ordered.length, p95Ms: ordered[Math.ceil(ordered.length * 0.95) - 1], totalMs: values.reduce((sum, value) => sum + value, 0) }];
      })),
      cache: cacheStats(),
      mountedCards: document.querySelectorAll(".font-card").length,
      registeredFonts: document.fonts.size,
    }),
  };
  Object.assign(window, { folioPerformance: metrics });
}
