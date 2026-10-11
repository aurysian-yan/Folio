import { fireEvent, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CharacterMap } from './CharacterMap';
import { family } from '../test/fixtures';
import { previewStyles } from '../font-preview';
import { characterMap } from '../api';

vi.mock('../api', () => ({ characterMap: { open: vi.fn(), query: vi.fn(), render: vi.fn(), close: vi.fn(async () => {}) } }));
vi.mock('../font-preview', async (original) => {
  const module = await original<typeof import('../font-preview')>();
  return { previewStyles: module.previewStyles };
});
beforeEach(() => {
  vi.mocked(characterMap.open).mockResolvedValue({ handle: 'map-1', revisionId: 'revision', sourcePath: '/sample.ttf', faceIndex: 0, count: 600, scripts: [] });
  vi.mocked(characterMap.query).mockImplementation(async ({ text, offset }) => ({
    entries: Array.from({ length: text ? 1 : 256 }, (_, index) => ({ codepoint: text ? 0x1f600 : offset + 32 + index, glyphId: index + 1, script: 'Common' })), total: text ? 1 : 600, offset,
  }));
  vi.mocked(characterMap.render).mockImplementation(async ({ glyphIds }) => glyphIds.map((glyphId) => ({ glyphId, status: 'empty', dataUrl: null, error: null })));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillStyle: '', fillRect() {}, getImageData: () => ({ data: [255, 255, 255, 255] }) } as unknown as CanvasRenderingContext2D);
});

it('网格只挂载邻近可见行，精确检索和关闭会话可用', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  const style = document.createElement('style');
  style.textContent = '.character-map-grid { --character-cell-size: 6rem; }';
  document.head.append(style);
  const item = family('sample'); item.faces[0]!.sources = [{ path: '/sample.ttf', faceIndex: 0 }];
  const close = vi.fn();
  const screen = render(<CharacterMap family={item} initialStyle={previewStyles(item)[0]!} onClose={close} onDownload={vi.fn()} />);
  await waitFor(() => expect(document.querySelectorAll('[data-codepoint]').length).toBeGreaterThan(0));
  expect(document.querySelectorAll('[data-codepoint]').length).toBeLessThan(60);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '😀' } });
  await waitFor(() => expect(document.querySelector('[data-codepoint="128512"]')).not.toBeNull());
  expect(characterMap.query).toHaveBeenLastCalledWith(expect.objectContaining({ text: '😀', offset: 0, limit: 256 }));
  screen.unmount();
  style.remove();
  expect(characterMap.close).toHaveBeenCalledWith('map-1');
});
