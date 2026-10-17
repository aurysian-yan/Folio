import { characterPageSize, type CharacterEntry, type CharacterGlyph, type CharacterMapSession, type CharacterPage, type CharacterRenderRequest } from './character-map.ts';

export const characterPreviewCapacity = 512;
export const characterPreviewBatchSize = 16;
type Request = Omit<CharacterRenderRequest, 'handle'>;
type Options = { channel?: string; priority?: number; onProgress?: (values: CharacterGlyph[]) => void };
type Job = {
  request: Request; key: string; channel: string; priority: number; values: Map<number, CharacterGlyph>;
  promise: Promise<CharacterGlyph[]>; resolve: (value: CharacterGlyph[]) => void; reject: (error: unknown) => void;
  onProgress?: Options['onProgress']; cancelled?: boolean;
};

// 会话共享优先队列；每个通道只保留执行中与最新请求，批次之间让出选中预览。
export class CharacterPreviewRenderer {
  private cache = new Map<string, CharacterGlyph>();
  private active: Job | null = null;
  private pending = new Map<string, Job>();
  private disposed = false;
  private leases = 0;
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

  render(request: Request, { channel = 'default', priority = 0, onProgress }: Options = {}): Promise<CharacterGlyph[]> {
    if (this.disposed) return Promise.resolve([]);
    const key = JSON.stringify([[...new Set(request.glyphIds)].sort((a, b) => a - b), this.key(request, 0)]);
    if (this.active?.channel === channel && this.active.key === key && !this.active.cancelled) {
      this.pending.get(channel)?.resolve([]);
      this.pending.delete(channel);
      return this.active.promise;
    }
    const pending = this.pending.get(channel);
    if (pending?.key === key) return pending.promise;
    pending?.resolve([]);
    this.pending.delete(channel);
    const cached = this.get(request);
    if (cached.length === new Set(request.glyphIds).size) return Promise.resolve(cached);
    let resolve!: Job['resolve'];
    let reject!: Job['reject'];
    const promise = new Promise<CharacterGlyph[]>((done, fail) => { resolve = done; reject = fail; });
    this.pending.set(channel, { request, key, channel, priority, promise, resolve, reject, onProgress, values: new Map(cached.map((value) => [value.glyphId, value])) });
    this.pump();
    return promise;
  }

  cancel(channel: string) {
    this.pending.get(channel)?.resolve([]);
    this.pending.delete(channel);
    if (this.active?.channel === channel) {
      this.active.cancelled = true;
      this.active.resolve([]);
    }
  }

  private pump() {
    if (this.active || !this.pending.size || this.disposed) return;
    const job = [...this.pending.values()].sort((a, b) => b.priority - a.priority)[0]!;
    this.pending.delete(job.channel);
    this.active = job;
    const missing = [...new Set(job.request.glyphIds)].filter((id) => !job.values.has(id)).slice(0, characterPreviewBatchSize);
    Promise.resolve().then(() => !this.disposed && !job.cancelled && missing.length ? this.session.render({ ...job.request, glyphIds: missing }) : []).then((values) => {
      if (this.disposed) return;
      for (const value of values) {
        job.values.set(value.glyphId, value);
        if (value.status === 'error') continue;
        const key = this.key(job.request, value.glyphId);
        this.cache.delete(key);
        this.cache.set(key, value);
      }
      while (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value!);
      this.active = null;
      // 缺失返回值视为本次失败，防止异常桥接响应造成无限重试。
      for (const glyphId of missing) if (!job.values.has(glyphId)) job.values.set(glyphId, { glyphId, status: 'error', dataUrl: null, error: 'characterMap.error.renderFailed' });
      if (!job.cancelled) job.onProgress?.(values);
      const complete = job.request.glyphIds.every((id) => job.values.has(id));
      if (!job.cancelled && !complete && !this.pending.has(job.channel)) this.pending.set(job.channel, job);
      else job.resolve(job.cancelled || !complete ? [] : job.request.glyphIds.map((id) => job.values.get(id)!));
      this.pump();
    }, (error: unknown) => {
      this.active = null;
      if (!this.disposed && !job.cancelled) job.reject(error);
      this.pump();
    });
  }

  // 延后释放兼容 React 严格模式的效果清理与重新挂载。
  retain() { this.leases++; }
  release() {
    this.leases--;
    void Promise.resolve().then(() => { if (this.leases === 0) this.dispose(); });
  }

  dispose() {
    this.disposed = true;
    this.cache.clear();
    this.active?.resolve([]);
    for (const job of this.pending.values()) job.resolve([]);
    this.pending.clear();
  }
}

