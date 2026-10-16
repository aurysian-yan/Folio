import type { CharacterGlyph, CharacterMapSession, CharacterRenderRequest } from '../../../shared/character-map.ts';

export const characterPreviewCapacity = 512;

type Request = Omit<CharacterRenderRequest, 'handle'>;
type Job = { request: Request; key: string; promise: Promise<CharacterGlyph[]>; resolve: (value: CharacterGlyph[]) => void; reject: (error: unknown) => void };

// 每个预览通道只保留正在执行与最新待处理请求，缓存随会话释放。
export class CharacterPreviewRenderer {
  private cache = new Map<string, CharacterGlyph>();
  private active: Job | null = null;
  private pending: Job | null = null;
  private disposed = false;
  private session: Pick<CharacterMapSession, 'render'>;
  private capacity: number;

  constructor(session: Pick<CharacterMapSession, 'render'>, capacity = characterPreviewCapacity) {
    this.session = session;
    this.capacity = capacity;
  }

  private key(request: Request, glyphId: number) {
    return JSON.stringify([glyphId, Object.entries(request.axes).sort(([a], [b]) => a.localeCompare(b)), request.foreground, request.size]);
  }

  get(request: Request): CharacterGlyph[] {
    return [...new Set(request.glyphIds)].flatMap((id) => {
      const key = this.key(request, id);
      const value = this.cache.get(key);
      if (!value) return [];
      this.cache.delete(key);
      this.cache.set(key, value);
      return [value];
    });
  }

  render(request: Request): Promise<CharacterGlyph[]> {
    if (this.disposed) return Promise.resolve([]);
    const key = JSON.stringify([[...new Set(request.glyphIds)].sort((a, b) => a - b), this.key(request, 0)]);
    if (this.active?.key === key) {
      this.pending?.resolve([]);
      this.pending = null;
      return this.active.promise;
    }
    if (this.pending?.key === key) return this.pending.promise;
    this.pending?.resolve([]);
    this.pending = null;
    const cached = this.get(request);
    if (cached.length === new Set(request.glyphIds).size) return Promise.resolve(cached);
    let resolve!: Job['resolve'];
    let reject!: Job['reject'];
    const promise = new Promise<CharacterGlyph[]>((done, fail) => { resolve = done; reject = fail; });
    this.pending = { request, key, promise, resolve, reject };
    this.pump();
    return promise;
  }

  private pump() {
    if (this.active || !this.pending || this.disposed) return;
    const job = this.pending;
    this.pending = null;
    this.active = job;
    const missing = [...new Set(job.request.glyphIds)].filter((id) => !this.cache.has(this.key(job.request, id)));
    const rendering = Promise.resolve().then(() => !this.disposed && missing.length ? this.session.render({ ...job.request, glyphIds: missing }) : []);
    rendering.then((values) => {
      if (this.disposed) return;
      for (const value of values) {
        if (value.status === 'error') continue;
        const key = this.key(job.request, value.glyphId);
        this.cache.delete(key);
        this.cache.set(key, value);
      }
      while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
      const byId = new Map([...this.get(job.request), ...values].map((value) => [value.glyphId, value]));
      this.active = null;
      job.resolve(job.request.glyphIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []));
      this.pump();
    }, (error: unknown) => {
      this.active = null;
      if (!this.disposed) job.reject(error);
      this.pump();
    });
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.active?.resolve([]);
    this.pending?.resolve([]);
    this.pending = null;
  }
}
