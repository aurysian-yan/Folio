import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FontFace } from './library.ts';
import { adjustableAxes, axisStep, clampAxisValue, defaultAxisValues, formatAxisValue, snapAxisValue, stepFaceId } from './font-details.ts';

function face(id: string, axes: FontFace['axes'] = []): FontFace {
  return { id, identityId: `identity-${id}`, revisionId: `revision-${id}`, styleName: id, sourcePath: `/fonts/${id}.ttf`, faceIndex: 0, axes };
}

test('按范围选择轴步进并锚定到最小值', () => {
  assert.equal(axisStep(100, 900), 1);
  assert.equal(axisStep(75, 125), 0.5);
  assert.equal(axisStep(-1, 1), 0.05);
  assert.equal(axisStep(0, 1), 0.01);
  assert.equal(axisStep(0, 0), 0.01);
});

test('拖动值吸附到步进并收敛到上下限', () => {
  assert.equal(snapAxisValue(434.4, 100, 900, 1), 434);
  assert.equal(snapAxisValue(434.6, 100, 900, 1), 435);
  assert.equal(snapAxisValue(95, 100, 900, 1), 100);
  assert.equal(snapAxisValue(1200, 100, 900, 1), 900);
  assert.equal(clampAxisValue(Number.NaN, 100, 900), 100);
});

test('轴值最多保留两位小数并去掉尾随零', () => {
  assert.equal(formatAxisValue(400), '400');
  assert.equal(formatAxisValue(437.5), '437.5');
  assert.equal(formatAxisValue(0.3333), '0.33');
  assert.equal(formatAxisValue(Number.NaN), '—');
});

test('默认轴值取字款自身默认值', () => {
  const sample = face('Regular', [
    { tag: 'wght', name: 'Weight', minimum: 100, defaultValue: 400, maximum: 900 },
    { tag: 'wdth', name: 'Width', minimum: 75, defaultValue: 100, maximum: 125 },
  ]);
  assert.deepEqual(defaultAxisValues(sample), { wght: 400, wdth: 100 });
  assert.deepEqual(defaultAxisValues(null), {});
});

test('忽略上下限相等的无效可变轴', () => {
  const sample = face('Regular', [
    { tag: 'wght', name: 'Weight', minimum: 100, defaultValue: 400, maximum: 900 },
    { tag: 'ital', name: 'Italic', minimum: 0, defaultValue: 0, maximum: 0 },
  ]);
  assert.deepEqual(adjustableAxes(sample).map((axis) => axis.tag), ['wght']);
});

test('切换字款在两端保持当前选择', () => {
  const faces = [face('Regular'), face('Medium'), face('Bold')];
  assert.equal(stepFaceId(faces, 'Regular', -1), 'Regular');
  assert.equal(stepFaceId(faces, 'Regular', 1), 'Medium');
  assert.equal(stepFaceId(faces, 'Bold', 1), 'Bold');
  assert.equal(stepFaceId(faces, 'missing', 1), 'Medium');
  assert.equal(stepFaceId([], undefined, 1), undefined);
});
