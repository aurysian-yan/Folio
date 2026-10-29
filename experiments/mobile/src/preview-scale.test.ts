import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sanitizePreviewScale } from './preview-scale.ts';

test('连续字号经过偏好保存与恢复后保留小数，不吸附到原来的三档', () => {
  for (const value of [18, 18.125, 20.875, 24, 26.3125, 29.999, 30]) {
    const stored = JSON.stringify({ previewScale: sanitizePreviewScale(value, 24) });
    assert.equal(sanitizePreviewScale(JSON.parse(stored).previewScale, 24), value);
  }
});

test('旧字号仍可读取，越界值裁剪，非有限与损坏值恢复默认', () => {
  for (const value of [12, 36, 48]) assert.equal(sanitizePreviewScale(value, 24), value);
  assert.equal(sanitizePreviewScale(-1, 24), 12);
  assert.equal(sanitizePreviewScale(100, 24), 48);
  for (const value of [NaN, Infinity, -Infinity, '24', null, undefined]) {
    assert.equal(sanitizePreviewScale(value, 24), 24);
  }
});
