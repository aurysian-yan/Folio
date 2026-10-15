import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FontFace } from './library.ts';
import { characterGridLayout, characterSheetLayout, fontSourceOptions } from './character-map-layout.ts';

test('窄屏、手机和平板网格包含完整的左右缩进和格间距', () => {
  for (const width of [280, 360, 393, 768, 1024]) {
    const { columns, cellWidth } = characterGridLayout(width);
    assert.ok(cellWidth >= 80);
    assert.ok(Math.abs(columns * cellWidth + (columns - 1) * 8 + 24 - width) < 0.01);
  }
});

test('卡片按摘要高度收起，展开受可用高度限制，极矮窗口不生成重复档位', () => {
  assert.deepEqual(characterSheetLayout(168, 160, 800, 100, 40), { collapsed: 192, snapPoints: [192, 368] });
  const constrained = characterSheetLayout(168, 900, 800, 100, 40);
  assert.ok(Math.abs(constrained.snapPoints[1]! - 462) < 0.01);
  const compact = characterSheetLayout(200, 900, 300, 100, 40);
  assert.equal(compact.snapPoints.length, 1);
  assert.equal(compact.collapsed, 112);
});

test('多来源去重并保留原始路径，重名使用最短目录后缀区分', () => {
  const paths = ['/data/private/fonts/a/Sample.ttf', '/data/private/fonts/b/Sample.ttf', '/other/Regular.otf'];
  const face: FontFace = { id: 'regular', identityId: 'font', revisionId: 'v1', styleName: 'Regular', faceIndex: 0,
    sourcePath: paths[0]!, axes: [], location: { state: 'excluded', localAvailable: true, cloudAvailable: false,
      cloudConfirmedAtMs: null, metadataComplete: true, files: [{ fingerprint: 'file', filename: 'Sample.ttf', fileSize: 1,
        faceIndex: 0, cloudAvailable: false, uploadExcluded: true, downloadPolicy: 'onDemand', transferAction: null,
        transferStatus: null, transferError: null, localSources: paths.map((path) => ({ path, kind: 'managed', previewSource: false })) }] } };
  assert.deepEqual(fontSourceOptions(face, () => 'Folio 字体库'), [
    { value: paths[0], label: 'a/Sample.ttf · Folio 字体库' },
    { value: paths[1], label: 'b/Sample.ttf · Folio 字体库' },
    { value: paths[2], label: 'Regular.otf · Folio 字体库' },
  ]);
  assert.deepEqual(fontSourceOptions({ ...face, sourcePath: null, location: undefined }, () => ''), []);
});
