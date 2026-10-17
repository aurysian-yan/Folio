import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CharacterGlyph, CharacterRenderRequest } from '../../../shared/character-map.ts';
import { CharacterPreviewRenderer } from './character-preview.ts';
import { interpolateCharacterAxes, renderCharacterAxisTransition } from '../../../shared/character-preview.ts';

type Request = Omit<CharacterRenderRequest, 'handle'>;
const request = (glyphIds: number[], axes = { wght: 400 }): Request => ({ glyphIds, axes, size: 128, foreground: [0, 0, 0, 255] });
const glyph = (glyphId: number): CharacterGlyph => ({ glyphId, status: 'ready', dataUrl: `data:${glyphId}`, error: null });
const tick = () => new Promise((resolve) => setImmediate(resolve));

function controlled() {
  const calls: { request: Request; resolve: (images: CharacterGlyph[]) => void; reject: (error: Error) => void }[] = [];
  const renderer = new CharacterPreviewRenderer({ render: (value) => new Promise((resolve, reject) => calls.push({ request: value, resolve, reject })) });
  return { renderer, calls };
}

test('滚动复用已加载字形，仅补充缺失字形，返回完整请求结果', async () => {
  const calls: number[][] = [];
  const renderer = new CharacterPreviewRenderer({ render: async (value) => { calls.push(value.glyphIds); return value.glyphIds.map(glyph); } });
  await renderer.render(request([1, 2]));
  assert.deepEqual((await renderer.render(request([2, 3]))).map((value) => value.glyphId), [2, 3]);
  await renderer.render(request([1, 2]));
  assert.deepEqual(calls, [[1, 2], [3]]);
  renderer.dispose();
});

test('重复请求共享进行中的绘制，轴值键不受登记顺序影响', async () => {
  const { renderer, calls } = controlled();
  const input = { ...request([1]), axes: { wght: 400, wdth: 100 } };
  const first = renderer.render(input);
  await tick();
  const second = renderer.render({ ...input, axes: { wdth: 100, wght: 400 } });
  calls[0]!.resolve([glyph(1)]);
  assert.deepEqual(await first, [glyph(1)]);
  assert.deepEqual(await second, [glyph(1)]);
  assert.equal(calls.length, 1);
});

test('连续轴值只保留执行中和最新请求，中间请求被替换', async () => {
  const { renderer, calls } = controlled();
  const first = renderer.render(request([1], { wght: 400 }));
  await tick();
  const skipped = renderer.render(request([1], { wght: 500 }));
  const latest = renderer.render(request([1], { wght: 700 }));
  assert.deepEqual(await skipped, []);
  assert.equal(calls.length, 1);
  calls[0]!.resolve([glyph(1)]);
  await first;
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]!.request.axes, { wght: 700 });
  calls[1]!.resolve([{ ...glyph(1), dataUrl: 'latest' }]);
  assert.equal((await latest)[0]!.dataUrl, 'latest');
});

test('不同轴值、颜色和尺寸分别缓存，空白字形也可以复用', async () => {
  let calls = 0;
  const renderer = new CharacterPreviewRenderer({ render: async () => { calls++; return [{ glyphId: 1, status: 'empty', dataUrl: null, error: null }]; } });
  const inputs = [request([1]), request([1], { wght: 700 }), { ...request([1]), size: 512 }, { ...request([1]), foreground: [255, 255, 255, 255] as Request['foreground'] }];
  for (const input of inputs) { await renderer.render(input); await renderer.render(input); }
  assert.equal(calls, 4);
});

test('缓存最多保留 512 项，读取更新淘汰顺序', async () => {
  const renderer = new CharacterPreviewRenderer({ render: async (value) => value.glyphIds.map(glyph) });
  await renderer.render(request(Array.from({ length: 512 }, (_, id) => id)));
  renderer.get(request([0]));
  await renderer.render(request([512]));
  assert.equal(renderer.get(request([0])).length, 1);
  assert.equal(renderer.get(request([1])).length, 0);
  assert.equal(renderer.get(request(Array.from({ length: 513 }, (_, id) => id))).length, 512);
});

test('失败不进入缓存，可以重试；失败后继续执行最新请求', async () => {
  const { renderer, calls } = controlled();
  const first = renderer.render(request([1]));
  const failure = assert.rejects(first, /failed/);
  await tick();
  const pending = renderer.render(request([2]));
  calls[0]!.reject(new Error('failed'));
  await failure;
  await tick();
  calls[1]!.resolve([{ ...glyph(2), status: 'error', dataUrl: null, error: 'characterMap.error.renderFailed' }]);
  assert.equal((await pending)[0]!.status, 'error');
  assert.equal(renderer.get(request([2])).length, 0);
  const retry = renderer.render(request([1]));
  await tick();
  calls[2]!.resolve([glyph(1)]);
  assert.deepEqual(await retry, [glyph(1)]);
});

test('释放会话立即清空缓存并忽略晚到结果，不继续执行待处理请求', async () => {
  const { renderer, calls } = controlled();
  const first = renderer.render(request([1]));
  await tick();
  const pending = renderer.render(request([2]));
  renderer.dispose();
  assert.deepEqual(await first, []);
  assert.deepEqual(await pending, []);
  calls[0]!.resolve([glyph(1)]);
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(renderer.get(request([1])), []);
  assert.deepEqual(await renderer.render(request([2])), []);
});

