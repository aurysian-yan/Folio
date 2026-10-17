import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CharacterMap } from './CharacterMap';
import { family } from '../test/fixtures';
import { previewStyles } from '../font-preview';
import { characterMap } from '../api';
import { StrictMode } from 'react';
import type { ClaralightSliderProps } from './ClaralightSlider';

const gridBottom = (count: number) => {
  return Math.ceil(count / 4) * 96 - 400;
};

vi.mock('./ClaralightSlider', () => ({ ClaralightSlider: ({ value, min, max, onValueChange, onValueChangeStart, onValueChangeEnd, 'aria-label': label }: ClaralightSliderProps) =>
  <input type="range" aria-label={label} min={min} max={max} value={value} onPointerDown={() => onValueChangeStart?.()}
    onChange={(event) => onValueChange?.(Number(event.currentTarget.value))}
    onPointerUp={(event) => onValueChangeEnd?.(Number(event.currentTarget.value))}
    onPointerCancel={(event) => onValueChangeEnd?.(Number(event.currentTarget.value))} /> }));

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

const readyGlyph = (glyphId: number, value = 'initial') => ({ glyphId, status: 'ready' as const, dataUrl: `data:image/png;base64,${value}`, error: null });
function smallMap() {
  vi.mocked(characterMap.query).mockImplementation(async ({ text }) => ({ entries: text ? [{ codepoint: 66, glyphId: 2, script: 'Latin' }] : [
    { codepoint: 32, glyphId: 3, script: 'Common' }, { codepoint: 65, glyphId: 1, script: 'Latin' }, { codepoint: 66, glyphId: 2, script: 'Latin' },
  ], total: text ? 1 : 3, offset: 0 }));
  vi.mocked(characterMap.render).mockImplementation(async ({ glyphIds }) => glyphIds.map((id) => id === 3 ? { glyphId: id, status: 'empty', dataUrl: null, error: null } : readyGlyph(id)));
  const item = family('variable');
  item.faces[0]!.sources = [{ path: '/sample.ttf', faceIndex: 0 }];
  item.faces[0]!.variableAxes = [{ tag: 'wght', minValue: 100, defaultValue: 400, maxValue: 900 }];
  return item;
}

it('默认跳过空白字符，筛选保留有效手动选择，否则重选非空字符', async () => {
  const item = smallMap();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('[data-codepoint="65"]')?.getAttribute('aria-pressed')).toBe('true'));
  fireEvent.click(document.querySelector('[data-codepoint="66"]')!);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'B' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="66"]')?.getAttribute('aria-pressed')).toBe('true'));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="65"]')).not.toBeNull());
  expect(document.querySelector('[data-codepoint="66"]')?.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(document.querySelector('[data-codepoint="65"]')!);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'B' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="66"]')?.getAttribute('aria-pressed')).toBe('true'));
});

it('关闭自动选择后重进仍未选中，空白字符可以手动选择', async () => {
  const item = smallMap();
  const props = { family: item, initialStyle: previewStyles(item)[0]!, onClose: vi.fn(), onDownload: vi.fn(), autoSelectFirstNonEmpty: false };
  const screen = render(<CharacterMap {...props} />);
  await waitFor(() => expect(document.querySelector('[data-codepoint="32"]')).not.toBeNull());
  expect(document.querySelector('[aria-pressed="true"][data-codepoint]')).toBeNull();
  expect(document.querySelector('[data-codepoint="32"]')?.getAttribute('tabindex')).toBe('0');
  fireEvent.click(document.querySelector('[data-codepoint="32"]')!);
  await waitFor(() => expect(screen.getByText('空白字形')).toBeTruthy());
  screen.unmount();
  render(<CharacterMap {...props} />);
  await waitFor(() => expect(document.querySelector('[data-codepoint="32"]')).not.toBeNull());
  expect(document.querySelector('[aria-pressed="true"][data-codepoint]')).toBeNull();
});

