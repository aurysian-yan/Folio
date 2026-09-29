export type PreviewPriority = "selected" | "visible" | "nearby";
const rank: Record<PreviewPriority, number> = { selected: 0, visible: 1, nearby: 2 };
const cancelled = () => new DOMException("预览请求已取消", "AbortError");

type Job = { priority: number; run: () => Promise<void>; started: boolean };

// 后台最多两个任务，交互请求可使用额外的保留槽。
export class PreviewScheduler {
  private queue: Job[] = [];
  private background = 0;
  private interactive = 0;
  private scheduled = false;

  enqueue(run: () => Promise<void>, priority: number) {
    const job: Job = { run, priority, started: false };
    this.queue.push(job);
    this.schedule();
    return {
      cancel: () => {
        if (job.started) return false;
        this.queue = this.queue.filter((item) => item !== job);
        return true;
      },
      setPriority: (priority: number) => { job.priority = priority; this.schedule(); },
    };
  }

  private schedule() {
    if (this.scheduled) return;
    this.scheduled = true;
    queueMicrotask(() => { this.scheduled = false; this.pump(); });
  }

  private pump() {
    this.queue.sort((a, b) => a.priority - b.priority);
    while (this.queue.length) {
      const job = this.queue[0];
      const interactive = job.priority === 0 && this.interactive < 1;
      if (!interactive && this.background >= 2) return;
      this.queue.shift();
      job.started = true;
      if (interactive) this.interactive += 1; else this.background += 1;
      void job.run().finally(() => {
        if (interactive) this.interactive -= 1; else this.background -= 1;
        this.schedule();
      });
    }
  }
}

interface Entry<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  subscribers: Map<symbol, number>;
  usedAt: number;
  status: "queued" | "loading" | "ready";
  invalidated: boolean;
  value?: T;
  bytes: number;
  task?: ReturnType<PreviewScheduler["enqueue"]>;
}

export class PreviewCache<T> {
  private entries = new Map<string, Entry<T>>();
  private bytes = 0;
  private tick = 0;
  private scheduler: PreviewScheduler;
  private budget: number;
  private limit: number;
  private dispose: (value: T) => void;

  constructor(
    scheduler: PreviewScheduler,
    budget: number,
    limit: number,
    dispose: (value: T) => void,
  ) {
    this.scheduler = scheduler;
    this.budget = budget;
    this.limit = limit;
    this.dispose = dispose;
  }

  acquire(key: string, priority: PreviewPriority, load: (wanted: () => boolean) => Promise<{ value: T; bytes: number }>) {
    let entry = this.entries.get(key);
    if (!entry) {
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
      void promise.catch(() => {});
      entry = { promise, resolve, reject, subscribers: new Map(), usedAt: ++this.tick, status: "queued", invalidated: false, bytes: 0 };
      this.entries.set(key, entry);
      const created = entry;
      const wanted = () => !created.invalidated && created.subscribers.size > 0;
      created.task = this.scheduler.enqueue(async () => {
        created.status = "loading";
        try {
          if (!wanted()) throw cancelled();
          const result = await load(wanted);
          if (!wanted()) { this.dispose(result.value); throw cancelled(); }
          created.status = "ready";
          created.value = result.value;
          created.bytes = result.bytes;
          this.bytes += result.bytes;
          created.resolve(result.value);
          this.trim();
        } catch (error) {
          if (this.entries.get(key) === created) this.entries.delete(key);
          created.reject(error);
        }
      }, rank[priority]);
    }
    const acquired = entry;
    const subscriber = Symbol();
    acquired.subscribers.set(subscriber, rank[priority]);
    acquired.usedAt = ++this.tick;
    const updatePriority = () => acquired.task?.setPriority(Math.min(...acquired.subscribers.values()));
    updatePriority();
    return {
      promise: acquired.promise,
      setPriority: (priority: PreviewPriority) => {
        if (!acquired.subscribers.has(subscriber)) return;
        acquired.subscribers.set(subscriber, rank[priority]);
        updatePriority();
      },
      release: () => {
        if (!acquired.subscribers.delete(subscriber)) return;
        acquired.usedAt = ++this.tick;
        if (acquired.subscribers.size === 0 && acquired.status === "queued" && acquired.task?.cancel()) {
          if (this.entries.get(key) === acquired) this.entries.delete(key);
          acquired.reject(cancelled());
        } else { updatePriority(); }
        this.trim();
      },
    };
  }

  invalidate() {
    for (const entry of this.entries.values()) {
      entry.invalidated = true;
      if (entry.status === "ready" && entry.value !== undefined) this.dispose(entry.value);
      if (entry.status === "queued" && entry.task?.cancel()) entry.reject(cancelled());
    }
    this.entries.clear();
    this.bytes = 0;
  }

  snapshot() {
    return {
      entries: this.entries.size,
      bytes: this.bytes,
      queued: [...this.entries.values()].filter((entry) => entry.status === "queued").length,
      loading: [...this.entries.values()].filter((entry) => entry.status === "loading").length,
    };
  }

  private trim() {
    if (this.bytes <= this.budget && this.entries.size <= this.limit) return;
    const unused = [...this.entries.entries()].filter(([, entry]) => entry.status === "ready" && entry.subscribers.size === 0)
      .sort((a, b) => a[1].usedAt - b[1].usedAt);
    for (const [key, entry] of unused) {
      if (this.bytes <= this.budget && this.entries.size <= this.limit) break;
      if (entry.value !== undefined) this.dispose(entry.value);
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
}
