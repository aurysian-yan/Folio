import { describe, expect, it, vi } from "vitest";
import { PreviewCache, PreviewScheduler } from "./preview-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

describe("字体预览调度与缓存", () => {
  it("选中已经排队的字面时提升优先级并使用交互槽", async () => {
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, () => {});
    const gate = deferred<{ value: string; bytes: number }>();
    const a = cache.acquire("a", "visible", () => gate.promise);
    const b = cache.acquire("b", "visible", () => gate.promise);
    const load = vi.fn(async () => ({ value: "chosen", bytes: 1 }));
    const chosen = cache.acquire("chosen", "nearby", load);
    await flush();
    expect(load).not.toHaveBeenCalled();
    chosen.setPriority("selected");
    expect(await chosen.promise).toBe("chosen");
    expect(load).toHaveBeenCalledTimes(1);
    gate.resolve({ value: "done", bytes: 1 });
    await Promise.all([a.promise, b.promise]);
  });

  it("后台并发为二，选中请求使用保留槽，并优先于邻近预加载", async () => {
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, () => {});
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<{ value: string; bytes: number }>>>();
    const request = (id: string, priority: "visible" | "nearby" | "selected") => cache.acquire(id, priority, async () => {
      started.push(id);
      const gate = deferred<{ value: string; bytes: number }>();
      gates.set(id, gate);
      return gate.promise;
    });
    const a = request("a", "visible");
    const b = request("b", "visible");
    const c = request("c", "nearby");
    await flush();
    expect(started).toEqual(["a", "b"]);
    const chosen = request("chosen", "selected");
    await flush();
    expect(started).toEqual(["a", "b", "chosen"]);
    gates.get("chosen")!.resolve({ value: "chosen", bytes: 1 });
    await chosen.promise;
    await flush();
    expect(started).not.toContain("c");
    gates.get("a")!.resolve({ value: "a", bytes: 1 });
    await a.promise;
    await flush();
    expect(started).toContain("c");
    gates.get("b")!.resolve({ value: "b", bytes: 1 });
    gates.get("c")!.resolve({ value: "c", bytes: 1 });
    await Promise.all([b.promise, c.promise]);
  });

  it("共享字面请求，释放幂等，排队请求离屏后不执行", async () => {
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, () => {});
    const load = vi.fn(async () => ({ value: "a", bytes: 1 }));
    const a = cache.acquire("a", "visible", load);
    const shared = cache.acquire("a", "selected", load);
    a.release(); a.release();
    await shared.promise;
    expect(load).toHaveBeenCalledTimes(1);
    const unusedLoad = vi.fn(async () => ({ value: "unused", bytes: 1 }));
    const unused = cache.acquire("unused", "nearby", unusedLoad);
    unused.release();
    await expect(unused.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(unusedLoad).not.toHaveBeenCalled();
  });

  it("最后一个使用者离开后丢弃在途结果，重新进入可再次请求", async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, dispose);
    const gate = deferred<{ value: string; bytes: number }>();
    const request = cache.acquire("a", "visible", () => gate.promise);
    await flush();
    request.release();
    gate.resolve({ value: "a", bytes: 1 });
    await expect(request.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(dispose).toHaveBeenCalledWith("a");
    const next = cache.acquire("a", "visible", async () => ({ value: "new", bytes: 1 }));
    expect(await next.promise).toBe("new");
  });

  it("字节预算回收闲置项，活跃字体保留，释放后回收超额项", async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<string>(new PreviewScheduler(), 6, 64, dispose);
    const a = cache.acquire("a", "visible", async () => ({ value: "a", bytes: 4 }));
    await a.promise;
    const b = cache.acquire("b", "visible", async () => ({ value: "b", bytes: 4 }));
    await b.promise;
    expect(cache.snapshot().bytes).toBe(8);
    expect(dispose).not.toHaveBeenCalled();
    a.release();
    expect(dispose).toHaveBeenCalledWith("a");
    expect(cache.snapshot().bytes).toBe(4);
    b.release();
  });

  it("缓存失效后旧请求不能污染新请求，错误允许重试", async () => {
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, () => {});
    const gate = deferred<{ value: string; bytes: number }>();
    const old = cache.acquire("a", "visible", () => gate.promise);
    await flush(); cache.invalidate();
    const current = cache.acquire("a", "visible", async () => ({ value: "new", bytes: 1 }));
    gate.resolve({ value: "old", bytes: 3 });
    await expect(old.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(await current.promise).toBe("new");
    expect(cache.snapshot().bytes).toBe(1);
    const bad = cache.acquire("bad", "visible", async () => { throw new Error("损坏字体"); });
    await expect(bad.promise).rejects.toThrow("损坏字体");
    expect(await cache.acquire("bad", "visible", async () => ({ value: "ok", bytes: 1 })).promise).toBe("ok");
  });

  it("连续浏览数百个字面后缓存仍有界，并保留选中字面", async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<string>(new PreviewScheduler(), 128, 64, dispose);
    const selected = cache.acquire("selected", "selected", async () => ({ value: "selected", bytes: 4 }));
    await selected.promise;
    for (let index = 0; index < 512; index += 1) {
      const request = cache.acquire(String(index), "visible", async () => ({ value: String(index), bytes: index < 256 ? 1 : 16 }));
      await request.promise;
      request.release();
      expect(cache.snapshot().entries).toBeLessThanOrEqual(64);
      expect(cache.snapshot().bytes).toBeLessThanOrEqual(128);
    }
    expect(dispose).not.toHaveBeenCalledWith("selected");
    expect(cache.snapshot()).toMatchObject({ queued: 0, loading: 0 });
    selected.release();
    cache.invalidate();
    expect(cache.snapshot()).toEqual({ entries: 0, bytes: 0, queued: 0, loading: 0 });
    expect(dispose).toHaveBeenCalledTimes(513);
  });
});