it('拖动只刷新选中预览，保留已加载图像，中间帧持续回显，松手再更新列表', async () => {
  const item = smallMap();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('.character-map-detail img')).not.toBeNull());
  await act(async () => { fireEvent.load(document.querySelector('.character-map-detail img')!); });
  const initial = screen.getByAltText('U+0041');
  const grid = document.querySelector('.character-map-grid');
  const queries = vi.mocked(characterMap.query).mock.calls.length;
  const opens = vi.mocked(characterMap.open).mock.calls.length;
  const finish: { request: Parameters<typeof characterMap.render>[0]; resolve: (values: Awaited<ReturnType<typeof characterMap.render>>) => void }[] = [];
  vi.mocked(characterMap.render).mockClear();
  vi.mocked(characterMap.render).mockImplementation((request) => new Promise((resolve) => { finish.push({ request, resolve }); }));
  const slider = screen.getByRole('slider', { name: 'wght' });
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: '500' } });
  await waitFor(() => expect(finish.length).toBe(1));
  let detailIndex = 0;
  if (finish[0]!.request.size !== 512) {
    await act(async () => { finish[0]!.resolve(finish[0]!.request.glyphIds.map((id) => readyGlyph(id, 'middle'))); });
    await waitFor(() => expect(finish.length).toBe(2));
    detailIndex = 1;
  }
  expect(finish[detailIndex]!.request.size).toBe(512);
  fireEvent.change(slider, { target: { value: '600' } });
  fireEvent.change(slider, { target: { value: '700' } });
  expect(initial.isConnected).toBe(true);
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,initial');
  await act(async () => { finish[detailIndex]!.resolve(finish[detailIndex]!.request.glyphIds.map((id) => readyGlyph(id, 'middle'))); });
  await waitFor(() => expect(document.querySelector('.character-map-detail img.opacity-0')?.getAttribute('src')).toBe('data:image/png;base64,middle'));
  await act(async () => { fireEvent.load(document.querySelector('.character-map-detail img.opacity-0')!); });
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,middle');
  expect(finish.every(({ request }) => request.glyphIds.every((id) => id === 1))).toBe(true);
  expect(finish.some(({ request }) => request.axes.wght === 600)).toBe(false);
  fireEvent.pointerUp(slider);
  for (let index = detailIndex + 1; index < 20; index++) {
    await waitFor(() => expect(finish[index]).toBeDefined());
    await act(async () => {
      const pending = finish[index];
      pending?.resolve(pending.request.glyphIds.map((id) => readyGlyph(id, 'final')));
    });
    if (finish.some(({ request }) => request.glyphIds.includes(2) && request.axes.wght === 700)) break;
  }
  await waitFor(() => expect(finish.some(({ request }) => request.glyphIds.includes(2) && request.axes.wght === 700)).toBe(true));
  expect(document.querySelector('.character-map-grid')).toBe(grid);
  expect(vi.mocked(characterMap.query).mock.calls.length).toBe(queries);
  expect(vi.mocked(characterMap.open).mock.calls.length).toBe(opens);
  for (const pending of finish) pending.resolve(pending.request.glyphIds.map((id) => readyGlyph(id, 'final')));
});

it('预览更新失败保留旧图并支持重试，最终空白结果清除旧图', async () => {
  const item = smallMap();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('.character-map-detail img')).not.toBeNull());
  await act(async () => { fireEvent.load(document.querySelector('.character-map-detail img')!); });
  vi.mocked(characterMap.render).mockRejectedValue(new Error('characterMap.error.renderFailed'));
  fireEvent.change(screen.getByRole('slider', { name: 'wght' }), { target: { value: '700' } });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,initial');
  vi.mocked(characterMap.render).mockImplementation(async ({ glyphIds }) => glyphIds.map((glyphId) => ({ glyphId, status: 'empty', dataUrl: null, error: null })));
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByText('空白字形')).toBeTruthy());
  expect(screen.queryByAltText('U+0041')).toBeNull();
});


it('连续图片更新保留正在解码的中间帧，加载失败仍保留旧图并可重试', async () => {
  const item = smallMap();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelector('.character-map-detail img')).not.toBeNull());
  await act(async () => { fireEvent.load(document.querySelector('.character-map-detail img')!); });
  vi.mocked(characterMap.render).mockImplementation(async ({ glyphIds, axes }) => glyphIds.map((id) => readyGlyph(id, String(axes.wght))));
  const slider = screen.getByRole('slider', { name: 'wght' });
  fireEvent.change(slider, { target: { value: '500' } });
  await waitFor(() => expect(document.querySelector('.character-map-detail img.opacity-0')?.getAttribute('src')).toBe('data:image/png;base64,500'));
  const middle = document.querySelector('.character-map-detail img.opacity-0')!;
  fireEvent.change(slider, { target: { value: '700' } });
  await waitFor(() => expect(characterMap.render).toHaveBeenCalledWith(expect.objectContaining({ axes: { wght: 700 }, size: 512 })));
  expect(middle.isConnected).toBe(true);
  await act(async () => { fireEvent.load(middle); });
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,500');
  await waitFor(() => expect(document.querySelector('.character-map-detail img.opacity-0')?.getAttribute('src')).toBe('data:image/png;base64,700'));
  fireEvent.error(document.querySelector('.character-map-detail img.opacity-0')!);
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,500');
  fireEvent.click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(document.querySelector('.character-map-detail img.opacity-0')?.getAttribute('src')).toBe('data:image/png;base64,700'));
  await act(async () => { fireEvent.load(document.querySelector('.character-map-detail img.opacity-0')!); });
  expect(screen.getByAltText('U+0041').getAttribute('src')).toBe('data:image/png;base64,700');
});


it('严格模式重新挂载效果后仍能绘制与自动选择字符', async () => {
  const item = smallMap();
  const screen = render(<StrictMode><CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={vi.fn()} onDownload={vi.fn()} /></StrictMode>);
  await waitFor(() => expect(document.querySelector('[data-codepoint="65"]')?.getAttribute('aria-pressed')).toBe('true'));
  await waitFor(() => expect(document.querySelector('.character-map-detail img')).not.toBeNull());
  screen.unmount();
});
