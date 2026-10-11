import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CharacterMap } from './CharacterMap';
import { family } from '../test/fixtures';
import { previewStyles } from '../font-preview';
import { characterMap } from '../api';

const gridBottom = (count: number) => {
  return Math.ceil(count / 4) * 96 - 400;
};

vi.mock('../api', () => ({ characterMap: { open: vi.fn(), query: vi.fn(), render: vi.fn(), close: vi.fn(async () => {}) } }));
vi.mock('../font-preview', async (original) => {
  const module = await original<typeof import('../font-preview')>();
  return { previewStyles: module.previewStyles };
});
beforeEach(() => {
  vi.mocked(characterMap.open).mockResolvedValue({ handle: 'map-1', revisionId: 'revision', sourcePath: '/sample.ttf', faceIndex: 0, count: 600, scripts: [] });
  vi.mocked(characterMap.query).mockImplementation(async ({ text, offset }) => ({
    entries: Array.from({ length: text ? 1 : Math.min(256, 600 - offset) }, (_, index) => ({ codepoint: text ? 0x1f600 : offset + 32 + index, glyphId: index + 1, script: 'Common' })), total: text ? 1 : 600, offset,
  }));
  vi.mocked(characterMap.render).mockImplementation(async ({ glyphIds }) => glyphIds.map((glyphId) => ({ glyphId, status: 'empty', dataUrl: null, error: null })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect() {}, getImageData: () => ({ data: [255, 255, 255, 255] }) } as unknown as CanvasRenderingContext2D);
});

it('网格只挂载邻近可见行，精确检索和关闭会话可用', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const item = family('sample'); item.faces[0]!.sources = [{ path: '/sample.ttf', faceIndex: 0 }];
  const close = vi.fn();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={close} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelectorAll('[data-codepoint]').length).toBeGreaterThan(0));
  expect(document.querySelectorAll('[data-codepoint]').length).toBeLessThan(60);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '😀' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="128512"]')).not.toBeNull());
  expect(characterMap.query).toHaveBeenLastCalledWith(expect.objectContaining({ text: '😀', offset: 0, limit: 256 }));
  screen.unmount();
  expect(characterMap.close).toHaveBeenCalledWith('map-1');
});


it('连续滚动自动加载全部字符，保留选择和滚动位置，标题显示字符数', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const item = family('continuous'); item.faces[0]!.sources = [{ path: '/sample.ttf', faceIndex: 0 }];
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('[data-codepoint="33"]')).not.toBeNull());
  expect(screen.getByRole('heading', { name: item.displayName })).toBeTruthy();
  expect(screen.getByText('600 个字符').closest('header')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '上一页' })).toBeNull();
  expect(screen.queryByRole('button', { name: '下一页' })).toBeNull();
  fireEvent.click(document.querySelector('[data-codepoint="33"]')!);
  const grid = document.querySelector<HTMLElement>('.character-map-grid')!;
  fireEvent.scroll(grid, { target: { scrollTop: gridBottom(256) } });
  await waitFor(() => expect(characterMap.query).toHaveBeenCalledWith(expect.objectContaining({ offset: 256 })));
  await waitFor(() => expect(document.querySelector('[data-codepoint="288"]')).not.toBeNull());
  expect(document.querySelector('.character-map-grid')).toBe(grid);
  expect(grid.scrollTop).toBe(gridBottom(256));
  fireEvent.scroll(grid, { target: { scrollTop: gridBottom(512) } });
  await waitFor(() => expect(characterMap.query).toHaveBeenCalledWith(expect.objectContaining({ offset: 512 })));
  await waitFor(() => expect(document.querySelector('[data-codepoint="544"]')).not.toBeNull());
  fireEvent.scroll(grid, { target: { scrollTop: gridBottom(600) } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="631"]')).not.toBeNull());
  expect(characterMap.query).not.toHaveBeenCalledWith(expect.objectContaining({ offset: 600 }));
  fireEvent.scroll(grid, { target: { scrollTop: 0 } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="33"]')?.getAttribute('aria-pressed')).toBe('true'));
  expect(document.querySelectorAll('[data-codepoint]').length).toBeLessThan(60);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '😀' } });
  await waitFor(() => expect(screen.getByText('1 个字符').closest('header')).not.toBeNull());
  expect(document.querySelector('[data-codepoint="128512"]')).not.toBeNull();
});

it('追加加载失败可重试，搜索后忽略迟到的追加结果', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const query = vi.mocked(characterMap.query).getMockImplementation()!;
  let fail = true;
  let finish: ((value: Awaited<ReturnType<typeof characterMap.query>>) => void) | undefined;
  vi.mocked(characterMap.query).mockImplementation((request) => {
    if (request.offset === 256 && fail) { fail = false; return Promise.reject(new Error('characterMap.error.sourceUnavailable')); }
    if (request.offset === 256) return new Promise((resolve) => { finish = resolve; });
    return query(request);
  });
  const item = family('retry'); item.faces[0]!.sources = [{ path: '/sample.ttf', faceIndex: 0 }];
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('[data-codepoint="32"]')).not.toBeNull());
  fireEvent.scroll(document.querySelector('.character-map-grid')!, { target: { scrollTop: gridBottom(256) } });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(document.querySelector('[data-codepoint="287"]')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '😀' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="128512"]')).not.toBeNull());
  finish!(await query({ handle: 'map-1', text: '', script: null, offset: 256, limit: 256 }));
  await waitFor(() => expect(screen.getByText('1 个字符')).toBeTruthy());
  expect(document.querySelector('[data-codepoint="288"]')).toBeNull();
});
