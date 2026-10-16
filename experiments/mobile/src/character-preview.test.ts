import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CharacterGlyph, CharacterRenderRequest } from '../../../shared/character-map.ts';
import { CharacterPreviewRenderer } from './character-preview.ts';

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