test('网格分成最多 16 项，批次间优先执行最新选中预览', async () => {
  const { renderer, calls } = controlled();
  const grid = renderer.render(request(Array.from({ length: 40 }, (_, id) => id)), { channel: 'grid' });
  await tick();
  assert.equal(calls[0]!.request.glyphIds.length, 16);
  const skipped = renderer.render(request([100], { wght: 500 }), { channel: 'detail', priority: 3 });
  const detail = renderer.render(request([100], { wght: 700 }), { channel: 'detail', priority: 3 });
  assert.deepEqual(await skipped, []);
  calls[0]!.resolve(calls[0]!.request.glyphIds.map(glyph));
  await tick();
  assert.deepEqual(calls[1]!.request.glyphIds, [100]);
  assert.deepEqual(calls[1]!.request.axes, { wght: 700 });
  calls[1]!.resolve([glyph(100)]);
  assert.deepEqual(await detail, [glyph(100)]);
  await tick();
  calls[2]!.resolve(calls[2]!.request.glyphIds.map(glyph));
  await tick();
  calls[3]!.resolve(calls[3]!.request.glyphIds.map(glyph));
  assert.equal((await grid).length, 40);
  assert.ok(calls.every((call) => call.request.glyphIds.length <= 16));
});

test('重新拖动取消网格剩余批次，已执行图片仍保留在缓存', async () => {
  const { renderer, calls } = controlled();
  const grid = renderer.render(request(Array.from({ length: 40 }, (_, id) => id)), { channel: 'grid' });
  await tick();
  renderer.cancel('grid');
  assert.deepEqual(await grid, []);
  const detail = renderer.render(request([100]), { channel: 'detail', priority: 3 });
  calls[0]!.resolve(calls[0]!.request.glyphIds.map(glyph));
  await tick();
  assert.equal(renderer.get(request([0])).length, 1);
  assert.deepEqual(calls[1]!.request.glyphIds, [100]);
  calls[1]!.resolve([glyph(100)]);
  await detail;
  assert.equal(calls.length, 2);
});

test('桥接漏返字形不会无限绘制，失败可以重新请求', async () => {
  let calls = 0;
  const renderer = new CharacterPreviewRenderer({ render: async () => { calls++; return calls === 1 ? [] : [glyph(1)]; } });
  assert.equal((await renderer.render(request([1])))[0]!.status, 'error');
  assert.equal(calls, 1);
  assert.equal((await renderer.render(request([1])))[0]!.status, 'ready');
});


test('严格模式效果重新挂载不会提前释放渲染器，真正卸载后释放', async () => {
  const renderer = new CharacterPreviewRenderer({ render: async ({ glyphIds }) => glyphIds.map(glyph) });
  renderer.retain();
  renderer.release();
  renderer.retain();
  await tick();
  assert.deepEqual(await renderer.render(request([1])), [glyph(1)]);
  renderer.release();
  await tick();
  assert.deepEqual(renderer.get(request([1])), []);
  assert.deepEqual(await renderer.render(request([1])), []);
});


test('轴值过渡使用真实中间坐标，缓出并准确到达最终值', async (context) => {
  let now = 0;
  context.mock.method(Date, 'now', () => now);
  const axes: number[] = [];
  const renderer = new CharacterPreviewRenderer({ render: async (request) => { axes.push(request.axes.wght!); now += 100; return request.glyphIds.map(glyph); } });
  await renderCharacterAxisTransition(renderer, request([1], { wght: 800 }), { from: { wght: 400 }, defaults: { wght: 400 }, reducedMotion: false, current: () => true, onProgress: () => {}, onAxes: () => {} });
  assert.ok(axes.length > 1 && axes.length <= 4);
  assert.ok(axes[0]! > 400 && axes[0]! < 800);
  assert.equal(axes.at(-1), 800);
  assert.ok(axes.every((value, index) => !index || value > axes[index - 1]!));
  assert.deepEqual(interpolateCharacterAxes({}, { wght: 800 }, { wght: 400 }, 0.5), { wght: 750 });
});

test('减少动态效果仅绘制最终轴值，再次拖动立即停止后续过渡帧', async () => {
  const axes: number[] = [];
  const renderer = new CharacterPreviewRenderer({ render: async (request) => { axes.push(request.axes.wght!); return request.glyphIds.map(glyph); } });
  await renderCharacterAxisTransition(renderer, request([1], { wght: 800 }), { from: { wght: 400 }, defaults: { wght: 400 }, reducedMotion: true, current: () => true, onProgress: () => {}, onAxes: () => {} });
  assert.deepEqual(axes, [800]);
  let current = true;
  await renderCharacterAxisTransition(renderer, request([1], { wght: 600 }), { from: { wght: 400 }, defaults: { wght: 400 }, reducedMotion: false, current: () => current,
    onProgress: () => { current = false; }, onAxes: () => {},
  });
  assert.equal(axes.length, 2);
  assert.ok(axes[1]! > 400 && axes[1]! < 600);
});
