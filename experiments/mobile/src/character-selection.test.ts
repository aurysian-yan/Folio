import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CharacterPreviewRenderer, characterMatchesQuery, firstNonEmptyCharacter, mergeCharacterPage } from '../../../shared/character-preview.ts';
import type { CharacterEntry, CharacterGlyph, CharacterPage, CharacterRenderRequest } from '../../../shared/character-map.ts';

const entries = (start: number, count: number): CharacterEntry[] => Array.from({ length: count }, (_, index) => ({ codepoint: start + index, glyphId: start + index, script: 'Common' }));
const image = (glyphId: number, status: CharacterGlyph['status']): CharacterGlyph => ({ glyphId, status, dataUrl: status === 'ready' ? `glyph:${glyphId}` : null, error: status === 'error' ? 'characterMap.error.renderFailed' : null });
const options = { text: '', script: '', axes: { wght: 400 }, foreground: [0, 0, 0, 255] as CharacterRenderRequest['foreground'] };

test('按码点跳过实际空白和单字形错误，跨页查找首个非空字形', async () => {
  const requests: number[] = [];
  const renderer = new CharacterPreviewRenderer({ render: async ({ glyphIds }) => glyphIds.map((id) => image(id, id === 289 ? 'ready' : id === 288 ? 'error' : 'empty')) });
  const pages: CharacterPage[] = [];
  const session = { query: async ({ offset }: { offset: number }) => { requests.push(offset); return { entries: entries(32 + offset, 4), total: 260, offset }; } };
  const selected = await firstNonEmptyCharacter({ ...options, session, renderer, page: { entries: entries(32, 256), total: 260, offset: 0 }, current: () => true, onPage: (page) => pages.push(page) });
  assert.equal(selected?.codepoint, 289);
  assert.deepEqual(requests, [256]);
  assert.equal(pages[0]!.entries.length, 260);
});

test('复用已绘制缓存且全部空白时保持未选中', async () => {
  let renders = 0;
  const renderer = new CharacterPreviewRenderer({ render: async ({ glyphIds }) => { renders++; return glyphIds.map((id) => image(id, 'empty')); } });
  const page = { entries: entries(32, 16), total: 16, offset: 0 };
  await renderer.render({ ...options, glyphIds: page.entries.map((entry) => entry.glyphId), size: 128 });
  const selected = await firstNonEmptyCharacter({ ...options, session: { query: async () => { throw new Error('不应查询'); } }, renderer, page, current: () => true, onPage: () => {} });
  assert.equal(selected, null);
  assert.equal(renders, 1);
});

test('手动选择或退出后停止自动查找，迟到的非空结果不提交', async () => {
  let finish!: (values: CharacterGlyph[]) => void;
  let current = true;
  let calls = 0;
  const renderer = new CharacterPreviewRenderer({ render: () => { calls++; return new Promise((resolve) => { finish = resolve; }); } });
  const selection = firstNonEmptyCharacter({ ...options, session: { query: async () => { throw new Error('不应查询'); } }, renderer, page: { entries: entries(32, 40), total: 40, offset: 0 }, current: () => current, onPage: () => {} });
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  finish([image(32, 'ready')]);
  assert.equal(await selection, null);
  assert.equal(calls, 1);
});

test('来源和会话失效立即停止查找，保留可重试错误', async () => {
  const renderer = new CharacterPreviewRenderer({ render: async () => [{ ...image(32, 'error'), error: 'characterMap.error.staleSource' }] });
  await assert.rejects(firstNonEmptyCharacter({ ...options, session: { query: async () => { throw new Error('不应查询'); } }, renderer, page: { entries: entries(32, 1), total: 1, offset: 0 }, current: () => true, onPage: () => {} }), /staleSource/);
});

test('筛选匹配保留当前字符，支持空格、非 BMP 和 U+ 搜索', () => {
  const entry = { codepoint: 0x1f600, glyphId: 5, script: 'Common' };
  assert.equal(characterMatchesQuery(entry, '', ''), true);
  assert.equal(characterMatchesQuery(entry, '😀', 'Common'), true);
  assert.equal(characterMatchesQuery(entry, ' u+1F600 ', ''), true);
  assert.equal(characterMatchesQuery(entry, '', 'Latin'), false);
  assert.equal(characterMatchesQuery(entry, 'A', ''), false);
  assert.equal(characterMatchesQuery({ ...entry, codepoint: 32 }, ' ', ''), true);
});


test('自动探测与滚动分页乱序返回时不截断已加载后续字符', () => {
  const previous = { entries: entries(32, 600), total: 600, offset: 0 };
  const incoming = { entries: entries(288, 256), total: 600, offset: 256 };
  const merged = mergeCharacterPage(previous, incoming, 256);
  assert.equal(merged.entries.length, 600);
  assert.equal(merged.entries[599]!.codepoint, 631);
  assert.equal(mergeCharacterPage(previous, { ...incoming, entries: entries(32, 256), offset: 0 }, 0).entries.length, 600);
});