// 自动探测和滚动分页可并行返回，合并时保留已追加的后续条目。
export function mergeCharacterPage(previous: CharacterPage | undefined, incoming: CharacterPage, offset: number): CharacterPage {
  if (!previous) return incoming;
  return { ...incoming, entries: [...previous.entries.slice(0, offset), ...incoming.entries, ...previous.entries.slice(offset + incoming.entries.length)].slice(0, incoming.total) };
}

export function characterMatchesQuery(entry: CharacterEntry, text: string, script: string) {
  if (script && entry.script !== script) return false;
  if (!text) return true;
  const match = /^u\+([0-9a-f]{1,6})$/i.exec(text.trim());
  return match ? entry.codepoint === parseInt(match[1]!, 16) : String.fromCodePoint(entry.codepoint) === text;
}

// 按码点逐批探测真实像素；分页追加沿用现有列表，取消后不再提交结果。
export async function firstNonEmptyCharacter({ session, renderer, page: initial, text, script, axes, foreground, current, onPage }: {
  session: Pick<CharacterMapSession, 'query'>; renderer: CharacterPreviewRenderer; page: CharacterPage;
  text: string; script: string; axes: Record<string, number>; foreground: Request['foreground'];
  current: () => boolean; onPage: (page: CharacterPage) => void;
}): Promise<CharacterEntry | null> {
  let page = initial;
  let index = 0;
  while (current()) {
    while (index < page.entries.length && current()) {
      const entries = page.entries.slice(index, index + characterPreviewBatchSize);
      const values = await renderer.render({ glyphIds: entries.map((entry) => entry.glyphId), axes, foreground, size: 128 }, { channel: 'auto-select', priority: 1 });
      if (!current() || !values.length) return null;
      const byId = new Map(values.map((value) => [value.glyphId, value]));
      const fatal = values.find((value) => value.status === 'error' && /\.(sourceUnavailable|staleSource|sessionClosed|invalidFont|invalidAxes)$/.test(value.error ?? ''));
      if (fatal) throw new Error(fatal.error!);
      const entry = entries.find((entry) => byId.get(entry.glyphId)?.status === 'ready');
      if (entry) return entry;
      index += entries.length;
    }
    if (!current() || page.entries.length >= page.total) break;
    const next = await session.query({ text, script: script || null, offset: page.entries.length, limit: characterPageSize });
    if (!current() || !next.entries.length) break;
    page = { ...next, entries: [...page.entries, ...next.entries] };
    onPage(page);
  }
  return null;
}

export const characterAxisTransitionDuration = 180;

export function interpolateCharacterAxes(from: Record<string, number>, to: Record<string, number>, defaults: Record<string, number>, progress: number) {
  const eased = 1 - Math.pow(1 - Math.max(0, Math.min(1, progress)), 3);
  return Object.fromEntries([...new Set([...Object.keys(from), ...Object.keys(to)])].map((tag) => {
    const start = from[tag] ?? defaults[tag] ?? to[tag]!;
    const end = to[tag] ?? defaults[tag] ?? start;
    return [tag, start + (end - start) * eased];
  }));
}

// 松手后最多绘制四个真实轴值帧；较慢批次跳过中间帧，始终提交最终值。
export async function renderCharacterAxisTransition(renderer: CharacterPreviewRenderer, request: Request, {
  from, defaults, reducedMotion, current, onProgress, onAxes,
}: {
  from: Record<string, number> | null; defaults: Record<string, number>; reducedMotion: boolean;
  current: () => boolean; onProgress: (values: CharacterGlyph[], animated: boolean) => void;
  onAxes: (axes: Record<string, number>) => void;
}) {
  const different = from && Object.keys({ ...from, ...request.axes }).some((tag) => (from[tag] ?? defaults[tag]) !== (request.axes[tag] ?? defaults[tag]));
  const animate = !!different && !reducedMotion;
  const started = Date.now();
  let step = animate ? 1 : 4;
  while (current()) {
    if (animate) {
      const delay = Math.max(0, (step - 1) * characterAxisTransitionDuration / 4 - (Date.now() - started));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!current()) return;
    }
    const axes = step === 4 ? request.axes : interpolateCharacterAxes(from!, request.axes, defaults, step / 4);
    const values = await renderer.render({ ...request, axes }, { channel: 'grid', onProgress: (values) => { if (current()) onProgress(values, animate); } });
    if (!current() || !values.length) return;
    onProgress(values, animate);
    onAxes(axes);
    if (step === 4) return;
    step = Math.min(4, Math.max(step + 1, Math.floor((Date.now() - started) * 4 / characterAxisTransitionDuration) + 1));
  }
}
