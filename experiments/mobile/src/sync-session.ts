import { syncErrorKey, type SyncState } from './sync.ts';

interface SyncClient {
  state(): Promise<SyncState>;
  start(): Promise<boolean>;
  cancel(): Promise<void>;
}
export interface SyncView { state: SyncState | null; readError: string | null; actionError: string | null; busy: boolean }

// 前台调度与写入共用一个任务门，后台和旧轮询不能回写当前页面。
export class ForegroundSyncSession<Snapshot> {
  view: SyncView = { state: null, readError: null, actionError: null, busy: false };
  private listeners = new Set<(view: SyncView, snapshot?: Snapshot) => void>();
  private active = false;
  private epoch = 0;
  private revision = 0;
  private pendingWrites = 0;
  private selectingImport = false;
  private writeTail: Promise<unknown> = Promise.resolve();
  private reading: Promise<SyncState | undefined> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation: number | null = null;
  private dirty = true;
  private retryAt = 0;
  private failures = 0;
  private cancelled = false;
  private forceSnapshot = true;
  private requested = false;

  private client: SyncClient;
  private snapshot: () => Promise<Snapshot>;
  constructor(client: SyncClient, snapshot: () => Promise<Snapshot>) {
    this.client = client; this.snapshot = snapshot;
  }
  subscribe(listener: (view: SyncView, snapshot?: Snapshot) => void) {
    this.listeners.add(listener); listener(this.view);
    return () => { this.listeners.delete(listener); };
  }
  private publish(snapshot?: Snapshot) { this.listeners.forEach((listener) => listener(this.view, snapshot)); }
  get blocked() { return this.selectingImport || this.view.busy || !!this.view.state?.status.isRunning || this.pendingWrites > 0; }
  reserveImport(): (() => void) | null {
    if (!this.active || this.blocked) return null;
    this.selectingImport = true; this.view = { ...this.view }; this.publish();
    let released = false;
    // 系统选择器返回前保留任务门，前台补同步不能抢先丢弃导入选择。
    return () => {
      if (released) return;
      released = true; this.selectingImport = false; this.view = { ...this.view }; this.publish();
    };
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active; this.epoch++; clearTimeout(this.timer);
    if (!active) {
      this.dirty = true; this.requested = false;
      // 原生生命周期同时取消，确保 JS 暂停后传输也会停止。
      void this.client.cancel().catch(() => undefined);
    } else {
      this.cancelled = false; this.retryAt = 0; this.forceSnapshot = true;
      void this.tick();
    }
  }
  private async tick() {
    if (!this.active) return;
    try { await this.refresh(); } catch { /* 页面显示读取错误。 */ }
    if (!this.active) return;
    if (!this.blocked && !this.view.readError && this.dirty && !this.cancelled
      && (this.requested || this.view.state?.profile?.automatic) && this.view.state?.credentialAvailable && Date.now() >= this.retryAt) {
      await this.start(true);
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.tick(); }, this.view.state?.status.isRunning ? 400 : 1500);
  }
  refresh(): Promise<SyncState | undefined> {
    if (this.reading) return this.reading;
    const epoch = this.epoch;
    const revision = this.revision;
    this.reading = (async () => {
      try {
        const next = await this.client.state();
        if (!this.active || epoch !== this.epoch || revision !== this.revision) return;
        const complete = this.generation !== null && next.status.completionGeneration !== this.generation;
        const directoryReady = next.status.isRunning && ['下载字体', '上传字体'].includes(next.status.stage)
          && next.status.stage !== this.view.state?.status.stage;
        const needsSnapshot = directoryReady || (!next.status.isRunning && (complete || this.generation === null || this.forceSnapshot));
        const snapshot = needsSnapshot ? await this.snapshot() : undefined;
        if (!this.active || epoch !== this.epoch || revision !== this.revision) return;
        if (complete && next.status.phase === '同步失败') {
          this.dirty = true; this.failures++;
          this.retryAt = next.status.errorMessage?.includes('认证失败') ? Infinity : Date.now() + Math.min(60000, 3000 * 2 ** Math.min(this.failures, 4));
        } else if (complete && next.status.phase === '已同步') { this.failures = 0; }
        if (snapshot !== undefined) this.forceSnapshot = false;
        this.generation = next.status.completionGeneration;
        this.view = { ...this.view, state: next, readError: null }; this.publish(snapshot);
        return next;
      } catch (error) {
        if (this.active && epoch === this.epoch && revision === this.revision) {
          this.view = { ...this.view, readError: syncErrorKey(error) === 'cloud.passwordUnavailable' ? 'cloud.passwordUnavailable' : 'cloud.readStatusError' };
          this.publish();
        }
        throw error;
      } finally { this.reading = null; }
    })();
    return this.reading;
  }
  async run(action: () => Promise<unknown>, changed = false) {
    if (!this.active || this.blocked) return false;
    this.revision++;
    this.view = { ...this.view, busy: true, actionError: null }; this.publish();
    const epoch = this.epoch;
    try {
      await action();
      return true;
    } catch (error) {
      if (this.active && epoch === this.epoch) this.view = { ...this.view, actionError: syncErrorKey(error) };
      return false;
    } finally {
      // 即使操作部分完成后失败，也重新读取真实字体来源与用户状态。
      this.revision++;
      if (changed) { this.dirty = true; this.cancelled = false; this.retryAt = 0; }
      this.forceSnapshot = true;
      try {
        if (this.reading) await this.reading.catch(() => undefined);
        await this.refresh();
      } catch { /* 页面显示读取错误。 */ }
      this.view = { ...this.view, busy: false }; this.publish();
    }
  }
  async start(automatic = false) {
    if (!this.active || this.blocked) return false;
    this.revision++;
    this.view = { ...this.view, busy: true, actionError: null }; this.publish();
    const epoch = this.epoch;
    const revision = this.revision;
    try {
      const started = await this.client.start();
      if (epoch !== this.epoch) { await this.client.cancel(); return false; }
      if (started) { this.requested = false; if (revision === this.revision) this.dirty = false; }
      this.cancelled = false;
      if (this.reading) await this.reading.catch(() => undefined);
      await this.refresh(); return started;
    } catch (error) {
      if (this.active && epoch === this.epoch) this.view = { ...this.view, actionError: syncErrorKey(error) };
      if (automatic) { this.dirty = true; this.retryAt = Date.now() + 30000; }
      return false;
    } finally { this.view = { ...this.view, busy: false }; this.publish(); }
  }
  requestSync() {
    this.dirty = true; this.requested = true; this.cancelled = false;
    if (this.active) void this.tick();
  }
  async cancel() {
    this.cancelled = true; this.requested = false;
    try { await this.client.cancel(); await this.refresh(); }
    catch (error) { this.view = { ...this.view, actionError: syncErrorKey(error) }; this.publish(); }
  }
  async mutate<T>(action: () => Promise<T>, kind: 'import' | 'state' = 'state'): Promise<T> {
    if (kind === 'import' && (this.view.busy || this.view.state?.status.isRunning || this.pendingWrites > 0)) throw new Error('ERR_FOLIO_BUSY');
    this.pendingWrites++; this.revision++; this.view = { ...this.view }; this.publish();
    const previous = this.writeTail;
    const result = (async () => {
      await previous.catch(() => undefined);
      // 用户意图按调用顺序保留，在 Rust 本轮合并结束后提交。
      while ((await this.client.state()).status.isRunning || this.view.busy) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return action();
    })();
    this.writeTail = result;
    try {
      const value = await result;
      this.dirty = true; this.cancelled = false; this.retryAt = 0;
      return value;
    } finally { this.pendingWrites--; this.revision++; this.view = { ...this.view }; this.publish(); }
  }
}
